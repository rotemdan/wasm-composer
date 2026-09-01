import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../src/exports/Exports.ts'
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

// TASK-12 blocktype variants, TASK-14 br_table + select_with_type (0x1C)

test('block void emits 0x40 and loop void emits 0x40', async () => {
	const def: WasmModuleDefinition = {
		functions: [{
			name: 'run',
			export: true,
			returns: NumberType.i32,
			instructions: [
				Op.block({ name: 'B' }, [
					Op.nop,
				]),
				Op.loop({ name: 'L' }, [
					Op.br('L'),
				]),
				Op.i32.const(7),
			],
		}],
	}
	// loop with unconditional br would be infinite — we break immediately via block fallback?
	// Use a simpler validated form: block void then loop void that breaks immediately
	const simple: WasmModuleDefinition = {
		functions: [{
			name: 'run',
			export: true,
			returns: NumberType.i32,
			instructions: [
				Op.block({ name: 'B' }, [ Op.nop ]),
				Op.i32.const(7),
			],
		}],
	}
	const bytes = encodeWasmModule(simple)
	expect(containsSubarray(bytes, [0x02, 0x40])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(simple)
	expect((moduleExports.run as Function)()).toEqual(7)

	const loopDef: WasmModuleDefinition = {
		functions: [{
			name: 'run',
			export: true,
			returns: NumberType.i32,
			instructions: [
				Op.block({ name: 'outer' }, [
					Op.loop({ name: 'L' }, [
						Op.br('outer'),
					]),
				]),
				Op.i32.const(9),
			],
		}],
	}
	const loopBytes = encodeWasmModule(loopDef)
	expect(containsSubarray(loopBytes, [0x03, 0x40])).toEqual(true)
	const { moduleExports: m2 } = await encodeAndInstantiateWasmModuleDefinition(loopDef)
	expect((m2.run as Function)()).toEqual(9)
})

test('block with single valtype i32 emits 0x7F and returns value', async () => {
	const def: WasmModuleDefinition = {
		functions: [{
			name: 'run',
			export: true,
			returns: NumberType.i32,
			instructions: [
				Op.block({ name: 'B', returns: NumberType.i32 }, [
					Op.i32.const(42),
				]),
			],
		}],
	}
	const bytes = encodeWasmModule(def)
	expect(containsSubarray(bytes, [0x02, 0x7F])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.run as Function)()).toEqual(42)
})

test('block with multi-value type string emits s33 type index', async () => {
	// Define a function signature type with two i32 returns
	const TwoI32 = { name: 'TwoI32', type: { paramTypes: [], returnTypes: [NumberType.i32, NumberType.i32] } as any }
	const def: WasmModuleDefinition = {
		customTypes: [TwoI32],
		functions: [{
			name: 'run',
			export: true,
			returns: [NumberType.i32, NumberType.i32],
			instructions: [
				Op.block({ name: 'B', returns: 'TwoI32' }, [
					Op.i32.const(10),
					Op.i32.const(20),
				]),
			],
		}],
	}
	const bytes = encodeWasmModule(def)
	// There is 1 function type (run: []->[i32,i32]) at index 0, then custom type TwoI32 at index 1.
	// blocktype for TwoI32 must be s33 0x01 (LEB of 1)
	expect(containsSubarray(bytes, [0x02, 0x01])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	expect((moduleExports.run as Function)()).toEqual([10, 20])
})

test('select plain 0x1B is polymorphic, select with type 0x1C encodes result types', async () => {
	const plain: WasmModuleDefinition = {
		functions: [{
			name: 'sel',
			export: true,
			params: { c: NumberType.i32 },
			returns: NumberType.i32,
			instructions: [
				Op.i32.const(100),
				Op.i32.const(200),
				Op.local.get('c'),
				Op.select(),
			],
		}],
	}
	const plainBytes = encodeWasmModule(plain)
	expect(containsSubarray(plainBytes, [0x1B])).toEqual(true)
	const { moduleExports: m1 } = await encodeAndInstantiateWasmModuleDefinition(plain)
	expect((m1.sel as Function)(0)).toEqual(200)
	expect((m1.sel as Function)(1)).toEqual(100)

	const typed: WasmModuleDefinition = {
		functions: [{
			name: 'sel',
			export: true,
			params: { c: NumberType.i32 },
			returns: NumberType.i32,
			instructions: [
				Op.i32.const(100),
				Op.i32.const(200),
				Op.local.get('c'),
				Op.select([NumberType.i32]),
			],
		}],
	}
	const typedBytes = encodeWasmModule(typed)
	// select_with_type opcode 0x1C, vec 1, valtype i32 0x7F
	expect(containsSubarray(typedBytes, [0x1C, 0x01, 0x7F])).toEqual(true)
	const { moduleExports: m2 } = await encodeAndInstantiateWasmModuleDefinition(typed)
	expect((m2.sel as Function)(0)).toEqual(200)
	expect((m2.sel as Function)(1)).toEqual(100)

	const multi: WasmModuleDefinition = {
		functions: [{
			name: 'sel2',
			export: true,
			params: { c: NumberType.i32 },
			returns: NumberType.i32,
			instructions: [
				Op.i64.const(1n),
				Op.i64.const(2n),
				Op.local.get('c'),
				Op.select([NumberType.i64]),
			],
			// need i64 return
		}],
	}
	// fix return type to i64
	multi.functions![0].returns = NumberType.i64
	const multiBytes = encodeWasmModule(multi)
	expect(containsSubarray(multiBytes, [0x1C, 0x01, 0x7E])).toEqual(true)
	const { moduleExports: m3 } = await encodeAndInstantiateWasmModuleDefinition(multi)
	expect((m3.sel2 as Function)(0)).toEqual(2n)
	expect((m3.sel2 as Function)(1)).toEqual(1n)
})

test('br_table with 3 targets resolves via blockStack', async () => {
	const def: WasmModuleDefinition = {
		functions: [{
			name: 'dispatch',
			export: true,
			params: { n: NumberType.i32 },
			returns: NumberType.i32,
			instructions: [
				Op.block({ name: 'A' }, [
					Op.block({ name: 'B' }, [
						Op.block({ name: 'C' }, [
							Op.local.get('n'),
							Op.br_table(['A', 'B', 'C'], 'C'),
						]),
						Op.i32.const(3), Op.return,
					]),
					Op.i32.const(2), Op.return,
				]),
				Op.i32.const(1), Op.return,
				Op.i32.const(99),
			],
		}],
	}
	const bytes = encodeWasmModule(def)
	expect(containsSubarray(bytes, [0x0E])).toEqual(true)
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	const dispatch = moduleExports.dispatch as Function
	// br_table index 0 -> A (outermost), 1 -> B, 2 -> C, default C
	// Stack layout inside innermost block: [C, B, A] => index of A=2, B=1, C=0
	// So n=0 selects A => returns 1, n=1 selects B => 2, n=2 selects C => 3
	expect(dispatch(0)).toEqual(1)
	expect(dispatch(1)).toEqual(2)
	expect(dispatch(2)).toEqual(3)
	expect(dispatch(99)).toEqual(3) // default C
})
