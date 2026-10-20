// The AI analysis, scenario by scenario, with a fake model and a fake clock against the real
// IndexedDB stores (in memory).

import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { MODEL_FAILED_TEXT, runAnalysis, type AnalysisProgress, type Embedder } from '../../src/app/ai/analysis';
import { PlainError } from '../../src/app/shared/errors';
import { IndexedDbAnalysisStore } from '../../src/app/ai/analysisStore';
import { modelKey, type Detail } from '../../src/app/ai/model';
import type { RgbaImage } from '../../src/app/ai/quality';
import { IndexedDbInventoryStore } from '../../src/app/scan/inventoryStore';
import { SourceError } from '../../src/app/scan/source';
import { INCOMPATIBLE_TEXT, PREVIEWS_STOPPED_TEXT } from '../../src/app/shared/googleProblems';
import { AnalysisStats } from '../../src/app/shared/runStats';
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
  opts: { shouldStop?: () => Promise<boolean>; waiting?: string | null; account?: string; decode?: typeof decode; newPhotosThisJob?: number | null; stats?: AnalysisStats } = {},
) {
  const progress: AnalysisProgress[] = [];
  const outcome = await runAnalysis({
    account: opts.account ?? 'account-a',
    source: env.source,
    inventory: env.inventory,
    store: env.store,
    embedder,
    decode: opts.decode ?? decode,
    now: () => clock.now,
    sleep: async () => {},
    shouldStop: opts.shouldStop ?? (async () => false),
    pace: async (_last, show) => show(opts.waiting ?? null),
    onProgress: async (p) => void progress.push(p),
    prefetch: 2,
    newPhotosThisJob: opts.newPhotosThisJob,
    stats: opts.stats,
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
    const done = (await env.store.analysedKeys(modelKey(140), 'account-a')).size;
    expect(done).toBeGreaterThan(11);
    expect(done).toBeLessThan(30);

    embedder.calls.length = 0;
    const second = await analyse(env, embedder, clock);
    expect(second.outcome.kind).toBe('completed');
    expect(embedder.calls).toHaveLength(30 - done); // only the rest
    expect((await env.store.analysedKeys(modelKey(140), 'account-a')).size).toBe(30);
  });

  it('a resumed analysis goes on counting where the job stopped, instead of from 0 of the photos left', async () => {
    const env = await setup(Array.from({ length: 80 }, (_, i) => fakeItem(i)));
    const clock = { now: 0 };
    let checks = 0;
    const first = await analyse(env, new FakeEmbedder(clock, 100), clock, { shouldStop: async () => ++checks > 80 });
    const stoppedAt = first.progress.at(-1)!;
    expect(stoppedAt.newPhotos).toBe(80 - 11); // the job's total; the speed check analysed the first 11
    const done = (await env.store.analysedKeys(modelKey(140), 'account-a')).size - 11;
    expect(done).toBeGreaterThan(0);

    const resumed = await analyse(env, new FakeEmbedder(clock, 100), clock, { newPhotosThisJob: stoppedAt.newPhotos });
    const firstShown = resumed.progress.find((p) => p.stage === 'analysing')!;
    // e.g. "46 of 69", not "0 of 23": exact, although progress was last saved a little before the pause.
    expect(firstShown).toMatchObject({ newPhotos: 69, newAnalysed: done });
    expect(resumed.progress.at(-1)).toMatchObject({ newPhotos: 69, newAnalysed: 69 });

    // A new job (Check for new photos) counts only what is left, from 0.
    const fresh = await analyse(env, new FakeEmbedder(clock, 100), clock, { newPhotosThisJob: null });
    expect(fresh.progress.at(-1)).toMatchObject({ newPhotos: 0 }); // nothing new: done at once
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

  it('when previews stop coming altogether it pauses instead of counting the whole library as failed', async () => {
    const env = await setup(Array.from({ length: 60 }, (_, i) => fakeItem(i)));
    let previews = 0;
    env.source.failure = (op) => (op === 'preview' && ++previews > 11 ? new SourceError('PREVIEW_UNAVAILABLE', 'HTTP 404 fetching preview', 404) : null);
    const clock = { now: 0 };
    const { outcome, progress } = await analyse(env, new FakeEmbedder(clock, 100), clock);
    expect(outcome).toEqual({ kind: 'paused', reason: PREVIEWS_STOPPED_TEXT, untilPhotosOpen: false });
    expect(progress.at(-1)!.failed).toBe(25);

    env.source.failure = () => null;
    const resumed = await analyse(env, new FakeEmbedder(clock, 100), clock);
    expect(resumed.outcome.kind).toBe('completed');
    expect((await env.store.analysedKeys(modelKey(140), 'account-a')).size).toBe(60);
  });

  it('when no preview works at all, the speed check gives up after 25 tries instead of trying the whole library', async () => {
    const env = await setup(Array.from({ length: 200 }, (_, i) => fakeItem(i)));
    let previews = 0;
    env.source.failure = (op) => (op === 'preview' && ++previews > 0 ? new SourceError('PREVIEW_UNAVAILABLE', 'HTTP 404 fetching preview', 404) : null);
    const clock = { now: 0 };
    const { outcome } = await analyse(env, new FakeEmbedder(clock, 100), clock);
    expect(outcome).toEqual({ kind: 'paused', reason: PREVIEWS_STOPPED_TEXT, untilPhotosOpen: false });
    expect(previews).toBe(25);
  });

  it('an answer from Google it does not understand stops it, saying so, before counting anything as failed', async () => {
    for (const [op, kind] of [['preview', 'BAD_REQUEST'], ['preview', 'PROTOCOL'], ['library', 'PROTOCOL']] as const) {
      const env = await setup(Array.from({ length: 30 }, (_, i) => fakeItem(i)));
      let calls = 0;
      // Previews fail after the speed check's 11.
      env.source.failure = (o) => (o === op && ++calls > (op === 'preview' ? 11 : 0) ? new SourceError(kind, 'shape changed') : null);
      const clock = { now: 0 };
      const { outcome, progress } = await analyse(env, new FakeEmbedder(clock, 100), clock);
      expect(outcome).toEqual({ kind: 'paused', reason: INCOMPATIBLE_TEXT, untilPhotosOpen: false });
      expect(progress.at(-1)?.failed ?? 0).toBe(0);
      // Saved with the job, for a support request.
      expect(progress.at(-1)?.googleProblem).toEqual({ where: `analysis: ${op}`, kind, message: 'shape changed', rpcCode: null, httpStatus: null });
    }
  });

  it('a preview that cannot be decoded counts as one failed photo; a bug stops the run instead', async () => {
    const env = await setup();
    const clock = { now: 0 };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const brokenFive = async (p: { bytes: Uint8Array }) => {
      if (p.bytes[0] === 5) throw new Error('not an image');
      return decode(p);
    };
    const { progress } = await analyse(env, new FakeEmbedder(clock, 100), clock, { decode: brokenFive });
    expect(progress.at(-1)).toMatchObject({ analysed: 9, failed: 1 });
    warn.mockRestore();

    const fresh = await setup();
    fresh.source.failure = (op) => (op === 'preview' ? (new TypeError('a bug') as unknown as SourceError) : null);
    await expect(analyse(fresh, new FakeEmbedder(clock, 100), clock)).rejects.toThrow('a bug');
  });

  it('each account has its own fingerprints, even for a photo key both share', async () => {
    const env = await setup();
    const clock = { now: 0 };
    await analyse(env, new FakeEmbedder(clock, 100), clock);
    // The same photo keys, signed in to another Google account.
    env.source.accountFingerprint = 'account-b';
    await scan(env.source, env.inventory, { account: 'account-b' });
    const embedder = new FakeEmbedder(clock, 100);
    const { outcome } = await analyse(env, embedder, clock, { account: 'account-b' });
    expect(outcome.kind).toBe('completed');
    expect(new Set(embedder.calls.map((c) => c.index)).size).toBe(10); // none skipped as "already analysed"
    expect(await env.store.embeddings(modelKey(140), 'account-a')).toHaveLength(10);
    expect(await env.store.embeddings(modelKey(140), 'account-b')).toHaveLength(10);
    expect((await env.store.analysedKeys(modelKey(140), 'account-b')).size).toBe(10);
  });

  it('only photos are analysed, not videos', async () => {
    const env = await setup([fakeItem(0), fakeItem(1, { mediaType: 'VIDEO' }), fakeItem(2), fakeItem(3)]);
    const clock = { now: 0 };
    const embedder = new FakeEmbedder(clock, 100);
    const { progress } = await analyse(env, embedder, clock);
    expect(progress.at(-1)).toMatchObject({ photos: 3, analysed: 3 });
    expect(embedder.calls.map((c) => c.index)).not.toContain(1);
  });

  it('a lost session pauses until Google Photos is signed in again, saying so', async () => {
    const env = await setup();
    env.source.failure = (op) => (op === 'preview' ? new SourceError('SESSION', 'signed out', 401) : null);
    const clock = { now: 0 };
    const { outcome } = await analyse(env, new FakeEmbedder(clock, 100), clock);
    expect(outcome).toEqual({ kind: 'paused', reason: 'Google Photos is signed out. Sign in again at photos.google.com; the scan continues by itself.', untilPhotosOpen: true });
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
    embedder.loadError = new PlainError('Not enough free disk space for the AI model: about 368 MB is needed.');
    const { outcome } = await analyse(env, embedder, clock);
    expect(outcome).toEqual({ kind: 'paused', reason: 'Not enough free disk space for the AI model: about 368 MB is needed.', untilPhotosOpen: false });

    // A failure the model didn't explain (e.g. the download broke off): plain words, details in the log.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    embedder.loadError = new TypeError('Failed to fetch');
    const second = await analyse(env, embedder, clock);
    expect(second.outcome).toEqual({ kind: 'paused', reason: MODEL_FAILED_TEXT, untilPhotosOpen: false });
    warn.mockRestore();
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

  it('a run with nothing new finishes at once: no model to start, no library to read', async () => {
    const env = await setup(Array.from({ length: 30 }, (_, i) => fakeItem(i)));
    const clock = { now: 0 };
    const embedder = new FakeEmbedder(clock, 100);
    await analyse(env, embedder, clock);
    let loads = 0;
    embedder.load = async () => void loads++;
    env.source.calls.length = 0;
    const { outcome, progress } = await analyse(env, embedder, clock);
    expect(outcome).toEqual({ kind: 'completed' });
    expect(loads).toBe(0);
    expect(env.source.calls).toEqual([]);
    expect(progress.at(-1)).toMatchObject({ photos: 30, analysed: 30, newPhotos: 0 });
  });

  it('new photos are the newest: reading stops as soon as they are done', async () => {
    // 30 photos, 3 a page, newest first; then 2 newer ones arrive at the top.
    const library = Array.from({ length: 30 }, (_, i) => fakeItem(i + 2));
    const env = await setup(library);
    const clock = { now: 0 };
    const embedder = new FakeEmbedder(clock, 100);
    await analyse(env, embedder, clock);
    env.source.library.unshift(fakeItem(0), fakeItem(1));
    await scan(env.source, env.inventory);
    env.source.calls.length = 0;
    embedder.calls.length = 0;
    const { progress } = await analyse(env, embedder, clock);
    expect(embedder.calls.map((c) => c.index).sort()).toEqual([0, 1]);
    expect(env.source.calls.filter((c) => c === 'library')).toHaveLength(1); // the first page only, not all 11
    expect(progress.at(-1)).toMatchObject({ photos: 32, analysed: 32, newPhotos: 2, newAnalysed: 2 });
  });

  it('shows why it is going gently', async () => {
    // More than the benchmark sample: exercise the paced analysis, not just the speed check.
    const env = await setup(Array.from({ length: 30 }, (_, i) => fakeItem(i)));
    const clock = { now: 0 };
    const { progress } = await analyse(env, new FakeEmbedder(clock, 100), clock, { waiting: 'Going gently while you use the computer.' });
    expect(progress.some((p) => p.waiting === 'Going gently while you use the computer.')).toBe(true);
  });
});

describe("the analysis run's numbers (for Copy diagnostics)", () => {
  it('counts the photos it did and where their time went; a run with nothing new says so', async () => {
    const env = await setup(Array.from({ length: 40 }, (_, i) => fakeItem(i)));
    env.source.unavailablePreviews.add(39);
    const clock = { now: 1_000 };
    const first = new AnalysisStats();
    await analyse(env, new FakeEmbedder(clock, 100), clock, { stats: first });
    const s = first.stats;
    expect(s).toMatchObject({ stage: 'analysis', photos: 40, previewsFailed: 1, detail: expect.any(Number), measuredPhotosPerSecond: expect.any(Number) });
    // What the speed check kept counts as analysed before; the rest was done here, at 100 ms of AI each.
    expect(s.alreadyAnalysed + s.photosDone + s.previewsFailed).toBe(40);
    expect(s.photosDone).toBeGreaterThan(0);
    expect(s.aiMs).toBe(s.photosDone * 100);
    expect(s.speedCheckMs).toBeGreaterThan(0);

    env.source.unavailablePreviews.clear();
    await analyse(env, new FakeEmbedder(clock, 100), clock); // the photo that failed
    const nothingNew = new AnalysisStats();
    await analyse(env, new FakeEmbedder(clock, 100), clock, { stats: nothingNew });
    expect(nothingNew.stats).toMatchObject({ photos: 40, alreadyAnalysed: 40, photosDone: 0, previewsFailed: 0, modelMs: 0 });
  });
});