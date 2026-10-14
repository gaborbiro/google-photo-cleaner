// The background page (offscreen document): runs every account's library scans and analyses,
// independent of any tab or panel. Google is reached through the service worker (this page has
// no tab access), which runs each request in a Photos tab signed in to the account. One analysis
// at a time uses the graphics card. With nothing left to run it asks to be closed.

import type { OpResult, ReadOp } from '../../shared/protocol';
import { NO_ANALYSIS, runAnalysis } from '../ai/analysis';
import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { decodePreview, TransformersEmbedder } from '../ai/embedder';
import { decidePace, WAIT_CHECK_MS } from '../ai/gentle';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { runScan } from '../scan/session';
import { OpPhotosSource } from '../scan/source';
import { endJob, jobId, reportProgress, startAnalysisJob, type AnalysisJob, type Job, type ScanJob } from '../shared/job';
import { IndexedDbJobStore, onJobsChanged } from '../shared/store';

const jobs = new IndexedDbJobStore();
const inventory = new IndexedDbInventoryStore();
const analysis = new IndexedDbAnalysisStore();
const embedder = new TransformersEmbedder();
const active = new Set<string>();

function sourceFor(account: string) {
  return new OpPhotosSource((op: ReadOp, params: Record<string, unknown>) =>
    chrome.runtime.sendMessage({ kind: 'app-run-op', account, op, params }) as Promise<OpResult>);
}

const isRunning = async (id: string) => (await jobs.get(id))?.status === 'running';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function finish(job: Job, outcome: { kind: string; reason?: string; untilPhotosOpen?: boolean }): Promise<void> {
  if (outcome.kind === 'stopped') return; // the user's pause is already saved
  const result = outcome.kind === 'completed' ? 'completed' : outcome.kind === 'failed' ? 'failed' : 'paused';
  await jobs.update(job.id, (j) => (j ? endJob(j, result, outcome.reason ?? null, Date.now(), outcome.untilPhotosOpen === true) : null));
  if (outcome.untilPhotosOpen) console.info(`Photo Cleaner: ${job.kind} paused until Google Photos is back: ${outcome.reason}`);
}

async function runScanJob(job: ScanJob): Promise<void> {
  const outcome = await runScan({
    account: job.account,
    source: sourceFor(job.account),
    store: inventory,
    shouldStop: async () => !(await isRunning(job.id)),
    onProgress: async (progress) => void (await jobs.update(job.id, (j) => (j?.kind === 'library-scan' ? reportProgress(j, progress, Date.now()) : j))),
  });
  await finish(job, outcome);
  // One Scan does both: a finished library scan starts (or continues) the analysis.
  if (outcome.kind === 'completed') {
    await jobs.update(jobId('analysis', job.account), (previous) =>
      startAnalysisJob(job.account, Date.now(), previous?.kind === 'analysis' ? previous : null, NO_ANALYSIS));
  }
}

// --- gentle mode ---

let idleCache: { state: string; atMs: number } | null = null;

async function userActive(): Promise<boolean> {
  if (!idleCache || Date.now() - idleCache.atMs > 10_000) {
    const state = (await chrome.runtime.sendMessage({ kind: 'app-idle-state' })) as string;
    idleCache = { state, atMs: Date.now() };
  }
  return idleCache.state === 'active';
}

async function onBattery(): Promise<boolean> {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean }> }).getBattery;
  if (!getBattery) return false;
  return !(await getBattery.call(navigator)).charging;
}

async function pace(jobKey: string, lastPhotoMs: number, show: (waiting: string | null) => Promise<void>): Promise<void> {
  for (;;) {
    const job = await jobs.get(jobKey);
    if (job?.kind !== 'analysis' || job.status !== 'running') return; // paused meanwhile: the analysis stops itself
    const decision = decidePace({ fullSpeed: job.fullSpeed, onBattery: await onBattery(), userActive: await userActive() }, lastPhotoMs);
    switch (decision.kind) {
      case 'go':
        return show(null);
      case 'slow':
        await show(decision.text);
        return sleep(decision.extraMs);
      case 'wait':
        await show(decision.text);
        await sleep(WAIT_CHECK_MS);
    }
  }
}

async function runAnalysisJob(job: AnalysisJob): Promise<void> {
  const outcome = await runAnalysis({
    account: job.account,
    source: sourceFor(job.account),
    inventory,
    store: analysis,
    embedder,
    decode: decodePreview,
    shouldStop: async () => !(await isRunning(job.id)),
    pace: (lastPhotoMs, show) => pace(job.id, lastPhotoMs, show),
    onProgress: async (progress) => void (await jobs.update(job.id, (j) => (j?.kind === 'analysis' ? reportProgress(j, progress, Date.now()) : j))),
  });
  await finish(job, outcome);
}

/** Starts a run for every running job that doesn't have one (one analysis at a time); asks to be closed when none is left. */
async function check(): Promise<void> {
  const all = await jobs.all();
  for (const job of all) {
    if (job.status !== 'running' || active.has(job.id)) continue;
    if (job.kind === 'analysis' && [...active].some((id) => id.startsWith('analysis:'))) continue; // the graphics card is busy
    active.add(job.id);
    (job.kind === 'library-scan' ? runScanJob(job) : runAnalysisJob(job))
      .catch(async (error: unknown) => {
        console.error('Stopped by an unexpected error', error);
        const message = error instanceof Error ? error.message : String(error);
        await jobs.update(job.id, (j) => (j ? endJob(j, 'paused', `Stopped by an unexpected error: ${message}. Resume to try again.`, Date.now()) : null));
      })
      .finally(() => {
        active.delete(job.id);
        void check();
      });
  }
  if (active.size === 0) await chrome.runtime.sendMessage({ kind: 'app-engine-idle' });
}

// A job started or resumed anywhere is picked up straight away.
onJobsChanged(() => void check());
void check();
