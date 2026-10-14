// What the buttons do. Changes go to the job store (saved, announced to every surface);
// the service worker is then asked to make sure the background page is running.

import { jobId, pauseJob, PRETEND_SCAN_STEPS, resumeJob, startJob, type Job } from './job';
import type { AppRequest } from './messages';
import type { JobStore } from './store';

export type Send = (request: AppRequest) => Promise<unknown>;

export async function startScan(store: JobStore, send: Send, account: string, nowMs: number): Promise<Job | null> {
  const saved = await store.update(jobId('pretend-scan', account), () => startJob('pretend-scan', account, PRETEND_SCAN_STEPS, nowMs));
  await send({ kind: 'app-wake-engine' });
  return saved;
}

export function pauseScan(store: JobStore, account: string, nowMs: number): Promise<Job | null> {
  return store.update(jobId('pretend-scan', account), (job) => (job ? pauseJob(job, nowMs) : null));
}

export async function resumeScan(store: JobStore, send: Send, account: string, nowMs: number): Promise<Job | null> {
  const saved = await store.update(jobId('pretend-scan', account), (job) => (job ? resumeJob(job, nowMs) : null));
  await send({ kind: 'app-wake-engine' });
  return saved;
}
