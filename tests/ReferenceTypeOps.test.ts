import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	HeapType,
	ReferenceTypeKind,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('select with an explicit result type chooses between the two operands', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'selectValue',
				export: true,
				params: { condition: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(100),
					Op.i32.const(200),
					Op.local.get('condition'),
					// Typed select: (i32, i32, i32) -> i32
					Op.select([NumberType.i32]),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const selectValue = moduleExports.selectValue as Function

	// Per the WASM spec, `select val1 val2 c` returns val2 when c is 0 and val1 otherwise.
	// Per the WASM spec, `select val1 val2 c` returns val2 when c is 0 and val1 otherwise.
	expect(selectValue(0)).toEqual(200)
	expect(selectValue(1)).toEqual(100)
})

test('ref.test distinguishes an i31 reference from other references', async () => {
	// There are two functions, so the only custom type `Box` is assigned index 2.
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'Box', type: { fields: [ { storageType: NumberType.i32 } ] } },
		],

		functions: [
			{
				name: 'i31IsI31',
				export: true,
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(7),
					Op.ref.i31,
					Op.ref.test(HeapType.i31, false),
				],
			},
			{
				name: 'structIsI31',
				export: true,
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.struct.new('Box'),
					Op.ref.test(HeapType.i31, false),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const i31IsI31 = moduleExports.i31IsI31 as Function
	const structIsI31 = moduleExports.structIsI31 as Function

	expect(i31IsI31()).toEqual(1)
	expect(structIsI31()).toEqual(0)
})

test('br_on_cast branches with the narrowed reference when the cast succeeds', async () => {
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
					Op.i32.const(0),
					Op.struct.new('Box'),
				],
			},
			{
				name: 'isI31',
				export: true,
				params: { value: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } },
				returns: NumberType.i32,
				instructions: [
					Op.block({ name: 'ok', returns: { kind: ReferenceTypeKind.LongNonNullableTypeId, typeId: HeapType.i31 } }, [
						Op.local.get('value'),
						// Branch to `ok` (carrying the narrowed (ref i31)) when the value is an i31.
					// type1 is nullable (eqref), matching the `value` parameter's reference type.
					Op.br_on_cast('ok', HeapType.eq, HeapType.i31, true),
						Op.i32.const(0),
						Op.return,
					]),
					Op.drop,
					Op.i32.const(1),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeBox = moduleExports.makeBox as Function
	const isI31 = moduleExports.isI31 as Function

	expect(isI31(makeI31(5))).toEqual(1)
	expect(isI31(makeBox(0))).toEqual(0)
})

test('br_on_cast_fail branches with the original reference when the cast fails', async () => {
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
					Op.i32.const(0),
					Op.struct.new('Box'),
				],
			},
			{
				name: 'isI31',
				export: true,
				params: { value: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } },
				returns: NumberType.i32,
				instructions: [
					Op.block({ name: 'ok', returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.eq } }, [
						Op.local.get('value'),
					// Branch to `ok` (carrying the original (ref null eq)) when the value is NOT an i31.
					// type1 is nullable (eqref), matching the `value` parameter's reference type.
					Op.br_on_cast_fail('ok', HeapType.eq, HeapType.i31, true),
						Op.drop,
						Op.i32.const(1),
						Op.return,
					]),
					Op.drop,
					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeI31 = moduleExports.makeI31 as Function
	const makeBox = moduleExports.makeBox as Function
	const isI31 = moduleExports.isI31 as Function

	expect(isI31(makeI31(5))).toEqual(1)
	expect(isI31(makeBox(0))).toEqual(0)
})
