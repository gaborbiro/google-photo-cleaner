import { describe, expect, it } from 'vitest';
import { NO_ANALYSIS } from '../../src/app/ai/analysis';
import { endJob, NO_PROGRESS, pauseJob, reportProgress, startAnalysisJob, startScanJob } from '../../src/app/shared/job';
import { accountLabel, analysisView, jobView } from '../../src/app/shared/jobView';

describe('what the surfaces show for a scan', () => {
  const running = reportProgress(
    startScanJob('acc1', 0),
    { ...NO_PROGRESS, phase: 'LIBRARY', libraryEntries: 12_500, albumsListed: 0, libraryReachedMs: Date.UTC(2021, 4, 3) },
    1_000,
  );

  it('offers to scan when nothing has run yet', () => {
    expect(jobView(null)).toMatchObject({ title: 'Not scanned yet', action: 'start', actionLabel: 'Scan library', lines: [] });
  });

  it('shows the phase, the counts and how far back the library has been read', () => {
    const view = jobView(running);
    expect(view).toMatchObject({ title: 'Scanning: library', action: 'pause', actionLabel: 'Pause' });
    expect(view.lines[0]).toBe('Library: 12,500 entries, reached photos from 3 May 2021');
  });

  it('offers Resume when paused, with the reason', () => {
    const view = jobView(endJob(running, 'paused', 'The session ended.', 2_000));
    expect(view).toMatchObject({ action: 'resume', actionLabel: 'Resume scan', notice: 'The session ended.' });
    expect(jobView(pauseJob(running, 2_000)).action).toBe('resume');
  });

  it('offers to scan again when finished, and a new scan when failed', () => {
    expect(jobView(endJob(running, 'completed', null, 2_000))).toMatchObject({ title: 'Scan complete', action: 'restart', actionLabel: 'Scan again' });
    expect(jobView(endJob(running, 'failed', 'Not understood.', 2_000))).toMatchObject({ title: 'Scan failed', actionLabel: 'Start a new scan' });
  });

  it('says "1 entry", not "1 entries"', () => {
    const view = jobView(reportProgress(startScanJob('acc1', 0), { ...NO_PROGRESS, favouriteEntries: 1, archiveEntries: 2 }, 1_000));
    expect(view.lines[1]).toBe('Favourite photos: 1 entry');
    expect(view.lines[2]).toBe('Archived photos: 2 entries');
  });

  it('names an account by its email when known, otherwise by its fingerprint', () => {
    expect(accountLabel('a1b2c3d4e5f60718', 'me@example.com')).toBe('me@example.com');
    expect(accountLabel('a1b2c3d4e5f60718', null)).toBe('account a1b2c3d4…');
  });
});

describe('what the surfaces show for the analysis', () => {
  const job = startAnalysisJob('acc1', 0, null, NO_ANALYSIS);

  it('before the scan finished there is nothing to press; after it, Analyse photos', () => {
    expect(analysisView(null, false)).toMatchObject({ title: 'Analysis follows the library scan', action: null });
    expect(analysisView(null, true)).toMatchObject({ action: 'start', actionLabel: 'Analyse photos' });
  });

  it('shows the model download, then progress, speed and time left', () => {
    const downloading = analysisView(reportProgress(job, { ...NO_ANALYSIS, stage: 'model', modelPercent: 42, photos: 17_202 }, 1), true);
    expect(downloading.lines[0]).toBe('Downloading the AI model (once): 42% of about 290 MB');
    expect(downloading.percent).toBe(42); // the bar fills for the download first
    const perPhotoMs = { other: 4.2, pace: 0, preview: 12.6, ai: 160.4, save: 7 };
    const view = analysisView(reportProgress(job, { ...NO_ANALYSIS, stage: 'analysing', photos: 17_202, analysed: 4_300, photosPerSecond: 5.7, etaSeconds: 2_265, perPhotoMs, detail: 140 }, 1), true);
    expect(view).toMatchObject({ title: 'Analysing photos', percent: 24, action: 'pause' });
    expect(view.lines).toEqual([
      'Analysed 4,300 of 17,202 photos',
      '5.7 photos/s over the last minute · about 38 min left',
      'Per photo (ms): AI 160 · preview 13 · save 7 · gentle 0 · other 4',
      'Detail 140',
    ]);
  });

  it('offers to analyse new photos once done', () => {
    expect(analysisView(endJob(job, 'completed', null, 1), true)).toMatchObject({ title: 'All photos analysed', actionLabel: 'Analyse new photos' });
  });
});
