import { test, expect } from 'vitest'
import { NumberType, Op, WasmModuleDefinition } from '../src/exports/Exports.ts'
import { encodeAndInstantiateWasmModuleDefinition } from './utilities/Utilities.ts'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// These tests focus on the control-flow *flattening* logic in `WasmEncoder.emitFlattenedInstructions`.
//
// That logic maintains two stacks while walking instructions: `blockStack` (every label-defining
// block: block/loop/if/try/try_table) and `tryBlockStack` (only `try`/`try_table` frames, because
// `rethrow`/`delegate` must count try frames, not all frames). A `try`'s `catch`/`catch_all`/`delegate`
// clause is emitted with a *framed* context that still has the enclosing frame on `blockStack` (so a
// `br` inside a clause can target the enclosing loop), but deliberately NOT on `tryBlockStack` (so
// `rethrow`/`delegate` resolve against the enclosing tries only).
//
// The combinations below are chosen to stress that bookkeeping. I have deliberately included cases I
// am genuinely unsure about — particularly multi-level `rethrow`/`delegate` depth, and `br_table` /
// `if`+`else` branching from inside `catch`/`try` clauses where several frames are open at once. If
// any of these fail, it points at a real depth-counting bug rather than at the test itself.
//////////////////////////////////////////////////////////////////////////////////////////////////////

test('br from a catch clause targets an enclosing loop that wraps the whole try', async () => {
	// This is *valid*: OUTER is still open when we are in the catch, so branching to it is legal.
	// (Branching to a loop *inside* the try body would be illegal — that frame has already unwound.)
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'countdown',
			export: true,

			params: { n: NumberType.i32 },
			locals: { i: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.local.get('n'),
				Op.local.set('i'),

				Op.block({ name: 'B' }, [
					Op.loop({ name: 'L' }, [
						// Exit once the counter hits zero.
						Op.local.get('i'),
						Op.i32.const(0),
						Op.i32.eq,
						Op.if([Op.br('B')]),

						Op.local.get('i'),
						Op.i32.const(1),
						Op.i32.sub,
						Op.local.set('i'),

						// Always throw, always caught, always loops again via the catch.
						Op.try({ name: 't1' }, [
							Op.throw('e'),
						]),
						Op.catch('e', [
							Op.br('L'),
						]),
					]),
				]),

				Op.i32.const(7),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const countdown = moduleExports.countdown as Function

	// Every path funnels through `i32.const 7` once the counter reaches zero.
	expect(countdown(0)).toEqual(7)
	expect(countdown(3)).toEqual(7)
	expect(countdown(100)).toEqual(7)
})

test('br from an else clause targets an enclosing block through nested if/loop/try frames', async () => {
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'countdown',
			export: true,

			params: { n: NumberType.i32 },
			locals: { i: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.local.get('n'),
				Op.local.set('i'),

				Op.try({ name: 't1', returns: NumberType.i32 }, [
					Op.block({ name: 'B' }, [
						Op.loop({ name: 'L' }, [
							Op.local.get('i'),
							Op.if([
								// i != 0: decrement and continue the loop.
								Op.local.get('i'),
								Op.i32.const(1),
								Op.i32.sub,
								Op.local.set('i'),
								Op.br('L'),
							]),
							Op.else([
								// i == 0: break out of the enclosing block (which also exits the loop).
								Op.br('B'),
							]),
						]),
					]),
					Op.i32.const(7),
				]),
				Op.catch('e', [Op.i32.const(-1)]),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const countdown = moduleExports.countdown as Function

	expect(countdown(0)).toEqual(7)
	expect(countdown(5)).toEqual(7)
})

test('rethrow targets the correct enclosing try across three nested tries (depth 1)', async () => {
	// `rethrow` can only target the *immediately* enclosing try — it cannot skip an intermediate
	// try frame. So to unwind three levels we must CHAIN: t3's handler rethrows to t2, and t2's
	// handler rethrows to t1. Each handler returns a distinct sentinel, so a wrong depth is visible.
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'thrower',
			export: true,

			params: { n: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.try({ name: 't1', returns: NumberType.i32 }, [
					Op.try({ name: 't2', returns: NumberType.i32 }, [
						Op.try({ name: 't3', returns: NumberType.i32 }, [
							Op.throw('e'),
						]),
						Op.catch('e', [
							Op.rethrow('t2'),
						]),
					]),
					Op.catch('e', [
						Op.rethrow('t1'),
					]),
				]),
				Op.catch('e', [
					Op.i32.const(-1),
				]),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(-1)
})

test('rethrow targets an immediately enclosing try across nested tries (depth 0)', async () => {
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'thrower',
			export: true,

			params: { n: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.try({ name: 't1', returns: NumberType.i32 }, [
					Op.try({ name: 't2', returns: NumberType.i32 }, [
						Op.try({ name: 't3', returns: NumberType.i32 }, [
							Op.throw('e'),
						]),
						Op.catch('e', [
							Op.rethrow('t2'),
						]),
					]),
					Op.catch('e', [
						Op.i32.const(-2),
					]),
				]),
				Op.catch('e', [
					Op.i32.const(-1),
				]),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(-2)
})

test('rethrow reaches an outer try from a catch that lives inside a loop', async () => {
	// `L` is not a try, so it must not perturb the try-frame depth count for `rethrow('t1')`.
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'thrower',
			export: true,

			params: { n: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.try({ name: 't1', returns: NumberType.i32 }, [
					Op.loop({ name: 'L' }, [
						Op.try({ name: 't2' }, [
							Op.throw('e'),
						]),
						Op.catch('e', [
							Op.rethrow('t1'),
						]),
					]),
					Op.i32.const(7),
				]),
				Op.catch('e', [Op.i32.const(-1)]),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(-1)
	expect(thrower(42)).toEqual(-1)
})

// This is one of the cases I am least certain about: `delegate` resolving across a try that sits
// inside a loop inside another try. If the try-frame stack is wrong, this either fails to link the
// delegate or produces a bogus depth.
test('delegate reaches an outer try from a try nested in a loop nested in a try', async () => {
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'thrower',
			export: true,

			params: { n: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.try({ name: 't1', returns: NumberType.i32 }, [
					Op.loop({ name: 'L' }, [
						Op.try({ name: 't2' }, [
							Op.throw('e'),
						]),
						Op.delegate('t1'),
					]),
					Op.i32.const(7),
				]),
				Op.catch('e', [Op.i32.const(-1)]),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(-1)
	expect(thrower(7)).toEqual(-1)
})

	// `br_table` resolves labels against `blockStack`. Inside a `catch`, the enclosing frames must
	// still be visible on `blockStack` (via the framed context) for the index lookup to be correct.
	// `B` and `C` are *void* blocks: branching out of a `catch` carries NO value, so the branch lands
	// at `B`'s end with an empty stack. The function's i32 return value (7) is produced AFTER the
	// branch lands (post-`B`), which is the valid way to surface a value when the branch target is void.
test('br_table inside a catch clause resolves enclosing block labels', async () => {
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'thrower',
			export: true,

			params: { n: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.try({ name: 't1', returns: NumberType.i32 }, [
					Op.block({ name: 'B' }, [
						Op.block({ name: 'C' }, [
							Op.try({ name: 't2' }, [
								Op.throw('e'),
							]),
							Op.catch('e', [
							// index 0 selects B (entry 0), index 1 selects C. `B`/`C` are void blocks, so
							// `br_table` must resolve B/C from inside this catch clause and carry NO value
							// out. The `Op.i32.const(0)` is the selector operand consumed by `br_table`;
							// the return value 7 is produced after the branch lands (proving label + arity
							// resolution without violating catch fallthrough rules).
								Op.i32.const(0),
								Op.br_table(['B', 'C'], 'B'),
							]),
						]),
					]),
				Op.i32.const(7),
				]),
				Op.catch('e', [Op.i32.const(-1)]),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const thrower = moduleExports.thrower as Function

	expect(thrower(0)).toEqual(7)
})

test('a try with catch + catch_all still closes correctly when the catch rethrows outward', async () => {
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'thrower',
			export: true,

			params: { n: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.try({ name: 't1', returns: NumberType.i32 }, [
					Op.try({ name: 't2', returns: NumberType.i32 }, [
						Op.throw('e'),
					]),
					Op.catch('e', [
						Op.rethrow('t1'),
					]),
					Op.catch_all([
						Op.i32.const(-9),
					]),
				]),
				Op.catch('e', [Op.i32.const(-1)]),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const thrower = moduleExports.thrower as Function

	// The rethrow bypasses t2's catch_all and is caught by t1's catch.
	expect(thrower(0)).toEqual(-1)
})

// Both branches of an if/else each contain their own try/catch. This stresses the clause bookkeeping
// on both the then-path and the else-path of the same if frame.
test('if and else branches each containing a try/catch resolve independently', async () => {
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'dispatch',
			export: true,

			params: { n: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.try({ name: 't1', returns: NumberType.i32 }, [
					Op.local.get('n'),
					Op.if({ returns: NumberType.i32 }, [
						Op.try({ name: 't2', returns: NumberType.i32 }, [
							Op.throw('e'),
						]),
						Op.catch('e', [Op.i32.const(1)]),
					]),
					Op.else([
						Op.try({ name: 't3', returns: NumberType.i32 }, [
							Op.throw('e'),
						]),
						Op.catch('e', [Op.i32.const(2)]),
					]),
				]),
				Op.catch('e', [Op.i32.const(-1)]),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const dispatch = moduleExports.dispatch as Function

	expect(dispatch(1)).toEqual(1)
	expect(dispatch(0)).toEqual(2)
})

// Stress test: a deeply nested mix of loop/block/try with branches to several different enclosing
// labels, including a br_if inside a catch.
test('deeply nested loop/block/try with br and br_if from within catch clauses', async () => {
	const wasmModuleDefinition = tagModule(
		[{ name: 'e', typeName: 'emptyFunc' }],
		[{
			name: 'walk',
			export: true,

			params: { n: NumberType.i32 },
			locals: { i: NumberType.i32 },
			returns: NumberType.i32,

			instructions: [
				Op.local.get('n'),
				Op.local.set('i'),

				Op.block({ name: 'B' }, [
					Op.loop({ name: 'L' }, [
						// Stop when i reaches zero (br out of the whole block).
						Op.local.get('i'),
						Op.i32.const(0),
						Op.i32.eq,
						Op.if([Op.br('B')]),

						Op.try({ name: 't1' }, [
							Op.block({ name: 'Inner' }, [
								Op.try({ name: 't2' }, [
									Op.throw('e'),
								]),
								Op.catch('e', [
									// If more than one remaining, keep looping; otherwise fall out.
									Op.local.get('i'),
									Op.i32.const(1),
									Op.i32.sub,
									Op.local.set('i'),
									Op.local.get('i'),
									Op.br_if('L'),
								]),
							]),
						]),
						Op.catch('e', [
							Op.br('L'),
						]),
					]),
				]),

				Op.i32.const(7),
			],
		}],
	)

	const { moduleExports } = await encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition)
	const walk = moduleExports.walk as Function

	expect(walk(0)).toEqual(7)
	expect(walk(3)).toEqual(7)
})

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////////////////////////////

function tagModule(tags: WasmModuleDefinition['tags'], functions: WasmModuleDefinition['functions']): WasmModuleDefinition {
	return {
		customTypes: [
			{ name: 'emptyFunc', type: { paramTypes: [], returnTypes: [] } },
		],
		tags,
		functions,
	}
}
