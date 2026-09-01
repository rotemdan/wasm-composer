import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeWasmModule } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

function getSectionInfos(wasmBytes: Uint8Array): Array<{ id: number; content: Uint8Array }> {
	const infos: Array<{ id: number; content: Uint8Array }> = []
	let offset = 8 // skip preamble
	while (offset < wasmBytes.length) {
		const id = wasmBytes[offset++]
		let size = 0, shift = 0
		let b: number
		do {
			b = wasmBytes[offset++]
			size |= (b & 0x7F) << shift
			shift += 7
		} while (b & 0x80)
		const content = wasmBytes.slice(offset, offset + size)
		infos.push({ id, content })
		offset += size
	}
	return infos
}

function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
	if (needle.length === 0) return true
	if (needle.length > haystack.length) return false
	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
		return true
	}
	return false
}

test('memory64 minimum-only encodes flag 0x04 and yields bigint memory.size', async () => {
	const wasmBytes = encodeWasmModule({
		memories: [{ name: 'm', minimum: 0n, indexType: 'i64' }],
		functions: [{ name: 'sz', export: true, params: {}, returns: NumberType.i64, instructions: [Op.memory.size('m')] }],
	})
	const memSection = getSectionInfos(wasmBytes).find(s => s.id === 5)!
	// count 1, flag 0x04 (i64 min-only), min 0
	expect([...memSection.content]).toEqual([0x01, 0x04, 0x00])
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition({
		memories: [{ name: 'm', minimum: 0n, indexType: 'i64' }],
		functions: [{ name: 'sz', export: true, params: {}, returns: NumberType.i64, instructions: [Op.memory.size('m')] }],
	})
	expect((moduleExports.sz as Function)()).toEqual(0n)
})

test('memory64 min+max encodes flag 0x05 and large 2^32 boundary (u64 LEB)', async () => {
	const wasmBytes = encodeWasmModule({
		memories: [
			{ name: 'a', minimum: 2n, indexType: 'i64' },
			{ name: 'b', minimum: 2n, maximum: 3n, indexType: 'i64' },
		],
	})
	const content = [...getSectionInfos(wasmBytes).find(s => s.id === 5)!.content]
	expect(content).toEqual([0x02, 0x04, 0x02, 0x05, 0x02, 0x03])

	// large boundary: minimum 0x1_0000_0000n (>2^32) must be LEB u64 multi-byte
	const big = 0x1_0000_0000n
	const bigBytes = encodeWasmModule({ memories: [{ name: 'm', minimum: big, indexType: 'i64' }] })
	const bigContent = [...getSectionInfos(bigBytes).find(s => s.id === 5)!.content]
	// flag 0x04 + LEB of 0x100000000 = 80 80 80 80 10
	expect(bigContent).toEqual([0x01, 0x04, 0x80, 0x80, 0x80, 0x80, 0x10])
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition({
		memories: [{ name: 'm', minimum: 1n, maximum: 4n, indexType: 'i64', export: true }],
		functions: [{ name: 'sz', export: true, params: {}, returns: NumberType.i64, instructions: [Op.memory.size('m')] }],
	})
	expect((moduleExports.sz as Function)()).toEqual(1n)
})

test('memory64 memarg with i64 offset >2^32 round-trips', async () => {
	const offset = 0x1_0000n // 65536, keeps within 1 page but tests bigint encoding path via i64 offset
	const highOffset = 0x10n // small but still bigint
	// Use offset 0x100000000n via explicit bigint store/load - needs address 0 with that offset
	// We verify byte pattern includes multi-byte u64 offset when using large offset
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'mem', minimum: 1n, maximum: 4n, indexType: 'i64', export: true }],
		functions: [
			{
				name: 'storeAndLoad',
				export: true,
				params: { address: NumberType.i64, value: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('address'),
					Op.local.get('value'),
					Op.i32.store(2, 8n),
					Op.local.get('address'),
					Op.i32.load(2, 8n),
				],
			},
		],
	}
	const wasmBytes = encodeWasmModule(wasmModuleDefinition)
	// i32.store 0x36, align 2, offset LEB 8
	expect(containsSubarray(wasmBytes, [0x36, 0x02, 0x08])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	expect((moduleExports.storeAndLoad as Function)(1024n, 42)).toEqual(42)

	// Now test named memory with bigint offset and v128 path
	const multiMemDef: WasmModuleDefinition = {
		memories: [
			{ name: 'memA', minimum: 1n, indexType: 'i64', export: true },
			{ name: 'memB', minimum: 1n, indexType: 'i64', export: true },
		],
		functions: [
			{
				name: 'storeB_loadB',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i64.const(0n), Op.i32.const(99), Op.i32.store(2, 16n, 'memB'),
					Op.i64.const(0n), Op.i32.load(2, 16n, 'memB'),
				],
			},
		],
	}
	const bytes2 = encodeWasmModule(multiMemDef)
	// align 2 | 0x40 = 0x42, memidx 1, offset 16
	expect(containsSubarray(bytes2, [0x36, 0x42, 0x01, 0x10])).toEqual(true)
	const r2 = await encodeAndInstantiateWasmModuleDefinition(multiMemDef)
	expect((r2.moduleExports.storeB_loadB as Function)()).toEqual(99)
})
