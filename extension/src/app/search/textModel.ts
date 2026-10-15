// The AI model for Search's descriptions, loaded into the review tab on the first text search: a
// separate file (search-ai.js), so the review tab stays light until then. The model's files are the
// ones the analysis downloaded; starting it on the graphics card takes about 10–20 seconds.

import { TransformersEmbedder } from '../ai/embedder';

const embedder = new TransformersEmbedder();

/** The description's fingerprint; the first call gets the model ready ([onProgress] 0–1 while it downloads). */
export async function embedQuery(text: string, onProgress: (fraction: number) => void): Promise<Float32Array> {
  await embedder.load(onProgress);
  return embedder.embedText(text);
}
