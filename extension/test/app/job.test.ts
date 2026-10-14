import { describe, expect, it } from 'vitest';
import { advanceJob, jobId, pauseJob, resumeJob, startJob } from '../../src/app/shared/job';

describe('job life cycle', () => {
  const started = startJob('pretend-scan', 'acc1', 3, 1_000);

  it('starts running from zero, labelled with its account', () => {
    expect(started).toMatchObject({ id: jobId('pretend-scan', 'acc1'), account: 'acc1', status: 'running', done: 0, total: 3, finishedAtMs: null });
  });

  it('finishes on its last step and goes no further', () => {
    const done = advanceJob(advanceJob(advanceJob(started, 1, 2_000), 1, 3_000), 1, 4_000);
    expect(done).toMatchObject({ status: 'finished', done: 3, finishedAtMs: 4_000 });
    expect(advanceJob(done, 1, 5_000)).toBe(done);
  });

  it('does not move while paused, and continues where it stopped after resuming', () => {
    const paused = pauseJob(advanceJob(started, 1, 2_000), 2_500);
    expect(advanceJob(paused, 1, 3_000)).toBe(paused);
    const resumed = resumeJob(paused, 4_000);
    expect(resumed).toMatchObject({ status: 'running', done: 1 });
    expect(advanceJob(resumed, 1, 5_000).done).toBe(2);
  });

  it('ignores pause and resume when they do not apply', () => {
    const finished = advanceJob(started, 3, 2_000);
    expect(pauseJob(finished, 3_000)).toBe(finished);
    expect(resumeJob(started, 3_000)).toBe(started);
  });

  it('refuses a job without an account or without work', () => {
    expect(() => startJob('pretend-scan', '', 3, 0)).toThrow();
    expect(() => startJob('pretend-scan', 'acc1', 0, 0)).toThrow();
  });
});
