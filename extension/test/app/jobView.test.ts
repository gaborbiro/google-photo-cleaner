import { describe, expect, it } from 'vitest';
import { advanceJob, pauseJob, startJob } from '../../src/app/shared/job';
import { accountLabel, jobView } from '../../src/app/shared/jobView';

describe('what the surfaces show', () => {
  it('offers to scan when nothing has run yet', () => {
    expect(jobView(null)).toMatchObject({ title: 'Not scanned yet', action: 'start', actionLabel: 'Scan', progressText: null });
  });

  it('shows progress and Pause while running', () => {
    const job = advanceJob(startJob('pretend-scan', 'acc1', 400, 0), 124, 1_000);
    expect(jobView(job)).toMatchObject({ action: 'pause', actionLabel: 'Pause', percent: 31, progressText: '124 of 400 · 31%' });
  });

  it('offers Resume when paused and Scan again when finished', () => {
    const job = startJob('pretend-scan', 'acc1', 400, 0);
    expect(jobView(pauseJob(job, 1)).action).toBe('resume');
    expect(jobView(advanceJob(job, 400, 2))).toMatchObject({ action: 'restart', actionLabel: 'Scan again', percent: 100 });
  });

  it('names an account by its email when known, otherwise by its fingerprint', () => {
    expect(accountLabel('a1b2c3d4e5f60718', 'me@example.com')).toBe('me@example.com');
    expect(accountLabel('a1b2c3d4e5f60718', null)).toBe('account a1b2c3d4…');
  });
});
