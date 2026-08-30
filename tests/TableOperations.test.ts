import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	HeapType,
	ReferenceTypeKind,
	WasmModuleDefinition,
	ElementEntryType,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('table.size, table.get + call_ref, and table.set exercise a funcref table', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		tables: [
			{
				name: 't',
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				limits: { minimum: 3 },
			},
		],
		functions: [
			{
				name: 'answer',
				params: {},
				returns: NumberType.i32,
				instructions: [Op.i32.const(42)],
			},
			{
				name: 'getSize',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [Op.table.size('t')],
			},
			{
				name: 'callSlot',
				export: true,
				params: { i: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('i'),
					Op.table.get('t'),
					Op.ref.cast('answer', true),
					Op.call_ref('answer'),
				],
			},
			{
				name: 'storeAndCall',
				export: true,
				params: { i: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('i'),
					Op.ref.func('answer'),
					Op.table.set('t'),
					Op.local.get('i'),
					Op.call_indirect('answer', 't'),
				],
			},
		],
		elements: [
			{
				name: 'e0',
				flags: ElementEntryType.ActiveTableZero,
				instructions: [Op.i32.const(0)],
				functionIndexes: [0], // function index 0 is `answer`
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const getSize = moduleExports.getSize as Function
	const callSlot = moduleExports.callSlot as Function
	const storeAndCall = moduleExports.storeAndCall as Function

	expect(getSize()).toEqual(3)
	expect(callSlot(0)).toEqual(42)

	// Overwrite slot 1 with `answer` (via table.set) and read it back.
	expect(storeAndCall(1)).toEqual(42)
})

test('table.grow, table.fill and elem.drop operate on a funcref table', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		tables: [
			{
				name: 't',
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				limits: { minimum: 2, maximum: 10 },
			},
		],
		functions: [
			{
				name: 'answer',
				params: {},
				returns: NumberType.i32,
				instructions: [Op.i32.const(7)],
			},
			{
				name: 'growByOne',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.ref.func('answer'),
					Op.i32.const(1),
					Op.table.grow('t'), // returns previous size
				],
			},
			{
				name: 'fillAndCall',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.ref.func('answer'),
					Op.i32.const(2),
					Op.table.fill('t'),
					Op.i32.const(0),
					Op.table.get('t'),
					Op.ref.cast('answer', true),
					Op.call_ref('answer'),
				],
			},
			{
				name: 'dropSegmentThenSize',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.elem.drop('e0'),
					Op.table.size('t'),
				],
			},
		],
		elements: [
			{
				name: 'e0',
				flags: ElementEntryType.ActiveTableZero,
				instructions: [Op.i32.const(0)],
				functionIndexes: [0],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const growByOne = moduleExports.growByOne as Function
	const fillAndCall = moduleExports.fillAndCall as Function
	const dropSegmentThenSize = moduleExports.dropSegmentThenSize as Function

	// `dropSegmentThenSize` does not change the table size, so call it before `growByOne`
	// (which mutates the live instance) to keep the expected size stable at the minimum.
	expect(dropSegmentThenSize()).toEqual(2)
	expect(growByOne()).toEqual(2)
	expect(fillAndCall()).toEqual(7)
})

test('table.copy duplicates a function reference from one table into another', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		tables: [
			{
				name: 'srcTable',
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				limits: { minimum: 1 },
			},
			{
				name: 'dstTable',
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				limits: { minimum: 1 },
			},
		],
		functions: [
			{
				name: 'answer',
				params: {},
				returns: NumberType.i32,
				instructions: [Op.i32.const(99)],
			},
			{
				name: 'copyAndCall',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0), // destination index
					Op.i32.const(0), // source index
					Op.i32.const(1), // length
					Op.table.copy('srcTable', 'dstTable'),
					Op.i32.const(0),
					Op.call_indirect('answer', 'dstTable'),
				],
			},
		],
		elements: [
			{
				name: 'es',
				flags: ElementEntryType.ActiveTableZero,
				instructions: [Op.i32.const(0)],
				functionIndexes: [0], // lands in table 0 (srcTable)
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const copyAndCall = moduleExports.copyAndCall as Function

	expect(copyAndCall()).toEqual(99)
})
