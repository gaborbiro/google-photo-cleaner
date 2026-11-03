// The "Stats for nerds" state: which photo was right-clicked, and the complete saved AI
// fingerprint shown on request. The screen only draws this view.

import { IndexedDbAnalysisStore, type StoredEmbedding } from '../ai/analysisStore';

export interface EmbeddingStatsDeps {
  load(mediaKey: string): Promise<StoredEmbedding | null>;
}

export interface EmbeddingStatsView {
  open: boolean;
  loading: boolean;
  problem: string | null;
  modelKey: string | null;
  dimensions: number | null;
  analysedAt: string | null;
  previewSize: string | null;
  sharpness: string | null;
  brightness: string | null;
  clippedDark: string | null;
  clippedBright: string | null;
  vectorText: string | null;
}

const CLOSED: EmbeddingStatsView = {
  open: false,
  loading: false,
  problem: null,
  modelKey: null,
  dimensions: null,
  analysedAt: null,
  previewSize: null,
  sharpness: null,
  brightness: null,
  clippedDark: null,
  clippedBright: null,
  vectorText: null,
};

function shown(embedding: StoredEmbedding): EmbeddingStatsView {
  const { quality, vector } = embedding;
  return {
    open: true,
    loading: false,
    problem: null,
    modelKey: embedding.modelKey,
    dimensions: vector.length,
    analysedAt: new Date(embedding.createdAtMs).toISOString(),
    previewSize: `${quality.width} × ${quality.height} px`,
    sharpness: String(quality.sharpness),
    brightness: String(quality.brightness),
    clippedDark: `${quality.clippedDark * 100}%`,
    clippedBright: `${quality.clippedBright * 100}%`,
    // Array.from preserves every stored Float32 value; JSON makes the whole vector easy to select.
    vectorText: JSON.stringify(Array.from(vector), null, 2),
  };
}

export class EmbeddingStats {
  private readonly listeners = new Set<() => void>();
  private target: string | null = null;
  private request = 0;
  private current: EmbeddingStatsView = CLOSED;

  constructor(private readonly deps: EmbeddingStatsDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): EmbeddingStatsView => this.current;

  /** The photo under the browser menu. Kept only in this open review page. */
  pointAt(mediaKey: string): void {
    this.target = mediaKey;
  }

  /** Before each browser menu, forget an older photo unless a photo handler names a new one. */
  clearTarget(): void {
    this.target = null;
  }

  /** The native menu item was chosen. */
  openTarget(): void {
    const mediaKey = this.target;
    if (mediaKey === null) return;
    const request = ++this.request;
    this.current = { ...CLOSED, open: true, loading: true };
    this.publish();
    void this.deps.load(mediaKey).then(
      (embedding) => {
        if (request !== this.request) return;
        this.current = embedding
          ? shown(embedding)
          : { ...CLOSED, open: true, problem: 'No embedding is stored for this photo.' };
        this.publish();
      },
      (error: unknown) => {
        if (request !== this.request) return;
        console.error("Photo Cleaner: couldn't read an embedding for Stats for nerds", error);
        this.current = { ...CLOSED, open: true, problem: "Photo Cleaner couldn't read this embedding. Try again." };
        this.publish();
      },
    );
  }

  close(): void {
    this.request++;
    this.current = CLOSED;
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

export function embeddingStatsDeps(account: string, store: IndexedDbAnalysisStore = new IndexedDbAnalysisStore()): EmbeddingStatsDeps {
  return {
    load: async (mediaKey) => {
      const settings = await store.settings(account);
      return settings ? store.embedding(settings.modelKey, account, mediaKey) : null;
    },
  };
}
