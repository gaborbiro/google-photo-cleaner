// "Which photos look most like this one?": the spot check for the analysis, and the core of
// Search's "More like selected" later. Fingerprints are L2-normalised, so the dot product is the
// cosine similarity.

export interface Fingerprint {
  mediaKey: string;
  vector: Float32Array;
}

export interface Match {
  mediaKey: string;
  /** Cosine similarity, 1 = the same spot in "meaning space". */
  similarity: number;
}

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`Fingerprints differ in length (${a.length} vs ${b.length})`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** The [count] most recently taken photos that have a fingerprint, newest first: starting points for the spot check. */
export function newestAnalysed<T extends { mediaKey: string; takenAtMs: number }>(items: T[], analysed: Set<string>, count: number): T[] {
  return items.filter((i) => analysed.has(i.mediaKey)).sort((a, b) => b.takenAtMs - a.takenAtMs).slice(0, count);
}

/** The [count] fingerprints most similar to [target]'s, strongest first, [target] itself left out. */
export function mostSimilar(target: Fingerprint, all: Fingerprint[], count: number): Match[] {
  return all
    .filter((f) => f.mediaKey !== target.mediaKey)
    .map((f) => ({ mediaKey: f.mediaKey, similarity: dot(target.vector, f.vector) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, count);
}
