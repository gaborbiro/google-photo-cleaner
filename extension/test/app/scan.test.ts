// The browser library scan, scenario by scenario: the same cases as the desktop app's
// ScanInventoryUseCaseTest, against the real IndexedDB store (in memory) and the shared
// Kotlin protection rules.

import { ALL_PROTECTED } from '../../src/app/shared/preferences';
import { describe, expect, it, vi } from 'vitest';
import { latestReport, reportKey, reportView } from '../../src/app/scan/report';
import { endJob, startScanJob } from '../../src/app/shared/job';
import { OpPhotosSource, SourceError } from '../../src/app/scan/source';
import { INCOMPATIBLE_TEXT, refusedText } from '../../src/app/shared/googleProblems';
import { ScanStats } from '../../src/app/shared/runStats';
import { runScan } from '../../src/app/scan/session';
import {
  classifyLatest,
  eligibilityOf,
  eligibleIndexes,
  fakeAlbum,
  fakeDedupKey,
  fakeItem,
  FakePhotos,
  newStore,
  NOW,
  scan,
  standardAccount,
  TEST_POLICY,
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

  it('missing proof makes items unknown, never eligible', async () => {
    const store = newStore();
    const source = new FakePhotos(
      [
        fakeItem(0),
        fakeItem(1, { isFavourite: null }),
        fakeItem(2, { isArchived: null }),
        fakeItem(3, { mediaType: null }),
        fakeItem(4, { isFavourite: null }),
        fakeItem(5, { isArchived: true }),
      ],
      [],
      { favourites: [fakeItem(4, { isFavourite: null })] },
    );
    await scan(source, store);
    const result = await classifyLatest(store);
    expect(eligibleIndexes(result)).toEqual([0]);
    expect(eligibilityOf(result, 1).unknownReasons).toEqual(['FAVOURITE_FLAG_MISSING']);
    expect(eligibilityOf(result, 2).unknownReasons).toEqual(['ARCHIVE_FLAG_MISSING']);
    expect(eligibilityOf(result, 3).unknownReasons).toEqual(['MEDIA_TYPE_UNKNOWN']);
    expect(eligibilityOf(result, 4).eligibility).toBe('PROTECTED'); // the favourites listing protects without the flag
    expect(eligibilityOf(result, 5).eligibility).toBe('PROTECTED'); // archived photos are protected
  });

  it('an item whose dedup key has an unusual form is read but never eligible; an album still protects it', async () => {
    const store = newStore();
    const source = new FakePhotos(
      [fakeItem(0), { ...fakeItem(1), dedupKey: 'abcdefgh:ijklmnopq' }, { ...fakeItem(2), dedupKey: 'abcdefgh+ijklmnop2' }],
      [{ ...fakeAlbum('A', [], { reportedCount: 1 }), members: [{ mediaKey: 'A-entry-2', dedupKey: 'abcdefgh+ijklmnop2' }] }],
    );
    expect((await scan(source, store)).outcome).toEqual({ kind: 'completed' });
    const result = await classifyLatest(store);
    expect(result.report.coverage.isComplete).toBe(true);
    expect(eligibleIndexes(result)).toEqual([0]);
    expect(eligibilityOf(result, 1)).toMatchObject({ eligibility: 'UNKNOWN', unknownReasons: ['DEDUP_KEY_UNUSUAL'] });
    expect(eligibilityOf(result, 2)).toMatchObject({ eligibility: 'PROTECTED', protectionReasons: ['IN_ALBUM'] });
    const view = reportView(result);
    expect(view.warningText).toBeNull();
    expect(view.diagnosticLines).toContain('Photos: 1 unknown for unusual Google ID');
  });

  it('an album entry with an unusual dedup key that no library item has blocks trashing, saying so', async () => {
    const store = newStore();
    const source = new FakePhotos(
      [fakeItem(0)],
      [{ ...fakeAlbum('A', [], { reportedCount: 1 }), members: [{ mediaKey: 'A-entry-9', dedupKey: 'abcdefgh:ijklmnopq' }] }],
    );
    await scan(source, store);
    const result = await classifyLatest(store);
    expect(eligibleIndexes(result)).toEqual([]);
    const view = reportView(result);
    expect(view.warningText).toBe("No photo can be trashed: 1 album has a photo Photo Cleaner can't match to your library");
    expect(view.diagnosticLines.slice(0, 2)).toEqual([
      "Blocking trashing: 1 album has a photo Photo Cleaner can't match to your library",
      'Album issue 1 (blocks): unusual Google ID · shared unknown · kind 1 · Google reports 1, 1 read · not read a second time',
    ]);
  });

  it('photos saved from someone else are judged like the user’s own: protected in an album, else eligible', async () => {
    const store = newStore();
    const source = new FakePhotos(
      [fakeItem(0, { isOwned: false }), fakeItem(1, { isOwned: null }), fakeItem(2, { isOwned: false })],
      [fakeAlbum('Shared trip', [2])],
    );
    await scan(source, store);
    const result = await classifyLatest(store);
    expect(eligibleIndexes(result)).toEqual([0, 1]);
    expect(eligibilityOf(result, 2)).toMatchObject({ eligibility: 'PROTECTED', protectionReasons: ['IN_ALBUM'] });
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

  describe("an album whose entries don't add up to Google's count", () => {
    const shortAlbum = () => new FakePhotos(Array.from({ length: 10 }, (_, i) => fakeItem(i)), [fakeAlbum('A', [2, 3], { reportedCount: 5 })]);
    const albumReads = (source: FakePhotos) => source.calls.filter((c) => c === 'album:A').length;

    it('is read a second time; the same entries both times is a note, not a block', async () => {
      const store = newStore();
      const source = shortAlbum();
      expect((await scan(source, store)).outcome.kind).toBe('completed');
      expect(albumReads(source)).toBe(2);
      const result = await classifyLatest(store);
      expect(result.report.coverage.isComplete).toBe(true);
      expect(result.report.coverage.albumIssues).toEqual([]);
      expect(result.report.coverage.albumWarnings.map((i) => i.kind)).toEqual(['COUNT_MISMATCH_READ_TWICE']);
      expect(eligibleIndexes(result)).toEqual([0, 1, 4, 5, 6, 7, 8, 9]);
      expect(eligibilityOf(result, 2).eligibility).toBe('PROTECTED'); // what the album lists stays protected
      const view = reportView(result);
      expect(view.warningText).toBeNull();
      expect(view.issueLines).toEqual([]);
      expect(view.noteLines).toEqual(['Album “Album A” count mismatch, not blocking: Google reports 5 entries; 2 read, the same ones on a second read']);
    });

    it('blocks every unprotected photo when the second read finds different entries', async () => {
      const store = newStore();
      const source = shortAlbum();
      let reads = 0;
      source.failure = (op) => {
        if (op === 'album:A' && ++reads === 2) source.albums[0]!.members.push({ mediaKey: 'A-entry-4', dedupKey: fakeDedupKey(4) });
        return null;
      };
      expect((await scan(source, store)).outcome.kind).toBe('completed');
      const result = await classifyLatest(store);
      expect(result.report.coverage.isComplete).toBe(false);
      expect(result.report.coverage.albumIssues.map((i) => [i.kind, i.detail])).toEqual([
        ['COUNT_MISMATCH', 'Google reports 5 entries; 2 read, and a second read found different ones'],
      ]);
      expect(eligibleIndexes(result)).toEqual([]);
      expect(eligibilityOf(result, 4).unknownReasons).toContain('INVENTORY_INCOMPLETE');
    });

    it('blocks every unprotected photo when the same keys come back for different photos', async () => {
      const store = newStore();
      const source = shortAlbum();
      let reads = 0;
      source.failure = (op) => {
        if (op === 'album:A' && ++reads === 2) source.albums[0]!.members[1] = { mediaKey: 'A-entry-3', dedupKey: fakeDedupKey(9) };
        return null;
      };
      await scan(source, store);
      expect(eligibleIndexes(await classifyLatest(store))).toEqual([]);
    });

    it('blocks every unprotected photo when Google refuses the second read', async () => {
      const store = newStore();
      const source = shortAlbum();
      let reads = 0;
      source.failure = (op) => (op === 'album:A' && ++reads > 1 ? new SourceError('RPC_ERROR', 'refused', null, 5) : null);
      expect((await scan(source, store)).outcome.kind).toBe('completed');
      const result = await classifyLatest(store);
      expect(result.report.coverage.albumIssues.map((i) => [i.kind, i.detail])).toEqual([['COUNT_MISMATCH', 'Google reports 5 entries; 2 read']]);
      expect(eligibleIndexes(result)).toEqual([]);
    });

    it('a scan paused during the second read reads the album again on resume', async () => {
      const store = newStore();
      const source = shortAlbum();
      let reads = 0;
      source.failure = (op) => (op === 'album:A' && ++reads === 2 ? new SourceError('NO_PHOTOS_TAB', 'no tab') : null);
      expect((await scan(source, store)).outcome.kind).toBe('paused');
      expect(eligibleIndexes(await classifyLatest(store))).toEqual([]);

      source.failure = () => null;
      source.calls.length = 0;
      expect((await scan(source, store)).outcome.kind).toBe('completed');
      expect(albumReads(source)).toBe(1); // only the second read; the first one was saved
      expect(eligibleIndexes(await classifyLatest(store))).toEqual([0, 1, 4, 5, 6, 7, 8, 9]);
    });

    it('an album that matches its count is read once', async () => {
      const source = new FakePhotos(Array.from({ length: 10 }, (_, i) => fakeItem(i)), [fakeAlbum('A', [2, 3])]);
      await scan(source, newStore());
      expect(albumReads(source)).toBe(1);
    });

    it('an album read again from the start forgets its earlier second read', async () => {
      const store = newStore();
      await scan(shortAlbum(), store);
      const run = (await store.latestRun('account-a'))!;
      await store.resetPhase(run.id, 'ALBUM_MEMBERS', 'A');
      expect((await store.albums(run.id))[0]!.reread).toBeNull();
    });
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
    const { outcome, progress } = await scan(source, store);
    expect(outcome).toEqual({ kind: 'failed', reason: INCOMPATIBLE_TEXT });
    expect((await store.latestRun('account-a'))!.status).toBe('FAILED');
    expect(eligibleIndexes(await classifyLatest(store))).toEqual([]);
    // Saved with the job, for a support request.
    expect(progress.at(-1)!.googleProblem).toEqual({ where: 'scan: album list', kind: 'PROTOCOL', message: 'shape changed', rpcCode: null, httpStatus: null });
  });

  it('an error code Google keeps returning pauses the scan, saying nothing was changed', async () => {
    const store = newStore();
    const source = standardAccount();
    source.failure = (op) => (op === 'library' ? new SourceError('RPC_ERROR', 'RPC lcxiM returned error code 3', null, 3) : null);
    const { outcome, progress } = await scan(source, store);
    expect(outcome).toEqual({ kind: 'paused', reason: refusedText('library', 3), untilPhotosOpen: false });
    expect(progress.at(-1)!.googleProblem).toMatchObject({ where: 'scan: library', kind: 'RPC_ERROR', rpcCode: 3 });
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

  it('an unfinished scan is said as a warning outside the folded details; a complete one is not', async () => {
    const store = newStore();
    await scan(standardAccount(), store);
    expect(reportView(await classifyLatest(store)).warningText).toBeNull();
    let checks = 0;
    await scan(standardAccount(), store, { shouldStop: async () => ++checks > 2 });
    // It names what blocks (it said "Protection coverage incomplete" until 0.4.38).
    expect(reportView(await classifyLatest(store)).warningText).toBe("No photo can be trashed: the last scan didn't finish");
  });

  it('what blocks trashing is named, and the diagnostic lines say it as numbers, without album titles or keys', async () => {
    const store = newStore();
    const source = new FakePhotos(
      Array.from({ length: 6 }, (_, i) => fakeItem(i)),
      [fakeAlbum('wedding-in-rome', [1, 2], { reportedCount: 5, shared: true }), fakeAlbum('holiday-with-anna', [3]), fakeAlbum('family-secret', [4])],
    );
    source.inaccessibleAlbums.add('family-secret');
    await scan(source, store);
    const view = reportView(await classifyLatest(store, NOW + 3 * 24 * 60 * 60 * 1000));
    expect(view.warningText).toBe("No photo can be trashed: 1 album couldn't be read");
    expect(view.diagnosticLines).toEqual([
      "Blocking trashing: 1 album couldn't be read; the scan is also more than a day old",
      'Album issue 1 (blocks): could not be read · shared unknown · kind 1 · Google reports 1, 0 read (1 short) · not read a second time',
      'Album note 1 (doesn\'t block): count mismatch, not blocking · shared · kind 4 · Google reports 5, 2 read (3 short) · read twice, the same entries both times',
      'Photos: 3 unknown for scan incomplete + scan out of date',
    ]);
    const shared = [view.copyText, ...view.diagnosticLines].join('\n');
    for (const secret of ['wedding', 'rome', 'holiday', 'anna', 'family', 'secret', 'Album wedding']) expect(shared.toLowerCase(), secret).not.toContain(secret);
  });

  it('the report is worked out again when a scan settles or the choices change, not while it runs', async () => {
    const running = startScanJob('account-a', NOW);
    const done = endJob(running, 'completed', null, NOW + 1);
    expect(reportKey('account-a', running, ALL_PROTECTED)).toBeNull();
    expect(reportKey('account-a', undefined, ALL_PROTECTED)).toBeNull();
    expect(reportKey('account-a', done, undefined)).toBeNull();
    expect(reportKey(null, done, ALL_PROTECTED)).toBeNull();
    const key = reportKey('account-a', done, ALL_PROTECTED);
    expect(reportKey('account-a', null, ALL_PROTECTED)).not.toBe(key);
    expect(reportKey('account-a', done, { ...ALL_PROTECTED, albums: false })).not.toBe(key);

    const store = newStore();
    expect(await latestReport(store, 'account-a', ALL_PROTECTED, NOW)).toBeNull();
    await scan(standardAccount(), store);
    expect((await latestReport(store, 'account-a', ALL_PROTECTED, NOW))!.title).toBe('Protection coverage complete');
  });

  it('a failure for an album the scan never listed is refused, not dropped', async () => {
    const store = newStore();
    await scan(standardAccount(), store);
    const run = (await store.latestRun('account-a'))!;
    await expect(store.markAlbumFailed(run.id, 'no-such-album', 'Access denied')).rejects.toThrow(/no-such-album/);
  });

  it('a scan that finished "in the future" (the clock moved back) proves nothing', async () => {
    const store = newStore();
    await scan(standardAccount(), store);
    const clockBack = await classifyLatest(store, NOW - 60_000);
    expect(clockBack.report.coverage.isStale).toBe(true);
    expect(eligibleIndexes(clockBack)).toEqual([]);
  });

  it('a broken clock is refused, not read as zero', async () => {
    const store = newStore();
    await scan(standardAccount(), store);
    await expect(classifyLatest(store, Number.NaN)).rejects.toThrow(/nowMs/);
    await expect(classifyLatest(store, NOW + 0.5)).rejects.toThrow(/whole number/);
    await expect(classifyLatest(store, -1)).rejects.toThrow(/negative/);
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

  it('a request cut off inside the browser (the service worker restarted) is a hiccup to retry, not a crash', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cutOff = new OpPhotosSource(async () => {
      throw new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received');
    });
    await expect(cutOff.status()).rejects.toMatchObject({ kind: 'TRANSIENT' });
    const noAnswer = new OpPhotosSource(async () => undefined as never);
    await expect(noAnswer.status()).rejects.toMatchObject({ kind: 'TRANSIENT' });
    warn.mockRestore();
  });
});

describe("the library read's numbers (for Copy diagnostics)", () => {
  it('counts pages, time in requests, retries and waits per listing', async () => {
    const store = newStore();
    const source = standardAccount();
    let failedOnce = false;
    source.failure = (op) => (op === 'favourites' && !failedOnce && (failedOnce = true) ? new SourceError('TRANSIENT', 'blip') : null);
    let clock = NOW;
    const stats = new ScanStats();
    const outcome = await runScan({
      account: 'account-a', source, store, stats,
      policy: { ...TEST_POLICY, pacingMs: 300 },
      now: () => (clock += 10), sleep: async () => {}, shouldStop: async () => false, onProgress: async () => {},
    });
    expect(outcome).toEqual({ kind: 'completed' });
    const l = stats.stats.listings;
    expect(Object.keys(l).sort()).toEqual(['album contents', 'album list', 'archive', 'favourites', 'library', 'session check'].sort());
    expect(l['library']).toMatchObject({ pages: 4, networkRetries: 0, rateLimits: 0, refusals: 0 });
    expect(l['favourites']).toMatchObject({ pages: 1, networkRetries: 1 });
    // Each request and each wait reads the clock twice here, 10 ms apart.
    expect(l['library']!.requestMs).toBe(40);
    expect(l['library']!.slowestMs).toBe(10);
    expect(l['favourites']!.waitedMs).toBe(30); // two pacing waits and one before the retry
  });
});