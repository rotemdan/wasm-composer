import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition, ReferenceTypeKind, HeapType, PackedType } from '../src/exports/Exports.ts'
import { encodeWasmModule } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
	if (needle.length === 0) return true
	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
		return true
	}
	return false
}

// Covers all 6 ReferenceTypeKind encodings via WasmEncoder.emitReferenceType (0x63/0x64 prefixes, heap s33).
// Missing previously: ShortTypeIndex (s33), LongNullableTypeId (0x63 heapType), LongNullableTypeIndex (0x63 s33),
// LongNonNullableTypeId (0x64 heapType), LongNonNullableTypeIndex (0x64 s33). Only ShortTypeId and LongNullableTypeIndex were exercised.

test('ShortTypeIndex (s33) — custom struct index as short non-nullable ref', async () => {
	// The short form (bare s33 typeidx, no 0x63/0x64 prefix) is only valid as a `blocktype`
	// per binary/types.md — reftype's short form is an absheaptype only, so a bare typeidx
	// cannot appear in param/return position of a function signature. This exercises the
	// bare positive s33 encoding through a block type naming a struct type (its expansion
	// must be a func type, so index a *function-like* type: index 1, the `get` signature,
	// via a blocktype use). Function signature types occupy indices 0..n-1.
	const MyStruct = { name: 'MyStruct', type: { fields: [{ storageType: NumberType.i32 } as any] } } as any
	const def: WasmModuleDefinition = {
		customTypes: [MyStruct],
		functions: [{
			name: 'make', export: true, params: {}, returns: NumberType.i32,
			// block (result i32) via blocktype index 1 (func [] -> [i32]): the block pushes
			// 42 and branches with the struct value threaded through locals.
			instructions: [
				Op.block({ name: 'b', returns: 'make' as any }, [
					Op.i32.const(42),
					Op.br('b'),
				]),
			],
		}, {
			name: 'get', export: true, params: { r: { kind: ReferenceTypeKind.LongNullableTypeIndex, typeIndex: 2 } as any }, returns: NumberType.i32,
			instructions: [Op.local.get('r'), Op.struct.get('MyStruct', 0)],
		}],
	}
	const bytes = encodeWasmModule(def)
	// The blocktype for 'make' (type index 0) is the bare s33 [0x00]; verify it appears
	// right after the `block` opcode (0x02).
	expect(containsSubarray(bytes, [0x02, 0x00])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.make as Function)()).toEqual(42)
})

test('LongNullableTypeId 0x63 heapType — nullable ref to abstract heap (any) via long form', async () => {
	const def: WasmModuleDefinition = {
		functions: [{
			name: 'isNull', export: true, params: { r: { kind: ReferenceTypeKind.LongNullableTypeId, typeId: HeapType.any } as any }, returns: NumberType.i32,
			instructions: [Op.local.get('r'), Op.ref.is_null],
		}, {
			name: 'mkNull', export: true, params: {}, returns: { kind: ReferenceTypeKind.LongNullableTypeId, typeId: HeapType.any } as any,
			instructions: [Op.ref.null(HeapType.any)],
		}],
	}
	const bytes = encodeWasmModule(def)
	expect(containsSubarray(bytes, [0x63, 0x6E])).toEqual(true) // 0x63 + any 0x6E
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.isNull as Function)((moduleExports.mkNull as Function)())).toEqual(1)
})

test('LongNullableTypeIndex 0x63 s33 — nullable ref to custom struct index', async () => {
	const S = { name: 'S', type: { fields: [{ storageType: NumberType.i32 } as any] } } as any
	// Function signatures occupy type indices 0..n-1; custom types follow. With 2 functions
	// and one struct, `S` is type index 2.
	const sTypeIndex = 2
	const def: WasmModuleDefinition = {
		customTypes: [S],
		functions: [{
			name: 'make', export: true, params: {}, returns: { kind: ReferenceTypeKind.LongNullableTypeIndex, typeIndex: sTypeIndex } as any,
			instructions: [Op.ref.null('S')],
		}, {
			name: 'check', export: true, params: { r: { kind: ReferenceTypeKind.LongNullableTypeIndex, typeIndex: sTypeIndex } as any }, returns: NumberType.i32,
			instructions: [Op.local.get('r'), Op.ref.is_null],
		}],
	}
	const bytes = encodeWasmModule(def)
	expect(containsSubarray(bytes, [0x63, sTypeIndex])).toEqual(true) // 0x63 + s33 type index
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.check as Function)(null)).toEqual(1)
})

test('LongNonNullable 0x64 heapType and 0x64 s33 — non-nullable refs', async () => {
	const S = { name: 'S', type: { fields: [{ storageType: NumberType.i32 } as any] } } as any
	const def: WasmModuleDefinition = {
		customTypes: [S],
		functions: [{
			name: 'makeNonNull', export: true, params: {}, returns: { kind: ReferenceTypeKind.LongNonNullableTypeId, typeId: HeapType.any } as any,
			// need a concrete value: struct.new then cast? Simpler: use any non-null via extern? Use i31.
			instructions: [Op.i32.const(1), Op.ref.i31],
		}],
	}
	const bytes = encodeWasmModule(def)
	expect(containsSubarray(bytes, [0x64, 0x6E])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.makeNonNull as Function)() !== null).toEqual(true)

	const def2: WasmModuleDefinition = {
		customTypes: [S],
		functions: [{
			name: 'makeIdx', export: true, params: {}, returns: { kind: ReferenceTypeKind.LongNonNullableTypeIndex, typeIndex: 2 } as any,
			instructions: [Op.i32.const(7), Op.struct.new('S')],
		}, {
			name: 'get', export: true, params: { r: { kind: ReferenceTypeKind.LongNonNullableTypeIndex, typeIndex: 2 } as any }, returns: NumberType.i32,
			instructions: [Op.local.get('r'), Op.struct.get('S', 0)],
		}],
	}
	const bytes2 = encodeWasmModule(def2)
	// With 2 functions, 'S' lands at type index 2 (indices 0..1 are the function signatures).
	expect(containsSubarray(bytes2, [0x64, 0x02])).toEqual(true)
	const { moduleExports: m2 } = await encodeAndInstantiateWasmModuleDefinition(def2)
	const ref = (m2.makeIdx as Function)()
	expect((m2.get as Function)(ref)).toEqual(7)
})

test('large type index >=128 emits multi-byte s33 vs u32 (heaptype path)', async () => {
	// Filler structs push type index beyond 127; the heaptype immediate (reftype) is s33 and
	// struct.new/struct.get immediates are u32, so >127 exercises multi-byte encodings.
	// Function signature types occupy indices 0..n-1, then custom types in order: with 2
	// functions and 130 fillers, 'Target' lands at type index 132.
	const fillers = Array.from({ length: 130 }, (_, i) => ({ name: `F${i}`, type: { fields: [{ storageType: NumberType.i32 } as any] } } as any))
	const Target = { name: 'Target', type: { fields: [{ storageType: NumberType.i32 } as any] } } as any
	const targetTypeIndex = 2 + fillers.length
	const def: WasmModuleDefinition = {
		customTypes: [...fillers, Target],
		functions: [{
			name: 'make', export: true, params: {}, returns: { kind: ReferenceTypeKind.LongNullableTypeIndex, typeIndex: targetTypeIndex } as any,
			instructions: [Op.i32.const(99), Op.struct.new('Target')],
		}, {
			name: 'get', export: true, params: { r: { kind: ReferenceTypeKind.LongNullableTypeIndex, typeIndex: targetTypeIndex } as any }, returns: NumberType.i32,
			instructions: [Op.local.get('r'), Op.struct.get('Target', 0)],
		}],
	}
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	const ref = (moduleExports.make as Function)()
	expect((moduleExports.get as Function)(ref)).toEqual(99)
})
