import { describe, expect, test } from 'vitest'
import {
	Op,
	NumberType,
	WasmModuleDefinition,
	DataEntryType,
	encodeWasmModule,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

interface SectionInfo {
	id: number
	size: number
	content: number[]
}

// Parses top-level sections (id + size + content bytes) starting after the 8-byte preamble.
function getSectionInfos(wasmBytes: Uint8Array): SectionInfo[] {
	const bytes = Array.from(wasmBytes)
	const sectionInfos: SectionInfo[] = []
	let offset = 8

	while (offset < bytes.length) {
		const id = bytes[offset]
		offset += 1
		let size = 0
		let shift = 0
		while (true) {
			const byte = bytes[offset]
			offset += 1
			size |= (byte & 0x7F) << shift
			if ((byte & 0x80) === 0) break
			shift += 7
		}
		sectionInfos.push({ id, size, content: bytes.slice(offset, offset + size) })
		offset += size
	}

	return sectionInfos
}

function containsSubarray(haystack: number[], needle: number[]): boolean {
	for (let i = 0; i <= haystack.length - needle.length; i++) {
		if (needle.every((byte, index) => haystack[i + index] === byte)) return true
	}
	return false
}

function getDataSectionInfos(sectionInfos: SectionInfo[]): SectionInfo[] {
	return sectionInfos.filter((info) => info.id === 11)
}

describe('data segment variants', () => {
	test('active segment with explicit memory index uses flag 0x02 followed by the memory index', async () => {
		const wasmModuleDefinition: WasmModuleDefinition = {
			memories: [
				{ name: 'memA', minimum: 1, export: true },
				{ name: 'memB', minimum: 1, export: true },
			],
			data: [
				{
					name: 'dDefault',
					flags: DataEntryType.ActiveMemoryZero,
					instructions: [Op.i32.const(0)],
					data: [0x01, 0x02, 0x03, 0x04],
				},
				{
					name: 'dOnMemB',
					flags: DataEntryType.Active,
					memoryIndex: 1,
					instructions: [Op.i32.const(0)],
					data: [0xAB, 0xCD],
				},
			],
		}

		const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

		const dataSections = getDataSectionInfos(getSectionInfos(wasmBytes))
		expect(dataSections.length).toBe(1)

		const dataContent = dataSections[0].content
		// vec count + segment 0 (flag 0x00) + segment 1 (flag 0x02 x:memidx=1 e:expr b*)
		expect(dataContent).toEqual([
			0x02,
			// segment 0: active, memory 0
			0x00,
			0x41, 0x00, 0x0B, // i32.const 0, end
			0x04, 0x01, 0x02, 0x03, 0x04,
			// segment 1: active, explicit memory index 1
			0x02,
			0x01, // memidx = 1
			0x41, 0x00, 0x0B, // i32.const 0, end
			0x02, 0xAB, 0xCD,
		])

		// Functional: each segment landed in its respective memory.
		const memA = (moduleExports as any).memA as WebAssembly.Memory
		const memB = (moduleExports as any).memB as WebAssembly.Memory
		expect(Array.from(new Uint8Array(memA.buffer, 0, 4))).toEqual([0x01, 0x02, 0x03, 0x04])
		expect(Array.from(new Uint8Array(memB.buffer, 0, 2))).toEqual([0xAB, 0xCD])
	})

	test('passive segment plus memory.init copies through the named data lookup', async () => {
		const wasmModuleDefinition: WasmModuleDefinition = {
			memories: [{ name: 'mem', minimum: 1 }],
			data: [
				{
					name: 'passiveChunk',
					flags: DataEntryType.Passive,
					data: [0x11, 0x22, 0x33],
				},
			],
			functions: [
				{
					name: 'install',
					export: true,
					params: { destination: NumberType.i32 },
					instructions: [
						Op.local.get('destination'),
						Op.i32.const(0),
						Op.i32.const(3),
						Op.memory.init('mem', 'passiveChunk'),
					],
				},
				{
					name: 'read',
					export: true,
					params: { offset: NumberType.i32 },
					returns: NumberType.i32,
					instructions: [Op.local.get('offset'), Op.i32.load8_u(0, 0)],
				},
			],
		}

		const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

		;(moduleExports as any).install(8)
		expect((moduleExports as any).read(8)).toEqual(0x11)
		expect((moduleExports as any).read(9)).toEqual(0x22)
		expect((moduleExports as any).read(10)).toEqual(0x33)

		// memory.init immediate layout: 0xFC 0x08 y:dataidx x:memidx
		expect(containsSubarray(Array.from(wasmBytes), [0xFC, 0x08, 0x00, 0x00])).toBe(true)
	})
})
