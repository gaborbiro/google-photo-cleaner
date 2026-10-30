import { committed, openDatabase, request, STORES } from './db';
import type { UsageAnswer, UsageEvent } from './usage';

/** An event from before the question was answered, kept on this computer only (see [UsageSender]). */
export interface KeptUsage { event: UsageEvent; atMs: number }

export interface UsageState {
  id: 'settings';
  answer: UsageAnswer;
  epoch: string;
  answeredAt: number;
  clientId: string | null;
  setupState: 'new' | 'existing' | 'unknown';
  sessionId: number;
  lastEventAt: number;
  receipts: string[];
  /** Before an answer: the events so far, sent if the answer is yes and dropped if it is no. */
  kept: KeptUsage[];
}

export const NO_USAGE: UsageState = { id: 'settings', answer: 'unknown', epoch: '', answeredAt: 0, clientId: null, setupState: 'unknown', sessionId: 0, lastEventAt: 0, receipts: [], kept: [] };

/** A fresh copy of what is saved, with the fields that came later (kept) filled in for older records. */
function filled(saved: UsageState | undefined): UsageState {
  return { ...NO_USAGE, receipts: [], kept: [], ...saved };
}

/** Everything is in the app database, so erase removes consent, identity and receipts together. */
export class IndexedDbUsageStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: IDBFactory = indexedDB) {}
  private database(): Promise<IDBDatabase> {
    this.db ??= openDatabase(this.factory, () => { this.db = null; }).catch((error: unknown) => { this.db = null; throw error; });
    return this.db;
  }
  async get(): Promise<UsageState> {
    const tx = (await this.database()).transaction(STORES.usage, 'readonly');
    return filled(await request(tx.objectStore(STORES.usage).get('settings') as IDBRequest<UsageState | undefined>));
  }
  async change(update: (state: UsageState) => UsageState): Promise<UsageState> {
    const tx = (await this.database()).transaction(STORES.usage, 'readwrite');
    const store = tx.objectStore(STORES.usage);
    const previous = filled(await request(store.get('settings') as IDBRequest<UsageState | undefined>));
    const next = update(previous);
    store.put(next);
    await committed(tx);
    return next;
  }
}
