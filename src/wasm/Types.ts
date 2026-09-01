import { OpcodeName } from './Opcodes.js'
import { WasmEncoder } from './WasmEncoder.js'

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

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Function definitions types
//////////////////////////////////////////////////////////////////////////////////////////////////////
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
// Imports section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface ImportEntry {
	moduleName: string
	importName: string
	description: ImportDescription
}

export type ImportDescription = FunctionImportEntry | TableImportEntry | MemoryImportEntry | GlobalImportEntry | TagImportEntry

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
// Memories section types
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
// Start section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface StartEntry {
	functionIndex: number
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
// Tags section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface TagEntry {
	name: string
	typeName: string
	export?: boolean
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Custom section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface CustomSection {
	name: string
	content: ArrayLike<number>
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
// Types section types
//////////////////////////////////////////////////////////////////////////////////////////////////////
export interface ForwardReferenceGroup {
	firstEntry: number
	entryCount: number
	subtypeCount: number
}

export interface TypeEntryLayout {
	start: number
	subtypeCount: number
	entryIndex: number
	subtypes: Subtype[]
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

//////////////////////////////////////////////////////////////////////////////////////////////////////
// General constants and enumerations
//////////////////////////////////////////////////////////////////////////////////////////////////////
export const preamble = [
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
