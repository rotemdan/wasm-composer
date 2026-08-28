import { test, expect } from 'vitest'
import { encodeAndInstantiateWasmModuleDefinition } from './Common.js'
import { HeapType, NumberType, Op, ReferenceType, ReferenceTypeKind, WasmModuleDefinition } from '../../exports/Exports.js'

test('ref.null funcref is null', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'nullFuncIsNull',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [
					Op.ref.null(HeapType.func),
					Op.ref.is_null,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const nullFuncIsNull = moduleExports.nullFuncIsNull as Function

	expect(nullFuncIsNull()).toEqual(1)
})

test('ref.null externref is null', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'nullExternIsNull',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [
					Op.ref.null(HeapType.extern),
					Op.ref.is_null,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const nullExternIsNull = moduleExports.nullExternIsNull as Function

	expect(nullExternIsNull()).toEqual(1)
})

test('ref.func builds a funcref that call_ref can invoke', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'addOne',
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.i32.const(1),
					Op.i32.add,
				],
			},
			{
				name: 'callAddOne',
				export: true,

				params: { x: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					// call_ref expects the function reference on top, with the
					// call arguments pushed below it.
					Op.local.get('x'),
					Op.ref.func('addOne'),
					Op.call_ref('addOne'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const callAddOne = moduleExports.callAddOne as Function

	expect(callAddOne(41)).toEqual(42)
	expect(callAddOne(-7)).toEqual(-6)
})

test('ref.as_non_null of a non-null funcref stays non-null', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'addOne',
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.i32.const(1),
					Op.i32.add,
				],
			},
			{
				name: 'asNonNull',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [
					Op.ref.func('addOne'),
					Op.ref.as_non_null,
					Op.ref.is_null,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const asNonNull = moduleExports.asNonNull as Function

	expect(asNonNull()).toEqual(0)
})

test('ref.eq of two null funcrefs returns 1', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'nullsAreEqual',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [
					Op.ref.null(HeapType.eq),
					Op.ref.null(HeapType.eq),
					Op.ref.eq,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const nullsAreEqual = moduleExports.nullsAreEqual as Function

	expect(nullsAreEqual()).toEqual(1)
})

test('externref parameter is returned unchanged to JavaScript', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'identityExtern',
				export: true,

				params: { value: EXTERNREF },
				returns: EXTERNREF,

				instructions: [
					Op.local.get('value'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const identityExtern = moduleExports.identityExtern as Function

	expect(identityExtern(42)).toEqual(42)
	expect(identityExtern('hello')).toEqual('hello')
})

test('funcref stored in a local is non-null', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'addOne',
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.i32.const(1),
					Op.i32.add,
				],
			},
			{
				name: 'funcLocal',
				export: true,

				params: {},
				returns: NumberType.i32,

				locals: { f: FUNCREF },

				instructions: [
					Op.ref.func('addOne'),
					Op.local.set('f'),
					Op.local.get('f'),
					Op.ref.is_null,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const funcLocal = moduleExports.funcLocal as Function

	expect(funcLocal()).toEqual(0)
})

test('ref.as_non_null of a null funcref traps', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'trapOnNull',
				export: true,

				params: {},
				returns: NumberType.i32,

				instructions: [
					// A null funcref is not a valid (ref func), so as_non_null traps.
					Op.ref.null(HeapType.func),
					Op.ref.as_non_null,
					Op.ref.is_null,
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	expect(() => (moduleExports.trapOnNull as Function)()).toThrow()
})

test('function returning a funcref exposes a callable to JavaScript', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		functions: [
			{
				name: 'addOne',
				params: { x: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.local.get('x'),
					Op.i32.const(1),
					Op.i32.add,
				],
			},
			{
				name: 'makeAddOne',
				export: true,

				params: {},
				returns: FUNCREF,

				instructions: [
					Op.ref.func('addOne'),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const makeAddOne = moduleExports.makeAddOne as Function

	const fn = makeAddOne()
	expect(typeof fn).toEqual('function')
	expect(fn(5)).toEqual(6)
})

////////////////////////////////////////////////////////////////////////////////////////////////
// Shared reference-type fixtures used above as value types for params, locals,
// results and table element types. Kept at the bottom alongside the helpers.
////////////////////////////////////////////////////////////////////////////////////////////////

// `funcref` is the short (single-byte) form of `(ref null func)`.
const FUNCREF: ReferenceType = {
	kind: ReferenceTypeKind.ShortTypeId,
	typeId: HeapType.func,
}

// `externref` is the short (single-byte) form of `(ref null extern)`.
const EXTERNREF: ReferenceType = {
	kind: ReferenceTypeKind.ShortTypeId,
	typeId: HeapType.extern,
}

