import { Subtype, SubtypeOrRecursiveType, StorageType, ReferenceType, ReferenceTypeKind, TypeEntryLayout, ForwardReferenceGroup } from './Types.js'
import { isRecursiveType, isArrayType, isStructType, isFunctionSignature } from './Predicates.js'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Forward-reference analysis for the types section.
//
// Types are validated incrementally per the spec (`valid/modules.md`): each type definition only
// sees the types defined before it (and, if it is part of a `rec` group, its fellow group members).
// The module encoder emits function signature types before custom types, so a signature such as
// `func () -> (ref null $struct)` is a *forward* reference the engine rejects ("Type index N is out
// of bounds"). Custom types may likewise forward-reference later custom types.
//
// The spec-shaped remedy is a recursive type group (`0x4E`): all members of a `rec` group are
// mutually visible (`valid/types.md`), so the entries spanning a forward reference can share one
// group. Recursive entries nested in the group are flattened, which is the spec's own shorthand
// equivalence (`rec (st)` = `st` for unary groups).
//////////////////////////////////////////////////////////////////////////////////////////////////////

function layoutTypeEntries(types: SubtypeOrRecursiveType[]): TypeEntryLayout[] {
	const layout: TypeEntryLayout[] = []
	let nextTypeIndex = 0

	types.forEach((entry, entryIndex) => {
		const subtypes = isRecursiveType(entry) ? entry.subtypes : [entry as Subtype]
		layout.push({ start: nextTypeIndex, subtypeCount: subtypes.length, entryIndex, subtypes })
		nextTypeIndex += subtypes.length
	})

	return layout
}

function collectReferencedTypeIndexes(subtype: Subtype, into: number[]) {
	const collectValueType = (valueType: StorageType) => {
		if (typeof valueType === 'object' && valueType !== null && 'kind' in valueType) {
			const kind = (valueType as ReferenceType).kind

			if (kind === ReferenceTypeKind.ShortTypeIndex ||
				kind === ReferenceTypeKind.LongNullableTypeIndex ||
				kind === ReferenceTypeKind.LongNonNullableTypeIndex) {
				into.push((valueType as { typeIndex: number }).typeIndex)
			}
		}
	}

	const type = subtype.type

	if (isFunctionSignature(type)) {
		type.paramTypes.forEach(collectValueType)
		type.returnTypes.forEach(collectValueType)
	} else if (isStructType(type)) {
		type.fields.forEach(field => collectValueType(field.storageType))
	} else if (isArrayType(type)) {
		collectValueType(type.storageType)
	}
}

// Determines the leading recursive group needed to satisfy forward type references: a span of
// consecutive type entries that must share one `rec` group so that every referenced type is
// visible when the type section is validated incrementally. Returns `undefined` when no forward
// reference exists (the common case, which keeps the emitted encoding minimal).
export function computeForwardReferenceGroup(types: SubtypeOrRecursiveType[]): ForwardReferenceGroup | undefined {
	const layout = layoutTypeEntries(types)

	if (layout.length === 0) {
		return undefined
	}

	const totalCount = layout.reduce((sum, entry) => sum + entry.subtypeCount, 0)

	let lastTypeEnd = -1
	let firstStart = totalCount

	const forEachForwardReference = (apply: (originStart: number, referencedEnd: number) => void) => {
		for (const entry of layout) {
			const entryEnd = entry.start + entry.subtypeCount
			const referencedIndexes: number[] = []

			for (const subtype of entry.subtypes) {
				collectReferencedTypeIndexes(subtype, referencedIndexes)
			}

			for (const referencedIndex of referencedIndexes) {
				if (referencedIndex >= entryEnd && referencedIndex < totalCount) {
					apply(entry.start, referencedIndex + 1)
				}
			}
		}
	}

	forEachForwardReference((originStart, referencedEnd) => {
		firstStart = Math.min(firstStart, originStart)
		lastTypeEnd = Math.max(lastTypeEnd, referencedEnd)
	})

	if (lastTypeEnd < 0) {
		return undefined
	}

	// Entries pulled into the span itself may forward-reference types beyond it; expand the
	// span until it is closed under forward references.
	let changed = true

	while (changed) {
		changed = false

		forEachForwardReference((originStart, referencedEnd) => {
			if (originStart >= firstStart && originStart < lastTypeEnd && referencedEnd > lastTypeEnd) {
				lastTypeEnd = referencedEnd
				changed = true
			}
		})
	}

	// The group spans every entry overlapping [firstStart, lastTypeEnd).
	const groupEntries = layout.filter(entry => entry.start < lastTypeEnd && entry.start + entry.subtypeCount > firstStart)
	const firstEntry = Math.min(...groupEntries.map(entry => entry.entryIndex))
	const entryCount = Math.max(...groupEntries.map(entry => entry.entryIndex)) - firstEntry + 1

	return { firstEntry, entryCount, subtypeCount: lastTypeEnd - firstStart }
}
