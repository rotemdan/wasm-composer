import { DynamicNumericArray } from './DynamicArray.js'

export function createDynamicUint8Array(initialCapacity?: number) {
	return new DynamicUint8Array(initialCapacity)
}

export class DynamicUint8Array implements DynamicNumericArray {
	private bytes: Uint8Array
	private byteCount = 0

	constructor(initialCapacity = 4) {
		this.bytes = new Uint8Array(initialCapacity)
	}

	appendValue(newValue: number) {
		if (this.byteCount >= this.capacity) {
			this.ensureCapacity(this.byteCount + 1)
		}

		this.bytes[this.byteCount] = newValue

		this.byteCount += 1
	}

	appendValues(newValues: ArrayLike<number>) {
		const addedCount = newValues.length
		const requiredCapacity = this.byteCount + addedCount

		if (requiredCapacity > this.capacity) {
			this.ensureCapacity(requiredCapacity)
		}

		this.bytes.set(newValues, this.byteCount)
		this.byteCount += addedCount
	}

	ensureCapacity(requiredCapacity: number) {
		if (requiredCapacity > this.capacity) {
			const newCapacity = requiredCapacity * 2

			const newElements = new Uint8Array(newCapacity)
			newElements.set(this.values)

			this.bytes = newElements
		}
	}

	clear() {
		this.byteCount = 0
	}

	get length() {
		return this.byteCount
	}

	get values() {
		return this.bytes.subarray(0, this.byteCount)
	}

	private get capacity() {
		return this.bytes.length
	}
}
