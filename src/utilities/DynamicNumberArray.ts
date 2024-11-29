import { DynamicNumericArray } from './DynamicArray.js'

export function createDynamicNumberArray() {
	return new DynamicNumberArray()
}

export class DynamicNumberArray implements DynamicNumericArray {
	private elements: number[] = []

	addValue(newValue: number) {
		this.elements.push(newValue)
	}

	addValues(newValues: ArrayLike<number>) {
		for (let i = 0; i < newValues.length; i++) {
			this.elements.push(newValues[i])
		}
	}

	clear() {
		this.elements.length = 0
	}

	get values() {
		return this.elements
	}

	get length() {
		return this.elements.length
	}
}
