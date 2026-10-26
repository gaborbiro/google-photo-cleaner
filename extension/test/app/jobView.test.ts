import { describe, expect, it } from 'vitest';
import { NO_ANALYSIS } from '../../src/app/ai/analysis';
import { endJob, markAlive, NO_PROGRESS, NOT_RESPONDING_TEXT, pauseJob, reportProgress, setFullSpeed, startAnalysisJob, startScanJob } from '../../src/app/shared/job';
import type { ReportView } from '../../src/app/scan/report';
import { accountLabel, checkedText, copyReportText, documentTitle, launchButton, reviewAccount, reviewPageView, scanTabTitle, scanView, surfaceView, versionLine } from '../../src/app/shared/jobView';
import { accountAnswer, panelOptions, panelTab, photosTabOf, requestedReviewTab, reviewUrl } from '../../src/app/shared/messages';
import { ALL_PROTECTED } from '../../src/app/shared/preferences';

const NOW = new Date(2026, 9, 14, 21, 40).getTime();

describe('one Scan in two stages', () => {
  // Running, with the background page saying it still has them in hand (see the not-responding test).
  const reading = markAlive(reportProgress(
    startScanJob('acc1', 0),
    { ...NO_PROGRESS, phase: 'LIBRARY', libraryEntries: 12_500, albumsListed: 0, libraryReachedMs: new Date(2021, 4, 3).getTime() },
    1_000,
  ), NOW);
  const scanned = endJob(reading, 'completed', null, NOW);
  const analysing = markAlive(reportProgress(
    startAnalysisJob('acc1', 0, null, NO_ANALYSIS),
    { ...NO_ANALYSIS, stage: 'analysing', photos: 17_202, analysed: 4_300, newPhotos: 17_202, newAnalysed: 4_300, photosPerSecond: 5.7, etaSeconds: 2_265, detail: 140 },
    1,
  ), NOW);

  it('offers to scan when nothing has run yet', () => {
    expect(scanView(null, null, NOW, 'tab')).toMatchObject({ title: 'Not scanned yet', action: 'start', actionLabel: 'Scan library', target: 'library-scan', lines: [], stage: null, fullSpeed: null });
  });

  it('shows both steps before starting, with the speed choice in analysis only', () => {
    const [library, analysis] = scanView(null, null, NOW, 'tab').steps;
    expect(library).toMatchObject({ number: 1, title: 'Read your library', state: 'pending', statusText: 'Not started', protectionKnown: false, fullSpeed: null });
    expect(analysis).toMatchObject({ number: 2, title: 'Analyse photos', state: 'pending', statusText: 'Not started', fullSpeed: false, waiting: 'Starts automatically after step 1.' });
  });

  it('keeps library counts and protection in step 1 while step 2 analyses', () => {
    const [library, analysis] = scanView(scanned, analysing, NOW, 'tab').steps;
    expect(library).toMatchObject({ state: 'complete', statusText: 'Complete', protectionKnown: true, percent: null, fullSpeed: null, timesText: 'Checked today 21:40' });
    expect(library.lines).toEqual([]); // The final counts are supplied by the protection report.
    expect(analysis).toMatchObject({ state: 'running', statusText: 'In progress', percent: 24, fullSpeed: false, protectionKnown: false });
    expect(library.detailText).toBe('Detail 140'); // Shown beside the protection details' scan times.
    expect(analysis.detailText).toBeNull();
    expect(analysis.lines[0]).toBe('New photos: 4,300 of 17,202 analysed');
  });

  it('does not present a previous analysis or protection report as the new scan completing', () => {
    const previous = endJob(setFullSpeed(analysing, true, NOW), 'completed', null, NOW);
    const [library, analysis] = scanView(reading, previous, NOW, 'tab').steps;
    expect(library).toMatchObject({ state: 'running', protectionKnown: false, indeterminate: true });
    expect(analysis).toMatchObject({ state: 'pending', statusText: 'Up next', fullSpeed: true, percent: null });
    expect(analysis.lines).toEqual([]);
    expect(library.detailText).toBe('Detail 140');
  });

  it('keeps analysis detail after completion and flags an old library separately', () => {
    const done = endJob(analysing, 'completed', null, NOW);
    const [library, analysis] = scanView(scanned, done, NOW + 2 * 86_400_000, 'tab').steps;
    expect(library).toMatchObject({ state: 'stale', statusText: 'Needs a refresh', protectionKnown: true });
    expect(library.notice).toContain('before anything can be trashed');
    expect(analysis).toMatchObject({ state: 'complete', statusText: 'Complete', fullSpeed: false });
    expect(library.detailText).toBe('Detail 140');
    expect(analysis.notice).toBeNull();
  });

  it.each(['paused', 'failed'] as const)('shows which step is %s without changing the other step', (state) => {
    const libraryStopped = scanView(endJob(reading, state, 'Library problem.', NOW), analysing, NOW, 'tab').steps;
    expect(libraryStopped[0]).toMatchObject({ state, notice: 'Library problem.' });
    expect(libraryStopped[1]).toMatchObject({ state: 'pending', notice: null });
    const analysisStopped = scanView(scanned, endJob(analysing, state, 'Analysis problem.', NOW), NOW, 'tab').steps;
    expect(analysisStopped[0]).toMatchObject({ state: 'complete', notice: null });
    expect(analysisStopped[1]).toMatchObject({ state, notice: 'Analysis problem.' });
  });

  it('stage 1 reads the photo list: counts, how far back it has got, a bar without a measure', () => {
    const view = scanView(reading, null, NOW, 'tab');
    expect(view).toMatchObject({ title: 'Scanning', stage: 'Stage 1 of 2 · Reading your photo list', action: 'pause', target: 'library-scan', indeterminate: true, percent: null, fullSpeed: false });
    expect(view.lines[0]).toBe('Library: 12,500 entries, reached photos from 3 May 2021');
  });

  it('full speed stays visible and keeps its choice across both stages and pauses', () => {
    const fullSpeed = setFullSpeed(analysing, true, NOW);
    const previous = endJob(fullSpeed, 'completed', null, NOW);
    expect(scanView(reading, previous, NOW, 'tab').fullSpeed).toBe(true);
    expect(scanView(pauseJob(reading, NOW), fullSpeed, NOW, 'tab').fullSpeed).toBe(true);
    expect(scanView(scanned, null, NOW, 'tab').fullSpeed).toBe(false);
    for (const stage of ['model', 'speed-check', 'analysing'] as const) {
      const job = reportProgress(fullSpeed, { ...fullSpeed.progress, stage }, NOW);
      expect(scanView(scanned, job, NOW, 'tab').fullSpeed).toBe(true);
      expect(scanView(scanned, pauseJob(job, NOW), NOW, 'tab').fullSpeed).toBe(true);
    }
  });

  it("Google's details behind a stop go to step 1's protection details and its copied report, for a support request", () => {
    expect(scanView(scanned, analysing, NOW, 'tab').steps[0].supportLines).toEqual([]);
    const problem = { where: 'analysis: preview', kind: 'PROTOCOL' as const, message: 'Preview response is not an image', rpcCode: 3, httpStatus: 400 };
    const stopped = endJob(reportProgress(analysing, { ...analysing.progress, googleProblem: problem }, 1), 'paused', 'Not understood.', NOW);
    const [library, analysis] = scanView(scanned, stopped, NOW, 'tab').steps;
    const line = 'For support: analysis: preview · PROTOCOL · Preview response is not an image · code 3 · HTTP 400';
    expect(library.supportLines).toEqual([line]);
    expect(analysis.supportLines).toEqual([]);
    expect(copyReportText({ copyText: 'Protection coverage complete' } as ReportView, library, '1.2.3')).toBe(`Protection coverage complete\nPhoto Cleaner 1.2.3\n${line}`);
    // Saved before the details existed: nothing to show.
    const { googleProblem: _, ...older } = stopped.progress;
    expect(scanView(scanned, { ...stopped, progress: older }, NOW, 'tab').steps[0].supportLines).toEqual([]);
    expect(copyReportText({ copyText: 'Report' } as ReportView, scanView(scanned, analysing, NOW, 'tab').steps[0], '1.2.3')).toBe('Report\nPhoto Cleaner 1.2.3');
  });

  it('the protection details and their copied report say which version ran', () => {
    expect(versionLine('0.4.14')).toBe('Photo Cleaner 0.4.14');
  });

  it('a step that stopped because something went wrong offers Copy diagnostics; one stopped early shows its support line itself', () => {
    const problem = { where: 'scan: album list', kind: 'PROTOCOL' as const, message: 'Album has 10 fields, expected 9 or 12', rpcCode: null, httpStatus: null };
    const failedEarly = endJob(reportProgress(reading, { ...reading.progress, phase: 'ALBUM_LIST', googleProblem: problem }, 1_000), 'failed', 'Not understood.', 2_000);
    const [library, analysis] = scanView(failedEarly, null, NOW, 'tab').steps;
    expect(library).toMatchObject({ state: 'failed', diagnostics: true, protectionKnown: false, problemLines: ['For support: scan: album list · PROTOCOL · Album has 10 fields, expected 9 or 12'] });
    expect(analysis).toMatchObject({ diagnostics: false, problemLines: [] });
    // Paused by a problem (repeated network failures, a refusal): also offered.
    expect(scanView(endJob(reading, 'paused', 'Repeated network problems.', 2_000), null, NOW, 'tab').steps[0]).toMatchObject({ diagnostics: true, problemLines: [] });
    // Not for the user's own pause, a pause that only waits for Google Photos, a running or a finished step.
    expect(scanView(pauseJob(reading, 2_000), null, NOW, 'tab').steps[0].diagnostics).toBe(false);
    expect(scanView(endJob(reading, 'paused', 'Google Photos was closed.', 2_000, true), null, NOW, 'tab').steps[0].diagnostics).toBe(false);
    expect(scanView(reading, null, NOW, 'tab').steps[0].diagnostics).toBe(false);
    expect(scanView(scanned, analysing, NOW, 'tab').steps.map((s) => s.diagnostics)).toEqual([false, false]);
    // Stage 2 stopped: offered there; its support line stays in step 1's protection details.
    const analysisStopped = endJob(reportProgress(analysing, { ...analysing.progress, googleProblem: { ...problem, where: 'analysis: preview' } }, 1), 'paused', 'Not understood.', NOW);
    const steps = scanView(scanned, analysisStopped, NOW, 'tab').steps;
    expect(steps.map((s) => s.diagnostics)).toEqual([false, true]);
    expect(steps.map((s) => s.problemLines)).toEqual([[], []]);
  });

  it('a running stage whose background page shows no sign of life for 90 s is not responding, and offers Restart', () => {
    const lastSign = NOW - 60_000;
    const quiet = markAlive(reportProgress(startScanJob('acc1', 0), { ...NO_PROGRESS, phase: 'ALBUM_LIST' }, 1_000), lastSign);
    // Under 90 s, also through a long wait: the page stamps the job while it waits.
    expect(scanView(quiet, null, lastSign + 90_000, 'tab')).toMatchObject({ title: 'Scanning', action: 'pause', indeterminate: true });
    const view = scanView(quiet, null, lastSign + 90_001, 'tab');
    expect(view).toMatchObject({ title: 'Scan not responding', tone: 'negative', action: 'restart-engine', actionLabel: 'Restart', target: 'library-scan', indeterminate: false, notice: NOT_RESPONDING_TEXT, tabStatus: 'needed' });
    expect(view.steps[0]).toMatchObject({ state: 'stalled', statusText: 'Not responding', indeterminate: false, notice: NOT_RESPONDING_TEXT, diagnostics: true });
    // Progress is a sign of life too (and a job saved before the stamps existed has only that).
    expect(scanView(reportProgress(quiet, quiet.progress, lastSign + 80_000), null, lastSign + 120_000, 'tab').title).toBe('Scanning');
    expect(scanView(reportProgress(startScanJob('acc1', 0), NO_PROGRESS, lastSign), null, lastSign + 100_000, 'tab').title).toBe('Scan not responding');
    // Only a running stage can be not responding.
    expect(scanView(pauseJob(quiet, lastSign), null, NOW + 1_000_000, 'tab').title).toBe('Scan paused');
    // Stage 2 the same way.
    const quietAnalysis = markAlive(analysing, lastSign);
    const later = scanView(scanned, quietAnalysis, lastSign + 91_000, 'tab');
    expect(later).toMatchObject({ title: 'Scan not responding', action: 'restart-engine', target: 'analysis', notice: NOT_RESPONDING_TEXT });
    expect(later.steps.map((s) => [s.state, s.diagnostics])).toEqual([['complete', false], ['stalled', true]]);
    expect(later.steps[1].notice).toBe(NOT_RESPONDING_TEXT);
  });

  it('with the photo list over a day old and the analysis not running, the next step is a fresh read, which the analysis then follows', () => {
    const dayLater = NOW + 25 * 60 * 60 * 1000;
    const paused = endJob(analysing, 'paused', 'Google may have changed something.', NOW);
    const view = scanView(scanned, paused, dayLater, 'tab');
    expect(view).toMatchObject({ title: 'Scan paused', tone: 'caution', action: 'restart', actionLabel: 'Check for new photos', target: 'library-scan', tabStatus: 'out of date' });
    expect(view.steps[0]).toMatchObject({ state: 'stale', notice: 'More than a day old, so nothing can be trashed yet. Check for new photos reads it again; the analysis then carries on where it was.' });
    expect(view.steps[1]).toMatchObject({ state: 'paused', notice: 'Google may have changed something.' });
    // The same when it stopped, or never started.
    expect(scanView(scanned, endJob(analysing, 'failed', 'Broken.', NOW), dayLater, 'tab')).toMatchObject({ actionLabel: 'Check for new photos', target: 'library-scan' });
    expect(scanView(scanned, null, dayLater, 'tab')).toMatchObject({ title: 'Photos not analysed yet', actionLabel: 'Check for new photos', target: 'library-scan' });
    // Within the day, the analysis is resumed as before; while it runs, it can be paused.
    expect(scanView(scanned, paused, NOW + 60_000, 'tab')).toMatchObject({ action: 'resume', target: 'analysis' });
    expect(scanView(scanned, markAlive(analysing, dayLater), dayLater, 'tab')).toMatchObject({ action: 'pause', target: 'analysis' });
    // A finished analysis keeps its own wording.
    expect(scanView(scanned, endJob(analysing, 'completed', null, NOW), dayLater, 'tab').steps[0].notice).toBe('More than a day old: check for new photos before anything can be trashed.');
  });

  it('a paused or stopped stage 1 is resumed or started again', () => {
    expect(scanView(endJob(reading, 'paused', 'The session ended.', 2_000), null, NOW, 'tab')).toMatchObject({ title: 'Scan paused', action: 'resume', actionLabel: 'Resume', target: 'library-scan', notice: 'The session ended.', indeterminate: false });
    expect(scanView(pauseJob(reading, 2_000), null, NOW, 'tab').action).toBe('resume');
    expect(scanView(endJob(reading, 'failed', 'Not understood.', 2_000), null, NOW, 'tab')).toMatchObject({ title: 'Scan stopped', actionLabel: 'Start a new scan', target: 'library-scan' });
  });

  it('says "1 entry", not "1 entries"', () => {
    const view = scanView(reportProgress(startScanJob('acc1', 0), { ...NO_PROGRESS, favouriteEntries: 1, archiveEntries: 2 }, 1_000), null, NOW, 'tab');
    expect(view.lines[1]).toBe('Favourite photos: 1 entry');
    expect(view.lines[2]).toBe('Archived photos: 2 entries');
  });

  it('stage 2 analyses the new photos: the bar fills for the model download, then for the photos', () => {
    const downloading = scanView(scanned, reportProgress(analysing, { ...NO_ANALYSIS, stage: 'model', modelPercent: 42, photos: 17_202 }, 1), NOW, 'tab');
    expect(downloading).toMatchObject({ title: 'Scanning', stage: 'Stage 2 of 2 · Getting the AI model ready (once)', percent: 42, target: 'analysis' });
    expect(downloading.lines[0]).toBe('Downloading the AI model (once): 42% of about 320 MB');
    const view = scanView(scanned, analysing, NOW, 'tab');
    expect(view).toMatchObject({ title: 'Scanning', stage: 'Stage 2 of 2 · Analysing new photos', percent: 24, action: 'pause', target: 'analysis', fullSpeed: false, indeterminate: false });
    expect(view.lines).toEqual(['New photos: 4,300 of 17,202 analysed', '5.7 photos/s over the last minute · about 38 min left']);
    expect(view.steps[0].detailText).toBe('Detail 140');
  });

  it('shows where each photo’s time goes in the review tab only', () => {
    const timed = reportProgress(analysing, { ...analysing.progress, perPhotoMs: { ai: 120.4, preview: 30.6, save: 5, pace: 40, other: 2 } }, 1);
    const perPhoto = 'Per photo (ms): AI 120 · preview 31 · save 5 · gentle 40 · other 2';
    expect(scanView(scanned, timed, NOW, 'tab').steps[1].lines).toContain(perPhoto);
    for (const surface of ['popup', 'panel'] as const) {
      const lines = scanView(scanned, timed, NOW, surface).steps[1].lines;
      expect(lines).toEqual(['New photos: 4,300 of 17,202 analysed', '5.7 photos/s over the last minute · about 38 min left']);
    }
  });

  it('checking again counts only the new photos, not the whole library', () => {
    const again = reportProgress(analysing, { ...analysing.progress, analysed: 17_200, newPhotos: 3, newAnalysed: 1 }, 1);
    const view = scanView(scanned, again, NOW, 'tab');
    expect(view.percent).toBe(33);
    expect(view.lines[0]).toBe('New photos: 1 of 3 analysed');
  });

  it('a paused or stopped stage 2 is resumed or tried again', () => {
    const paused = scanView(scanned, pauseJob(analysing, 2), NOW, 'tab');
    expect(paused).toMatchObject({ title: 'Scan paused', action: 'resume', actionLabel: 'Resume', target: 'analysis', fullSpeed: false });
    expect(paused.steps[1].statusText).toBe('Paused');
    const resumed = scanView(scanned, analysing, NOW, 'tab');
    expect(resumed.actionLabel).toBe('Pause');
    expect(resumed.steps[1].statusText).toBe('In progress');
    expect(scanView(scanned, endJob(analysing, 'failed', 'Broken.', 2), NOW, 'tab')).toMatchObject({ title: 'Scan stopped', actionLabel: 'Try again', target: 'analysis' });
  });

  it('once both stages are done the scan is complete, and offers to check for new photos', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, done, NOW + 3_600_000, 'tab')).toMatchObject({
      title: 'Scan complete', stage: null, percent: null, fullSpeed: null, notice: null,
      lines: ['17,202 photos · ready to review', 'Checked today 21:40'],
      action: 'restart', actionLabel: 'Check for new photos', target: 'library-scan',
    });
    const withFailures = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_200, failed: 2 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, withFailures, NOW, 'tab').lines[0]).toBe('17,202 photos · 2 could not be read (tried again next time)');
  });

  it('the status dot: green when complete, amber when paused or out of date, red when stopped, none while scanning', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, done, NOW, 'tab').tone).toBe('positive');
    expect(scanView(scanned, done, NOW + 2 * 86_400_000, 'tab').tone).toBe('caution');
    expect(scanView(endJob(reading, 'paused', null, 2_000), null, NOW, 'tab').tone).toBe('caution');
    expect(scanView(scanned, pauseJob(analysing, 2), NOW, 'tab').tone).toBe('caution');
    expect(scanView(endJob(reading, 'failed', 'Not understood.', 2_000), null, NOW, 'tab').tone).toBe('negative');
    expect(scanView(scanned, endJob(analysing, 'failed', 'Broken.', 2), NOW, 'tab').tone).toBe('negative');
    expect(scanView(reading, null, NOW, 'tab').tone).toBeNull();
    expect(scanView(scanned, analysing, NOW, 'tab').tone).toBeNull();
    expect(scanView(null, null, NOW, 'tab').tone).toBeNull();
  });

  it('after a day the scan is out of date: it no longer proves what is protected', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, done, NOW + 2 * 86_400_000, 'tab')).toMatchObject({
      title: 'Scan out of date',
      lines: ['17,202 photos', 'Checked 2 days ago'],
      notice: 'More than a day old: check for new photos before anything can be trashed.',
      actionLabel: 'Check for new photos',
    });
  });

  it('a photo list read without an analysis yet offers to analyse', () => {
    expect(scanView(scanned, null, NOW, 'tab')).toMatchObject({ title: 'Photos not analysed yet', action: 'start', actionLabel: 'Analyse photos', target: 'analysis' });
  });

  it('protection details belong to the Scan once its photo list is read', () => {
    expect(scanView(null, null, NOW, 'tab').protectionKnown).toBe(false);
    expect(scanView(reading, null, NOW, 'tab').protectionKnown).toBe(false);
    expect(scanView(scanned, analysing, NOW, 'tab').protectionKnown).toBe(true);
    expect(scanView(scanned, null, NOW, 'tab').protectionKnown).toBe(true);
  });

  it('the Scan tab says where the step stands, as on the desktop', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanTabTitle(scanView(null, null, NOW, 'tab'))).toBe('1 · Scan (needed)');
    expect(scanTabTitle(scanView(reading, null, NOW, 'tab'))).toBe('1 · Scan (scanning)');
    expect(scanTabTitle(scanView(pauseJob(reading, 2_000), null, NOW, 'tab'))).toBe('1 · Scan (needed)');
    expect(scanTabTitle(scanView(scanned, analysing, NOW, 'tab'))).toBe('1 · Scan (scanning)');
    expect(scanTabTitle(scanView(scanned, pauseJob(analysing, 2), NOW, 'tab'))).toBe('1 · Scan (needed)');
    expect(scanTabTitle(scanView(scanned, done, NOW, 'tab'))).toBe('1 · Scan (done)');
    expect(scanTabTitle(scanView(scanned, done, NOW + 2 * 86_400_000, 'tab'))).toBe('1 · Scan (out of date)');
  });

  it('the browser tab shows the progress, so the Scan can be followed from any tab', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(documentTitle(scanView(reading, null, NOW, 'tab'))).toBe('Scanning… · Photo Cleaner');
    expect(documentTitle(scanView(scanned, analysing, NOW, 'tab'))).toBe('24% · Scanning · Photo Cleaner');
    expect(documentTitle(scanView(scanned, pauseJob(analysing, 2), NOW, 'tab'))).toBe('Scan paused · Photo Cleaner');
    expect(documentTitle(scanView(scanned, done, NOW, 'tab'))).toBe('Photo Cleaner');
  });

  it('names an account by its email when known, otherwise by its fingerprint', () => {
    expect(accountLabel('a1b2c3d4e5f60718', 'me@example.com')).toBe('me@example.com');
    expect(accountLabel('a1b2c3d4e5f60718', null)).toBe('account a1b2c3d4…');
  });
});

describe('the review tab', () => {
  const finishedScan = (account: string) => endJob(startScanJob(account, 0), 'completed', null, NOW);

  it('shows the account in its address, else the one signed in', () => {
    expect(reviewAccount('acc2', { fingerprint: 'acc1' })).toBe('acc2');
    expect(reviewAccount(null, { fingerprint: 'acc1' })).toBe('acc1');
    expect(reviewAccount(null, null)).toBeNull();
  });

  it('names the account, shows the version, labels the tabs and lists the other accounts with links', () => {
    const page = reviewPageView({
      selected: 'acc1', signedIn: { fingerprint: 'acc1', email: 'someone@example.com' },
      jobs: [finishedScan('acc1'), finishedScan('acc2-0123456789')], scan: finishedScan('acc1'), analysis: null, choices: ALL_PROTECTED, nowMs: NOW, version: '0.4.14',
    });
    expect(page.accountName).toBe('someone@example.com');
    expect(page.versionLabel).toBe('v0.4.14');
    expect(page.tabLabels).toEqual({ scan: '1 · Scan (needed)', duplicates: '2 · Duplicates', search: 'Search' });
    expect(page.otherAccounts).toEqual([{ account: 'acc2-0123456789', href: '?account=acc2-0123456789', label: 'account acc2-012…', scanTitle: 'Photos not analysed yet' }]);
  });

  it('builds the groups again only when a scan or the analysis finishes, or the choices change', () => {
    const input = { selected: 'acc1', signedIn: null, jobs: [], scan: finishedScan('acc1'), analysis: null, choices: ALL_PROTECTED, nowMs: NOW, version: '0.4.14' };
    const key = reviewPageView(input).refreshKey;
    expect(key).not.toBeNull();
    expect(reviewPageView({ ...input, nowMs: NOW + 1_000 }).refreshKey).toBe(key);
    expect(reviewPageView({ ...input, choices: { ...ALL_PROTECTED, favourites: false } }).refreshKey).not.toBe(key);
    expect(reviewPageView({ ...input, scan: endJob(startScanJob('acc1', 0), 'completed', null, NOW + 5) }).refreshKey).not.toBe(key);
    expect(reviewPageView({ ...input, choices: undefined }).refreshKey).toBeNull(); // still loading
    expect(reviewPageView({ ...input, selected: null }).accountName).toBeNull();
  });
});

describe('the popup and the panel', () => {
  it("say where things stand: still looking, no Google Photos, a tab that can't say, or the account", () => {
    expect(surfaceView(undefined)).toMatchObject({ state: 'looking', account: null, offerPhotos: false });
    expect(surfaceView({ account: null, problem: 'No Google Photos tab is open.', photosTabOpen: false, tabId: null }))
      .toMatchObject({ state: 'no-photos', problemText: 'No Google Photos tab is open.', offerPhotos: true });
    expect(surfaceView({ account: null, problem: 'Google Photos is signed out in this tab.', photosTabOpen: true, tabId: 3 }))
      .toMatchObject({ state: 'problem', problemText: 'Google Photos is signed out in this tab.', offerPhotos: true });
    expect(surfaceView({ account: { fingerprint: 'acc1', email: 'someone@example.com' }, problem: null, photosTabOpen: true, tabId: 3 }))
      .toEqual({ state: 'account', problemText: null, account: 'acc1', accountName: 'someone@example.com', offerPhotos: false, panelTab: 3 });
    // The panel is offered only with an account: a signed-out tab's panel would have nothing to show.
    expect(surfaceView({ account: null, problem: 'Google Photos is signed out in this tab.', photosTabOpen: true, tabId: 3 })).toMatchObject({ panelTab: null });
  });

  it('say why when the extension itself failed, not that no Google Photos tab is open', () => {
    expect(surfaceView({ account: null, problem: 'The extension is restarting; try again in a moment.', photosTabOpen: null, tabId: null }))
      .toMatchObject({ state: 'problem', problemText: 'The extension is restarting; try again in a moment.', offerPhotos: true });
  });
});

describe("the background's answer to which account is signed in", () => {
  it('is used as it is', () => {
    const answer = { account: { fingerprint: 'acc1', email: null }, problem: null, photosTabOpen: true, tabId: 3 };
    expect(accountAnswer(answer)).toBe(answer);
  });

  it('when the request failed, has no account and the error as its reason', () => {
    expect(accountAnswer({ error: 'Could not open the saved data.' })).toEqual({ account: null, problem: 'Could not open the saved data.', photosTabOpen: null, tabId: null });
  });

  it('when nobody answered, has no account and says the extension did not answer', () => {
    for (const reply of [undefined, null, true, {}]) {
      expect(accountAnswer(reply)).toEqual({ account: null, problem: expect.stringContaining('The extension did not answer'), photosTabOpen: null, tabId: null });
    }
  });
});

describe("the background's answer to Open Google Photos", () => {
  it('names the Photos tab', () => {
    expect(photosTabOf({ tabId: 3 })).toBe(3);
  });

  it('when the request failed, throws its error', () => {
    expect(() => photosTabOf({ error: 'Could not open the saved data.' })).toThrow('Could not open the saved data.');
  });

  it('when nobody answered, throws saying the extension did not answer', () => {
    for (const reply of [undefined, null, true, {}, { tabId: '3' }]) expect(() => photosTabOf(reply)).toThrow('The extension did not answer');
  });
});

describe("the popup's and the panel's button to the review tab", () => {
  const scanned = endJob(startScanJob('acc1', 0), 'completed', null, NOW);
  const summary = { account: 'acc1', groupsToReview: 1_731, atMs: NOW + 1_000, protection: ALL_PROTECTED };
  const toScan = { text: 'Open in tab', tab: 'scan' };

  it('offers the groups waiting, opening Duplicates, while that count can be trusted', () => {
    expect(launchButton(summary, scanned, null, ALL_PROTECTED, NOW + 2_000)).toEqual({ text: 'Review 1,731 groups', tab: 'duplicates' });
    expect(launchButton({ ...summary, groupsToReview: 1 }, scanned, null, ALL_PROTECTED, NOW + 2_000)).toEqual({ text: 'Review 1 group', tab: 'duplicates' });
  });

  it('opens the Scan tab when there is nothing to review or the count may be wrong', () => {
    const at = NOW + 2_000;
    expect(launchButton(null, scanned, null, ALL_PROTECTED, at)).toEqual(toScan);
    expect(launchButton({ ...summary, groupsToReview: 0 }, scanned, null, ALL_PROTECTED, at)).toEqual(toScan);
    expect(launchButton(summary, endJob(startScanJob('acc1', 0), 'completed', null, NOW + 5_000), null, ALL_PROTECTED, at)).toEqual(toScan); // scanned since
    expect(launchButton(summary, startScanJob('acc1', NOW + 1_500), null, ALL_PROTECTED, at)).toEqual(toScan); // scanning now
    expect(launchButton(summary, scanned, null, { ...ALL_PROTECTED, albums: false }, at)).toEqual(toScan); // other choices
    expect(launchButton(summary, scanned, null, ALL_PROTECTED, NOW + 25 * 3_600_000)).toEqual(toScan); // the scan is out of date
    expect(launchButton(summary, undefined, undefined, undefined, at)).toEqual(toScan); // still loading
  });
});

describe("the review tab's address", () => {
  it('names the account and the tab to open', () => {
    expect(reviewUrl('chrome-extension://x/review.html', 'acc 1', 'duplicates')).toBe('chrome-extension://x/review.html?account=acc%201#duplicates');
    expect(reviewUrl('chrome-extension://x/review.html', null, 'scan')).toBe('chrome-extension://x/review.html#scan');
  });

  it('is read back for the tab asked for, and nothing else', () => {
    expect(requestedReviewTab('#duplicates')).toBe('duplicates');
    expect(requestedReviewTab('#search')).toBe('search');
    expect(requestedReviewTab('')).toBeNull();
    expect(requestedReviewTab('#trash')).toBeNull();
  });
});

describe("the panel's address", () => {
  it('names its Photos tab, and is read back for it', () => {
    expect(panelOptions(42)).toEqual({ tabId: 42, path: 'panel.html?tab=42', enabled: true });
    expect(panelTab('?tab=42')).toBe(42);
  });

  it('naming no tab is a mistake, not a panel for some other tab', () => {
    for (const search of ['', '?tab=', '?tab=x', '?tab=0', '?tab=1.5']) expect(() => panelTab(search)).toThrow("The panel's address names no tab");
  });
});

describe('when the library was last checked', () => {
  it('says today and yesterday with the time, then how many days ago, then the date', () => {
    const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
    expect(checkedText(at(14, 9, 5), at(14, 21))).toBe('Checked today 09:05');
    expect(checkedText(at(13, 23, 50), at(14, 0, 10))).toBe('Checked yesterday 23:50'); // just before midnight
    expect(checkedText(at(8, 18), at(14, 9))).toBe('Checked 6 days ago');
    expect(checkedText(new Date(2026, 7, 1, 12).getTime(), at(14, 9))).toBe('Checked 1 Aug 2026');
  });
});
