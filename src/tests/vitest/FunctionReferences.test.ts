import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	HeapType,
	ReferenceTypeKind,
	WasmModuleDefinition,
	ElementEntryType,
} from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test('call_ref invokes a function reference produced by ref.func', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'addOne',
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.i32.const(1),
					Op.i32.add,
				],
			},
			{
				name: 'run',
				export: true,
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.ref.func('addOne'),
					Op.call_ref('addOne'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const run = moduleExports.run as Function

	expect(run(41)).toEqual(42)
	expect(run(-5)).toEqual(-4)
})

test('call_ref invokes a function reference fetched from a table', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		tables: [
			{
				name: 'fns',
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				limits: { minimum: 1 },
			},
		],
		functions: [
			{
				name: 'addOne',
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.i32.const(1),
					Op.i32.add,
				],
			},
			{
				name: 'run',
				export: true,
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.i32.const(0),
					Op.table.get('fns'),
					// `table.get` yields a generic `funcref`; narrow it to the concrete
					// function type before `call_ref`, which requires a precise reference.
					Op.ref.cast('addOne', true),
					Op.call_ref('addOne'),
				],
			},
		],
		elements: [
			{
				name: 'e0',
				flags: ElementEntryType.ActiveTableZero,
				instructions: [Op.i32.const(0)],
				functionIndexes: [0], // function index 0 is `addOne`
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const run = moduleExports.run as Function

	expect(run(41)).toEqual(42)
	expect(run(100)).toEqual(101)
})
