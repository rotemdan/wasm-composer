import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../../exports/Exports.js'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'

test('i32x4.extract_lane reads individual lanes out of a v128.const', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'lane2',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.v128.const(i32x4(10, 20, 30, 40)),
					Op.i32x4.extract_lane(2),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const lane2 = moduleExports.lane2 as Function

	expect(lane2()).toEqual(30)
})

test('i32x4 arithmetic (add/sub/mul/min_s/max_s) round-trips through memory', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'i32x4Arithmetic',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.v128.const(i32x4(1, 2, 3, 4)),
					Op.v128.const(i32x4(4, 3, 2, 1)),
					Op.i32x4.add,
					Op.v128.store(0, 0),

					Op.i32.const(0),
					Op.v128.const(i32x4(1, 2, 3, 4)),
					Op.v128.const(i32x4(4, 3, 2, 1)),
					Op.i32x4.sub,
					Op.v128.store(0, 16),

					Op.i32.const(0),
					Op.v128.const(i32x4(1, 2, 3, 4)),
					Op.v128.const(i32x4(4, 3, 2, 1)),
					Op.i32x4.mul,
					Op.v128.store(0, 32),

					Op.i32.const(0),
					Op.v128.const(i32x4(1, 2, 3, 4)),
					Op.v128.const(i32x4(4, 3, 2, 1)),
					Op.i32x4.min_s,
					Op.v128.store(0, 48),

					Op.i32.const(0),
					Op.v128.const(i32x4(1, 2, 3, 4)),
					Op.v128.const(i32x4(4, 3, 2, 1)),
					Op.i32x4.max_s,
					Op.v128.store(0, 64),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.i32x4Arithmetic as Function)()

	const buffer = memoryBuffer(moduleExports)

	expect(readI32(buffer, 0)).toEqual([5, 5, 5, 5])
	expect(readI32(buffer, 16)).toEqual([-3, -1, 1, 3])
	expect(readI32(buffer, 32)).toEqual([4, 6, 6, 4])
	expect(readI32(buffer, 48)).toEqual([1, 2, 2, 1])
	expect(readI32(buffer, 64)).toEqual([4, 3, 3, 4])
})

test('i8x16 swizzle, relaxed_swizzle, and shuffle', async () => {
	const indices = i8x16(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
	const table = i8x16(15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0)

	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'swizzleShuffle',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// swizzle: result[k] = table[indices[k]]
					Op.i32.const(0),
					Op.v128.const(indices),
					Op.v128.const(table),
					Op.i8x16.swizzle,
					Op.v128.store(0, 0),

					// relaxed_swizzle behaves identically for in-range indices
					Op.i32.const(0),
					Op.v128.const(indices),
					Op.v128.const(table),
					Op.i8x16.relaxed_swizzle,
					Op.v128.store(0, 16),

					// shuffle selects from (v1 || v2); 0..15 -> v1, 16..31 -> v2
					Op.i32.const(0),
					Op.v128.const(indices),
					Op.v128.const(table),
					Op.i8x16.shuffle([0, 1, 2, 3, 16, 17, 18, 19, 4, 5, 6, 7, 20, 21, 22, 23]),
					Op.v128.store(0, 32),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.swizzleShuffle as Function)()

	const buffer = memoryBuffer(moduleExports)

	expect(readI8(buffer, 0)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
	expect(readI8(buffer, 16)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
	expect(readI8(buffer, 32)).toEqual([0, 1, 2, 3, 15, 14, 13, 12, 4, 5, 6, 7, 11, 10, 9, 8])
})

test('i32x4.eq comparison mask and v128 bitwise and/or/xor/not', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'masksAndBitwise',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// eq mask: [1,2,3,4] == [1,9,3,9] => [-1, 0, -1, 0]
					Op.i32.const(0),
					Op.v128.const(i32x4(1, 2, 3, 4)),
					Op.v128.const(i32x4(1, 9, 3, 9)),
					Op.i32x4.eq,
					Op.v128.store(0, 0),

					// bitwise on two fixed vectors
					Op.i32.const(0),
					Op.v128.const(i32x4(0x0000FFFF, 0xFFFFFFFF, 0, 0x12345678)),
					Op.v128.const(i32x4(0xFFFF0000, 0x0F0F0F0F, 0xFFFFFFFF, 0x12345678)),
					Op.v128.and,
					Op.v128.store(0, 16),

					Op.i32.const(0),
					Op.v128.const(i32x4(0x0000FFFF, 0xFFFFFFFF, 0, 0x12345678)),
					Op.v128.const(i32x4(0xFFFF0000, 0x0F0F0F0F, 0xFFFFFFFF, 0x12345678)),
					Op.v128.or,
					Op.v128.store(0, 32),

					Op.i32.const(0),
					Op.v128.const(i32x4(0x0000FFFF, 0xFFFFFFFF, 0, 0x12345678)),
					Op.v128.const(i32x4(0xFFFF0000, 0x0F0F0F0F, 0xFFFFFFFF, 0x12345678)),
					Op.v128.xor,
					Op.v128.store(0, 48),

					Op.i32.const(0),
					Op.v128.const(i32x4(0x0000FFFF, 0xFFFFFFFF, 0, 0x12345678)),
					Op.v128.not,
					Op.v128.store(0, 64),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.masksAndBitwise as Function)()

	const buffer = memoryBuffer(moduleExports)

	expect(readI32(buffer, 0)).toEqual([-1, 0, -1, 0])
	expect(readI32(buffer, 16)).toEqual([0x00000000, 0x0F0F0F0F, 0, 0x12345678])
	expect(readI32(buffer, 32)).toEqual([-1, -1, -1, 305419896])
	expect(readI32(buffer, 48)).toEqual([-1, -252645136, -1, 0])
	expect(readI32(buffer, 64)).toEqual([-65536, 0, -1, -305419897])
})

test('f32x4 arithmetic (add/mul/min/max) and sqrt', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'f32x4Ops',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.v128.const(f32x4(1, 2, 3, 4)),
					Op.v128.store(0, 0),
					Op.i32.const(0),
					Op.v128.const(f32x4(4, 3, 2, 1)),
					Op.v128.store(0, 16),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.i32.const(0),
					Op.v128.load(0, 16),
					Op.f32x4.add,
					Op.v128.store(0, 32),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.i32.const(0),
					Op.v128.load(0, 16),
					Op.f32x4.mul,
					Op.v128.store(0, 48),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.i32.const(0),
					Op.v128.load(0, 16),
					Op.f32x4.min,
					Op.v128.store(0, 64),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.i32.const(0),
					Op.v128.load(0, 16),
					Op.f32x4.max,
					Op.v128.store(0, 80),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.f32x4.sqrt,
					Op.v128.store(0, 96),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.f32x4Ops as Function)()

	const buffer = memoryBuffer(moduleExports)

	expectCloseTo(readF32(buffer, 32), [5, 5, 5, 5])
	expectCloseTo(readF32(buffer, 48), [4, 6, 6, 4])
	expectCloseTo(readF32(buffer, 64), [1, 2, 2, 1])
	expectCloseTo(readF32(buffer, 80), [4, 3, 3, 4])
	expectCloseTo(readF32(buffer, 96), [1, Math.SQRT2, Math.sqrt(3), 2])
})

test('f64x2 arithmetic (add/mul) and sqrt', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'f64x2Ops',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.v128.const(f64x2(1.5, 1.5)),
					Op.v128.store(0, 0),
					Op.i32.const(0),
					Op.v128.const(f64x2(2.5, 2.5)),
					Op.v128.store(0, 16),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.i32.const(0),
					Op.v128.load(0, 16),
					Op.f64x2.add,
					Op.v128.store(0, 32),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.i32.const(0),
					Op.v128.load(0, 16),
					Op.f64x2.mul,
					Op.v128.store(0, 48),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.f64x2.sqrt,
					Op.v128.store(0, 64),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.f64x2Ops as Function)()

	const buffer = memoryBuffer(moduleExports)

	expectCloseTo(readF64(buffer, 32), [4.0, 4.0])
	expectCloseTo(readF64(buffer, 48), [3.75, 3.75])
	expectCloseTo(readF64(buffer, 64), [Math.sqrt(1.5), Math.sqrt(1.5)])
})

test('i64x2 splat/replace_lane to build vectors, then add and shift', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'i64x2Ops',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// [10, 20]
					Op.i32.const(0),
					Op.i64.const(10n),
					Op.i64x2.splat,
					Op.i64.const(20n),
					Op.i64x2.replace_lane(1),
					Op.v128.store(0, 0),

					// [5, 5]
					Op.i32.const(0),
					Op.i64.const(5n),
					Op.i64x2.splat,
					Op.v128.store(0, 16),

					// [1, 1]
					Op.i32.const(0),
					Op.i64.const(1n),
					Op.i64x2.splat,
					Op.v128.store(0, 32),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 0),
					Op.i32.const(0),
					Op.v128.load(0, 16),
					Op.i64x2.add,
					Op.v128.store(0, 48),

					Op.i32.const(0),
					Op.i32.const(0),
					Op.v128.load(0, 32),
					Op.i32.const(4),
					Op.i64x2.shl,
					Op.v128.store(0, 64),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.i64x2Ops as Function)()

	const buffer = memoryBuffer(moduleExports)

	expect(readI64(buffer, 0)).toEqual([10n, 20n])
	expect(readI64(buffer, 16)).toEqual([5n, 5n])
	expect(readI64(buffer, 32)).toEqual([1n, 1n])
	expect(readI64(buffer, 48)).toEqual([15n, 25n])
	expect(readI64(buffer, 64)).toEqual([16n, 16n])
})

test('Relaxed SIMD: i32x4.relaxed_trunc_f32x4_s matches i32x4.trunc_sat_f32x4_s for normal inputs', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'relaxedTrunc',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.v128.const(f32x4(1.9, -2.7, 3.0, 100.4)),
					Op.i32x4.relaxed_trunc_f32x4_s,
					Op.v128.store(0, 0),

					Op.i32.const(0),
					Op.v128.const(f32x4(1.9, -2.7, 3.0, 100.4)),
					Op.i32x4.trunc_sat_f32x4_s,
					Op.v128.store(0, 16),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.relaxedTrunc as Function)()

	const buffer = memoryBuffer(moduleExports)

	expect(readI32(buffer, 0)).toEqual([1, -2, 3, 100])
	expect(readI32(buffer, 16)).toEqual([1, -2, 3, 100])
})

test('Relaxed SIMD: f32x4.relaxed_min matches f32x4.min for normal inputs', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'relaxedMin',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					Op.i32.const(0),
					Op.v128.const(f32x4(1, 5, 3, 8)),
					Op.v128.const(f32x4(2, 4, 4, 7)),
					Op.f32x4.relaxed_min,
					Op.v128.store(0, 0),

					Op.i32.const(0),
					Op.v128.const(f32x4(1, 5, 3, 8)),
					Op.v128.const(f32x4(2, 4, 4, 7)),
					Op.f32x4.min,
					Op.v128.store(0, 16),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.relaxedMin as Function)()

	const buffer = memoryBuffer(moduleExports)

	expectCloseTo(readF32(buffer, 0), [1, 4, 3, 7])
	expectCloseTo(readF32(buffer, 16), [1, 4, 3, 7])
})

test('Relaxed SIMD: i32x4.relaxed_laneselect selects per-lane from mask', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		memories: [{ name: 'memory', minimum: 1, export: true }],
		functions: [
			{
				name: 'relaxedLaneSelect',
				export: true,
				params: {},
				returns: NumberType.i32,
				instructions: [
					// mask all-ones => keep first operand
					Op.i32.const(0),
					Op.v128.const(i32x4(1, 2, 3, 4)),
					Op.v128.const(i32x4(9, 9, 9, 9)),
					Op.v128.const(mask16(0xFF)),
					Op.i32x4.relaxed_laneselect,
					Op.v128.store(0, 0),

					// mask all-zeros => keep second operand
					Op.i32.const(0),
					Op.v128.const(i32x4(1, 2, 3, 4)),
					Op.v128.const(i32x4(9, 9, 9, 9)),
					Op.v128.const(mask16(0x00)),
					Op.i32x4.relaxed_laneselect,
					Op.v128.store(0, 16),

					Op.i32.const(0),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
		; (moduleExports.relaxedLaneSelect as Function)()

	const buffer = memoryBuffer(moduleExports)

	expect(readI32(buffer, 0)).toEqual([1, 2, 3, 4])
	expect(readI32(buffer, 16)).toEqual([9, 9, 9, 9])
})

////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers to build 16-byte v128 immediate byte arrays (little-endian) and to read them back
// from the linear memory after a function stores a vector there.
////////////////////////////////////////////////////////////////////////////////////////////////
function i32x4(...lanes: number[]): number[] {
	const buffer = new ArrayBuffer(16)
	const view = new DataView(buffer)
	lanes.forEach((v, i) => view.setInt32(i * 4, v, true))
	return Array.from(new Uint8Array(buffer))
}

function i16x8(...lanes: number[]): number[] {
	const buffer = new ArrayBuffer(16)
	const view = new DataView(buffer)
	lanes.forEach((v, i) => view.setInt16(i * 2, v, true))
	return Array.from(new Uint8Array(buffer))
}

function i8x16(...lanes: number[]): number[] {
	return lanes.slice(0, 16)
}

function f32x4(...lanes: number[]): number[] {
	const buffer = new ArrayBuffer(16)
	const view = new DataView(buffer)
	lanes.forEach((v, i) => view.setFloat32(i * 4, v, true))
	return Array.from(new Uint8Array(buffer))
}

function f64x2(...lanes: number[]): number[] {
	const buffer = new ArrayBuffer(16)
	const view = new DataView(buffer)
	lanes.forEach((v, i) => view.setFloat64(i * 8, v, true))
	return Array.from(new Uint8Array(buffer))
}

function i64x2(...lanes: bigint[]): number[] {
	const buffer = new ArrayBuffer(16)
	const view = new DataView(buffer)
	lanes.forEach((v, i) => view.setBigInt64(i * 8, v, true))
	return Array.from(new Uint8Array(buffer))
}

// Build a 16-byte mask where every byte equals `fill` (e.g. 0xFF or 0x00).
function mask16(fill: number): number[] {
	return new Array(16).fill(fill)
}

function memoryBuffer(moduleExports: any): ArrayBuffer {
	return (moduleExports.memory as WebAssembly.Memory).buffer
}

function readI32(buffer: ArrayBuffer, offset: number): number[] {
	return Array.from(new Int32Array(buffer, offset, 4))
}

function readI16(buffer: ArrayBuffer, offset: number): number[] {
	return Array.from(new Int16Array(buffer, offset, 8))
}

function readI8(buffer: ArrayBuffer, offset: number): number[] {
	return Array.from(new Int8Array(buffer, offset, 16))
}

function readF32(buffer: ArrayBuffer, offset: number): number[] {
	return Array.from(new Float32Array(buffer, offset, 4))
}

function readF64(buffer: ArrayBuffer, offset: number): number[] {
	return Array.from(new Float64Array(buffer, offset, 2))
}

function readI64(buffer: ArrayBuffer, offset: number): bigint[] {
	return Array.from(new BigInt64Array(buffer, offset, 2))
}

function expectCloseTo(actual: number[], expected: number[], digits = 5) {
	expect(actual.length).toEqual(expected.length)
	for (let i = 0; i < actual.length; i++) {
		expect(actual[i]).toBeCloseTo(expected[i], digits)
	}
}
