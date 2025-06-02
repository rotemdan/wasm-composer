export interface DynamicNumericArray {
	appendValue(newValue: number): void
	appendValues(newValues: ArrayLike<number>): void
	clear(): void

	values: ArrayLike<number>
	length: number
}
