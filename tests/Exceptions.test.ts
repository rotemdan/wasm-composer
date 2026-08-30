import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

test('throw is caught by a matching catch handler', async () => {
	const wasmModuleDefinition = emptyTagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[
			{
				name: 'thrower',
				export: true,

				params: { n: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.try({ returns: NumberType.i32 }, [
						Op.local.get('n'),
						Op.if([
							Op.throw('e'),
						]),
						Op.local.get('n'),
					]),
					Op.catch('e', [
						Op.i32.const(-1),
					]),
				],
			},
		],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(0)
	expect(thrower(1)).toEqual(-1)
	expect(thrower(42)).toEqual(-1)
})

test('catch_all handles a thrown tag when no specific catch matches', async () => {
	const wasmModuleDefinition = emptyTagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[
			{
				name: 'thrower',
				export: true,

				params: { n: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.try({ returns: NumberType.i32 }, [
						Op.local.get('n'),
						Op.if([
							Op.throw('e'),
						]),
						Op.local.get('n'),
					]),
					Op.catch_all([
						Op.i32.const(-2),
					]),
				],
			},
		],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(0)
	expect(thrower(7)).toEqual(-2)
})

test('a specific catch runs for its tag, and catch_all is the fallback', async () => {
	const wasmModuleDefinition = emptyTagModule(
		[
			{ name: 'e1', typeName: 'emptyFunc' },
			{ name: 'e2', typeName: 'emptyFunc' },
		],
		[
			{
				name: 'dispatch',
				export: true,

				params: { which: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.try({ returns: NumberType.i32 }, [
						Op.local.get('which'),
						Op.if([
							Op.throw('e1'),
						]),
						Op.throw('e2'),
					]),
					Op.catch('e1', [
						Op.i32.const(1),
					]),
					Op.catch('e2', [
						Op.i32.const(2),
					]),
				],
			},
		],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const dispatch = moduleExports.dispatch as Function

	expect(dispatch(0)).toEqual(2)
	expect(dispatch(1)).toEqual(1)
})

test('the non-throwing path of a try block still produces its result', async () => {
	const wasmModuleDefinition = emptyTagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[
			{
				name: 'safeAdd',
				export: true,

				params: { a: NumberType.i32, b: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					Op.try({ returns: NumberType.i32 }, [
						Op.local.get('a'),
						Op.local.get('b'),
						Op.i32.add,
					]),
					Op.catch('e', [
						Op.i32.const(-1),
					]),
				],
			},
		],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const safeAdd = moduleExports.safeAdd as Function

	expect(safeAdd(3, 4)).toEqual(7)
	expect(safeAdd(-10, 10)).toEqual(0)
})

test('rethrow re-propagates an exception from an inner catch to an outer catch_all handler', async () => {
	const wasmModuleDefinition = emptyTagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[
			{
				name: 'thrower',
				export: true,

				params: { n: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					// Named `try` blocks are required so `rethrow`/`delegate` can reference them.
					Op.try({ name: 't1', returns: NumberType.i32 }, [
						Op.try({ name: 't2', returns: NumberType.i32 }, [
							Op.local.get('n'),
							Op.if([
								Op.throw('e'),
							]),
							Op.local.get('n'),
						]),
						// `t2`'s handler re-throws the exception outward to `t1`.
						Op.catch('e', [
							Op.rethrow('t1'),
						]),
					]),
					Op.catch_all([
						Op.i32.const(-1),
					]),
				],
			},
		],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(0)
	expect(thrower(1)).toEqual(-1)
})

test('delegate transfers control from an inner try to an outer try block handler', async () => {
	const wasmModuleDefinition = emptyTagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[
			{
				name: 'thrower',
				export: true,

				params: { n: NumberType.i32 },
				returns: NumberType.i32,

				instructions: [
					// `delegate` is a try-clause (like `catch`/`catch_all`), not an instruction
					// inside a catch body. Here `t2`'s `delegate` clause forwards any exception
					// to the enclosing `t1` try, whose `catch` handler then runs.
					Op.try({ name: 't1', returns: NumberType.i32 }, [
						Op.try({ name: 't2', returns: NumberType.i32 }, [
							Op.local.get('n'),
							Op.if([
								Op.throw('e'),
							]),
							Op.local.get('n'),
						]),
						Op.delegate('t1'),
					]),
					Op.catch('e', [
						Op.i32.const(-2),
					]),
				],
			},
		],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)

	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(0)
	expect(thrower(1)).toEqual(-2)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////
function emptyTagModule(tags: WasmModuleDefinition['tags'], functions: WasmModuleDefinition['functions']): WasmModuleDefinition {
	return {
		customTypes: [
			{ name: 'emptyFunc', type: { paramTypes: [], returnTypes: [] } },
		],
		tags,
		functions,
	}
}
