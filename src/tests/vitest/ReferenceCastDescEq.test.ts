import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	HeapType,
	ReferenceTypeKind,
	encodeWasmModule,
} from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

// An `(ref null eq)` shorthand.
const eqref = { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } as const

// `ref.cast_desc_eq` (opcode 0xfb23) may be gated behind a runtime flag in some V8
// builds (like `ref.cast_nop`). Detect support so the suite stays green where it's off.
function refCastDescEqSupported(): boolean {
	try {
		const bytes = encodeWasmModule({
			customTypes: [
				{ name: 'Box', type: { fields: [ { storageType: NumberType.i32 } ] } },
			],
			functions: [
				{
					name: 'f',
					export: true,
					params: { value: eqref },
					returns: NumberType.i32,
					instructions: [
						Op.local.get('value'),
						Op.ref.cast_desc_eq('Box', false),
						Op.ref.is_null,
					],
				},
			],
		})
		new WebAssembly.Module(bytes)
		return true
	} catch {
		return false
	}
}
const refCastDescEqEnabled = refCastDescEqSupported()

test('ref.cast_desc_eq emits its heap-type immediate (opcode 0xfb23 immediately followed by the heap type)', () => {
	// Flag-independent check that guards against the regression where ref.cast_desc_eq
	// emitted only the 0xfb23 opcode with no immediate (producing an invalid module).
	const bytes = encodeWasmModule({
		customTypes: [
			{ name: 'Box', type: { fields: [ { storageType: NumberType.i32 } ] } },
		],
		functions: [
			{
				name: 'f',
				export: true,
				params: { value: eqref },
				returns: NumberType.i32,
				// Follow with ref.is_null so the byte after the immediate is the next
				// instruction's opcode (>= 0x80), distinguishing a real immediate from
				// "no immediate emitted at all".
				instructions: [
					Op.local.get('value'),
					Op.ref.cast_desc_eq('Box', false),
					Op.ref.is_null,
				],
			},
		],
	})

	let i = -1
	for (let k = 0; k + 1 < bytes.length; k++) {
		if (bytes[k] === 0xfb && bytes[k + 1] === 0x23) {
			i = k
			break
		}
	}
	expect(i).toBeGreaterThanOrEqual(0)
	// The byte after 0xfb 0x23 must be the start of a LEB128 immediate (< 0x80),
	// not the next instruction's opcode (which would be >= 0x80).
	expect(bytes[i + 2]).toBeLessThan(0x80)
})

test.skipIf(!refCastDescEqEnabled)('ref.cast_desc_eq downcasts by descriptor equality and traps on a mismatch', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'Box', type: { fields: [ { storageType: NumberType.i32 } ] } },
		],
		functions: [
			{
				name: 'makeI31',
				export: true,
				params: { x: NumberType.i32 },
				returns: eqref,
				instructions: [ Op.local.get('x'), Op.ref.i31 ],
			},
			{
				name: 'makeBox',
				export: true,
				params: { x: NumberType.i32 },
				returns: eqref,
				instructions: [ Op.local.get('x'), Op.struct.new('Box') ],
			},
			{
				name: 'castBoxField',
				export: true,
				params: { value: eqref },
				returns: NumberType.i32,
				// Structural downcast to Box; then read field 0.
				instructions: [
					Op.local.get('value'),
					Op.ref.cast_desc_eq('Box', false),
					Op.struct.get('Box', 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeBox = moduleExports.makeBox as Function
	const castBoxField = moduleExports.castBoxField as Function

	// A Box reference is structurally equal to Box, so the cast succeeds.
	expect(castBoxField(makeBox(7))).toEqual(7)
	// An i31 reference is not a Box, so the cast traps.
	expect(() => castBoxField(makeI31(123))).toThrow()
})
