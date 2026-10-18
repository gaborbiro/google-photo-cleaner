import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { pause, resume, resumeWaitingForPhotos, scanButton, setAnalysisFullSpeed, startAnalysis, startScan } from '../../src/app/shared/actions';
import { endJob, jobId, NO_PROGRESS, reportProgress } from '../../src/app/shared/job';
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

  it("the Scan card's button does what its view says", async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { sent, send } = recorder();
    await scanButton({ action: 'start', target: 'library-scan' }, store, send, 'acc1', 1_000);
    expect(await store.get(scanOf('acc1'))).toMatchObject({ status: 'running' });
    await scanButton({ action: 'pause', target: 'library-scan' }, store, send, 'acc1', 2_000);
    expect(await store.get(scanOf('acc1'))).toMatchObject({ status: 'paused' });
    await scanButton({ action: 'resume', target: 'library-scan' }, store, send, 'acc1', 3_000);
    expect(await store.get(scanOf('acc1'))).toMatchObject({ status: 'running' });
    await scanButton({ action: 'restart', target: 'analysis' }, store, send, 'acc1', 4_000);
    expect(await store.get(jobId('analysis', 'acc1'))).toMatchObject({ status: 'running' });
    expect(sent).toHaveLength(3); // start, resume and the analysis wake the background page; pausing doesn't
  });

  it('keeps each account separate', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await startScan(store, send, 'acc2', 1_000);
    await pause(store, 'library-scan', 'acc1', 2_000);
    expect((await store.get(scanOf('acc1')))?.status).toBe('paused');
    expect((await store.get(scanOf('acc2')))?.status).toBe('running');
  });

  it('a pause wins over progress the background page saves after it', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await pause(store, 'library-scan', 'acc1', 2_000);
    await store.update(scanOf('acc1'), (job) => (job ? reportProgress(job, { ...NO_PROGRESS, libraryEntries: 500 }, 3_000) : null));
    expect(await store.get(scanOf('acc1'))).toMatchObject({ status: 'paused', progress: { libraryEntries: 0 } });
  });

  it('resuming continues and wakes the background page', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { sent, send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await pause(store, 'library-scan', 'acc1', 2_000);
    await resume(store, send, 'library-scan', 'acc1', 3_000);
    expect((await store.get(scanOf('acc1')))?.status).toBe('running');
    expect(sent).toHaveLength(2);
  });

  it('Google Photos open again carries on the jobs that waited for it, for that account only', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { send } = recorder();
    for (const account of ['acc1', 'acc2']) {
      await startScan(store, send, account, 1_000);
      await store.update(jobId('library-scan', account), (j) => (j ? endJob(j, 'paused', 'Google Photos was closed.', 2_000, true) : null));
    }
    expect(await resumeWaitingForPhotos(store, 'acc1', 3_000)).toBe(true);
    expect((await store.get(jobId('library-scan', 'acc1')))!.status).toBe('running');
    expect((await store.get(jobId('library-scan', 'acc2')))!.status).toBe('paused');
    expect(await resumeWaitingForPhotos(store, 'acc1', 4_000)).toBe(false); // nothing left waiting
  });

  it('pausing or resuming an account without a scan saves nothing', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { send } = recorder();
    expect(await pause(store, 'library-scan', 'acc1', 1_000)).toBeNull();
    expect(await resume(store, send, 'library-scan', 'acc1', 1_000)).toBeNull();
    expect(await store.all()).toEqual([]);
  });
});

describe('analysis actions', () => {
  it('stage 1 saves full speed without starting analysis, and stage 2 keeps the choice', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { sent, send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await setAnalysisFullSpeed(store, 'acc1', true, 2_000);
    expect(await store.get(jobId('analysis', 'acc1'))).toMatchObject({ status: 'paused', fullSpeed: true });
    expect(await store.get(scanOf('acc1'))).toMatchObject({ status: 'running' });
    expect(await store.get(jobId('analysis', 'acc2'))).toBeNull();
    expect(sent).toEqual([{ kind: 'app-wake-engine' }]);

    await startAnalysis(store, send, 'acc1', 3_000);
    expect(await store.get(jobId('analysis', 'acc1'))).toMatchObject({ status: 'running', fullSpeed: true });
    await setAnalysisFullSpeed(store, 'acc1', false, 4_000);
    expect(await store.get(jobId('analysis', 'acc1'))).toMatchObject({ status: 'running', fullSpeed: false });
  });

  it('starting the analysis wakes the background page; full speed is remembered on the job', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { sent, send } = recorder();
    await startAnalysis(store, send, 'acc1', 1_000);
    await setAnalysisFullSpeed(store, 'acc1', true, 2_000);
    expect(await store.get(jobId('analysis', 'acc1'))).toMatchObject({ kind: 'analysis', status: 'running', fullSpeed: true });
    expect(sent).toEqual([{ kind: 'app-wake-engine' }]);
  });

  it('pausing the analysis leaves the scan alone', async () => {
    const store = new IndexedDbJobStore(new IDBFactory());
    const { send } = recorder();
    await startScan(store, send, 'acc1', 1_000);
    await startAnalysis(store, send, 'acc1', 1_000);
    await pause(store, 'analysis', 'acc1', 2_000);
    expect((await store.get(jobId('analysis', 'acc1')))?.status).toBe('paused');
    expect((await store.get(jobId('library-scan', 'acc1')))?.status).toBe('running');
  });
});
