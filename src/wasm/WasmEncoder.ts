import { encodeSignedLeb128, encodeUnsignedLeb128 } from '../utilities/Leb128Encoder.js'
import { OpcodeName, wasmOpcodes } from './Opcodes.js'
import { encodeUtf8, float32ToBytes, float64ToBytes } from '../utilities/Utilities.js'
import { DynamicNumericArray } from '../utilities/DynamicArray.js'
import { Op } from './Ops.js'
import { createDynamicUint8Array } from '../utilities/DynamicUint8Array.js'
import { createDynamicNumberArray } from '../utilities/DynamicNumberArray.js'

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
	//private outputBytes: DynamicNumericArray = createDynamicNumberArray()

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
		const functionImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Function).length
		const tableImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Table).length
		const memoryImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Memory).length
		const globalImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Global).length
		const tagImportCount = importDefinitions.filter(e => e.description.type === ImportKind.Tag).length

		const tablesDefinitions = moduleDefinition.tables ?? []
		const memoriesDefinitions = moduleDefinition.memories ?? []
		const globalsDefinitions = moduleDefinition.globals ?? []
		const exportsDefinitions: ExportEntry[] = []
		const startDefinition = moduleDefinition.start
		const elementsDefinitions = moduleDefinition.elements ?? []
		const dataDefinitions = moduleDefinition.data ?? []
		const tagDefinitions = moduleDefinition.tags ?? []
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
			let functionImportIndex = 0
			let tableImportIndex = 0
			let memoryImportIndex = 0
			let globalImportIndex = 0
			let tagImportIndex = 0

			for (const entry of importDefinitions) {
				const description = entry.description

				if (description.type === ImportKind.Function) {
					globalInstructionContext.functionsLookup.set(entry.importName, functionImportIndex++)
				} else if (description.type === ImportKind.Table) {
					globalInstructionContext.tablesLookup.set(entry.importName, tableImportIndex++)
				} else if (description.type === ImportKind.Memory) {
					globalInstructionContext.memoriesLookup.set(entry.importName, memoryImportIndex++)
				} else if (description.type === ImportKind.Global) {
					globalInstructionContext.globalsLookup.set(entry.importName, globalImportIndex++)
				} else if (description.type === ImportKind.Tag) {
					globalInstructionContext.tagsLookup.set(entry.importName, tagImportIndex++)
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
			globalInstructionContext.functionsLookup.set(entry.name, functionImportCount + index)
			globalInstructionContext.typesLookup.set(entry.name, index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Function,
					index: functionImportCount + index
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
			globalInstructionContext.tablesLookup.set(entry.name, tableImportCount + index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Table,
					index: tableImportCount + index
				})
			}
		})

		globalsDefinitions.forEach((entry, index) => {
			globalInstructionContext.globalsLookup.set(entry.name, globalImportCount + index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Global,
					index: globalImportCount + index
				})
			}
		})

		elementsDefinitions.forEach((entry, index) => {
			globalInstructionContext.elementsLookup.set(entry.name, index)
		})

		memoriesDefinitions.forEach((entry, index) => {
			globalInstructionContext.memoriesLookup.set(entry.name, memoryImportCount + index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Memory,
					index: memoryImportCount + index
				})
			}
		})

		tagDefinitions.forEach((entry, index) => {
			globalInstructionContext.tagsLookup.set(entry.name, tagImportCount + index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Tag,
					index: tagImportCount + index
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

		this.emitTagSection(tagDefinitions, globalInstructionContext)

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

		sectionEncoder.emitUint(types.length)

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

		this.emitUint(subtypes.length)

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
			this.emitUint(0)
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

		sectionEncoder.emitUint(importEntries.length)

		for (const entry of importEntries) {
			const description = entry.description

			sectionEncoder.emitString(entry.moduleName)
			sectionEncoder.emitString(entry.importName)
			sectionEncoder.emitByte(description.type)

			if (description.type === ImportKind.Function) {
				sectionEncoder.emitUint(description.index)
			} else if (description.type === ImportKind.Table) {
				sectionEncoder.emitTableEntry(description.tableEntry)
			} else if (description.type === ImportKind.Memory) {
				sectionEncoder.emitLimits(description.memoryLimits)
			} else if (description.type === ImportKind.Global) {
				sectionEncoder.emitGlobalType(description.globalType)
			} else if (description.type === ImportKind.Tag) {
				// tagtype ::= 0x00 x : typeidx => x
				sectionEncoder.emitByte(0x00)
				sectionEncoder.emitUint(description.typeIndex)
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

		sectionEncoder.emitUint(tableEntries.length)

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

		sectionEncoder.emitUint(memoryEntries.length)

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

		sectionEncoder.emitUint(globalEntries.length)

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

		sectionEncoder.emitUint(exportEntries.length)

		for (const entry of exportEntries) {
			sectionEncoder.emitString(entry.name)
			sectionEncoder.emitByte(entry.kind)
			sectionEncoder.emitUint(entry.index)
		}

		this.emitLengthPrefixedBytes(sectionEncoder.bytes)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Start section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitStartSection(startEntry: StartEntry) {
		this.emitByte(SectionId.Start)

		this.emitLengthPrefixedBytes(encodeUint(startEntry.functionIndex))
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Tag section emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitTagSection(tagEntries: TagEntry[], instructionContext: InstructionContext) {
		if (tagEntries.length === 0) {
			return
		}

		this.emitByte(SectionId.Tag)

		const sectionEncoder = createWasmEncoder()

		sectionEncoder.emitUint(tagEntries.length)

		for (const entry of tagEntries) {
			const typeIndex = instructionContext.typesLookup.get(entry.typeName)

			if (typeIndex === undefined) {
				throw new Error(`Tag '${entry.name}': Couldn't resolve type name '${entry.typeName}'`)
			}

			// tagtype ::= 0x00 x : typeidx => x
			sectionEncoder.emitByte(0x00)
			sectionEncoder.emitUint(typeIndex)
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

		sectionEncoder.emitUint(elementEntries.length)

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
				sectionEncoder.emitUint(entry.tableIndex)
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
				sectionEncoder.emitUint(entry.tableIndex)
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

		this.emitLengthPrefixedBytes(encodeUint(dataCount))
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

		sectionEncoder.emitUint(functionDefinitions.length)

		for (const entry of functionDefinitions) {
			const entryEmitter = createWasmEncoder()

			instructionContext.localsLookup = new Map()

			const localNames = [...Object.keys(entry.params ?? {}), ...(Object.keys(entry.locals ?? {}))]

			localNames.forEach((name, index) => {
				instructionContext.localsLookup.set(name, index)
			})

			const localTypes = Object.values(entry.locals ?? {})

			entryEmitter.emitUint(localTypes.length)

			for (const localEntry of localTypes) {
				///entryEmitter.emitUint(localEntry.count)
				entryEmitter.emitUint(1)
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

		sectionEncoder.emitUint(dataEntries.length)

		for (const entry of dataEntries) {
			sectionEncoder.emitByte(entry.flags)

			if (entry.flags === DataEntryType.ActiveMemoryZero) {
				sectionEncoder.emitExpression(entry.instructions, instructionContext)
				sectionEncoder.emitLengthPrefixedBytes(entry.data)
			} else if (entry.flags === DataEntryType.Active) {
				sectionEncoder.emitUint(entry.memoryIndex)
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
		const flattenedInstructions = flattenInstructions(instructionsArray)

		this.emitUint(flattenedInstructions.length)

		this.emitFlattenedInstructions(flattenedInstructions, context)
		// Each element value is an expression and must be terminated by `end` (0x0B).
		this.emitInstruction(Op.end, context)
	}

	emitInstructions(instructions: Instructions, context: InstructionContext) {
		const flattenedInstructions = flattenInstructions(instructions)

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
		this.emitBytes(opcodeNameToBytes[instruction.opcodeName])

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
			this.emitUint(opcode & 0xff)
		} else {
			// 3-byte prefixed opcode (e.g. 0xfd000 | sub): literal prefix + LEB128 sub-opcode.
			this.emitByte((opcode >>> 12) & 0xff)
			this.emitUint(opcode & 0xfff)
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
			this.emitUint(entry.minimum)
			this.emitUint(entry.maximum)
		} else {
			this.emitByte(i64 ? 0x04 : 0x00)
			this.emitUint(entry.minimum)
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

		this.emitUint(fields.length)

		for (const field of fields) {
			this.emitStorageType(field.storageType)
			this.emitByte(field.mutable === true ? 1 : 0)
		}
	}

	emitLengthPrefixedValueTypeArray(valueTypes: ValueType[]) {
		this.emitUint(valueTypes.length)

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
			this.emitInt(typeIndex)
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
			this.emitInt(typeIndex)
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
			this.emitInt(refType.typeIndex)
		} else if (kind === ReferenceTypeKind.LongNullableTypeId) {
			this.emitByte(0x63)
			this.emitByte(refType.typeId)
		} else if (kind === ReferenceTypeKind.LongNullableTypeIndex) {
			this.emitByte(0x63)
			this.emitInt(refType.typeIndex)
		} else if (kind === ReferenceTypeKind.LongNonNullableTypeId) {
			this.emitByte(0x64)
			this.emitByte(refType.typeId)
		} else if (kind === ReferenceTypeKind.LongNonNullableTypeIndex) {
			this.emitByte(0x64)
			this.emitInt(refType.typeIndex)
		} else {
			throw new Error(`Invalid reference type kind: ${kind}`)
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Low-level emitters
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitLengthPrefixedBytes(bytes: ArrayLike<number>) {
		this.emitUint(bytes.length)
		this.emitBytes(bytes)
	}

	emitString(str: string) {
		const content = encodeUtf8(str)

		this.emitUint(content.length)
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

	emitInt(value: number | bigint) {
		this.emitBytes(encodeInt(value))
	}

	emitUint(value: number | bigint) {
		this.emitBytes(encodeUint(value))
	}

	emitLengthPrefixedUintArray(elements: ArrayLike<number>) {
		this.emitUint(elements.length)

		for (let i = 0; i < elements.length; i++) {
			this.emitUint(elements[i])
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
}

export const encodeInt = encodeSignedLeb128
export const encodeUint = encodeUnsignedLeb128

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Precomputed opcode binary encoding lookup table
//////////////////////////////////////////////////////////////////////////////////////////////////////
export const opcodeNameToBytes: { [key in keyof typeof wasmOpcodes]: number[] } = {} as any

function initializeEncodedOpcodesTable() {
	const opcodeEncoder = createWasmEncoder()

	for (const key of Object.keys(wasmOpcodes)) {
		opcodeEncoder.reset()
		opcodeEncoder.emitOpcode((wasmOpcodes as any)[key]);

		(opcodeNameToBytes as any)[key] = Array.from(opcodeEncoder.bytes)
	}
}

initializeEncodedOpcodesTable()

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Constants and enumerations
//////////////////////////////////////////////////////////////////////////////////////////////////////
const preamble = [
	0x00, 0x61, 0x73, 0x6d, // Magic cookie
	0x01, 0x00, 0x00, 0x00, // Version number
]

export const enum SectionId {
	Custom, Types, Imports, Functions, Tables, Memory, Globals, Exports, Start, Elements, Code, Data, DataCount, Tag
}

export type ValueType = NumberType | VectorType | ReferenceType
export type StorageType = ValueType | PackedType

export const enum DataTypeKind {
	Value,
	Reference
}

export const enum NumberType {
	i32 = 0x7f,
	i64 = 0x7e,
	f32 = 0x7d,
	f64 = 0x7c,
}

export const enum VectorType {
	v128 = 0x7b
}

export const enum PackedType {
	i8 = 0x78,
	i16 = 0x77,
}

export const enum ImportKind {
	Function, Table, Memory, Global, Tag
}

export const enum ExportKind {
	Function, Table, Memory, Global, Tag
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// GC types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export type SubtypeOrRecursiveType = Subtype | RecursiveType

export interface RecursiveType {
	name: string
	subtypes: Subtype[]
}

export interface Subtype {
	name: string
	type: CompositeType
	supertypeIndexes?: number[]
	final?: boolean
}

export type CompositeType = ArrayType | StructType | FunctionSignature

export type ArrayType = FieldType

export interface StructType {
	fields: FieldType[]
}

export interface FieldType {
	storageType: StorageType
	mutable?: boolean
}

export interface FunctionSignature {
	paramTypes: ValueType[]
	returnTypes: ValueType[]
}

function isArrayType(compositeType: CompositeType): compositeType is ArrayType {
	return (compositeType as ArrayType).storageType !== undefined
}

function isStructType(compositeType: CompositeType): compositeType is StructType {
	return (compositeType as StructType).fields !== undefined
}

function isRecursiveType(recursiveTypeOrSubtype: SubtypeOrRecursiveType): recursiveTypeOrSubtype is RecursiveType {
	return (recursiveTypeOrSubtype as RecursiveType).subtypes !== undefined
}

function isFunctionSignature(compositeType: CompositeType): compositeType is FunctionSignature {
	return (compositeType as FunctionSignature).paramTypes !== undefined &&
		(compositeType as FunctionSignature).returnTypes !== undefined
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Reference types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export type ReferenceType =
	ShortTypeIdReferenceType |
	ShortTypeIndexReferenceType |
	LongNullableTypeIdReferenceType |
	LongNullableTypeIndexReferenceType |
	LongNonNullableTypeIdReferenceType |
	LongNonNullableTypeIndexReferenceType

export interface ShortTypeIdReferenceType {
	kind: ReferenceTypeKind.ShortTypeId
	typeId: HeapType
}

export interface ShortTypeIndexReferenceType {
	kind: ReferenceTypeKind.ShortTypeIndex
	typeIndex: number
}

export interface LongNullableTypeIdReferenceType {
	kind: ReferenceTypeKind.LongNullableTypeId
	typeId: HeapType
}

export interface LongNullableTypeIndexReferenceType {
	kind: ReferenceTypeKind.LongNullableTypeIndex
	typeIndex: number
}

export interface LongNonNullableTypeIdReferenceType {
	kind: ReferenceTypeKind.LongNonNullableTypeId
	typeId: HeapType
}

export interface LongNonNullableTypeIndexReferenceType {
	kind: ReferenceTypeKind.LongNonNullableTypeIndex
	typeIndex: number
}

export const enum ReferenceTypeKind {
	ShortTypeId,
	ShortTypeIndex,
	LongNullableTypeId,
	LongNullableTypeIndex,
	LongNonNullableTypeId,
	LongNonNullableTypeIndex,
}

export const enum HeapType {
	exn = 0x69,
	nofunc = 0x73,
	noextern = 0x72,
	none = 0x71,
	func = 0x70,
	extern = 0x6f,
	any = 0x6e,
	eq = 0x6d,
	i31 = 0x6c,
	struct = 0x6b,
	array = 0x6a,
	noexn = 0x74,
}

export const emptyType = 0x40

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Module types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface WasmModuleDefinition {
	functions?: FunctionDefinition[]
	globals?: GlobalEntry[]
	customTypes?: SubtypeOrRecursiveType[]
	imports?: ImportEntry[]
	memories?: MemoryEntry[]
	start?: StartEntry
	tables?: TableEntry[]
	elements?: ElementEntry[]
	data?: DataEntry[]
	tags?: TagEntry[]
	customSections?: CustomSection[]
}

export interface FunctionDefinition {
	name: string
	export?: boolean
	params?: FunctionParams
	returns?: ValueType | ValueType[]
	locals?: FunctionLocals
	instructions: Instructions
}

export type FunctionParams = { [paramName: string]: ValueType }
export type FunctionLocals = { [localName: string]: ValueType }

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Custom section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface CustomSection {
	name: string
	content: ArrayLike<number>
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Imports section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface ImportEntry {
	moduleName: string
	importName: string
	description: ImportDescription
}

type ImportDescription = FunctionImportEntry | TableImportEntry | MemoryImportEntry | GlobalImportEntry | TagImportEntry

export interface FunctionImportEntry {
	type: ImportKind.Function
	index: number
}

export interface TableImportEntry {
	type: ImportKind.Table
	tableEntry: TableEntry
}

export interface MemoryImportEntry {
	type: ImportKind.Memory
	memoryLimits: Limits
}

export interface GlobalImportEntry {
	type: ImportKind.Global
	globalType: GlobalType
}

export interface TagImportEntry {
	type: ImportKind.Tag
	typeIndex: number
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Tables section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface TableEntry {
	name: string
	referenceType: ReferenceType
	limits: Limits
	export?: boolean
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Memory section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface MemoryEntry extends Limits {
	name: string
	export?: boolean
}

export interface Limits {
	// `minimum`/`maximum` may be `bigint` for memory64 (and table64) where the
	// limits are encoded as 64-bit unsigned integers.
	minimum: number | bigint
	maximum?: number | bigint
	indexType?: 'i32' | 'i64'
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Globals section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface GlobalType {
	type: ValueType
	mutable: boolean
}

export interface GlobalEntry extends GlobalType {
	name: string
	instructions: Instructions
	export?: boolean
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Exports section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface ExportEntry {
	name: string
	kind: ExportKind
	index: number
}

export interface TagEntry {
	name: string
	typeName: string
	export?: boolean
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Start section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface StartEntry {
	functionIndex: number
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Data section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export type DataEntry =
	ActiveMemoryZeroDataEntry | // 0
	ActiveDataEntry | // 1
	PassiveDataEntry // 2

export interface ActiveMemoryZeroDataEntry { // 0
	name: string

	flags: DataEntryType.ActiveMemoryZero

	instructions: Instructions
	data: ArrayLike<number>
}

export interface ActiveDataEntry { // 1
	name: string

	flags: DataEntryType.Active

	instructions: Instructions
	memoryIndex: number
	data: ArrayLike<number>
}

export interface PassiveDataEntry { // 2
	name: string

	flags: DataEntryType.Passive

	data: ArrayLike<number>
}

export const enum DataEntryType {
	ActiveMemoryZero,
	Passive,
	Active
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Elements section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export type ElementEntry =
	ActiveTableZeroElementEntry | // 0
	PassiveElementEntry | // 1
	ActiveElementEntry | // 2
	DeclarativeElementEntry | // 3
	ActiveTableZeroWithInstructionsElementEntry | // 4
	PassiveWithInstructionsElementEntry | // 5
	ActiveWithInstructionsElementEntry | // 6
	DeclarativeWithInstructionsElementEntry // 7

export interface ActiveTableZeroElementEntry { // 0
	name: string

	flags: ElementEntryType.ActiveTableZero

	instructions: Instructions
	functionIndexes: ArrayLike<number>
}

export interface PassiveElementEntry { // 1
	name: string

	flags: ElementEntryType.Passive

	functionIndexes: ArrayLike<number>
}

export interface ActiveElementEntry { // 2
	name: string

	flags: ElementEntryType.Active

	tableIndex: number
	instructions: Instructions
	functionIndexes: ArrayLike<number>
}

export interface DeclarativeElementEntry { // 3
	name: string

	flags: ElementEntryType.Declarative

	functionIndexes: ArrayLike<number>
}

export interface ActiveTableZeroWithInstructionsElementEntry { // 4
	name: string

	flags: ElementEntryType.ActiveTableZeroWithInstructions

	instructions: Instructions
	functionInstructions: Instructions
}

export interface PassiveWithInstructionsElementEntry { // 5
	name: string

	flags: ElementEntryType.PassiveWithInstructions

	referenceType: ReferenceType
	functionInstructions: Instructions
}

export interface ActiveWithInstructionsElementEntry { // 6
	name: string

	flags: ElementEntryType.ActiveWithInstructions

	tableIndex: number
	instructions: Instructions
	referenceType: ReferenceType
	functionInstructions: Instructions
}

export interface DeclarativeWithInstructionsElementEntry { // 7
	name: string

	flags: ElementEntryType.DeclarativeWithInstructions

	referenceType: ReferenceType
	functionInstructions: Instructions
}

export const enum ElementEntryType {
	ActiveTableZero,
	Passive,
	Active,
	Declarative,
	ActiveTableZeroWithInstructions,
	PassiveWithInstructions,
	ActiveWithInstructions,
	DeclarativeWithInstructions,
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Instruction types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export type Instructions = (Instruction | Instructions)[]

export interface Instruction {
	opcodeName: OpcodeName
	args: any[]

	immediatesEmitter?: ImmediatesEmitterFunc
}

export interface BlockInstruction extends Instruction {
	opcodeName: 'block' | 'loop' | 'if' | 'else' | 'try' | 'catch' | 'catch_all' | 'try_table'
	immediatesEmitter?: ImmediatesEmitterFunc
	blockName: string

	bodyInstructions: Instruction[]
}

function flattenInstructions(instructions: Instructions): Instruction[] {
	let result: Instruction[] = []

	for (const element of instructions) {
		if (Array.isArray(element)) {
			result = [...result, ...flattenInstructions(element)]
		} else {
			result.push(element)
		}
	}

	return result
}

export function isBlockInstruction(instruction: Instruction): instruction is BlockInstruction {
	return Array.isArray((instruction as BlockInstruction).bodyInstructions)
}

// Control-flow opcode categories used by the flattening logic. Frames are label-defining
// blocks; clauses (`else`/`catch`/`catch_all`/`delegate`) belong to a preceding frame.
// Centralising them as predicates (instead of duplicated inline comparisons or one-off sets)
// gives every check a single source of truth that is reused below.
function isIfClauseOpcode(opcodeName: OpcodeName): boolean {
	return opcodeName === 'else'
}

function isCatchClauseOpcode(opcodeName: OpcodeName): boolean {
	return opcodeName === 'catch' || opcodeName === 'catch_all'
}

function isTryContinuationOpcode(opcodeName: OpcodeName): boolean {
	return isCatchClauseOpcode(opcodeName) || opcodeName === 'delegate'
}

function isClauseOpcode(opcodeName: OpcodeName): boolean {
	return isIfClauseOpcode(opcodeName) || isTryContinuationOpcode(opcodeName)
}

function isFrameOpcode(opcodeName: OpcodeName): boolean {
	return opcodeName === 'block' || opcodeName === 'loop' || opcodeName === 'if' || opcodeName === 'try' || opcodeName === 'try_table'
}

function isTryFrameOpcode(opcodeName: OpcodeName): boolean {
	return opcodeName === 'try' || opcodeName === 'try_table'
}

export type ImmediatesEmitterFunc = (emitter: WasmEncoder, context: InstructionContext) => void

export interface InstructionContext {
	functionsLookup: Map<string, number>
	typesLookup: Map<string, number>
	tablesLookup: Map<string, number>
	memoriesLookup: Map<string, number>
	globalsLookup: Map<string, number>
	localsLookup: Map<string, number>
	elementsLookup: Map<string, number>
	dataLookup: Map<string, number>
	tagsLookup: Map<string, number>
	
	blockStack: string[]

	// Stack of *try* block names only (no `if`/`loop`/`block`/`else`/`catch`).
	// `rethrow`/`delegate` reference an enclosing try by name, and their label must
	// count try blocks (excluding the current one), so they resolve against this
	// dedicated stack rather than the full `blockStack`.
	tryBlockStack: string[]
}

export type ImmediateType = number | bigint
