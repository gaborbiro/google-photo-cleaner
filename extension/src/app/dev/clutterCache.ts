// The developer clutter page's cache, so a reload or a change to settings alone needs no AI work: each
// description's fingerprint from the AI model, and the photos' scores against a whole list of
// descriptions, under a key that changes with the descriptions, the model and every photo's fingerprint
// (a photo added, removed or analysed again). Kept in a database of the page's own; only numbers.

import { MODEL_DTYPE, MODEL_ID, MODEL_REVISION } from '../ai/model';

export const CACHE_DB = 'dev-clutter-cache';
const TEXTS = 'texts';
const SCORES = 'scores';
const SAVED_AT = 'savedAt';
/** Lists of scores kept: the page's own and an edit's or a lab request's, the oldest dropped first. */
export const SCORES_KEPT = 3;
/** How the description fingerprints were made: they are only used with the same model. */
export const TEXT_MODEL = `${MODEL_ID}@${MODEL_REVISION}/${MODEL_DTYPE}`;

/** Every photo's raw score for every description, one row of [width] per photo in [photoKeys]' order, and how the descriptions overlap. */
export interface CachedScores {
  key: string;
  photoKeys: string[];
  width: number;
  raw: Float32Array;
  overlap: Float32Array;
  savedAtMs: number;
}

/** A hash of the descriptions in order, the model, and each photo's key and fingerprint in order: equal only when the scores would be. */
export function scoresKey(descriptions: readonly string[], photos: readonly { mediaKey: string; vector: Float32Array }[]): string {
  const h = new Hash();
  h.text(TEXT_MODEL);
  h.word(descriptions.length);
  for (const d of descriptions) h.text(d);
  h.word(photos.length);
  for (const p of photos) {
    h.text(p.mediaKey);
    const words = new Uint32Array(p.vector.buffer, p.vector.byteOffset, p.vector.length);
    h.word(words.length);
    for (let i = 0; i < words.length; i++) h.word(words[i]!);
  }
  return h.hex();
}

/** Two 32-bit streams (cyrb53's mixing), 64 bits in all: fast over millions of numbers, and a list change can't collide by chance in practice. */
class Hash {
  private a = 0xdeadbeef;
  private b = 0x41c6ce57;
  word(w: number) {
    this.a = Math.imul(this.a ^ w, 2654435761);
    this.b = Math.imul(this.b ^ w, 1597334677);
  }
  text(s: string) {
    this.word(s.length);
    for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
  }
  hex(): string {
    let a = Math.imul(this.a ^ (this.a >>> 16), 2246822507) ^ Math.imul(this.b ^ (this.b >>> 13), 3266489909);
    let b = Math.imul(this.b ^ (this.b >>> 16), 2246822507) ^ Math.imul(this.a ^ (this.a >>> 13), 3266489909);
    a >>>= 0;
    b >>>= 0;
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
}

/** The rows of [cached], one per photo, as views of its numbers. */
export function cachedRows(cached: CachedScores): Map<string, Float32Array> {
  if (cached.raw.length !== cached.photoKeys.length * cached.width) throw new Error(`Cached scores don’t fit their photos (${cached.raw.length} numbers, ${cached.photoKeys.length} photos of ${cached.width})`);
  return new Map(cached.photoKeys.map((k, i) => [k, cached.raw.subarray(i * cached.width, (i + 1) * cached.width)]));
}

/** [rows] (all of one width) packed for the cache under [key]. */
export function packScores(key: string, rows: Map<string, Float32Array>, overlap: Float32Array, savedAtMs: number): CachedScores {
  const photoKeys = [...rows.keys()];
  const width = rows.size === 0 ? 0 : rows.values().next().value!.length;
  const raw = new Float32Array(photoKeys.length * width);
  photoKeys.forEach((k, i) => {
    const row = rows.get(k)!;
    if (row.length !== width) throw new Error(`Photos were scored against different descriptions (${row.length} and ${width})`);
    raw.set(row, i * width);
  });
  return { key, photoKeys, width, raw, overlap, savedAtMs };
}

export class ClutterCache {
  constructor(private readonly factory: IDBFactory) {}

  /** The fingerprints kept for [texts], by text; those not kept are missing. */
  async texts(texts: readonly string[]): Promise<Map<string, Float32Array>> {
    const db = await this.open();
    try {
      const store = db.transaction(TEXTS, 'readonly').objectStore(TEXTS);
      const found = await Promise.all(texts.map((t) => request(store.get(textKey(t)) as IDBRequest<Float32Array | undefined>)));
      return new Map(texts.flatMap((t, i) => (found[i] ? [[t, found[i]!] as const] : [])));
    } finally {
      db.close();
    }
  }

  async keepTexts(vectors: Map<string, Float32Array>): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction(TEXTS, 'readwrite');
      for (const [t, v] of vectors) tx.objectStore(TEXTS).put(v, textKey(t));
      await done(tx);
    } finally {
      db.close();
    }
  }

  async scores(key: string): Promise<CachedScores | null> {
    const db = await this.open();
    try {
      return (await request(db.transaction(SCORES, 'readonly').objectStore(SCORES).get(key) as IDBRequest<CachedScores | undefined>)) ?? null;
    } finally {
      db.close();
    }
  }

  /** Keeps [scores], and drops the oldest beyond [SCORES_KEPT]. */
  async keepScores(scores: CachedScores): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction(SCORES, 'readwrite');
      const store = tx.objectStore(SCORES);
      store.put(scores);
      // Oldest first, by when they were kept (keys only, not the numbers).
      const byAge = store.index(SAVED_AT).getAllKeys();
      byAge.onsuccess = () => {
        for (const k of byAge.result.slice(0, Math.max(0, byAge.result.length - SCORES_KEPT))) store.delete(k);
      };
      await done(tx);
    } finally {
      db.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const open = this.factory.open(CACHE_DB, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(TEXTS);
        open.result.createObjectStore(SCORES, { keyPath: 'key' }).createIndex(SAVED_AT, 'savedAtMs');
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
  }
}

const textKey = (text: string) => `${TEXT_MODEL}\n${text}`;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The cache write was abandoned'));
  });
}
