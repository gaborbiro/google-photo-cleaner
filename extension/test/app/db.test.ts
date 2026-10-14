// Updating the extension upgrades its database; saved data must survive, and an older page that
// still holds the database open must not leave the new version waiting in silence.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_NAME, DB_VERSION } from '../../src/app/shared/constants';
import { openDatabase, request, STORES, UPGRADE_BLOCKED } from '../../src/app/shared/db';

/** A database as M2 (version 2) left it, with one saved job, kept open like an old panel would. */
async function oldDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const open = factory.open(DB_NAME, 2);
  open.onupgradeneeded = () => open.result.createObjectStore(STORES.jobs, { keyPath: 'id' });
  const db = await request(open);
  const tx = db.transaction(STORES.jobs, 'readwrite');
  tx.objectStore(STORES.jobs).put({ id: 'library-scan:acc1', status: 'finished' });
  await new Promise((resolve) => (tx.oncomplete = resolve));
  return db;
}

describe('database upgrades', () => {
  it('an old page holding the database is reported, not waited for in silence', async () => {
    const factory = new IDBFactory();
    const old = await oldDatabase(factory);
    await expect(openDatabase(factory)).rejects.toThrow(UPGRADE_BLOCKED);
    old.close();
  });

  it('once the old page is gone the upgrade completes and saved jobs survive', async () => {
    const factory = new IDBFactory();
    (await oldDatabase(factory)).close();
    const db = await openDatabase(factory);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toContain(STORES.embeddings);
    const job = await request(db.transaction(STORES.jobs).objectStore(STORES.jobs).get('library-scan:acc1'));
    expect(job).toMatchObject({ status: 'finished' });
  });

  it('pages of this version step aside for a newer one', async () => {
    const factory = new IDBFactory();
    const current = await openDatabase(factory);
    const newer = factory.open(DB_NAME, DB_VERSION + 1);
    const db = await request(newer);
    expect(db.version).toBe(DB_VERSION + 1);
    expect(() => current.transaction(STORES.jobs)).toThrow(); // it closed itself
  });
});
