import { describe, expect, it } from 'vitest';
import { NO_ANALYSIS } from '../../src/app/ai/analysis';
import { endJob, NO_PROGRESS, pauseJob, reportProgress, startAnalysisJob, startScanJob } from '../../src/app/shared/job';
import { accountLabel, documentTitle, scanTabTitle, scanView } from '../../src/app/shared/jobView';

const NOW = new Date(2026, 9, 14, 21, 40).getTime();

describe('one Scan in two stages', () => {
  const reading = reportProgress(
    startScanJob('acc1', 0),
    { ...NO_PROGRESS, phase: 'LIBRARY', libraryEntries: 12_500, albumsListed: 0, libraryReachedMs: Date.UTC(2021, 4, 3) },
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

  it('stage 1 reads the photo list: counts, how far back it has got, a bar without a measure', () => {
    const view = scanView(reading, null, NOW);
    expect(view).toMatchObject({ title: 'Scanning', stage: 'Stage 1 of 2 · Reading your photo list', action: 'pause', target: 'library-scan', indeterminate: true, percent: null });
    expect(view.lines[0]).toBe('Library: 12,500 entries, reached photos from 3 May 2021');
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
    expect(downloading.lines[0]).toBe('Downloading the AI model (once): 42% of about 290 MB');
    const view = scanView(scanned, analysing, NOW);
    expect(view).toMatchObject({ title: 'Scanning', stage: 'Stage 2 of 2 · Analysing new photos', percent: 24, action: 'pause', target: 'analysis', fullSpeed: false, indeterminate: false });
    expect(view.lines).toEqual(['New photos: 4,300 of 17,202 analysed', '5.7 photos/s over the last minute · about 38 min left', 'Detail 140']);
  });

  it('checking again counts only the new photos, not the whole library', () => {
    const again = reportProgress(analysing, { ...analysing.progress, analysed: 17_200, newPhotos: 3, newAnalysed: 1 }, 1);
    const view = scanView(scanned, again, NOW);
    expect(view.percent).toBe(33);
    expect(view.lines[0]).toBe('New photos: 1 of 3 analysed');
  });

  it('a paused or stopped stage 2 is resumed or tried again', () => {
    expect(scanView(scanned, pauseJob(analysing, 2), NOW)).toMatchObject({ title: 'Scan paused', action: 'resume', actionLabel: 'Resume', target: 'analysis', fullSpeed: false });
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

  it('after a day the scan is out of date: it no longer proves what is protected', () => {
    const done = endJob(reportProgress(analysing, { ...analysing.progress, analysed: 17_202 }, 2), 'completed', null, NOW);
    expect(scanView(scanned, done, NOW + 2 * 86_400_000)).toMatchObject({
      title: 'Scan out of date',
      lines: ['17,202 photos', 'Checked 14 Oct 2026 21:40'],
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
