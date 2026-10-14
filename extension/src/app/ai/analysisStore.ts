// Where the analysis is saved: each photo's fingerprint (embedding) and quality, its upload time
// and size, and the detail each account's library is analysed at. Only numbers: no images.

import { committed, openDatabase, prefixRange, request, STORES } from '../shared/db';
import type { Detail } from './model';
import type { Quality } from './quality';

export interface StoredEmbedding {
  modelKey: string;
  mediaKey: string;
  account: string;
  /** L2-normalised, so the dot product of two is their cosine similarity. */
  vector: Float32Array;
  quality: Quality;
  createdAtMs: number;
}

export interface PhotoInfo {
  account: string;
  mediaKey: string;
  uploadedAtMs: number | null;
  width: number | null;
  height: number | null;
}

/** Chosen once per account by the speed check; a library is never analysed at two details. */
export interface AnalysisSettings {
  account: string;
  detail: Detail;
  modelKey: string;
  /** What the speed check measured, at the preferred detail. */
  measuredPhotosPerSecond: number;
  chosenAtMs: number;
}

export class IndexedDbAnalysisStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private database(): Promise<IDBDatabase> {
    // A failed open (e.g. an upgrade blocked by an older page) is retried on the next call.
    this.db ??= openDatabase(this.factory).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  private async tx(stores: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    return (await this.database()).transaction(stores, mode);
  }

  async settings(account: string): Promise<AnalysisSettings | null> {
    const tx = await this.tx([STORES.analysisSettings], 'readonly');
    return (await request(tx.objectStore(STORES.analysisSettings).get(account) as IDBRequest<AnalysisSettings | undefined>)) ?? null;
  }

  async saveSettings(settings: AnalysisSettings): Promise<void> {
    const tx = await this.tx([STORES.analysisSettings], 'readwrite');
    tx.objectStore(STORES.analysisSettings).put(settings);
    await committed(tx);
  }

  /** Keys of the photos already analysed with [modelKey]. */
  async analysedKeys(modelKey: string): Promise<Set<string>> {
    const tx = await this.tx([STORES.embeddings], 'readonly');
    const keys = await request(tx.objectStore(STORES.embeddings).getAllKeys(prefixRange(modelKey)));
    return new Set(keys.map((k) => (k as IDBValidKey[])[1] as string));
  }

  async saveEmbedding(embedding: StoredEmbedding): Promise<void> {
    const tx = await this.tx([STORES.embeddings], 'readwrite');
    tx.objectStore(STORES.embeddings).put(embedding);
    await committed(tx);
  }

  /** Every fingerprint of [account] made with [modelKey]. */
  async embeddings(modelKey: string, account: string): Promise<StoredEmbedding[]> {
    const tx = await this.tx([STORES.embeddings], 'readonly');
    const all = await request(tx.objectStore(STORES.embeddings).getAll(prefixRange(modelKey)) as IDBRequest<StoredEmbedding[]>);
    return all.filter((e) => e.account === account);
  }

  async savePhotoInfo(info: PhotoInfo[]): Promise<void> {
    if (info.length === 0) return;
    const tx = await this.tx([STORES.photoInfo], 'readwrite');
    const store = tx.objectStore(STORES.photoInfo);
    for (const i of info) store.put(i);
    await committed(tx);
  }

  async photoInfo(account: string): Promise<PhotoInfo[]> {
    const tx = await this.tx([STORES.photoInfo], 'readonly');
    return request(tx.objectStore(STORES.photoInfo).getAll(prefixRange(account)) as IDBRequest<PhotoInfo[]>);
  }
}
