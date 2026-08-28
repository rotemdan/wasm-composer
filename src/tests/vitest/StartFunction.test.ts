import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test('a start function runs at instantiation and its side effects are observable before any export is called', async () => {
	// A start function seeds a mutable global during instantiation. The global is then
	// observable through an exported getter without ever calling the seeding function.
	const wasmModuleDefinition: WasmModuleDefinition = {
		globals: [
			{
				name: 'seed',
				type: NumberType.i32,
				mutable: true,
				instructions: [Op.i32.const(0)],
			},
		],
		functions: [
			{
				name: 'initialize',
				params: {},
				returns: [],
				instructions: [
					Op.i32.const(1337),
					Op.global.set('seed'),
				],
			},
			{
				name: 'getValue',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.global.get('seed'),
				],
			},
		],
		start: { functionIndex: 0 },
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const getValue = moduleExports.getValue as Function

	// The start function (index 0) ran during `instantiate`, so the seed is already set.
	expect(getValue()).toEqual(1337)
})

test('a start function can pre-compute a value that an exported function consumes', async () => {
	// The start function populates a lookup table (here modeled as a global accumulator);
	// the exported function then relies on that pre-computed state.
	const wasmModuleDefinition: WasmModuleDefinition = {
		globals: [
			{
				name: 'accumulator',
				type: NumberType.i32,
				mutable: true,
				instructions: [Op.i32.const(0)],
			},
		],
		functions: [
			{
				name: 'seedTable',
				params: {},
				returns: [],
				instructions: [
					// accumulator = 1 + 2 + 3 + 4 = 10
					Op.i32.const(1),
					Op.i32.const(2),
					Op.i32.add,
					Op.i32.const(3),
					Op.i32.add,
					Op.i32.const(4),
					Op.i32.add,
					Op.global.set('accumulator'),
				],
			},
			{
				name: 'total',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.global.get('accumulator'),
				],
			},
		],
		start: { functionIndex: 0 },
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const total = moduleExports.total as Function

	expect(total()).toEqual(10)
})
