import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition, ReferenceTypeKind } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// `ref.func` auto-declaration tests.
//
// A function referenced by `ref.func` must be "declared" in the module. The encoder generates a
// declarative element segment (flags 0x07) for this. The segment is a vec(expr), so EVERY
// referenced function must be encoded as its own expression, each terminated by `end` (0x0B):
//
//     0x07 et:reftype el*:vec(expr)
//
// With two undeclared targets this must encode as:
//
//     0x07 0x70 0x02 [ref.func 0 + end] [ref.func 1 + end]
//////////////////////////////////////////////////////////////////////////////////////////////////////

test('ref.func declarations for two undeclared functions emit one element expression each', async () => {
	const funcrefType = { kind: ReferenceTypeKind.ShortTypeId, typeId: 0x70 }

	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'callee1',
				returns: NumberType.i32,
				instructions: [Op.i32.const(42)],
			},
			{
				name: 'callee2',
				returns: NumberType.i32,
				instructions: [Op.i32.const(99)],
			},
			{
				name: 'getRef1',
				export: true,
				params: {},
				returns: funcrefType,
				instructions: [Op.ref.func('callee1')],
			},
			{
				name: 'getRef2',
				export: true,
				params: {},
				returns: funcrefType,
				instructions: [Op.ref.func('callee2')],
			},
		],
	}

	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// Byte layout: flags 0x07, reftype 0x70 (funcref), count 0x02, then one expr per function:
	// ref.func 0x00 + end, ref.func 0x01 + end.
	expect(containsSubarray(wasmBytes, [0x07, 0x70, 0x02, 0xD2, 0x00, 0x0B, 0xD2, 0x01, 0x0B])).toEqual(true)

	// The declared functions must be callable through their references.
	expect((moduleExports.getRef1 as Function)()()).toEqual(42)
	expect((moduleExports.getRef2 as Function)()()).toEqual(99)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
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
