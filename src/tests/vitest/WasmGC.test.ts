import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition, HeapType, ReferenceTypeKind } from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test(`Encodes i31 references and round-trips a value through i31.new / i31.get_s`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'i31RoundTrip',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.ref.i31,        // i31.new: (i32) -> (ref i31)
					Op.i31.get_s,      // (ref i31) -> i32
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const i31RoundTrip = moduleExports.i31RoundTrip as Function

	expect(i31RoundTrip(0)).toEqual(0)
	expect(i31RoundTrip(42)).toEqual(42)
	expect(i31RoundTrip(-12345)).toEqual(-12345)
	expect(i31RoundTrip(1073741823)).toEqual(1073741823) // 2^30 - 1 (largest valid i31)
})

test(`Encodes a struct type, builds an instance with struct.new, and reads fields with struct.get`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'Pair',
				type: {
					fields: [
						{ storageType: NumberType.i32 },
						{ storageType: NumberType.i32 },
					],
				},
			},
		],

		functions: [
			{
				name: 'sumPair',
				export: true,
				params: { x: NumberType.i32, y: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					// Build a Pair { x, y } and add its two fields together.
					Op.local.get('x'),
					Op.local.get('y'),
					Op.struct.new('Pair'),
					Op.struct.get('Pair', 0),

					Op.local.get('x'),
					Op.local.get('y'),
					Op.struct.new('Pair'),
					Op.struct.get('Pair', 1),

					Op.i32.add,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const sumPair = moduleExports.sumPair as Function

	expect(sumPair(10, 20)).toEqual(30)
	expect(sumPair(-3, 100)).toEqual(97)
})

test(`Encodes struct.new_default and reads a zero-initialized field`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'Pair',
				type: {
					fields: [
						{ storageType: NumberType.i32 },
						{ storageType: NumberType.i32 },
					],
				},
			},
		],

		functions: [
			{
				name: 'defaultPairFirstField',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.struct.new_default('Pair'),
					Op.struct.get('Pair', 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const defaultPairFirstField = moduleExports.defaultPairFirstField as Function

	expect(defaultPairFirstField()).toEqual(0)
})

test(`Encodes an array type and reports its length with array.len`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'IntArray',
				type: {
					storageType: NumberType.i32,
					mutable: true,
				},
			},
		],

		functions: [
			{
				name: 'arrayLength',
				export: true,
				params: { length: NumberType.i32, value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					// array.new takes [init, length] on the stack: push the init value first,
					// then the length (top).
					Op.local.get('value'),
					Op.local.get('length'),
					Op.array.new('IntArray'),
					Op.array.len,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const arrayLength = moduleExports.arrayLength as Function

	expect(arrayLength(5, 7)).toEqual(5)
	expect(arrayLength(0, 7)).toEqual(0)
	expect(arrayLength(100, 7)).toEqual(100)
})

test(`Encodes an array type and reads an element with array.get`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'IntArray',
				type: {
					storageType: NumberType.i32,
					mutable: true,
				},
			},
		],

		functions: [
			{
				name: 'arrayFirstElement',
				export: true,
				params: { length: NumberType.i32, value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					// array.new takes [init, length] on the stack.
					Op.local.get('value'),
					Op.local.get('length'),
					Op.array.new('IntArray'),
					Op.i32.const(0),
					Op.array.get('IntArray'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const arrayFirstElement = moduleExports.arrayFirstElement as Function

	expect(arrayFirstElement(5, 7)).toEqual(7)
	expect(arrayFirstElement(3, -42)).toEqual(-42)
})

test(`Encodes array.copy and copies an element between two arrays`, async () => {
	// `IntArray` is the only custom type and there is a single function, so its
	// assigned type index is 1.
	const intArrayTypeIndex = 1

	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'IntArray',
				type: {
					storageType: NumberType.i32,
					mutable: true,
				},
			},
		],

		functions: [
			{
				name: 'copyFirstElement',
				export: true,
				params: { length: NumberType.i32 },
				returns: NumberType.i32,
				locals: {
					dest: { kind: ReferenceTypeKind.LongNonNullableTypeIndex, typeIndex: intArrayTypeIndex },
				},
				instructions: [
					// dest = IntArray(length) filled with 0
					// array.new takes [init, length]: push the init value first, then the length.
					Op.i32.const(0),
					Op.local.get('length'),
					Op.array.new('IntArray'),
					Op.local.set('dest'),

					// array.copy x y has stack type [(ref null x) i32 (ref null y) i32 i32]:
					// dest, d.init, source, s.init, n.
					Op.local.get('dest'),        // (ref null x) dest array
					Op.i32.const(0),             // d.init = 0
					Op.i32.const(99),            // source init value
					Op.local.get('length'),
					Op.array.new('IntArray'),    // (ref null y) source array (filled with 99)
					Op.i32.const(0),             // s.init = 0
					Op.i32.const(1),             // n = 1
					Op.array.copy('IntArray', 'IntArray'),

					// return dest[0], which should now hold 99
					Op.local.get('dest'),
					Op.i32.const(0),
					Op.array.get('IntArray'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const copyFirstElement = moduleExports.copyFirstElement as Function

	expect(copyFirstElement(1)).toEqual(99)
	expect(copyFirstElement(4)).toEqual(99)
})

test(`Encodes ref.null with an abstract GC heap type and ref.is_null`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'nullIsNull',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.ref.null(HeapType.eq),
					Op.ref.is_null,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const nullIsNull = moduleExports.nullIsNull as Function

	expect(nullIsNull()).toEqual(1)
})
