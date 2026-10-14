// Where jobs are saved. Every change is one read-modify-write inside a single transaction,
// so a pause pressed in the panel and a step taken by the background page can never
// overwrite each other. Saved changes are announced to every open surface.

import { CHANGES_CHANNEL, DB_NAME, DB_VERSION } from './constants';
import type { Job } from './job';

export interface JobStore {
  all(): Promise<Job[]>;
  get(id: string): Promise<Job | null>;
  /** Applies [change] to the saved job (or null) atomically; returns what was saved. */
  update(id: string, change: (current: Job | null) => Job | null): Promise<Job | null>;
}

const JOBS = 'jobs';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: 'id' });
  };
  return request(open);
}

export class IndexedDbJobStore implements JobStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly changes = new BroadcastChannel(CHANGES_CHANNEL);

  private database(): Promise<IDBDatabase> {
    this.db ??= openDatabase();
    return this.db;
  }

  async all(): Promise<Job[]> {
    const db = await this.database();
    return request(db.transaction(JOBS, 'readonly').objectStore(JOBS).getAll() as IDBRequest<Job[]>);
  }

  async get(id: string): Promise<Job | null> {
    const db = await this.database();
    return (await request(db.transaction(JOBS, 'readonly').objectStore(JOBS).get(id) as IDBRequest<Job | undefined>)) ?? null;
  }

  async update(id: string, change: (current: Job | null) => Job | null): Promise<Job | null> {
    const db = await this.database();
    const tx = db.transaction(JOBS, 'readwrite');
    const jobs = tx.objectStore(JOBS);
    const current = (await request(jobs.get(id) as IDBRequest<Job | undefined>)) ?? null;
    const next = change(current);
    if (next === null) jobs.delete(id);
    else jobs.put(next);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Saving failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving was aborted (is the disk full?)'));
    });
    if (next !== current) this.changes.postMessage({ kind: 'jobs-changed', id });
    return next;
  }
}

/** Listens for saved changes made by any surface or the background page. Returns a stop function. */
export function onJobsChanged(listener: () => void): () => void {
  const channel = new BroadcastChannel(CHANGES_CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
}
