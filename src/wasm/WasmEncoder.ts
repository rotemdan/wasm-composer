import { encodeSignedLeb128, encodeUnsignedLeb128 } from '../utilities/Leb128Encoder.js'
import { OpcodeName, wasmOpcodes } from './Opcodes.js'
import { encodeUtf8, float32ToBytes, float64ToBytes } from '../utilities/Utilities.js'
import { DynamicNumericArray } from '../utilities/DynamicArray.js'
import { Op } from './Ops.js'
import { createDynamicUint8Array } from '../utilities/DynamicUint8Array.js'
import { WasmModuleDefinition, ExportEntry, InstructionContext, FunctionSignature, Subtype, SubtypeOrRecursiveType, RecursiveType, CompositeType, ImportEntry, FunctionDefinition, TableEntry, MemoryEntry, GlobalEntry, StartEntry, TagEntry, ElementEntry, ElementEntryType, DataEntry, DataEntryType, CustomSection, Instructions, Instruction, Limits, GlobalType, StructType, HeapType, emptyType, ReferenceType, ReferenceTypeKind, ExportKind, ImportKind, preamble, SectionId, StorageType, ValueType } from './Types.js'
import { isRecursiveType, isArrayType, isStructType, isFunctionSignature, isClauseOpcode, isTryContinuationOpcode, isFrameOpcode, isTryFrameOpcode, isCatchClauseOpcode, isIfClauseOpcode, isBlockInstruction } from './Predicates.js'

export function encodeWasmModule(moduleDefinition: WasmModuleDefinition) {
	const encoder = createWasmEncoder()
	encoder.emitModule(moduleDefinition)

	return encoder.bytesAsUint8Array
}

export function createWasmEncoder() {
	return new WasmEncoder()
}

export class WasmEncoder {
	private outputBytes: DynamicNumericArray = createDynamicUint8Array(1024)

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Full module emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitModule(moduleDefinition: WasmModuleDefinition) {
		// Inititialize
		const functionDefinitions = moduleDefinition.functions ?? []
		const customTypeDefinitions = moduleDefinition.customTypes ?? []
		const importDefinitions = moduleDefinition.imports ?? []

		// Imported symbols occupy index space before the defined ones, so defined
		// symbols must be offset by the number of imported symbols of the same kind.
		const functionsImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Function).length
		const tablesImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Table).length
		const memoriesImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Memory).length
		const globalsImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Global).length
		const tagsImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Tag).length

		const tablesDefinitions = moduleDefinition.tables ?? []
		const memoriesDefinitions = moduleDefinition.memories ?? []
		const globalsDefinitions = moduleDefinition.globals ?? []
		const exportsDefinitions: ExportEntry[] = []
		const startDefinition = moduleDefinition.start
		const elementsDefinitions = moduleDefinition.elements ?? []
		const dataDefinitions = moduleDefinition.data ?? []
		const tagsDefinitions = moduleDefinition.tags ?? []
		const customSections = moduleDefinition.customSections ?? []

		// Extract function signatures, entries, and code entries
		const globalInstructionContext: InstructionContext = {
			functionsLookup: new Map(),
			typesLookup: new Map(),
			tablesLookup: new Map(),
			memoriesLookup: new Map(),
			globalsLookup: new Map(),
			elementsLookup: new Map(),
			dataLookup: new Map(),
			tagsLookup: new Map(),
			localsLookup: new Map(),

			blockStack: [],
			tryBlockStack: [],
		}

		// Make imported symbols referenceable by name from instructions (e.g.
		// `Op.global.get(importedName)`, `Op.memory.size(importedName)`, `Op.call(importedName)`,
		// `Op.table.get(importedName)`). They occupy the leading indices of their kind's index
		// space, so each kind is numbered from zero independently.
		{
			let functionsImportIndex = 0
			let tablesImportIndex = 0
			let memoriesImportIndex = 0
			let globalsImportIndex = 0
			let tagsImportIndex = 0

			for (const entry of importDefinitions) {
				const description = entry.description

				if (description.type === ImportKind.Function) {
					globalInstructionContext.functionsLookup.set(entry.importName, functionsImportIndex++)
				} else if (description.type === ImportKind.Table) {
					globalInstructionContext.tablesLookup.set(entry.importName, tablesImportIndex++)
				} else if (description.type === ImportKind.Memory) {
					globalInstructionContext.memoriesLookup.set(entry.importName, memoriesImportIndex++)
				} else if (description.type === ImportKind.Global) {
					globalInstructionContext.globalsLookup.set(entry.importName, globalsImportIndex++)
				} else if (description.type === ImportKind.Tag) {
					globalInstructionContext.tagsLookup.set(entry.importName, tagsImportIndex++)
				}
			}
		}

		// Make data segments referenceable by name (mirrors `elementsLookup` population above),
		// so `memory.init` / `data.drop` can resolve a segment by its definition name.
		dataDefinitions.forEach((entry, index) => {
			globalInstructionContext.dataLookup.set(entry.name, index)
		})

		// Add functions, table entries, memories and globals that are marked as exported
		// to an exports definition.
		functionDefinitions.forEach((entry, index) => {
			globalInstructionContext.functionsLookup.set(entry.name, functionsImportCount + index)
			globalInstructionContext.typesLookup.set(entry.name, index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Function,
					index: functionsImportCount + index
				})
			}
		})

		let customTypeIndex = functionDefinitions.length

		customTypeDefinitions.forEach((entry) => {
			globalInstructionContext.typesLookup.set(entry.name, customTypeIndex)

			if (isRecursiveType(entry)) {
				entry.subtypes.forEach((subtype, subtypeIndex) => {
					globalInstructionContext.typesLookup.set(subtype.name, customTypeIndex + subtypeIndex)
				})

				customTypeIndex += entry.subtypes.length
			} else {
				customTypeIndex += 1
			}
		})

		const functionSignatures = functionDefinitions.map(entry => {
			const paramTypes = Object.values(entry.params ?? {})
			const returnTypes = entry.returns == null
				? []
				: (Array.isArray(entry.returns) ? Object.values(entry.returns) : [entry.returns])

			return {
				paramTypes,
				returnTypes
			} as FunctionSignature
		})

		const functionTypes = functionSignatures.map(signature => ({ type: signature } as Subtype))

		tablesDefinitions.forEach((entry, index) => {
			globalInstructionContext.tablesLookup.set(entry.name, tablesImportCount + index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Table,
					index: tablesImportCount + index
				})
			}
		})

		globalsDefinitions.forEach((entry, index) => {
			globalInstructionContext.globalsLookup.set(entry.name, globalsImportCount + index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Global,
					index: globalsImportCount + index
				})
			}
		})

		elementsDefinitions.forEach((entry, index) => {
			globalInstructionContext.elementsLookup.set(entry.name, index)
		})

		memoriesDefinitions.forEach((entry, index) => {
			globalInstructionContext.memoriesLookup.set(entry.name, memoriesImportCount + index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Memory,
					index: memoriesImportCount + index
				})
			}
		})

		tagsDefinitions.forEach((entry, index) => {
			globalInstructionContext.tagsLookup.set(entry.name, tagsImportCount + index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Tag,
					index: tagsImportCount + index
				})
			}
		})

		// Emit the module
		this.emitPreamble()

		this.emitTypesSection([...functionTypes, ...customTypeDefinitions])

		this.emitImportsSection(importDefinitions)

		this.emitFunctionsSection(functionDefinitions)

		this.emitTablesSection(tablesDefinitions)

		this.emitMemoriesSection(memoriesDefinitions)

		this.emitTagsSection(tagsDefinitions, globalInstructionContext)

		this.emitGlobalsSection(globalsDefinitions, globalInstructionContext)

		this.emitExportsSection(exportsDefinitions)

		if (startDefinition) {
			this.emitStartSection(startDefinition)
		}

		// Collect every function referenced via `ref.func` so that non-exported functions
		// become "declared" in the module. Without this, engines reject `ref.func`/`call_ref`
		// targeting an undeclared (non-exported, non-element-referenced) function with
		// "undeclared reference to function #N".
		const refFuncTargets = new Set<string>()

		functionDefinitions.forEach(entry => this.collectRefFuncTargets(entry.instructions, refFuncTargets))
		globalsDefinitions.forEach(entry => this.collectRefFuncTargets(entry.instructions, refFuncTargets))
		elementsDefinitions.forEach(entry => this.collectRefFuncTargetsFromElement(entry, refFuncTargets))

		const allElementsDefinitions = [
			...elementsDefinitions,
			...this.getElementDefinitionsForRefFuncTargets(refFuncTargets, globalInstructionContext)
		]

		this.emitElementsSection(allElementsDefinitions, globalInstructionContext)

		if (dataDefinitions.length > 0) {
			this.emitDataCountSection(dataDefinitions.length)
		}

		this.emitCodeSection(functionDefinitions, globalInstructionContext)

		this.emitDataSection(dataDefinitions, globalInstructionContext)

		for (const customSection of customSections) {
			this.emitCustomSection(customSection)
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Preamble emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitPreamble() {
		this.emitBytes(preamble)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Types section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitTypesSection(types: SubtypeOrRecursiveType[]) {
		if (types.length === 0) {
			return
		}

		this.emitByte(SectionId.Types)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(types.length)

		for (const type of types) {
			sectionEncoder.emitSubtypeOrRecursiveType(type)
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	emitSubtypeOrRecursiveType(type: SubtypeOrRecursiveType) {
		if (isRecursiveType(type)) {
			this.emitRecursiveType(type)
		} else {
			this.emitSubtype(type)
		}
	}

	emitRecursiveType(type: RecursiveType) {
		const subtypes = type.subtypes

		this.emitByte(0x4e)

		this.emitUnsignedLeb128(subtypes.length)

		for (const subtype of subtypes) {
			this.emitSubtype(subtype)
		}
	}

	emitSubtype(subtype: Subtype) {
		if (subtype.supertypeIndexes) {
			// Subtype with supertypes: 0x4F (final) or 0x50 (non-final), then the supertype vector.
			this.emitByte(subtype.final ? 0x4f : 0x50)
			this.emitLengthPrefixedUintArray(subtype.supertypeIndexes)
		} else if (subtype.final === false) {
			// Non-final subtype without supertypes must use 0x50 with an empty supertype vector.
			// The bare comptype shorthand (form 3) is only valid for *final* subtypes without supertypes.
			this.emitByte(0x50)
			this.emitUnsignedLeb128(0)
		}
		// else: final subtype without supertypes (explicitly final, or `final` left
		// unspecified, which defaults to final per the WASM text format) -> bare
		// comptype shorthand (spec form 3). This is the canonical encoding for
		// e.g. plain function types created without an explicit `final` flag.

		this.emitCompositeType(subtype.type)
	}

	emitCompositeType(type: CompositeType) {
		if (isArrayType(type)) {
			this.emitByte(0x5e)
			this.emitStorageType(type.storageType)
			// Array element carries a field mutability flag (0x00 = immutable, 0x01 = mutable).
			this.emitByte(type.mutable === true ? 1 : 0)
		} else if (isStructType(type)) {
			this.emitByte(0x5f)
			this.emitStructType(type)
		} else if (isFunctionSignature(type)) {
			this.emitByte(0x60)
			this.emitFunctionSignature(type)
		} else {
			throw new TypeError(`Invalid composite type`)
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Imports section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitImportsSection(importEntries: ImportEntry[]) {
		if (importEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Imports)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(importEntries.length)

		for (const entry of importEntries) {
			const description = entry.description

			sectionEncoder.emitString(entry.moduleName)
			sectionEncoder.emitString(entry.importName)
			sectionEncoder.emitByte(description.type)

			if (description.type === ImportKind.Function) {
				sectionEncoder.emitUnsignedLeb128(description.index)
			} else if (description.type === ImportKind.Table) {
				sectionEncoder.emitTableEntry(description.tableEntry)
			} else if (description.type === ImportKind.Memory) {
				sectionEncoder.emitLimits(description.memoryLimits)
			} else if (description.type === ImportKind.Global) {
				sectionEncoder.emitGlobalType(description.globalType)
			} else if (description.type === ImportKind.Tag) {
				// tagtype ::= 0x00 x : typeidx => x
				sectionEncoder.emitByte(0x00)
				sectionEncoder.emitUnsignedLeb128(description.typeIndex)
			} else {
				throw new TypeError(`Invalid import entry type ${(entry as ImportEntry).description.type}`)
			}
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Functions section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitFunctionsSection(functionDefinitions: FunctionDefinition[]) {
		if (functionDefinitions.length === 0) {
			return
		}

		this.emitByte(SectionId.Functions)

		const sectionEncoder = createWasmEncoder()

		// This assumes that function types start at 0, and then followed by custom types
		const functionTypeIndexes = functionDefinitions.map((entry, index) => index)

		sectionEncoder.emitLengthPrefixedUintArray(functionTypeIndexes)

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Tables section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitTablesSection(tableEntries: TableEntry[]) {
		if (tableEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Tables)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(tableEntries.length)

		for (const entry of tableEntries) {
			sectionEncoder.emitTableEntry(entry)
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Memories section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitMemoriesSection(memoryEntries: MemoryEntry[]) {
		if (memoryEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Memory)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(memoryEntries.length)

		for (const entry of memoryEntries) {
			sectionEncoder.emitLimits(entry)
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Globals section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitGlobalsSection(globalEntries: GlobalEntry[], instructionContext: InstructionContext) {
		if (globalEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Globals)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(globalEntries.length)

		for (const entry of globalEntries) {
			sectionEncoder.emitGlobalType(entry)
			sectionEncoder.emitExpression(entry.instructions, instructionContext)
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Exports section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitExportsSection(exportEntries: ExportEntry[]) {
		if (exportEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Exports)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(exportEntries.length)

		for (const entry of exportEntries) {
			sectionEncoder.emitString(entry.name)
			sectionEncoder.emitByte(entry.kind)
			sectionEncoder.emitUnsignedLeb128(entry.index)
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Start section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitStartSection(startEntry: StartEntry) {
		this.emitByte(SectionId.Start)

		this.emitLengthPrefixedBytes(encodeUnsignedLeb128(startEntry.functionIndex))
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Tags section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitTagsSection(tagEntries: TagEntry[], instructionContext: InstructionContext) {
		if (tagEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Tag)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(tagEntries.length)

		for (const entry of tagEntries) {
			const typeIndex = instructionContext.typesLookup.get(entry.typeName)

			if (typeIndex === undefined) {
				throw new Error(`Tag '${entry.name}': Couldn't resolve type name '${entry.typeName}'`)
			}

			// tagtype ::= 0x00 x : typeidx => x
			sectionEncoder.emitByte(0x00)
			sectionEncoder.emitUnsignedLeb128(typeIndex)
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Elements section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitElementsSection(elementEntries: ElementEntry[], instructionContext: InstructionContext): void {
		if (elementEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Elements)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(elementEntries.length)

		for (const entry of elementEntries) {
			sectionEncoder.emitByte(entry.flags)

			const elementKind = 0x00

			if (entry.flags === ElementEntryType.ActiveTableZero) { // 0
				sectionEncoder.emitExpression(entry.instructions, instructionContext)
				sectionEncoder.emitLengthPrefixedUintArray(entry.functionIndexes)
			} else if (entry.flags === ElementEntryType.Passive) { // 1
				sectionEncoder.emitByte(elementKind)
				sectionEncoder.emitLengthPrefixedUintArray(entry.functionIndexes)
			} else if (entry.flags === ElementEntryType.Active) { // 2
				sectionEncoder.emitUnsignedLeb128(entry.tableIndex)
				sectionEncoder.emitExpression(entry.instructions, instructionContext)
				sectionEncoder.emitByte(elementKind)
				sectionEncoder.emitLengthPrefixedUintArray(entry.functionIndexes)
			} else if (entry.flags === ElementEntryType.Declarative) { // 3
				sectionEncoder.emitByte(elementKind)
				sectionEncoder.emitLengthPrefixedUintArray(entry.functionIndexes)
			} else if (entry.flags === ElementEntryType.ActiveTableZeroWithInstructions) {  // 4
				sectionEncoder.emitExpression(entry.instructions, instructionContext)
				sectionEncoder.emitLengthPrefixedInstructionsArray(entry.functionInstructions, instructionContext)
			} else if (entry.flags === ElementEntryType.PassiveWithInstructions) { // 5
				sectionEncoder.emitReferenceType(entry.referenceType)
				sectionEncoder.emitLengthPrefixedInstructionsArray(entry.functionInstructions, instructionContext)
			} else if (entry.flags === ElementEntryType.ActiveWithInstructions) { // 6
				sectionEncoder.emitUnsignedLeb128(entry.tableIndex)
				sectionEncoder.emitExpression(entry.instructions, instructionContext)
				sectionEncoder.emitReferenceType(entry.referenceType)
				sectionEncoder.emitLengthPrefixedInstructionsArray(entry.functionInstructions, instructionContext)
			} else if (entry.flags === ElementEntryType.DeclarativeWithInstructions) { // 7
				sectionEncoder.emitReferenceType(entry.referenceType)
				sectionEncoder.emitLengthPrefixedInstructionsArray(entry.functionInstructions, instructionContext)
			} else {
				throw new TypeError(`Invalid element entry flags: ${(entry as ElementEntry).flags}`)
			}
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Data count section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitDataCountSection(dataCount: number) {
		this.emitByte(SectionId.DataCount)

		this.emitLengthPrefixedBytes(encodeUnsignedLeb128(dataCount))
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Code section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitCodeSection(functionDefinitions: FunctionDefinition[], instructionContext: InstructionContext) {
		if (functionDefinitions.length === 0) {
			return
		}

		instructionContext = { ...instructionContext }

		this.emitByte(SectionId.Code)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(functionDefinitions.length)

		for (const entry of functionDefinitions) {
			const entryEmitter = createWasmEncoder()

			instructionContext.localsLookup = new Map()

			const localNames = [...Object.keys(entry.params ?? {}), ...(Object.keys(entry.locals ?? {}))]

			localNames.forEach((name, index) => {
				instructionContext.localsLookup.set(name, index)
			})

			const localTypes = Object.values(entry.locals ?? {})

			entryEmitter.emitUnsignedLeb128(localTypes.length)

			for (const localEntry of localTypes) {
				///entryEmitter.emitUint(localEntry.count)
				entryEmitter.emitUnsignedLeb128(1)
				entryEmitter.emitValueType(localEntry)
			}

			entryEmitter.emitInstructions(entry.instructions, instructionContext)
			entryEmitter.emitInstruction(Op.end, instructionContext)

			sectionEncoder.emitLengthPrefixedBytes(entryEmitter.bytes)
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Data section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitDataSection(dataEntries: DataEntry[], instructionContext: InstructionContext) {
		if (dataEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Data)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUnsignedLeb128(dataEntries.length)

		for (const entry of dataEntries) {
			sectionEncoder.emitByte(entry.flags)

			if (entry.flags === DataEntryType.ActiveMemoryZero) {
				sectionEncoder.emitExpression(entry.instructions, instructionContext)
				sectionEncoder.emitLengthPrefixedBytes(entry.data)
			} else if (entry.flags === DataEntryType.Active) {
				sectionEncoder.emitUnsignedLeb128(entry.memoryIndex)
				sectionEncoder.emitExpression(entry.instructions, instructionContext)
				sectionEncoder.emitLengthPrefixedBytes(entry.data)
			} else if (entry.flags === DataEntryType.Passive) {
				sectionEncoder.emitLengthPrefixedBytes(entry.data)
			} else {
				throw new TypeError(`Invalid data section flags: ${(entry as DataEntry).flags}`)
			}
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Custom section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitCustomSection(customSection: CustomSection) {
		this.emitByte(SectionId.Custom)

		const sectionEncoder = createWasmEncoder()
		sectionEncoder.emitString(customSection.name)
		sectionEncoder.emitBytes(customSection.content)

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Instruction emitters
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitLengthPrefixedInstructionsArray(instructionsArray: Instructions, context: InstructionContext) {
		// Each top-level item of `instructionsArray` is ONE element expression: vec(expr) requires
		// the vec length to be the number of expressions (not the number of flattened instructions),
		// and every expression must be terminated by its own `end` (0x0B).
		this.emitUnsignedLeb128(instructionsArray.length)

		for (const elementInstructions of instructionsArray) {
			const flattenedInstructions = WasmEncoder.flattenInstructions(Array.isArray(elementInstructions) ? elementInstructions : [elementInstructions])

			this.emitFlattenedInstructions(flattenedInstructions, context)

			this.emitInstruction(Op.end, context)
		}
	}

	emitInstructions(instructions: Instructions, context: InstructionContext) {
		const flattenedInstructions = WasmEncoder.flattenInstructions(instructions)

		this.emitFlattenedInstructions(flattenedInstructions, context)
	}

	// Emits a complete expression, which per the binary spec must be terminated by `end` (0x0B).
	emitExpression(instructions: Instructions, context: InstructionContext) {
		this.emitInstructions(instructions, context)
		this.emitInstruction(Op.end, context)
	}

	emitFlattenedInstructions(instructions: Instruction[], context: InstructionContext) {
		// `framedContext` is the context in effect *while a clause* (`else`/`catch`/`catch_all`/
		// `delegate`) *is being emitted*. A frame that is immediately followed by such a clause
		// keeps that frame open on the block stack, so `br`/`rethrow`/`delegate` inside the clause
		// resolve against the enclosing frame (e.g. a `br` in an `else` still targets the enclosing
		// `loop`). It is `null` when the next instruction is not a clause of the current frame.
		let framedContext: InstructionContext | null = null
		const baseContext: InstructionContext = { ...context }

		for (let instructionIndex = 0; instructionIndex < instructions.length; instructionIndex++) {
			const instruction = instructions[instructionIndex]
			const opcodeName = instruction.opcodeName
			const nextOpcodeName = instructions[instructionIndex + 1]?.opcodeName

			const isClause = isClauseOpcode(opcodeName)

			// A try clause (`catch`/`catch_all`/`delegate`) keeps the try construct open; only its
			// final clause closes it.
			const continuesTry = isTryContinuationOpcode(nextOpcodeName)

			// 1. Emit the instruction. Clauses see the enclosing frame. Everything else sees the
			//    plain (post-frame) context.
			const emitContext = (isClause && framedContext) ? framedContext : context
			this.emitInstruction(instruction, emitContext)

			// 2. Emit the trailing `end` once an instruction's full body (and any clauses) is done.
			//    `block`/`loop`/`try_table` always close. `if` closes once its `else` is done; `try`
			//    and its `catch`/`catch_all` clauses close once the final try clause is emitted. A
			//    `delegate` is terminal and carries no `end` of its own.
			const closesBlock =
				(isFrameOpcode(opcodeName) && opcodeName !== 'if' && opcodeName !== 'try') ||
				(opcodeName === 'if' && nextOpcodeName !== 'else') ||
				(isTryFrameOpcode(opcodeName) && !continuesTry) ||
				(isCatchClauseOpcode(opcodeName) && !continuesTry) ||
				isIfClauseOpcode(opcodeName)

			if (closesBlock) {
				this.emitInstruction(Op.end, context)
			}

			// 3. Advance the context bookkeeping for the *next* sibling instruction.
			//    A frame opens a clause only when its immediate successor is `else`/`catch`/
			//    `catch_all` (`delegate` deliberately excluded: it uses the post-frame context, since
			//    the current try is already "consumed" by the time a delegate clause runs).
			const opensClause =
				isFrameOpcode(opcodeName) &&
				isBlockInstruction(instruction) &&
				(isIfClauseOpcode(nextOpcodeName) || isCatchClauseOpcode(nextOpcodeName))

			if (opensClause) {
				// Keep the frame open: following clause instruction(s) must see it on the block
				// stack. `tryBlockStack` is intentionally *not* extended here — `rethrow`/`delegate`
				// resolve against the enclosing tries only, not the current one.
				framedContext = {
					...context,
					blockStack: [instruction.blockName, ...context.blockStack],
				}
			} else if (!(isClause && continuesTry)) {
				// Either this was not a clause, or it was the final clause of the try
				// construct: the previously open frame is now closed.
				framedContext = null
			}
			// else: a non-final catch clause keeps `framedContext` unchanged for the next clause.

			context = { ...baseContext }
		}
	}

	emitInstruction(instruction: Instruction, context: InstructionContext) {
		this.emitBytes(WasmEncoder.opcodeNameToBytes(instruction.opcodeName))

		if (instruction.immediatesEmitter) {
			instruction.immediatesEmitter(this, context)
		}

		if (isBlockInstruction(instruction)) {
			context = { ...context }

			// Only label-defining blocks introduce a new label onto the stack. Clauses such as
			// `else`, `catch`, and `catch_all` share the label of their enclosing `if`/`try`
			// block, so pushing them would shift the depth that `rethrow`/`delegate`/`br`
			// resolve against and point at the wrong frame.
			const pushesNewLabel = isFrameOpcode(instruction.opcodeName)

			if (pushesNewLabel) {
				context.blockStack = [instruction.blockName, ...context.blockStack]

				// `try`/`try_table` also introduce a *try* frame. `rethrow`/`delegate` resolve
				// an enclosing try by name and their label counts try frames (excluding the
				// current one), so they consult this dedicated stack rather than `blockStack`.
				if (isTryFrameOpcode(instruction.opcodeName)) {
					context.tryBlockStack = [instruction.blockName, ...context.tryBlockStack]
				}
			}

			this.emitInstructions(instruction.bodyInstructions, context)
		}
	}

	emitOpcode(opcode: number) {
		if (opcode <= 0xff) {
			this.emitByte(opcode)
		} else if (opcode <= 0xffff) {
			// Prefixed opcode: a literal prefix byte followed by the (LEB128) sub-opcode.
			this.emitByte((opcode >>> 8) & 0xff)
			this.emitUnsignedLeb128(opcode & 0xff)
		} else {
			// 3-byte prefixed opcode (e.g. 0xfd000 | sub): literal prefix + LEB128 sub-opcode.
			this.emitByte((opcode >>> 12) & 0xff)
			this.emitUnsignedLeb128(opcode & 0xfff)
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Common emitters used by several different sections
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitTableEntry(entry: TableEntry) {
		this.emitReferenceType(entry.referenceType)
		this.emitLimits(entry.limits)
	}

	emitLimits(entry: Limits) {
		const i64 = entry.indexType === 'i64'

		if (entry.maximum !== undefined) {
			this.emitByte(i64 ? 0x05 : 0x01)
			this.emitUnsignedLeb128(entry.minimum)
			this.emitUnsignedLeb128(entry.maximum)
		} else {
			this.emitByte(i64 ? 0x04 : 0x00)
			this.emitUnsignedLeb128(entry.minimum)
		}
	}

	emitFunctionSignature(functionSignature: FunctionSignature) {
		this.emitLengthPrefixedValueTypeArray(functionSignature.paramTypes)
		this.emitLengthPrefixedValueTypeArray(functionSignature.returnTypes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Data type emitters
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitGlobalType(globalType: GlobalType) {
		this.emitValueType(globalType.type)
		this.emitByte(Number(globalType.mutable))
	}

	emitStructType(structType: StructType) {
		const fields = structType.fields

		this.emitUnsignedLeb128(fields.length)

		for (const field of fields) {
			this.emitStorageType(field.storageType)
			this.emitByte(field.mutable === true ? 1 : 0)
		}
	}

	emitLengthPrefixedValueTypeArray(valueTypes: ValueType[]) {
		this.emitUnsignedLeb128(valueTypes.length)

		for (const dataType of valueTypes) {
			this.emitValueType(dataType)
		}
	}

	emitValueType(valueType: ValueType) {
		this.emitStorageType(valueType)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Heap type emitter
	//
	// heaptype ::= ht : absheaptype | x : s33 (if x >= 0)
	//
	// An abstract heap type is encoded as a single byte in the range 0x69..0x74, while a
	// concrete (named) type is encoded as a positive s33 (signed LEB128) type index.
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitHeapType(heapType: HeapType | string, context: InstructionContext) {
		if (typeof heapType === 'string') {
			const typeIndex = context.typesLookup.get(heapType)

			if (typeIndex === undefined) {
				throw new Error(`emitHeapType: Couldn't resolve type name '${heapType}'`)
			}

			// Concrete type index heaptype: positive s33 (signed LEB128).
			this.emitSignedLeb128(typeIndex)
		} else {
			// Abstract heap type: a single byte in the range 0x69..0x74.
			this.emitByte(heapType)
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Block type emitter
	//
	// blocktype ::= 0x40 => ε | t : valtype => t | i : s33 => i (if i >= 0)
	//
	// A multi-result block type is encoded as a positive s33 (signed LEB128) type index that
	// references a function type in the type section.
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitBlockType(returns: ValueType | string | undefined, context: InstructionContext) {
		if (returns === undefined) {
			this.emitByte(emptyType)
		} else if (typeof returns === 'string') {
			const typeIndex = context.typesLookup.get(returns)

			if (typeIndex === undefined) {
				throw new Error(`emitBlockType: Couldn't resolve type name '${returns}'`)
			}

			// Multi-result block type: positive s33 (signed LEB128) type index.
			this.emitSignedLeb128(typeIndex)
		} else {
			this.emitValueType(returns)
		}
	}

	emitStorageType(type: StorageType) {
		if (typeof type === 'number') {
			this.emitByte(type)
		} else {
			this.emitReferenceType(type)
		}
	}

	emitReferenceType(refType: ReferenceType) {
		const kind = refType.kind

		if (kind === ReferenceTypeKind.ShortTypeId) {
			this.emitByte(refType.typeId)
		} else if (kind === ReferenceTypeKind.ShortTypeIndex) {
			this.emitSignedLeb128(refType.typeIndex)
		} else if (kind === ReferenceTypeKind.LongNullableTypeId) {
			this.emitByte(0x63)
			this.emitByte(refType.typeId)
		} else if (kind === ReferenceTypeKind.LongNullableTypeIndex) {
			this.emitByte(0x63)
			this.emitSignedLeb128(refType.typeIndex)
		} else if (kind === ReferenceTypeKind.LongNonNullableTypeId) {
			this.emitByte(0x64)
			this.emitByte(refType.typeId)
		} else if (kind === ReferenceTypeKind.LongNonNullableTypeIndex) {
			this.emitByte(0x64)
			this.emitSignedLeb128(refType.typeIndex)
		} else {
			throw new Error(`Invalid reference type kind: ${kind}`)
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Low-level emitters
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitLengthPrefixedBytes(bytes: ArrayLike<number>) {
		this.emitUnsignedLeb128(bytes.length)
		this.emitBytes(bytes)
	}

	emitString(str: string) {
		const content = encodeUtf8(str)

		this.emitUnsignedLeb128(content.length)
		this.emitBytes(content)
	}

	emitFloat32(num: number) {
		this.emitBytes(float32ToBytes(num))
	}

	emitFloat64(num: number) {
		this.emitBytes(float64ToBytes(num))
	}

	emitByte(byte: number) {
		this.outputBytes.appendValue(byte)
	}

	emitBytes(bytes: ArrayLike<number>) {
		this.outputBytes.appendValues(bytes)
	}

	emitSignedLeb128(value: number | bigint) {
		this.emitBytes(encodeSignedLeb128(value))
	}

	emitUnsignedLeb128(value: number | bigint) {
		this.emitBytes(encodeUnsignedLeb128(value))
	}

	emitLengthPrefixedUintArray(elements: ArrayLike<number>) {
		this.emitUnsignedLeb128(elements.length)

		for (let i = 0; i < elements.length; i++) {
			this.emitUnsignedLeb128(elements[i])
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Reset
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	reset() {
		this.outputBytes.clear()
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Getters
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	get bytes() {
		return this.outputBytes.values
	}

	get bytesAsUint8Array() {
		return Uint8Array.from(this.bytes)
	}

	get byteCount() {
		return this.outputBytes.length
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Private utilities
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	private getElementDefinitionsForRefFuncTargets(refFuncTargets: Set<string>, globalInstructionContext: InstructionContext) {
		const elementDefinitions: ElementEntry[] = []

		const declaredRefFuncTargets = Array.from(refFuncTargets).filter(name => globalInstructionContext.functionsLookup.has(name))

		if (declaredRefFuncTargets.length > 0) {
			elementDefinitions.push({
				name: '__wasm_composer_declarations__',
				flags: ElementEntryType.DeclarativeWithInstructions,
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				functionInstructions: declaredRefFuncTargets.map(name => Op.ref.func(name)),
			})
		}

		return elementDefinitions
	}

	// Recursively collects the names of every function referenced by a `ref.func` instruction.
	// A function reached via `ref.func` (and thus indirectly via `call_ref`) must be "declared"
	// in the module, otherwise engines reject it with "undeclared reference to function #N".
	private collectRefFuncTargets(instructions: Instructions, targets: Set<string>) {
		for (const element of instructions) {
			if (Array.isArray(element)) {
				this.collectRefFuncTargets(element, targets)

				continue
			}

			if (element.opcodeName === 'ref.func') {
				targets.add(element.args[0] as string)
			}

			if (isBlockInstruction(element)) {
				this.collectRefFuncTargets(element.bodyInstructions, targets)
			}
		}
	}

	private collectRefFuncTargetsFromElement(entry: ElementEntry, targets: Set<string>) {
		switch (entry.flags) {
			case ElementEntryType.ActiveTableZeroWithInstructions:
			case ElementEntryType.ActiveWithInstructions: {
				this.collectRefFuncTargets(entry.instructions, targets)
				this.collectRefFuncTargets(entry.functionInstructions, targets)

				break
			}

			case ElementEntryType.PassiveWithInstructions:
			case ElementEntryType.DeclarativeWithInstructions: {
				this.collectRefFuncTargets(entry.functionInstructions, targets)

				break
			}

			case ElementEntryType.ActiveTableZero:
			case ElementEntryType.Passive:
			case ElementEntryType.Active:
			case ElementEntryType.Declarative: {
				// These reference functions via numeric indexes, which already declare them.
				break
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Private static helpers
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	private static flattenInstructions(instructions: Instructions): Instruction[] {
		let result: Instruction[] = []

		for (const element of instructions) {
			if (Array.isArray(element)) {
				result = [...result, ...WasmEncoder.flattenInstructions(element)]
			} else {
				result.push(element)
			}
		}

		return result
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Precomputed opcode binary encoding lookup table
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	private static opcodeNameToBytesLookup?: { [key in keyof typeof wasmOpcodes]: number[] }

	static opcodeNameToBytes(opcodeName: OpcodeName): number[] {
		if (!WasmEncoder.opcodeNameToBytesLookup) {
			(WasmEncoder.opcodeNameToBytesLookup as any) = {}

			const opcodeEncoder = createWasmEncoder()

			for (const key of Object.keys(wasmOpcodes)) {
				opcodeEncoder.reset()
				opcodeEncoder.emitOpcode((wasmOpcodes as any)[key]);

				(WasmEncoder.opcodeNameToBytesLookup as any)[key] = Array.from(opcodeEncoder.bytes)
			}
		}

		return WasmEncoder.opcodeNameToBytesLookup![opcodeName]
	}
}
