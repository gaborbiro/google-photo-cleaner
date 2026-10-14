// A background job for one Google account, as saved in the browser database. M1 has only a
// pretend scan that counts up; the real scan (M2) and analysis (M3) reuse the same life cycle.

export type JobKind = 'pretend-scan';
export type JobStatus = 'running' | 'paused' | 'finished';

export interface Job {
  /** `${kind}:${account}`: one job of each kind per account. */
  id: string;
  kind: JobKind;
  /** Account fingerprint (never the email). */
  account: string;
  status: JobStatus;
  done: number;
  total: number;
  startedAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
}

export const PRETEND_SCAN_STEPS = 400;

export function jobId(kind: JobKind, account: string): string {
  return `${kind}:${account}`;
}

/** A fresh job, started now. Starting again replaces a finished or paused one. */
export function startJob(kind: JobKind, account: string, total: number, nowMs: number): Job {
  if (!account) throw new Error('A job needs an account');
  if (total <= 0) throw new Error('A job needs work to do');
  return { id: jobId(kind, account), kind, account, status: 'running', done: 0, total, startedAtMs: nowMs, updatedAtMs: nowMs, finishedAtMs: null };
}

export function pauseJob(job: Job, nowMs: number): Job {
  return job.status === 'running' ? { ...job, status: 'paused', updatedAtMs: nowMs } : job;
}

export function resumeJob(job: Job, nowMs: number): Job {
  return job.status === 'paused' ? { ...job, status: 'running', updatedAtMs: nowMs } : job;
}

/** One step of work; only a running job moves, and it finishes on its last step. */
export function advanceJob(job: Job, steps: number, nowMs: number): Job {
  if (job.status !== 'running') return job;
  const done = Math.min(job.total, job.done + steps);
  return done === job.total
    ? { ...job, done, status: 'finished', updatedAtMs: nowMs, finishedAtMs: nowMs }
    : { ...job, done, updatedAtMs: nowMs };
}
