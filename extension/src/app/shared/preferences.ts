// The user's choices, per Google account: which kinds of photo are never trashed, and whether
// trashing is real (Google Photos' trash) or simulated. Saved in the browser database; a change is
// announced to every open surface.

import { CHANGES_CHANNEL } from './constants';
import { committed, openDatabase, request, STORES } from './db';

/** Which kinds of photo are protected (never trashed). Photos of unknown status always are. */
export interface ProtectionChoices {
  favourites: boolean;
  albums: boolean;
  archived: boolean;
}

/** As the desktop app has always worked: everything protected. */
export const ALL_PROTECTED: ProtectionChoices = { favourites: true, albums: true, archived: true };

interface SavedPreferences {
  account: string;
  protection?: ProtectionChoices;
  /** Approved photos go to Google Photos' trash; otherwise trashing is simulated. Off until the user turns it on. */
  trashForReal?: boolean;
}

export class IndexedDbPreferences {
  private db: Promise<IDBDatabase> | null = null;
  private changes: BroadcastChannel | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private database(): Promise<IDBDatabase> {
    // Opened again on the next call after a failed open (an upgrade blocked by an older page) or
    // after the connection closed (a newer version took over, or the data was erased).
    this.db ??= openDatabase(this.factory, () => (this.db = null)).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  private async saved(account: string): Promise<SavedPreferences | null> {
    const tx = (await this.database()).transaction(STORES.preferences, 'readonly');
    return (await request(tx.objectStore(STORES.preferences).get(account) as IDBRequest<SavedPreferences | undefined>)) ?? null;
  }

  /** Changes some of the account's choices, keeping the others. */
  private async change(account: string, change: Omit<SavedPreferences, 'account'>): Promise<void> {
    const tx = (await this.database()).transaction(STORES.preferences, 'readwrite');
    const store = tx.objectStore(STORES.preferences);
    const saved = (await request(store.get(account) as IDBRequest<SavedPreferences | undefined>)) ?? { account };
    store.put({ ...saved, ...change, account } satisfies SavedPreferences);
    await committed(tx);
    this.changes ??= new BroadcastChannel(CHANGES_CHANNEL);
    this.changes.postMessage({ kind: 'preferences-changed', account });
  }

  /** The account's protection choices; everything protected until the user changes it. */
  async protection(account: string): Promise<ProtectionChoices> {
    return (await this.saved(account))?.protection ?? ALL_PROTECTED;
  }

  async setProtection(account: string, protection: ProtectionChoices): Promise<void> {
    await this.change(account, { protection });
  }

  /** Whether approved photos go to Google Photos' trash; false (simulated) until the user turns it on. */
  async trashForReal(account: string): Promise<boolean> {
    return (await this.saved(account))?.trashForReal === true;
  }

  async setTrashForReal(account: string, trashForReal: boolean): Promise<void> {
    await this.change(account, { trashForReal });
  }
}
