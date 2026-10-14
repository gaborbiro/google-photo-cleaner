// Copies the AI libraries into lib/: extensions may not load code from the internet,
// so the runtime the library would otherwise fetch from a CDN is packed in. Every variant
// of the ONNX Runtime WebAssembly build is copied; which one loads depends on the backend
// (the WebGPU backend of this version uses the "asyncify" build).
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

mkdirSync("lib", { recursive: true });
copyFileSync("node_modules/@huggingface/transformers/dist/transformers.min.js", "lib/transformers.min.js");
const runtime = readdirSync("node_modules/onnxruntime-web/dist").filter((f) => /^ort-wasm-simd-threaded.*\.(mjs|wasm)$/.test(f));
for (const f of runtime) copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `lib/${f}`);
console.log(`copied transformers.min.js and ${runtime.length} runtime files into lib/: ${runtime.join(", ")}`);
