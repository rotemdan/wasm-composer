export interface DynamicNumericArray {
	addValue(newValue: number): void
	addValues(newValues: ArrayLike<number>): void
	clear(): void

	values: ArrayLike<number>
	length: number
}
