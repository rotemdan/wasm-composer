import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test('a custom section is emitted and its name + content bytes survive in the encoded module', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'noop',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [Op.i32.const(0)],
			},
		],
		customSections: [
			{
				name: 'my-meta',
				content: [0xde, 0xad, 0xbe, 0xef],
			},
		],
	}

	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// The engine ignores custom sections, but the bytes must still be present in the
	// module we handed to it. A custom section lays out as: id(0) len (name len name content).
	const expectedBytes = [...utf8Chars('my-meta'), 0xde, 0xad, 0xbe, 0xef]

	expect(containsSubarray(wasmBytes, expectedBytes)).toEqual(true)

	// The module is still valid and instantiable.
	expect((moduleExports.noop as Function)()).toEqual(0)
})

test('multiple custom sections are all retained', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'noop',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [Op.i32.const(0)],
			},
		],
		customSections: [
			{ name: 'first', content: [0x01, 0x02] },
			{ name: 'second', content: [0x03, 0x04, 0x05] },
		],
	}

	const { wasmBytes } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	expect(containsSubarray(wasmBytes, [...utf8Chars('first'), 0x01, 0x02])).toEqual(true)
	expect(containsSubarray(wasmBytes, [...utf8Chars('second'), 0x03, 0x04, 0x05])).toEqual(true)
})

test('a custom section with empty content still round-trips', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'noop',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [Op.i32.const(42)],
			},
		],
		customSections: [
			{ name: 'empty', content: [] },
		],
	}

	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	expect(containsSubarray(wasmBytes, utf8Chars('empty'))).toEqual(true)
	expect((moduleExports.noop as Function)()).toEqual(42)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
function utf8Chars(str: string): number[] {
	return [...str].map((c) => c.charCodeAt(0))
}

function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
	if (needle.length === 0) {
		return true
	}

	if (needle.length > haystack.length) {
		return false
	}

	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) {
				continue outer
			}
		}

		return true
	}

	return false
}
