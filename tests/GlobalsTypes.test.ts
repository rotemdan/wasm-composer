import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('i64, f32 and f64 globals round-trip through get/set', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		globals: [
			{
				name: 'gI64',
				type: NumberType.i64,
				mutable: true,
				instructions: [Op.i64.const(100n)],
			},
			{
				name: 'gF32',
				type: NumberType.f32,
				mutable: false,
				instructions: [Op.f32.const(3.5)],
			},
			{
				name: 'gF64',
				type: NumberType.f64,
				mutable: true,
				instructions: [Op.f64.const(2.25)],
			},
		],
		functions: [
			{
				name: 'readI64',
				export: true,
				params: {},
				returns: NumberType.i64,
				instructions: [Op.global.get('gI64')],
			},
			{
				name: 'readF32',
				export: true,
				params: {},
				returns: NumberType.f32,
				instructions: [Op.global.get('gF32')],
			},
			{
				name: 'readF64',
				export: true,
				params: {},
				returns: NumberType.f64,
				instructions: [Op.global.get('gF64')],
			},
			{
				name: 'addToI64',
				export: true,
				params: { x: NumberType.i64 },
				returns: NumberType.i64,
				instructions: [
					Op.global.get('gI64'),
					Op.local.get('x'),
					Op.i64.add,
					Op.global.set('gI64'),
					Op.global.get('gI64'),
				],
			},
			{
				name: 'scaleF64',
				export: true,
				params: { factor: NumberType.f64 },
				returns: NumberType.f64,
				instructions: [
					Op.global.get('gF64'),
					Op.local.get('factor'),
					Op.f64.mul,
					Op.global.set('gF64'),
					Op.global.get('gF64'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const readI64 = moduleExports.readI64 as Function
	const readF32 = moduleExports.readF32 as Function
	const readF64 = moduleExports.readF64 as Function
	const addToI64 = moduleExports.addToI64 as Function
	const scaleF64 = moduleExports.scaleF64 as Function

	expect(readI64()).toEqual(100n)
	expect(readF32()).toEqual(3.5)
	expect(readF64()).toEqual(2.25)

	expect(addToI64(5n)).toEqual(105n)
	expect(readI64()).toEqual(105n)

	expect(scaleF64(2)).toEqual(4.5)
	expect(readF64()).toEqual(4.5)
})
