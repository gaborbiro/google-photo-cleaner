// Erasing Photo Cleaner's data: everything saved goes, the stores keep working afterwards, and a page
// that won't let go of the database is reported rather than waited for forever.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_NAME } from '../../src/app/shared/constants';
import { eraseAllData } from '../../src/app/shared/erase';
import { startScanJob } from '../../src/app/shared/job';
import { ALL_PROTECTED, IndexedDbPreferences } from '../../src/app/shared/preferences';
import { IndexedDbJobStore } from '../../src/app/shared/store';

/** The browser's cache of downloaded files (the AI model), in memory. */
class FakeCaches {
  names = new Set(['transformers-cache', 'other']);
  async keys() {
    return [...this.names];
  }
  async delete(name: string) {
    return this.names.delete(name);
  }
}

describe('erasing Photo Cleaner data', () => {
  it('erases the saved data and the AI model files; the stores in use start again empty', async () => {
    const factory = new IDBFactory();
    const jobs = new IndexedDbJobStore(factory);
    const preferences = new IndexedDbPreferences(factory);
    await jobs.update('library-scan:acc1', () => startScanJob('acc1', 1));
    await preferences.setProtection('acc1', { favourites: true, albums: false, archived: true });
    const files = new FakeCaches();

    await eraseAllData(factory, files as unknown as CacheStorage);

    expect(files.names.size).toBe(0);
    // The same store objects (as in a page that stays open) reconnect to a fresh, empty database.
    expect(await jobs.all()).toEqual([]);
    expect(await preferences.protection('acc1')).toEqual(ALL_PROTECTED);
  });

  it('a page of an older version holding the database is reported, not waited for forever', async () => {
    const factory = new IDBFactory();
    // An old page: opened the database and never steps aside.
    const open = factory.open(DB_NAME, 1);
    await new Promise((resolve) => (open.onsuccess = resolve));
    await expect(eraseAllData(factory, new FakeCaches() as unknown as CacheStorage, 50)).rejects.toThrow(/still holding the saved data/);
    open.result.close();
  });
});
