import { test, expect } from 'vitest'
import {
	encodeWasmModule,
	WasmModuleDefinition,
	NumberType,
	Op,
	ImportKind,
	ElementEntryType,
	DataEntryType,
	ReferenceType,
	ReferenceTypeKind,
	HeapType,
	preamble,
} from '../src/exports/Exports.ts'
import { encodeUnsignedLeb128, encodeSignedLeb128 } from '../src/utilities/Leb128Encoder.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Module-level binary structure tests: preamble, section ordering, LEB128 boundary encodings,
// limits flags, custom sections, and block types encoded as positive s33 type indexes.
//////////////////////////////////////////////////////////////////////////////////////////////////////

const funcrefType: ReferenceType = { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func }

test('an empty module definition encodes to exactly the 8-byte preamble', () => {
	const wasmBytes = encodeWasmModule({})

	expect([...wasmBytes]).toEqual(preamble)
})

test('all module sections appear exactly once, in the spec-mandated order', () => {
	// Section ids per the spec: types(1), import(2), func(3), table(4), memory(5), tag(13),
	// global(6), export(7), start(8), elem(9), datacount(12), code(10), data(11), custom(0*).
	// Note the tag section (13) sits between memory (5) and global (6), and datacount (12)
	// between elements (9) and code (10).
	const allSectionsModule: WasmModuleDefinition = {
		imports: [
			{ moduleName: 'env', importName: 'fn', description: { type: ImportKind.Function, index: 0 } },
		],
		functions: [
			{ name: 'f', export: true, params: {}, instructions: [Op.nop] }, // type (i32... no: (),()) is type index 0
		],
		tables: [
			{ name: 't', referenceType: funcrefType, limits: { minimum: 1 } },
		],
		memories: [
			{ name: 'm', minimum: 1, maximum: 4 },
		],
		customTypes: [
			{ name: 'unitSig', type: { paramTypes: [], returnTypes: [] } },
		],
		tags: [
			{ name: 'e', typeName: 'unitSig' },
		],
		globals: [
			{ name: 'g', type: NumberType.i32, mutable: true, instructions: [Op.i32.const(0)] },
		],
		start: { functionIndex: 1 }, // defined function 'f' (index 1: import occupies index 0)
		elements: [
			{ name: 'el', flags: ElementEntryType.Passive, functionIndexes: [1] },
		],
		data: [
			{ name: 'd', flags: DataEntryType.Passive, data: [1, 2, 3] },
		],
		customSections: [
			{ name: 'meta', content: [0xAB] },
		],
	}

	const wasmBytes = encodeWasmModule(allSectionsModule)

	const sectionIds = getSectionInfos(wasmBytes).map((s) => s.id)

	expect(sectionIds).toEqual([1, 2, 3, 4, 5, 13, 6, 7, 8, 9, 12, 10, 11, 0])

	// Each core section appears exactly once (custom sections may legitimately repeat).
	for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
		expect(sectionIds.filter((x) => x === id).length).toEqual(1)
	}

	// The data count section must carry the number of data segments.
	const dataCount = getSectionInfos(wasmBytes).find((s) => s.id === 12)!
	expect([...dataCount.content]).toEqual([0x01])

	// A module with no data segments must NOT emit a datacount section.
	const noDataBytes = encodeWasmModule({ functions: [{ name: 'f', params: {}, instructions: [Op.nop] }] })
	expect(getSectionInfos(noDataBytes).find((s) => s.id === 12)).toBeUndefined()
})

test('memory limits encode the spec flags: 0x00/0x01 for i32 and 0x04/0x05 for i64 index types', () => {
	const i32MemoryBytes = encodeWasmModule({
		memories: [{ name: 'm', minimum: 1, maximum: 4 }],
	})

	// memory section (id 5): count 0x01, flag 0x01 (min+max), min 0x01, max 0x04
	const i32Content = getSectionInfos(i32MemoryBytes).find((s) => s.id === 5)!
	expect([...i32Content.content]).toEqual([0x01, 0x01, 0x01, 0x04])

	const i64MemoryBytes = encodeWasmModule({
		memories: [
			{ name: 'm64a', minimum: 2n, indexType: 'i64' },
			{ name: 'm64b', minimum: 2n, maximum: 3n, indexType: 'i64' },
		],
	})

	// count 0x02, then flag 0x04 (i64 min), then flag 0x05 (i64 min+max)
	const i64Content = getSectionInfos(i64MemoryBytes).find((s) => s.id === 5)!
	expect([...i64Content.content]).toEqual([0x02, 0x04, 0x02, 0x05, 0x02, 0x03])
})

test('custom section names are UTF-8 encoded (multi-byte characters) with byte-length-prefixed name', () => {
	const wasmBytes = encodeWasmModule({
		functions: [{ name: 'f', params: {}, instructions: [Op.nop] }],
		customSections: [{ name: 'métà-λ', content: [0xAB] }],
	})

	// Custom section: id 0, size, name length (9 bytes), UTF-8 encoded name, content.
	// 'é' -> C3 A9, 'à' -> C3 A0, 'λ' -> CE BB.
	expect(containsSubarray(wasmBytes, [0x09, 0x6D, 0xC3, 0xA9, 0x74, 0xC3, 0xA0, 0x2D, 0xCE, 0xBB, 0xAB])).toEqual(true)
})

test('a block type referencing a named multi-result type is encoded as a positive s33 type index', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'pair', type: { paramTypes: [], returnTypes: [NumberType.i32, NumberType.i32] } },
		],
		functions: [
			{
				name: 'twoVals',
				export: true,
				params: {},
				returns: [NumberType.i32, NumberType.i32],
				instructions: [
					Op.block({ name: 'b', returns: 'pair' }, [
						Op.i32.const(7),
						Op.i32.const(11),
					]),
				],
			},
		],
	}

	const wasmBytes = encodeWasmModule(wasmModuleDefinition)

	// Code body: locals vec 0x00, block 0x02, blocktype = s33 type index 1 -> single byte 0x01,
	// i32.const 7, i32.const 11, block end 0x0B, function end 0x0B.
	// (The s33 encoding is deliberately positive so it cannot collide with the negative-encoded
	// value types; spec: binary/instructions.md "Note" under blocktype.)
	expect(containsSubarray(wasmBytes, [0x00, 0x02, 0x01, 0x41, 0x07, 0x41, 0x0B, 0x0B, 0x0B])).toEqual(true)

	const { instance } = await WebAssembly.instantiate(wasmBytes)

	// Multi-value results surface as a JS array.
	expect((instance.exports.twoVals as Function)()).toEqual([7, 11])
})

test('imported mutable globals are writable via global.set and readable via global.get', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		imports: [
			{
				moduleName: 'env',
				importName: 'counter',
				description: { type: ImportKind.Global, globalType: { type: NumberType.i32, mutable: true } },
			},
		],
		functions: [
			{
				name: 'increment',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.global.get('counter'),
					Op.i32.const(1),
					Op.i32.add,
					Op.global.set('counter'),
					Op.global.get('counter'),
				],
			},
		],
	}

	const wasmBytes = encodeWasmModule(wasmModuleDefinition)

	const importedGlobal = new WebAssembly.Global({ value: 'i32', mutable: true }, 41)

	const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { counter: importedGlobal } })

	expect((instance.exports.increment as Function)()).toEqual(42)
	expect(importedGlobal.value).toEqual(42)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// LEB128 encoder boundary tests (spec: binary/integers.md — uN/sN are range-limited by their
// bit widths and sN by the minimal two's-complement sign bit in the final byte).
//////////////////////////////////////////////////////////////////////////////////////////////////////

test('unsigned LEB128 boundaries encode to the canonical shortest byte form', () => {
	const cases: Array<[number | bigint, number[]]> = [
		[0, [0x00]],
		[1, [0x01]],
		[127, [0x7F]],
		[128, [0x80, 0x01]],
		[16_383, [0xFF, 0x7F]],
		[16_384, [0x80, 0x80, 0x01]],
		[2 ** 21 - 1, [0xFF, 0xFF, 0x7F]],
		[2 ** 21, [0x80, 0x80, 0x80, 0x01]],
		[2 ** 28 - 1, [0xFF, 0xFF, 0xFF, 0x7F]],
		[2 ** 28, [0x80, 0x80, 0x80, 0x80, 0x01]],
		[2 ** 31 - 1, [0xFF, 0xFF, 0xFF, 0xFF, 0x07]],
		[2 ** 32 - 1, [0xFF, 0xFF, 0xFF, 0xFF, 0x0F]],
		[2n ** 64n - 1n, [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01]],
	]

	for (const [value, expected] of cases) {
		expect(encodeUnsignedLeb128(value)).toEqual(expected)
	}
})

test('signed LEB128 boundaries encode with the correct sign bit handling', () => {
	// NOTE: at exact sign boundaries the encoder emits *non-minimal but well-formed* encodings
	// (e.g. -64 as C0 7F instead of the shorter 40). The sN grammar in binary/values.md allows
	// this: "numbers may be encoded as if they had optional leading zeros. Implementations of
	// decoders must support all possible alternatives; implementations of encoders can pick any
	// allowed encoding." The only hard constraint is |encoding| <= ceil(N/7) bytes.
	const cases: Array<[number | bigint, number[]]> = [
		[-1, [0x7F]],
		[63, [0x3F]],
		[64, [0xC0, 0x00]],
		[-64, [0xC0, 0x7F]], // non-minimal (canonical would be 0x40), still well-formed s32
		[-65, [0xBF, 0x7F]],
		[8_191, [0xFF, 0x3F]],
		[-8_192, [0x80, 0xC0, 0x7F]],
		[2 ** 31 - 1, [0xFF, 0xFF, 0xFF, 0xFF, 0x07]],
		[-(2 ** 31), [0x80, 0x80, 0x80, 0x80, 0x78]],
		[2n ** 63n - 1n, [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00]],
		[-(2n ** 63n), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x7F]],
	]

	for (const [value, expected] of cases) {
		expect(encodeSignedLeb128(value)).toEqual(expected)
	}

	// All encodings must respect the maximal byte count ceil(N/7): 5 bytes for s32, 10 for s64.
	expect(encodeSignedLeb128(-(2 ** 31)).length).toBeLessThanOrEqual(5)
	expect(encodeSignedLeb128(-(2n ** 63n)).length).toBeLessThanOrEqual(10)
	expect(encodeSignedLeb128(2n ** 63n - 1n).length).toBeLessThanOrEqual(10)
})

test('i64.const at the full s64 range is decodable by engines (extreme signed LEB encodings)', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'maxI64',
				export: true,
				params: {},
				returns: NumberType.i64,
				instructions: [Op.i64.const(9223372036854775807n)],
			},
			{
				name: 'minI64',
				export: true,
				params: {},
				returns: NumberType.i64,
				instructions: [Op.i64.const(-9223372036854775808n)],
			},
			{
				name: 'maxI32',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [Op.i32.const(2147483647)],
			},
			{
				name: 'minI32',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [Op.i32.const(-2147483648)],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	expect((moduleExports.maxI64 as Function)()).toEqual(9223372036854775807n)
	expect((moduleExports.minI64 as Function)()).toEqual(-9223372036854775808n)
	expect((moduleExports.maxI32 as Function)()).toEqual(2147483647)
	expect((moduleExports.minI32 as Function)()).toEqual(-2147483648)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
interface SectionInfo {
	id: number
	content: Uint8Array
}

function readUnsignedLeb128(bytes: Uint8Array, offset: number): [number, number] {
	let result = 0
	let shift = 0
	let pos = offset

	while (true) {
		const byte = bytes[pos++]

		result += (byte & 0x7f) * 2 ** shift

		if ((byte & 0x80) === 0) {
			return [result, pos]
		}

		shift += 7
	}
}

function getSectionInfos(wasmBytes: Uint8Array): SectionInfo[] {
	// Verify the preamble before parsing.
	expect([...wasmBytes.slice(0, 8)]).toEqual(preamble)

	const sections: SectionInfo[] = []

	let pos = 8

	while (pos < wasmBytes.length) {
		const id = wasmBytes[pos++]

		const [size, contentStart] = readUnsignedLeb128(wasmBytes, pos)

		sections.push({ id, content: wasmBytes.slice(contentStart, contentStart + size) })

		pos = contentStart + size
	}

	return sections
}

function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
	if (needle.length === 0) {
		return true
	}

	if (needle.length > haystack.length) {
		return false
	}

	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) {
				continue outer
			}
		}

		return true
	}

	return false
}
