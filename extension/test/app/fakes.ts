// Test doubles for the library scan: an in-memory Google Photos with token paging (the twin of
// the desktop's FakePhotosConnector) and a fresh in-memory browser database per test.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbInventoryStore } from '../../src/app/scan/inventoryStore';
import type { AlbumRecord, EntryRef, InventoryItem } from '../../src/app/scan/model';
import { classify, type Classification } from '../../src/app/scan/report';
import { runScan, type ScanOutcome, type ScanPolicy, type ScanProgress } from '../../src/app/scan/session';
import { SourceError, type Page, type PhotosSource } from '../../src/app/scan/source';

/** Synthetic library item; keys are derived from [index] and never resemble real ones. */
export function fakeItem(index: number, opts: Partial<Pick<InventoryItem, 'isFavourite' | 'isArchived' | 'isOwned' | 'mediaType'>> = {}): InventoryItem {
  return {
    mediaKey: `lib-${index}`,
    dedupKey: `dedup-${index}`,
    takenAtMs: 10_000_000 - index * 1_000,
    mediaType: 'mediaType' in opts ? opts.mediaType! : 'PHOTO',
    isFavourite: 'isFavourite' in opts ? opts.isFavourite! : false,
    isArchived: 'isArchived' in opts ? opts.isArchived! : false,
    isOwned: 'isOwned' in opts ? opts.isOwned! : true,
    width: 100,
    height: 100,
    thumbUrl: `https://photos.fife.usercontent.google.com/pw/thumb-${index}`,
  };
}

export interface FakeAlbum {
  album: AlbumRecord;
  members: EntryRef[];
}

/** Album entries use album-scoped media keys but the item's dedup key, as Google does. */
export function fakeAlbum(key: string, memberIndexes: number[], opts: { reportedCount?: number | null; shared?: boolean } = {}): FakeAlbum {
  return {
    album: {
      albumKey: key,
      title: `Album ${key}`,
      ownerActorId: 'actor-me',
      isShared: opts.shared ?? null,
      kindCode: opts.shared ? 4 : 1,
      reportedItemCount: 'reportedCount' in opts ? opts.reportedCount! : memberIndexes.length,
      authKey: null,
    },
    members: memberIndexes.map((i) => ({ mediaKey: `${key}-entry-${i}`, dedupKey: `dedup-${i}` })),
  };
}

export class FakePhotos implements PhotosSource {
  accountFingerprint = 'account-a';
  favourites: InventoryItem[];
  archive: InventoryItem[];
  /** Operation names in call order: "session", "library", "favourites", "archive", "albums", "album:<key>". */
  readonly calls: string[] = [];
  /** An error to throw for the n-th (0-based) call overall, or null to answer normally. */
  failure: (op: string, callIndex: number) => SourceError | null = () => null;
  /** Albums whose contents always fail, like a shared album that is no longer accessible. */
  inaccessibleAlbums = new Set<string>();
  private generation = 1;

  constructor(
    public library: InventoryItem[],
    public albums: FakeAlbum[] = [],
    opts: { favourites?: InventoryItem[]; archive?: InventoryItem[] } = {},
  ) {
    this.favourites = opts.favourites ?? library.filter((i) => i.isFavourite === true);
    this.archive = opts.archive ?? library.filter((i) => i.isArchived === true);
  }

  /** Saved page tokens stop working, as Google's do after a while. */
  expireTokens(): void {
    this.generation++;
  }

  private before(op: string): void {
    const index = this.calls.length;
    this.calls.push(op);
    const failure = this.failure(op, index);
    if (failure) throw failure;
  }

  private offsetOf(token: string | null, prefix: string): number {
    if (token === null) return 0;
    const [p, generation, offset] = token.split(':');
    if (p !== prefix) throw new SourceError('RPC_ERROR', 'unknown token', null, 3);
    if (Number(generation) !== this.generation) throw new SourceError('RPC_ERROR', 'expired token', null, 3);
    return Number(offset);
  }

  private page<T>(prefix: string, all: T[], token: string | null, size: number): Page<T> {
    const start = this.offsetOf(token, prefix);
    const next = start + size < all.length ? `${prefix}:${this.generation}:${start + size}` : null;
    return { entries: all.slice(start, start + size), nextPageToken: next, accountFingerprint: this.accountFingerprint };
  }

  async status() {
    this.before('session');
    return { accountFingerprint: this.accountFingerprint };
  }

  async libraryPage(token: string | null) {
    this.before('library');
    return this.page('lib', this.library, token, 3);
  }

  async favouritesPage(token: string | null) {
    this.before('favourites');
    const page = this.page('fav', this.favourites, token, 2);
    return { ...page, entries: page.entries.map(({ mediaKey, dedupKey }) => ({ mediaKey, dedupKey })) };
  }

  async archivePage(token: string | null) {
    this.before('archive');
    const page = this.page('arc', this.archive, token, 2);
    return { ...page, entries: page.entries.map(({ mediaKey, dedupKey }) => ({ mediaKey, dedupKey })) };
  }

  async albumsPage(token: string | null) {
    this.before('albums');
    return this.page('albums', this.albums.map((a) => a.album), token, 2);
  }

  async albumItemsPage(albumKey: string, _authKey: string | null, token: string | null) {
    this.before(`album:${albumKey}`);
    if (this.inaccessibleAlbums.has(albumKey)) throw new SourceError('RPC_ERROR', 'album not accessible', null, 5);
    const album = this.albums.find((a) => a.album.albumKey === albumKey);
    if (!album) throw new SourceError('RPC_ERROR', 'album not found', null, 5);
    return this.page(`m-${albumKey}`, album.members, token, 2);
  }
}

export const TEST_POLICY: ScanPolicy = { pacingMs: 0, maxTransientRetries: 4, transientBaseDelayMs: 0, maxRateLimitRetries: 3, rateLimitBaseDelayMs: 0, maxRpcRetries: 2 };
export const NOW = 1_000_000_000;

export function newStore(): IndexedDbInventoryStore {
  return new IndexedDbInventoryStore(new IDBFactory());
}

export async function scan(
  source: FakePhotos,
  store: IndexedDbInventoryStore,
  opts: { shouldStop?: () => Promise<boolean>; account?: string } = {},
): Promise<{ outcome: ScanOutcome; progress: ScanProgress[] }> {
  const progress: ScanProgress[] = [];
  const outcome = await runScan({
    account: opts.account ?? 'account-a',
    source,
    store,
    policy: TEST_POLICY,
    now: () => NOW,
    sleep: async () => {},
    shouldStop: opts.shouldStop ?? (async () => false),
    onProgress: async (p) => void progress.push(p),
  });
  return { outcome, progress };
}

export async function classifyLatest(store: IndexedDbInventoryStore, nowMs = NOW, account = 'account-a'): Promise<Classification> {
  const run = await store.latestRun(account);
  if (!run) throw new Error('No scan run');
  return classify(await store.snapshot(run.id), nowMs);
}

export function eligibleIndexes(c: Classification): number[] {
  return c.items.filter((i) => i.eligibility === 'ELIGIBLE').map((i) => Number(i.mediaKey.replace('lib-', ''))).sort((a, b) => a - b);
}

export function eligibilityOf(c: Classification, index: number) {
  const item = c.items.find((i) => i.mediaKey === `lib-${index}`);
  if (!item) throw new Error(`No item ${index}`);
  return item;
}

/** 10 photos over 4 library pages; 1 and 2 are favourites; albums A = {2,3,4}, B = {4,5}. */
export function standardAccount(): FakePhotos {
  return new FakePhotos(
    Array.from({ length: 10 }, (_, i) => fakeItem(i, { isFavourite: i === 1 || i === 2 })),
    [fakeAlbum('A', [2, 3, 4]), fakeAlbum('B', [4, 5], { shared: true })],
  );
}
