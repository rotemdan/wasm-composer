import { test, expect } from 'vitest'
import { encodeWasmModule, NumberType, Op, WasmModuleDefinition } from '../../exports/Exports.js'

test('Encodes a WASM module with a single "add" function and executes it correctly', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'add',
				export: true,

				params: { num1: NumberType.i32, num2: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					// Add the two integers, and leave the result on the stack
					Op.local.get('num1'),
					Op.local.get('num2'),
					Op.i32.add,
				],
			}
		]
	}

	const { moduleExports } = await encodeAndInstntiateWasmModuleDefinition(wasmModuleDefinition)

	const add = moduleExports.add as Function

	expect(add(10, 7)).toEqual(10 + 7)
	expect(add(-53, 13)).toEqual(-53 + 13)
})

test('Encodes a WASM module with a single "isGreaterThan" function and executes it correctly', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'isGreaterThan',
				export: true,

				params: { num1: NumberType.i32, num2: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					// Compare the two integers
					Op.local.get('num1'),
					Op.local.get('num2'),
					Op.i32.gt_s,

					// Check the comparison result
					//
					// `returns: Type.i32` means the type of the value that the `if` block should put
					// on the stack when it ends should be `i32`
					Op.if({ returns: NumberType.i32 }, [
						Op.i32.const(1),
					]),
					Op.else([
						Op.i32.const(0)
					]),
				],
			},
		]
	}

	const { moduleExports } = await encodeAndInstntiateWasmModuleDefinition(wasmModuleDefinition)

	const isGreaterThan = moduleExports.isGreaterThan as Function

	expect(isGreaterThan(1234, 1111)).toEqual(1)
	expect(isGreaterThan(1111, 1234)).toEqual(0)
})

test('Encodes a WASM module with a single "add10_KTimes" function and executes it correctly', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'add10_KTimes', // Add 10 to the target number k times
				export: true,

				params: { value: NumberType.i32, k: NumberType.i32 },
				returns: NumberType.i32,

				locals: { counter: NumberType.i32 },

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
					]),

					// Put the value on the stack to return it
					Op.local.get('value'),
				],
			},
		]
	}

	const { moduleExports } = await encodeAndInstntiateWasmModuleDefinition(wasmModuleDefinition)

	const add10_KTimes = moduleExports.add10_KTimes as Function

	expect(add10_KTimes(31, 5)).toEqual(31 + (10 * 5))
	expect(add10_KTimes(-56, 22)).toEqual(-56 + (10 * 22))
})

test('Encodes a Memory64 module, round-trips a 64-bit memarg offset, and returns i64 from memory.size', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		// `indexType: 'i64'` + `bigint` limits declare a memory64 memory.
		memories: [
			{
				name: 'mem',
				indexType: 'i64',
				minimum: 1n,
				maximum: 4n,
				export: true,
			},
		],

		functions: [
			{
				name: 'storeAndLoad',
				export: true,

				// `address` is i64 (the memory64 address on the stack).
				params: { address: NumberType.i64, value: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.local.get('address'),
					Op.local.get('value'),
					// 64-bit offset immediate (bigint) => memory64 memarg encoding.
					Op.i32.store(0, 8n),

					Op.local.get('address'),
					Op.i32.load(0, 8n),
				],
			},

			{
				name: 'memorySizeInPages',
				export: true,

				params: {},
				// For memory64, `memory.size` returns i64.
				returns: NumberType.i64,

				instructions: [
					Op.memory.size('mem'),
				],
			},
		],
	}

	const { moduleExports, wasmBytes } = await encodeAndInstntiateWasmModuleDefinition(wasmModuleDefinition)

	const storeAndLoad = moduleExports.storeAndLoad as Function
	const memorySizeInPages = moduleExports.memorySizeInPages as Function

	// 1 page = 65536 bytes; 8n offset keeps us inside the single page.
	const address = 1024n

	expect(storeAndLoad(address, 42)).toEqual(42)
	expect(storeAndLoad(address, -7)).toEqual(-7)
	expect(storeAndLoad(address, 0)).toEqual(0)

	// memory64 => memory.size yields an i64 page count (BigInt).
	expect(memorySizeInPages()).toEqual(1n)

	// Sanity check on the produced module size (non-empty, valid encoding).
	expect(wasmBytes.length).toBeGreaterThan(0)
})

async function encodeAndInstntiateWasmModuleDefinition(wasmModuleDefinition: WasmModuleDefinition) {
	const wasmBytes = encodeWasmModule(wasmModuleDefinition)

	const wasmModuleInstance = await WebAssembly.instantiate(wasmBytes)

	const moduleExports = wasmModuleInstance.instance.exports

	return { wasmBytes, wasmModuleInstance, moduleExports }
}
