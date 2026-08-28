import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	ImportKind,
	HeapType,
	ReferenceTypeKind,
	WasmModuleDefinition,
} from '../../exports/Exports.js'

test('an imported immutable global is readable from a function', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		imports: [
			{
				moduleName: 'env',
				importName: 'threshold',
				description: {
					type: ImportKind.Global,
					globalType: { type: NumberType.i32, mutable: false },
				},
			},
		],
		functions: [
			{
				name: 'isAbove',
				export: true,
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.global.get('threshold'),
					Op.i32.gt_s,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWithImports(wasmModuleDefinition, {
		env: { threshold: 10 },
	})

	const isAbove = moduleExports.isAbove as Function

	expect(isAbove(15)).toEqual(1)
	expect(isAbove(5)).toEqual(0)
})

test('an imported memory can be written by the host and read by the module', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		imports: [
			{
				moduleName: 'env',
				importName: 'mem',
				description: {
					type: ImportKind.Memory,
					memoryLimits: { minimum: 1 },
				},
			},
		],
		functions: [
			{
				name: 'readByte',
				export: true,
				params: { addr: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('addr'),
					Op.i32.load8_u(0, 0),
				],
			},
		],
	}

	const memory = new WebAssembly.Memory({ initial: 1 })

	const { moduleExports } = await encodeAndInstantiateWithImports(wasmModuleDefinition, {
		env: { mem: memory },
	})

	const readByte = moduleExports.readByte as Function

	// The host writes a byte; the module reads it back from the same (imported) memory.
	new Uint8Array(memory.buffer)[12] = 0x2A
	expect(readByte(12)).toEqual(0x2A)
})

test('an imported table can be populated by the host and called via call_ref', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		imports: [
			{
				moduleName: 'env',
				importName: 'tbl',
				description: {
					type: ImportKind.Table,
					tableEntry: {
						name: 'tbl',
						referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
						limits: { minimum: 1 },
					},
				},
			},
		],
		functions: [
			{
				name: 'answer',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [Op.i32.const(99)],
			},
			{
				name: 'callSlot',
				export: true,
				params: { i: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('i'),
					Op.call_indirect('answer', 'tbl'),
				],
			},
		],
	}

	const table = new WebAssembly.Table({ initial: 1, element: 'anyfunc' })

	const { moduleExports } = await encodeAndInstantiateWithImports(wasmModuleDefinition, {
		env: { tbl: table },
	})

	// Host places the module's own `answer` function into the imported table slot.
	table.set(0, moduleExports.answer as Function)

	const callSlot = moduleExports.callSlot as Function
	expect(callSlot(0)).toEqual(99)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
async function encodeAndInstantiateWithImports(
	wasmModuleDefinition: WasmModuleDefinition,
	importObject: WebAssembly.Imports,
) {
	const { encodeWasmModule } = await import('../../exports/Exports.js')
	const wasmBytes = encodeWasmModule(wasmModuleDefinition)
	const wasmModuleInstance = await WebAssembly.instantiate(wasmBytes, importObject)

	return { wasmBytes, moduleExports: wasmModuleInstance.instance.exports }
}
