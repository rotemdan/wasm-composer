import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	ImportKind,
	HeapType,
	ReferenceTypeKind,
	WasmModuleDefinition,
	encodeWasmModule,
} from '../../exports/Exports.js'

test('an imported function is callable through call_indirect via an element-filled table', async () => {
	let importedWasCalled = false

	const wasmModuleDefinition: WasmModuleDefinition = {
		// Establish function type (i32) -> (i32) at type index 0.
		functions: [
			{
				name: 'double',
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [Op.local.get('x'), Op.i32.const(2), Op.i32.mul],
			},
			{
				name: 'runImport',
				export: true,

				params: { x: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.local.get('x'),
					Op.i32.const(0),
					Op.call_indirect('double', 'tbl'),
				],
			},
		],
		imports: [
			{
				moduleName: 'env',
				importName: 'onAdd',
				description: { type: ImportKind.Function, index: 0 },
			},
		],
		tables: [
			{
				name: 'tbl',
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				limits: { minimum: 1 },
			},
		],
		elements: [
			{
				name: 'el0',
				flags: 0,
				instructions: [Op.i32.const(0)],
				functionIndexes: [0], // function index 0 is the imported `onAdd`
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWithImports(wasmModuleDefinition, {
		env: {
			onAdd: (x: number) => {
				importedWasCalled = true
				return x + 100
			},
		},
	})

	const runImport = moduleExports.runImport as Function

	expect(runImport(5)).toEqual(105)
	expect(importedWasCalled).toEqual(true)
})

test('two imported functions dispatch to distinct table slots through call_indirect', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'double',
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [Op.local.get('x'), Op.i32.const(2), Op.i32.mul],
			},
			{
				name: 'runAdd',
				export: true,

				params: { x: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.local.get('x'),
					Op.i32.const(0),
					Op.call_indirect('double', 'tbl'),
				],
			},
			{
				name: 'runMul',
				export: true,

				params: { x: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.local.get('x'),
					Op.i32.const(1),
					Op.call_indirect('double', 'tbl'),
				],
			},
		],
		imports: [
			{
				moduleName: 'env',
				importName: 'onAdd',
				description: { type: ImportKind.Function, index: 0 },
			},
			{
				moduleName: 'env',
				importName: 'onMul',
				description: { type: ImportKind.Function, index: 0 },
			},
		],
		tables: [
			{
				name: 'tbl',
				referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func },
				limits: { minimum: 2 },
			},
		],
		elements: [
			{
				name: 'el0',
				flags: 0,
				instructions: [Op.i32.const(0)],
				functionIndexes: [0], // imported onAdd
			},
			{
				name: 'el1',
				flags: 0,
				instructions: [Op.i32.const(1)],
				functionIndexes: [1], // imported onMul
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWithImports(wasmModuleDefinition, {
		env: {
			onAdd: (x: number) => x + 100,
			onMul: (x: number) => x * 7,
		},
	})

	const runAdd = moduleExports.runAdd as Function
	const runMul = moduleExports.runMul as Function

	expect(runAdd(5)).toEqual(105)
	expect(runMul(5)).toEqual(35)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
async function encodeAndInstantiateWithImports(
	wasmModuleDefinition: WasmModuleDefinition,
	importObject: WebAssembly.Imports,
) {
	const wasmBytes = encodeWasmModule(wasmModuleDefinition)
	const wasmModuleInstance = await WebAssembly.instantiate(wasmBytes, importObject)

	return { wasmBytes, moduleExports: wasmModuleInstance.instance.exports }
}
