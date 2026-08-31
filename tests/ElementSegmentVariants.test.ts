import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	ElementEntryType,
	ReferenceType,
	ReferenceTypeKind,
	HeapType,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Element segment encoding variants (flags 0..7 per binary/modules.md). Flags 0/1/4/5 are covered
// elsewhere; this file exercises the remaining variants:
//
//   0x02 : x:tableidx e:expr el*:vec(funcidx)      (Active, explicit table index)
//   0x03 : el*:vec(funcidx)                        (Declarative, function indexes)
//   0x06 : x:tableidx e:expr et:reftype el*:vec(expr)   (Active with element expressions)
//   0x07 : et:reftype el*:vec(expr)                (Declarative with element expressions)
//////////////////////////////////////////////////////////////////////////////////////////////////////

const funcrefType: ReferenceType = { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func }

test('element flag 0x02: active segment with an explicit non-zero table index', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'calleeSig', type: { paramTypes: [], returnTypes: [NumberType.i32] } },
		],
		tables: [
			{ name: 't0', referenceType: funcrefType, limits: { minimum: 1 } },
			{ name: 't1', referenceType: funcrefType, limits: { minimum: 2 } },
		],
		elements: [
			{
				name: 'eActive',
				flags: ElementEntryType.Active,
				tableIndex: 1,
				instructions: [Op.i32.const(1)], // offset 1 in t1
				functionIndexes: [0], // callee
			},
		],
		functions: [
			{
				name: 'callee',
				returns: NumberType.i32,
				instructions: [Op.i32.const(42)],
			},
			{
				name: 'runner',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(1),
					Op.call_indirect('calleeSig', 't1'),
				],
			},
		],
	}

	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// Byte layout: flags 0x02, tableidx 0x01, offset expr (i32.const 1 + end), elemkind 0x00,
	// vec count 0x01, funcidx 0x00.
	expect(containsSubarray(wasmBytes, [0x02, 0x01, 0x41, 0x01, 0x0B, 0x00, 0x01, 0x00])).toEqual(true)

	expect((moduleExports.runner as Function)()).toEqual(42)
})

test('element flag 0x03: declarative segment with plain function indexes declares ref.func targets', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'calleeSig', type: { paramTypes: [], returnTypes: [NumberType.i32] } },
		],
		elements: [
			{
				name: 'eDeclared',
				flags: ElementEntryType.Declarative,
				functionIndexes: [0], // declare callee
			},
		],
		functions: [
			{
				name: 'callee',
				returns: NumberType.i32,
				instructions: [Op.i32.const(42)],
			},
			{
				name: 'getRef',
				export: true,
				params: {},
				returns: funcrefType,
				instructions: [Op.ref.func('callee')],
			},
		],
	}

	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// Byte layout: flags 0x03, elemkind 0x00, vec count 0x01, funcidx 0x00
	expect(containsSubarray(wasmBytes, [0x03, 0x00, 0x01, 0x00])).toEqual(true)

	// The declared function is reachable through its reference.
	const calleeFn = (moduleExports.getRef as Function)()
	expect((calleeFn as Function)()).toEqual(42)
})

test('element flag 0x06: active segment with element expressions placed on an explicit table', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'calleeSig', type: { paramTypes: [], returnTypes: [NumberType.i32] } },
		],
		tables: [
			{ name: 't', referenceType: funcrefType, limits: { minimum: 2 } },
		],
		elements: [
			{
				name: 'eActiveInstr',
				flags: ElementEntryType.ActiveWithInstructions,
				tableIndex: 0,
				instructions: [Op.i32.const(0)], // start at slot 0
				referenceType: funcrefType,
				functionInstructions: [
					[Op.ref.func('callee')],
					[Op.ref.func('callee2')],
				],
			},
		],
		functions: [
			{
				name: 'callee',
				returns: NumberType.i32,
				instructions: [Op.i32.const(42)],
			},
			{
				name: 'callee2',
				returns: NumberType.i32,
				instructions: [Op.i32.const(99)],
			},
			{
				name: 'runner0',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [Op.i32.const(0), Op.call_indirect('calleeSig', 't')],
			},
			{
				name: 'runner1',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [Op.i32.const(1), Op.call_indirect('calleeSig', 't')],
			},
		],
	}

	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// Byte layout: flags 0x06, tableidx 0x00, offset expr (i32.const 0 + end), reftype (0x70 =
	// funcref), vec count 0x02, then one expr per element: ref.func 0x00 + end, ref.func 0x01 + end.
	expect(containsSubarray(wasmBytes, [0x06, 0x00, 0x41, 0x00, 0x0B, 0x70, 0x02, 0xD2, 0x00, 0x0B, 0xD2, 0x01, 0x0B])).toEqual(true)

	expect((moduleExports.runner0 as Function)()).toEqual(42)
	expect((moduleExports.runner1 as Function)()).toEqual(99)
})

test('element flag 0x07: declarative segment with element expressions declares ref.func targets', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'calleeSig', type: { paramTypes: [], returnTypes: [NumberType.i32] } },
		],
		elements: [
			{
				name: 'eDeclaredInstr',
				flags: ElementEntryType.DeclarativeWithInstructions,
				referenceType: funcrefType,
				functionInstructions: [
					[Op.ref.func('callee')],
				],
			},
		],
		functions: [
			{
				name: 'callee',
				returns: NumberType.i32,
				instructions: [Op.i32.const(42)],
			},
			{
				name: 'getRef',
				export: true,
				params: {},
				returns: funcrefType,
				instructions: [Op.ref.func('callee')],
			},
		],
	}

	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// Byte layout: flags 0x07, reftype 0x70, vec count 0x01, expr: ref.func 0x00 + end
	expect(containsSubarray(wasmBytes, [0x07, 0x70, 0x01, 0xD2, 0x00, 0x0B])).toEqual(true)

	// The declared function is reachable through its reference.
	const calleeFn = (moduleExports.getRef as Function)()
	expect((calleeFn as Function)()).toEqual(42)
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
