////////////////////////////////////////////////////////////////////////////////////////////////////
// Unsigned encoders
////////////////////////////////////////////////////////////////////////////////////////////////////
export function encodeUnsignedLeb128(value: number | bigint) {
	if (value < 0) {
		throw new Error(`The negative value ${value} can't be encoded as an unsigned LEB128 integer.`)
	}

	if (typeof value === 'number') {
		if (value < 2 ** 31) {
			return encodeUnsignedInt31(value)
		} else {
			return encodeUnsignedBigInt(BigInt(value))
		}
	} else {
		return encodeUnsignedBigInt(value)
	}
}

function encodeUnsignedInt31(value: number) {
	if (value < (2 ** 7)) {
		return [
			value
		]
	} else if (value < (2 ** 14)) {
		return [
			(value & 0b01111111) | 0b10000000,
			value >>> 7
		]
	} else if (value < (2 ** 21)) {
		return [
			(value & 0b01111111) | 0b10000000,
			((value >>> 7) & 0b01111111) | 0b10000000,
			value >>> 14
		]
	} else if (value < (2 ** 28)) {
		return [
			(value & 0b01111111) | 0b10000000,
			((value >>> 7) & 0b01111111) | 0b10000000,
			((value >>> 14) & 0b01111111) | 0b10000000,
			value >>> 21
		]
	} else {
		return [
			(value & 0b01111111) | 0b10000000,
			((value >>> 7) & 0b01111111) | 0b10000000,
			((value >>> 14) & 0b01111111) | 0b10000000,
			((value >>> 21) & 0b01111111) | 0b10000000,
			value >>> 28
		]
	}
}

function encodeUnsignedBigInt(value: bigint) {
	const output: number[] = []

	while (true) {
		const lowest7Bits = Number(value & 127n)

		value = value >> 7n

		if (value === 0n) {
			output.push(lowest7Bits)

			return output
		}

		output.push(lowest7Bits | 128)
	}
}

////////////////////////////////////////////////////////////////////////////////////////////////////
// Signed encoders
////////////////////////////////////////////////////////////////////////////////////////////////////
export function encodeSignedLeb128(value: number | bigint) {
	if (typeof value === 'number') {
		if (value >= -2147483648 && value <= 2147483647) {
			return encodeSignedInt32(value)
		} else {
			return encodeSignedBigInt(BigInt(value))
		}
	} else {
		return encodeSignedBigInt(value)
	}
}

function encodeSignedInt32(value: number) {
	const absValue = Math.abs(value | 0)

	if (absValue < (2 ** 6)) {
		return [
			(value & 0b01111111)
		]
	} else if (absValue < (2 ** 13)) {
		return [
			(value & 0b01111111) | 0b10000000,
			(value >> 7) & 0b01111111
		]
	} else if (absValue < (2 ** 20)) {
		return [
			(value & 0b01111111) | 0b10000000,
			((value >> 7) & 0b01111111) | 0b10000000,
			(value >> 14) & 0b01111111
		]
	} else if (absValue < (2 ** 27)) {
		return [
			(value & 0b01111111) | 0b10000000,
			((value >> 7) & 0b01111111) | 0b10000000,
			((value >> 14) & 0b01111111) | 0b10000000,
			(value >> 21) & 0b01111111
		]
	} else {
		return [
			(value & 0b01111111) | 0b10000000,
			((value >> 7) & 0b01111111) | 0b10000000,
			((value >> 14) & 0b01111111) | 0b10000000,
			((value >> 21) & 0b01111111) | 0b10000000,
			(value >> 28) & 0b01111111
		]
	}
}

function encodeSignedBigInt(value: bigint) {
	const output: number[] = []

	while (true) {
		const lowest7Bits = Number(value & 127n)

		const signBit = lowest7Bits & 64

		value = value >> 7n

		if ((value === 0n && signBit === 0) || (value === -1n && signBit !== 0)) {
			output.push(lowest7Bits)

			return output
		} else {
			output.push(lowest7Bits | 128)
		}
	}
}
