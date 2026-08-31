import { describe, expect, test } from 'vitest'
import { Op, NumberType, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

function containsSubarray(haystack: number[], needle: number[]): boolean {
	for (let i = 0; i <= haystack.length - needle.length; i++) {
		if (needle.every((byte, index) => haystack[i + index] === byte)) return true
	}
	return false
}

describe('multi-memory plain memory operations', () => {
	// Spec (binary/instructions.md):
	//   0x3F x:memidx => memory.size x
	//   0x40 x:memidx => memory.grow x
	//   0xFC 10 x1:memidx x2:memidx => memory.copy x1 x2   (x1 = destination, x2 = source)
	//   0xFC 11 x:memidx => memory.fill x
	test('memory.size/grow/fill/copy emit the correct memory index immediates', async () => {
		const wasmModuleDefinition: WasmModuleDefinition = {
			memories: [
				{ name: 'memA', minimum: 1, maximum: 2, export: true },
				{ name: 'memB', minimum: 1, maximum: 2, export: true },
			],
			functions: [
				{
					name: 'sizeA',
					export: true,
					returns: NumberType.i32,
					instructions: [Op.memory.size('memA')],
				},
				{
					name: 'sizeB',
					export: true,
					returns: NumberType.i32,
					instructions: [Op.memory.size('memB')],
				},
				{
					name: 'growB',
					export: true,
					params: { pages: NumberType.i32 },
					returns: NumberType.i32,
					instructions: [Op.local.get('pages'), Op.memory.grow('memB')],
				},
				{
					name: 'fillB',
					export: true,
					params: { destination: NumberType.i32, value: NumberType.i32, count: NumberType.i32 },
					instructions: [
						Op.local.get('destination'),
						Op.local.get('value'),
						Op.local.get('count'),
						Op.memory.fill('memB'),
					],
				},
				{
					name: 'copyAtoB',
					export: true,
					params: { destination: NumberType.i32, source: NumberType.i32, count: NumberType.i32 },
					instructions: [
						Op.local.get('destination'),
						Op.local.get('source'),
						Op.local.get('count'),
						Op.memory.copy('memB', 'memA'),
					],
				},
				{
					name: 'loadB',
					export: true,
					params: { offset: NumberType.i32 },
					returns: NumberType.i32,
					instructions: [Op.local.get('offset'), Op.i32.load8_u(0, 0, 'memB')],
				},
			],
		}

		const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		const bytes = Array.from(wasmBytes)

		// memory.size('memB') -> 0x3F 0x01
		expect(containsSubarray(bytes, [0x3F, 0x01])).toBe(true)
		// memory.grow('memB') -> 0x40 0x01
		expect(containsSubarray(bytes, [0x40, 0x01])).toBe(true)
		// memory.fill('memB') -> 0xFC 0x0B 0x01
		expect(containsSubarray(bytes, [0xFC, 0x0B, 0x01])).toBe(true)
		// memory.copy('memB', 'memA') -> 0xFC 0x0A 0x01 0x00 (dest then source)
		expect(containsSubarray(bytes, [0xFC, 0x0A, 0x01, 0x00])).toBe(true)

		const exports_ = moduleExports as any

		expect(exports_.sizeA()).toEqual(1)
		expect(exports_.sizeB()).toEqual(1)

		// memory.grow on 'memB' must not affect 'memA'.
		expect(exports_.growB(1)).toEqual(1)
		expect(exports_.sizeB()).toEqual(2)
		expect(exports_.sizeA()).toEqual(1)

		// Seed memA offset 100 with a byte, then copy into memB and verify (copy direction: memA source -> memB destination).
		const memA = moduleExports.memA as WebAssembly.Memory
		new Uint8Array(memA.buffer)[100] = 0x5A
		exports_.copyAtoB(0, 100, 1)
		expect(exports_.loadB(0)).toEqual(0x5A)

		// memory.fill on 'memB' must not touch 'memA'.
		exports_.fillB(4, 0x7E, 2)
		expect(Array.from(new Uint8Array((moduleExports.memB as WebAssembly.Memory).buffer).subarray(4, 6))).toEqual([0x7E, 0x7E])
		expect(new Uint8Array(memA.buffer)[100]).toEqual(0x5A)
	})
})
