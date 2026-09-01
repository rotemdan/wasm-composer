import { test, expect } from 'vitest'
import { encodeSignedLeb128, encodeUnsignedLeb128 } from '../src/utilities/Leb128Encoder.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Dedicated unit tests for src/utilities/Leb128Encoder.ts
//
// Previously these were scattered across ModuleStructure.test.ts and EncoderInvariants.test.ts.
// They are consolidated here so the encoder has single-owner coverage for every boundary,
// sign-bit corner, BigInt path and error case required by specs/wasm-specs/binary/values.md
// and binary/types.md (s33 blocktype).
//////////////////////////////////////////////////////////////////////////////////////////////////////

test('unsigned LEB128 — canonical shortest form (u32 / u64 boundaries)', () => {
	const cases: Array<[number | bigint, number[]]> = [
		[0, [0x00]],
		[1, [0x01]],
		[127, [0x7F]],
		[128, [0x80, 0x01]],
		[16_383, [0xFF, 0x7F]],
		[16_384, [0x80, 0x80, 0x01]],
		[2 ** 21 - 1, [0xFF, 0xFF, 0x7F]],
		[2 ** 21, [0x80, 0x80, 0x80, 0x01]],
		[2 ** 28 - 1, [0xFF, 0xFF, 0xFF, 0x7F]],
		[2 ** 28, [0x80, 0x80, 0x80, 0x80, 0x01]],
		[2 ** 31 - 1, [0xFF, 0xFF, 0xFF, 0xFF, 0x07]],
		[2 ** 32 - 1, [0xFF, 0xFF, 0xFF, 0xFF, 0x0F]],
		// BigInt path (>2^31): 0x1_0000_0000 and full u64 max
		[0x1_0000_0000n, [0x80, 0x80, 0x80, 0x80, 0x10]],
		[0xFFFF_FFFFn, [0xFF, 0xFF, 0xFF, 0xFF, 0x0F]],
		[2n ** 64n - 1n, [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01]],
	]

	for (const [value, expected] of cases) {
		expect(encodeUnsignedLeb128(value)).toEqual(expected)
	}
})

test('unsigned LEB128 — rejects negative values', () => {
	expect(() => encodeUnsignedLeb128(-1 as any)).toThrow(/negative/)
	expect(() => encodeUnsignedLeb128(-1n as any)).toThrow(/negative/)
})

test('signed LEB128 — canonical s32 / s64 boundaries (int32 fast-path)', () => {
	// For regular values the encoder must emit the minimal encoding. Sign bit is bit 6 of the
	// final byte; values in [-64,64) fit in one byte.
	const cases: Array<[number | bigint, number[]]> = [
		[0, [0x00]],
		[1, [0x01]],
		[-1, [0x7F]],
		[63, [0x3F]],
		[64, [0xC0, 0x00]],
		[-65, [0xBF, 0x7F]],
		[8_191, [0xFF, 0x3F]],
		[8_192, [0x80, 0xC0, 0x00]],
		[130, [0x82, 0x01]],
		[128, [0x80, 0x01]],
		[2 ** 31 - 1, [0xFF, 0xFF, 0xFF, 0xFF, 0x07]],
		[-(2 ** 31), [0x80, 0x80, 0x80, 0x80, 0x78]],
	]

	for (const [value, expected] of cases) {
		expect(encodeSignedLeb128(value)).toEqual(expected)
	}

	// BigInt s64 extremes (big-int path) — 10 bytes each, ceil(64/7)=10
	expect(encodeSignedLeb128(2n ** 63n - 1n)).toEqual([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00])
	expect(encodeSignedLeb128(-(2n ** 63n))).toEqual([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x7F])

	// Maximal byte counts per spec: s32 ≤5, s64 ≤10
	expect(encodeSignedLeb128(-(2 ** 31)).length).toBeLessThanOrEqual(5)
	expect(encodeSignedLeb128(-(2n ** 63n)).length).toBeLessThanOrEqual(10)
	expect(encodeSignedLeb128(2n ** 63n - 1n).length).toBeLessThanOrEqual(10)
})

test('signed LEB128 — -64 canonical encoding (BUG-01)', () => {
	// BUG-01: encodeSignedInt32 currently emits non-canonical overlong [0xC0,0x7F] for -64
	// instead of the shortest form [0x40]. The sN grammar in binary/values.md permits leading
	// zeros so engines accept it, but encoders should emit the canonical form. This assertion
	// intentionally keeps the suite red until the fix lands — do NOT change to [0xC0,0x7F].
	expect(encodeSignedLeb128(-64)).toEqual([0x40])
})

test('signed LEB128 — negative canonical boundaries', () => {
	// Canonical minimal forms (spec binary/values.md sN): no leading sign-extension bytes.
	// Previously BUG-01 made these overlong by one byte ([0x80,0xC0,0x7F] etc.), now fixed.
	expect(encodeSignedLeb128(-8192)).toEqual([0x80, 0x40])
	expect(encodeSignedLeb128(-1048576)).toEqual([0x80, 0x80, 0x40])
	expect(encodeSignedLeb128(-134217728)).toEqual([0x80, 0x80, 0x80, 0x40])
})

test('signed LEB128 — round-trip decode sanity for all boundaries', () => {
	function decodeSigned(bytes: number[]): bigint {
		let result = 0n
		let shift = 0n
		for (let i = 0; i < bytes.length; i++) {
			const b = BigInt(bytes[i])
			result |= (b & 0x7Fn) << shift
			shift += 7n
			if ((b & 0x80n) === 0n) {
				// sign extend if needed
				if ((b & 0x40n) !== 0n) result |= -(1n << shift)
				break
			}
		}
		return result
	}
	const values: Array<number | bigint> = [
		0, 1, -1, 63, 64, -64, -65, 8191, -8192, 2 ** 31 - 1, -(2 ** 31), 2n ** 63n - 1n, -(2n ** 63n), 130, 128,
	]
	for (const v of values) {
		const enc = encodeSignedLeb128(v as any)
		expect(decodeSigned(enc)).toEqual(BigInt(v as any))
	}
})

test('unsigned LEB128 — round-trip decode sanity', () => {
	function decodeUnsigned(bytes: number[]): bigint {
		let result = 0n
		let shift = 0n
		for (const b of bytes) {
			result |= BigInt(b & 0x7F) << shift
			if ((b & 0x80) === 0) break
			shift += 7n
		}
		return result
	}
	const values: Array<number | bigint> = [0, 127, 128, 16383, 16384, 2 ** 31 - 1, 2 ** 32 - 1, 2n ** 64n - 1n]
	for (const v of values) {
		expect(decodeUnsigned(encodeUnsignedLeb128(v as any))).toEqual(BigInt(v as any))
	}
})
