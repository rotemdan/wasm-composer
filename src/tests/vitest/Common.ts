import { encodeWasmModule, WasmModuleDefinition } from '../../exports/Exports.js'

export async function encodeAndInstantiateWasmModuleDefinition(wasmModuleDefinition: WasmModuleDefinition) {
	const wasmBytes = encodeWasmModule(wasmModuleDefinition)

	const wasmModuleInstance = await WebAssembly.instantiate(wasmBytes)

	const moduleExports = wasmModuleInstance.instance.exports

	return { wasmBytes, wasmModuleInstance, moduleExports }
}
