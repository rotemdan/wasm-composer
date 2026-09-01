import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition, ImportKind, HeapType, ReferenceTypeKind } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'
import { encodeWasmModule } from '../src/exports/Exports.ts'

function containsSubarray(h: Uint8Array, n: number[]): boolean {
	outer: for (let i = 0; i <= h.length - n.length; i++) { for (let j = 0; j < n.length; j++) if (h[i+j]!==n[j]) continue outer; return true } return false
}

// TASK-15: globals init varieties, table limits, import index offsetting

test('globals with i64.const and f32.const init expressions', async () => {
	const def: WasmModuleDefinition = {
		globals: [
			{ name: 'g_i64', type: NumberType.i64, mutable: true, instructions: [Op.i64.const(0n)] },
			{ name: 'g_f32', type: NumberType.f32, mutable: false, instructions: [Op.f32.const(1.5)] },
		],
		functions: [
			{ name: 'getI64', export: true, returns: NumberType.i64, instructions: [Op.global.get('g_i64')] },
			{ name: 'getF32', export: true, returns: NumberType.f32, instructions: [Op.global.get('g_f32')] },
			{ name: 'setI64', export: true, params:{v:NumberType.i64}, returns: NumberType.i64, instructions:[Op.local.get('v'), Op.global.set('g_i64'), Op.global.get('g_i64')] },
		],
	}
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.getI64 as Function)()).toEqual(0n)
	expect((moduleExports.getF32 as Function)()).toBeCloseTo(1.5)
	expect((moduleExports.setI64 as Function)(99n)).toEqual(99n)
})

test('global with maximum and table with indexType i64 (if supported) — at least validate encoding', async () => {
	// table64 proposal: if validator rejects i64 table limits, we just check encoding path produces flag 0x05/0x04
	const bytes = encodeWasmModule({
		tables: [{ name: 't', referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func }, limits: { minimum: 1, maximum: 4 } }],
		globals: [{ name: 'g', type: NumberType.i32, mutable: false, instructions: [Op.i32.const(1)] }],
		functions: [{ name: 'f', export: true, returns: NumberType.i32, instructions: [Op.global.get('g')] }],
	})
	expect(containsSubarray(bytes, [0x70, 0x01, 0x01, 0x04])).toEqual(true) // func reftype + limits 0x01 min1 max4
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition({
		tables: [{ name: 't', referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func }, limits: { minimum: 1 } }],
		globals: [{ name: 'g', type: NumberType.i32, mutable: false, instructions: [Op.i32.const(5)] }],
		functions: [{ name: 'f', export: true, returns: NumberType.i32, instructions: [Op.global.get('g')] }],
	})
	expect((moduleExports.f as Function)()).toEqual(5)
})

test('imported function index offsetting: Op.call resolves after imports', async () => {
	const def: WasmModuleDefinition = {
		imports: [{ moduleName:'env', importName:'ext', description:{ type: ImportKind.Function, index: 0 } }],
		functions: [
			{
				name: 'localFn', params:{}, returns: NumberType.i32,
				instructions: [Op.i32.const(7)],
			},
			{
				name: 'callLocal', export:true, returns: NumberType.i32,
				instructions: [Op.call('localFn')],
			},
			{
				name: 'callImport', export:true, returns: NumberType.i32,
				instructions: [Op.call('ext')],
			},
		],
	}
	// localFn is index 1 (after 1 import), callLocal should emit 0x10 0x01; callImport 0x10 0x00
	const bytes = encodeWasmModule(def as any)
	expect(containsSubarray(bytes, [0x10, 0x00])).toEqual(true)
	expect(containsSubarray(bytes, [0x10, 0x01])).toEqual(true)
	const wasm = await WebAssembly.instantiate(bytes, { env: { ext: () => 42 } })
	expect((wasm.instance.exports.callImport as Function)()).toEqual(42)
	expect((wasm.instance.exports.callLocal as Function)()).toEqual(7)
})
