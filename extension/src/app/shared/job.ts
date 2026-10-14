// A background job for one Google account, as saved in the browser database. The surfaces
// show it and change its status; the background page does the work and saves its progress.

import type { ScanProgress } from '../scan/session';

export type JobKind = 'library-scan';
/**
 * running: the background page works on it. paused: by the user, or by a problem they can fix
 * (see notice); resumable. finished: done. failed: needs an extension update; scan again later.
 */
export type JobStatus = 'running' | 'paused' | 'finished' | 'failed';

export interface Job {
  /** `${kind}:${account}`: one job of each kind per account. */
  id: string;
  kind: JobKind;
  /** Account fingerprint (never the email). */
  account: string;
  status: JobStatus;
  progress: ScanProgress;
  startedAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
}

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

/** A fresh job, started now. Starting again replaces a finished, failed or paused one. */
export function startJob(kind: JobKind, account: string, nowMs: number): Job {
  if (!account) throw new Error('A job needs an account');
  return { id: jobId(kind, account), kind, account, status: 'running', progress: NO_PROGRESS, startedAtMs: nowMs, updatedAtMs: nowMs, finishedAtMs: null };
}

export function pauseJob(job: Job, nowMs: number): Job {
  return job.status === 'running' ? { ...job, status: 'paused', updatedAtMs: nowMs } : job;
}

export function resumeJob(job: Job, nowMs: number): Job {
  return job.status === 'paused' ? { ...job, status: 'running', progress: { ...job.progress, notice: null }, updatedAtMs: nowMs } : job;
}

/** New progress from the background page; ignored once the job is no longer running. */
export function reportProgress(job: Job, progress: ScanProgress, nowMs: number): Job {
  return job.status === 'running' ? { ...job, progress, updatedAtMs: nowMs } : job;
}

/** How the background page's run ended. A user pause has already been saved and stays as it is. */
export function endJob(job: Job, outcome: 'completed' | 'paused' | 'failed', notice: string | null, nowMs: number): Job {
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
