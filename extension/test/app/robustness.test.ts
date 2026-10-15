// Adversarial cases from the test audit. Inspect the service boundary, not just saved status labels.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { runAnalysis, type Embedder } from '../../src/app/ai/analysis';
import { IndexedDbAnalysisStore } from '../../src/app/ai/analysisStore';
import { SpeedMeter } from '../../src/app/ai/speed';
import { IndexedDbReviewStore } from '../../src/app/duplicates/reviewStore';
import { processTrashQueue, SimulatedTrash } from '../../src/app/duplicates/trash';
import { IndexedDbInventoryStore } from '../../src/app/scan/inventoryStore';
import { SourceError } from '../../src/app/scan/source';
import { committed, openDatabase, STORES } from '../../src/app/shared/db';
import { classifyLatest, fakeAlbum, fakeItem, FakePhotos, NOW, scan } from './fakes';

async function queued() {
  const factory = new IDBFactory();
  const inventory = new IndexedDbInventoryStore(factory);
  const review = new IndexedDbReviewStore(factory);
  const trash = new SimulatedTrash(factory);
  const source = new FakePhotos([fakeItem(0), fakeItem(1)]);
  await scan(source, inventory);
  await review.recordDecision('account-a', 'group', 'APPROVED', [{ mediaKey: 'lib-1', dedupKey: 'dedup-1' }], ['lib-0', 'lib-1'], NOW);
  const send = vi.spyOn(trash, 'moveToTrash');
  const deps = { account: 'account-a', review, trash, now: () => NOW, classify: () => classifyLatest(inventory) };
  return { inventory, review, source, trash, send, deps };
}

describe('trash queue safety at the service boundary', () => {
  it.each(['favourite', 'album', 'archive', 'unknown ownership', 'missing favourite flag', 'unknown media type'] as const)(
    'does not send a photo that becomes %s after approval', async (reason) => {
      const { inventory, source, review, trash, send, deps } = await queued();
      if (reason === 'favourite') {
        source.library[1] = fakeItem(1, { isFavourite: true });
        source.favourites = [source.library[1]!];
      }
      if (reason === 'album') source.albums = [fakeAlbum('new-album', [1])];
      if (reason === 'archive') source.archive = [source.library[1]!]; // protects even when the flag is false
      if (reason === 'unknown ownership') source.library[1] = fakeItem(1, { isOwned: null });
      if (reason === 'missing favourite flag') source.library[1] = fakeItem(1, { isFavourite: null });
      if (reason === 'unknown media type') source.library[1] = fakeItem(1, { mediaType: null });
      await scan(source, inventory);
      await processTrashQueue(deps);
      expect(await review.jobs('account-a', ['BLOCKED'])).toHaveLength(1);
      expect(send).not.toHaveBeenCalled();
      expect(await trash.inTrash('account-a', ['dedup-1'])).toEqual(new Map([['dedup-1', false]]));
    },
  );

  it('does not send an approval whose dedup identity no longer matches the enumerated photo', async () => {
    const { inventory, source, review, send, deps } = await queued();
    source.library[1] = { ...fakeItem(1), dedupKey: 'different-photo-identity' };
    await scan(source, inventory);
    await processTrashQueue(deps);
    expect(send).not.toHaveBeenCalled();
    expect(await review.jobs('account-a', ['BLOCKED'])).toMatchObject([{ lastError: 'Photo identity changed since approval' }]);
  });

  it.each(['missing', 'unfinished', 'stale'] as const)('makes no trash request with a %s scan', async (state) => {
    const { inventory, source, send, review, deps } = await queued();
    if (state === 'unfinished') {
      source.failure = (op) => op === 'favourites' ? new SourceError('SESSION', 'signed out', 401) : null;
      await scan(source, inventory);
    }
    const classify = state === 'missing' ? async () => null : () => classifyLatest(inventory, state === 'stale' ? NOW + 25 * 3_600_000 : NOW);
    expect((await processTrashQueue({ ...deps, classify })).waitingReason).not.toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(await review.jobs('account-a', ['QUEUED'])).toHaveLength(1);
  });

  it('undo during an in-flight send restores the photo without sending it twice', async () => {
    const { trash, review, send, deps } = await queued();
    const move = SimulatedTrash.prototype.moveToTrash.bind(trash);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    send.mockImplementation(async (account, targets) => {
      const outcomes = await move(account, targets);
      entered();
      await gate;
      return outcomes;
    });
    const sending = processTrashQueue(deps);
    await started;
    await review.undoLast('account-a', NOW + 1);
    release();
    await sending;
    expect(await review.jobs('account-a', ['RESTORE_REQUESTED'])).toHaveLength(1);
    await processTrashQueue(deps);
    expect(await review.jobs('account-a', ['RESTORED'])).toHaveLength(1);
    expect(await trash.inTrash('account-a', ['dedup-1'])).toEqual(new Map([['dedup-1', false]]));
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('analysis inputs that the ordinary fake library did not exercise', () => {
  async function analyse(items: ReturnType<typeof fakeItem>[]) {
    const factory = new IDBFactory();
    const inventory = new IndexedDbInventoryStore(factory);
    const store = new IndexedDbAnalysisStore(factory);
    const source = new FakePhotos(items);
    await scan(source, inventory);
    const calls: number[] = [];
    let now = NOW;
    const embedder: Embedder = {
      load: async () => {},
      embed: async (image) => {
        calls.push(image.data[0]!);
        now += 100;
        return Float32Array.from([1, 0]);
      },
    };
    const outcome = await runAnalysis({
      account: 'account-a', inventory, store, source, embedder,
      decode: async (preview) => ({ data: new Uint8ClampedArray([preview.bytes[0]!, 0, 0, 255]), width: 1, height: 1 }),
      now: () => now, shouldStop: async () => false, pace: async () => {}, onProgress: async () => {}, sleep: async () => {},
    });
    return { outcome, calls, source, store };
  }

  it('can analyse a one-photo library instead of pausing forever at the speed check', async () => {
    const { outcome, calls } = await analyse([fakeItem(0)]);
    expect(outcome).toEqual({ kind: 'completed' });
    expect(calls).toEqual([0]);
  });

  it('looks beyond a first page consisting entirely of videos for its speed-check sample', async () => {
    const items = Array.from({ length: 16 }, (_, i) => fakeItem(i, { mediaType: i < 3 ? 'VIDEO' : 'PHOTO' }));
    const { outcome, calls } = await analyse(items);
    expect(outcome).toEqual({ kind: 'completed' });
    expect(calls.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, i) => i + 3));
  });
});

it('an aborted database write rejects instead of announcing success', async () => {
  const db = await openDatabase(new IDBFactory());
  const tx = db.transaction(STORES.jobs, 'readwrite');
  const saved = committed(tx);
  tx.objectStore(STORES.jobs).put({ id: 'never-saved' });
  tx.abort();
  await expect(saved).rejects.toThrow();
  db.close();
});

it('speed measurements expire exactly at the one-minute boundary', () => {
  const meter = new SpeedMeter(0);
  const timing = { ai: 1, other: 0, pace: 0, preview: 0, save: 0 };
  meter.record(0, timing);
  meter.record(60_000, timing);
  expect(meter.recent(60_000)!.photosPerSecond).toBeCloseTo(1 / 60, 10);
  expect(meter.recent(120_000)).toBeNull();
});
