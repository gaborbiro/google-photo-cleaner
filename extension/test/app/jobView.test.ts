import { describe, expect, it } from 'vitest';
import { endJob, NO_PROGRESS, pauseJob, reportProgress, startJob } from '../../src/app/shared/job';
import { accountLabel, jobView } from '../../src/app/shared/jobView';

describe('what the surfaces show for a scan', () => {
  const running = reportProgress(
    startJob('library-scan', 'acc1', 0),
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
    const view = jobView(reportProgress(startJob('library-scan', 'acc1', 0), { ...NO_PROGRESS, favouriteEntries: 1, archiveEntries: 2 }, 1_000));
    expect(view.lines[1]).toBe('Favourite photos: 1 entry');
    expect(view.lines[2]).toBe('Archived photos: 2 entries');
  });

  it('names an account by its email when known, otherwise by its fingerprint', () => {
    expect(accountLabel('a1b2c3d4e5f60718', 'me@example.com')).toBe('me@example.com');
    expect(accountLabel('a1b2c3d4e5f60718', null)).toBe('account a1b2c3d4…');
  });
});
