import { describe, expect, it } from 'vitest';
import { NO_ANALYSIS } from '../../src/app/ai/analysis';
import { endJob, NO_PROGRESS, pauseJob, reportProgress, setFullSpeed, startAnalysisJob, startScanJob } from '../../src/app/shared/job';
import { accountLabel, checkedText, documentTitle, reviewAccount, reviewButtonText, reviewPageView, scanTabTitle, scanView, surfaceView } from '../../src/app/shared/jobView';
import { ALL_PROTECTED } from '../../src/app/shared/preferences';

const NOW = new Date(2026, 9, 14, 21, 40).getTime();

describe('one Scan in two stages', () => {
  const reading = reportProgress(
    startScanJob('acc1', 0),
    { ...NO_PROGRESS, phase: 'LIBRARY', libraryEntries: 12_500, albumsListed: 0, libraryReachedMs: new Date(2021, 4, 3).getTime() },
    1_000,
  );
  const scanned = endJob(reading, 'completed', null, NOW);
  const analysing = reportProgress(
    startAnalysisJob('acc1', 0, null, NO_ANALYSIS),
    { ...NO_ANALYSIS, stage: 'analysing', photos: 17_202, analysed: 4_300, newPhotos: 17_202, newAnalysed: 4_300, photosPerSecond: 5.7, etaSeconds: 2_265, detail: 140 },
    1,
  );

  it('offers to scan when nothing has run yet', () => {
    expect(scanView(null, null, NOW)).toMatchObject({ title: 'Not scanned yet', action: 'start', actionLabel: 'Scan library', target: 'library-scan', lines: [], stage: null, fullSpeed: null });
  });

  it('shows both steps before starting, with the speed choice in analysis only', () => {
    const [library, analysis] = scanView(null, null, NOW).steps;
    expect(library).toMatchObject({ number: 1, title: 'Read your library', state: 'pending', statusText: 'Not started', protectionKnown: false, fullSpeed: null });
    expect(analysis).toMatchObject({ number: 2, title: 'Analyse photos', state: 'pending', statusText: 'Not started', fullSpeed: false, waiting: 'Starts automatically after step 1.' });
  });

  it('keeps library counts and protection in step 1 while step 2 analyses', () => {
    const [library, analysis] = scanView(scanned, analysing, NOW).steps;
    expect(library).toMatchObject({ state: 'complete', statusText: 'Complete', protectionKnown: true, percent: null, fullSpeed: null, timesText: 'Checked today 21:40' });
    expect(library.lines).toEqual([]); // The final counts are supplied by the protection report.
    expect(analysis).toMatchObject({ state: 'running', statusText: 'In progress', percent: 24, fullSpeed: false, protectionKnown: false });
    expect(library.detailText).toBe('Detail 140'); // Shown beside the protection details' scan times.
    expect(analysis.detailText).toBeNull();
    expect(analysis.lines[0]).toBe('New photos: 4,300 of 17,202 analysed');
  });

  it('does not present a previous analysis or protection report as the new scan completing', () => {
    const previous = endJob(setFullSpeed(analysing, true, NOW), 'completed', null, NOW);
    const [library, analysis] = scanView(reading, previous, NOW).steps;
    expect(library).toMatchObject({ state: 'running', protectionKnown: false, indeterminate: true });
    expect(analysis).toMatchObject({ state: 'pending', statusText: 'Up next', fullSpeed: true, percent: null });
    expect(analysis.lines).toEqual([]);
    expect(library.detailText).toBe('Detail 140');
  });

  it('keeps analysis detail after completion and flags an old library separately', () => {
    const done = endJob(analysing, 'completed', null, NOW);
    const [library, analysis] = scanView(scanned, done, NOW + 2 * 86_400_000).steps;
    expect(library).toMatchObject({ state: 'stale', statusText: 'Needs a refresh', protectionKnown: true });
    expect(library.notice).toContain('before anything can be trashed');
    expect(analysis).toMatchObject({ state: 'complete', statusText: 'Complete', fullSpeed: false });
    expect(library.detailText).toBe('Detail 140');
    expect(analysis.notice).toBeNull();
  });

  it.each(['paused', 'failed'] as const)('shows which step is %s without changing the other step', (state) => {
    const libraryStopped = scanView(endJob(reading, state, 'Library problem.', NOW), analysing, NOW).steps;
    expect(libraryStopped[0]).toMatchObject({ state, notice: 'Library problem.' });
    expect(libraryStopped[1]).toMatchObject({ state: 'pending', notice: null });
    const analysisStopped = scanView(scanned, endJob(analysing, state, 'Analysis problem.', NOW), NOW).steps;
    expect(analysisStopped[0]).toMatchObject({ state: 'complete', notice: null });
    expect(analysisStopped[1]).toMatchObject({ state, notice: 'Analysis problem.' });
  });

  it('stage 1 reads the photo list: counts, how far back it has got, a bar without a measure', () => {
    const view = scanView(reading, null, NOW);
    expect(view).toMatchObject({ title: 'Scanning', stage: 'Stage 1 of 2 · Reading your photo list', action: 'pause', target: 'library-scan', indeterminate: true, percent: null, fullSpeed: false });
    expect(view.lines[0]).toBe('Library: 12,500 entries, reached photos from 3 May 2021');
  });

  it('full speed stays visible and keeps its choice across both stages and pauses', () => {
    const fullSpeed = setFullSpeed(analysing, true, NOW);
    const previous = endJob(fullSpeed, 'completed', null, NOW);
    expect(scanView(reading, previous, NOW).fullSpeed).toBe(true);
    expect(scanView(pauseJob(reading, NOW), fullSpeed, NOW).fullSpeed).toBe(true);
    expect(scanView(scanned, null, NOW).fullSpeed).toBe(false);
    for (const stage of ['model', 'speed-check', 'analysing'] as const) {
      const job = reportProgress(fullSpeed, { ...fullSpeed.progress, stage }, NOW);
      expect(scanView(scanned, job, NOW).fullSpeed).toBe(true);
      expect(scanView(scanned, pauseJob(job, NOW), NOW).fullSpeed).toBe(true);
    }
  });

  it('a paused or stopped stage 1 is resumed or started again', () => {
    expect(scanView(endJob(reading, 'paused', 'The session ended.', 2_000), null, NOW)).toMatchObject({ title: 'Scan paused', action: 'resume', actionLabel: 'Resume', target: 'library-scan', notice: 'The session ended.', indeterminate: false });
    expect(scanView(pauseJob(reading, 2_000), null, NOW).action).toBe('resume');
    expect(scanView(endJob(reading, 'failed', 'Not understood.', 2_000), null, NOW)).toMatchObject({ title: 'Scan stopped', actionLabel: 'Start a new scan', target: 'library-scan' });
  });

  it('says "1 entry", not "1 entries"', () => {
    const view = scanView(reportProgress(startScanJob('acc1', 0), { ...NO_PROGRESS, favouriteEntries: 1, archiveEntries: 2 }, 1_000), null, NOW);
    expect(view.lines[1]).toBe('Favourite photos: 1 entry');
    expect(view.lines[2]).toBe('Archived photos: 2 entries');
  });

  it('stage 2 analyses the new photos: the bar fills for the model download, then for the photos', () => {
    const downloading = scanView(scanned, reportProgress(analysing, { ...NO_ANALYSIS, stage: 'model', modelPercent: 42, photos: 17_202 }, 1), NOW);
    expect(downloading).toMatchObject({ title: 'Scanning', stage: 'Stage 2 of 2 · Getting the AI model ready (once)', percent: 42, target: 'analysis' });
    expect(downloading.lines[0]).toBe('Downloading the AI model (once): 42% of about 320 MB');
    const view = scanView(scanned, analysing, NOW);
    expect(view).toMatchObject({ title: 'Scanning', stage: 'Stage 2 of 2 · Analysing new photos', percent: 24, action: 'pause', target: 'analysis', fullSpeed: false, indeterminate: false });
    expect(view.lines).toEqual(['New photos: 4,300 of 17,202 analysed', '5.7 photos/s over the last minute · about 38 min left']);
    expect(view.steps[0].detailText).toBe('Detail 140');
  });

  it('checking again counts only the new photos, not the whole library', () => {
    const again = reportProgress(analysing, { ...analysing.progress, analysed: 17_200, newPhotos: 3, newAnalysed: 1 }, 1);
    const view = scanView(scanned, again, NOW);
    expect(view.percent).toBe(33);
    expect(view.lines[0]).toBe('New photos: 1 of 3 analysed');
  });

  it('a paused or stopped stage 2 is resumed or tried again', () => {
    const paused = scanView(scanned, pauseJob(analysing, 2), NOW);
    expect(paused).toMatchObject({ title: 'Scan paused', action: 'resume', actionLabel: 'Resume', target: 'analysis', fullSpeed: false });
    expect(paused.steps[1].statusText).toBe('Paused');
    const resumed = scanView(scanned, analysing, NOW);
    expect(resumed.actionLabel).toBe('Pause');
    expect(resumed.steps[1].statusText).toBe('In progress');
    expect(scanView(scanned, endJob(analysing, 'failed', 'Broken.', 2), NOW)).toMatchObject({ title: 'Scan stopped', actionLabel: 'Try again', target: 'analysis' });
  });

  it('once both stages are done the scan is complete, and offers to check for new photos', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, done, NOW + 3_600_000)).toMatchObject({
      title: 'Scan complete', stage: null, percent: null, fullSpeed: null, notice: null,
      lines: ['17,202 photos · ready to review', 'Checked today 21:40'],
      action: 'restart', actionLabel: 'Check for new photos', target: 'library-scan',
    });
    const withFailures = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_200, failed: 2 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, withFailures, NOW).lines[0]).toBe('17,202 photos · 2 could not be read (tried again next time)');
  });

  it('the status dot: green when complete, amber when paused or out of date, red when stopped, none while scanning', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, done, NOW).tone).toBe('positive');
    expect(scanView(scanned, done, NOW + 2 * 86_400_000).tone).toBe('caution');
    expect(scanView(endJob(reading, 'paused', null, 2_000), null, NOW).tone).toBe('caution');
    expect(scanView(scanned, pauseJob(analysing, 2), NOW).tone).toBe('caution');
    expect(scanView(endJob(reading, 'failed', 'Not understood.', 2_000), null, NOW).tone).toBe('negative');
    expect(scanView(scanned, endJob(analysing, 'failed', 'Broken.', 2), NOW).tone).toBe('negative');
    expect(scanView(reading, null, NOW).tone).toBeNull();
    expect(scanView(scanned, analysing, NOW).tone).toBeNull();
    expect(scanView(null, null, NOW).tone).toBeNull();
  });

  it('after a day the scan is out of date: it no longer proves what is protected', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, done, NOW + 2 * 86_400_000)).toMatchObject({
      title: 'Scan out of date',
      lines: ['17,202 photos', 'Checked 2 days ago'],
      notice: 'More than a day old: check for new photos before anything can be trashed.',
      actionLabel: 'Check for new photos',
    });
  });

  it('a photo list read without an analysis yet offers to analyse', () => {
    expect(scanView(scanned, null, NOW)).toMatchObject({ title: 'Photos not analysed yet', action: 'start', actionLabel: 'Analyse photos', target: 'analysis' });
  });

  it('protection details belong to the Scan once its photo list is read', () => {
    expect(scanView(null, null, NOW).protectionKnown).toBe(false);
    expect(scanView(reading, null, NOW).protectionKnown).toBe(false);
    expect(scanView(scanned, analysing, NOW).protectionKnown).toBe(true);
    expect(scanView(scanned, null, NOW).protectionKnown).toBe(true);
  });

  it('the Scan tab says where the step stands, as on the desktop', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanTabTitle(scanView(null, null, NOW))).toBe('1 · Scan (needed)');
    expect(scanTabTitle(scanView(reading, null, NOW))).toBe('1 · Scan (scanning)');
    expect(scanTabTitle(scanView(pauseJob(reading, 2_000), null, NOW))).toBe('1 · Scan (needed)');
    expect(scanTabTitle(scanView(scanned, analysing, NOW))).toBe('1 · Scan (scanning)');
    expect(scanTabTitle(scanView(scanned, pauseJob(analysing, 2), NOW))).toBe('1 · Scan (needed)');
    expect(scanTabTitle(scanView(scanned, done, NOW))).toBe('1 · Scan (done)');
    expect(scanTabTitle(scanView(scanned, done, NOW + 2 * 86_400_000))).toBe('1 · Scan (out of date)');
  });

  it('the browser tab shows the progress, so the Scan can be followed from any tab', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(documentTitle(scanView(reading, null, NOW))).toBe('Scanning… · Photo Cleaner');
    expect(documentTitle(scanView(scanned, analysing, NOW))).toBe('24% · Scanning · Photo Cleaner');
    expect(documentTitle(scanView(scanned, pauseJob(analysing, 2), NOW))).toBe('Scan paused · Photo Cleaner');
    expect(documentTitle(scanView(scanned, done, NOW))).toBe('Photo Cleaner');
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

  it('names the account, labels the tabs and lists the other accounts with links', () => {
    const page = reviewPageView({
      selected: 'acc1', signedIn: { fingerprint: 'acc1', email: 'someone@example.com' },
      jobs: [finishedScan('acc1'), finishedScan('acc2-0123456789')], scan: finishedScan('acc1'), analysis: null, choices: ALL_PROTECTED, nowMs: NOW,
    });
    expect(page.accountName).toBe('someone@example.com');
    expect(page.tabLabels).toEqual({ scan: '1 · Scan (needed)', duplicates: '2 · Duplicates', search: 'Search' });
    expect(page.otherAccounts).toEqual([{ account: 'acc2-0123456789', href: '?account=acc2-0123456789', label: 'account acc2-012…', scanTitle: 'Photos not analysed yet' }]);
  });

  it('builds the groups again only when a scan or the analysis finishes, or the choices change', () => {
    const input = { selected: 'acc1', signedIn: null, jobs: [], scan: finishedScan('acc1'), analysis: null, choices: ALL_PROTECTED, nowMs: NOW };
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
    expect(surfaceView(undefined)).toMatchObject({ state: 'looking', account: null });
    expect(surfaceView({ account: null, problem: 'No Google Photos tab is open.', photosTabOpen: false })).toMatchObject({ state: 'no-photos', problemText: 'No Google Photos tab is open.' });
    expect(surfaceView({ account: null, problem: 'Google Photos is signed out in this tab.', photosTabOpen: true })).toMatchObject({ state: 'problem', problemText: 'Google Photos is signed out in this tab.' });
    expect(surfaceView({ account: { fingerprint: 'acc1', email: 'someone@example.com' }, problem: null, photosTabOpen: true }))
      .toEqual({ state: 'account', problemText: null, account: 'acc1', accountName: 'someone@example.com' });
  });
});

describe("the popup's review button", () => {
  const scanned = endJob(startScanJob('acc1', 0), 'completed', null, NOW);
  const summary = { account: 'acc1', groupsToReview: 1_731, atMs: NOW + 1_000, protection: ALL_PROTECTED };

  it('says how many groups wait, while that count can be trusted', () => {
    expect(reviewButtonText(summary, scanned, null, ALL_PROTECTED, NOW + 2_000)).toBe('Review 1,731 groups');
    expect(reviewButtonText({ ...summary, groupsToReview: 1 }, scanned, null, ALL_PROTECTED, NOW + 2_000)).toBe('Review 1 group');
  });

  it('is left out when there is nothing to review or the count may be wrong', () => {
    const at = NOW + 2_000;
    expect(reviewButtonText(null, scanned, null, ALL_PROTECTED, at)).toBeNull();
    expect(reviewButtonText({ ...summary, groupsToReview: 0 }, scanned, null, ALL_PROTECTED, at)).toBeNull();
    expect(reviewButtonText(summary, endJob(startScanJob('acc1', 0), 'completed', null, NOW + 5_000), null, ALL_PROTECTED, at)).toBeNull(); // scanned since
    expect(reviewButtonText(summary, startScanJob('acc1', NOW + 1_500), null, ALL_PROTECTED, at)).toBeNull(); // scanning now
    expect(reviewButtonText(summary, scanned, null, { ...ALL_PROTECTED, albums: false }, at)).toBeNull(); // other choices
    expect(reviewButtonText(summary, scanned, null, ALL_PROTECTED, NOW + 25 * 3_600_000)).toBeNull(); // the scan is out of date
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
