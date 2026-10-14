// Where jobs are saved. Every change is one read-modify-write inside a single transaction,
// so a pause pressed in the panel and progress saved by the background page can never
// overwrite each other. Saved changes are announced to every open surface.

import { CHANGES_CHANNEL } from './constants';
import { committed, openDatabase, request, STORES } from './db';
import type { Job } from './job';

export interface JobStore {
  all(): Promise<Job[]>;
  get(id: string): Promise<Job | null>;
  /** Applies [change] to the saved job (or null) atomically; returns what was saved. */
  update(id: string, change: (current: Job | null) => Job | null): Promise<Job | null>;
}

export class IndexedDbJobStore implements JobStore {
  private db: Promise<IDBDatabase> | null = null;
  private changes: BroadcastChannel | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private database(): Promise<IDBDatabase> {
    // A failed open (e.g. an upgrade blocked by an older page) is retried on the next call.
    this.db ??= openDatabase(this.factory).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  async all(): Promise<Job[]> {
    const db = await this.database();
    return request(db.transaction(STORES.jobs, 'readonly').objectStore(STORES.jobs).getAll() as IDBRequest<Job[]>);
  }

  async get(id: string): Promise<Job | null> {
    const db = await this.database();
    return (await request(db.transaction(STORES.jobs, 'readonly').objectStore(STORES.jobs).get(id) as IDBRequest<Job | undefined>)) ?? null;
  }

  async update(id: string, change: (current: Job | null) => Job | null): Promise<Job | null> {
    const db = await this.database();
    const tx = db.transaction(STORES.jobs, 'readwrite');
    const jobs = tx.objectStore(STORES.jobs);
    const current = (await request(jobs.get(id) as IDBRequest<Job | undefined>)) ?? null;
    const next = change(current);
    if (next === null) jobs.delete(id);
    else jobs.put(next);
    await committed(tx);
    if (next !== current) {
      this.changes ??= new BroadcastChannel(CHANGES_CHANNEL);
      this.changes.postMessage({ kind: 'jobs-changed', id });
    }
    return next;
  }
}

/** Listens for saved changes made by any surface or the background page. Returns a stop function. */
export function onJobsChanged(listener: () => void): () => void {
  const channel = new BroadcastChannel(CHANGES_CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
}
