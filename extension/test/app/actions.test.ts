import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { pauseScan, resumeScan, startScan } from '../../src/app/shared/actions';
import { jobId, NO_PROGRESS, reportProgress } from '../../src/app/shared/job';
import type { AppRequest } from '../../src/app/shared/messages';
import { IndexedDbJobStore } from '../../src/app/shared/store';

function recorder() {
  const sent: AppRequest[] = [];
  return { sent, send: async (request: AppRequest) => void sent.push(request) };
}

const scanOf = (account: string) => jobId('library-scan', account);

describe('scan actions (on the real job store, in memory)', () => {
  it('starting saves a running job and wakes the background page', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { sent, send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    expect(await store.get(scanOf('acc1'))).toMatchObject({ status: 'running' });
    expect(sent).toEqual([{ kind: 'app-wake-engine' }]);
  });

  it('keeps each account separate', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await startScan(store, send, 'acc2', 1_000);
    await pauseScan(store, 'acc1', 2_000);
    expect((await store.get(scanOf('acc1')))?.status).toBe('paused');
    expect((await store.get(scanOf('acc2')))?.status).toBe('running');
  });

  it('a pause wins over progress the background page saves after it', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await pauseScan(store, 'acc1', 2_000);
    await store.update(scanOf('acc1'), (job) => (job ? reportProgress(job, { ...NO_PROGRESS, libraryEntries: 500 }, 3_000) : null));
    expect(await store.get(scanOf('acc1'))).toMatchObject({ status: 'paused', progress: { libraryEntries: 0 } });
  });

  it('resuming continues and wakes the background page', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { sent, send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await pauseScan(store, 'acc1', 2_000);
    await resumeScan(store, send, 'acc1', 3_000);
    expect((await store.get(scanOf('acc1')))?.status).toBe('running');
    expect(sent).toHaveLength(2);
  });

  it('pausing or resuming an account without a scan saves nothing', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { send } = recorder();
    expect(await pauseScan(store, 'acc1', 1_000)).toBeNull();
    expect(await resumeScan(store, send, 'acc1', 1_000)).toBeNull();
    expect(await store.all()).toEqual([]);
  });
});
