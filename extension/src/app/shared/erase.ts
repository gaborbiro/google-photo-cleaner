// Erasing everything Photo Cleaner saved on this computer, as uninstalling would, while the
// extension stays installed: the browser database (library scans, fingerprints, review progress,
// trash queue, choices) and the AI model's downloaded files. Photos in Google Photos are not touched.

import { DB_NAME } from './constants';
import { PlainError } from './errors';

/** How long to wait for other Photo Cleaner pages to let go of the database. */
const BLOCKED_TIMEOUT_MS = 15_000;

export async function eraseAllData(factory: IDBFactory = indexedDB, cacheStorage: CacheStorage = caches, blockedTimeoutMs = BLOCKED_TIMEOUT_MS): Promise<void> {
  await deleteDatabase(factory, blockedTimeoutMs);
  for (const name of await cacheStorage.keys()) await cacheStorage.delete(name);
}

/**
 * Open connections close by themselves when asked (see openDatabase); one that doesn't (a page of
 * an older version) holds the deletion back, and is reported instead of waited for forever.
 */
function deleteDatabase(factory: IDBFactory, blockedTimeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(DB_NAME);
    let timer: ReturnType<typeof setTimeout> | undefined;
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error('The saved data could not be erased'));
    };
    request.onblocked = () => {
      timer ??= setTimeout(
        () => reject(new PlainError('Another Photo Cleaner page is still holding the saved data. Reload your Google Photos tabs and close other Photo Cleaner tabs, then try again.')),
        blockedTimeoutMs,
      );
    };
  });
}
