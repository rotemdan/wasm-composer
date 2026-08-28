import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	HeapType,
	PackedType,
	DataEntryType,
	ElementEntryType,
	ReferenceTypeKind,
} from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test('array.set stores a value that array.get_u reads back', async () => {
	// `ByteArray` is the only custom type and the only function is `storeAndRead`,
	// so its assigned type index is 1.
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'ByteArray',
				type: {
					storageType: PackedType.i8,
					mutable: true,
				},
			},
		],

		functions: [
			{
				name: 'storeAndRead',
				export: true,
				params: { index: NumberType.i32, value: NumberType.i32 },
				returns: NumberType.i32,
				locals: {
					array: {
						kind: ReferenceTypeKind.LongNonNullableTypeIndex,
						typeIndex: 1,
					},
				},
				instructions: [
					// array = ByteArray(length = 4, init = 0)
					Op.i32.const(0),
					Op.i32.const(4),
					Op.array.new('ByteArray'),
					Op.local.set('array'),

					// array[index] = value
					Op.local.get('array'),
					Op.local.get('index'),
					Op.local.get('value'),
					Op.array.set('ByteArray'),

					// return array[index]
					Op.local.get('array'),
					Op.local.get('index'),
					Op.array.get_u('ByteArray'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const storeAndRead = moduleExports.storeAndRead as Function

	expect(storeAndRead(0, 7)).toEqual(7)
	expect(storeAndRead(3, 200)).toEqual(200)
})

test('array.get_u returns the unsigned byte and array.get_s the signed byte', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'ByteArray',
				type: {
					storageType: PackedType.i8,
					mutable: true,
				},
			},
		],

		functions: [
			{
				name: 'readUnsigned',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					// array = ByteArray(length = 1, init = value)
					Op.local.get('value'),
					Op.i32.const(1),
					Op.array.new('ByteArray'),
					Op.i32.const(0),
					Op.array.get_u('ByteArray'),
				],
			},
			{
				name: 'readSigned',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.i32.const(1),
					Op.array.new('ByteArray'),
					Op.i32.const(0),
					Op.array.get_s('ByteArray'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const readUnsigned = moduleExports.readUnsigned as Function
	const readSigned = moduleExports.readSigned as Function

	expect(readUnsigned(0xff)).toEqual(255)
	expect(readSigned(0xff)).toEqual(-1)
})

test('array.new_data initializes an array from a passive data segment', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'ByteArray',
				type: {
					storageType: PackedType.i8,
					mutable: true,
				},
			},
		],

		data: [
			{ name: 'source', flags: DataEntryType.Passive, data: [10, 20, 30, 40, 50, 60] },
		],

		functions: [
			{
				name: 'fromData',
				export: true,
				params: { index: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					// array = ByteArray(6 elements read from 'source' at offset 0)
					Op.i32.const(0),
					Op.i32.const(6),
					Op.array.new_data('ByteArray', 'source'),
					Op.local.get('index'),
					Op.array.get_u('ByteArray'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const fromData = moduleExports.fromData as Function

	expect(fromData(0)).toEqual(10)
	expect(fromData(2)).toEqual(30)
	expect(fromData(5)).toEqual(60)
})

test('array.init_data copies bytes from a data segment into an existing array', async () => {
	// `ByteArray` is the only custom type and `initFromData` is the only function,
	// so its assigned type index is 1.
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'ByteArray',
				type: {
					storageType: PackedType.i8,
					mutable: true,
				},
			},
		],

		data: [
			{ name: 'source', flags: DataEntryType.Passive, data: [10, 20, 30, 40, 50, 60] },
		],

		functions: [
			{
				name: 'initFromData',
				export: true,
				params: { index: NumberType.i32 },
				returns: NumberType.i32,
				locals: {
					array: {
						kind: ReferenceTypeKind.LongNonNullableTypeIndex,
						typeIndex: 1,
					},
				},
				instructions: [
					// array = ByteArray(length = 6, init = 0)
					Op.i32.const(0),
					Op.i32.const(6),
					Op.array.new('ByteArray'),
					Op.local.set('array'),

					// array.init_data: (array, arrayOffset, dataOffset, length)
					Op.local.get('array'),
					Op.i32.const(0),
					Op.i32.const(0),
					Op.i32.const(6),
					Op.array.init_data('ByteArray', 'source'),

					Op.local.get('array'),
					Op.local.get('index'),
					Op.array.get_u('ByteArray'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const initFromData = moduleExports.initFromData as Function

	expect(initFromData(0)).toEqual(10)
	expect(initFromData(3)).toEqual(40)
})

test('array.new_default zero-initializes an array', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'ByteArray',
				type: {
					storageType: PackedType.i8,
					mutable: true,
				},
			},
		],

		functions: [
			{
				name: 'defaultByte',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(3),
					Op.array.new_default('ByteArray'),
					Op.i32.const(0),
					Op.array.get_u('ByteArray'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const defaultByte = moduleExports.defaultByte as Function

	expect(defaultByte()).toEqual(0)
})

test('array.fill writes a value across a range of an array', async () => {
	// `ByteArray` is the only custom type and `fillRange` is the only function,
	// so its assigned type index is 1.
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'ByteArray',
				type: {
					storageType: PackedType.i8,
					mutable: true,
				},
			},
		],

		functions: [
			{
				name: 'fillRange',
				export: true,
				params: {},
				returns: NumberType.i32,
				locals: {
					array: {
						kind: ReferenceTypeKind.LongNonNullableTypeIndex,
						typeIndex: 1,
					},
				},
				instructions: [
					// array = ByteArray(length = 4, init = 0)
					Op.i32.const(0),
					Op.i32.const(4),
					Op.array.new('ByteArray'),
					Op.local.set('array'),

					// array.fill: (array, index, value, length)
					Op.local.get('array'),
					Op.i32.const(1),
					Op.i32.const(0xab),
					Op.i32.const(2),
					Op.array.fill('ByteArray'),

					// return array[2], which should now hold 0xab
					Op.local.get('array'),
					Op.i32.const(2),
					Op.array.get_u('ByteArray'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const fillRange = moduleExports.fillRange as Function

	expect(fillRange()).toEqual(0xab)
})

test('array.new_elem builds a funcref array from an element segment', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'FuncArray',
				type: {
					storageType: {
						kind: ReferenceTypeKind.ShortTypeId,
						typeId: HeapType.func,
					},
					mutable: true,
				},
			},
		],

		elements: [
			{
				name: 'funcElems',
				flags: ElementEntryType.PassiveWithInstructions,
				referenceType: {
					kind: ReferenceTypeKind.ShortTypeId,
					typeId: HeapType.func,
				},
				functionInstructions: [
					Op.ref.func('dummy'),
				],
			},
		],

		functions: [
			{
				name: 'dummy',
				export: true,
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
				],
			},
			{
				name: 'newElem',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// array = FuncArray(1 element copied from 'funcElems' at offset 0)
					Op.i32.const(0),
					Op.i32.const(1),
					Op.array.new_elem('FuncArray', 'funcElems'),
					Op.array.len,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const newElem = moduleExports.newElem as Function

	expect(newElem()).toEqual(1)
})

test('array.init_elem copies funcrefs from an element segment into an existing array', async () => {
	// `dummy` and `initElem` occupy function type indices 0 and 1, so the only
	// custom type `FuncArray` is assigned index 2.
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'FuncArray',
				type: {
					storageType: {
						kind: ReferenceTypeKind.ShortTypeId,
						typeId: HeapType.func,
					},
					mutable: true,
				},
			},
		],

		elements: [
			{
				name: 'funcElems',
				flags: ElementEntryType.PassiveWithInstructions,
				referenceType: {
					kind: ReferenceTypeKind.ShortTypeId,
					typeId: HeapType.func,
				},
				functionInstructions: [
					Op.ref.func('dummy'),
				],
			},
		],

		functions: [
			{
				name: 'dummy',
				export: true,
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
				],
			},
			{
				name: 'initElem',
				export: true,
				params: {},
				returns: NumberType.i32,
				locals: {
					array: {
						kind: ReferenceTypeKind.LongNonNullableTypeIndex,
						typeIndex: 2,
					},
				},
				instructions: [
					// array = FuncArray(length = 1, init = null)
					Op.i32.const(1),
					Op.array.new_default('FuncArray'),
					Op.local.set('array'),

					// array.init_elem: (array, arrayOffset, elemOffset, length)
					Op.local.get('array'),
					Op.i32.const(0),
					Op.i32.const(0),
					Op.i32.const(1),
					Op.array.init_elem('FuncArray', 'funcElems'),

					// the element should now be a non-null funcref (ref.is_null => 0)
					Op.local.get('array'),
					Op.i32.const(0),
					Op.array.get('FuncArray'),
					Op.ref.is_null,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const initElem = moduleExports.initElem as Function

	expect(initElem()).toEqual(0)
})

test('array.new_data with an unknown data segment name throws a descriptive error', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'ByteArray',
				type: {
					storageType: PackedType.i8,
					mutable: true,
				},
			},
		],

		functions: [
			{
				name: 'broken',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.i32.const(1),
					// 'missing' is not a defined data segment name.
					Op.array.new_data('ByteArray', 'missing'),
					Op.i32.const(0),
					Op.array.get_u('ByteArray'),
				],
			},
		],
	}

	await expect(
		encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	).rejects.toThrow(/data entry name 'missing'/)
})
