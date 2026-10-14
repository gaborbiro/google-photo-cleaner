// Browser AI test: embeds the exported calibration photos with EmbeddingGemma 2 on WebGPU
// and compares speed and results with the desktop app (Python, PyTorch, bf16 on CUDA).
import { AutoConfig, AutoModel, AutoProcessor, RawImage } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";

const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
const DUPLICATE_LABELS = new Set(["SAME", "NEAR_DUPLICATE"]);

const logEl = document.getElementById("log");
const log = (line) => { logEl.textContent += line + "\n"; };
const $ = (id) => document.getElementById(id);

const manifest = await (await fetch("../data/manifest.json")).json();
log(`${manifest.photos.length} photos, ${manifest.pairs.length} labelled pairs; desktop detail ${manifest.tokenBudget}, threshold ${manifest.desktopThreshold}`);

const gpu = await describeGpu();
$("gpu").textContent = gpu.available
  ? `WebGPU available: ${gpu.description}`
  : "WebGPU is NOT available in this browser; the test cannot run.";
const buttons = [$("run"), $("run-speed")];
buttons.forEach((b) => (b.disabled = !gpu.available));
$("run").onclick = () => guarded(() => run({ dtype: $("dtype").value, budget: Number($("budget").value), batch: Number($("batch").value) }));
$("run-speed").onclick = () => guarded(async () => {
  for (const budget of [280, 140, 70]) for (const batch of [1, 4]) await run({ dtype: "fp16", budget, batch });
});

async function guarded(action) {
  buttons.forEach((b) => (b.disabled = true));
  try {
    await action();
  } catch (e) {
    log(`FAILED: ${e.stack ?? e}`);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function describeGpu() {
  if (!navigator.gpu) return { available: false };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return { available: false };
  const info = adapter.info ?? {};
  return { available: true, description: [info.vendor, info.architecture, info.description].filter(Boolean).join(" / ") || "unknown GPU" };
}

// One model per precision, kept between runs: detail and batch size don't need a reload.
const models = new Map();
let processor = null;

async function load(dtype) {
  if (!processor) processor = await AutoProcessor.from_pretrained(MODEL_ID);
  if (models.has(dtype)) return { model: models.get(dtype), loadSeconds: 0 };
  const started = performance.now();
  const config = await AutoConfig.from_pretrained(MODEL_ID);
  config.audio_config = null; // images only: skips the audio encoder download
  let lastProgress = 0;
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    config,
    device: "webgpu",
    dtype,
    progress_callback: (p) => {
      if (p.status === "progress" && performance.now() - lastProgress > 1000) {
        lastProgress = performance.now();
        log(`downloading ${p.file}: ${Math.round(p.progress)}%`);
      }
    },
  });
  models.set(dtype, model);
  return { model, loadSeconds: (performance.now() - started) / 1000 };
}

let images = null;

async function run({ dtype, budget, batch }) {
  const name = `${dtype}-t${budget}-b${batch}`;
  log(`\n=== ${name} ===`);
  const { model, loadSeconds } = await load(dtype);
  processor.image_processor.max_soft_tokens = budget;
  if (!images) {
    images = [];
    for (const photo of manifest.photos) images.push(await RawImage.fromURL(`../data/${photo.file}`));
  }

  // Preparing the images (CPU, JavaScript) and running the model (GPU) are timed separately.
  let prepMs = 0;
  let modelMs = 0;
  let batched = batch > 1;
  const embedGroup = async (group) => {
    const t0 = performance.now();
    const inputs = await processor(null, group.length === 1 ? group[0] : group);
    const t1 = performance.now();
    const { sentence_embedding: out } = await model(inputs);
    const t2 = performance.now();
    prepMs += t1 - t0;
    modelMs += t2 - t1;
    const [rows, dim] = out.dims;
    if (rows !== group.length) throw new Error(`asked for ${group.length} embeddings, got ${rows}`);
    return Array.from({ length: rows }, (_, i) => normalise(out.data.subarray(i * dim, (i + 1) * dim)));
  };

  // Warm-up: the first call compiles the GPU programs; not counted.
  const warmStarted = performance.now();
  await embedGroup([images[0]]);
  if (batched) {
    try {
      await embedGroup(images.slice(0, batch));
    } catch (e) {
      log(`several photos per GPU call is not supported by this model setup (${e.message}); running one at a time`);
      batched = false;
    }
  }
  const warmupSeconds = (performance.now() - warmStarted) / 1000;
  prepMs = 0;
  modelMs = 0;

  const vectors = new Map();
  const step = batched ? batch : 1;
  const started = performance.now();
  for (let i = 0; i < images.length; i += step) {
    const group = images.slice(i, i + step);
    const out = await embedGroup(group);
    out.forEach((v, j) => vectors.set(manifest.photos[i + j].id, v));
    if (Math.floor((i + step) / 50) > Math.floor(i / 50)) log(`embedded ${Math.min(i + step, images.length)} of ${images.length}`);
  }
  const seconds = (performance.now() - started) / 1000;

  const timing = {
    loadSeconds,
    warmupSeconds,
    photosPerSecond: images.length / seconds,
    prepareMsPerPhoto: prepMs / images.length,
    modelMsPerPhoto: modelMs / images.length,
    otherMsPerPhoto: (seconds * 1000 - prepMs - modelMs) / images.length,
    batched,
  };
  const result = analyse({ name, dtype, budget, batch }, vectors, timing);
  show(result);
  await fetch(`/results/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result, null, 2) });
  log(`saved results-${name}.json`);
}

function analyse(setup, vectors, timing) {
  // How close each photo's browser vector is to the desktop one (1.0 = identical).
  // Only a like-for-like comparison at the desktop's detail (280).
  const fidelity = manifest.photos.map((p) => dot(vectors.get(p.id), p.desktopVector)).sort((a, b) => a - b);

  const pairs = manifest.pairs.map((pair) => ({
    ...pair,
    duplicate: DUPLICATE_LABELS.has(pair.label),
    browserScore: dot(vectors.get(pair.a), vectors.get(pair.b)),
  }));
  const diffs = pairs.map((p) => Math.abs(p.browserScore - p.desktopScore)).sort((a, b) => a - b);
  const threshold = manifest.desktopThreshold;

  return {
    ...setup,
    gpu: gpu.description,
    userAgent: navigator.userAgent,
    photos: manifest.photos.length,
    pairs: pairs.length,
    timing,
    photoFidelity: { min: fidelity[0], median: median(fidelity), mean: mean(fidelity) },
    pairScoreDifference: { median: median(diffs), p95: diffs[Math.floor(diffs.length * 0.95)], max: diffs.at(-1) },
    pairScoreCorrelation: pearson(pairs.map((p) => p.desktopScore), pairs.map((p) => p.browserScore)),
    atDesktopThreshold: {
      threshold,
      desktop: confusion(pairs, "desktopScore", threshold),
      browser: confusion(pairs, "browserScore", threshold),
      pairsDecidedDifferently: pairs.filter((p) => (p.browserScore >= threshold) !== (p.desktopScore >= threshold)).length,
    },
    // Each setup at its own best threshold (allowing one wrongly flagged pair, like the desktop
    // at 0.925): the fair way to compare different detail levels.
    atOwnThreshold: { desktop: allowingOneWrong(pairs, "desktopScore"), browser: allowingOneWrong(pairs, "browserScore") },
    pairScores: pairs.map(({ a, b, label, desktopScore, browserScore }) => ({ a, b, label, desktopScore, browserScore })),
  };
}

/** Duplicates found, different photos wrongly flagged, and duplicates missed. */
function confusion(pairs, field, threshold) {
  const flagged = pairs.filter((p) => p[field] >= threshold);
  return {
    truePositives: flagged.filter((p) => p.duplicate).length,
    falsePositives: flagged.filter((p) => !p.duplicate).length,
    missed: pairs.filter((p) => p.duplicate && p[field] < threshold).length,
  };
}

/** The lowest threshold that flags at most one different pair, and what it finds. */
function allowingOneWrong(pairs, field) {
  const different = pairs.filter((p) => !p.duplicate).map((p) => p[field]).sort((a, b) => b - a);
  const threshold = (different[1] ?? -1) + 1e-6;
  return { threshold, ...confusion(pairs, field, threshold) };
}

function show(r) {
  const fmt = (x, d = 4) => (typeof x === "number" ? x.toFixed(d) : String(x));
  const row = (name, ...cells) => `<tr><td>${name}</td>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
  const own = r.atOwnThreshold;
  $("results").insertAdjacentHTML("beforeend", `
    <h2>${r.name}</h2>
    <p><b>${fmt(r.timing.photosPerSecond, 2)} photos/s</b> (desktop app: about 8) ·
       per photo: preparing ${fmt(r.timing.prepareMsPerPhoto, 0)} ms (CPU), model ${fmt(r.timing.modelMsPerPhoto, 0)} ms (GPU),
       other ${fmt(r.timing.otherMsPerPhoto, 0)} ms${r.batch > 1 && !r.timing.batched ? " · batching not supported, ran one at a time" : ""}</p>
    <table>
      <tr><th>Each at its own best threshold</th><th>threshold</th><th>duplicates found (of 86)</th><th>wrongly flagged</th></tr>
      ${row("Desktop (detail 280)", fmt(own.desktop.threshold, 3), own.desktop.truePositives, own.desktop.falsePositives)}
      ${row(`Browser (detail ${r.budget})`, fmt(own.browser.threshold, 3), own.browser.truePositives, own.browser.falsePositives)}
    </table>
    ${r.budget === manifest.tokenBudget ? `<p>Same vectors as desktop: median ${fmt(r.photoFidelity.median)} ·
       ${r.atDesktopThreshold.pairsDecidedDifferently} of ${r.pairs} pairs decided differently at ${manifest.desktopThreshold}</p>` : ""}`);
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

function mean(xs) { return xs.reduce((s, x) => s + x, 0) / xs.length; }

function median(sorted) { return sorted[Math.floor(sorted.length / 2)]; }

function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
