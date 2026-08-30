import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('a mutable i32 global is shared and updated across function calls', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		globals: [
			{
				name: 'counter',
				type: NumberType.i32,
				mutable: true,
				export: true,
				instructions: [Op.i32.const(0)],
			},
		],
		functions: [
			{
				name: 'increment',
				export: true,

				params: { by: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.global.get('counter'),
					Op.local.get('by'),
					Op.i32.add,
					Op.global.set('counter'),
					Op.global.get('counter'),
				],
			},
			{
				name: 'getCounter',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [
					Op.global.get('counter'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const increment = moduleExports.increment as Function
	const getCounter = moduleExports.getCounter as Function

	expect(getCounter()).toEqual(0)
	expect(increment(5)).toEqual(5)
	expect(increment(3)).toEqual(8)
	expect(getCounter()).toEqual(8)

	// The exported global is also observable as a WebAssembly.Global.
	const counter = moduleExports.counter as WebAssembly.Global
	expect(counter.value).toEqual(8)
})

test('an immutable f64 global is readable from a function', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		globals: [
			{
				name: 'pi',
				type: NumberType.f64,
				mutable: false,
				instructions: [Op.f64.const(3.14159)],
			},
		],
		functions: [
			{
				name: 'getPi',
				export: true,

				params: {},
				returns: NumberType.f64,

				instructions: [
					Op.global.get('pi'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const getPi = moduleExports.getPi as Function

	expect(getPi()).toBeCloseTo(3.14159)
})

test('an i64 global round-trips a 64-bit value', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		globals: [
			{
				name: 'big',
				type: NumberType.i64,
				mutable: true,
				instructions: [Op.i64.const(123456789012n)],
			},
		],
		functions: [
			{
				name: 'setBig',
				export: true,

				params: { value: NumberType.i64 },
				returns: NumberType.i64,

				instructions: [
					Op.local.get('value'),
					Op.global.set('big'),
					Op.global.get('big'),
				],
			},
			{
				name: 'getBig',
				export: true,

				params: {},
				returns: NumberType.i64,

				instructions: [
					Op.global.get('big'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const setBig = moduleExports.setBig as Function
	const getBig = moduleExports.getBig as Function

	expect(getBig()).toEqual(123456789012n)
	expect(setBig(987654321098n)).toEqual(987654321098n)
	expect(getBig()).toEqual(987654321098n)
})
