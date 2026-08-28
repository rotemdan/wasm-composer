import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	ReferenceTypeKind,
} from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test('encodes a self-referential (recursive) struct type and builds an instance', async () => {
	// There is a single function, so function types occupy index 0 and the only
	// custom type (`List`) is assigned index 1. The recursive `tail` field references
	// `List` by that absolute index.
	const listTypeIndex = 1

	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'List',
				subtypes: [
					{
						name: 'List',
						final: false,
						type: {
							fields: [
								{ storageType: NumberType.i32 },
								{
									storageType: {
										kind: ReferenceTypeKind.LongNullableTypeIndex,
										typeIndex: listTypeIndex,
									},
									mutable: true,
								},
							],
						},
					},
				],
			},
		],

		functions: [
			{
				name: 'buildAndReadHead',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('value'),
					Op.ref.null('List'),
					Op.struct.new('List'),
					Op.struct.get('List', 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const buildAndReadHead = moduleExports.buildAndReadHead as Function

	expect(buildAndReadHead(42)).toEqual(42)
	expect(buildAndReadHead(-7)).toEqual(-7)
})

test('encodes a subtype that declares a supertype', async () => {
	// One function => custom types start at index 1: `Animal` = 1, `Dog` = 2.
	const animalTypeIndex = 1
	const dogTypeIndex = 2

	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{
				name: 'Animal',
				subtypes: [
					{ name: 'Animal', final: false, type: { fields: [ { storageType: NumberType.i32 } ] } },
				],
			},
			{
				name: 'Dog',
				subtypes: [
					{
						name: 'Dog',
						supertypeIndexes: [animalTypeIndex],
						final: true,
						type: {
							fields: [
								{ storageType: NumberType.i32 },
								{ storageType: NumberType.i32 },
							],
						},
					},
				],
			},
		],

		functions: [
			{
				name: 'makeDog',
				export: true,
				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('a'),
					Op.local.get('b'),
					Op.struct.new('Dog'),
					Op.struct.get('Dog', 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeDog = moduleExports.makeDog as Function

	expect(makeDog(10, 20)).toEqual(10)
	expect(makeDog(99, 1)).toEqual(99)

	// The declared type indices must be disjoint and stable.
	expect(dogTypeIndex).toBeGreaterThan(animalTypeIndex)
})
