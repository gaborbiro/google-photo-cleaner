// The problem log keeps what went wrong lately, for Copy diagnostics, after the page that met it has
// closed: only steps, counts and the structure of Google's answers, never what the answers held.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runOp, type PageEnvironment } from '../../src/page/ops';
import { IndexedDbInventoryStore } from '../../src/app/scan/inventoryStore';
import { runScan } from '../../src/app/scan/session';
import { OpPhotosSource } from '../../src/app/scan/source';
import { diagnosticsText } from '../../src/app/shared/diagnostics';
import { INCOMPATIBLE_TEXT } from '../../src/app/shared/googleProblems';
import { endJob, reportProgress, startScanJob } from '../../src/app/shared/job';
import {
  checkedDiagnostic,
  IndexedDbProblemLog,
  keepProblems,
  MAX_PROBLEMS,
  PROBLEM_MAX_AGE_MS,
  problemsSaved,
  recordProblem,
  recordUnexpected,
  requestDetails,
  type Problem,
  type ProblemEntry,
  type ProblemSink,
} from '../../src/app/shared/problemLog';
import type { ReadOp } from '../../src/shared/protocol';
import { albumKey, albumsPayload, dedupKey, envelope, genericPayload, marker, mediaKey, rawAlbum, rawArchiveItem, rawLibraryItem, timelinePayload } from '../fixtures';
import { TEST_POLICY } from './fakes';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 20, 14, 2).getTime();

const problem = (where: string): Problem => ({ where, kind: 'PROTOCOL', message: 'shape changed', rpcCode: null, httpStatus: null, request: null, answer: null, stack: null });

/** Records into a log of its own; tests that record leave the page without one again. */
function keptIn(log: ProblemSink, version = '9.8.7'): void {
  keepProblems(log, version);
}

afterEach(() => {
  keepProblems({ add: async () => { throw new Error('a test recorded into a log it did not set up'); } }, 'none');
  vi.restoreAllMocks();
});

describe('the problem log', () => {
  it('keeps problems, newest first, with when and which version', async () => {
    const log = new IndexedDbProblemLog(new IDBFactory());
    await log.add({ ...problem('scan: library'), atMs: NOW - 1_000, version: '0.4.1' });
    await log.add({ ...problem('scan: album list'), atMs: NOW, version: '0.4.2' });
    const kept = await log.recent(NOW);
    expect(kept.map((p) => [p.where, p.version, p.atMs])).toEqual([['scan: album list', '0.4.2', NOW], ['scan: library', '0.4.1', NOW - 1_000]]);
  });

  it(`keeps the newest ${MAX_PROBLEMS}, and nothing older than 30 days`, async () => {
    const log = new IndexedDbProblemLog(new IDBFactory());
    await log.add({ ...problem('old'), atMs: NOW - PROBLEM_MAX_AGE_MS - DAY, version: '1' });
    for (let i = 0; i < MAX_PROBLEMS + 5; i++) await log.add({ ...problem(`step ${i}`), atMs: NOW - DAY + i, version: '1' });
    const kept = await log.recent(NOW);
    expect(kept).toHaveLength(MAX_PROBLEMS);
    expect(kept[0]!.where).toBe(`step ${MAX_PROBLEMS + 4}`);
    expect(kept.at(-1)!.where).toBe('step 5');
    // Nor shown once they grow too old, even before the next problem is saved.
    expect(await log.recent(NOW + PROBLEM_MAX_AGE_MS)).toHaveLength(0);
  });

  it('a recorded problem is saved in the background, and can be waited for before the page closes', async () => {
    const log = new IndexedDbProblemLog(new IDBFactory());
    keptIn(log);
    recordProblem(problem('scan: album list'), NOW);
    await problemsSaved();
    expect(await log.recent(NOW)).toMatchObject([{ where: 'scan: album list', version: '9.8.7', atMs: NOW }]);
  });

  it('a problem that cannot be saved is logged, not thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    keptIn({ add: async () => { throw new Error('disk full'); } });
    recordProblem(problem('scan: library'));
    await problemsSaved();
    expect(warn).toHaveBeenCalledWith('Photo Cleaner: a problem could not be saved for diagnostics', expect.any(Error));
  });

  it("an unexpected error keeps its message and where in the code, without the extension's address or anything identifying", async () => {
    const saved: ProblemEntry[] = [];
    keptIn({ add: async (entry) => void saved.push(entry) });
    const error = new TypeError(`Cannot read properties of undefined (reading 'x') for ${mediaKey('secret')} of someone@example.com`);
    error.stack = `TypeError: …\n    at readAlbum (chrome-extension://abcdefghijklmnopabcdefghijklmnop/engine.js:12:345)\n    at https://photos.google.com/u/0/album/${albumKey('secret')}`;
    recordUnexpected('scan: stopped unexpectedly', error, NOW);
    await problemsSaved();
    expect(saved).toEqual([{
      where: 'scan: stopped unexpectedly', kind: 'UNEXPECTED', message: "TypeError: Cannot read properties of undefined (reading 'x') for … of …",
      rpcCode: null, httpStatus: null, request: null, answer: null, stack: 'at readAlbum (engine.js:12:345)\nat …', atMs: NOW, version: '9.8.7',
    }]);
  });
});

describe('what a page script reports is checked again before it is kept', () => {
  it('only structure: any value in it becomes "?"', () => {
    const forged = {
      rpcId: 'Z5xsfc',
      at: [0, 3, '72930366'],
      answer: [['key:44', 'Holiday in Rome', mediaKey('x'), 12, 4_000, { title: 'Rome', '72930366': ['s:5', 'https://lh3.googleusercontent.com/x'] }]],
      focus: 'someone@example.com',
      envelope: ['5 lines, 99 characters', 'wrb.fr Z5xsfc ["s:6","Holiday",3]', 'wrb.fr Holiday in Rome', 'di [1]', 'the album Rome'],
      cause: `Unexpected token in ${albumKey('secret')} at https://photos.google.com/x`,
    };
    expect(checkedDiagnostic(forged)).toEqual({
      rpcId: 'Z5xsfc',
      at: [0, 3, '72930366'],
      answer: [['key:44', '?', '?', 12, '?', { '72930366': ['s:5', '?'] }]],
      focus: '?',
      envelope: ['5 lines, 99 characters', 'wrb.fr Z5xsfc ["s:6","?",3]', 'wrb.fr ?', 'di [1]', '?'],
      cause: 'Unexpected token in … at …',
    });
  });

  it('without a proper request name it keeps nothing; a path of anything but positions and field numbers is dropped', () => {
    expect(checkedDiagnostic({ rpcId: 'Holiday in Rome', at: null })).toBeNull();
    expect(checkedDiagnostic('Z5xsfc')).toBeNull();
    expect(checkedDiagnostic({ rpcId: 'Z5xsfc', at: [0, 'title'], answer: null, focus: null, envelope: null, cause: null })).toMatchObject({ at: null });
  });

  it('a structure too large to keep is left out', () => {
    const huge = Array.from({ length: 60 }, () => Array.from({ length: 60 }, () => Array.from({ length: 60 }, () => 's:10')));
    expect(checkedDiagnostic({ rpcId: 'lcxiM', at: [0], answer: huge, focus: null, envelope: null, cause: null })?.answer).toBe('too large to keep');
  });

  it('a request is named by its operation and the names of what was sent, never the values', () => {
    expect(requestDetails('listAlbumItemsPage', { albumKey: albumKey('secret'), authKey: 'AUTH', pageToken: marker(), 'Holiday in Rome': 1 }))
      .toEqual({ op: 'listAlbumItemsPage', sent: ['albumKey', 'authKey', 'pageToken', 'other'] });
  });
});

describe('from a real-looking answer to the copied diagnostics', () => {
  const TITLE = 'Holiday in Rome with Anna';
  const EMAIL = 'someone.private@example.com';
  const AUTH_KEY = 'AFMv8shareAuthKeyForAnAlbumAbc123def456';
  const ACTOR = 'ACTOR_1234567890123456789';
  const FINGERPRINT = 'abcdef0123456789';

  /** Google Photos as the page script reaches it: a library of one photo, and an album list whose second row has a field more. */
  function page(): PageEnvironment {
    const rows = [0, 1, 2].map((i) => rawAlbum({ albumKey: albumKey(`ALBUM${i}`), title: TITLE, authKey: AUTH_KEY, ownerActorId: ACTOR }));
    rows[1] = [...rows[1]!.slice(0, -1), [7], rows[1]!.at(-1)];
    const answers: Record<string, unknown> = {
      lcxiM: timelinePayload([rawLibraryItem({ mediaKey: mediaKey('PHOTO'), dedupKey: dedupKey('PHOTO'), actorId: ACTOR })], null),
      EzkLib: genericPayload([], null),
      Z5xsfc: albumsPayload(rows, null),
    };
    return {
      wiz: () => ({ SNlM0e: 'AT_SESSION_TOKEN_abcdefghijklmnop', FdrFJe: '1', cfb2h: 'bl', eptZe: '/_/PhotosUi/', oPEP7c: EMAIL }),
      sourcePath: () => '/',
      fetcher: async (url, init) => {
        const rpcid = new URL(url).searchParams.get('rpcids')!;
        // Asked for the archive alone (source 2), lcxiM answers with its short rows.
        const archive = rpcid === 'lcxiM' && decodeURIComponent(String(init.body)).includes('[null,null,500,null,1,2]');
        const answer = archive ? timelinePayload([rawArchiveItem(mediaKey('ARCHIVED'), dedupKey('ARCHIVED'))], null) : answers[rpcid];
        return { ok: true, status: 200, redirected: false, url, text: async () => envelope(rpcid, answer) } as Response;
      },
      sha256Hex: async () => `${FINGERPRINT}ffff`,
    };
  }

  it('a scan stopped at the album list: the log says which request and row, and the copied text holds nothing private', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = new IndexedDbProblemLog(new IDBFactory());
    keptIn(log, '0.4.13');
    const env = page();
    const source = new OpPhotosSource((op: ReadOp, params) => runOp(env, op, params));
    const progress: Parameters<Parameters<typeof runScan>[0]['onProgress']>[0][] = [];
    const outcome = await runScan({
      account: FINGERPRINT, source, store: new IndexedDbInventoryStore(new IDBFactory()), policy: TEST_POLICY,
      now: () => NOW, sleep: async () => {}, shouldStop: async () => false, onProgress: async (p) => void progress.push(p),
    });
    await problemsSaved();
    expect(outcome).toEqual({ kind: 'failed', reason: INCOMPATIBLE_TEXT });

    const [entry, ...others] = await log.recent(NOW);
    expect(others).toEqual([]);
    expect(entry).toMatchObject({
      where: 'scan: album list', kind: 'PROTOCOL', message: 'Album has 10 fields, expected 9 or 12', version: '0.4.13',
      request: { op: 'listAlbumsPage', sent: [] },
      answer: { rpcId: 'Z5xsfc', at: [0, 1] },
    });

    const job = endJob(reportProgress(startScanJob(FINGERPRINT, NOW), progress.at(-1)!, NOW), 'failed', INCOMPATIBLE_TEXT, NOW);
    const text = diagnosticsText({ version: '0.4.13', nowMs: NOW, scan: job, analysis: null, problems: [entry!] });
    expect(text).toContain('scan: album list');
    expect(text).toContain('Request: listAlbumsPage (Z5xsfc) · sent with nothing');
    expect(text).toContain('Gave up at: [0][1]');
    expect(text).toContain('That part: ["key:44",["url","n","n",null,null,null,null,null,null,[1]],null,null,null,null,["id:25"],[[3],[4]],[7],{"72930366":[1,"s:25",');
    expect(text).toContain('library 1 · favourites 0 · archive 1 · albums 0 of 0 read');
    for (const secret of ['AF1Qip', TITLE, 'Rome', 'Anna', AUTH_KEY, ACTOR, 'photos.fife', 'usercontent', EMAIL, 'AT_SESSION_TOKEN', FINGERPRINT, dedupKey('PHOTO')]) {
      expect(text, secret).not.toContain(secret);
      expect(JSON.stringify(entry), secret).not.toContain(secret);
    }
    // The console gets the short version only.
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/AF1Qip|Holiday|photos\.fife/);
  });
});
