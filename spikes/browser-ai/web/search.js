// Browser search test: are "more like these" and text search as good at detail 140 / 70 as
// at the desktop's 280? Approved Search sweeps are the answer key.
import { AutoConfig, AutoModel, AutoProcessor, RawImage } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";

const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
const QUERY_PREFIX = "task: search result | query: "; // the model's "SearchQuery" prompt, as the desktop uses it
const SEEDS = 3;
const MIN_SWEEP = 10; // smaller sweeps are too small to measure
const BROWSER_DETAILS = [140, 70];

const $ = (id) => document.getElementById(id);
const log = (line) => { $("log").textContent += line + "\n"; };

const manifest = await (await fetch("../data/search/manifest.json")).json();
const photos = manifest.photos;
log(`${photos.length} photos; sweeps of ${manifest.sweepSizes.join(", ")} photos`);

const adapter = navigator.gpu && (await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }));
$("gpu").textContent = adapter
  ? `WebGPU available: ${[adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(" / ")}`
  : "WebGPU is NOT available in this browser.";
$("run").disabled = !adapter;
$("run").onclick = async () => {
  $("run").disabled = true;
  try {
    await run($("query").value.trim());
  } catch (e) {
    log(`FAILED: ${e.stack ?? e}`);
  } finally {
    $("run").disabled = false;
  }
};

let cache = null; // vectors per detail, kept so a second text query is instant
let processor = null;
let model = null;

async function run(queryText) {
  if (!model) {
    processor = await AutoProcessor.from_pretrained(MODEL_ID);
    const config = await AutoConfig.from_pretrained(MODEL_ID);
    config.audio_config = null;
    model = await AutoModel.from_pretrained(MODEL_ID, { config, device: "webgpu", dtype: "fp16" });
  }
  const embedOutput = async (inputs) => normalise((await model(inputs)).sentence_embedding.data);

  if (!cache) {
    cache = new Map([[280, new Map(photos.map((p) => [p.id, Float32Array.from(p.desktopVector)]))]]);
    const images = [];
    for (const p of photos) images.push(await RawImage.fromURL(`../data/search/${p.file}`));
    log("photos loaded");
    for (const detail of BROWSER_DETAILS) {
      processor.image_processor.max_soft_tokens = detail;
      const vectors = new Map();
      const started = performance.now();
      for (let i = 0; i < images.length; i++) {
        vectors.set(photos[i].id, await embedOutput(await processor(null, images[i])));
        if ((i + 1) % 200 === 0) log(`detail ${detail}: ${i + 1} of ${images.length}`);
      }
      log(`detail ${detail}: ${(images.length / ((performance.now() - started) / 1000)).toFixed(2)} photos/s`);
      cache.set(detail, vectors);
    }
  }
  const queryVector = await embedOutput(await processor([QUERY_PREFIX + queryText]));

  const details = [...cache.keys()];
  const sweeps = [...new Set(photos.map((p) => p.sweep).filter((s) => s !== null))]
    .map((s) => ({ sweep: s, ids: photos.filter((p) => p.sweep === s).map((p) => p.id).sort() }))
    .filter((s) => s.ids.length >= MIN_SWEEP);

  // "More like these": 3 examples from each sweep; how much of the rest of the sweep comes back first?
  const likeThis = sweeps.map(({ sweep, ids }) => {
    const seeds = [0, 1, 2].map((k) => ids[Math.floor((k * ids.length) / SEEDS)]);
    const wanted = new Set(ids.filter((id) => !seeds.includes(id)));
    const perDetail = Object.fromEntries(details.map((d) => {
      const vectors = cache.get(d);
      const target = normalise(mean(seeds.map((id) => vectors.get(id))));
      const ranked = rank(vectors, target, new Set(seeds));
      return [d, found(ranked, wanted)];
    }));
    return { sweep, size: ids.length, perDetail };
  });

  // Text search: how much of each sweep is among the strongest matches, and what comes first.
  const textSearch = Object.fromEntries(details.map((d) => {
    const ranked = rank(cache.get(d), queryVector, new Set());
    return [d, {
      perSweep: sweeps.map(({ sweep, ids }) => ({ sweep, ...found(ranked, new Set(ids)) })),
      top: ranked.slice(0, 24),
      top100: ranked.slice(0, 100),
    }];
  }));
  const overlapWith280 = Object.fromEntries(details.filter((d) => d !== 280).map((d) => {
    const base = new Set(textSearch[280].top100);
    return [d, textSearch[d].top100.filter((id) => base.has(id)).length];
  }));

  const result = { queryText, details, likeThis, textSearch: mapValues(textSearch, (v) => ({ perSweep: v.perSweep, top24: v.top })), textTop100OverlapWith280: overlapWith280 };
  show(result, sweeps);
  await fetch(`/results/search-${slug(queryText)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result, null, 2) });
  log(`saved results-search-${slug(queryText)}.json`);
}

/** Of the [wanted] photos, how many are in the first |wanted| results (and in twice as many). */
function found(ranked, wanted) {
  const n = wanted.size;
  const inFirst = (k) => ranked.slice(0, k).filter((id) => wanted.has(id)).length;
  return { wanted: n, inFirstN: inFirst(n), inFirst2N: inFirst(2 * n) };
}

function rank(vectors, target, exclude) {
  return [...vectors.entries()]
    .filter(([id]) => !exclude.has(id))
    .map(([id, v]) => [id, dot(v, target)])
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

function show(r, sweeps) {
  const pct = (f) => `${f.inFirstN}/${f.wanted} (${Math.round((100 * f.inFirstN) / f.wanted)}%)`;
  const head = `<tr><th></th>${r.details.map((d) => `<th>detail ${d}${d === 280 ? " (desktop)" : ""}</th>`).join("")}</tr>`;
  const likeRows = r.likeThis.map((s) => `<tr><td>Sweep ${s.sweep} (${s.size} photos)</td>${r.details.map((d) => `<td>${pct(s.perDetail[d])}</td>`).join("")}</tr>`).join("");
  const textRows = sweeps.map(({ sweep, ids }) => `<tr><td>Sweep ${sweep} (${ids.length} photos)</td>${r.details.map((d) => `<td>${pct(r.textSearch[d].perSweep.find((x) => x.sweep === sweep))}</td>`).join("")}</tr>`).join("");
  const sweepOf = new Map(photos.map((p) => [p.id, p.sweep]));
  const fileOf = new Map(photos.map((p) => [p.id, p.file]));
  const grids = r.details.map((d) => `<div><h3>detail ${d}</h3><div class="grid">${r.textSearch[d].top24
    .map((id) => `<img src="../data/search/${fileOf.get(id)}" class="${sweepOf.get(id) !== null ? "hit" : ""}" title="${id}">`).join("")}</div></div>`).join("");
  $("results").innerHTML = `
    <h2>More like selected</h2>
    <p>3 examples from each sweep; how many of the sweep's other photos are among the first results (as many results as there are photos to find).</p>
    <table>${head}${likeRows}</table>
    <h2>Text search: "${r.queryText}"</h2>
    <p>How much of each sweep is among the first results. Of the top 100, shared with detail 280: ${Object.entries(r.textTop100OverlapWith280).map(([d, n]) => `detail ${d}: ${n}`).join(", ")}.</p>
    <table>${head}${textRows}</table>
    <p>First 24 results (green border = in one of your sweeps):</p>
    <div class="columns">${grids}</div>`;
}

function slug(text) { return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "query"; }
function mapValues(o, f) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])); }

function mean(vectors) {
  const out = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i] / vectors.length;
  return out;
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
