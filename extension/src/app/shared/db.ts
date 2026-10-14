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

export function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  const open = factory.open(DB_NAME, DB_VERSION);
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
  };
  return request(open);
}

/** Every key that starts with [prefix] (array keys sort before any longer array, and `[]` after any string). */
export function prefixRange(...prefix: IDBValidKey[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, []]);
}
