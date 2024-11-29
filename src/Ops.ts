import { OpcodeName } from './Opcodes.js'
import { isArray, isBigInt, isString } from './utilities/Utilities.js'
import { BlockInstruction, emptyType, HeapTypeId, ImmediateType, Instruction, ValueType } from './WasmBuilder.js'

export const Op = {
	////////////////////////////////////////////////////////////////////////////////////////////////
	// Control instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	unreachable: createSimpleInstruction('unreachable'),
	nop: createSimpleInstruction('nop'),

	block: createBlockInstruction('block'),
	loop: createBlockInstruction('loop'),

	if: (optionsOrBody: IfOptions | Instruction[], body?: Instruction[]) => {
		let options: IfOptions

		if (isArray(optionsOrBody)) {
			options = {}
			body = optionsOrBody
		} else {
			options = optionsOrBody
		}

		if (body == null) {
			throw new Error(`An 'if' instruction must have a body`)
		}

		const blockName = `ifBlock_${anonymousBlockCounter++}`

		const instruction: BlockInstruction = {
			opcodeName: 'if',
			args: [blockName, options.returns, body],

			immediatesEmitter: (builder) => {
				if (options.returns !== undefined) {
					builder.emitValueType(options.returns)
				} else {
					builder.emitByte(emptyType)
				}
			},

			blockName,

			bodyInstructions: body
		}

		return instruction
	},
	else: (body: Instruction[]): BlockInstruction => {
		const blockName = `elseBlock_${anonymousBlockCounter++}`

		const blockInstruction: BlockInstruction = {
			opcodeName: 'else',
			args: [blockName, undefined, body],

			blockName,
			bodyInstructions: body
		}

		return blockInstruction
	},

	end: createSimpleInstruction('end'),

	br: createBranchInstruction('br'),
	br_if: createBranchInstruction('br_if'),
	br_table: (blockNames: string[], defaultBlockName: string): Instruction => ({
		opcodeName: 'br_table',
		args: [blockNames, defaultBlockName],

		immediatesEmitter: (builder, context) => {
			let blockIndexes: number[] = []

			for (const blockName of blockNames) {
				const blockIndex = context.blockStack.indexOf(blockName)

				if (blockIndex === -1) {
					throw new Error(`br_table: Couldn't resolve block name '${blockName}'`)
				}

				blockIndexes.push(blockIndex)
			}

			const defaultBlockIndex = context.blockStack.indexOf(defaultBlockName)

			if (defaultBlockIndex === -1) {
				throw new Error(`br_table: Couldn't resolve default block name '${defaultBlockName}'`)
			}

			builder.emitLengthPrefixedUintArray(blockIndexes)
			builder.emitUint(defaultBlockIndex)
		}
	}),

	br_on_null: createBranchInstruction('br_on_null'),
	br_on_non_null: createBranchInstruction('br_on_non_null'),
	br_on_cast: createBranchOnCastInstruction('br_on_cast'),
	br_on_cast_fail: createBranchOnCastInstruction('br_on_cast_fail'),

	return: createSimpleInstruction('return'),

	call: (functionName: string): Instruction => ({
		opcodeName: 'call',
		args: [functionName],

		immediatesEmitter: (builder, context) => {
			const functionIndex = context.functionsLookup.get(functionName)

			if (functionIndex === undefined) {
				throw new Error(`call: Couldn't resolve function reference '${functionName}'`)
			}

			builder.emitUint(functionIndex)
		}
	}),
	call_indirect: (typeName: string, tableName: string): Instruction => ({
		opcodeName: 'call_indirect',
		args: [typeName, tableName],

		immediatesEmitter: (builder, context) => {
			const typeIndex = context.typesLookup.get(typeName)

			if (typeIndex === undefined) {
				throw new Error(`call_indirect: Couldn't resolve type name '${typeName}'`)
			}

			const tableIndex = context.tablesLookup.get(tableName)

			if (tableIndex === undefined) {
				throw new Error(`call_indirect: Couldn't resolve table name '${tableName}'`)
			}

			builder.emitUint(typeIndex)
			builder.emitUint(tableIndex)
		}
	}),
	call_ref: (typeName: string): Instruction => ({
		opcodeName: 'call_ref',
		args: [typeName],

		immediatesEmitter: (builder, context) => {
			const typeIndex = context.typesLookup.get(typeName)

			if (typeIndex === undefined) {
				throw new Error(`call_ref: Couldn't resolve type name '${typeName}'`)
			}

			builder.emitUint(typeIndex)
		}
	}),
	return_call: (functionName: string): Instruction => ({
		opcodeName: 'return_call',
		args: [functionName],

		immediatesEmitter: (builder, context) => {
			const functionIndex = context.functionsLookup.get(functionName)

			if (functionIndex === undefined) {
				throw new Error(`return_call: Couldn't resolve function reference '${functionName}'`)
			}

			builder.emitUint(functionIndex)
		}
	}),
	return_call_indirect: (typeName: string, tableName: string): Instruction => ({
		opcodeName: 'return_call_indirect',
		args: [typeName, tableName],

		immediatesEmitter: (builder, context) => {
			const typeIndex = context.typesLookup.get(typeName)

			if (typeIndex === undefined) {
				throw new Error(`return_call_indirect: Couldn't resolve type name '${typeName}'`)
			}

			const tableIndex = context.tablesLookup.get(tableName)

			if (tableIndex === undefined) {
				throw new Error(`return_call_indirect: Couldn't resolve table name '${tableName}'`)
			}

			builder.emitUint(typeIndex)
			builder.emitUint(tableIndex)
		}
	}),

	////////////////////////////////////////////////////////////////////////////////////////////////
	// Reference instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	ref: {
		null: (heapType: HeapTypeId): Instruction => ({
			opcodeName: 'ref.null',
			args: [heapType],

			immediatesEmitter: (builder) => {
				builder.emitByte(heapType)
			}
		}),
		is_null: createSimpleInstruction('ref.is_null'),
		func: (funcName: string): Instruction => ({
			opcodeName: 'ref.func',
			args: [funcName],

			immediatesEmitter: (builder, context) => {
				const funcIndex = context.functionsLookup.get(funcName)

				if (funcIndex === undefined) {
					throw new Error(`ref.func: couldn't resolve function name '${funcName}`)
				}

				builder.emitUint(funcIndex)
			}
		}),
		eq: createSimpleInstruction('ref.eq'),
		as_non_null: createSimpleInstruction('ref.as_non_null'),

		test: (heapTypeId: HeapTypeId, nullable: boolean): Instruction => ({
			opcodeName: nullable ? 'ref.test_nullable' : 'ref.test',
			args: [heapTypeId, nullable],

			immediatesEmitter: (builder) => {
				builder.emitByte(heapTypeId)
			}
		}),
		cast: (heapTypeId: HeapTypeId, nullable: boolean): Instruction => ({
			opcodeName: nullable ? 'ref.cast_nullable' : 'ref.cast',
			args: [heapTypeId, nullable],

			immediatesEmitter: (builder) => {
				builder.emitByte(heapTypeId)
			}
		}),

		i31: createSimpleInstruction('ref.i31')
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// GC instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	struct: {
		new: createGCTypeInstruction('struct.new'),
		new_default: createGCTypeInstruction('struct.new_default'),
		get: createGCTypeInstructionWithFieldIndex('struct.get'),
		get_s: createGCTypeInstructionWithFieldIndex('struct.get_s'),
		get_u: createGCTypeInstructionWithFieldIndex('struct.get_u'),
		set: createGCTypeInstructionWithFieldIndex('struct.set'),
	},

	array: {
		new: createGCTypeInstruction('array.new'),
		new_default: createGCTypeInstruction('array.new_default'),
		new_fixed: (typeName: string, arrayLength: number): Instruction => ({
			opcodeName: 'array.new_fixed',
			args: [typeName, arrayLength],

			immediatesEmitter: (builder, context) => {
				const typeIndex = context.typesLookup.get(typeName)

				if (typeIndex === undefined) {
					throw new Error(`array.new_fixed: Couldn't resolve type name '${typeName}'`)
				}

				builder.emitUint(typeIndex)
				builder.emitUint(arrayLength)
			}
		}),
		new_data: (typeName: string, dataEntryName: string): Instruction => ({
			opcodeName: 'array.new_data',
			args: [typeName, dataEntryName],

			immediatesEmitter: (builder, context) => {
				const typeIndex = context.typesLookup.get(typeName)

				if (typeIndex === undefined) {
					throw new Error(`array.new_data: Couldn't resolve type name '${typeName}'`)
				}

				const dataEntryIndex = context.dataLookup.get(dataEntryName)

				if (dataEntryIndex === undefined) {
					throw new Error(`array.new_data: Couldn't resolve data entry name '${typeName}'`)
				}

				builder.emitUint(typeIndex)
				builder.emitUint(dataEntryIndex)
			}
		}),
		new_elem: (typeName: string, elementName: string): Instruction => ({
			opcodeName: 'array.new_elem',
			args: [typeName, elementName],

			immediatesEmitter: (builder, context) => {
				const typeIndex = context.typesLookup.get(typeName)

				if (typeIndex === undefined) {
					throw new Error(`array.new_elem: Couldn't resolve type name '${typeName}'`)
				}

				const elementIndex = context.elementsLookup.get(elementName)

				if (elementIndex === undefined) {
					throw new Error(`array.new_elem: Couldn't resolve element entry name '${typeName}'`)
				}

				builder.emitUint(typeIndex)
				builder.emitUint(elementIndex)
			}
		}),

		get: createGCTypeInstruction('array.get'),
		get_s: createGCTypeInstruction('array.get_s'),
		get_u: createGCTypeInstruction('array.get_u'),
		set: createGCTypeInstruction('array.set'),
		len: createSimpleInstruction('array.len'),
		fill: createGCTypeInstruction('array.fill'),
		init_data: (typeName: string, dataEntryName: string): Instruction => ({
			opcodeName: 'array.init_data',
			args: [typeName, dataEntryName],

			immediatesEmitter: (builder, context) => {
				const typeIndex = context.typesLookup.get(typeName)

				if (typeIndex === undefined) {
					throw new Error(`array.init_data: Couldn't resolve type name '${typeName}'`)
				}

				const dataEntryIndex = context.dataLookup.get(dataEntryName)

				if (dataEntryIndex === undefined) {
					throw new Error(`array.init_data: Couldn't resolve data entry name '${typeName}'`)
				}

				builder.emitUint(typeIndex)
				builder.emitUint(dataEntryIndex)
			}
		}),
		init_elem: (typeName: string, elementName: string): Instruction => ({
			opcodeName: 'array.init_elem',
			args: [typeName, elementName],

			immediatesEmitter: (builder, context) => {
				const typeIndex = context.typesLookup.get(typeName)

				if (typeIndex === undefined) {
					throw new Error(`array.init_elem: Couldn't resolve type name '${typeName}'`)
				}

				const elementIndex = context.elementsLookup.get(elementName)

				if (elementIndex === undefined) {
					throw new Error(`array.init_elem: Couldn't resolve element entry name '${typeName}'`)
				}

				builder.emitUint(typeIndex)
				builder.emitUint(elementIndex)
			}
		}),
	},

	any: {
		convert_extern: createSimpleInstruction('any.convert_extern'),
	},

	extern: {
		convert_any: createSimpleInstruction('extern.convert_any'),
	},

	i31: {
		get_s: createSimpleInstruction('i31.get_s'),
		get_u: createSimpleInstruction('i31.get_u'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// Parameteric instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	drop: createSimpleInstruction('drop'),
	select: (valueTypes?: ValueType[]): Instruction => {
		const instruction: Instruction = {
			opcodeName: valueTypes === undefined ? 'select' : 'select_with_type',
			args: [valueTypes],

			immediatesEmitter: (builder) => {
				if (valueTypes) {
					builder.emitLengthPrefixedValueTypeArray(valueTypes)
				}
			}
		}

		return instruction
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// Locals-related instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	local: {
		get: (localName: string) => createNamedLocalInstruction('local.get', localName),
		set: (localName: string) => createNamedLocalInstruction('local.set', localName),
		tee: (localName: string) => createNamedLocalInstruction('local.tee', localName),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// Globals-related instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	global: {
		get: (globalName: string) => createNamedGlobalInstruction('global.get', globalName),
		set: (globalName: string) => createNamedGlobalInstruction('global.set', globalName),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// Tables instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	table: {
		get: createTableInstruction('table.get'),
		set: createTableInstruction('table.set'),

		init: (tableName: string, elementName: string): Instruction => ({
			opcodeName: 'table.init',
			args: [tableName, elementName],

			immediatesEmitter: (builder, context) => {
				const tableIndex = context.tablesLookup.get(tableName)

				if (tableIndex === undefined) {
					throw new Error(`table.init: Couldn't resolve table name '${tableName}'`)
				}

				const elementIndex = context.elementsLookup.get(elementName)

				if (elementIndex === undefined) {
					throw new Error(`table.init: Couldn't resolve element name '${elementName}'`)
				}

				builder.emitUint(tableIndex)
				builder.emitUint(elementIndex)
			}
		}),
		copy: (sourceTableName: string, targetTableName: string): Instruction => ({
			opcodeName: 'table.copy',
			args: [sourceTableName, targetTableName],

			immediatesEmitter: (builder, context) => {
				const sourceTableIndex = context.tablesLookup.get(sourceTableName)

				if (sourceTableIndex === undefined) {
					throw new Error(`table.copy: Couldn't resolve source table name '${sourceTableName}'`)
				}

				const targetTableIndex = context.tablesLookup.get(targetTableName)

				if (targetTableIndex === undefined) {
					throw new Error(`table.copy: Couldn't resolve target table name '${targetTableName}'`)
				}

				builder.emitUint(sourceTableIndex)
				builder.emitUint(targetTableIndex)
			}
		}),
		grow: createTableInstruction('table.grow'),
		size: createTableInstruction('table.size'),
		fill: createTableInstruction('table.fill'),
	},

	elem: {
		drop: (elementName: string): Instruction => ({
			opcodeName: 'elem.drop',
			args: [elementName],

			immediatesEmitter: (builder, context) => {
				const elementIndex = context.tablesLookup.get(elementName)

				if (elementIndex === undefined) {
					throw new Error(`elem.drop: Couldn't resolve element name '${elementName}'`)
				}

				builder.emitUint(elementIndex)
			}
		}),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// Memory instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	memory: {
		size: createMemoryInstruction('memory.size'),
		grow: createMemoryInstruction('memory.grow'),
		init: (memoryName: string, dataEntryName: string): Instruction => ({
			opcodeName: 'memory.init',
			args: [memoryName, dataEntryName],

			immediatesEmitter: (builder, context) => {
				const memoryIndex = context.memoriesLookup.get(memoryName)

				if (memoryIndex === undefined) {
					throw new Error(`memory.init: Couldn't resolve memory name '${memoryName}'`)
				}

				const dataEntryIndex = context.dataLookup.get(dataEntryName)

				if (dataEntryIndex === undefined) {
					throw new Error(`memory.init: Couldn't resolve data entry name '${dataEntryName}'`)
				}

				builder.emitUint(dataEntryIndex)
				builder.emitUint(memoryIndex)
			}
		}),
		copy: (memory1Name: string, memory2Name: string): Instruction => ({
			opcodeName: 'memory.copy',
			args: [memory1Name, memory2Name],

			immediatesEmitter: (builder, context) => {
				const memory1Index = context.memoriesLookup.get(memory1Name)

				if (memory1Index === undefined) {
					throw new Error(`memory.copy: Couldn't resolve memory 1 name '${memory1Name}'`)
				}

				const memory2Index = context.memoriesLookup.get(memory1Name)

				if (memory2Index === undefined) {
					throw new Error(`memory.copy: Couldn't resolve memory 2 name '${memory2Name}'`)
				}

				builder.emitUint(memory1Index)
				builder.emitUint(memory2Index)
			}
		}),
		fill: createMemoryInstruction('memory.fill'),

		// Atomic operations
		atomic: {
			notify: createMemoryInstruction('memory.atomic.notify'),
			wait32: createMemoryInstruction('memory.atomic.wait32'),
			wait64: createMemoryInstruction('memory.atomic.wait64'),
		}
	},

	atomic: {
		fence: createSimpleInstruction('atomic.fence')
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// Data entry instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	data: {
		drop: (dataEntryName: string): Instruction => ({
			opcodeName: 'data.drop',
			args: [dataEntryName],

			immediatesEmitter: (builder, context) => {
				const dataEntryIndex = context.dataLookup.get(dataEntryName)

				if (dataEntryIndex === undefined) {
					throw new Error(`data.drop: Couldn't resolve data entry name '${dataEntryName}'`)
				}

				builder.emitUint(dataEntryIndex)
			}
		}),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 32-bit integer instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	i32: {
		const: (value: number | bigint): Instruction => ({
			opcodeName: 'i32.const',
			args: [value],

			immediatesEmitter: (builder) => {
				if (isBigInt(value)) {
					value = Number(BigInt.asIntN(32, value))
				} else {
					value |= 0
				}

				builder.emitInt(value)
			}
		}),

		eqz: createSimpleInstruction('i32.eqz'),
		eq: createSimpleInstruction('i32.eq'),
		ne: createSimpleInstruction('i32.ne'),
		lt_s: createSimpleInstruction('i32.lt_s'),
		lt_u: createSimpleInstruction('i32.lt_u'),
		gt_s: createSimpleInstruction('i32.gt_s'),
		gt_u: createSimpleInstruction('i32.gt_u'),
		le_s: createSimpleInstruction('i32.le_s'),
		le_u: createSimpleInstruction('i32.le_u'),
		ge_s: createSimpleInstruction('i32.ge_s'),
		ge_u: createSimpleInstruction('i32.ge_u'),

		clz: createSimpleInstruction('i32.clz'),
		ctz: createSimpleInstruction('i32.ctz'),
		popcnt: createSimpleInstruction('i32.popcnt'),
		add: createSimpleInstruction('i32.add'),
		sub: createSimpleInstruction('i32.sub'),
		mul: createSimpleInstruction('i32.mul'),
		div_s: createSimpleInstruction('i32.div_s'),
		div_u: createSimpleInstruction('i32.div_u'),
		rem_s: createSimpleInstruction('i32.rem_s'),
		rem_u: createSimpleInstruction('i32.rem_u'),
		and: createSimpleInstruction('i32.and'),
		or: createSimpleInstruction('i32.or'),
		xor: createSimpleInstruction('i32.xor'),
		shl: createSimpleInstruction('i32.shl'),
		shr_s: createSimpleInstruction('i32.shr_s'),
		shr_u: createSimpleInstruction('i32.shr_u'),
		rotl: createSimpleInstruction('i32.rotl'),
		rotr: createSimpleInstruction('i32.rotr'),

		wrap_i64: createSimpleInstruction('i32.wrap_i64'),
		trunc_f32_s: createSimpleInstruction('i32.trunc_f32_s'),
		trunc_f32_u: createSimpleInstruction('i32.trunc_f32_u'),
		trunc_f64_s: createSimpleInstruction('i32.trunc_f64_s'),
		trunc_f64_u: createSimpleInstruction('i32.trunc_f64_u'),
		reinterpret_f32: createSimpleInstruction('i32.reinterpret_f32'),
		extend8_s: createSimpleInstruction('i32.extend8_s'),
		extend16_s: createSimpleInstruction('i32.extend16_s'),

		trunc_sat_f32_s: createSimpleInstruction('i32.trunc_sat_f32_s'),
		trunc_sat_f32_u: createSimpleInstruction('i32.trunc_sat_f32_u'),
		trunc_sat_f64_s: createSimpleInstruction('i32.trunc_sat_f64_s'),
		trunc_sat_f64_u: createSimpleInstruction('i32.trunc_sat_f64_u'),

		load: createMemoryReadWriteInstruction('i32.load'),
		load8_s: createMemoryReadWriteInstruction('i32.load8_s'),
		load8_u: createMemoryReadWriteInstruction('i32.load8_u'),
		load16_s: createMemoryReadWriteInstruction('i32.load16_s'),
		load16_u: createMemoryReadWriteInstruction('i32.load16_u'),

		store: createMemoryReadWriteInstruction('i32.store'),
		store8: createMemoryReadWriteInstruction('i32.store8'),
		store16: createMemoryReadWriteInstruction('i32.store16'),

		// Atomic operations
		atomic: {
			load: createMemoryInstruction('i32.atomic.load'),
			load8_u: createMemoryInstruction('i32.atomic.load8_u'),
			load16_u: createMemoryInstruction('i32.atomic.load16_u'),

			store: createMemoryInstruction('i32.atomic.store'),
			store8: createMemoryInstruction('i32.atomic.store8'),
			store16: createMemoryInstruction('i32.atomic.store16'),

			rmw: {
				add: createMemoryInstruction('i32.atomic.rmw.add'),
				sub: createMemoryInstruction('i32.atomic.rmw.sub'),
				and: createMemoryInstruction('i32.atomic.rmw.and'),
				xor: createMemoryInstruction('i32.atomic.rmw.xor'),
				xchg: createMemoryInstruction('i32.atomic.rmw.xchg'),
				cmpxchg: createMemoryInstruction('i32.atomic.rmw.cmpxchg'),
			},

			rmw8: {
				add: createMemoryInstruction('i32.atomic.rmw8.add_u'),
				sub_u: createMemoryInstruction('i32.atomic.rmw8.sub_u'),
				and_u: createMemoryInstruction('i32.atomic.rmw8.and_u'),
				xor_u: createMemoryInstruction('i32.atomic.rmw8.xor_u'),
				xchg_u: createMemoryInstruction('i32.atomic.rmw8.xchg_u'),
				cmpxchg_u: createMemoryInstruction('i32.atomic.rmw8.cmpxchg_u'),
			},

			rmw16: {
				add: createMemoryInstruction('i32.atomic.rmw16.add_u'),
				sub_u: createMemoryInstruction('i32.atomic.rmw16.sub_u'),
				and_u: createMemoryInstruction('i32.atomic.rmw16.and_u'),
				xor_u: createMemoryInstruction('i32.atomic.rmw16.xor_u'),
				xchg_u: createMemoryInstruction('i32.atomic.rmw16.xchg_u'),
				cmpxchg_u: createMemoryInstruction('i32.atomic.rmw16.cmpxchg_u'),
			},
		}
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 64-bit integer instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	i64: {
		const: (value: bigint | number): Instruction => ({
			opcodeName: 'i64.const',

			args: [value],

			immediatesEmitter: (builder) => {
				if (isBigInt(value)) {
					value = BigInt.asIntN(64, value)
				}

				builder.emitInt(value)
			},
		}),

		eqz: createSimpleInstruction('i64.eqz'),
		eq: createSimpleInstruction('i64.eq'),
		ne: createSimpleInstruction('i64.ne'),
		lt_s: createSimpleInstruction('i64.lt_s'),
		lt_u: createSimpleInstruction('i64.lt_u'),
		gt_s: createSimpleInstruction('i64.gt_s'),
		gt_u: createSimpleInstruction('i64.gt_u'),
		le_s: createSimpleInstruction('i64.le_s'),
		le_u: createSimpleInstruction('i64.le_u'),
		ge_s: createSimpleInstruction('i64.ge_s'),
		ge_u: createSimpleInstruction('i64.ge_u'),

		clz: createSimpleInstruction('i64.clz'),
		ctz: createSimpleInstruction('i64.ctz'),
		popcnt: createSimpleInstruction('i64.popcnt'),
		add: createSimpleInstruction('i64.add'),
		sub: createSimpleInstruction('i64.sub'),
		mul: createSimpleInstruction('i64.mul'),
		div_s: createSimpleInstruction('i64.div_s'),
		div_u: createSimpleInstruction('i64.div_u'),
		rem_s: createSimpleInstruction('i64.rem_s'),
		rem_u: createSimpleInstruction('i64.rem_u'),
		and: createSimpleInstruction('i64.and'),
		or: createSimpleInstruction('i64.or'),
		xor: createSimpleInstruction('i64.xor'),
		shl: createSimpleInstruction('i64.shl'),
		shr_s: createSimpleInstruction('i64.shr_s'),
		shr_u: createSimpleInstruction('i64.shr_u'),
		rotl: createSimpleInstruction('i64.rotl'),
		rotr: createSimpleInstruction('i64.rotr'),

		extend_i32_s: createSimpleInstruction('i64.extend_i32_s'),
		extend_i32_u: createSimpleInstruction('i64.extend_i32_u'),
		trunc_f32_s: createSimpleInstruction('i64.trunc_f32_s'),
		trunc_f32_u: createSimpleInstruction('i64.trunc_f32_u'),
		trunc_f64_s: createSimpleInstruction('i64.trunc_f64_s'),
		trunc_f64_u: createSimpleInstruction('i64.trunc_f64_u'),
		reinterpret_f64: createSimpleInstruction('i64.reinterpret_f64'),
		extend8_s: createSimpleInstruction('i64.extend8_s'),
		extend16_s: createSimpleInstruction('i64.extend16_s'),
		extend32_s: createSimpleInstruction('i64.extend32_s'),

		trunc_sat_f32_s: createSimpleInstruction('i64.trunc_sat_f32_s'),
		trunc_sat_f32_u: createSimpleInstruction('i64.trunc_sat_f32_u'),
		trunc_sat_f64_s: createSimpleInstruction('i64.trunc_sat_f64_s'),
		trunc_sat_f64_u: createSimpleInstruction('i64.trunc_sat_f64_u'),

		load: createMemoryReadWriteInstruction('i64.load'),
		load8_s: createMemoryReadWriteInstruction('i64.load8_s'),
		load8_u: createMemoryReadWriteInstruction('i64.load8_u'),
		load16_s: createMemoryReadWriteInstruction('i64.load16_s'),
		load16_u: createMemoryReadWriteInstruction('i64.load16_u'),
		load32_s: createMemoryReadWriteInstruction('i64.load32_s'),
		load32_u: createMemoryReadWriteInstruction('i64.load32_u'),

		store: createMemoryReadWriteInstruction('i64.store'),
		store8: createMemoryReadWriteInstruction('i64.store8'),
		store16: createMemoryReadWriteInstruction('i64.store16'),
		store32: createMemoryReadWriteInstruction('i64.store32'),


		// Atomic operations
		atomic: {
			load: createMemoryInstruction('i64.atomic.load'),
			load8_u: createMemoryInstruction('i64.atomic.load8_u'),
			load16_u: createMemoryInstruction('i64.atomic.load16_u'),

			store: createMemoryInstruction('i64.atomic.store'),
			store8: createMemoryInstruction('i64.atomic.store8'),
			store16: createMemoryInstruction('i64.atomic.store16'),

			rmw: {
				add: createMemoryInstruction('i64.atomic.rmw.add'),
				sub: createMemoryInstruction('i64.atomic.rmw.sub'),
				and: createMemoryInstruction('i64.atomic.rmw.and'),
				xor: createMemoryInstruction('i64.atomic.rmw.xor'),
				xchg: createMemoryInstruction('i64.atomic.rmw.xchg'),
				cmpxchg: createMemoryInstruction('i64.atomic.rmw.cmpxchg'),
			},

			rmw8: {
				add: createMemoryInstruction('i64.atomic.rmw8.add_u'),
				sub_u: createMemoryInstruction('i64.atomic.rmw8.sub_u'),
				and_u: createMemoryInstruction('i64.atomic.rmw8.and_u'),
				xor_u: createMemoryInstruction('i64.atomic.rmw8.xor_u'),
				xchg_u: createMemoryInstruction('i64.atomic.rmw8.xchg_u'),
				cmpxchg_u: createMemoryInstruction('i64.atomic.rmw8.cmpxchg_u'),
			},

			rmw16: {
				add: createMemoryInstruction('i64.atomic.rmw16.add_u'),
				sub_u: createMemoryInstruction('i64.atomic.rmw16.sub_u'),
				and_u: createMemoryInstruction('i64.atomic.rmw16.and_u'),
				xor_u: createMemoryInstruction('i64.atomic.rmw16.xor_u'),
				xchg_u: createMemoryInstruction('i64.atomic.rmw16.xchg_u'),
				cmpxchg_u: createMemoryInstruction('i64.atomic.rmw16.cmpxchg_u'),
			},

			rmw32: {
				add: createMemoryInstruction('i64.atomic.rmw32.add_u'),
				sub_u: createMemoryInstruction('i64.atomic.rmw32.sub_u'),
				and_u: createMemoryInstruction('i64.atomic.rmw32.and_u'),
				xor_u: createMemoryInstruction('i64.atomic.rmw32.xor_u'),
				xchg_u: createMemoryInstruction('i64.atomic.rmw32.xchg_u'),
				cmpxchg_u: createMemoryInstruction('i64.atomic.rmw32.cmpxchg_u'),
			},
		}
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 32-bit floating point instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	f32: {
		const: (value: number): Instruction => ({
			opcodeName: 'f32.const',

			args: [value],

			immediatesEmitter: (builder) => {
				builder.emitFloat32(value)
			}
		}),

		eq: createSimpleInstruction('f32.eq'),
		ne: createSimpleInstruction('f32.ne'),
		lt: createSimpleInstruction('f32.lt'),
		gt: createSimpleInstruction('f32.gt'),
		le: createSimpleInstruction('f32.le'),
		ge: createSimpleInstruction('f32.ge'),

		abs: createSimpleInstruction('f32.abs'),
		neg: createSimpleInstruction('f32.neg'),
		ceil: createSimpleInstruction('f32.ceil'),
		floor: createSimpleInstruction('f32.floor'),
		trunc: createSimpleInstruction('f32.trunc'),
		nearest: createSimpleInstruction('f32.nearest'),
		sqrt: createSimpleInstruction('f32.sqrt'),
		add: createSimpleInstruction('f32.add'),
		sub: createSimpleInstruction('f32.sub'),
		mul: createSimpleInstruction('f32.mul'),
		div: createSimpleInstruction('f32.div'),
		min: createSimpleInstruction('f32.min'),
		max: createSimpleInstruction('f32.max'),
		copysign: createSimpleInstruction('f32.copysign'),

		convert_i32_s: createSimpleInstruction('f32.convert_i32_s'),
		convert_i32_u: createSimpleInstruction('f32.convert_i32_u'),
		convert_i64_s: createSimpleInstruction('f32.convert_i64_s'),
		convert_i64_u: createSimpleInstruction('f32.convert_i64_u'),
		demote_f64: createSimpleInstruction('f32.demote_f64'),

		reinterpret_i32: createSimpleInstruction('f32.reinterpret_i32'),

		load: createMemoryReadWriteInstruction('f32.load'),
		store: createMemoryReadWriteInstruction('f32.store'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 64-bit floating point instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	f64: {
		const: (value: number): Instruction => ({
			opcodeName: 'f64.const',

			args: [value],

			immediatesEmitter: (builder) => {
				builder.emitFloat64(value)
			}
		}),

		eq: createSimpleInstruction('f64.eq'),
		ne: createSimpleInstruction('f64.ne'),
		lt: createSimpleInstruction('f64.lt'),
		gt: createSimpleInstruction('f64.gt'),
		le: createSimpleInstruction('f64.le'),
		ge: createSimpleInstruction('f64.ge'),

		abs: createSimpleInstruction('f64.abs'),
		neg: createSimpleInstruction('f64.neg'),
		ceil: createSimpleInstruction('f64.ceil'),
		floor: createSimpleInstruction('f64.floor'),
		trunc: createSimpleInstruction('f64.trunc'),
		nearest: createSimpleInstruction('f64.nearest'),
		sqrt: createSimpleInstruction('f64.sqrt'),
		add: createSimpleInstruction('f64.add'),
		sub: createSimpleInstruction('f64.sub'),
		mul: createSimpleInstruction('f64.mul'),
		div: createSimpleInstruction('f64.div'),
		min: createSimpleInstruction('f64.min'),
		max: createSimpleInstruction('f64.max'),
		copysign: createSimpleInstruction('f64.copysign'),

		convert_i32_s: createSimpleInstruction('f64.convert_i32_s'),
		convert_i32_u: createSimpleInstruction('f64.convert_i32_u'),
		convert_i64_s: createSimpleInstruction('f64.convert_i64_s'),
		convert_i64_u: createSimpleInstruction('f64.convert_i64_u'),
		promote_f32: createSimpleInstruction('f64.promote_f32'),

		reinterpret_i64: createSimpleInstruction('f64.reinterpret_i64'),

		load: createMemoryReadWriteInstruction('f64.load'),
		store: createMemoryReadWriteInstruction('f64.store'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 128-bit vector SIMD instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	v128: {
		const: (bytes: ArrayLike<number>): Instruction => ({
			opcodeName: 'v128.const',

			args: [bytes],

			immediatesEmitter: (builder) => {
				builder.emitBytes(bytes)
			}
		}),

		load: createMemoryReadWriteInstruction('v128.load'),
		load8x8_s: createMemoryReadWriteInstruction('v128.load8x8_s'),
		load8x8_u: createMemoryReadWriteInstruction('v128.load8x8_u'),
		load16x4_s: createMemoryReadWriteInstruction('v128.load16x4_s'),
		load16x4_u: createMemoryReadWriteInstruction('v128.load16x4_u'),
		load32x2_s: createMemoryReadWriteInstruction('v128.load32x2_s'),
		load32x2_u: createMemoryReadWriteInstruction('v128.load32x2_u'),
		load8_splat: createMemoryReadWriteInstruction('v128.load8_splat'),
		load16_splat: createMemoryReadWriteInstruction('v128.load16_splat'),
		load32_splat: createMemoryReadWriteInstruction('v128.load32_splat'),
		load64_splat: createMemoryReadWriteInstruction('v128.load64_splat'),

		load8_lane: createMemoryReadWriteInstructionWithLane('v128.load8_lane'),
		load16_lane: createMemoryReadWriteInstructionWithLane('v128.load16_lane'),
		load32_lane: createMemoryReadWriteInstructionWithLane('v128.load32_lane'),
		load64_lane: createMemoryReadWriteInstructionWithLane('v128.load64_lane'),

		store: createMemoryReadWriteInstruction('v128.store'),
		store8_lane: createMemoryReadWriteInstructionWithLane('v128.store8_lane'),
		store16_lane: createMemoryReadWriteInstructionWithLane('v128.store16_lane'),
		store32_lane: createMemoryReadWriteInstructionWithLane('v128.store32_lane'),
		store64_lane: createMemoryReadWriteInstructionWithLane('v128.store64_lane'),

		not: createSimpleInstruction('v128.not'),
		and: createSimpleInstruction('v128.and'),
		andnot: createSimpleInstruction('v128.andnot'),
		or: createSimpleInstruction('v128.or'),
		xor: createSimpleInstruction('v128.xor'),
		bitselect: createSimpleInstruction('v128.bitselect'),
		any_true: createSimpleInstruction('v128.any_true'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 16 8-bit integers SIMD instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	i8x16: {
		shuffle: (laneIndexes: ArrayLike<number>): Instruction => ({
			opcodeName: 'i8x16.shuffle',

			args: [laneIndexes],

			immediatesEmitter: (builder) => {
				builder.emitBytes(laneIndexes)
			}
		}),
		extract_lane_s: (laneIndex: number) => createSimpleInstruction('i8x16.extract_lane_s', [laneIndex]),
		extract_lane_u: (laneIndex: number) => createSimpleInstruction('i8x16.extract_lane_u', [laneIndex]),
		replace_lane: (laneIndex: number) => createSimpleInstruction('i8x16.replace_lane', [laneIndex]),

		swizzle: createSimpleInstruction('i8x16.swizzle'),
		splat: createSimpleInstruction('i8x16.splat'),

		eq: createSimpleInstruction('i8x16.eq'),
		ne: createSimpleInstruction('i8x16.ne'),
		lt_s: createSimpleInstruction('i8x16.lt_s'),
		lt_u: createSimpleInstruction('i8x16.lt_u'),
		gt_s: createSimpleInstruction('i8x16.gt_s'),
		gt_u: createSimpleInstruction('i8x16.gt_u'),
		le_s: createSimpleInstruction('i8x16.le_s'),
		le_u: createSimpleInstruction('i8x16.le_u'),
		ge_s: createSimpleInstruction('i8x16.ge_s'),
		ge_u: createSimpleInstruction('i8x16.ge_u'),

		abs: createSimpleInstruction('i8x16.abs'),
		neg: createSimpleInstruction('i8x16.neg'),
		popcnt: createSimpleInstruction('i8x16.popcnt'),
		all_true: createSimpleInstruction('i8x16.all_true'),
		narrow_i16x8_s: createSimpleInstruction('i8x16.narrow_i16x8_s'),
		narrow_i16x8_u: createSimpleInstruction('i8x16.narrow_i16x8_u'),
		shl: createSimpleInstruction('i8x16.shl'),
		shr_s: createSimpleInstruction('i8x16.shr_s'),
		shr_u: createSimpleInstruction('i8x16.shr_u'),
		add: createSimpleInstruction('i8x16.add'),
		add_sat_s: createSimpleInstruction('i8x16.add_sat_s'),
		add_sat_u: createSimpleInstruction('i8x16.add_sat_u'),
		sub: createSimpleInstruction('i8x16.sub'),
		sub_sat_s: createSimpleInstruction('i8x16.sub_sat_s'),
		sub_sat_u: createSimpleInstruction('i8x16.sub_sat_u'),
		min_s: createSimpleInstruction('i8x16.min_s'),
		min_u: createSimpleInstruction('i8x16.min_u'),
		max_s: createSimpleInstruction('i8x16.max_s'),
		max_u: createSimpleInstruction('i8x16.max_u'),
		avgr_u: createSimpleInstruction('i8x16.avgr_u'),

		// Relaxed SIMD
		relaxed_swizzle: createSimpleInstruction('i8x16.relaxed_swizzle'),
		relaxed_laneselect: createSimpleInstruction('i8x16.relaxed_laneselect'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 8 16-bit integers SIMD instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	i16x8: {
		extract_lane_s: (laneIndex: number) =>
			createSimpleInstruction('i16x8.extract_lane_s', [laneIndex]),
		extract_lane_u: (laneIndex: number) =>
			createSimpleInstruction('i16x8.extract_lane_u', [laneIndex]),
		replace_lane: (laneIndex: number) =>
			createSimpleInstruction('i16x8.replace_lane', [laneIndex]),

		splat: createSimpleInstruction('i16x8.splat'),

		eq: createSimpleInstruction('i16x8.eq'),
		ne: createSimpleInstruction('i16x8.ne'),
		lt_s: createSimpleInstruction('i16x8.lt_s'),
		lt_u: createSimpleInstruction('i16x8.lt_u'),
		gt_s: createSimpleInstruction('i16x8.gt_s'),
		gt_u: createSimpleInstruction('i16x8.gt_u'),
		le_s: createSimpleInstruction('i16x8.le_s'),
		le_u: createSimpleInstruction('i16x8.le_u'),
		ge_s: createSimpleInstruction('i16x8.ge_s'),
		ge_u: createSimpleInstruction('i16x8.ge_u'),

		extadd_pairwise_i8x16_s: createSimpleInstruction('i16x8.extadd_pairwise_i8x16_s'),
		extadd_pairwise_i8x16_u: createSimpleInstruction('i16x8.extadd_pairwise_i8x16_u'),
		abs: createSimpleInstruction('i16x8.abs'),
		neg: createSimpleInstruction('i16x8.neg'),
		q15mulr_sat_s: createSimpleInstruction('i16x8.q15mulr_sat_s'),
		all_true: createSimpleInstruction('i16x8.all_true'),
		bitmask: createSimpleInstruction('i16x8.bitmask'),
		narrow_i32x4_s: createSimpleInstruction('i16x8.narrow_i32x4_s'),
		narrow_i32x4_u: createSimpleInstruction('i16x8.narrow_i32x4_u'),
		extend_low_i8x16_s: createSimpleInstruction('i16x8.extend_low_i8x16_s'),
		extend_high_i8x16_s: createSimpleInstruction('i16x8.extend_high_i8x16_s'),
		extend_low_i8x16_u: createSimpleInstruction('i16x8.extend_low_i8x16_u'),
		extend_high_i8x16_u: createSimpleInstruction('i16x8.extend_high_i8x16_u'),

		shl: createSimpleInstruction('i16x8.shl'),
		shr_s: createSimpleInstruction('i16x8.shr_s'),
		shr_u: createSimpleInstruction('i16x8.shr_u'),
		add: createSimpleInstruction('i16x8.add'),
		add_sat_s: createSimpleInstruction('i16x8.add_sat_s'),
		add_sat_u: createSimpleInstruction('i16x8.add_sat_u'),
		sub: createSimpleInstruction('i16x8.sub'),
		sub_sat_s: createSimpleInstruction('i16x8.sub_sat_s'),
		sub_sat_u: createSimpleInstruction('i16x8.sub_sat_u'),
		mul: createSimpleInstruction('i16x8.mul'),
		min_s: createSimpleInstruction('i16x8.min_s'),
		min_u: createSimpleInstruction('i16x8.min_u'),
		max_s: createSimpleInstruction('i16x8.max_s'),
		max_u: createSimpleInstruction('i16x8.max_u'),
		avgr_u: createSimpleInstruction('i16x8.avgr_u'),
		extmul_low_i8x16_s: createSimpleInstruction('i16x8.extmul_low_i8x16_s'),
		extmul_high_i8x16_s: createSimpleInstruction('i16x8.extmul_high_i8x16_s'),
		extmul_low_i8x16_u: createSimpleInstruction('i16x8.extmul_low_i8x16_u'),
		extmul_high_i8x16_u: createSimpleInstruction('i16x8.extmul_high_i8x16_u'),

		// Relaxed SIMD
		relaxed_laneselect: createSimpleInstruction('i16x8.relaxed_laneselect'),
		dot_i8x16_i7x16_s: createSimpleInstruction('i16x8.dot_i8x16_i7x16_s'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 4 32-bit integers SIMD instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	i32x4: {
		extract_lane: (laneIndex: number) =>
			createSimpleInstruction('i32x4.extract_lane', [laneIndex]),
		replace_lane: (laneIndex: number) =>
			createSimpleInstruction('i32x4.extract_lane', [laneIndex]),

		splat: createSimpleInstruction('i32x4.splat'),

		eq: createSimpleInstruction('i32x4.eq'),
		ne: createSimpleInstruction('i32x4.ne'),
		lt_s: createSimpleInstruction('i32x4.lt_s'),
		lt_u: createSimpleInstruction('i32x4.lt_u'),
		gt_s: createSimpleInstruction('i32x4.gt_s'),
		gt_u: createSimpleInstruction('i32x4.gt_u'),
		le_s: createSimpleInstruction('i32x4.le_s'),
		le_u: createSimpleInstruction('i32x4.le_u'),
		ge_s: createSimpleInstruction('i32x4.ge_s'),
		ge_u: createSimpleInstruction('i32x4.ge_u'),

		extadd_pairwise_i16x8_s: createSimpleInstruction('i32x4.extadd_pairwise_i16x8_s'),
		extadd_pairwise_i16x8_u: createSimpleInstruction('i32x4.extadd_pairwise_i16x8_u'),
		abs: createSimpleInstruction('i32x4.abs'),
		neg: createSimpleInstruction('i32x4.neg'),
		all_true: createSimpleInstruction('i32x4.all_true'),
		bitmask: createSimpleInstruction('i32x4.bitmask'),
		extend_low_i16x8_s: createSimpleInstruction('i32x4.extend_low_i16x8_s'),
		extend_high_i16x8_s: createSimpleInstruction('i32x4.extend_high_i16x8_s'),
		extend_low_i16x8_u: createSimpleInstruction('i32x4.extend_low_i16x8_u'),
		extend_high_i16x8_u: createSimpleInstruction('i32x4.extend_high_i16x8_u'),

		shl: createSimpleInstruction('i32x4.shl'),
		shr_s: createSimpleInstruction('i32x4.shr_s'),
		shr_u: createSimpleInstruction('i32x4.shr_u'),
		add: createSimpleInstruction('i32x4.add'),
		sub: createSimpleInstruction('i32x4.sub'),
		mul: createSimpleInstruction('i32x4.mul'),
		min_s: createSimpleInstruction('i32x4.min_s'),
		min_u: createSimpleInstruction('i32x4.min_u'),
		max_s: createSimpleInstruction('i32x4.max_s'),
		max_u: createSimpleInstruction('i32x4.max_u'),
		dot_i16x8_s: createSimpleInstruction('i32x4.dot_i16x8_s'),
		extmul_low_i16x8_s: createSimpleInstruction('i32x4.extmul_low_i16x8_s'),
		extmul_high_i16x8_s: createSimpleInstruction('i32x4.extmul_high_i16x8_s'),
		extmul_low_i16x8_u: createSimpleInstruction('i32x4.extmul_low_i16x8_u'),
		extmul_high_i16x8_u: createSimpleInstruction('i32x4.extmul_high_i16x8_u'),

		trunc_sat_f32x4_s: createSimpleInstruction('i32x4.trunc_sat_f32x4_s'),
		trunc_sat_f32x4_u: createSimpleInstruction('i32x4.trunc_sat_f32x4_u'),
		trunc_sat_f64x2_s_zero: createSimpleInstruction('i32x4.trunc_sat_f64x2_s_zero'),
		trunc_sat_f64x2_u_zero: createSimpleInstruction('i32x4.trunc_sat_f64x2_u_zero'),

		// Relaxed SIMD
		relaxed_trunc_f32x4_s: createSimpleInstruction('i32x4.relaxed_trunc_f32x4_s'),
		relaxed_trunc_f32x4_u: createSimpleInstruction('i32x4.relaxed_trunc_f32x4_u'),
		relaxed_trunc_f64x2_s_zero: createSimpleInstruction('i32x4.relaxed_trunc_f64x2_s_zero'),
		relaxed_trunc_f64x2_u_zero: createSimpleInstruction('i32x4.relaxed_trunc_f64x2_u_zero'),

		relaxed_laneselect: createSimpleInstruction('i32x4.relaxed_laneselect'),
		dot_i8x16_i7x16_add_s: createSimpleInstruction('i32x4.dot_i8x16_i7x16_add_s'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 2 64-bit integers SIMD instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	i64x2: {
		extract_lane: (laneIndex: number) =>
			createSimpleInstruction('i64x2.extract_lane', [laneIndex]),
		replace_lane: (laneIndex: number) =>
			createSimpleInstruction('i64x2.extract_lane', [laneIndex]),

		splat: createSimpleInstruction('i64x2.splat'),

		eq: createSimpleInstruction('i64x2.eq'),
		ne: createSimpleInstruction('i64x2.ne'),
		lt_s: createSimpleInstruction('i64x2.lt_s'),
		gt_s: createSimpleInstruction('i64x2.gt_s'),
		le_s: createSimpleInstruction('i64x2.le_s'),
		ge_s: createSimpleInstruction('i64x2.ge_s'),

		abs: createSimpleInstruction('i64x2.abs'),
		neg: createSimpleInstruction('i64x2.neg'),
		all_true: createSimpleInstruction('i64x2.all_true'),
		bitmask: createSimpleInstruction('i64x2.bitmask'),
		extend_low_i32x4_s: createSimpleInstruction('i64x2.extend_low_i32x4_s'),
		extend_high_i32x4_s: createSimpleInstruction('i64x2.extend_high_i32x4_s'),
		extend_low_i32x4_u: createSimpleInstruction('i64x2.extend_low_i32x4_u'),
		extend_high_i32x4_u: createSimpleInstruction('i64x2.extend_high_i32x4_u'),

		shl: createSimpleInstruction('i64x2.shl'),
		shr_s: createSimpleInstruction('i64x2.shr_s'),
		shr_u: createSimpleInstruction('i64x2.shr_u'),
		add: createSimpleInstruction('i64x2.add'),
		sub: createSimpleInstruction('i64x2.sub'),
		mul: createSimpleInstruction('i64x2.mul'),

		extmul_low_i32x4_s: createSimpleInstruction('i64x2.extmul_low_i32x4_s'),
		extmul_high_i32x4_s: createSimpleInstruction('i64x2.extmul_high_i32x4_s'),
		extmul_low_i32x4_u: createSimpleInstruction('i64x2.extmul_low_i32x4_u'),
		extmul_high_i32x4_u: createSimpleInstruction('i64x2.extmul_high_i32x4_u'),

		// Relaxed SIMD
		relaxed_laneselect: createSimpleInstruction('i64x2.relaxed_laneselect'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 4 32-bit floating point SIMD instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	f32x4: {
		extract_lane: (laneIndex: number) =>
			createSimpleInstruction('f32x4.extract_lane', [laneIndex]),
		replace_lane: (laneIndex: number) =>
			createSimpleInstruction('f32x4.extract_lane', [laneIndex]),

		eq: createSimpleInstruction('f32x4.eq'),
		ne: createSimpleInstruction('f32x4.ne'),
		lt: createSimpleInstruction('f32x4.lt'),
		gt: createSimpleInstruction('f32x4.gt'),
		le: createSimpleInstruction('f32x4.le'),
		ge: createSimpleInstruction('f32x4.ge'),

		ceil: createSimpleInstruction('f32x4.ceil'),
		floor: createSimpleInstruction('f32x4.floor'),
		trunc: createSimpleInstruction('f32x4.trunc'),
		nearest: createSimpleInstruction('f32x4.nearest'),
		abs: createSimpleInstruction('f32x4.abs'),
		neg: createSimpleInstruction('f32x4.neg'),
		sqrt: createSimpleInstruction('f32x4.sqrt'),
		add: createSimpleInstruction('f32x4.add'),
		sub: createSimpleInstruction('f32x4.sub'),
		mul: createSimpleInstruction('f32x4.mul'),
		div: createSimpleInstruction('f32x4.div'),
		min: createSimpleInstruction('f32x4.min'),
		max: createSimpleInstruction('f32x4.max'),
		pmin: createSimpleInstruction('f32x4.pmin'),
		pmax: createSimpleInstruction('f32x4.pmax'),

		convert_i32x4_s: createSimpleInstruction('f32x4.convert_i32x4_s'),
		convert_i32x4_u: createSimpleInstruction('f32x4.convert_i32x4_u'),
		demote_f64x2_zero: createSimpleInstruction('f32x4.demote_f64x2_zero'),

		// Relaxed SIMD
		qfma: createSimpleInstruction('f32x4.qfma'),
		qfms: createSimpleInstruction('f32x4.qfms'),
		relaxed_min: createSimpleInstruction('f32x4.relaxed_min'),
		relaxed_max: createSimpleInstruction('f32x4.relaxed_max'),
	},

	////////////////////////////////////////////////////////////////////////////////////////////////
	// 2 64-bit floating point SIMD instructions
	////////////////////////////////////////////////////////////////////////////////////////////////
	f64x2: {
		extract_lane: (laneIndex: number) =>
			createSimpleInstruction('f64x2.extract_lane', [laneIndex]),
		replace_lane: (laneIndex: number) =>
			createSimpleInstruction('f64x2.extract_lane', [laneIndex]),

		eq: createSimpleInstruction('f64x2.eq'),
		ne: createSimpleInstruction('f64x2.ne'),
		lt: createSimpleInstruction('f64x2.lt'),
		gt: createSimpleInstruction('f64x2.gt'),
		le: createSimpleInstruction('f64x2.le'),
		ge: createSimpleInstruction('f64x2.ge'),

		ceil: createSimpleInstruction('f64x2.ceil'),
		floor: createSimpleInstruction('f64x2.floor'),
		trunc: createSimpleInstruction('f64x2.trunc'),
		nearest: createSimpleInstruction('f64x2.nearest'),
		abs: createSimpleInstruction('f64x2.abs'),
		neg: createSimpleInstruction('f64x2.neg'),
		sqrt: createSimpleInstruction('f64x2.sqrt'),
		add: createSimpleInstruction('f64x2.add'),
		sub: createSimpleInstruction('f64x2.sub'),
		mul: createSimpleInstruction('f64x2.mul'),
		div: createSimpleInstruction('f64x2.div'),
		min: createSimpleInstruction('f64x2.min'),
		max: createSimpleInstruction('f64x2.max'),
		pmin: createSimpleInstruction('f64x2.pmin'),
		pmax: createSimpleInstruction('f64x2.pmax'),

		convert_low_i32x4_s: createSimpleInstruction('f64x2.convert_low_i32x4_s'),
		convert_low_i32x4_u: createSimpleInstruction('f64x2.convert_low_i32x4_u'),
		promote_low_f32x4: createSimpleInstruction('f64x2.promote_low_f32x4'),

		// Relaxed SIMD
		qfma: createSimpleInstruction('f64x2.qfma'),
		qfms: createSimpleInstruction('f64x2.qfms'),
		relaxed_min: createSimpleInstruction('f64x2.relaxed_min'),
		relaxed_max: createSimpleInstruction('f64x2.relaxed_max'),
	},
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Helper methods
////////////////////////////////////////////////////////////////////////////////////////////////
function createNamedLocalInstruction(opcodeName: OpcodeName, localName: string) {
	const instruction: Instruction = {
		opcodeName,

		args: [localName],

		immediatesEmitter: (builder, context) => {
			const localIndex = context.localsLookup.get(localName)

			if (localIndex === undefined) {
				throw new Error(`${opcodeName}: Couldn't resolve local '${localName}'`)
			}

			builder.emitUint(localIndex)
		}
	}

	return instruction
}

function createNamedGlobalInstruction(opcodeName: OpcodeName, globalName: string) {
	const instruction: Instruction = {
		opcodeName,

		args: [globalName],

		immediatesEmitter: (builder, context) => {
			const globalIndex = context.globalsLookup.get(globalName)

			if (globalIndex === undefined) {
				throw new Error(`${opcodeName}: Couldn't resolve global '${globalName}'`)
			}

			builder.emitUint(globalIndex)
		}
	}

	return instruction
}

function createBlockInstruction(opcodeName: 'block' | 'loop') {
	return (nameOrOptions: string | BlockOptions, body: Instruction[]) => {
		let options: BlockOptions

		if (isString(nameOrOptions)) {
			options = {
				name: nameOrOptions,
			}
		} else {
			options = nameOrOptions
		}

		const instruction: BlockInstruction = {
			opcodeName: opcodeName,
			args: [options.name, options.returns, body],

			immediatesEmitter: (builder) => {
				if (options.returns !== undefined) {
					builder.emitValueType(options.returns)
				} else {
					builder.emitByte(emptyType)
				}
			},

			blockName: options.name,

			bodyInstructions: body
		}

		return instruction
	}
}

export function createBranchInstruction(opcodeName: OpcodeName) {
	return (targetBlockName: string): Instruction => ({
		opcodeName,
		args: [targetBlockName],

		immediatesEmitter: (builder, context) => {
			const blockIndex = context.blockStack.indexOf(targetBlockName)

			if (blockIndex === undefined) {
				throw new Error(`${opcodeName}: Couldn't resolve block name '${targetBlockName}'`)
			}

			builder.emitUint(blockIndex)
		},
	})
}

export function createGCTypeInstruction(opcodeName: OpcodeName) {
	return (typeName: string): Instruction => ({
		opcodeName,
		args: [typeName],

		immediatesEmitter: (builder, context) => {
			const typeIndex = context.typesLookup.get(typeName)

			if (typeIndex === undefined) {
				throw new Error(`${opcodeName}: Couldn't resolve type name '${typeName}'`)
			}

			builder.emitUint(typeIndex)
		}
	})
}

export function createGCTypeInstructionWithFieldIndex(opcodeName: OpcodeName) {
	return (typeName: string, fieldIndex: number): Instruction => ({
		opcodeName,
		args: [typeName, fieldIndex],

		immediatesEmitter: (builder, context) => {
			const typeIndex = context.typesLookup.get(typeName)

			if (typeIndex === undefined) {
				throw new Error(`${opcodeName}: Couldn't resolve type name '${typeName}'`)
			}

			builder.emitUint(typeIndex)
			builder.emitUint(fieldIndex)
		}
	})
}

export function createTableInstruction(opcodeName: OpcodeName) {
	return (tableName: string): Instruction => ({
		opcodeName,
		args: [tableName],

		immediatesEmitter: (builder, context) => {
			const tableIndex = context.tablesLookup.get(tableName)

			if (tableIndex === undefined) {
				throw new Error(`${opcodeName}: Couldn't resolve table name '${tableName}'`)
			}

			builder.emitUint(tableIndex)
		}
	})
}

export function createMemoryInstruction(opcodeName: OpcodeName) {
	return (memoryName: string): Instruction => ({
		opcodeName,
		args: [memoryName],

		immediatesEmitter: (builder, context) => {
			const memoryIndex = context.memoriesLookup.get(memoryName)

			if (memoryIndex === undefined) {
				throw new Error(`${opcodeName}: Couldn't resolve memory name '${memoryName}'`)
			}

			builder.emitUint(memoryIndex)
		}
	})
}

export function createMemoryReadWriteInstruction(opcodeName: OpcodeName) {
	return (align: number, offset: number) =>
		createSimpleInstruction(opcodeName, [align, offset])
}

export function createMemoryReadWriteInstructionWithLane(opcodeName: OpcodeName) {
	return (align: number, offset: number, laneIndex: number) =>
		createSimpleInstruction(opcodeName, [align, offset, laneIndex])
}

export function createBranchOnCastInstruction(opcodeName: 'br_on_cast' | 'br_on_cast_fail') {
	return (targetBlockName: string, type1: HeapTypeId, type2: HeapTypeId, branchOnType1Null = false, branchOnType2Null = false): Instruction => ({
		opcodeName,
		args: [targetBlockName, type1, type2, branchOnType1Null, branchOnType2Null],

		immediatesEmitter: (builder, context) => {
			const blockIndex = context.blockStack.indexOf(targetBlockName)

			if (blockIndex === undefined) {
				throw new Error(`${opcodeName}: Couldn't resolve block name '${targetBlockName}'`)
			}

			const flags = Number(branchOnType1Null) | (Number(branchOnType2Null) << 1)

			builder.emitByte(flags)
			builder.emitUint(blockIndex)
			builder.emitByte(type1)
			builder.emitByte(type2)
		}
	})
}

export function createSimpleInstruction(opcodeName: OpcodeName, immediates?: ImmediateType[]): Instruction {
	immediates = immediates ?? []

	return {
		opcodeName,
		args: immediates,

		immediatesEmitter: (builder) => {
			for (const immediate of immediates) {
				builder.emitUint(immediate)
			}
		},
	}
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Counter for naming anonymous blocks
////////////////////////////////////////////////////////////////////////////////////////////////
let anonymousBlockCounter = 0

////////////////////////////////////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////////////////////////////////////
interface BlockOptions {
	name: string
	returns?: ValueType
}

interface IfOptions {
	returns?: ValueType
}


