# WebAssembly composer

A lightweight, pure TypeScript library that efficiently encodes a WebAssembly module definition to the standard WebAssembly binary format (`.wasm`). Includes composable, function-based instruction wrappers, allowing WebAssembly modules to be dynamically specified, encoded, and executed at runtime, with minimal overhead.

* Implements the full **[WebAssembly 2.0 binary format](https://webassembly.github.io/spec/core/binary/index.html)** specification
* Supports **all Phase 5, and some phase 4 extensions**, including bulk memory operations, garbage collection, multiple memories, multi-value, mutable globals, reference types, relaxed SIMD, typed function references, tail calls and atomics
* Supports nearly **all WebAssembly instructions**, up to the latest, experimental ones. Opcode lookup table is extracted [directly from the V8 source code](https://github.com/v8/v8/blob/main/src/wasm/wasm-opcodes.h) and continuously updated
* Includes **composable, function-based instruction wrappers**, with a syntax that directly reflects the underlying WebAssembly program structure, and attempts to simplify over the more LISP-styled WAT syntax
* TypeScript-based instruction syntax naturally enables the ability to define convenient and powerful **macros and code generators**
* Runs on **all major JavaScript runtimes**, including Node.js, Deno, Bun, Chromium, Firefox and Safari
* **Optimized for speed**. Takes a few microseconds (1/1000 millisecond) to build and encode the minimal example below (by comparison, the instantiation time of the resulting binary is significantly longer)
* No dependencies

### Currently experimental

**This library has not been thoroughly tested!**

* It's possible there are trivial errors in the code
* It's possible that the encoding of some sections or instructions is incorrectly implemented, due to human errors or misunderstanding of the specification
* It's possible that some implementation details, derived from the official specification, don't exactly match the expectation of actual WASM engines, especially for complex extensions, like garbage collection

Please report any issue you encounter! Inspect the code if needed. That's the fastest way to get it stable and usable.

## Installation

```sh
npm install wasm-composer
```

## Usage

```ts
import { encodeWasmModule } from 'wasm-composer'

// ...

const wasmBytes = encodeWasmModule(moduleDefinition)
```


## Minimal example

Define a new WebAssembly module, including an exported function called `add` that computes the sum of two 32 bit integers, encodes it to a binary `Uint8Array`, instantiates and runs it:

```ts
import { encodeWasmModule, WasmModuleDefinition, NumberType, Op } from 'wasm-composer'

const moduleDefinition: WasmModuleDefinition = {
	functions: [
		{
			name: 'add',
			export: true,

			params: { num1: NumberType.i32, num2: NumberType.i32 }, // Parameter names and types
			returns: NumberType.i32, // Return type

			instructions: [
				// Add the two integers, and leave the result on the stack
				Op.local.get('num1'), // Push 'num1' to the stack
				Op.local.get('num2'), // Push 'num2' to the stack
				Op.i32.add, // Add the two values together and pop them from the stack

				// The result of `i32.add` is now left on the stack and would be taken as the return value
				Op.end, // function
			],
		},
	],
}

// Encode the module definition object to a binary Uint8Array
const wasmBytes = encodeWasmModule(moduleDefinition)

// Instantiate the WASM bytes
const wasmModuleInstance = await WebAssembly.instantiate(wasmBytes)

// Take the exports of the instantiated WASM module
const moduleExports = wasmModuleInstance.instance.exports

// Call the `add` method exported from the WASM module, and take the result
const result = (moduleExports.add as Function)(5, 3)

// Print the result
console.log(`Result: ${result}`) // Output: 8
```

## More examples of the instruction syntax

### If conditional

This instruction pushes `1` to the stack, if the first argument is greater than the second one, and `0` if not:
```ts
const isGreaterThan: FunctionDefinition = {
	name: 'isGreaterThan',
	export: true,

	params: { num1: NumberType.i64, num2: NumberType.i64 },
	returns: NumberType.i32,

	instructions: [
		// Compare the two integers
		Op.local.get('num1'), // Push 'num1' to the stack
		Op.local.get('num2'), // Push 'num2' to the stack
		Op.i64.gt_s, // Test if first stack value is greater than the second one, pop them, and push the result

		// Check the comparison result
		//
		// `returns: NumberType.i32` means the type of the value that the `if..else` block puts
		// on the stack, when it ends, should be `i32`
		Op.if({ returns: NumberType.i32 }, [
			Op.i32.const(1), // Push the constant `1` to the stack
		]),
		Op.else([
			Op.i32.const(0) // Push the constant `0` to the stack
		]),
		Op.end, // if

		Op.end, // function
	],
}
```

### Loop

This example adds the constant `10` to a given value, `k` times, using a loop, and a local named `counter`:
```ts
const add10_KTimes: FunctionDefinition = {
	name: 'add10_KTimes',
	export: true,

	params: { value: NumberType.i32, k: NumberType.i32 },
	returns: NumberType.i32,

	locals: { counter: NumberType.i32 },

	instructions: [
		Op.loop('adderLoop', [
			// Check if the counter is less than k
			Op.local.get('counter'),
			Op.local.get('k'),
			Op.i32.lt_s,

			// If the condition evaluates to true, execute the block
			//
			// `if` has no `returns` property here, meaning the `if` block is not expected
			// to leave anything on the stack.
			Op.if([
				// Add 10 to the value
				Op.local.get('value'),
				Op.i32.const(10),
				Op.i32.add,
				Op.local.set('value'),

				// Increment counter
				Op.local.get('counter'),
				Op.i32.const(1),
				Op.i32.add,
				Op.local.set('counter'),

				// Jump to the start of the loop block
				Op.br('adderLoop'),
			]),
			Op.end // if
		]),
		Op.end, // loop

		// Put the value on the stack to return it
		Op.local.get('value'),
		Op.end, // function
	],
},
```

## Macros and code generators

Since the instruction builder uses JavaScript, we can naturally make helper functions that generate code fragments based on configurable sets of arguments.

### `add` revisited

For example, going back to the initial `add` example we could define a macro-like function that will generate a code fragment that adds any two `i32` locals:

```ts
const addI32Locals = (local1: string, local2: string) => [
	Op.local.get(local1), // Push local1 to the stack
	Op.local.get(local2), // Push local2 to the stack
	Op.i32.add, // Add the two values together, pop them from the stack, and put the result on the stack
]
```

Now we have a reusable method to generate code for simple addition. We can apply it in `add`:

```ts
const add: FunctionDefinition = {
	name: 'add',
	export: true,

	params: { num1: NumberType.i32, num2: NumberType.i32 }, // Parameter names and types
	returns: NumberType.i32, // Return type

	instructions: [
		// Add the two i32 locals, and leave the result on the stack
		addI32Locals('num1', 'num2'),

		// The result of `addI32Locals` is now left on the stack and would be taken as the return value
		Op.end, // function
	],
}
```

### `add10_KTimes` revisited

We can also emulate a basic `for` loop-like construct using a code-generating function `loopRange`:

```ts
const addToLocalI32 = (localName: string, valueToAdd: number) => [
	Op.local.get(localName),
	Op.i32.const(valueToAdd),
	Op.i32.add,
	Op.local.set(localName),
]

const loopRange = (blockName: string, counterLocalI32: string, maxCounterLocalI32: string, body: Instructions) => [
	Op.loop(blockName, [
		Op.local.get(counterLocalI32),
		Op.local.get(maxCounterLocalI32),
		Op.i32.lt_s,

		Op.if(
			body, // This will embed the body in the generated code

			addToLocalI32(counterLocalI32, 1),

			Op.br(blockName),
		),
		Op.end, // if
	]),
	Op.end, // loop
]
```

Now let's rewrite `add10_KTimes` using these methods:

```ts
const add10_KTimes: FunctionDefinition = {
	name: 'add10_KTimes',
	export: true,

	params: { value: NumberType.i32, k: NumberType.i32 },
	returns: NumberType.i32,

	locals: { counter: NumberType.i32 },

	instructions: [
		// Initialize `counter` to 0
		Op.i32.const(0),
		Op.local.set('counter'),

		// Loop, starting at the current value of `counter`, up to `k`,
		// incrementing `counter` at each step
		loopRange('adderLoop', 'counter', 'k', [
			addToLocalI32('value', 10),
		]),

		// Put the value on the stack to return it
		Op.local.get('value'),
		Op.end, // function
	],
},

```

### Generic macros and code generator functions

You can define macros that apply to multiple WASM types, and generate different instructions based on the arguments given.

For example, here's a method that generates code to add values of any two locals, with the type given as a third argument:

```ts
const addLocals = (type: 'i32' | 'i64' | 'f32' | 'f64', local1: string, local2: string) => {
	const instructions: Instructions = [
		Op.local.get(local1), // Push local1 to the stack
		Op.local.get(local2), // Push local2 to the stack
	]

	// Select the `add` instruction based on the given `type`
	if (type === 'i32') {
		instructions.push(Op.i32.add)
	} else if (type === 'i64') {
		instructions.push(Op.i64.add)
	} else if (type === 'f32') {
		instructions.push(Op.f32.add)
	} else if (type === 'f64') {
		instructions.push(Op.f64.add)
	} else {
		throw new TypeError(`Invalid type: '${type}'`)
	}

	return instructions
}
```

Usage example:
```ts
addLocals('f64', 'local1', 'local2')
```

Using this approach, you can create your own macro library to generate shorter and safer code for your needs, avoiding unwanted repetition.

## Module definition

The module definition supports all WebAssembly sections, with a few of them being partially or fully auto-generated:

```ts
interface WasmModuleDefinition {
	functions?: FunctionDefinition[]
	globals?: GlobalEntry[]
	customTypes?: SubtypeOrRecursiveType[]
	imports?: ImportEntry[]
	memories?: MemoryEntry[]
	start?: StartEntry
	tables?: TableEntry[]
	elements?: ElementEntry[]
	data?: DataEntry[]
	customSections?: CustomSection[]
}
```

The exact type for each section of the module is documented and maintained in the generated TypeScript definitions.

### Auto-generated metadata

* Given a list of function definitions and custom types, it automatically fills the `function`, `types` and `exports` sections with the needed entries, saving the need to manually manage them
* A core design decision of `wasm-composer` is to **only use named references**. Functions, locals, globals, instruction blocks, memories, tables, elements, data entries, and custom types are all referenced by a string identifier, which is automatically resolved to an internal index number when the module is built
* Sections that accept instructions, like the `tables` or `elements` sections, use the same instruction syntax used for function bodies

## Opcode table

You can import the opcode table directly:
```ts
import { wasmOpcodes } from 'wasm-composer'
```

## Future

* Optional static analysis for instructions. Analyze instructions to catch various errors that can be identified at compile-time. Currently done only during instantiation, by the WebAssembly engine (which means error messages can be cryptic or confusing in some cases)

## License

MIT
