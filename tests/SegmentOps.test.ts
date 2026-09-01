import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition, ElementEntryType, ReferenceTypeKind, HeapType, DataEntryType } from '../src/exports/Exports.ts'
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

test('memory.init emits dataidx before memidx — multi-memory byte order 0xFC 0x08 y x', async () => {
	// Spec binary/instructions.md: 0xFC 08 : y:dataidx x:memidx => memory.init x y
	// Ops.ts emits dataEntryIndex then memoryIndex (swapped vs mnemonic). With two memories and
	// one passive segment, memory.init(memB, src) must be [FC 08 00 01] not [FC 08 01 00].
	const def: WasmModuleDefinition = {
		memories: [
			{ name: 'memA', minimum: 1, export: true },
			{ name: 'memB', minimum: 1, export: true },
		],
		data: [{ name: 'src', flags: DataEntryType.Passive, data: [0x11, 0x22, 0x33, 0x44] } as any],
		functions: [{
			name: 'initA', export: true, params: {},
			instructions: [Op.i32.const(0), Op.i32.const(0), Op.i32.const(4), Op.memory.init('memA', 'src')],
		}, {
			name: 'initB', export: true, params: {},
			instructions: [Op.i32.const(8), Op.i32.const(0), Op.i32.const(4), Op.memory.init('memB', 'src')],
		}, {
			name: 'readA', export: true, params: {}, returns: NumberType.i32,
			instructions: [Op.i32.const(0), Op.i32.load8_u(0, 0, 'memA')],
		}, {
			name: 'readB', export: true, params: {}, returns: NumberType.i32,
			instructions: [Op.i32.const(8), Op.i32.load8_u(0, 0, 'memB')],
		}],
	}
	const bytes = encodeWasmModule(def)
	expect(containsSubarray(bytes, [0xFC, 0x08, 0x00, 0x00])).toEqual(true) // src 0 -> memA 0
	expect(containsSubarray(bytes, [0xFC, 0x08, 0x00, 0x01])).toEqual(true) // src 0 -> memB 1
	expect(containsSubarray(bytes, [0xFC, 0x08, 0x01, 0x00])).toEqual(false) // swapped order must not appear
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	// before init both reads are 0
	expect((moduleExports.readA as Function)()).toEqual(0)
	expect((moduleExports.readB as Function)()).toEqual(0)
	;(moduleExports.initB as Function)()
	expect((moduleExports.readB as Function)()).toEqual(0x11)
	expect((moduleExports.readA as Function)()).toEqual(0) // isolation: A unchanged
	;(moduleExports.initA as Function)()
	expect((moduleExports.readA as Function)()).toEqual(0x11)
})

test('data.drop 0xFC 0x09 and elem.drop 0xFC 0x0D trap after drop on subsequent init', async () => {
	// Passive data segment dropped then memory.init must trap. Analogous for element segment.
	// Functional semantics per exec/instructions.md: after drop, bytes/refs become ε.
	const dataDef: WasmModuleDefinition = {
		memories: [{ name: 'mem', minimum: 1 }],
		data: [{ name: 'seg', flags: DataEntryType.Passive, data: [0xAA, 0xBB] } as any],
		functions: [{
			name: 'run', export: true, params: {}, returns: NumberType.i32,
			instructions: [
				Op.data.drop('seg'),
				Op.i32.const(0), Op.i32.const(0), Op.i32.const(2), Op.memory.init('mem', 'seg'),
				Op.i32.const(1),
			],
		}],
	}
	const dataBytes = encodeWasmModule(dataDef)
	expect(containsSubarray(dataBytes, [0xFC, 0x09, 0x00])).toEqual(true)
	const { moduleExports: m1 } = await encodeAndInstantiateWasmModuleDefinition(dataDef)
	expect(() => (m1.run as Function)()).toThrow()

	const elemDef: WasmModuleDefinition = {
		customTypes: [{ name: 'sig', type: { paramTypes: [], returnTypes: [NumberType.i32] } }],
		tables: [{ name: 't', referenceType: funcrefType, limits: { minimum: 2 } }],
		elements: [{
			name: 'e', flags: ElementEntryType.Passive, functionIndexes: [0],
		}],
		functions: [
			{ name: 'callee', returns: NumberType.i32, instructions: [Op.i32.const(42)] },
			{
				name: 'run', export: true, params: {}, returns: NumberType.i32,
				instructions: [
					Op.elem.drop('e'),
					Op.i32.const(0), Op.i32.const(0), Op.i32.const(1), Op.table.init('t', 'e'),
					Op.i32.const(1),
				],
			},
		],
	}
	const elemBytes = encodeWasmModule(elemDef)
	expect(containsSubarray(elemBytes, [0xFC, 0x0D, 0x00])).toEqual(true)
	const { moduleExports: m2 } = await encodeAndInstantiateWasmModuleDefinition(elemDef)
	expect(() => (m2.run as Function)()).toThrow()
})

test('memory.copy and table.copy dest-source order — 0xFC 0x0A d s and FC 0x0E d s', async () => {
	const def: WasmModuleDefinition = {
		memories: [
			{ name: 'memA', minimum: 1, export: true },
			{ name: 'memB', minimum: 1, export: true },
		],
		tables: [
			{ name: 'tA', referenceType: funcrefType, limits: { minimum: 2 } },
			{ name: 'tB', referenceType: funcrefType, limits: { minimum: 2 } },
		],
		elements: [
			{ name: 'e', flags: ElementEntryType.ActiveTableZeroWithInstructions, instructions: [Op.i32.const(0)], functionInstructions: [[Op.ref.func('callee')], [Op.ref.func('callee2')]] },
		],
		data: [
			{ name: 'd0', flags: DataEntryType.ActiveMemoryZero, instructions: [Op.i32.const(0)], data: [1, 2, 3, 4] } as any,
		],
		customTypes: [{ name: 'sig', type: { paramTypes: [], returnTypes: [NumberType.i32] } }],
		functions: [
			{ name: 'callee', returns: NumberType.i32, instructions: [Op.i32.const(10)] },
			{ name: 'callee2', returns: NumberType.i32, instructions: [Op.i32.const(20)] },
			{
				name: 'copyMem', export: true, params: {},
				instructions: [Op.i32.const(16), Op.i32.const(0), Op.i32.const(4), Op.memory.copy('memB', 'memA')],
			},
			{
				name: 'copyTable', export: true, params: {},
				instructions: [Op.i32.const(0), Op.i32.const(0), Op.i32.const(2), Op.table.copy('tA', 'tB')],
			},
			{
				name: 'readMemB', export: true, params: {}, returns: NumberType.i32,
				instructions: [Op.i32.const(16), Op.i32.load8_u(0, 0, 'memB')],
			},
			{
				name: 'callViaB0', export: true, params: {}, returns: NumberType.i32,
				instructions: [Op.i32.const(0), Op.call_indirect('sig', 'tB')],
			},
		],
	}
	const bytes = encodeWasmModule(def)
	// memory.copy dest=1 (memB) src=0 (memA) => [FC 0A 01 00] per spec
	expect(containsSubarray(bytes, [0xFC, 0x0A, 0x01, 0x00])).toEqual(true)
	expect(containsSubarray(bytes, [0xFC, 0x0A, 0x00, 0x01])).toEqual(false)
	// table.copy dest tB(1) src tA(0) => [FC 0E 01 00]
	expect(containsSubarray(bytes, [0xFC, 0x0E, 0x01, 0x00])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	;(moduleExports.copyMem as Function)()
	expect((moduleExports.readMemB as Function)()).toEqual(1)
	// tA was populated by active segment e at 0, table.copy should bring it to tB
	;(moduleExports.copyTable as Function)()
	expect((moduleExports.callViaB0 as Function)()).toEqual(10)
})
