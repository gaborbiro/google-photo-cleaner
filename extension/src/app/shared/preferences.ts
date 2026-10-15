// The user's choices, per Google account: for now, which kinds of photo are never trashed. Saved
// in the browser database; a change is announced to every open surface.

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
  protection: ProtectionChoices;
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

  /** The account's protection choices; everything protected until the user changes it. */
  async protection(account: string): Promise<ProtectionChoices> {
    const tx = (await this.database()).transaction(STORES.preferences, 'readonly');
    const saved = (await request(tx.objectStore(STORES.preferences).get(account) as IDBRequest<SavedPreferences | undefined>)) ?? null;
    return saved?.protection ?? ALL_PROTECTED;
  }

  async setProtection(account: string, protection: ProtectionChoices): Promise<void> {
    const tx = (await this.database()).transaction(STORES.preferences, 'readwrite');
    tx.objectStore(STORES.preferences).put({ account, protection } satisfies SavedPreferences);
    await committed(tx);
    this.changes ??= new BroadcastChannel(CHANGES_CHANNEL);
    this.changes.postMessage({ kind: 'preferences-changed', account });
  }
}
