import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition, ElementEntryType, ReferenceTypeKind, HeapType } from '../src/exports/Exports.ts'
import { encodeWasmModule } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

const funcrefType = { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func } as const

function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
	if (needle.length === 0) return true
	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
		return true
	}
	return false
}

test('element flag 0x04 ActiveTableZeroWithInstructions populates table 0 via expr vec', async () => {
	// Missing coverage: flag 0x04 was absent. Binary layout per binary/modules.md:
	// flag 0x04, offset expr (i32.const 0 + end), vec count, then each element expr (ref.func + end).
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [{ name: 'sig', type: { paramTypes: [], returnTypes: [NumberType.i32] } }],
		tables: [{ name: 't', referenceType: funcrefType, limits: { minimum: 2 } }],
		elements: [{
			name: 'e04',
			flags: ElementEntryType.ActiveTableZeroWithInstructions,
			instructions: [Op.i32.const(0)],
			functionInstructions: [[Op.ref.func('callee')], [Op.ref.func('callee2')]],
		}],
		functions: [
			{ name: 'callee', returns: NumberType.i32, instructions: [Op.i32.const(42)] },
			{ name: 'callee2', returns: NumberType.i32, instructions: [Op.i32.const(99)] },
			{
				name: 'run0', export: true, params: {}, returns: NumberType.i32,
				instructions: [Op.i32.const(0), Op.call_indirect('sig', 't')],
			},
			{
				name: 'run1', export: true, params: {}, returns: NumberType.i32,
				instructions: [Op.i32.const(1), Op.call_indirect('sig', 't')],
			},
		],
	}
	const wasmBytes = encodeWasmModule(wasmModuleDefinition)
	// flag 0x04, expr 41 00 0B, vec 0x02, ref.func callee 0xD2 0x00 0B, ref.func callee2 0xD2 0x01 0B
	expect(containsSubarray(wasmBytes, [0x04, 0x41, 0x00, 0x0B, 0x02, 0xD2, 0x00, 0x0B, 0xD2, 0x01, 0x0B])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	expect((moduleExports.run0 as Function)()).toEqual(42)
	expect((moduleExports.run1 as Function)()).toEqual(99)
})

test('element flag 0x05 PassiveWithInstructions byte layout uses reftype not elemkind', async () => {
	// flag 0x05: reftype (0x70 funcref) + vec(expr) . Contrasts with flag 0x01 which is elemkind 0x00 + vec(funcidx).
	const passiveDef: WasmModuleDefinition = {
		customTypes: [{ name: 'sig', type: { paramTypes: [], returnTypes: [NumberType.i32] } }],
		tables: [{ name: 't', referenceType: funcrefType, limits: { minimum: 2 } }],
		elements: [{
			name: 'ePassive',
			flags: ElementEntryType.Passive,
			functionIndexes: [0],
		}],
		functions: [
			{ name: 'callee', returns: NumberType.i32, instructions: [Op.i32.const(1)] },
			{
				name: 'init', export: true, params: {}, returns: NumberType.i32,
				instructions: [Op.i32.const(0), Op.i32.const(0), Op.i32.const(1), Op.table.init('t', 'ePassive'), Op.i32.const(0), Op.call_indirect('sig', 't')],
			},
		],
	}
	const bytesPassive = encodeWasmModule(passiveDef)
	expect(containsSubarray(bytesPassive, [0x01, 0x00, 0x01, 0x00])).toEqual(true) // 0x01 passive, elemkind 0x00

	const withInstrDef: WasmModuleDefinition = {
		customTypes: [{ name: 'sig', type: { paramTypes: [], returnTypes: [NumberType.i32] } }],
		tables: [{ name: 't', referenceType: funcrefType, limits: { minimum: 2 } }],
		elements: [{
			name: 'e05',
			flags: ElementEntryType.PassiveWithInstructions,
			referenceType: funcrefType,
			functionInstructions: [[Op.ref.func('callee')]],
		}],
		functions: [
			{ name: 'callee', returns: NumberType.i32, instructions: [Op.i32.const(7)] },
			{
				name: 'init', export: true, params: {}, returns: NumberType.i32,
				instructions: [Op.i32.const(0), Op.i32.const(0), Op.i32.const(1), Op.table.init('t', 'e05'), Op.i32.const(0), Op.call_indirect('sig', 't')],
			},
		],
	}
	const bytes05 = encodeWasmModule(withInstrDef)
	expect(containsSubarray(bytes05, [0x05, 0x70, 0x01, 0xD2, 0x00, 0x0B])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(withInstrDef)
	expect((moduleExports.init as Function)()).toEqual(7)
})

test('element flag 0x04 with single entry and non-zero offset', async () => {
	const def: WasmModuleDefinition = {
		customTypes: [{ name: 'sig', type: { paramTypes: [], returnTypes: [NumberType.i32] } }],
		tables: [{ name: 't', referenceType: funcrefType, limits: { minimum: 3 } }],
		elements: [{
			name: 'e',
			flags: ElementEntryType.ActiveTableZeroWithInstructions,
			instructions: [Op.i32.const(2)],
			functionInstructions: [[Op.ref.func('callee')]],
		}],
		functions: [
			{ name: 'callee', returns: NumberType.i32, instructions: [Op.i32.const(55)] },
			{ name: 'run', export: true, params: {}, returns: NumberType.i32, instructions: [Op.i32.const(2), Op.call_indirect('sig', 't')] },
		],
	}
	const bytes = encodeWasmModule(def)
	expect(containsSubarray(bytes, [0x04, 0x41, 0x02, 0x0B, 0x01, 0xD2, 0x00, 0x0B])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.run as Function)()).toEqual(55)
})
