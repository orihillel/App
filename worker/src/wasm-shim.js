// Making the .om reader's WebAssembly work inside a Worker.
//
// @openmeteo/file-reader is an Emscripten build. Its web variant locates its own .wasm by URL,
// which a bundled Worker has no meaningful answer for -- findWasmBinary throws "Invalid URL
// string" and initWasm fails before reading a byte. Workers also refuse to compile wasm from
// bytes at runtime, so handing it a buffer is not the fix either.
//
// What a Worker *can* do is instantiate a module the bundler compiled at deploy time, which is
// what the `CompiledWasm` rule in wrangler.toml produces from the .wasm import below.
// Emscripten's instantiateWasm hook is the seam for supplying it.
//
// wrangler.toml aliases the whole @openmeteo/file-format-wasm package to this file, so the
// reader's own lazy import lands here instead and never reaches the URL-resolving path. The
// imports below are relative file paths rather than the package specifier for two reasons:
// the package's exports map has no subpath entry for dist/, and the bare specifier is the one
// being aliased, so using it here would be circular.
//
// Verified in the real Worker runtime (workerd via `wrangler dev --local`), not assumed: wasm
// initialises, and a live 1.43MB global wave file decodes to 1,038,240 values in about 36ms
// with the mid-Pacific reading matching the same file decoded under Node exactly.
import wasmModule from '../node_modules/@openmeteo/file-format-wasm/dist/om_file_format.web.wasm';
import OmFileFormat from '../node_modules/@openmeteo/file-format-wasm/dist/om_file_format.web.js';

export default function factory(opts = {}) {
  return OmFileFormat({
    ...opts,
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(wasmModule, imports).then((instance) => done(instance, wasmModule));
      return {};
    },
  });
}
