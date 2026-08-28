import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test(`Encodes two memories and reports each one's size via memory.size`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [
			{ name: 'memA', minimum: 1, maximum: 4, export: true },
			{ name: 'memB', minimum: 3, maximum: 8, export: true },
		],

		functions: [
			{
				name: 'sizeA',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.memory.size('memA'),
				],
			},
			{
				name: 'sizeB',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.memory.size('memB'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const sizeA = moduleExports.sizeA as Function
	const sizeB = moduleExports.sizeB as Function

	// Each named memory reports its own minimum page count.
	expect(sizeA()).toEqual(1)
	expect(sizeB()).toEqual(3)
})

test(`Grows only the named memory via memory.grow and leaves the other unchanged`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [
			{ name: 'memA', minimum: 1, maximum: 16, export: true },
			{ name: 'memB', minimum: 2, maximum: 16, export: true },
		],

		functions: [
			{
				name: 'growB',
				export: true,
				params: { pages: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('pages'),
					Op.memory.grow('memB'),
				],
			},
			{
				name: 'sizeA',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.memory.size('memA'),
				],
			},
			{
				name: 'sizeB',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.memory.size('memB'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const growB = moduleExports.growB as Function
	const sizeA = moduleExports.sizeA as Function
	const sizeB = moduleExports.sizeB as Function

	// grow memB by 2 pages; returns the *previous* size (2)
	expect(growB(2)).toEqual(2)
	expect(sizeB()).toEqual(4)

	// memA is a distinct memory and was not affected
	expect(sizeA()).toEqual(1)
})

test(`Keeps two named memories independent: fills both distinctly, copies across, and reads back each region`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [
			{ name: 'memA', minimum: 1, maximum: 4, export: true },
			{ name: 'memB', minimum: 1, maximum: 4, export: true },
		],

		functions: [
			{
				name: 'initAndCopy',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// memA[0..4] = 0x11
					Op.i32.const(0),
					Op.i32.const(0x11),
					Op.i32.const(4),
					Op.memory.fill('memA'),

					// memB[0..4] = 0x22 (a different memory region)
					Op.i32.const(0),
					Op.i32.const(0x22),
					Op.i32.const(4),
					Op.memory.fill('memB'),

					// copy memB[0..4] -> memA[100..104]
					Op.i32.const(100),
					Op.i32.const(0),
					Op.i32.const(4),
					Op.memory.copy('memA', 'memB'),

					// return the byte copied in from memB
					Op.i32.const(100),
					Op.i32.load8_u(0, 0),
				],
			},
			{
				name: 'readMemA0',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// memA[0] should still hold its own 0x11 value
					Op.i32.const(0),
					Op.i32.load8_u(0, 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const initAndCopy = moduleExports.initAndCopy as Function
	const readMemA0 = moduleExports.readMemA0 as Function

	// The byte copied into memA from memB must equal memB's fill value.
	expect(initAndCopy()).toEqual(0x22)

	// And memA's original region is untouched by the fill we aimed at memB.
	expect(readMemA0()).toEqual(0x11)
})

test(`Round-trips a value through load/store on memory 0 and memory.copy across two named memories`, async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [
			{ name: 'memA', minimum: 1, maximum: 4, export: true },
			{ name: 'memB', minimum: 1, maximum: 4, export: true },
		],

		functions: [
			{
				name: 'copyRoundTrip',
				export: true,
				params: { value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					// store value into memA[0] (load/store always target memory index 0)
					Op.i32.const(0),
					Op.local.get('value'),
					Op.i32.store(0, 0),

					// memA -> memB: dest offset 0, src offset 0, size 4
					Op.i32.const(0),
					Op.i32.const(0),
					Op.i32.const(4),
					Op.memory.copy('memB', 'memA'),

					// memB -> memA: dest offset 16, src offset 0, size 4
					Op.i32.const(16),
					Op.i32.const(0),
					Op.i32.const(4),
					Op.memory.copy('memA', 'memB'),

					// load the value back from memA[16]
					Op.i32.const(16),
					Op.i32.load(0, 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const copyRoundTrip = moduleExports.copyRoundTrip as Function

	expect(copyRoundTrip(12345)).toEqual(12345)
	expect(copyRoundTrip(-1)).toEqual(-1)
	expect(copyRoundTrip(0)).toEqual(0)
})
