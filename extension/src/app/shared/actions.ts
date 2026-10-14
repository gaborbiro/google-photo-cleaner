// What the buttons do. Changes go to the job store (saved, announced to every surface);
// the service worker is then asked to make sure the background page is running.

import { NO_ANALYSIS } from '../ai/analysis';
import { jobId, pauseJob, resumeIfWaitingForPhotos, resumeJob, setFullSpeed, startAnalysisJob, startScanJob, type Job, type JobKind } from './job';
import type { AppRequest } from './messages';
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

export function setAnalysisFullSpeed(store: JobStore, account: string, fullSpeed: boolean, nowMs: number): Promise<Job | null> {
  return store.update(jobId('analysis', account), (job) => (job?.kind === 'analysis' ? setFullSpeed(job, fullSpeed, nowMs) : job));
}
