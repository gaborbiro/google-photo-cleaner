// The background page (offscreen document): runs every account's running scan, independent of any
// tab or panel. Google is reached through the service worker (this page has no tab access), which
// runs each request in a Photos tab signed in to the scanned account. With nothing left to run it
// asks to be closed.

import type { OpResult, ReadOp } from '../../shared/protocol';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { runScan } from '../scan/session';
import { OpPhotosSource } from '../scan/source';
import { endJob, reportProgress, type Job } from '../shared/job';
import { IndexedDbJobStore, onJobsChanged } from '../shared/store';

const jobs = new IndexedDbJobStore();
const inventory = new IndexedDbInventoryStore();
const active = new Set<string>();

function sourceFor(account: string) {
  return new OpPhotosSource((op: ReadOp, params: Record<string, unknown>) =>
    chrome.runtime.sendMessage({ kind: 'app-run-op', account, op, params }) as Promise<OpResult>);
}

async function runJob(job: Job): Promise<void> {
  const outcome = await runScan({
    account: job.account,
    source: sourceFor(job.account),
    store: inventory,
    shouldStop: async () => (await jobs.get(job.id))?.status !== 'running',
    onProgress: async (progress) => void (await jobs.update(job.id, (j) => (j ? reportProgress(j, progress, Date.now()) : null))),
  });
  if (outcome.kind === 'stopped') return; // the user's pause is already saved
  const result = outcome.kind === 'completed' ? 'completed' : outcome.kind === 'failed' ? 'failed' : 'paused';
  const notice = 'reason' in outcome ? outcome.reason : null;
  await jobs.update(job.id, (j) => (j ? endJob(j, result, notice, Date.now()) : null));
}

/** Starts a run for every running job that doesn't have one; asks to be closed when none is left. */
async function check(): Promise<void> {
  for (const job of await jobs.all()) {
    if (job.status !== 'running' || active.has(job.id)) continue;
    active.add(job.id);
    runJob(job)
      .catch(async (error: unknown) => {
        console.error('Scan stopped by an unexpected error', error);
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

// A scan started or resumed anywhere is picked up straight away.
onJobsChanged(() => void check());
void check();
