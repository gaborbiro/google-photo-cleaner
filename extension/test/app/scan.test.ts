// The browser library scan, scenario by scenario: the same cases as the desktop app's
// ScanInventoryUseCaseTest, against the real IndexedDB store (in memory) and the shared
// Kotlin protection rules.

import { ALL_PROTECTED } from '../../src/app/shared/preferences';
import { describe, expect, it } from 'vitest';
import { SourceError } from '../../src/app/scan/source';
import { INCOMPATIBLE_TEXT, refusedText } from '../../src/app/shared/googleProblems';
import {
  classifyLatest,
  eligibilityOf,
  eligibleIndexes,
  fakeAlbum,
  fakeItem,
  FakePhotos,
  newStore,
  NOW,
  scan,
  standardAccount,
} from './fakes';

const photos = (c: Awaited<ReturnType<typeof classifyLatest>>) => c.report.counts.find((t) => t.mediaType === 'PHOTO')!;

describe('library scan', () => {
  it('enumerates every page and classifies by favourites and albums', async () => {
    const store = newStore();
    const { outcome, progress } = await scan(standardAccount(), store);
    expect(outcome).toEqual({ kind: 'completed' });
    const last = progress.at(-1)!;
    expect(last).toMatchObject({ libraryEntries: 10, albumsListed: 2, albumsRead: 2, albumsFailed: 0, phase: null });
    const result = await classifyLatest(store);
    expect(result.report.coverage.isComplete).toBe(true);
    expect(eligibleIndexes(result)).toEqual([0, 6, 7, 8, 9]);
    // Item 4 is in two albums and item 2 is a favourite in an album; each counts once.
    expect(photos(result)).toMatchObject({ total: 10, protectedTotal: 5, protectedByFavouriteAndAlbum: 1, eligible: 5, unknown: 0 });
  });

  it('album entries protect through the dedup key, not the album-scoped media key', async () => {
    const store = newStore();
    await scan(standardAccount(), store);
    expect(eligibilityOf(await classifyLatest(store), 3)).toMatchObject({ eligibility: 'PROTECTED', protectionReasons: ['IN_ALBUM'] });
  });

  it('missing or negative proof makes items unknown, never eligible', async () => {
    const store = newStore();
    const source = new FakePhotos(
      [
        fakeItem(0),
        fakeItem(1, { isFavourite: null }),
        fakeItem(2, { isArchived: null }),
        fakeItem(3, { isOwned: false }),
        fakeItem(4, { isOwned: null }),
        fakeItem(5, { mediaType: null }),
        fakeItem(6, { isFavourite: null }),
        fakeItem(7, { isArchived: true }),
      ],
      [],
      { favourites: [fakeItem(6, { isFavourite: null })] },
    );
    await scan(source, store);
    const result = await classifyLatest(store);
    expect(eligibleIndexes(result)).toEqual([0]);
    expect(eligibilityOf(result, 1).unknownReasons).toEqual(['FAVOURITE_FLAG_MISSING']);
    expect(eligibilityOf(result, 2).unknownReasons).toEqual(['ARCHIVE_FLAG_MISSING']);
    expect(eligibilityOf(result, 3).unknownReasons).toEqual(['NOT_OWNED']);
    expect(eligibilityOf(result, 4).unknownReasons).toEqual(['NOT_OWNED']);
    expect(eligibilityOf(result, 5).unknownReasons).toEqual(['MEDIA_TYPE_UNKNOWN']);
    expect(eligibilityOf(result, 6).eligibility).toBe('PROTECTED'); // the favourites listing protects without the flag
    expect(eligibilityOf(result, 7).eligibility).toBe('PROTECTED'); // archived photos are protected
  });

  it('the archive listing protects items whose archived flag is false', async () => {
    const store = newStore();
    const library = Array.from({ length: 10 }, (_, i) => fakeItem(i, { isFavourite: i === 1 || i === 2 }));
    const source = new FakePhotos(library, [fakeAlbum('A', [2, 3, 4]), fakeAlbum('B', [4, 5])], { archive: [library[7]!, library[8]!] });
    await scan(source, store);
    const result = await classifyLatest(store);
    expect(eligibleIndexes(result)).toEqual([0, 6, 9]);
    expect(eligibilityOf(result, 7).protectionReasons).toEqual(['ARCHIVED']);
    expect(result.report.coverage.archive).toMatchObject({ listed: 2, flagged: 0, listedButNotFlagged: 2 });
    expect(photos(result).protectedByArchive).toBe(2);
  });

  it('progress reports how far back in time the library has been read', async () => {
    const source = standardAccount();
    const { progress } = await scan(source, newStore());
    const libraryPages = progress.filter((p) => p.phase === 'LIBRARY' && p.libraryEntries > 0);
    expect(libraryPages[0]!.libraryReachedMs).toBe(source.library[2]!.takenAtMs);
    expect(libraryPages.at(-1)!.libraryReachedMs).toBe(source.library.at(-1)!.takenAtMs);
  });

  it('an inaccessible shared album makes every unprotected item unknown', async () => {
    const store = newStore();
    const source = standardAccount();
    source.inaccessibleAlbums.add('B');
    const { outcome, progress } = await scan(source, store);
    expect(outcome.kind).toBe('completed');
    expect(progress.at(-1)!.albumsFailed).toBe(1);
    const result = await classifyLatest(store);
    expect(result.report.coverage.isComplete).toBe(false);
    expect(result.report.coverage.albumIssues.map((i) => i.kind)).toEqual(['FAILED']);
    expect(eligibleIndexes(result)).toEqual([]);
    expect(eligibilityOf(result, 1).eligibility).toBe('PROTECTED'); // positive evidence still protects
    expect(eligibilityOf(result, 5).eligibility).toBe('UNKNOWN'); // only in the unreadable album
    expect(eligibilityOf(result, 0).unknownReasons).toContain('INVENTORY_INCOMPLETE');
  });

  it('a permission-denied album with a healthy session is recorded as failed', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op) => (op === 'album:B' ? new SourceError('SESSION', 'denied', 403) : null);
    const { outcome, progress } = await scan(source, store);
    expect(outcome.kind).toBe('completed');
    expect(progress.at(-1)!.albumsFailed).toBe(1);
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([]);
  });

  it("an album whose entry count differs from Google's count blocks eligibility", async () => {
    const store = newStore();
    const source = new FakePhotos(Array.from({ length: 10 }, (_, i) => fakeItem(i)), [fakeAlbum('A', [2, 3], { reportedCount: 5 })]);
    await scan(source, store);
    const result = await classifyLatest(store);
    expect(result.report.coverage.albumIssues.map((i) => i.kind)).toEqual(['COUNT_MISMATCH']);
    expect(eligibleIndexes(result)).toEqual([]);
  });

  it('transient failures are retried and the result is unchanged', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (_, call) => ([2, 3, 7].includes(call) ? new SourceError('TRANSIENT', 'network') : null);
    expect((await scan(source, store)).outcome.kind).toBe('completed');
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([0, 6, 7, 8, 9]);
  });

  it('persistent rate limiting pauses, and resuming completes without duplicates', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op, call) => (op === 'favourites' && call < 12 ? new SourceError('RATE_LIMIT', '429', 429) : null);
    const paused = await scan(source, store);
    expect(paused.outcome).toEqual({ kind: 'paused', reason: 'Google is limiting requests. Resume the scan later.', untilPhotosOpen: false });
    expect((await store.latestRun('account-a'))!.status).toBe('PAUSED');
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([]); // a paused scan proves nothing

    source.failure = () => null;
    const resumed = await scan(source, store);
    expect(resumed.outcome.kind).toBe('completed');
    expect(resumed.progress.at(-1)!.libraryEntries).toBe(10);
    const run = (await store.latestRun('account-a'))!;
    expect((await store.cursor(run.id, 'LIBRARY'))!.duplicateEntries).toBe(0);
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([0, 6, 7, 8, 9]);
  });

  it('a closed Photos tab pauses until Google Photos is open again', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op, call) => (op === 'library' && call === 3 ? new SourceError('NO_PHOTOS_TAB', 'no tab') : null);
    const paused = await scan(source, store);
    expect(paused.outcome).toEqual({
      kind: 'paused', reason: 'Google Photos was closed. Open photos.google.com, signed in to this account; the scan continues by itself.', untilPhotosOpen: true,
    });
  });

  it('after a lost session a new scan resumes from the saved page', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op, call) => (op === 'library' && call === 3 ? new SourceError('SESSION', 'signed out', 401) : null);
    const paused = await scan(source, store);
    // It waits for Google Photos: signed in again, the scan carries on by itself.
    expect(paused.outcome).toEqual({ kind: 'paused', reason: 'Google Photos is signed out. Sign in again at photos.google.com; the scan continues by itself.', untilPhotosOpen: true });
    expect(paused.progress.at(-1)!.libraryEntries).toBe(6);

    source.failure = () => null;
    source.calls.length = 0;
    const resumed = await scan(source, store);
    expect(resumed.outcome.kind).toBe('completed');
    expect(source.calls.filter((c) => c === 'library')).toHaveLength(2); // only the two remaining pages
    expect(resumed.progress.at(-1)!.libraryEntries).toBe(10);
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([0, 6, 7, 8, 9]);
  });

  it("the user's pause stops the run, and it resumes later", async () => {
    const store = newStore();
    const source = standardAccount();
    let progressSeen = 0;
    const stopped = await scan(source, store, { shouldStop: async () => ++progressSeen > 4 });
    expect(stopped.outcome).toEqual({ kind: 'stopped' });
    expect((await store.latestRun('account-a'))!.status).toBe('PAUSED');
    expect((await scan(source, store)).outcome.kind).toBe('completed');
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([0, 6, 7, 8, 9]);
  });

  it('an expired saved page token restarts that phase from the beginning', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op, call) => (op === 'library' && call === 3 ? new SourceError('SESSION', 'signed out', 401) : null);
    await scan(source, store);
    source.failure = () => null;
    source.expireTokens();
    const resumed = await scan(source, store);
    expect(resumed.outcome.kind).toBe('completed');
    expect(resumed.progress.at(-1)!.libraryEntries).toBe(10);
    const run = (await store.latestRun('account-a'))!;
    expect((await store.cursor(run.id, 'LIBRARY'))!.duplicateEntries).toBe(0);
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([0, 6, 7, 8, 9]);
  });

  it('switching Google account mid-scan pauses and refuses to mix accounts', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op, call) => {
      if (op === 'library' && call === 3) source.accountFingerprint = 'account-b';
      return null;
    };
    const paused = await scan(source, store);
    expect(paused.outcome.kind).toBe('paused');
    expect(paused.progress.at(-1)!.libraryEntries).toBe(6); // the other account's page is not saved

    source.failure = () => null;
    const refused = await scan(source, store);
    expect(refused.outcome.kind).toBe('not-started');
    expect((refused.outcome as { reason: string }).reason).toContain('different account');

    source.accountFingerprint = 'account-a';
    expect((await scan(source, store)).outcome.kind).toBe('completed');
  });

  it('keeps each account separate: one account never sees the other one\'s scan', async () => {
    const store = newStore();
    await scan(standardAccount(), store);
    const other = standardAccount();
    other.accountFingerprint = 'account-b';
    other.library = other.library.slice(0, 4);
    await scan(other, store, { account: 'account-b' });
    expect(photos(await classifyLatest(store, NOW, 'account-a')).total).toBe(10);
    expect(photos(await classifyLatest(store, NOW, 'account-b')).total).toBe(4);
  });

  it('an unreadable response fails the scan and nothing becomes eligible', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op) => (op === 'albums' ? new SourceError('PROTOCOL', 'shape changed') : null);
    const { outcome } = await scan(source, store);
    expect(outcome).toEqual({ kind: 'failed', reason: INCOMPATIBLE_TEXT });
    expect((await store.latestRun('account-a'))!.status).toBe('FAILED');
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([]);
  });

  it('an error code Google keeps returning pauses the scan, saying nothing was changed', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op) => (op === 'library' ? new SourceError('RPC_ERROR', 'RPC lcxiM returned error code 3', null, 3) : null);
    const { outcome } = await scan(source, store);
    expect(outcome).toEqual({ kind: 'paused', reason: refusedText('library', 3), untilPhotosOpen: false });
    expect(refusedText('library', 3)).toBe('Google Photos keeps refusing to send your library (code 3). Nothing in your library was changed. Try again later; if it keeps happening, check for a Photo Cleaner update.');
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([]);
  });

  it('an old inventory no longer proves anything is unprotected', async () => {
    const store = newStore();
    await scan(standardAccount(), store);
    const dayLater = await classifyLatest(store, NOW + 25 * 60 * 60 * 1000);
    expect(dayLater.report.coverage.isStale).toBe(true);
    expect(eligibleIndexes(dayLater)).toEqual([]);
    expect(eligibilityOf(dayLater, 0).unknownReasons).toContain('INVENTORY_STALE');
  });

  it('a completed scan replaces the previous one; until it completes nothing is eligible', async () => {
    const store = newStore();
    const source = standardAccount();
    await scan(source, store);
    const first = (await store.latestRun('account-a'))!.id;
    source.failure = (op) => (op === 'favourites' ? new SourceError('SESSION', 'signed out', 401) : null);
    // A finished scan starts a new run; it pauses part-way.
    await scan(source, store);
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([]);
    source.failure = () => null;
    await scan(source, store);
    const latest = (await store.latestRun('account-a'))!;
    expect(latest.id).not.toBe(first);
    expect(latest.status).toBe('COMPLETED');
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([0, 6, 7, 8, 9]);
  });

  it('videos are classified but reported separately', async () => {
    const store = newStore();
    const source = new FakePhotos([fakeItem(0), fakeItem(1, { mediaType: 'VIDEO' }), fakeItem(2)]);
    await scan(source, store);
    const result = await classifyLatest(store);
    expect(result.report.counts.find((t) => t.mediaType === 'PHOTO')!.total).toBe(2);
    expect(result.report.counts.find((t) => t.mediaType === 'VIDEO')!.total).toBe(1);
  });
});

describe('the shared protection rules from JavaScript', () => {
  it('refuses a snapshot with a missing field instead of guessing', async () => {
    const { classify } = await import('../../src/app/scan/report');
    expect(() => classify({ run: { id: 1 } } as never, NOW, ALL_PROTECTED)).toThrow();
  });
});
