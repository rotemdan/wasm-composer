import { describe, expect, test } from 'vitest'
import { Op, NumberType, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

function containsSubarray(haystack: number[], needle: number[]): boolean {
	for (let i = 0; i <= haystack.length - needle.length; i++) {
		if (needle.every((byte, index) => haystack[i + index] === byte)) return true
	}
	return false
}

describe('large type indices (>= 64)', () => {
	// With two defined functions, the types section holds one signature type per function
	// (indices 0 and 1) followed by the custom types in order, so 'Big' lands at index 66.
	// A concrete heap type is encoded as a positive s33 (0xC2 0x00 for 66), while
	// typeidx immediates (struct.new / struct.get) use plain u32 (0x42 for 66).
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			...Array.from({ length: 64 }, (_, index) => ({
				name: `Filler${index}`,
				type: { fields: [] as [] },
			})),
			{
				name: 'Big',
				type: { fields: [{ storageType: NumberType.i32, mutable: true }] },
			},
		],

		functions: [
			{
				name: 'isNullBig',
				export: true,
				returns: NumberType.i32,
				instructions: [Op.ref.null('Big'), Op.ref.is_null],
			},
			{
				name: 'roundTripBig',
				export: true,
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(5),
					Op.struct.new('Big'),
					Op.ref.cast('Big'),
					Op.struct.get('Big', 0),
				],
			},
		],
	}

	test('heaptype s33 and typeidx u32 encodings are correct for index 66', async () => {
		const { wasmBytes } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		const bytes = Array.from(wasmBytes)

		// ref.null is 0xD0 followed by the heap type: s33 encoding of 66 is [0xC2, 0x00];
		// ref.is_null is 0xD1.
		expect(containsSubarray(bytes, [0xD0, 0xC2, 0x00, 0xD1])).toBe(true)
		// struct.new is 0xFB 0x00 followed by u32 typeidx 66 = 0x42.
		expect(containsSubarray(bytes, [0xFB, 0x00, 0x42])).toBe(true)
		// ref.cast (ref ht) is 0xFB 0x16 followed by the s33 heap type [0xC2, 0x00].
		expect(containsSubarray(bytes, [0xFB, 0x16, 0xC2, 0x00])).toBe(true)
		// struct.get is 0xFB 0x02 followed by u32 typeidx 0x42 and fieldidx 0x00.
		expect(containsSubarray(bytes, [0xFB, 0x02, 0x42, 0x00])).toBe(true)
	})

	test('values round-trip through struct.new/ref.cast/struct.get at large type index', async () => {
		const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

		expect((moduleExports as any).isNullBig()).toEqual(1)
		expect((moduleExports as any).roundTripBig()).toEqual(5)
	})
})
