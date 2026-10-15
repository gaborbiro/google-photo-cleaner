// Where a scan's findings are saved: the browser twin of the desktop app's SqlInventoryRepository,
// with the same rules, so both count the same library the same way. Each page is saved together
// with its resume point in one transaction: a scan stopped at any moment resumes cleanly.

import { committed, openDatabase, prefixRange, request, STORES } from '../shared/db';
import type {
  AlbumRecord,
  AlbumStatus,
  EntryRef,
  InventoryItem,
  InventorySnapshot,
  PhaseCursor,
  RunStatus,
  ScanPhase,
  ScanRun,
} from './model';

export type PageEntries =
  | { phase: 'LIBRARY'; entries: InventoryItem[] }
  | { phase: 'FAVOURITES'; entries: EntryRef[] }
  | { phase: 'ARCHIVE'; entries: EntryRef[] }
  | { phase: 'ALBUM_LIST'; entries: AlbumRecord[] }
  | { phase: 'ALBUM_MEMBERS'; albumKey: string; entries: EntryRef[] };

type CursorRow = PhaseCursor & { runId: number };
type AlbumRow = AlbumRecord & { runId: number; failureReason: string | null };

export class IndexedDbInventoryStore {
  private db: Promise<IDBDatabase> | null = null;

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

  private async tx(stores: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    return (await this.database()).transaction(stores, mode);
  }

  // --- runs ---

  /** The newest run of [account], or null before its first scan. */
  async latestRun(account: string): Promise<ScanRun | null> {
    const tx = await this.tx([STORES.runs], 'readonly');
    const runs = await request(tx.objectStore(STORES.runs).index('account').getAll(account) as IDBRequest<ScanRun[]>);
    return runs.reduce<ScanRun | null>((latest, run) => (latest === null || run.id > latest.id ? run : latest), null);
  }

  async createRun(account: string, startedAtMs: number): Promise<ScanRun> {
    const tx = await this.tx([STORES.runs], 'readwrite');
    const draft = { accountFingerprint: account, startedAtMs, finishedAtMs: null, status: 'RUNNING' as RunStatus, statusReason: null };
    const id = Number(await request(tx.objectStore(STORES.runs).add(draft)));
    await committed(tx);
    return { id, ...draft };
  }

  async updateRunStatus(runId: number, status: RunStatus, statusReason: string | null, finishedAtMs: number | null): Promise<void> {
    const tx = await this.tx([STORES.runs], 'readwrite');
    const runs = tx.objectStore(STORES.runs);
    const run = await request(runs.get(runId) as IDBRequest<ScanRun | undefined>);
    if (!run) throw new Error(`Scan run ${runId} does not exist`);
    runs.put({ ...run, status, statusReason, finishedAtMs });
    await committed(tx);
  }

  // --- cursors and pages ---

  async cursor(runId: number, phase: ScanPhase, scope = ''): Promise<PhaseCursor | null> {
    const tx = await this.tx([STORES.cursors], 'readonly');
    return (await request(tx.objectStore(STORES.cursors).get([runId, phase, scope]) as IDBRequest<CursorRow | undefined>)) ?? null;
  }

  async cursors(runId: number): Promise<PhaseCursor[]> {
    const tx = await this.tx([STORES.cursors], 'readonly');
    return request(tx.objectStore(STORES.cursors).getAll(prefixRange(runId)) as IDBRequest<CursorRow[]>);
  }

  /**
   * Saves one page and moves its phase's resume point on, in one transaction. Entries seen
   * before in the same run count as duplicates and are not saved twice. A phase whose last
   * page was saved (no next page) is complete and takes no more pages.
   */
  async savePage(runId: number, page: PageEntries, nextPageToken: string | null): Promise<void> {
    const store = { LIBRARY: STORES.items, FAVOURITES: STORES.favourites, ARCHIVE: STORES.archive, ALBUM_LIST: STORES.albums, ALBUM_MEMBERS: STORES.albumMembers }[page.phase];
    const tx = await this.tx([store, STORES.cursors], 'readwrite');
    const records = tx.objectStore(store);
    let duplicates = 0;
    for (const entry of page.entries) {
      const row = page.phase === 'ALBUM_LIST'
        ? { runId, ...(entry as AlbumRecord), failureReason: null }
        : page.phase === 'ALBUM_MEMBERS'
          ? { runId, albumKey: page.albumKey, mediaKey: (entry as EntryRef).mediaKey, dedupKey: (entry as EntryRef).dedupKey }
          : { runId, ...entry };
      const key = records.keyPath === null ? undefined : (Array.isArray(records.keyPath) ? records.keyPath.map((k) => (row as Record<string, unknown>)[k]) : undefined);
      if (key && (await request(records.getKey(key as IDBValidKey))) !== undefined) {
        duplicates++;
      } else {
        records.put(row);
      }
    }
    const scope = page.phase === 'ALBUM_MEMBERS' ? page.albumKey : '';
    const cursors = tx.objectStore(STORES.cursors);
    const current = (await request(cursors.get([runId, page.phase, scope]) as IDBRequest<CursorRow | undefined>)) ?? null;
    if (current?.completed) {
      tx.abort();
      throw new Error(`${page.phase} is already complete for this run`);
    }
    cursors.put({
      runId,
      phase: page.phase,
      scope,
      nextPageToken,
      pagesDone: (current?.pagesDone ?? 0) + 1,
      entriesSeen: (current?.entriesSeen ?? 0) + page.entries.length,
      duplicateEntries: (current?.duplicateEntries ?? 0) + duplicates,
      completed: nextPageToken === null,
    } satisfies CursorRow);
    await committed(tx);
  }

  /** Forgets what a phase saved (and its resume point), so it is read again from the start. */
  async resetPhase(runId: number, phase: ScanPhase, scope = ''): Promise<void> {
    const tx = await this.tx(Object.values(STORES), 'readwrite');
    const clear = (store: string, ...prefix: IDBValidKey[]) => tx.objectStore(store).delete(prefixRange(runId, ...prefix));
    switch (phase) {
      case 'LIBRARY': clear(STORES.items); break;
      case 'FAVOURITES': clear(STORES.favourites); break;
      case 'ARCHIVE': clear(STORES.archive); break;
      case 'ALBUM_LIST':
        clear(STORES.albums);
        clear(STORES.albumMembers);
        clear(STORES.cursors, 'ALBUM_MEMBERS');
        break;
      case 'ALBUM_MEMBERS': {
        clear(STORES.albumMembers, scope);
        const albums = tx.objectStore(STORES.albums);
        const album = await request(albums.get([runId, scope]) as IDBRequest<AlbumRow | undefined>);
        // Its contents are cleared either way; an album no longer listed has no failure to forget.
        if (album) albums.put({ ...album, failureReason: null });
        break;
      }
    }
    tx.objectStore(STORES.cursors).delete([runId, phase, scope]);
    await committed(tx);
  }

  async markAlbumFailed(runId: number, albumKey: string, reason: string): Promise<void> {
    const tx = await this.tx([STORES.albums], 'readwrite');
    const albums = tx.objectStore(STORES.albums);
    const album = await request(albums.get([runId, albumKey]) as IDBRequest<AlbumRow | undefined>);
    // A failure that can't be recorded must not vanish: it is what keeps the scan from counting as complete.
    if (!album) throw new Error(`Album ${albumKey} is not in scan run ${runId}`);
    albums.put({ ...album, failureReason: reason });
    await committed(tx);
  }

  // --- reading ---

  /** Albums of a run, ordered by key, with how many entries were read and whether that finished. */
  async albums(runId: number): Promise<AlbumStatus[]> {
    const tx = await this.tx([STORES.albums, STORES.albumMembers, STORES.cursors], 'readonly');
    return this.albumsIn(tx, runId);
  }

  private async albumsIn(tx: IDBTransaction, runId: number): Promise<AlbumStatus[]> {
    const rows = await request(tx.objectStore(STORES.albums).getAll(prefixRange(runId)) as IDBRequest<AlbumRow[]>);
    const members = await request(tx.objectStore(STORES.albumMembers).getAllKeys(prefixRange(runId)));
    const seen = new Map<string, number>();
    for (const key of members) {
      const albumKey = (key as IDBValidKey[])[1] as string;
      seen.set(albumKey, (seen.get(albumKey) ?? 0) + 1);
    }
    const cursors = await request(tx.objectStore(STORES.cursors).getAll(prefixRange(runId, 'ALBUM_MEMBERS')) as IDBRequest<CursorRow[]>);
    const complete = new Set(cursors.filter((c) => c.completed).map((c) => c.scope));
    return rows.map(({ runId: _, failureReason, ...album }) => ({
      album,
      membersSeen: seen.get(album.albumKey) ?? 0,
      membersComplete: complete.has(album.albumKey),
      failureReason,
    }));
  }

  /** The oldest photo date read so far: how far back in time the library listing has got. */
  async oldestTakenAtMs(runId: number): Promise<number | null> {
    const tx = await this.tx([STORES.items], 'readonly');
    let oldest: number | null = null;
    const items = await request(tx.objectStore(STORES.items).getAll(prefixRange(runId)) as IDBRequest<InventoryItem[]>);
    for (const item of items) if (oldest === null || item.takenAtMs < oldest) oldest = item.takenAtMs;
    return oldest;
  }

  /** Everything recorded in one run, read in one transaction so it is consistent. */
  async snapshot(runId: number): Promise<InventorySnapshot> {
    const tx = await this.tx(Object.values(STORES), 'readonly');
    const all = <T>(store: string) => request(tx.objectStore(store).getAll(prefixRange(runId)) as IDBRequest<T[]>);
    const run = await request(tx.objectStore(STORES.runs).get(runId) as IDBRequest<ScanRun | undefined>);
    if (!run) throw new Error(`Scan run ${runId} does not exist`);
    const strip = <T extends { runId: number }>({ runId: _, ...rest }: T) => rest;
    const items = (await all<InventoryItem & { runId: number }>(STORES.items)).map(strip);
    const favourites = await all<EntryRef>(STORES.favourites);
    const archived = await all<EntryRef>(STORES.archive);
    const members = await all<EntryRef & { albumKey: string }>(STORES.albumMembers);
    const membership: Record<string, string[]> = {};
    for (const m of members) {
      const albums = (membership[m.dedupKey] ??= []);
      if (!albums.includes(m.albumKey)) albums.push(m.albumKey);
    }
    return {
      run,
      cursors: (await all<CursorRow>(STORES.cursors)).map(strip),
      items,
      favouriteDedupKeys: [...new Set(favourites.map((f) => f.dedupKey))],
      archivedDedupKeys: [...new Set(archived.map((a) => a.dedupKey))],
      albums: await this.albumsIn(tx, runId),
      albumMembership: membership,
    };
  }

  /** After a completed scan: drops the account's older runs and everything they recorded. */
  async deleteOtherRuns(account: string, keepRunId: number): Promise<void> {
    const tx = await this.tx(Object.values(STORES), 'readwrite');
    const runs = await request(tx.objectStore(STORES.runs).index('account').getAll(account) as IDBRequest<ScanRun[]>);
    for (const run of runs) {
      if (run.id === keepRunId) continue;
      for (const store of [STORES.cursors, STORES.items, STORES.favourites, STORES.archive, STORES.albums, STORES.albumMembers]) {
        tx.objectStore(store).delete(prefixRange(run.id));
      }
      tx.objectStore(STORES.runs).delete(run.id);
    }
    await committed(tx);
  }
}
