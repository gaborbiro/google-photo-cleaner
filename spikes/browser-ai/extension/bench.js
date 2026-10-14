// The benchmark every placement runs: EmbeddingGemma 2 at detail 140 (fp16) on the 354
// exported calibration photos, scored against the labels. Photos and the answer key come
// from the local test server (spikes/browser-ai/serve.py); results are posted back to it.
import { AutoConfig, AutoModel, AutoProcessor, RawImage, env } from "./lib/transformers.min.js";

const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
const SERVER = "http://localhost:8123";
const DETAIL = 140;
const DUPLICATE_LABELS = new Set(["SAME", "NEAR_DUPLICATE"]);

// Extensions may not load code from the internet: the GPU runtime comes from lib/, not a CDN.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("lib/");
// Multi-threaded WebAssembly needs cross-origin isolation, which an embedded panel can't have.
// The GPU does the work either way.
env.backends.onnx.wasm.numThreads = 1;

export async function describeGpu() {
  if (!globalThis.navigator?.gpu) return { available: false, description: "navigator.gpu is missing" };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return { available: false, description: "no GPU adapter" };
  const info = adapter.info ?? {};
  return { available: true, description: [info.vendor, info.architecture].filter(Boolean).join(" / ") || "unknown GPU" };
}

export async function runBenchmark(placement, report) {
  const gpu = await describeGpu();
  report(`${placement}: WebGPU ${gpu.available ? "available" : "NOT available"} (${gpu.description})`);
  if (!gpu.available) throw new Error("WebGPU not available here");

  const manifest = await (await fetch(`${SERVER}/data/manifest.json`)).json();
  const loadStarted = performance.now();
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  processor.image_processor.max_soft_tokens = DETAIL;
  const config = await AutoConfig.from_pretrained(MODEL_ID);
  config.audio_config = null;
  let lastProgress = 0;
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    config,
    device: "webgpu",
    dtype: "fp16",
    progress_callback: (p) => {
      if (p.status === "progress" && performance.now() - lastProgress > 1500) {
        lastProgress = performance.now();
        report(`downloading ${p.file}: ${Math.round(p.progress)}%`);
      }
    },
  });
  const loadSeconds = (performance.now() - loadStarted) / 1000;
  report(`model ready in ${loadSeconds.toFixed(1)} s`);

  const images = [];
  for (const photo of manifest.photos) images.push(await RawImage.fromURL(`${SERVER}/data/${photo.file}`));
  const embed = async (image) => normalise((await model(await processor(null, image))).sentence_embedding.data);
  await embed(images[0]); // warm-up: compiles the GPU programs

  const vectors = new Map();
  const started = performance.now();
  for (let i = 0; i < images.length; i++) {
    vectors.set(manifest.photos[i].id, await embed(images[i]));
    if ((i + 1) % 50 === 0) report(`embedded ${i + 1} of ${images.length}`);
  }
  const photosPerSecond = images.length / ((performance.now() - started) / 1000);
  await model.dispose?.();

  const pairs = manifest.pairs.map((p) => ({ duplicate: DUPLICATE_LABELS.has(p.label), score: dot(vectors.get(p.a), vectors.get(p.b)) }));
  const different = pairs.filter((p) => !p.duplicate).map((p) => p.score).sort((a, b) => b - a);
  const threshold = (different[1] ?? -1) + 1e-6; // allow one wrongly flagged pair, like the desktop
  const result = {
    placement,
    gpu: gpu.description,
    detail: DETAIL,
    loadSeconds,
    photosPerSecond,
    threshold,
    duplicatesFound: pairs.filter((p) => p.duplicate && p.score >= threshold).length,
    duplicates: pairs.filter((p) => p.duplicate).length,
    wronglyFlagged: pairs.filter((p) => !p.duplicate && p.score >= threshold).length,
  };
  await fetch(`${SERVER}/results/ext-${placement}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result, null, 2) });
  report(`${photosPerSecond.toFixed(2)} photos/s · found ${result.duplicatesFound} of ${result.duplicates} duplicates, ${result.wronglyFlagged} wrongly flagged · saved results-ext-${placement}.json`);
  return result;
}

function normalise(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return Float32Array.from(v, (x) => x / norm);
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
