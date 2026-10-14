// The background page (offscreen document): does the work, independent of any tab or panel.
// M1's pretend scan takes a step every TICK_MS for every running job and saves it; closing
// a surface changes nothing here. With nothing left to run it asks to be closed.

import { advanceJob } from '../shared/job';
import { IndexedDbJobStore, onJobsChanged } from '../shared/store';

const TICK_MS = 150;
const store = new IndexedDbJobStore();
let ticking = false;

async function tick(): Promise<void> {
  const running = (await store.all()).filter((job) => job.status === 'running');
  if (running.length === 0) {
    stop();
    await chrome.runtime.sendMessage({ kind: 'app-engine-idle' });
    return;
  }
  const now = Date.now();
  // Each step re-reads the job inside its transaction, so a pause made meanwhile wins.
  await Promise.all(running.map((job) => store.update(job.id, (current) => (current ? advanceJob(current, 1, now) : null))));
}

let timer: ReturnType<typeof setInterval> | null = null;

function start(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    if (ticking) return; // the previous step is still saving
    ticking = true;
    tick().catch((error) => console.error('Background step failed', error)).finally(() => (ticking = false));
  }, TICK_MS);
}

function stop(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

// Resuming or starting a job anywhere restarts the ticking.
onJobsChanged(start);
start();
