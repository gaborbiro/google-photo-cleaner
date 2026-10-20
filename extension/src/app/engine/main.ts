// The background page (offscreen document): runs every account's library scans and analyses,
// independent of any tab or panel. Google is reached through the service worker (this page has
// no tab access), which runs each request in a Photos tab signed in to the account. One analysis
// at a time uses the graphics card. With nothing left to run it asks to be closed.

import type { OpResult, ReadOp } from '../../shared/protocol';
import { NO_ANALYSIS, runAnalysis } from '../ai/analysis';
import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { decodePreview, TransformersEmbedder } from '../ai/embedder';
import { decidePace, WAIT_CHECK_MS } from '../ai/gentle';
import { refreshReviewSummary } from '../duplicates/session';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { runScan } from '../scan/session';
import { OpPhotosSource } from '../scan/source';
import { ENGINE_STARTED_KEY } from '../shared/constants';
import { ALIVE_EVERY_MS, endJob, jobId, markAlive, reportProgress, startAnalysisJob, type AnalysisJob, type Job, type ScanJob } from '../shared/job';
import { IndexedDbProblemLog, keepProblemsHere, problemsSaved, recordUnexpected, type RunOutcome } from '../shared/problemLog';
import { AnalysisStats, ScanStats, type RunStats } from '../shared/runStats';
import { IndexedDbJobStore, onJobsChanged } from '../shared/store';
import { BUILT_VERSION } from '../shared/version';

keepProblemsHere();

const jobs = new IndexedDbJobStore();
const inventory = new IndexedDbInventoryStore();
const analysis = new IndexedDbAnalysisStore();
const embedder = new TransformersEmbedder();
const diagnostics = new IndexedDbProblemLog();
const active = new Set<string>();

// --- run summaries (Copy diagnostics) ---

/** How often a running run's summary is saved, so a slow run shows before it ends (or if the page closes). */
const SAVE_RUN_EVERY_MS = 5 * 60_000;

/**
 * Keeps the summary of this run of [job] in the problem log: now, every few minutes while it runs
 * ([refresh] first brings what may have changed meanwhile up to date), and once with its outcome.
 */
function keepRun(job: Job, run: { stats: RunStats }, refresh: () => Promise<void> = async () => {}) {
  const startedAtMs = Date.now();
  const save = async (outcome: RunOutcome) => {
    try {
      await refresh();
      await diagnostics.saveRun({ type: 'run', runKey: `${job.id}@${startedAtMs}`, version: BUILT_VERSION, startedAtMs, atMs: Date.now(), outcome, stats: structuredClone(run.stats) });
    } catch (error) {
      console.warn('Photo Cleaner: could not save the run summary', error);
    }
  };
  const timer = setInterval(() => void save('running'), SAVE_RUN_EVERY_MS);
  void save('running');
  return {
    async end(outcome: RunOutcome): Promise<void> {
      clearInterval(timer);
      await save(outcome);
    },
  };
}

/** Runs [work], keeping its run's summary to the end, also when it stops unexpectedly. */
async function withRunSummary<O extends { kind: RunOutcome }>(kept: ReturnType<typeof keepRun>, work: () => Promise<O>): Promise<O> {
  let outcome: O;
  try {
    outcome = await work();
  } catch (error) {
    await kept.end('stopped unexpectedly');
    throw error;
  }
  await kept.end(outcome.kind);
  return outcome;
}

/** "intel / gen-12lp": the graphics card the browser offers, as WebGPU names it; null when it can't say. */
async function graphicsName(): Promise<string | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string } } | null> } }).gpu;
  if (!gpu) return null;
  try {
    const info = (await gpu.requestAdapter())?.info;
    const clean = (part: string | undefined) => (part ?? '').toLowerCase().replace(/[^a-z0-9 ._-]/g, '').slice(0, 40);
    return [clean(info?.vendor), clean(info?.architecture)].filter((part) => part !== '').join(' / ') || null;
  } catch (error) {
    console.warn('Photo Cleaner: could not ask which graphics card there is', error);
    return null;
  }
}

/** Whether the AI model's files are on this computer already (the embedder's own check). */
async function modelCached(): Promise<boolean | null> {
  try {
    return await caches.has('transformers-cache');
  } catch (error) {
    console.warn('Photo Cleaner: could not check for the AI model files', error);
    return null;
  }
}

function sourceFor(account: string) {
  return new OpPhotosSource((op: ReadOp, params: Record<string, unknown>) =>
    chrome.runtime.sendMessage({ kind: 'app-run-op', account, op, params }) as Promise<OpResult>);
}

/** When a scan or analysis stopped for a reason nobody foresaw. Nothing in the library was changed. */
const UNEXPECTED_STOP_TEXT = 'Something unexpected went wrong, so the scan stopped. Nothing in your library was changed. Resume to try again.';

const isRunning = async (id: string) => (await jobs.get(id))?.status === 'running';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function finish(job: Job, outcome: { kind: string; reason?: string; untilPhotosOpen?: boolean }): Promise<void> {
  if (outcome.kind === 'stopped') return; // the user's pause is already saved
  const result = outcome.kind === 'completed' ? 'completed' : outcome.kind === 'failed' ? 'failed' : 'paused';
  await jobs.update(job.id, (j) => (j ? endJob(j, result, outcome.reason ?? null, Date.now(), outcome.untilPhotosOpen === true) : null));
  if (outcome.untilPhotosOpen) console.info(`Photo Cleaner: ${job.kind} paused until Google Photos is back: ${outcome.reason}`);
}

async function runScanJob(job: ScanJob): Promise<void> {
  const stats = new ScanStats();
  const outcome = await withRunSummary(keepRun(job, stats), () => runScan({
    account: job.account,
    source: sourceFor(job.account),
    store: inventory,
    stats,
    shouldStop: async () => !(await isRunning(job.id)),
    onProgress: async (progress) => void (await jobs.update(job.id, (j) => (j?.kind === 'library-scan' ? reportProgress(j, progress, Date.now()) : j))),
  }));
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
  const stats = new AnalysisStats();
  Object.assign(stats.stats, { fullSpeedAtStart: job.fullSpeed, fullSpeedNow: job.fullSpeed, graphics: await graphicsName(), modelCached: await modelCached() });
  const fullSpeedNow = async () => {
    const now = await jobs.get(job.id);
    stats.stats.fullSpeedNow = now?.kind === 'analysis' ? now.fullSpeed : null;
  };
  const outcome = await withRunSummary(keepRun(job, stats, fullSpeedNow), () => runAnalysis({
    account: job.account,
    source: sourceFor(job.account),
    inventory,
    store: analysis,
    embedder,
    decode: decodePreview,
    // A resumed job goes on counting; a new one (Scan, Check for new photos) starts with no progress.
    newPhotosThisJob: job.progress.newPhotos,
    shouldStop: async () => !(await isRunning(job.id)),
    pace: (lastPhotoMs, show) => pace(job.id, lastPhotoMs, show),
    stats,
    onProgress: async (progress) => void (await jobs.update(job.id, (j) => (j?.kind === 'analysis' ? reportProgress(j, progress, Date.now()) : j))),
  }));
  await finish(job, outcome);
  // The popup can then say how many groups are waiting, before the review tab is ever opened.
  if (outcome.kind === 'completed') {
    await refreshReviewSummary(job.account).catch((error: unknown) => console.warn('Photo Cleaner: could not work out the groups to review', error));
  }
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
        // A bug or something truly unexpected: the details go to the console and the problem log (Copy diagnostics).
        console.error('Photo Cleaner: the scan stopped because of an unexpected error', error);
        recordUnexpected(`${job.kind === 'library-scan' ? 'scan' : 'analysis'}: stopped unexpectedly`, error);
        await jobs.update(job.id, (j) => (j ? endJob(j, 'paused', UNEXPECTED_STOP_TEXT, Date.now()) : null));
      })
      .finally(() => {
        active.delete(job.id);
        void check();
      });
  }
  if (active.size === 0) {
    // Closing this page would lose problems not yet saved.
    await problemsSaved();
    await chrome.runtime.sendMessage({ kind: 'app-engine-idle' });
  }
}

/**
 * Every running job this page has in hand says so now and then, also while it waits (a rate limit,
 * gentle mode, the model download): without it, the surfaces show the job as not responding (see
 * notResponding in shared/job.ts).
 */
setInterval(() => {
  for (const id of active) {
    jobs.update(id, (j) => (j ? markAlive(j, Date.now()) : null)).catch((error: unknown) => console.warn('Photo Cleaner: could not say a job is still running', error));
  }
}, ALIVE_EVERY_MS);

// A job started or resumed anywhere is picked up straight away.
onJobsChanged(() => void check());
void check();

// For the guard (engine/guard.ts): from here on, an error no longer means the page couldn't start.
(globalThis as Record<string, unknown>)[ENGINE_STARTED_KEY] = true;
