// Background jobs, one of each kind per Google account, as saved in the browser database. The
// surfaces show them and change their status; the background page does the work and saves its
// progress. A finished library scan starts the analysis, so one Scan does both.

import type { AnalysisProgress } from '../ai/analysis';
import type { ScanProgress } from '../scan/session';

/**
 * running: the background page works on it. paused: by the user, or by a problem they can fix
 * (see the progress notice); resumable. finished: done. failed: needs an extension update.
 */
export type JobStatus = 'running' | 'paused' | 'finished' | 'failed';

interface JobBase {
  /** `${kind}:${account}`. */
  id: string;
  /** Account fingerprint (never the email). */
  account: string;
  status: JobStatus;
  startedAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
}

export interface ScanJob extends JobBase {
  kind: 'library-scan';
  progress: ScanProgress;
}

export interface AnalysisJob extends JobBase {
  kind: 'analysis';
  progress: AnalysisProgress;
  /** Off: gentle (slower while the computer is in use, waits on battery). On: as fast as it goes. */
  fullSpeed: boolean;
}

export type Job = ScanJob | AnalysisJob;
export type JobKind = Job['kind'];

export const NO_PROGRESS: ScanProgress = {
  phase: null,
  libraryEntries: 0,
  favouriteEntries: 0,
  archiveEntries: 0,
  albumsListed: 0,
  albumsRead: 0,
  albumsFailed: 0,
  libraryReachedMs: null,
  notice: null,
};

export function jobId(kind: JobKind, account: string): string {
  return `${kind}:${account}`;
}

function base(kind: JobKind, account: string, nowMs: number): JobBase {
  if (!account) throw new Error('A job needs an account');
  return { id: jobId(kind, account), account, status: 'running', startedAtMs: nowMs, updatedAtMs: nowMs, finishedAtMs: null };
}

/** A fresh scan, started now; replaces a finished, failed or paused one. */
export function startScanJob(account: string, nowMs: number): ScanJob {
  return { ...base('library-scan', account, nowMs), kind: 'library-scan', progress: NO_PROGRESS };
}

/**
 * The analysis, (re)started now. It keeps the full-speed choice and the speed check's words of
 * a previous run; the photos already analysed are skipped by the analysis itself.
 */
export function startAnalysisJob(account: string, nowMs: number, previous: AnalysisJob | null, noProgress: AnalysisProgress): AnalysisJob {
  return {
    ...base('analysis', account, nowMs),
    kind: 'analysis',
    progress: { ...noProgress, speedCheckText: previous?.progress.speedCheckText ?? null, detail: previous?.progress.detail ?? null },
    fullSpeed: previous?.fullSpeed ?? false,
  };
}

export function pauseJob<J extends Job>(job: J, nowMs: number): J {
  return job.status === 'running' ? { ...job, status: 'paused', updatedAtMs: nowMs } : job;
}

export function resumeJob<J extends Job>(job: J, nowMs: number): J {
  return job.status === 'paused' ? { ...job, status: 'running', progress: { ...job.progress, notice: null }, updatedAtMs: nowMs } : job;
}

/** New progress from the background page; ignored once the job is no longer running. */
export function reportProgress<J extends Job>(job: J, progress: J['progress'], nowMs: number): J {
  return job.status === 'running' ? { ...job, progress, updatedAtMs: nowMs } : job;
}

/** How the background page's run ended. A user pause has already been saved and stays as it is. */
export function endJob<J extends Job>(job: J, outcome: 'completed' | 'paused' | 'failed', notice: string | null, nowMs: number): J {
  if (job.status !== 'running') return job;
  const progress = { ...job.progress, notice };
  switch (outcome) {
    case 'completed':
      return { ...job, status: 'finished', progress, updatedAtMs: nowMs, finishedAtMs: nowMs };
    case 'paused':
      return { ...job, status: 'paused', progress, updatedAtMs: nowMs };
    case 'failed':
      return { ...job, status: 'failed', progress, updatedAtMs: nowMs, finishedAtMs: nowMs };
  }
}

export function setFullSpeed(job: AnalysisJob, fullSpeed: boolean, nowMs: number): AnalysisJob {
  return { ...job, fullSpeed, updatedAtMs: nowMs };
}
