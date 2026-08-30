import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
	HeapType,
	ReferenceTypeKind,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

// `try_table` is the modern exception-handling form. A handler clause branches to a label; the
// block at that label must have a result type compatible with what the clause leaves on the stack.
//   - catch_ref  leaves a (ref exn) reference on the stack.
//   - catch_all  leaves nothing on the stack.

test('try_table catch_ref catches a thrown exception', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'emptyFunc', type: { paramTypes: [], returnTypes: [] } },
		],
		tags: [
			{ name: 'e', typeName: 'emptyFunc' },
		],
		functions: [
			{
				name: 'thrower',
				export: true,
				params: { n: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.block({ name: 'exit', returns: NumberType.i32 }, [
						Op.block({ name: 'handler', returns: { kind: ReferenceTypeKind.ShortTypeId, typeId: HeapType.exn } }, [
							Op.try_table({ name: 'tt', returns: NumberType.i32, handlers: [ { kind: 'catch_ref', tagName: 'e', labelName: 'handler' } ] }, [
								Op.local.get('n'),
								Op.if([ Op.throw('e') ]),
								Op.local.get('n'),
							]),
							// Normal path: carry the value out through `exit`.
							Op.br('exit'),
						]),
						// Exception path (reached when the catch_ref handler branches here):
						// the (ref exn) reference is on the stack and must be consumed.
						Op.drop,
						Op.i32.const(-1),
					]),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(0)
	expect(thrower(1)).toEqual(-1)
	expect(thrower(42)).toEqual(-1)
})

test('try_table catch_all catches any thrown exception', async () => {
	const wasmModuleDefinition: WasmModuleDefinition = {
		customTypes: [
			{ name: 'emptyFunc', type: { paramTypes: [], returnTypes: [] } },
		],
		tags: [
			{ name: 'e', typeName: 'emptyFunc' },
		],
		functions: [
			{
				name: 'thrower',
				export: true,
				params: { n: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.block({ name: 'exit', returns: NumberType.i32 }, [
						Op.block({ name: 'handler' }, [
							Op.try_table({ name: 'tt', returns: NumberType.i32, handlers: [ { kind: 'catch_all', labelName: 'handler' } ] }, [
								Op.local.get('n'),
								Op.if([ Op.throw('e') ]),
								Op.local.get('n'),
							]),
							// Normal path: carry the value out through `exit`.
							Op.br('exit'),
						]),
						// Exception path: catch_all leaves nothing on the stack.
						Op.i32.const(-1),
					]),
				],
			},
		],
	}

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(0)
	expect(thrower(1)).toEqual(-1)
	expect(thrower(42)).toEqual(-1)
})
