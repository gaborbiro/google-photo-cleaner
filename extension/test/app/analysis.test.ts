// The AI analysis, scenario by scenario, with a fake model and a fake clock against the real
// IndexedDB stores (in memory).

import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { runAnalysis, type AnalysisProgress, type Embedder } from '../../src/app/ai/analysis';
import { IndexedDbAnalysisStore } from '../../src/app/ai/analysisStore';
import { modelKey, type Detail } from '../../src/app/ai/model';
import type { RgbaImage } from '../../src/app/ai/quality';
import { IndexedDbInventoryStore } from '../../src/app/scan/inventoryStore';
import { SourceError } from '../../src/app/scan/source';
import { fakeItem, FakePhotos, scan } from './fakes';

/** A fake model: each photo's fingerprint points in its own direction; every call takes [msPerPhoto]. */
class FakeEmbedder implements Embedder {
  readonly calls: { index: number; detail: Detail }[] = [];
  loadError: Error | null = null;
  constructor(private readonly clock: { now: number }, private readonly msPerPhoto: number) {}
  async load(onProgress: (fraction: number) => void) {
    if (this.loadError) throw this.loadError;
    onProgress(0.5);
    onProgress(1);
  }
  async embed(image: RgbaImage, detail: Detail) {
    const index = image.data[0]!;
    this.calls.push({ index, detail });
    this.clock.now += this.msPerPhoto;
    const v = new Float32Array(32);
    v[index % 32] = 1;
    return v;
  }
}

const decode = async (p: { bytes: Uint8Array }): Promise<RgbaImage> => ({ data: Uint8ClampedArray.from([p.bytes[0]!, 100, 100, 255]), width: 1, height: 1 });

async function setup(library = Array.from({ length: 10 }, (_, i) => fakeItem(i))) {
  const factory = new IDBFactory();
  const inventory = new IndexedDbInventoryStore(factory);
  const store = new IndexedDbAnalysisStore(factory);
  const source = new FakePhotos(library);
  await scan(source, inventory);
  return { inventory, store, source };
}

async function analyse(
  env: Awaited<ReturnType<typeof setup>>,
  embedder: Embedder,
  clock: { now: number },
  opts: { shouldStop?: () => Promise<boolean>; waiting?: string | null; account?: string } = {},
) {
  const progress: AnalysisProgress[] = [];
  const outcome = await runAnalysis({
    account: opts.account ?? 'account-a',
    source: env.source,
    inventory: env.inventory,
    store: env.store,
    embedder,
    decode,
    now: () => clock.now,
    sleep: async () => {},
    shouldStop: opts.shouldStop ?? (async () => false),
    pace: async (_last, show) => show(opts.waiting ?? null),
    onProgress: async (p) => void progress.push(p),
    prefetch: 2,
  });
  return { outcome, progress };
}

describe('AI analysis', () => {
  it('needs a finished library scan first', async () => {
    const factory = new IDBFactory();
    const clock = { now: 0 };
    const outcome = await runAnalysis({
      account: 'account-a', source: new FakePhotos([]), inventory: new IndexedDbInventoryStore(factory), store: new IndexedDbAnalysisStore(factory),
      embedder: new FakeEmbedder(clock, 100), decode, shouldStop: async () => false, pace: async () => {}, onProgress: async () => {},
    });
    expect(outcome.kind).toBe('not-started');
  });

  it('downloads the model, checks the speed, then analyses every photo once, newest first', async () => {
    const env = await setup();
    const clock = { now: 1_000 };
    const embedder = new FakeEmbedder(clock, 100); // 10 photos/s: a fast computer
    const { outcome, progress } = await analyse(env, embedder, clock);
    expect(outcome).toEqual({ kind: 'completed' });
    expect(progress.some((p) => p.stage === 'model' && p.modelPercent !== null)).toBe(true);
    const last = progress.at(-1)!;
    expect(last).toMatchObject({ photos: 10, analysed: 10, failed: 0, detail: 140 });
    expect(last.speedCheckText).toContain('10.0 photos/s at detail 140');
    expect(await env.store.settings('account-a')).toMatchObject({ detail: 140, modelKey: modelKey(140) });
    // The speed check's photos are kept: each photo is fingerprinted exactly once.
    expect(embedder.calls.map((c) => c.index).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(embedder.calls[0]!.index).toBe(0); // the newest photo first
    const saved = await env.store.embeddings(modelKey(140), 'account-a');
    expect(saved).toHaveLength(10);
    expect(saved[0]!.quality).toMatchObject({ width: 1, height: 1 });
    expect(await env.store.photoInfo('account-a')).toHaveLength(10);
  });

  it('a slow computer gets detail 70, and the speed check is not reused at the wrong detail', async () => {
    const env = await setup();
    const clock = { now: 0 };
    const embedder = new FakeEmbedder(clock, 2_000_000); // far beyond 4 hours for this library
    const { progress } = await analyse(env, embedder, clock);
    expect((await env.store.settings('account-a'))!.detail).toBe(70);
    expect(progress.at(-1)!.speedCheckText).toContain('uses detail 70');
    expect(await env.store.embeddings(modelKey(70), 'account-a')).toHaveLength(10);
    expect(await env.store.embeddings(modelKey(140), 'account-a')).toHaveLength(0);
  });

  it('a paused analysis resumes where it stopped, without repeating photos', async () => {
    // 30 photos: more than the speed check's 11, so the pause lands in the analysis proper.
    const env = await setup(Array.from({ length: 30 }, (_, i) => fakeItem(i)));
    const clock = { now: 0 };
    const embedder = new FakeEmbedder(clock, 100);
    let checks = 0;
    const first = await analyse(env, embedder, clock, { shouldStop: async () => ++checks > 20 });
    expect(first.outcome).toEqual({ kind: 'stopped' });
    const done = (await env.store.analysedKeys(modelKey(140))).size;
    expect(done).toBeGreaterThan(11);
    expect(done).toBeLessThan(30);

    embedder.calls.length = 0;
    const second = await analyse(env, embedder, clock);
    expect(second.outcome.kind).toBe('completed');
    expect(embedder.calls).toHaveLength(30 - done); // only the rest
    expect((await env.store.analysedKeys(modelKey(140))).size).toBe(30);
  });

  it('a preview that cannot be fetched is counted and tried again next time', async () => {
    const env = await setup();
    env.source.unavailablePreviews.add(5);
    const clock = { now: 0 };
    const embedder = new FakeEmbedder(clock, 100);
    const { progress } = await analyse(env, embedder, clock);
    expect(progress.at(-1)).toMatchObject({ analysed: 9, failed: 1 });

    env.source.unavailablePreviews.clear();
    embedder.calls.length = 0;
    await analyse(env, embedder, clock);
    expect(embedder.calls.map((c) => c.index)).toEqual([5]);
  });

  it('only photos are analysed, not videos', async () => {
    const env = await setup([fakeItem(0), fakeItem(1, { mediaType: 'VIDEO' }), fakeItem(2), fakeItem(3)]);
    const clock = { now: 0 };
    const embedder = new FakeEmbedder(clock, 100);
    const { progress } = await analyse(env, embedder, clock);
    expect(progress.at(-1)).toMatchObject({ photos: 3, analysed: 3 });
    expect(embedder.calls.map((c) => c.index)).not.toContain(1);
  });

  it('a lost session pauses with what to do', async () => {
    const env = await setup();
    env.source.failure = (op) => (op === 'preview' ? new SourceError('SESSION', 'signed out', 401) : null);
    const clock = { now: 0 };
    const { outcome } = await analyse(env, new FakeEmbedder(clock, 100), clock);
    expect(outcome.kind).toBe('paused');
    expect((outcome as { reason: string }).reason).toContain('session ended');
  });

  it('refuses to read another account\'s library', async () => {
    const env = await setup();
    env.source.accountFingerprint = 'account-b';
    const clock = { now: 0 };
    const { outcome } = await analyse(env, new FakeEmbedder(clock, 100), clock);
    expect(outcome.kind).toBe('paused');
    expect((outcome as { reason: string }).reason).toContain('different account');
    expect(await env.store.embeddings(modelKey(140), 'account-a')).toHaveLength(0);
  });

  it('when the model cannot start (no graphics card access, no disk space) it pauses with the reason', async () => {
    const env = await setup();
    const clock = { now: 0 };
    const embedder = new FakeEmbedder(clock, 100);
    embedder.loadError = new Error('Not enough free disk space for the AI model: about 368 MB is needed.');
    const { outcome } = await analyse(env, embedder, clock);
    expect(outcome).toEqual({ kind: 'paused', reason: 'Not enough free disk space for the AI model: about 368 MB is needed.' });
  });

  it('reports the speed and where each photo\'s time goes', async () => {
    // 30 photos: more than the speed check's 11, so the analysis proper is measured.
    const env = await setup(Array.from({ length: 30 }, (_, i) => fakeItem(i)));
    const clock = { now: 0 };
    const { progress } = await analyse(env, new FakeEmbedder(clock, 250), clock);
    const last = progress.at(-1)!;
    expect(last.photosPerSecond).toBeCloseTo(4);
    expect(last.perPhotoMs).toEqual({ other: 0, pace: 0, preview: 0, ai: 250, save: 0 });
  });

  it('shows why it is going gently', async () => {
    const env = await setup();
    const clock = { now: 0 };
    const { progress } = await analyse(env, new FakeEmbedder(clock, 100), clock, { waiting: 'Going gently while you use the computer.' });
    expect(progress.some((p) => p.waiting === 'Going gently while you use the computer.')).toBe(true);
  });
});
