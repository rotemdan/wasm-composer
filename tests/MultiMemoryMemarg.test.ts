import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// memarg encoding tests for load/store instructions targeting a *non-zero* memory.
//
// The spec (binary/instructions.md) encodes a memarg as:
//
//     memarg ::=
//       | n : u32 m : u64                    => (0,       { align n,          offset m })  (if n < 2^6)
//       | n : u32 x : memidx m : u64         => (x,       { align n - 2^6,    offset m })  (if 2^6 <= n < 2^7)
//
// Bit 6 of the alignment field signals that a memory index follows the alignment, before the
// offset. So `i32.load` with align 2 targeting memory 1 must encode as: 0x28, 0x42, 0x01, 0x00.
//
// Without this, load/store instructions can only ever target memory 0, even in modules with
// multiple memories.
//////////////////////////////////////////////////////////////////////////////////////////////////////

const VALUE = 1234567

const wasmModuleDefinition: WasmModuleDefinition = {
	memories: [
		{ name: 'memA', minimum: 1, maximum: 4, export: true },
		{ name: 'memB', minimum: 1, maximum: 4, export: true },
	],
	functions: [
		{
			name: 'storeThenLoad',
			export: true,
			params: {},
			returns: NumberType.i32,
			instructions: [
				Op.i32.const(4), // address in memB
				Op.i32.const(VALUE),
				Op.i32.store(2, 0, 'memB'),
				Op.i32.const(4), // address in memB
				Op.i32.load(2, 0, 'memB'),
			],
		},
		{
			// Reads memory 0 via the *explicit* named form (memidx 0 with the bit-6 flag).
			name: 'readA',
			export: true,
			params: {},
			returns: NumberType.i32,
			instructions: [
				Op.i32.const(4),
				Op.i32.load(2, 0, 'memA'),
			],
		},
		{
			// Reads memory 0 with NO memory name at all: the plain memarg form must be kept.
			name: 'readDefault',
			export: true,
			params: {},
			returns: NumberType.i32,
			instructions: [
				Op.i32.const(0),
				Op.i32.load(2, 0),
			],
		},
	],
}

test('i32.store/i32.load with an explicit memory name target that memory via the memarg bit-6 flag', async () => {
	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// i32.store (0x36) with align 2 | bit 6 = 0x42, memidx 1, offset 0
	expect(containsSubarray(wasmBytes, [0x36, 0x42, 0x01, 0x00])).toEqual(true)

	// i32.load (0x28) with align 2 | bit 6 = 0x42, memidx 1, offset 0
	expect(containsSubarray(wasmBytes, [0x28, 0x42, 0x01, 0x00])).toEqual(true)

	// The store must have landed in memB, not memA
	const stored = (moduleExports.storeThenLoad as Function)()
	expect(stored).toEqual(VALUE)

	// memB holds the value in little-endian at offset 4
	const memB = new Uint8Array((moduleExports.memB as WebAssembly.Memory).buffer)
	expect([...memB.slice(4, 8)]).toEqual([0x87, 0xd6, 0x12, 0x00] /* 1234567 LE */)

	// memA must be untouched
	const readA = (moduleExports.readA as Function)()
	expect(readA).toEqual(0)
})

test('load/store without a memory name keeps the plain memarg form (no bit-6 flag)', async () => {
	const { wasmBytes } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// The default (implicit memory 0) load keeps the plain form when no memory name is given:
	// 0x28, align (2), offset (0) — no 0x40 bit, no memidx immediate.
	expect(containsSubarray(wasmBytes, [0x28, 0x02, 0x00])).toEqual(true)
	// And an explicit-name load of the same instructions must use the bit-6 form with memidx 0.
	expect(containsSubarray(wasmBytes, [0x28, 0x42, 0x00, 0x00])).toEqual(true)
	// A stray memory index must not have been appended in the plain form
	expect(containsSubarray(wasmBytes, [0x28, 0x02, 0x01])).toEqual(false)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
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
