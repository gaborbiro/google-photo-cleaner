import { describe, expect, it } from 'vitest';
import { pauseScan, resumeScan, startScan } from '../../src/app/shared/actions';
import { advanceJob, jobId, type Job } from '../../src/app/shared/job';
import type { AppRequest } from '../../src/app/shared/messages';
import type { JobStore } from '../../src/app/shared/store';

/** The same contract as the IndexedDB store: each update is one atomic read-modify-write. */
class MemoryJobStore implements JobStore {
  readonly jobs = new Map<string, Job>();
  async all() { return [...this.jobs.values()]; }
  async get(id: string) { return this.jobs.get(id) ?? null; }
  async update(id: string, change: (current: Job | null) => Job | null) {
    const next = change(this.jobs.get(id) ?? null);
    if (next === null) this.jobs.delete(id);
    else this.jobs.set(id, next);
    return next;
  }
}

function recorder() {
  const sent: AppRequest[] = [];
  return { sent, send: async (request: AppRequest) => void sent.push(request) };
}

describe('scan actions', () => {
  it('starting saves a running job and wakes the background page', async () => {
    const store = new MemoryJobStore();
    const { sent, send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    expect(await store.get(jobId('pretend-scan', 'acc1'))).toMatchObject({ status: 'running', done: 0 });
    expect(sent).toEqual([{ kind: 'app-wake-engine' }]);
  });

  it('keeps each account separate', async () => {
    const store = new MemoryJobStore();
    const { send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await startScan(store, send, 'acc2', 1_000);
    await pauseScan(store, 'acc1', 2_000);
    expect((await store.get(jobId('pretend-scan', 'acc1')))?.status).toBe('paused');
    expect((await store.get(jobId('pretend-scan', 'acc2')))?.status).toBe('running');
  });

  it('a pause wins over a background step that comes after it', async () => {
    const store = new MemoryJobStore();
    const { send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await pauseScan(store, 'acc1', 2_000);
    // The background page's step re-reads the saved job, so it sees the pause.
    await store.update(jobId('pretend-scan', 'acc1'), (job) => (job ? advanceJob(job, 1, 3_000) : null));
    expect(await store.get(jobId('pretend-scan', 'acc1'))).toMatchObject({ status: 'paused', done: 0 });
  });

  it('resuming continues where it stopped and wakes the background page', async () => {
    const store = new MemoryJobStore();
    const { sent, send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await store.update(jobId('pretend-scan', 'acc1'), (job) => (job ? advanceJob(job, 5, 2_000) : null));
    await pauseScan(store, 'acc1', 3_000);
    await resumeScan(store, send, 'acc1', 4_000);
    expect(await store.get(jobId('pretend-scan', 'acc1'))).toMatchObject({ status: 'running', done: 5 });
    expect(sent).toHaveLength(2);
  });

  it('pausing or resuming an account without a scan saves nothing', async () => {
    const store = new MemoryJobStore();
    const { send } = recorder();
    expect(await pauseScan(store, 'acc1', 1_000)).toBeNull();
    expect(await resumeScan(store, send, 'acc1', 1_000)).toBeNull();
    expect(await store.all()).toEqual([]);
  });
});
