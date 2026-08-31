import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	ElementEntryType,
	ReferenceTypeKind,
	HeapType,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// `table.init` binary encoding tests.
//
// The spec (binary/instructions.md) encodes `table.init x y` as:
//
//     0xFC 12 : u32 y : elemidx x : tableidx
//
// i.e. the *element segment* index is emitted immediately after the opcode, BEFORE the table index.
// This only matters when the element index and the table index differ; with a segment 0 / table 0
// module both orders produce identical bytes, which is why a two-table module is used here.
//////////////////////////////////////////////////////////////////////////////////////////////////////

test('table.init encodes the element segment index before the table index (spec order)', async () => {
	// Element segment 0 with the callee (function index 0). `table.init('t1', 'e')` should encode
	// as `elemidx`, `tableidx` = 0x00, 0x01. If the operands are swapped the encoding is 0x01, 0x00,
	// which is invalid (there is no element segment 1) and V8 must reject the module.
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'calleeSig', type: { paramTypes: [], returnTypes: [NumberType.i32] } },
		],
		tables: [
			{ name: 't0', referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func }, limits: { minimum: 1 } },
			{ name: 't1', referenceType: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.func }, limits: { minimum: 1 } },
		],
		elements: [
			{ name: 'e', flags: ElementEntryType.Passive, functionIndexes: [0] },
		],
		functions: [
			{
				name: 'callee',
				returns: NumberType.i32,
				instructions: [Op.i32.const(42)],
			},
			{
				name: 'install',
				export: true,
				params: {},
				instructions: [
					Op.i32.const(0), // destination offset in t1
					Op.i32.const(0), // source offset in the element segment
					Op.i32.const(1), // length
					Op.table.init('t1', 'e'),
				],
			},
			{
				name: 'invoke',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0), // table slot
					Op.call_indirect('calleeSig', 't1'),
				],
			},
		],
	}

	const { wasmBytes, moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	// Byte-level check: opcode 0xFC 0x0C (table.init) must be followed by elemidx (0x00) then
	// tableidx (0x01, the second table).
	expect(containsSubarray(wasmBytes, [0xFC, 0x0C, 0x00, 0x01])).toEqual(true)
	// And never the swapped operand order.
	expect(containsSubarray(wasmBytes, [0xFC, 0x0C, 0x01, 0x00])).toEqual(false)

	// Functional check: the engine accepted the encoding (element segment 0 into table 1) and the
	// call through the table reaches the callee.
	const install = moduleExports.install as Function
	const invoke = moduleExports.invoke as Function

	install()

	expect(invoke()).toEqual(42)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
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
