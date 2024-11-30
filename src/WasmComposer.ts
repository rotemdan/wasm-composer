import { encodeSignedLeb128, encodeUnsignedLeb128 } from './utilities/Leb128Encoder.js'
import { OpcodeName, wasmOpcodes } from './Opcodes.js'
import { encodeUTF8, float32ToBytes, float64ToBytes } from './utilities/Utilities.js'
import { createDynamicNumberArray } from './utilities/DynamicNumberArray.js'
import { DynamicNumericArray } from './utilities/DynamicArray.js'

export { wasmOpcodes } from './Opcodes.js'
export { Op } from './Ops.js'

export function encodeWasmModule(moduleDefinition: WasmModuleDefinition) {
	const encoder = createWasmEncoder()
	encoder.emitModule(moduleDefinition)

	return encoder.bytesAsUint8Array
}

export function createWasmEncoder() {
	return new WasmEncoder()
}

export class WasmEncoder {
	private outputBytes: DynamicNumericArray = createDynamicNumberArray()

	//////////////////////////////////////////////////////////////////////////////////////////////////////
	// Full module emitter
	//////////////////////////////////////////////////////////////////////////////////////////////////////
	emitModule(moduleDefinition: WasmModuleDefinition) {
		// Inititialize
		const functionDefinitions = moduleDefinition.functions ?? []
		const customTypeDefinitions = moduleDefinition.customTypes ?? []
		const importDefinitions = moduleDefinition.imports ?? []
		const tablesDefinitions = moduleDefinition.tables ?? []
		const memoriesDefinitions = moduleDefinition.memories ?? []
		const globalsDefinitions = moduleDefinition.globals ?? []
		const exportsDefinitions: ExportEntry[] = []
		const startDefinition = moduleDefinition.start
		const elementsDefinitions = moduleDefinition.elements ?? []
		const dataDefinitions = moduleDefinition.data ?? []
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

			localsLookup: new Map(),
			blockStack: [],
		}

		// Add functions, table entries, memories and globals that are marked as exported
		// to an exports definition.
		functionDefinitions.forEach((entry, index) => {
			globalInstructionContext.functionsLookup.set(entry.name, index)
			globalInstructionContext.typesLookup.set(entry.name, index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Function,
					index
				})
			}
		})

		customTypeDefinitions.forEach((entry, index) => {
			globalInstructionContext.typesLookup.set(entry.name, functionDefinitions.length + index)
		})

		const functionSignatures = functionDefinitions.map(entry => {
			const paramTypes = Object.values(entry.params)
			const returnTypes = Array.isArray(entry.returns) ? Object.values(entry.returns) : [entry.returns]

			return {
				paramTypes,
				returnTypes
			} as FunctionSignature
		})

		const functionTypes = functionSignatures.map(signature => ({ type: signature } as Subtype))

		tablesDefinitions.forEach((entry, index) => {
			globalInstructionContext.tablesLookup.set(entry.name, index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Table,
					index
				})
			}
		})

		globalsDefinitions.forEach((entry, index) => {
			globalInstructionContext.globalsLookup.set(entry.name, index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Global,
					index
				})
			}
		})

		elementsDefinitions.forEach((entry, index) => {
			globalInstructionContext.elementsLookup.set(entry.name, index)
		})

		memoriesDefinitions.forEach((entry, index) => {
			globalInstructionContext.memoriesLookup.set(entry.name, index)

			if (entry.export) {
				exportsDefinitions.push({
					name: entry.name,
					kind: ExportKind.Memory,
					index
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

		this.emitGlobalsSection(globalsDefinitions, globalInstructionContext)

		this.emitExportsSection(exportsDefinitions)

		if (startDefinition) {
			this.emitStartSection(startDefinition)
		}

		this.emitElementsSection(elementsDefinitions, globalInstructionContext)

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
			if (subtype.final) {
				this.emitByte(0x4f)
			} else {
				this.emitByte(0x50)
			}

			this.emitLengthPrefixedUintArray(subtype.supertypeIndexes)
		}

		this.emitCompositeType(subtype.type)
	}

	emitCompositeType(type: CompositeType) {
		if (isArrayType(type)) {
			this.emitByte(0x5e)
			this.emitStorageType(type.storageType)
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
			sectionEncoder.emitInstructions(entry.instructions, instructionContext)
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
				sectionEncoder.emitInstructions(entry.instructions, instructionContext)
				sectionEncoder.emitLengthPrefixedUintArray(entry.functionIndexes)
			} else if (entry.flags === ElementEntryType.Passive) { // 1
				sectionEncoder.emitByte(elementKind)
				sectionEncoder.emitLengthPrefixedUintArray(entry.functionIndexes)
			} else if (entry.flags === ElementEntryType.Active) { // 2
				sectionEncoder.emitUint(entry.tableIndex)
				sectionEncoder.emitInstructions(entry.instructions, instructionContext)
				sectionEncoder.emitByte(elementKind)
				sectionEncoder.emitLengthPrefixedUintArray(entry.functionIndexes)
			} else if (entry.flags === ElementEntryType.Declarative) { // 3
				sectionEncoder.emitByte(elementKind)
				sectionEncoder.emitLengthPrefixedUintArray(entry.functionIndexes)
			} else if (entry.flags === ElementEntryType.ActiveTableZeroWithInstructions) {  // 4
				sectionEncoder.emitInstructions(entry.instructions, instructionContext)
				sectionEncoder.emitLengthPrefixedInstructionsArray(entry.functionInstructions, instructionContext)
			} else if (entry.flags === ElementEntryType.PassiveWithInstructions) { // 5
				sectionEncoder.emitReferenceType(entry.referenceType)
				sectionEncoder.emitLengthPrefixedInstructionsArray(entry.functionInstructions, instructionContext)
			} else if (entry.flags === ElementEntryType.ActiveWithInstructions) { // 6
				sectionEncoder.emitUint(entry.tableIndex)
				sectionEncoder.emitInstructions(entry.instructions, instructionContext)
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

			const localNames = [...Object.keys(entry.params), ...(Object.keys(entry.locals ?? {}))]

			localNames.forEach((name, index)  => {
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
				sectionEncoder.emitInstructions(entry.instructions, instructionContext)
				sectionEncoder.emitLengthPrefixedBytes(entry.data)
			} else if (entry.flags === DataEntryType.Active) {
				sectionEncoder.emitUint(entry.memoryIndex)
				sectionEncoder.emitInstructions(entry.instructions, instructionContext)
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
	}

	emitInstructions(instructions: Instructions, context: InstructionContext) {
		const flattenedInstructions = flattenInstructions(instructions)

		this.emitFlattenedInstructions(flattenedInstructions, context)
	}

	emitFlattenedInstructions(instructions: Instruction[], context: InstructionContext) {
		for (const instruction of instructions) {
			this.emitInstruction(instruction, context)
		}
	}

	emitInstruction(instruction: Instruction, context: InstructionContext) {
		this.emitBytes(opcodeNameToBytes[instruction.opcodeName])

		if (instruction.immediatesEmitter) {
			instruction.immediatesEmitter(this, context)
		}

		if (isBlockInstruction(instruction)) {
			context = { ...context}

			context.blockStack = [instruction.blockName, ...context.blockStack]

			this.emitInstructions(instruction.bodyInstructions, context)
		}
	}

	emitOpcode(opcode: number) {
		if (opcode <= 0xff) {
			this.emitUint(opcode)
		} else if (opcode <= 0xffff) {
			this.emitUint(opcode >>> 8),
				this.emitUint(opcode & 0xff)
		} else if (opcode <= 0xfffff) {
			this.emitUint(opcode >>> 12)
			this.emitUint(opcode & 0xfff)
		} else {
			throw new Error(`Invalid opcode: ${opcode}`)
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
		if (entry.maximum !== undefined) {
			this.emitByte(1)
			this.emitUint(entry.minimum)
			this.emitUint(entry.maximum)
		} else {
			this.emitByte(0)
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
		const content = encodeUTF8(str)

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
		this.outputBytes.addValue(byte)
	}

	emitBytes(bytes: ArrayLike<number>) {
		this.outputBytes.addValues(bytes)
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

const enum SectionId {
	Custom, Types, Imports, Functions, Tables, Memory, Globals, Exports, Start, Elements, Code, Data, DataCount
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
	Function, Table, Memory, Global
}

export const enum ExportKind {
	Function, Table, Memory, Global
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
	customSections?: CustomSection[]
}

export interface FunctionDefinition {
	name: string
	export?: boolean
	params: FunctionParams
	returns: ValueType | ValueType[]
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

type ImportDescription = FunctionImportEntry | TableImportEntry | MemoryImportEntry | GlobalImportEntry

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
	minimum: number
	maximum?: number
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
	opcodeName: 'block' | 'loop' | 'if' | 'else'
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
	blockStack: string[]
}

export type ImmediateType = number | bigint
