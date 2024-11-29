
import { Op } from "./Ops.js"
import { Timer } from "./utilities/Timer.js"
import { NumberTypeId, WasmModuleDefinition, buildWasmModule } from "./WasmBuilder.js"

const log = console.log

async function test() {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'add',
				export: true,

				params: { num1: NumberTypeId.i32, num2: NumberTypeId.i32 },
				returns: NumberTypeId.i32,

				instructions: [
					// Add the two integers, and leave the result on the stack
					Op.local.get('num1'),
					Op.local.get('num2'),
					Op.i32.add,

					Op.end, // function
				],
			},
			{
				name: 'isGreaterThan',
				export: true,

				params: { num1: NumberTypeId.i32, num2: NumberTypeId.i32 },
				returns: NumberTypeId.i32,

				instructions: [
					// Compare the two integers
					Op.local.get('num1'),
					Op.local.get('num2'),
					Op.i32.gt_s,

					// Check the comparison result
					//
					// `returns: Type.i32` means the type of the value that the `if` block should put
					// on the stack when it ends should be `i32`
					Op.if({ returns: NumberTypeId.i32 }, [
						Op.i32.const(1),
					]),
					Op.else([
						Op.i32.const(0)
					]),
					Op.end, // if

					Op.end, // function
				],
			},
			{
				name: 'add10_KTimes', // Add 10 to the target number k times
				export: true,

				params: { value: NumberTypeId.i32, k: NumberTypeId.i32 },
				returns: NumberTypeId.i32,

				locals: { counter: NumberTypeId.i32 },

				instructions: [
					Op.loop('mainLoop', [
						// Check if the counter is less than k
						Op.local.get('counter'),
						Op.local.get('k'),
						Op.i32.lt_s,

						// If the condition evaluates to true, execute the block
						//
						// No `returns` property here means that the `if` block is not expected
						// to leave anything on the stack
						Op.if([
							// Add 10 to the value
							Op.local.get('value'),
							Op.i32.const(10),
							Op.i32.add,
							Op.local.set('value'),

							// Increment counter
							Op.local.get('counter'),
							Op.i32.const(1),
							Op.i32.add,
							Op.local.set('counter'),

							// Jump to the start of the loop block
							Op.br('mainLoop'),
						]),
						Op.end // if
					]),
					Op.end, // loop

					// Put the value on the stack to return it
					Op.local.get('value'),
					Op.end, // function
				],
			},
		]
	}

	let wasmBytes: Uint8Array

	const timer = new Timer()
	for (let i = 0; i < 10000; i++) {
		wasmBytes = buildWasmModule(wasmModuleDefinition)
	}
	timer.logAndRestart('Build WASM')

	const wasmModuleInstance = await WebAssembly.instantiate(wasmBytes!)

	const moduleExports = wasmModuleInstance.instance.exports
	const result = (moduleExports.add10_KTimes as Function)(10, 7)

	console.log(`Result: ${result}`)
}

test()
