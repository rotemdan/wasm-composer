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

// TASK-05: every load/store width with explicit memoryName must set bit-6 (align|0x40 + memidx)
test('default (no memoryName) keeps plain memarg form vs explicit sets bit-6', async () => {
	const plainBytes = encodeWasmModule({
		memories: [{ name: 'm', minimum: 1 }],
		functions: [{ name: 'f', params: {}, returns: NumberType.i32, instructions: [Op.i32.const(0), Op.i32.load(2, 0)] }],
	})
	expect(containsSubarray(plainBytes, [0x28, 0x02, 0x00])).toEqual(true)
	expect(containsSubarray(plainBytes, [0x28, 0x42])).toEqual(false)

	const namedBytes = encodeWasmModule({
		memories: [{ name: 'memA', minimum: 1 }, { name: 'memB', minimum: 1 }],
		functions: [{ name: 'f', params: {}, returns: NumberType.i32, instructions: [Op.i32.const(0), Op.i32.load(2, 0, 'memB')] }],
	})
	// align 2 | 0x40 = 0x42, memidx 1 (memB), offset 0
	expect(containsSubarray(namedBytes, [0x28, 0x42, 0x01, 0x00])).toEqual(true)
})

test('all load widths with explicit memoryName encode memidx correctly', async () => {
	const cases: Array<{ op: (a:number,o:number,m?:string)=>any, opcode: number, align: number }> = [
		{ op: (a,o,m)=> Op.i32.load(a,o,m), opcode: 0x28, align: 2 },
		{ op: (a,o,m)=> Op.i64.load(a,o,m), opcode: 0x29, align: 3 },
		{ op: (a,o,m)=> Op.f32.load(a,o,m), opcode: 0x2A, align: 2 },
		{ op: (a,o,m)=> Op.f64.load(a,o,m), opcode: 0x2B, align: 3 },
		{ op: (a,o,m)=> Op.i32.load8_s(a,o,m), opcode: 0x2C, align: 0 },
		{ op: (a,o,m)=> Op.i32.load8_u(a,o,m), opcode: 0x2D, align: 0 },
		{ op: (a,o,m)=> Op.i32.load16_s(a,o,m), opcode: 0x2E, align: 1 },
		{ op: (a,o,m)=> Op.i32.load16_u(a,o,m), opcode: 0x2F, align: 1 },
		{ op: (a,o,m)=> Op.i64.load8_s(a,o,m), opcode: 0x30, align: 0 },
		{ op: (a,o,m)=> Op.i64.load32_s(a,o,m), opcode: 0x34, align: 2 },
	]
	for (const { op, opcode, align } of cases) {
		const bytes = encodeWasmModule({
			memories: [{ name: 'memA', minimum: 1 }, { name: 'memB', minimum: 1 }],
			functions: [{ name: 'f', params: {}, returns: NumberType.i32, instructions: [Op.i32.const(0), op(align, 4, 'memA')] }],
		})
		// memA is idx 0 => [opcode, align|0x40, 0x00, offset 4]
		expect(containsSubarray(bytes, [opcode, align | 0x40, 0x00, 0x04])).toEqual(true)
	}
})

test('stores with explicit memoryName and memory isolation', async () => {
	const def: WasmModuleDefinition = {
		memories: [
			{ name: 'memA', minimum: 1, export: true },
			{ name: 'memB', minimum: 1, export: true },
		],
		functions: [
			{
				name: 'writeB',
				export: true,
				params: { v: NumberType.i32 },
				instructions: [Op.i32.const(0), Op.local.get('v'), Op.i32.store(2, 0, 'memB')],
			},
			{
				name: 'readA',
				export: true, returns: NumberType.i32,
				instructions: [Op.i32.const(0), Op.i32.load(2, 0, 'memA')],
			},
			{
				name: 'readB',
				export: true, returns: NumberType.i32,
				instructions: [Op.i32.const(0), Op.i32.load(2, 0, 'memB')],
			},
		],
	}
	const bytes = encodeWasmModule(def)
	expect(containsSubarray(bytes, [0x36, 0x42, 0x01, 0x00])).toEqual(true) // i32.store to memB
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(def)
	const writeB = moduleExports.writeB as Function
	const readA = moduleExports.readA as Function
	const readB = moduleExports.readB as Function
	writeB(0x12345678)
	expect(readB()).toEqual(0x12345678)
	expect(readA()).toEqual(0) // memA untouched
})
