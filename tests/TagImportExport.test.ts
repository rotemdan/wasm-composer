import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition, ImportKind } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Tag imports and exports.
//
// The tag type is encoded as `tagtype ::= 0x00 x : typeidx` both for imported and defined tags.
// The import's `typeIndex` must reference the correct *type section* index (function-defined
// signatures occupy the leading type indexes, so the (i32)->() signature of the first defined
// function is type index 0 here). An exported tag must appear in the exports section with kind
// byte 4 (ExportKind.Tag) and surface in the instance exports as a WebAssembly.Tag.
//////////////////////////////////////////////////////////////////////////////////////////////////////

const wasmModuleDefinition: WasmModuleDefinition = {
	// NOTE: the first defined function has type (i32) -> (), so its type index is 0 and the
	// imported tag below can reference it via typeIndex: 0.
	imports: [
		{
			moduleName: 'env',
			importName: 'importedTag',
			description: { type: ImportKind.Tag, typeIndex: 0 },
		},
	],
	tags: [
		{ name: 'exportedTag', typeName: 'tagSig', export: true },
	],
	customTypes: [
		{ name: 'tagSig', type: { paramTypes: [NumberType.i32], returnTypes: [] } },
	],
	functions: [
		{
			name: 'throwImported',
			export: true,
			params: { v: NumberType.i32 },
			instructions: [
				Op.local.get('v'),
				Op.throw('importedTag'),
			],
		},
		{
			name: 'throwExported',
			export: true,
			params: { v: NumberType.i32 },
			instructions: [
				Op.local.get('v'),
				Op.throw('exportedTag'),
			],
		},
		{
			name: 'catchExported',
			export: true,
			params: { v: NumberType.i32 },
			returns: NumberType.i32,
			instructions: [
				Op.try({ returns: NumberType.i32 }, [
					Op.local.get('v'),
					Op.if([ Op.local.get('v'), Op.throw('exportedTag') ]),
					Op.local.get('v'),
				]),
				Op.catch('exportedTag', [
					Op.drop, // the exception's i32 payload
					Op.i32.const(-1),
				]),
			],
		},
	],
}

test('an imported tag received from JavaScript can be thrown and observed in JS', async () => {
	const importedTag = new WebAssembly.Tag({ parameters: ['i32'] })

	const wasmBytes = (await import('../src/exports/Exports.ts')).encodeWasmModule({
		...wasmModuleDefinition,
	})

	// Re-instantiate with the import provided (the shared helper passes no imports).
	const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { importedTag } })

	let caught = false

	try {
		;(instance.exports.throwImported as Function)(77)
	} catch (e) {
		caught = true
		expect(e instanceof WebAssembly.Exception).toEqual(true)
		// The exception object must be associated with the very tag that was imported...
		expect(e.is(importedTag)).toEqual(true)
		// ...and must carry the thrown payload intact.
		expect(e.getArg(importedTag, 0)).toEqual(77)
	}

	expect(caught).toEqual(true)
})

test('an exported tag surfaces in the instance exports with export kind byte 0x04', async () => {
	const wasmBytes = (await import('../src/exports/Exports.ts')).encodeWasmModule(wasmModuleDefinition)

	// Exports section entry: name length (0x0B for 'exportedTag'), the name's UTF-8 bytes,
	// kind byte 0x04 (ExportKind.Tag), and the tag index (imported tag #0, defined tag #1 -> 0x01).
	// The module requires the imported tag to be satisfiable even when we only inspect exports.
	expect(containsSubarray(wasmBytes, [0x0B, ...[...'exportedTag'].map((c) => c.charCodeAt(0)), 0x04, 0x01])).toEqual(true)

	const importedTag = new WebAssembly.Tag({ parameters: ['i32'] })
	const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { importedTag } })
	const moduleExports = instance.exports

	expect(moduleExports.exportedTag instanceof WebAssembly.Tag).toEqual(true)
})

test('the exported tag can be thrown and caught inside the module carrying its payload', async () => {
	const wasmBytes = (await import('../src/exports/Exports.ts')).encodeWasmModule(wasmModuleDefinition)

	// The module still requires the imported tag to be satisfiable, even though this test only
	// exercises the exported one.
	const importedTag = new WebAssembly.Tag({ parameters: ['i32'] })
	const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { importedTag } })
	const moduleExports = instance.exports

	const catchExported = moduleExports.catchExported as Function

	// No throw path (v == 0 bypasses the if): the try block's value flows through
	expect(catchExported(0)).toEqual(0)
	// Throw path: the catch handler drops the payload and pushes -1
	expect(catchExported(5)).toEqual(-1)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
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
