import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test('memory.copy duplicates a region of linear memory', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'copyRegion',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// Write 0xAB at address 0.
					Op.i32.const(0),
					Op.i32.const(0xAB),
					Op.i32.store8(0, 0),

					// Copy 1 byte from address 0 to address 4.
					Op.i32.const(4), // destination
					Op.i32.const(0), // source
					Op.i32.const(1), // length
					Op.memory.copy('memory', 'memory'),

					// Read back the copied byte at address 4.
					Op.i32.const(4),
					Op.i32.load8_u(0, 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const copyRegion = moduleExports.copyRegion as Function

	expect(copyRegion()).toEqual(0xAB)
})

test('memory.fill sets a run of bytes to a constant value', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'fillRegion',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// Fill addresses 8..11 with 0xEF.
					Op.i32.const(8), // destination
					Op.i32.const(0xEF), // value
					Op.i32.const(4), // length
					Op.memory.fill('memory'),

					// Read back the first filled byte.
					Op.i32.const(8),
					Op.i32.load8_u(0, 0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const fillRegion = moduleExports.fillRegion as Function

	expect(fillRegion()).toEqual(0xEF)
})
