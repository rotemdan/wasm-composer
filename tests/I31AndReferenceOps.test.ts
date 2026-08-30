import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	HeapType,
	ReferenceTypeKind,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('i31.get_u extracts the unsigned value while i31.get_s extracts the signed value', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'getU',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.ref.i31,
					Op.i31.get_u,
				],
			},
			{
				name: 'getS',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.ref.i31,
					Op.i31.get_s,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const getU = moduleExports.getU as Function
	const getS = moduleExports.getS as Function

	// An i31 is a 31-bit integer: the low 31 bits of the i32 argument form the i31 value.
	// 2147483647 (0x7FFFFFFF) is -1 as a 31-bit signed integer, so a signed extraction
	// yields -1 while an unsigned extraction yields 2147483647.
	expect(getS(2147483647)).toEqual(-1)
	expect(getU(2147483647)).toEqual(2147483647)
	expect(getS(42)).toEqual(42)
	expect(getU(42)).toEqual(42)
})

test('br_on_null branches when the reference is null', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'makeI31',
				export: true,
				params: { x: NumberType.i32 },
				returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq },
				instructions: [ Op.local.get('x'), Op.ref.i31 ],
			},
			{
				name: 'makeNull',
				export: true,
				returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq },
				instructions: [ Op.ref.null(HeapType.eq) ],
			},
			{
				name: 'brOnNull',
				export: true,
				params: { value: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } },
				returns: NumberType.i32,
				instructions: [
					Op.block({ name: 'exit', returns: NumberType.i32 }, [
						Op.block({ name: 'null' }, [
							Op.local.get('value'),
							Op.br_on_null('null'),
							Op.i32.const(1),
							Op.br('exit'),
						]),
						Op.i32.const(0),
					]),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeNull = moduleExports.makeNull as Function
	const brOnNull = moduleExports.brOnNull as Function

	// Non-null reference: `br_on_null` does not branch here, so the function returns 1.
	expect(brOnNull(makeI31(5))).toEqual(1)
	// Null reference (created inside the module via `ref.null`): `br_on_null` branches, returning 0.
	expect(brOnNull(makeNull())).toEqual(0)
})

test('br_on_non_null branches when the reference is non-null', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'makeI31',
				export: true,
				params: { x: NumberType.i32 },
				returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq },
				instructions: [ Op.local.get('x'), Op.ref.i31 ],
			},
			{
				name: 'makeNull',
				export: true,
				returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq },
				instructions: [ Op.ref.null(HeapType.eq) ],
			},
			{
				name: 'brOnNonNull',
				export: true,
				params: { value: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } },
				returns: NumberType.i32,
				instructions: [
					Op.block({ name: 'exit', returns: NumberType.i32 }, [
						Op.block({ name: 'nonnull', returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } }, [
							Op.local.get('value'),
							Op.br_on_non_null('nonnull'),
							Op.i32.const(0),
							Op.br('exit'),
						]),
						// Reached only when the branch was taken (the non-null value is carried here as (ref eq)).
						Op.drop,
						Op.i32.const(1),
					]),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeNull = moduleExports.makeNull as Function
	const brOnNonNull = moduleExports.brOnNonNull as Function

	// Non-null reference: `br_on_non_null` branches (carrying the value), so the function returns 1.
	expect(brOnNonNull(makeI31(5))).toEqual(1)
	// Null reference (created inside the module via `ref.null`): `br_on_non_null` does not branch, returning 0.
	expect(brOnNonNull(makeNull())).toEqual(0)
})

test('ref.cast downcasts a reference to a concrete HeapType and traps on a mismatch', async () => {
	// Three functions => the only custom type `Box` is assigned index 3.
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'Box', type: { fields: [ { storageType: NumberType.i32 } ] } },
		],

		functions: [
			{
				name: 'makeI31',
				export: true,
				params: { x: NumberType.i32 },
				returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq },
				instructions: [
					Op.local.get('x'),
					Op.ref.i31,
				],
			},
			{
				name: 'makeBox',
				export: true,
				params: { x: NumberType.i32 },
				returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq },
				instructions: [
					Op.local.get('x'),
					Op.struct.new('Box'),
				],
			},
			{
				name: 'castI31',
				export: true,
				params: { value: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.ref.cast(HeapType.i31, true),
					Op.i31.get_s,
				],
			},
			{
				name: 'castBoxField',
				export: true,
				params: { value: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.ref.cast('Box', false),
					Op.struct.get('Box', 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeBox = moduleExports.makeBox as Function
	const castI31 = moduleExports.castI31 as Function
	const castBoxField = moduleExports.castBoxField as Function

	// A real downcast from a broad (ref eq) to the concrete (ref i31) / (ref Box).
	expect(castI31(makeI31(123))).toEqual(123)
	expect(castBoxField(makeBox(7))).toEqual(7)

	// Casting to the wrong concrete type must trap.
	expect(() => castI31(makeBox(7))).toThrow()
	expect(() => castBoxField(makeI31(123))).toThrow()
})
