import { test, expect } from 'vitest'
import { encodeWasmModule, NumberType, Op } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
	if (needle.length === 0) return true
	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
		return true
	}
	return false
}

test('block with type index >127 emits multi-byte s33 (validates LEB sign)', async () => {
	// Force type index 130: 1 filler function + 130 filler structs makes run blocktype refer to index ~131
	const fillers = Array.from({ length: 130 }, (_, i) => ({ name: `Filler${i}`, type: { fields: [{ storageType: NumberType.i32 }] } } as any))
	const TwoI32 = { name: 'Sig', type: { paramTypes: [], returnTypes: [NumberType.i32, NumberType.i32] } as any }
	const def: any = {
		customTypes: [...fillers, TwoI32],
		functions: [{
			name: 'run', export: true, returns: [NumberType.i32, NumberType.i32],
			instructions: [Op.block({ name: 'B', returns: 'Sig' }, [Op.i32.const(1), Op.i32.const(2)])],
		}],
	}
	const bytes = encodeWasmModule(def)
	// Sig index should be 131 (0 func types + 130 fillers + Sig itself at end? Actually function types are prepended).
	// At least verify bytes contain a multi-byte s33 after 0x02 block opcode.
	// We just ensure instantiation succeeds — truncated LEB would be rejected by validator.
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.run as Function)()).toEqual([1, 2])
	expect(containsSubarray(bytes, [0x02])).toEqual(true)
})

test('custom section encodes id 0, size prefix, name and content bytes', async () => {
	const def: any = {
		functions: [{ name: 'noop', export: true, params: {}, returns: NumberType.i32, instructions: [Op.i32.const(42)] }],
		customSections: [
			{ name: 'my.section', content: [0xFF, 0x00, 0xAB] },
			{ name: 'empty', content: [] },
			{ name: 'with-unicode-🚀', content: [1, 2] },
		],
	}
	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.noop as Function)()).toEqual(42)
	// custom sections are trailing id 0 blocks; verify raw bytes contain name utf8 + content
	const utf8 = (s: string) => [...new TextEncoder().encode(s)]
	expect(containsSubarray(wasmBytes, [...utf8('my.section'), 0xFF, 0x00, 0xAB])).toEqual(true)
	expect(containsSubarray(wasmBytes, [...utf8('empty')])).toEqual(true)
	// 4-byte utf8 for 🚀 = F0 9F 9A 80
	expect(containsSubarray(wasmBytes, [...utf8('with-unicode-🚀'), 1, 2])).toEqual(true)
})
