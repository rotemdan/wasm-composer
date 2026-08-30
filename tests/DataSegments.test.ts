import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition, DataEntryType } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('an active data segment initializes memory zero and its bytes are readable', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		data: [
			{
				name: 'greeting',
				flags: DataEntryType.ActiveMemoryZero,
				instructions: [Op.i32.const(0)],
				data: [0xDE, 0xAD, 0xBE, 0xEF],
			},
		],
		functions: [
			{
				name: 'firstByte',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.i32.load8_u(0, 0),
				],
			},
			{
				name: 'lastByte',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(3),
					Op.i32.load8_u(0, 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const firstByte = moduleExports.firstByte as Function
	const lastByte = moduleExports.lastByte as Function

	expect(firstByte()).toEqual(0xDE)
	expect(lastByte()).toEqual(0xEF)
})

test('an active data segment with an offset expression lands at the right address', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		data: [
			{
				name: 'payload',
				flags: DataEntryType.ActiveMemoryZero,
				instructions: [Op.i32.const(16)],
				data: [9, 8, 7],
			},
		],
		functions: [
			{
				name: 'readAtOffset',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(16),
					Op.i32.load8_u(0, 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const readAtOffset = moduleExports.readAtOffset as Function

	expect(readAtOffset()).toEqual(9)
})

test('a passive data segment is copied with memory.init and is gone after data.drop', async () => {
	// Passive segments are not placed automatically. `memory.init` copies them into a
	// memory region on demand. Once `data.drop` runs, the segment is emptied and any
	// further `memory.init` of it traps.
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		data: [
			{
				name: 'src',
				flags: DataEntryType.Passive,
				data: [10, 20, 30, 40],
			},
		],
		functions: [
			{
				name: 'copyTo',
				export: true,
				params: { dst: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('dst'),
					Op.i32.const(0), // source offset
					Op.i32.const(4), // length
					Op.memory.init('memory', 'src'),
					Op.local.get('dst'),
					Op.i32.load8_u(0, 0),
				],
			},
			{
				name: 'dropThenInit',
				export: true,
				params: { dst: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.data.drop('src'),
					Op.local.get('dst'),
					Op.i32.const(0),
					Op.i32.const(4),
					// After the drop, copying from `src` must trap.
					Op.memory.init('memory', 'src'),
					Op.local.get('dst'),
					Op.i32.load8_u(0, 0),
				],
			},
		],
	}

	// Instance 1: the segment is still present, so copying works.
	const { moduleExports: first } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const copyTo = first.copyTo as Function
	expect(copyTo(8)).toEqual(10)

	// Instance 2: dropping the segment first makes the subsequent `memory.init` trap.
	const { moduleExports: second } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const dropThenInit = second.dropThenInit as Function
	expect(() => dropThenInit(8)).toThrow()
})
