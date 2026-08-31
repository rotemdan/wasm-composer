import { OpcodeName } from './Opcodes.js'
import { ArrayType, BlockInstruction, CompositeType, FunctionSignature, Instruction, RecursiveType, StructType, SubtypeOrRecursiveType } from './Types.js'

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Type predicates
//////////////////////////////////////////////////////////////////////////////////////////////////////
export function isArrayType(compositeType: CompositeType): compositeType is ArrayType {
	return (compositeType as ArrayType).storageType !== undefined
}

export function isStructType(compositeType: CompositeType): compositeType is StructType {
	return (compositeType as StructType).fields !== undefined
}

export function isRecursiveType(recursiveTypeOrSubtype: SubtypeOrRecursiveType): recursiveTypeOrSubtype is RecursiveType {
	return (recursiveTypeOrSubtype as RecursiveType).subtypes !== undefined
}

export function isFunctionSignature(compositeType: CompositeType): compositeType is FunctionSignature {
	return (compositeType as FunctionSignature).paramTypes !== undefined &&
		(compositeType as FunctionSignature).returnTypes !== undefined
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Control-flow opcode predicates
//
// Used by the flattening logic. Frames are label-defining
// blocks. Clauses (`else`/`catch`/`catch_all`/`delegate`) belong to a preceding frame.
// Centralising them as predicates (instead of duplicated inline comparisons or one-off sets)
// gives every check a single source of truth that is reused below.
//////////////////////////////////////////////////////////////////////////////////////////////////////
export function isIfClauseOpcode(opcodeName: OpcodeName): boolean {
	return opcodeName === 'else'
}

export function isCatchClauseOpcode(opcodeName: OpcodeName): boolean {
	return opcodeName === 'catch' || opcodeName === 'catch_all'
}

export function isTryContinuationOpcode(opcodeName: OpcodeName): boolean {
	return isCatchClauseOpcode(opcodeName) || opcodeName === 'delegate'
}

export function isClauseOpcode(opcodeName: OpcodeName): boolean {
	return isIfClauseOpcode(opcodeName) || isTryContinuationOpcode(opcodeName)
}

export function isFrameOpcode(opcodeName: OpcodeName): boolean {
	return opcodeName === 'block' || opcodeName === 'loop' || opcodeName === 'if' || opcodeName === 'try' || opcodeName === 'try_table'
}

export function isTryFrameOpcode(opcodeName: OpcodeName): boolean {
	return opcodeName === 'try' || opcodeName === 'try_table'
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Instruction predicates
//////////////////////////////////////////////////////////////////////////////////////////////////////
export function isBlockInstruction(instruction: Instruction): instruction is BlockInstruction {
	return Array.isArray((instruction as BlockInstruction).bodyInstructions)
}
