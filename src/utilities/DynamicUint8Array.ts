import { DynamicNumericArray } from './DynamicArray.js'

export function createDynamicUint8Array(initialCapacity?: number) {
	return new DynamicUint8Array(initialCapacity)
}

export class DynamicUint8Array implements DynamicNumericArray {
	private elements: Uint8Array
	length = 0

	constructor(initialCapacity = 4) {
		this.elements = new Uint8Array(initialCapacity)
	}

	appendValue(newValue: number) {
		if (this.length >= this.capacity) {
			this.ensureCapacity(this.length + 1)
		}

		this.elements[this.length++] = newValue
	}

	appendValues(newValues: ArrayLike<number>) {
		const addedCount = newValues.length
		const requiredCapacity = this.length + addedCount

		if (requiredCapacity > this.capacity) {
			this.ensureCapacity(requiredCapacity)
		}

		this.elements.set(newValues, this.length)
		this.length += addedCount
	}

	ensureCapacity(requiredCapacity: number) {
		if (requiredCapacity > this.capacity) {
			const newCapacity = requiredCapacity * 2

			const newElements = new Uint8Array(newCapacity)
			newElements.set(this.values)

			this.elements = newElements
		}
	}

	clear() {
		this.length = 0
	}

	get values() {
		return this.elements.subarray(0, this.length)
	}

	private get capacity() {
		return this.elements.length
	}
}
