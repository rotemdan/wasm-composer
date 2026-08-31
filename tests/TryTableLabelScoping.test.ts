import { test, expect } from 'vitest'
import {
	NumberType,
	Op,
	WasmModuleDefinition,
} from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// try_table handler label scoping.
//
// Per the validation spec (valid/instructions.md), catch clauses are validated in the context C
// ENCLOSING the try_table, not in C' (which prepends the try_table's own label):
//
//     C |- bt : t1* -> t2*
//     { LABELS (t2*) } ⊕ C |- instr* : t1* ->_{x*} t2*
//     (C |- catch : OK)*
//     ──
//     C |- try_table bt catch* instr* : t1* -> t2*
//
// So a handler label must be resolvable from *outside* the try_table — the try_table itself is
// NOT a valid handler target. The encoder resolves handler labels against the enclosing block
// stack (the try_table's own name is not yet pushed when the immediates are emitted), which must
// both (a) allow enclosing labels and (b) reject the try_table's own name.
//////////////////////////////////////////////////////////////////////////////////////////////////////

function handlerModule(handlerLabelName: string): WasmModuleDefinition {
	return {
		customTypes: [
			{ name: 'emptyFunc', type: { paramTypes: [], returnTypes: [] } },
		],
		tags: [
			{ name: 'e', typeName: 'emptyFunc' },
		],
		functions: [
			{
				name: 'runner',
				export: true,
				params: { n: NumberType.i32 },
				returns: NumberType.i32,
				instructions: [
					Op.block({ name: 'exit', returns: NumberType.i32 }, [
						// Handler block takes no values (catch_all produces 0 operands).
						Op.block({ name: 'handler' }, [
							Op.try_table({ name: 'tt', returns: NumberType.i32, handlers: [ { kind: 'catch_all', labelName: handlerLabelName } ] }, [
								Op.local.get('n'),
								Op.if([ Op.throw('e') ]),
								Op.local.get('n'),
							]),
							// Normal path: carry the value out through 'exit'.
							Op.br('exit'),
						]),
						// Exception path lands here with an empty stack.
						Op.i32.const(-1),
					]),
				],
			},
		],
	}
}

test('a try_table handler can branch to an enclosing block label', async () => {
	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(handlerModule('handler'))

	const runner = moduleExports.runner as Function

	// No throw (n == 0 bypasses the `if`): normal path carries 0 through to exit
	expect(runner(0)).toEqual(0)

	// Throw (n != 0): the catch_all handler branches to 'handler' with no value, then -1 is pushed
	expect(runner(7)).toEqual(-1)
	expect(runner(99)).toEqual(-1)
})

test('a try_table handler cannot target the try_table block itself (spec: clause labels are validated in the enclosing context)', async () => {
	// Per the validation rule above, referencing the try_table's own label from within its own
	// handler must not be encodable. The encoder must reject it at name-resolution time rather
	// than emitting a shifted/invalid label index.
	await expect(encodeAndInstantiateWasmModuleDefinition(handlerModule('tt')))
		.rejects.toThrow(/try_table: Couldn't resolve label name 'tt'/)
})
