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

test('return_call tail-calls a function with a matching signature', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'callee',
				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.add,
				],
			},
			{
				name: 'caller',
				export: true,
				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('a'),
					Op.local.get('b'),
					Op.return_call('callee'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const caller = moduleExports.caller as Function

	expect(caller(3, 4)).toEqual(7)
	expect(caller(-10, 3)).toEqual(-7)
})

test('return_call_indirect tail-calls through a table', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		tables: [
			{
				name: 't',
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				limits: { minimum: 1 },
			},
		],
		functions: [
			{
				name: 'callee',
				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.add,
				],
			},
			{
				name: 'dispatch',
				export: true,
				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.const(0), // table slot
					Op.return_call_indirect('callee', 't'),
				],
			},
		],
		elements: [
			{
				name: 'e0',
				flags: ElementEntryType.ActiveTableZero,
				instructions: [Op.i32.const(0)],
				functionIndexes: [0], // function index 0 is `callee`
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const dispatch = moduleExports.dispatch as Function

	expect(dispatch(3, 4)).toEqual(7)
	expect(dispatch(20, 22)).toEqual(42)
})
