import { describe, expect, it } from 'vitest';
import { NO_ANALYSIS } from '../../src/app/ai/analysis';
import { endJob, jobId, NO_PROGRESS, pauseJob, reportProgress, resumeIfWaitingForPhotos, resumeJob, setFullSpeed, startAnalysisJob, startScanJob } from '../../src/app/shared/job';

const progress = { ...NO_PROGRESS, phase: 'LIBRARY' as const, libraryEntries: 500 };

describe('job life cycle', () => {
  const started = startScanJob('acc1', 1_000);

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

  it("resuming clears Google's details behind the last stop, so an old problem isn't reported again", () => {
    const problem = { where: 'scan: library', kind: 'PROTOCOL' as const, message: 'Library item has 18 fields, expected 16 or 17', rpcCode: null, httpStatus: null };
    const stopped = endJob(reportProgress(started, { ...progress, googleProblem: problem }, 2_000), 'paused', 'Not understood.', 3_000);
    expect(stopped.progress.googleProblem).toEqual(problem);
    expect(resumeJob(stopped, 4_000).progress.googleProblem).toBeNull();
  });

  it('a job paused for want of Google Photos carries on when Photos of its account is back, and only then', () => {
    const waiting = endJob(started, 'paused', 'Google Photos was closed.', 3_000, true);
    expect(waiting).toMatchObject({ status: 'paused', resumeWhenPhotosOpen: true });
    expect(resumeIfWaitingForPhotos(waiting, 'acc2', 4_000)).toBe(waiting); // another account's Photos
    expect(resumeIfWaitingForPhotos(waiting, waiting.account, 4_000)).toMatchObject({ status: 'running', resumeWhenPhotosOpen: false, progress: { notice: null } });
    // Paused by the user, or by anything else (e.g. rate limits): it waits for the user.
    expect(resumeIfWaitingForPhotos(pauseJob(started, 3_000), started.account, 4_000).status).toBe('paused');
    expect(resumeIfWaitingForPhotos(endJob(started, 'paused', 'Google is limiting requests.', 3_000), started.account, 4_000).status).toBe('paused');
    // The user pausing a waiting job keeps it paused even when Photos comes back.
    expect(resumeIfWaitingForPhotos(pauseJob(waiting, 3_500), waiting.account, 4_000).status).toBe('paused');
  });

  it('refuses a job without an account', () => {
    expect(() => startScanJob('', 0)).toThrow();
  });
});

describe('analysis job', () => {
  it('a new run keeps the full-speed choice and what the speed check said', () => {
    const first = setFullSpeed(startAnalysisJob('acc1', 0, null, NO_ANALYSIS), true, 1);
    const withCheck = reportProgress(first, { ...first.progress, speedCheckText: 'Speed check: 5.7 photos/s', detail: 140 }, 2);
    const next = startAnalysisJob('acc1', 3, endJob(withCheck, 'completed', null, 2), NO_ANALYSIS);
    expect(next).toMatchObject({ kind: 'analysis', status: 'running', fullSpeed: true, progress: { speedCheckText: 'Speed check: 5.7 photos/s', detail: 140, analysed: 0 } });
  });

  it('scan and analysis jobs of one account have separate ids', () => {
    expect(startScanJob('acc1', 0).id).not.toBe(startAnalysisJob('acc1', 0, null, NO_ANALYSIS).id);
  });
});
