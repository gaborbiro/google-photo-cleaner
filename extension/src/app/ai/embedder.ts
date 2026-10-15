// The AI model in the background page: EmbeddingGemma 2 through Transformers.js on the graphics
// card (WebGPU). The model's files are downloaded once and kept by the browser; the runtime is
// packed into the extension (dist-app/ort), because extensions may not load code from the internet.

import { AutoConfig, AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers';
import type { Embedder } from './analysis';
import { MODEL_DOWNLOAD_BYTES, MODEL_DTYPE, MODEL_ID, MODEL_REVISION, type Detail } from './model';
import type { RgbaImage } from './quality';

env.allowLocalModels = false;
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = chrome.runtime.getURL('ort/');
// Multi-threaded WebAssembly needs cross-origin isolation; the graphics card does the work anyway.
wasm.numThreads = 1;

/** The model's search-query prompt ("SearchQuery"), as the desktop app uses it; photos get no prompt. */
const QUERY_PREFIX = 'task: search result | query: ';

/** Room needed for the model besides what the browser already holds. */
const SPACE_MARGIN = 1.3;

type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModel.from_pretrained>>;

export class TransformersEmbedder implements Embedder {
  private processor: Processor | null = null;
  private model: Model | null = null;

  async load(onProgress: (fraction: number) => void): Promise<void> {
    if (this.model) return;
    if (!('gpu' in navigator) || !(await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }))) {
      throw new Error('This browser cannot use the graphics card (WebGPU), which the AI analysis needs. Update the browser, or try Chrome or Edge.');
    }
    await checkSpace();
    const loaded = new Map<string, number>();
    const options = { revision: MODEL_REVISION };
    const config = await AutoConfig.from_pretrained(MODEL_ID, options);
    (config as unknown as { audio_config: unknown }).audio_config = null; // images only: skips the audio encoder
    this.processor = await AutoProcessor.from_pretrained(MODEL_ID, options);
    this.model = await AutoModel.from_pretrained(MODEL_ID, {
      ...options,
      config,
      device: 'webgpu',
      dtype: MODEL_DTYPE,
      progress_callback: (p: { status: string; file?: string; loaded?: number }) => {
        if (p.status !== 'progress' || !p.file || p.loaded === undefined) return;
        loaded.set(p.file, p.loaded);
        let total = 0;
        for (const bytes of loaded.values()) total += bytes;
        onProgress(Math.min(1, total / MODEL_DOWNLOAD_BYTES));
      },
    });
    onProgress(1);
  }

  async embed(image: RgbaImage, detail: Detail): Promise<Float32Array> {
    if (!this.processor || !this.model) throw new Error('The AI model is not loaded');
    (this.processor as unknown as { image_processor: { max_soft_tokens: number } }).image_processor.max_soft_tokens = detail;
    const raw = new RawImage(image.data, image.width, image.height, 4).rgb();
    const output = (await (this.model as unknown as (inputs: unknown) => Promise<{ sentence_embedding: { data: Float32Array } }>)(
      await (this.processor as unknown as (text: null, image: RawImage) => Promise<unknown>)(null, raw),
    )).sentence_embedding.data;
    return normalise(output);
  }

  /** An L2-normalised fingerprint of a description, comparable with the photos' fingerprints. */
  async embedText(text: string): Promise<Float32Array> {
    if (!this.processor || !this.model) throw new Error('The AI model is not loaded');
    const output = (await (this.model as unknown as (inputs: unknown) => Promise<{ sentence_embedding: { data: Float32Array } }>)(
      await (this.processor as unknown as (texts: string[]) => Promise<unknown>)([QUERY_PREFIX + text]),
    )).sentence_embedding.data;
    return normalise(output);
  }
}

/** Refuses to start a download that the disk can't hold, rather than failing half-way. */
async function checkSpace(): Promise<void> {
  const cached = await caches.has('transformers-cache');
  if (cached) return; // downloaded before (or partly): the browser already made room
  const { quota, usage } = await navigator.storage.estimate();
  if (quota !== undefined && usage !== undefined && quota - usage < MODEL_DOWNLOAD_BYTES * SPACE_MARGIN) {
    throw new Error(`Not enough free disk space for the AI model: about ${Math.ceil((MODEL_DOWNLOAD_BYTES * SPACE_MARGIN) / 1e6)} MB is needed. Free up some space, then resume.`);
  }
}

function normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) throw new Error('The AI model returned an empty fingerprint');
  return Float32Array.from(v, (x) => x / norm);
}

/** A preview's bytes as pixels, decoded by the browser. */
export async function decodePreview(preview: { contentType: string; bytes: Uint8Array }): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(new Blob([preview.bytes as BlobPart], { type: preview.contentType }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas to read the preview');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data: pixels.data, width: pixels.width, height: pixels.height };
  } finally {
    bitmap.close();
  }
}
