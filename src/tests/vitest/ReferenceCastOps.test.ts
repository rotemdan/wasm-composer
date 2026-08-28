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

// `ref.cast_nop` (opcode 0xfb4c) is gated behind the `--experimental-wasm-ref-cast-nop`
// runtime flag in some V8 builds. Detect support so the suite stays green where it's off
// (the encoder fix is still exercised wherever the flag is enabled).
function refCastNopSupported(): boolean {
	try {
		const bytes = encodeWasmModule({
			functions: [
				{
					name: 'f',
					export: true,
					returns: NumberType.i32,
					instructions: [ Op.ref.null(HeapType.eq), Op.ref.cast_nop(HeapType.eq), Op.ref.is_null ],
				},
			],
		})
		new WebAssembly.Module(bytes)
		return true
	} catch {
		return false
	}
}
const refCastNopEnabled = refCastNopSupported()

// An `(ref null eq)` / `(ref eq)` shorthand used throughout these tests.
const eqref = { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } as const

// Builds a module with shared helpers: makeI31 (an i31 ref), makeNull (a null eqref),
// and makeBox (a struct ref). All references are produced *inside* the module so the
// tests never rely on (flaky) JS null/extern interop.
const withEqHelpers = (extraFunctions: WasmModuleDefinition['functions']): WasmModuleDefinition => ({
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
			name: 'makeNull',
			export: true,
			returns: eqref,
			instructions: [ Op.ref.null(HeapType.eq) ],
		},
		{
			name: 'makeBox',
			export: true,
			params: { x: NumberType.i32 },
			returns: eqref,
			instructions: [ Op.local.get('x'), Op.struct.new('Box') ],
		},
		...(extraFunctions ?? []),
	],
})

test.skipIf(!refCastNopEnabled)('ref.cast_nop performs a non-trapping downcast that yields the narrowed value on success', async () => {
	const wasmModuleDefinition = withEqHelpers([
		{
			name: 'castNopI31',
			export: true,
			params: { value: eqref },
			returns: NumberType.i32,
			// (ref.cast_nop i31) then extract the i31 value.
			instructions: [
				Op.local.get('value'),
				Op.ref.cast_nop(HeapType.i31),
				Op.i31.get_s,
			],
		},
	])

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const castNopI31 = moduleExports.castNopI31 as Function

	// The reference IS an i31, so the downcast succeeds and we recover the value.
	expect(castNopI31(makeI31(123))).toEqual(123)
})

test.skipIf(!refCastNopEnabled)('ref.cast_nop returns null (instead of trapping) when the downcast fails', async () => {
	const wasmModuleDefinition = withEqHelpers([
		{
			name: 'castNopI31IsNull',
			export: true,
			params: { value: eqref },
			returns: NumberType.i32,
			// Non-trapping cast: a Box reference is not an i31, so this yields null.
			instructions: [
				Op.local.get('value'),
				Op.ref.cast_nop(HeapType.i31),
				Op.ref.is_null,
			],
		},
	])

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeBox = moduleExports.makeBox as Function
	const castNopI31IsNull = moduleExports.castNopI31IsNull as Function

	// Failing cast -> null.
	expect(castNopI31IsNull(makeBox(7))).toEqual(1)
	// Succeeding cast -> non-null.
	expect(castNopI31IsNull(makeI31(123))).toEqual(0)
})

test('ref.cast traps on a failed downcast, unlike the non-trapping ref.cast_nop', async () => {
	const wasmModuleDefinition = withEqHelpers([
		{
			name: 'castI31',
			export: true,
			params: { value: eqref },
			returns: NumberType.i32,
			// Trapping cast: a Box reference is not an i31, so this traps.
			instructions: [
				Op.local.get('value'),
				Op.ref.cast(HeapType.i31, false),
				Op.i31.get_s,
			],
		},
	])

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeBox = moduleExports.makeBox as Function
	const castI31 = moduleExports.castI31 as Function

	// Succeeds when the reference genuinely is an i31.
	expect(castI31(makeI31(123))).toEqual(123)
	// Traps when the reference cannot be cast to an i31.
	expect(() => castI31(makeBox(7))).toThrow()
})

test('ref.as_non_null on a GC eqref keeps a non-null reference but traps on null', async () => {
	const wasmModuleDefinition = withEqHelpers([
		{
			name: 'asNonNull',
			export: true,
			params: { value: eqref },
			returns: NumberType.i32,
			instructions: [
				Op.local.get('value'),
				Op.ref.as_non_null,
				Op.ref.is_null,
			],
		},
	])

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeNull = moduleExports.makeNull as Function
	const asNonNull = moduleExports.asNonNull as Function

	// A real i31 reference survives as_non_null and remains non-null.
	expect(asNonNull(makeI31(5))).toEqual(0)
	// A null reference makes as_non_null trap.
	expect(() => asNonNull(makeNull())).toThrow()
})

test('ref.test distinguishes the nullable and non-nullable forms', async () => {
	const wasmModuleDefinition = withEqHelpers([
		{
			name: 'testEqNullable',
			export: true,
			params: { value: eqref },
			returns: NumberType.i32,
			// ref.test (ref null eq): matches eq references AND null.
			instructions: [
				Op.local.get('value'),
				Op.ref.test(HeapType.eq, true),
			],
		},
		{
			name: 'testEqNonNullable',
			export: true,
			params: { value: eqref },
			returns: NumberType.i32,
			// ref.test (ref eq): matches eq references but NOT null.
			instructions: [
				Op.local.get('value'),
				Op.ref.test(HeapType.eq, false),
			],
		},
	])

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeNull = moduleExports.makeNull as Function
	const testEqNullable = moduleExports.testEqNullable as Function
	const testEqNonNullable = moduleExports.testEqNonNullable as Function

	// Both forms match a genuine eq reference (i31 <: eq).
	expect(testEqNullable(makeI31(5))).toEqual(1)
	expect(testEqNonNullable(makeI31(5))).toEqual(1)

	// Only the nullable form matches null.
	expect(testEqNullable(makeNull())).toEqual(1)
	expect(testEqNonNullable(makeNull())).toEqual(0)
})

test('ref.cast_nop emits its heap-type immediate (opcode 0xfb4c immediately followed by the heaptype)', () => {
	// This is a flag-independent check: it inspects the encoded bytes rather than
	// instantiating. It guards against the regression where ref.cast_nop emitted only
	// the 0xfb4c opcode with no heap-type immediate (producing an invalid module).
	const bytes = encodeWasmModule({
		functions: [
			{
				name: 'f',
				export: true,
				params: { value: eqref },
				returns: eqref,
				instructions: [
					Op.local.get('value'),
					Op.ref.cast_nop(HeapType.i31),
				],
			},
		],
	})

	// Locate the subsequence 0xfb 0x4c 0x6c (opcode + i31 heap type).
	let found = false
	for (let i = 0; i + 2 < bytes.length; i++) {
		if (bytes[i] === 0xfb && bytes[i + 1] === 0x4c && bytes[i + 2] === 0x6c) {
			found = true
			break
		}
	}
	expect(found).toBe(true)
})
