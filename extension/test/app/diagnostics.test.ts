// What Copy diagnostics copies: the Scan's state and the problem log, as plain text for a report.

import { describe, expect, it } from 'vitest';
import { NO_ANALYSIS } from '../../src/app/ai/analysis';
import { diagnosticsText, pathText, spanText } from '../../src/app/shared/diagnostics';
import { INCOMPATIBLE_TEXT } from '../../src/app/shared/googleProblems';
import { endJob, NO_PROGRESS, reportProgress, startAnalysisJob, startScanJob } from '../../src/app/shared/job';
import type { ProblemEntry, RunEntry } from '../../src/app/shared/problemLog';

const NOW = new Date(2026, 9, 20, 14, 2, 5).getTime();
const AT = new Date(2026, 9, 20, 14, 1, 22).getTime();

const stopped = endJob(
  reportProgress(startScanJob('acc1', NOW), { ...NO_PROGRESS, phase: 'ALBUM_LIST', libraryEntries: 18_432, favouriteEntries: 15, archiveEntries: 0 }, NOW),
  'failed', INCOMPATIBLE_TEXT, NOW,
);

const albumListProblem: ProblemEntry = {
  id: 7, atMs: AT, version: '0.4.13', where: 'scan: album list', kind: 'PROTOCOL', message: 'Album has 10 fields, expected 9 or 12', rpcCode: null, httpStatus: null,
  request: { op: 'listAlbumsPage', sent: [] },
  answer: { rpcId: 'Z5xsfc', at: [0, 1], answer: [[['key:44'], ['key:44', null]], 'id:140'], focus: ['key:44', null], envelope: null, cause: null },
  stack: null,
};

describe('the diagnostics text', () => {
  it("says the version, the Scan's state, then each problem: where, how, which request, where it gave up and the answer's structure", () => {
    expect(diagnosticsText({ version: '0.4.13', nowMs: NOW, scan: stopped, analysis: null, problems: [albumListProblem], runs: [], report: null })).toBe([
      'Photo Cleaner 0.4.13 · diagnostics copied 20 Oct 2026, 14:02:05',
      'Without photos, album names or account details. Answers from Google are described by their structure only: "key:44" is an ID of 44 characters, "s:12" a text of 12, "n" a large number.',
      '',
      'Scan',
      'Step 1, read your library: failed at ALBUM_LIST · library 18,432 · favourites 15 · archive 0 · albums 0 of 0 read, 0 could not be read',
      `  ${INCOMPATIBLE_TEXT}`,
      'Step 2, analyse photos: not started',
      '',
      'Protection',
      'No protection report (no finished scan, or still being worked out).',
      '',
      'Problems, newest first (1; the last 50 of 30 days are kept):',
      '1. 20 Oct 2026, 14:01:22 · version 0.4.13 · scan: album list',
      '   PROTOCOL · Album has 10 fields, expected 9 or 12',
      '   Request: listAlbumsPage (Z5xsfc) · sent with nothing',
      '   Gave up at: [0][1]',
      '   That part: ["key:44",null]',
      '   Answer: [[["key:44"],["key:44",null]],"id:140"]',
      '',
      'Runs: none in the last 30 days.',
    ].join('\n'));
  });

  it('a refusal, an envelope, an unexpected error and the analysis', () => {
    const analysis = endJob(reportProgress(startAnalysisJob('acc1', NOW, null, NO_ANALYSIS), { ...NO_ANALYSIS, stage: 'analysing', photos: 10, analysed: 4, newPhotos: 6, newAnalysed: 0, detail: 140 }, NOW), 'paused', 'Stopped.', NOW);
    const refused: ProblemEntry = {
      ...albumListProblem, id: 8, kind: 'RPC_ERROR', message: 'RPC Z5xsfc returned error code 3', rpcCode: 3, request: { op: 'listAlbumsPage', sent: ['pageToken'] },
      answer: { rpcId: 'Z5xsfc', at: null, answer: null, focus: null, envelope: ['3 lines, 80 characters', 'wrb.fr Z5xsfc ["s:6","id:6",null,null,null,[3],"id:7"]'], cause: null },
    };
    const unexpected: ProblemEntry = { ...albumListProblem, id: 9, kind: 'UNEXPECTED', where: 'analysis: stopped unexpectedly', message: 'TypeError: x is undefined', request: null, answer: null, stack: 'at a (engine.js:1:2)\nat b (engine.js:3:4)' };
    const text = diagnosticsText({ version: '0.4.13', nowMs: NOW, scan: stopped, analysis, problems: [unexpected, refused], runs: [], report: null });
    expect(text).toContain('Step 2, analyse photos: paused at analysing · 4 of 10 photos analysed · this run 0 of 6 · 0 could not be fetched · detail 140\n  Stopped.');
    expect(text).toContain([
      '1. 20 Oct 2026, 14:01:22 · version 0.4.13 · analysis: stopped unexpectedly',
      '   UNEXPECTED · TypeError: x is undefined',
      '   In the code:',
      '     at a (engine.js:1:2)',
      '     at b (engine.js:3:4)',
      '2. 20 Oct 2026, 14:01:22 · version 0.4.13 · scan: album list',
      '   RPC_ERROR · RPC Z5xsfc returned error code 3 · code 3',
      '   Request: listAlbumsPage (Z5xsfc) · sent with pageToken',
      '   Envelope:',
      '     3 lines, 80 characters',
      '     wrb.fr Z5xsfc ["s:6","id:6",null,null,null,[3],"id:7"]',
    ].join('\n'));
  });

  it('with nothing logged and nothing scanned, says so', () => {
    const text = diagnosticsText({ version: '0.4.13', nowMs: NOW, scan: null, analysis: null, problems: [], runs: [], report: null });
    expect(text.split('\n').slice(3)).toEqual(['Scan', 'Step 1, read your library: not started', 'Step 2, analyse photos: not started', '', 'Protection', 'No protection report (no finished scan, or still being worked out).', '', 'Problems: none in the last 30 days.', '', 'Runs: none in the last 30 days.']);
  });

  it('writes a path into an answer as code would', () => {
    expect(pathText([0, 12, '72930366', 3])).toBe('[0][12]["72930366"][3]');
    expect(pathText([])).toBe('(the whole answer)');
  });
});

describe('the recent runs in the diagnostics text', () => {
  it('a library read per listing, and an analysis with where its time went', () => {
    const start = new Date(2026, 9, 20, 12, 0, 0).getTime();
    const scanRun: RunEntry = {
      type: 'run', runKey: 'library-scan:acc1@1', version: '0.4.38', startedAtMs: start, atMs: start + 16 * 60_000, outcome: 'completed',
      stats: { stage: 'library read', listings: {
        library: { pages: 98, requestMs: 242_000, slowestMs: 8_100, networkRetries: 0, rateLimits: 0, refusals: 0, waitedMs: 30_000 },
        'album contents': { pages: 410, requestMs: 500_000, slowestMs: 4_000, networkRetries: 2, rateLimits: 1, refusals: 0, waitedMs: 90_000 },
      } },
    };
    const analysisRun: RunEntry = {
      type: 'run', runKey: 'analysis:acc1@2', version: '0.4.38', startedAtMs: start + 20 * 60_000, atMs: start + 20 * 60_000 + 3_600_000, outcome: 'running',
      stats: {
        stage: 'analysis', photos: 48_685, alreadyAnalysed: 1_000, photosDone: 14_400, previewsFailed: 12, detail: 70, measuredPhotosPerSecond: 4.4,
        modelMs: 40_000, modelCached: true, speedCheckMs: 0, pagesMs: 120_000, aiMs: 2_400_000, previewMs: 300_000, saveMs: 30_000, gentleMs: 0, otherMs: 28_000,
        rateLimits: 3, rateLimitWaitMs: 180_000, fullSpeedAtStart: false, fullSpeedNow: true, graphics: 'intel / gen-12lp',
      },
    };
    const text = diagnosticsText({ version: '0.4.38', nowMs: NOW, scan: null, analysis: null, problems: [], runs: [analysisRun, scanRun], report: null });
    expect(text.slice(text.indexOf('Recent runs'))).toBe([
      'Recent runs, the latest first (2; the last 20 of 30 days are kept):',
      '1. analysis · 20 Oct 2026, 12:20:00 to 20 Oct 2026, 13:20:00 (1 h 0 min) · running · version 0.4.38',
      '   14,400 photos done of 48,685 (1,000 analysed before this run) · 12 previews failed · 4.0 photos/s over the run',
      '   Time: AI 40 min 0 s · waiting for previews 5 min 0 s · saving 30 s · held back by gentle mode 0 s · other 28 s · reading the library 2 min 0 s · AI model 40 s (already on this computer) · speed check 0 s',
      '   Google limited previews 3 times, 3 min 0 s waited',
      '   Detail 70 (speed check measured 4.4 photos/s) · full speed on (off at start) · graphics: intel / gen-12lp',
      '2. library read · 20 Oct 2026, 12:00:00 to 20 Oct 2026, 12:16:00 (16 min 0 s) · completed · version 0.4.38',
      '   library: 98 pages, 4 min 2 s in requests (slowest 8.1 s), waited 30 s',
      '   album contents: 410 pages, 8 min 20 s in requests (slowest 4 s), waited 1 min 30 s · 2 network retries · 1 rate limit',
    ].join('\n'));
  });

  it('writes spans of time plainly', () => {
    expect([0, 450, 8_100, 42_000, 242_000, 5_400_000].map(spanText)).toEqual(['0 s', '0.5 s', '8.1 s', '42 s', '4 min 2 s', '1 h 30 min']);
  });
});