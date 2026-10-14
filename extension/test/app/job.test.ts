import { describe, expect, it } from 'vitest';
import { endJob, jobId, NO_PROGRESS, pauseJob, reportProgress, resumeJob, startJob } from '../../src/app/shared/job';

const progress = { ...NO_PROGRESS, phase: 'LIBRARY' as const, libraryEntries: 500 };

describe('job life cycle', () => {
  const started = startJob('library-scan', 'acc1', 1_000);

  it('starts running with no progress, labelled with its account', () => {
    expect(started).toMatchObject({ id: jobId('library-scan', 'acc1'), account: 'acc1', status: 'running', progress: NO_PROGRESS, finishedAtMs: null });
  });

  it('takes progress only while running', () => {
    expect(reportProgress(started, progress, 2_000)).toMatchObject({ progress, updatedAtMs: 2_000 });
    const paused = pauseJob(started, 2_000);
    expect(reportProgress(paused, progress, 3_000)).toBe(paused);
  });

  it("keeps the user's pause when the background run ends afterwards", () => {
    const paused = pauseJob(reportProgress(started, progress, 2_000), 2_500);
    expect(endJob(paused, 'completed', null, 3_000)).toBe(paused);
  });

  it('ends as finished, paused with the reason, or failed', () => {
    expect(endJob(started, 'completed', null, 3_000)).toMatchObject({ status: 'finished', finishedAtMs: 3_000 });
    expect(endJob(started, 'paused', 'Google is limiting requests.', 3_000)).toMatchObject({ status: 'paused', progress: { notice: 'Google is limiting requests.' }, finishedAtMs: null });
    expect(endJob(started, 'failed', 'Not understood.', 3_000)).toMatchObject({ status: 'failed', finishedAtMs: 3_000 });
  });

  it("resuming clears the last stop's notice", () => {
    const paused = endJob(started, 'paused', 'The session ended.', 3_000);
    expect(resumeJob(paused, 4_000)).toMatchObject({ status: 'running', progress: { notice: null } });
  });

  it('refuses a job without an account', () => {
    expect(() => startJob('library-scan', '', 0)).toThrow();
  });
});
