// The app's browser database (IndexedDB). One database, one store per kind of record; every
// library record carries the scan run it belongs to, and every run its Google account.

import { DB_NAME, DB_VERSION } from './constants';

export const STORES = {
  jobs: 'jobs',
  runs: 'runs',
  cursors: 'cursors',
  items: 'items',
  favourites: 'favourites',
  archive: 'archive',
  albums: 'albums',
  albumMembers: 'albumMembers',
  /** A photo's fingerprint and quality, per model key: [modelKey, mediaKey]. */
  embeddings: 'embeddings',
  /** Upload time and original size, for choosing which duplicate to keep: [account, mediaKey]. */
  photoInfo: 'photoInfo',
  /** Per account: the detail its library is analysed at, chosen once by the speed check. */
  analysisSettings: 'analysisSettings',
} as const;

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves when [tx] has been saved; a full disk shows up here as an abort. */
export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Saving failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Saving was aborted (is the disk full?)'));
  });
}

/** Shown when an older Photo Cleaner page keeps the database at its old version. */
export const UPGRADE_BLOCKED =
  'Photo Cleaner was updated and an older copy of it is still open, holding its saved data. Reload your Google Photos tabs and close other Photo Cleaner tabs; it then carries on by itself.';

export function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  const open = factory.open(DB_NAME, DB_VERSION);
  return new Promise((resolve, reject) => {
    open.onsuccess = () => {
      const db = open.result;
      // A newer version of the extension wants to upgrade: step aside instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => reject(open.error ?? new Error('The saved data could not be opened'));
    // An older page that doesn't step aside (one from before this fix) keeps the upgrade waiting:
    // say so instead of waiting silently. The upgrade still completes once that page is gone.
    open.onblocked = () => reject(new Error(UPGRADE_BLOCKED));
    upgrade(open);
  });
}

function upgrade(open: IDBOpenDBRequest): void {
  open.onupgradeneeded = (event) => {
    const db = open.result;
    // Version 1 (M1) only held pretend scans, in an older shape: drop them.
    if (event.oldVersion === 1 && db.objectStoreNames.contains(STORES.jobs)) open.transaction?.objectStore(STORES.jobs).clear();
    const create = (name: string, options: IDBObjectStoreParameters) => {
      if (!db.objectStoreNames.contains(name)) return db.createObjectStore(name, options);
      return null;
    };
    create(STORES.jobs, { keyPath: 'id' });
    create(STORES.runs, { keyPath: 'id', autoIncrement: true })?.createIndex('account', 'accountFingerprint');
    create(STORES.cursors, { keyPath: ['runId', 'phase', 'scope'] });
    create(STORES.items, { keyPath: ['runId', 'mediaKey'] });
    create(STORES.favourites, { keyPath: ['runId', 'mediaKey'] });
    create(STORES.archive, { keyPath: ['runId', 'mediaKey'] });
    create(STORES.albums, { keyPath: ['runId', 'albumKey'] });
    create(STORES.albumMembers, { keyPath: ['runId', 'albumKey', 'mediaKey'] });
    create(STORES.embeddings, { keyPath: ['modelKey', 'mediaKey'] })?.createIndex('account', 'account');
    create(STORES.photoInfo, { keyPath: ['account', 'mediaKey'] });
    create(STORES.analysisSettings, { keyPath: 'account' });
  };
}

/** Every key that starts with [prefix] (array keys sort before any longer array, and `[]` after any string). */
export function prefixRange(...prefix: IDBValidKey[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, []]);
}
