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
  /**
   * Paused only because Google Photos was closed or signed out: it carries on by itself when a
   * Photos tab of this account is open again. Never set by the user's own pause (absent in jobs
   * saved before this existed).
   */
  resumeWhenPhotosOpen?: boolean;
  /**
   * While it runs, the background page's sign of life, every [ALIVE_EVERY_MS] even while it waits
   * (absent in jobs saved before this existed). See [notResponding].
   */
  aliveAtMs?: number;
}

/** How often the background page says a running job is still in hand. */
export const ALIVE_EVERY_MS = 15_000;
/** A running job without any sign of life (progress or [JobBase.aliveAtMs]) for this long: its background page is gone or stuck. */
export const NOT_RESPONDING_AFTER_MS = 90_000;

/** Running, but the background page has shown no sign of life for [NOT_RESPONDING_AFTER_MS]. */
export function notResponding(job: Job, nowMs: number): boolean {
  return job.status === 'running' && nowMs - Math.max(job.updatedAtMs, job.aliveAtMs ?? 0) > NOT_RESPONDING_AFTER_MS;
}

/** The background page still has [job] in hand. */
export function markAlive<J extends Job>(job: J, nowMs: number): J {
  return job.status === 'running' ? { ...job, aliveAtMs: nowMs } : job;
}

/**
 * Why every running job stopped when the background page couldn't start: paused, resumable, and
 * not waiting for Google Photos (it wasn't missing).
 */
export const ENGINE_FAILED_TEXT =
  "Photo Cleaner's background work couldn't start, so the scan stopped. Nothing in your library was changed. " +
  'Resume to try again; if it keeps happening, Copy diagnostics into a problem report.';

/** On a job whose background page stopped responding. */
export const NOT_RESPONDING_TEXT =
  "Photo Cleaner's background work stopped responding. Nothing in your library was changed. Restart to carry on from where it was.";

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
  googleProblem: null,
};

export function jobId(kind: JobKind, account: string): string {
  return `${kind}:${account}`;
}

function base(kind: JobKind, account: string, nowMs: number): JobBase {
  if (!account) throw new Error('A job needs an account');
  return { id: jobId(kind, account), account, status: 'running', startedAtMs: nowMs, updatedAtMs: nowMs, finishedAtMs: null, resumeWhenPhotosOpen: false };
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

/** The user's pause: it stays paused until they resume it (also a pause that was waiting for Google Photos). */
export function pauseJob<J extends Job>(job: J, nowMs: number): J {
  if (job.status === 'running') return { ...job, status: 'paused', resumeWhenPhotosOpen: false, updatedAtMs: nowMs };
  return job.status === 'paused' && job.resumeWhenPhotosOpen ? { ...job, resumeWhenPhotosOpen: false, updatedAtMs: nowMs } : job;
}

/** Resumed: why it stopped, and Google's details behind it, no longer apply. */
export function resumeJob<J extends Job>(job: J, nowMs: number): J {
  return job.status === 'paused' ? { ...job, status: 'running', resumeWhenPhotosOpen: false, progress: { ...job.progress, notice: null, googleProblem: null }, updatedAtMs: nowMs } : job;
}

/** Google Photos is open and signed in to [account] again: a job that paused only for want of it carries on. */
export function resumeIfWaitingForPhotos<J extends Job>(job: J, account: string, nowMs: number): J {
  return job.status === 'paused' && job.resumeWhenPhotosOpen === true && job.account === account ? resumeJob(job, nowMs) : job;
}

/** New progress from the background page; ignored once the job is no longer running. */
export function reportProgress<J extends Job>(job: J, progress: J['progress'], nowMs: number): J {
  return job.status === 'running' ? { ...job, progress, updatedAtMs: nowMs } : job;
}

/**
 * How the background page's run ended. A user pause has already been saved and stays as it is.
 * [resumeWhenPhotosOpen]: paused only because Google Photos was missing.
 */
export function endJob<J extends Job>(job: J, outcome: 'completed' | 'paused' | 'failed', notice: string | null, nowMs: number, resumeWhenPhotosOpen = false): J {
  if (job.status !== 'running') return job;
  const progress = { ...job.progress, notice };
  switch (outcome) {
    case 'completed':
      return { ...job, status: 'finished', progress, updatedAtMs: nowMs, finishedAtMs: nowMs };
    case 'paused':
      return { ...job, status: 'paused', progress, resumeWhenPhotosOpen, updatedAtMs: nowMs };
    case 'failed':
      return { ...job, status: 'failed', progress, updatedAtMs: nowMs, finishedAtMs: nowMs };
  }
}

export function setFullSpeed(job: AnalysisJob, fullSpeed: boolean, nowMs: number): AnalysisJob {
  return { ...job, fullSpeed, updatedAtMs: nowMs };
}
