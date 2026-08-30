import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('return_call_ref tail-calls a function reference produced by ref.func', async () => {
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
				// Push the argument, push a reference to addOne, then tail-call it.
				// `return_call_ref` pops the function reference off the top of the stack
				// and tail-calls it, so `run` returns whatever `addOne` returns.
				instructions: [
					Op.local.get('x'),
					Op.ref.func('addOne'),
					Op.return_call_ref('addOne'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const run = moduleExports.run as Function

	expect(run(41)).toEqual(42)
	expect(run(-5)).toEqual(-4)
})
