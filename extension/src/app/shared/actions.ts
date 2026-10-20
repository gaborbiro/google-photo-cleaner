// What the buttons do. Changes go to the job store (saved, announced to every surface);
// the service worker is then asked to make sure the background page is running.

import { NO_ANALYSIS } from '../ai/analysis';
import { endJob, jobId, markAlive, NOT_RESPONDING_AFTER_MS, pauseJob, resumeIfWaitingForPhotos, resumeJob, setFullSpeed, startAnalysisJob, startScanJob, type Job, type JobKind } from './job';
import type { AppRequest } from './messages';
import type { ScanView } from './jobView';
import { recordProblem } from './problemLog';
import type { JobStore } from './store';

export type Send = (request: AppRequest) => Promise<unknown>;

/** Scan: reads the library, then the analysis follows by itself. */
export async function startScan(store: JobStore, send: Send, account: string, nowMs: number): Promise<Job | null> {
  const saved = await store.update(jobId('library-scan', account), () => startScanJob(account, nowMs));
  await send({ kind: 'app-wake-engine' });
  return saved;
}

/** Analyse again (e.g. after a failure); photos already analysed are skipped. */
export async function startAnalysis(store: JobStore, send: Send, account: string, nowMs: number): Promise<Job | null> {
  const saved = await store.update(jobId('analysis', account), (previous) =>
    startAnalysisJob(account, nowMs, previous?.kind === 'analysis' ? previous : null, NO_ANALYSIS));
  await send({ kind: 'app-wake-engine' });
  return saved;
}

/** The Scan card's button: does what its view says ([action] on [target]). */
export function scanButton(view: Pick<ScanView, 'action' | 'target'>, store: JobStore, send: Send, account: string, nowMs: number): Promise<Job | null> {
  switch (view.action) {
    case 'start':
    case 'restart':
      return view.target === 'library-scan' ? startScan(store, send, account, nowMs) : startAnalysis(store, send, account, nowMs);
    case 'pause':
      return pause(store, view.target, account, nowMs);
    case 'resume':
      return resume(store, send, view.target, account, nowMs);
    case 'restart-engine':
      return restartEngine(store, send, view.target, account, nowMs);
  }
}

export function pause(store: JobStore, kind: JobKind, account: string, nowMs: number): Promise<Job | null> {
  return store.update(jobId(kind, account), (job) => (job ? pauseJob(job, nowMs) : null));
}

export async function resume(store: JobStore, send: Send, kind: JobKind, account: string, nowMs: number): Promise<Job | null> {
  const saved = await store.update(jobId(kind, account), (job) => (job ? resumeJob(job, nowMs) : null));
  await send({ kind: 'app-wake-engine' });
  return saved;
}

/**
 * Google Photos is open and signed in to [account]: the jobs that paused only for want of it carry
 * on. Returns whether any did (then the background page must run).
 */
export async function resumeWaitingForPhotos(store: JobStore, account: string, nowMs: number): Promise<boolean> {
  let resumed = false;
  for (const kind of ['library-scan', 'analysis'] as const) {
    await store.update(jobId(kind, account), (job) => {
      if (!job) return null;
      const next = resumeIfWaitingForPhotos(job, account, nowMs);
      if (next !== job) resumed = true;
      return next;
    });
  }
  return resumed;
}

/** The background page couldn't start: every running job pauses, saying why (resumable). Returns how many did. */
export async function pauseRunningJobs(store: JobStore, notice: string, nowMs: number): Promise<number> {
  let paused = 0;
  for (const job of await store.all()) {
    if (job.status !== 'running') continue;
    await store.update(job.id, (current) => (current?.status === 'running' ? endJob(current, 'paused', notice, nowMs) : current));
    paused++;
  }
  return paused;
}

/**
 * Restart on a job whose background page stopped responding: kept in the problem log, then the
 * service worker starts a new page, which carries on from the saved position.
 */
export async function restartEngine(store: JobStore, send: Send, kind: JobKind, account: string, nowMs: number): Promise<Job | null> {
  recordProblem({
    where: `${kind === 'library-scan' ? 'scan' : 'analysis'}: background page not responding`,
    kind: 'UNEXPECTED',
    message: `No sign of life for over ${NOT_RESPONDING_AFTER_MS / 1000} s; restarted by the user`,
    rpcCode: null, httpStatus: null, request: null, answer: null, stack: null,
  }, nowMs);
  const saved = await store.update(jobId(kind, account), (job) => (job ? markAlive(job, nowMs) : null));
  await send({ kind: 'app-restart-engine' });
  return saved;
}

export function setAnalysisFullSpeed(store: JobStore, account: string, fullSpeed: boolean, nowMs: number): Promise<Job | null> {
  return store.update(jobId('analysis', account), (job) => {
    // Stage 1 can set the choice before there is an analysis job. Keep it paused until the
    // photo list is finished; the engine then starts it with this saved choice.
    const analysis = job?.kind === 'analysis' ? job : pauseJob(startAnalysisJob(account, nowMs, null, NO_ANALYSIS), nowMs);
    return setFullSpeed(analysis, fullSpeed, nowMs);
  });
}
