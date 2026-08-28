import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

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

	const { moduleExports, wasmBytes } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

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

