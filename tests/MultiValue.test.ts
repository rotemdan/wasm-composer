import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('Function returning multiple values computes several outputs', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'addSub',
				export: true,

				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: [NumberType.i32, NumberType.i32],

				instructions: [
					// Leave [a + b, a - b] on the stack as the two results.
					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.add,

					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.sub,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const addSub = moduleExports.addSub as Function

	expect(addSub(10, 3)).toEqual([13, 7])
	expect(addSub(-4, 9)).toEqual([5, -13])
})

test('divmod returns quotient and remainder as multiple values', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'divmod',
				export: true,

				params: { n: NumberType.i32, d: NumberType.i32 },
				returns: [NumberType.i32, NumberType.i32],

				instructions: [
					// Leave [n / d, n % d] on the stack as the two results.
					Op.local.get('n'),
					Op.local.get('d'),
					Op.i32.div_s,

					Op.local.get('n'),
					Op.local.get('d'),
					Op.i32.rem_s,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const divmod = moduleExports.divmod as Function

	expect(divmod(17, 5)).toEqual([3, 2])
	expect(divmod(20, 4)).toEqual([5, 0])
	expect(divmod(-17, 5)).toEqual([-3, -2])
})

test('if block produces multiple results', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [TWO_I32],

		functions: [
			{
				name: 'minMax',
				export: true,

				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: [NumberType.i32, NumberType.i32],

				instructions: [
					// Leave [min(a, b), max(a, b)] on the stack as the two results.
					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.lt_s,

					Op.if({ returns: 'TwoI32' }, [
						Op.local.get('a'),
						Op.local.get('b'),
					]),
					Op.else([
						Op.local.get('b'),
						Op.local.get('a'),
					]),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const minMax = moduleExports.minMax as Function

	expect(minMax(3, 7)).toEqual([3, 7])
	expect(minMax(9, 2)).toEqual([2, 9])
	expect(minMax(-5, -5)).toEqual([-5, -5])
})

test('loop produces multiple results (divmod by repeated subtraction)', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [TWO_I32, QR],

		functions: [
			{
				name: 'divmodLoop',
				export: true,

				params: { dividend: NumberType.i32, divisor: NumberType.i32 },
				returns: [NumberType.i32, NumberType.i32],

				locals: { q: NumberType.i32, r: NumberType.i32 },

				instructions: [
					// Seed the loop with [q = 0, r = dividend].
					Op.i32.const(0),
					Op.local.get('dividend'),

					Op.loop({ name: 'qrLoop', returns: 'QR' }, [
						// Capture the loop's [q, r] parameters into locals.
						Op.local.set('r'),
						Op.local.set('q'),

						// Keep going while r >= divisor (stop as soon as r < divisor).
						Op.local.get('r'),
						Op.local.get('divisor'),
						Op.i32.lt_u,

						Op.if({ returns: 'TwoI32' }, [
							// Done: leave [q, r] on the stack so the loop (and function) returns it.
							Op.local.get('q'),
							Op.local.get('r'),
						]),
						Op.else([
							// r = r - divisor; q = q + 1; branch back with the fresh [q, r].
							Op.local.get('q'),
							Op.i32.const(1),
							Op.i32.add,

							Op.local.get('r'),
							Op.local.get('divisor'),
							Op.i32.sub,

							Op.br('qrLoop'),
						]),
					]),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const divmodLoop = moduleExports.divmodLoop as Function

	expect(divmodLoop(17, 5)).toEqual([3, 2])
	expect(divmodLoop(20, 4)).toEqual([5, 0])
	expect(divmodLoop(7, 7)).toEqual([1, 0])
	expect(divmodLoop(3, 10)).toEqual([0, 3])
})

test('Arithmetic with carry returns result and carry flag', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'addWithCarry',
				export: true,

				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: [NumberType.i32, NumberType.i32],

				instructions: [
					// sum = a + b
					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.add,

					// carry = (sum < a) under unsigned comparison, i.e. unsigned overflow.
					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.add,
					Op.local.get('a'),
					Op.i32.lt_u,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const addWithCarry = moduleExports.addWithCarry as Function

	expect(addWithCarry(5, 7)).toEqual([12, 0])
	expect(addWithCarry(10, 20)).toEqual([30, 0])
	expect(addWithCarry(0xFFFFFFFF, 1)).toEqual([0, 1])
	expect(addWithCarry(0x80000000, 0x80000000)).toEqual([0, 1])
})

test('block produces multiple results', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [TWO_I32],

		functions: [
			{
				name: 'doubleAndIncrement',
				export: true,

				params: { x: NumberType.i32 },
				returns: [NumberType.i32, NumberType.i32],

				instructions: [
					Op.block({ name: 'dbl', returns: 'TwoI32' }, [
						// Leave [x * 2, x + 1] on the stack as the two results.
						Op.local.get('x'),
						Op.i32.const(2),
						Op.i32.mul,

						Op.local.get('x'),
						Op.i32.const(1),
						Op.i32.add,
					]),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const doubleAndIncrement = moduleExports.doubleAndIncrement as Function

	expect(doubleAndIncrement(10)).toEqual([20, 11])
	expect(doubleAndIncrement(0)).toEqual([0, 1])
})

test('Function returns three values', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'threeValues',
				export: true,

				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: [NumberType.i32, NumberType.i32, NumberType.i32],

				instructions: [
					// Leave [a, b, a + b] on the stack as the three results.
					Op.local.get('a'),
					Op.local.get('b'),

					Op.local.get('a'),
					Op.local.get('b'),
					Op.i32.add,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const threeValues = moduleExports.threeValues as Function

	expect(threeValues(3, 4)).toEqual([3, 4, 7])
	expect(threeValues(-1, 1)).toEqual([-1, 1, 0])
})

test('Function returns mixed result types (i32 and i64)', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'mixedReturns',
				export: true,

				params: { a: NumberType.i32, b: NumberType.i64 },
				returns: [NumberType.i32, NumberType.i64],

				instructions: [
					Op.local.get('a'),
					Op.local.get('b'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const mixedReturns = moduleExports.mixedReturns as Function

	expect(mixedReturns(42, 100n)).toEqual([42, 100n])
	expect(mixedReturns(-1, 0n)).toEqual([-1, 0n])
})

////////////////////////////////////////////////////////////////////////////////////////////////
// Shared function-type fixtures used above as the result type of multi-value
// instructions (if/block/loop). Kept at the bottom alongside the other helpers.
////////////////////////////////////////////////////////////////////////////////////////////////

// A function type with no parameters and two i32 results. Used as the result
// type of `if`/`block` instructions that need to produce multiple values.
const TWO_I32 = {
	name: 'TwoI32',
	type: {
		paramTypes: [] as NumberType[],
		returnTypes: [NumberType.i32, NumberType.i32],
	},
}

// A function type with two i32 parameters *and* two i32 results. Used as the
// result type of a `loop` whose body threads (quotient, remainder) through its
// label so that branching back to the loop supplies fresh inputs.
const QR = {
	name: 'QR',
	type: {
		paramTypes: [NumberType.i32, NumberType.i32],
		returnTypes: [NumberType.i32, NumberType.i32],
	},
}
