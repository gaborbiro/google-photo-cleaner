// The app's browser database (IndexedDB). One database, one store per kind of record; every
// library record carries the scan run it belongs to, and every run its Google account.

import { DB_NAME, DB_VERSION } from './constants';

export const STORES = {
  usage: 'usage',
  jobs: 'jobs',
  runs: 'runs',
  cursors: 'cursors',
  items: 'items',
  favourites: 'favourites',
  archive: 'archive',
  albums: 'albums',
  albumMembers: 'albumMembers',
  /** A photo's fingerprint and quality, per account and model key: [account, modelKey, mediaKey]. */
  fingerprints: 'fingerprints',
  /** Upload time and original size, for choosing which duplicate to keep: [account, mediaKey]. */
  photoInfo: 'photoInfo',
  /** Per account: the detail its library is analysed at, chosen once by the speed check. */
  analysisSettings: 'analysisSettings',
  /** Review decisions (approve, keep, skip), per account; undone ones stay with their undo time. */
  decisions: 'decisions',
  /** One job per photo approved for the trash, with its state. */
  trashJobs: 'trashJobs',
  /** The user's choices per account (which kinds of photo are protected). */
  preferences: 'preferences',
  /** Per account: how many duplicate groups are waiting for review, as last worked out, for the popup. */
  reviewSummaries: 'reviewSummaries',
  /** What went wrong lately, for diagnosing it (see problemLog.ts): the newest 50, none older than 30 days. */
  problems: 'problems',
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

/**
 * What to tell the user when the saved data can't be opened: the blocked-upgrade explanation, or
 * plain words for anything else (whose details go to the log, not on screen).
 */
export function storageProblemText(error: unknown): string {
  if (error instanceof Error && error.message === UPGRADE_BLOCKED) return UPGRADE_BLOCKED;
  console.warn('Photo Cleaner: the saved data could not be opened', error);
  return "Photo Cleaner can't open its saved data right now. Close other Photo Cleaner tabs and reload your Google Photos tabs; if it keeps happening, restart Chrome.";
}

/**
 * Opens the database. [onClosed] hears when this connection is gone, so the next use opens a new
 * one: after a newer version of the extension took over, or after the data was erased.
 */
export function openDatabase(factory: IDBFactory = indexedDB, onClosed: () => void = () => {}): Promise<IDBDatabase> {
  const open = factory.open(DB_NAME, DB_VERSION);
  return new Promise((resolve, reject) => {
    open.onsuccess = () => {
      const db = open.result;
      // A newer version of the extension wants to upgrade, or the data is being erased: step aside
      // instead of blocking it.
      db.onversionchange = () => {
        db.close();
        onClosed();
      };
      db.onclose = onClosed;
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
    // Versions 4 to 6 kept a simulated trash, used before photos went to Google Photos' trash; it is gone.
    if (db.objectStoreNames.contains(OLD_SIMULATED_TRASH)) db.deleteObjectStore(OLD_SIMULATED_TRASH);
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
    // Versions 3 to 5 kept fingerprints by photo key alone; version 6 keys them by account too.
    if (create(STORES.fingerprints, { keyPath: ['account', 'modelKey', 'mediaKey'] }) && db.objectStoreNames.contains(OLD_FINGERPRINTS)) {
      moveFingerprints(open.transaction!);
    }
    create(STORES.photoInfo, { keyPath: ['account', 'mediaKey'] });
    create(STORES.analysisSettings, { keyPath: 'account' });
    create(STORES.decisions, { keyPath: 'id', autoIncrement: true })?.createIndex('account', 'account');
    const jobs = create(STORES.trashJobs, { keyPath: 'id', autoIncrement: true });
    jobs?.createIndex('account', 'account');
    jobs?.createIndex('decisionId', 'decisionId');
    create(STORES.preferences, { keyPath: 'account' });
    create(STORES.reviewSummaries, { keyPath: 'account' });
    create(STORES.problems, { keyPath: 'id', autoIncrement: true });
    create(STORES.usage, { keyPath: 'id' });
  };
}

/** Where versions 4 to 6 kept what the simulated trash held. */
const OLD_SIMULATED_TRASH = 'simulatedTrash';

/** Where versions 3 to 5 kept the fingerprints. */
const OLD_FINGERPRINTS = 'embeddings';

/**
 * Copies every fingerprint into the per-account store, then removes the old store. Both happen in the
 * upgrade's one transaction: if anything fails, the upgrade fails as a whole and nothing is lost.
 */
function moveFingerprints(tx: IDBTransaction): void {
  const target = tx.objectStore(STORES.fingerprints);
  const cursor = tx.objectStore(OLD_FINGERPRINTS).openCursor();
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (at) {
      target.put(at.value);
      at.continue();
    } else {
      tx.db.deleteObjectStore(OLD_FINGERPRINTS);
    }
  };
}

/** Every key that starts with [prefix] (array keys sort before any longer array, and `[]` after any string). */
export function prefixRange(...prefix: IDBValidKey[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, []]);
}
