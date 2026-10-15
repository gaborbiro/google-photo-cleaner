// Updating the extension upgrades its database; saved data must survive, and an older page that
// still holds the database open must not leave the new version waiting in silence.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { DB_NAME, DB_VERSION } from '../../src/app/shared/constants';
import { openDatabase, request, storageProblemText, STORES, UPGRADE_BLOCKED } from '../../src/app/shared/db';

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

/**
 * Every store as each version created it, with a record to keep and the indexes it had. [movedTo]: a
 * later version moved its records to that store (with [indexes] then the new store's).
 */
const STORES_BY_VERSION: { since: number; name: string; options: IDBObjectStoreParameters; indexes: string[]; record: Record<string, unknown>; movedTo?: string }[] = [
  { since: 2, name: STORES.jobs, options: { keyPath: 'id' }, indexes: [], record: { id: 'library-scan:acc1', status: 'finished' } },
  { since: 2, name: STORES.runs, options: { keyPath: 'id', autoIncrement: true }, indexes: ['account'], record: { id: 1, accountFingerprint: 'acc1' } },
  { since: 2, name: STORES.cursors, options: { keyPath: ['runId', 'phase', 'scope'] }, indexes: [], record: { runId: 1, phase: 'LIBRARY', scope: '', token: 't' } },
  { since: 2, name: STORES.items, options: { keyPath: ['runId', 'mediaKey'] }, indexes: [], record: { runId: 1, mediaKey: 'm1' } },
  { since: 2, name: STORES.favourites, options: { keyPath: ['runId', 'mediaKey'] }, indexes: [], record: { runId: 1, mediaKey: 'm1' } },
  { since: 2, name: STORES.archive, options: { keyPath: ['runId', 'mediaKey'] }, indexes: [], record: { runId: 1, mediaKey: 'm2' } },
  { since: 2, name: STORES.albums, options: { keyPath: ['runId', 'albumKey'] }, indexes: [], record: { runId: 1, albumKey: 'a1' } },
  { since: 2, name: STORES.albumMembers, options: { keyPath: ['runId', 'albumKey', 'mediaKey'] }, indexes: [], record: { runId: 1, albumKey: 'a1', mediaKey: 'm1' } },
  { since: 3, name: 'embeddings', options: { keyPath: ['modelKey', 'mediaKey'] }, indexes: ['account'], record: { modelKey: 'k', mediaKey: 'm1', account: 'acc1', vector: new Float32Array([1, 0]) }, movedTo: STORES.fingerprints },
  { since: 3, name: STORES.photoInfo, options: { keyPath: ['account', 'mediaKey'] }, indexes: [], record: { account: 'acc1', mediaKey: 'm1' } },
  { since: 3, name: STORES.analysisSettings, options: { keyPath: 'account' }, indexes: [], record: { account: 'acc1', detail: 140 } },
  { since: 4, name: STORES.decisions, options: { keyPath: 'id', autoIncrement: true }, indexes: ['account'], record: { id: 1, account: 'acc1', kind: 'APPROVED' } },
  { since: 4, name: STORES.trashJobs, options: { keyPath: 'id', autoIncrement: true }, indexes: ['account', 'decisionId'], record: { id: 1, account: 'acc1', decisionId: 1, state: 'QUEUED' } },
  { since: 4, name: STORES.simulatedTrash, options: { keyPath: ['account', 'dedupKey'] }, indexes: [], record: { account: 'acc1', dedupKey: 'd1' } },
  { since: 5, name: STORES.preferences, options: { keyPath: 'account' }, indexes: [], record: { account: 'acc1', protection: { favourites: false, albums: true, archived: true } } },
];

/** A database as [version] left it, with one record in every store, closed. */
async function savedDatabase(factory: IDBFactory, version: number): Promise<void> {
  const stores = STORES_BY_VERSION.filter((s) => s.since <= version);
  const open = factory.open(DB_NAME, version);
  open.onupgradeneeded = () => {
    for (const s of stores) {
      const store = open.result.createObjectStore(s.name, s.options);
      for (const index of s.indexes) store.createIndex(index, index === 'account' && s.name === STORES.runs ? 'accountFingerprint' : index);
    }
  };
  const db = await request(open);
  const tx = db.transaction(stores.map((s) => s.name), 'readwrite');
  for (const s of stores) tx.objectStore(s.name).put(s.record);
  await new Promise((resolve) => (tx.oncomplete = resolve));
  db.close();
}

describe('database upgrades', () => {
  for (const version of [2, 3, 4, 5]) {
    it(`from version ${version}: every saved record and index is kept, and the new stores are added`, async () => {
      const factory = new IDBFactory();
      await savedDatabase(factory, version);
      const db = await openDatabase(factory);
      expect(db.version).toBe(DB_VERSION);
      expect([...db.objectStoreNames].sort()).toEqual(Object.values(STORES).sort());
      for (const s of STORES_BY_VERSION.filter((s) => s.since <= version)) {
        const store = db.transaction(s.movedTo ?? s.name).objectStore(s.movedTo ?? s.name);
        expect(await request(store.getAll()), s.name).toEqual([s.record]);
        if (!s.movedTo) expect([...store.indexNames], s.name).toEqual(expect.arrayContaining(s.indexes));
      }
      db.close();
    });
  }

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
    expect([...db.objectStoreNames]).toContain(STORES.fingerprints);
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

  it('the storage problem is said in plain words; technical errors go to the log', () => {
    expect(storageProblemText(new Error(UPGRADE_BLOCKED))).toBe(UPGRADE_BLOCKED);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = storageProblemText(new DOMException('The requested version (5) is less than the existing version (6).', 'VersionError'));
    expect(text).toMatch(/^Photo Cleaner can't open its saved data right now/);
    expect(text).not.toContain('VersionError');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
