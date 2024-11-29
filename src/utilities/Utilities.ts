export function encodeUTF8(str: string) {
	const textEncoder = new TextEncoder()

	return textEncoder.encode(str)
}

export function float64ToBytes(num: number) {
	const float64Array = Float64Array.from([num])

	return new Uint8Array(float64Array.buffer)
}

export function float32ToBytes(num: number) {
	const float32Array = Float32Array.from([num])

	return new Uint8Array(float32Array.buffer)
}

export function roundToDigits(val: number, digits = 3) {
	const multiplier = 10 ** digits

	return Math.round(val * multiplier) / multiplier
}

export function isNumber(value: any): value is number {
	return typeof value === 'number'
}

export function isString(value: any): value is string {
	return typeof value === 'string'
}


export function isBigInt(value: any): value is bigint {
	return typeof value === 'bigint'
}

export function isObject(value: any): value is object {
	return typeof value === 'object' && !Array.isArray(value)
}

export function isArray(value: any): value is any[] {
	return Array.isArray(value)
}

export function bigInt128ToLittleEndianBytes(bigInt128: bigint) {
	const bytes = new Uint8Array(16)

	for (let i = 0; i < 16; i++) {
		bytes[0] = Number(bigInt128 & 0xffn)

		bigInt128 >>= 8n
	}

	return bytes
}
