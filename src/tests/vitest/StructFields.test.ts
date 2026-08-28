import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	PackedType,
	ReferenceTypeKind,
} from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test('struct.set stores a value that struct.get reads back', async () => {
	// `Pair` is the only custom type and `setAndGetSecond` is the only function,
	// so its assigned type index is 1.
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'Pair',
				type: {
					fields: [
					{ storageType: NumberType.i32, mutable: true },
					{ storageType: NumberType.i32, mutable: true },
				],
			},
			},
		],

		functions: [
			{
				name: 'setAndGetSecond',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				locals: {
					pair: {
						kind: ReferenceTypeKind.LongNonNullableTypeIndex,
						typeIndex: 1,
					},
				},
				instructions: [
					// pair = Pair(0, 0)
					Op.i32.const(0),
					Op.i32.const(0),
					Op.struct.new('Pair'),
					Op.local.set('pair'),

					// pair.field1 = value
					Op.local.get('pair'),
					Op.local.get('value'),
					Op.struct.set('Pair', 1),

					// return pair.field1
					Op.local.get('pair'),
					Op.struct.get('Pair', 1),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const setAndGetSecond = moduleExports.setAndGetSecond as Function

	expect(setAndGetSecond(42)).toEqual(42)
	expect(setAndGetSecond(-7)).toEqual(-7)
})

test('struct.get_u returns the unsigned packed byte and struct.get_s the signed byte', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'ByteCell',
				type: {
					fields: [
						{ storageType: PackedType.i8, mutable: true },
					],
				},
			},
		],

		functions: [
			{
				name: 'readUnsignedI8',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.struct.new('ByteCell'),
					Op.struct.get_u('ByteCell', 0),
				],
			},
			{
				name: 'readSignedI8',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.struct.new('ByteCell'),
					Op.struct.get_s('ByteCell', 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const readUnsignedI8 = moduleExports.readUnsignedI8 as Function
	const readSignedI8 = moduleExports.readSignedI8 as Function

	expect(readUnsignedI8(0xff)).toEqual(255)
	expect(readSignedI8(0xff)).toEqual(-1)
})
