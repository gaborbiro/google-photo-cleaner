// The AI analysis of one account's library. Reads the library again page by page (newest first, so preview links are
// fresh and recent photos are ready first), and for every photo not analysed yet fetches its
// 512 px preview, measures its quality, fingerprints it and saves both. Photos already analysed
// are skipped, so running again resumes. The first run starts with a speed check that chooses
// the detail for this library.

import type { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { plainMessage } from '../shared/errors';
import { INCOMPATIBLE_TEXT, isIncompatible, logGoogleProblem, PREVIEWS_STOPPED_TEXT, refusedText } from '../shared/googleProblems';
import { SourceError, waitingForPhotosText, waitsForPhotos, type AnalysisSource, type LibraryPhoto, type Preview } from '../scan/source';
import type { IndexedDbAnalysisStore } from './analysisStore';
import { chooseDetail, FALLBACK_DETAIL, modelKey, PREFERRED_DETAIL, PREVIEW_SIZE_PX, SPEED_CHECK_PHOTOS, type Detail } from './model';
import { measureQuality, type RgbaImage } from './quality';
import { SpeedMeter, type PhotoTiming } from './speed';

export interface Embedder {
  /** Downloads (first time) and prepares the model; [onProgress] gets 0–1. */
  load(onProgress: (fraction: number) => void): Promise<void>;
  /** An L2-normalised fingerprint of [image] at [detail]. */
  embed(image: RgbaImage, detail: Detail): Promise<Float32Array>;
}

export interface AnalysisProgress {
  stage: 'model' | 'speed-check' | 'analysing' | null;
  /** While the model downloads, 0–100. */
  modelPercent: number | null;
  /** Photos in the library scan, and how many of them have a fingerprint. */
  photos: number;
  analysed: number;
  /** Photos without a fingerprint when this run started (all of them the first time); null until known. */
  newPhotos: number | null;
  /** Of those, fingerprinted so far this run. */
  newAnalysed: number;
  /** Photos whose preview couldn't be fetched or read this run; tried again next run. */
  failed: number;
  /** Over the last minute, so changes show straight away. */
  photosPerSecond: number | null;
  etaSeconds: number | null;
  /** Where each photo's time went over the last minute, in ms. */
  perPhotoMs: PhotoTiming | null;
  detail: Detail | null;
  /** What the speed check found, in words; null until it ran. */
  speedCheckText: string | null;
  /** Why it is going slower or waiting right now (gentle mode); null at full speed. */
  waiting: string | null;
  notice: string | null;
}

export const NO_ANALYSIS: AnalysisProgress = {
  stage: null, modelPercent: null, photos: 0, analysed: 0, newPhotos: null, newAnalysed: 0, failed: 0, photosPerSecond: null, etaSeconds: null, perPhotoMs: null,
  detail: null, speedCheckText: null, waiting: null, notice: null,
};

export type AnalysisOutcome =
  | { kind: 'completed' }
  /** [untilPhotosOpen]: only Google Photos was missing; it continues by itself once it is back. */
  | { kind: 'paused'; reason: string; untilPhotosOpen: boolean }
  | { kind: 'stopped' }
  | { kind: 'not-started'; reason: string };

export interface AnalysisDeps {
  account: string;
  source: AnalysisSource;
  inventory: IndexedDbInventoryStore;
  store: IndexedDbAnalysisStore;
  embedder: Embedder;
  decode: (preview: Preview) => Promise<RgbaImage>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  shouldStop: () => Promise<boolean>;
  /**
   * Called before each photo with how long the last one took: waits as gentle mode asks (slower
   * while the computer is in use, not at all on battery), saying why through [show] while it
   * waits, and null when going at full speed.
   */
  pace: (lastPhotoMs: number, show: (waiting: string | null) => Promise<void>) => Promise<void>;
  onProgress: (progress: AnalysisProgress) => Promise<void>;
  /** Previews fetched ahead while the model works. */
  prefetch?: number;
  /**
   * How many new photos this job set out to analyse, when it was paused (or the browser closed) and
   * is now resumed: it goes on counting ("4,300 of 17,202": that total, less what is left now)
   * instead of from 0 of the photos left. Null for a new job.
   */
  newPhotosThisJob?: number | null;
}

class Pause extends Error {
  constructor(message: string, readonly untilPhotosOpen = false) {
    super(message);
  }
}
class UserStop extends Error {}

const MAX_PAGE_ATTEMPTS = 3;
/** The AI model failed to download or start for a reason it didn't explain itself (details in the log). */
export const MODEL_FAILED_TEXT = 'The AI model could not be downloaded or started. Check the internet connection, then resume.';
const MAX_RATE_LIMITS = 3;
const RATE_LIMIT_WAIT_MS = 30_000;
/**
 * This many photos in a row without a preview means previews stopped working altogether (Google changed
 * them, or the connection is gone), not that a few photos lack one: it pauses rather than counting the
 * whole library as failed.
 */
const MAX_FAILED_IN_A_ROW = 25;
const PROGRESS_EVERY_MS = 1_000;

export async function runAnalysis(deps: AnalysisDeps): Promise<AnalysisOutcome> {
  return new AnalysisSession(deps).execute();
}

class AnalysisSession {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private progress: AnalysisProgress = NO_ANALYSIS;
  private photoKeys = new Set<string>();
  private analysed = new Set<string>();
  private speed: SpeedMeter | null = null;
  private lastEmitMs = 0;

  constructor(private readonly deps: AnalysisDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async execute(): Promise<AnalysisOutcome> {
    const { inventory, account } = this.deps;
    const run = await inventory.latestRun(account);
    if (run?.status !== 'COMPLETED') {
      return { kind: 'not-started', reason: 'The analysis needs a finished library scan. Scan the library first.' };
    }
    const snapshot = await inventory.snapshot(run.id);
    this.photoKeys = new Set(snapshot.items.filter((i) => i.mediaType === 'PHOTO').map((i) => i.mediaKey));
    this.progress = { ...NO_ANALYSIS, photos: this.photoKeys.size };
    if (this.photoKeys.size === 0) {
      await this.emit(true);
      return { kind: 'completed' };
    }
    try {
      let settings = await this.deps.store.settings(account);
      if (settings) {
        this.analysed = intersect(await this.deps.store.analysedKeys(settings.modelKey, this.deps.account), this.photoKeys);
        // Nothing new since the last run: no model to start, no library to read again.
        if (this.analysed.size === this.photoKeys.size) {
          this.progress = { ...this.progress, detail: settings.detail, newPhotos: 0 };
          await this.emit(true);
          return { kind: 'completed' };
        }
        await this.loadModel();
      } else {
        await this.loadModel();
        settings = await this.speedCheck();
      }
      this.analysed = intersect(await this.deps.store.analysedKeys(settings.modelKey, this.deps.account), this.photoKeys);
      // (New photos found since the job started can make what is left larger than its total: then that counts.)
      const left = this.photoKeys.size - this.analysed.size;
      const total = Math.max(this.deps.newPhotosThisJob ?? 0, left);
      this.progress = { ...this.progress, detail: settings.detail, stage: 'analysing', newPhotos: total, newAnalysed: total - left };
      this.speed = new SpeedMeter(this.now());
      await this.emit(true);
      await this.analyseLibrary(settings.detail, settings.modelKey);
      this.progress = { ...this.progress, stage: null, waiting: null, etaSeconds: null };
      await this.emit(true);
      return { kind: 'completed' };
    } catch (e) {
      if (e instanceof UserStop) return { kind: 'stopped' };
      if (e instanceof Pause) {
        this.progress = { ...this.progress, notice: e.message, waiting: null };
        await this.emit(true);
        return { kind: 'paused', reason: e.message, untilPhotosOpen: e.untilPhotosOpen };
      }
      throw e;
    }
  }

  private async loadModel(): Promise<void> {
    this.progress = { ...this.progress, stage: 'model', modelPercent: 0 };
    await this.emit(true);
    try {
      await this.deps.embedder.load((fraction) => {
        this.progress = { ...this.progress, modelPercent: Math.floor(fraction * 100) };
        void this.emit(false);
      });
    } catch (e) {
      // No graphics card access, no disk space, no network for the download: say why, resumable.
      throw new Pause(plainMessage(e, MODEL_FAILED_TEXT));
    }
    this.progress = { ...this.progress, modelPercent: null };
  }

  /**
   * Fingerprints the newest few photos at the preferred detail, times it, and chooses the detail
   * for this library. At the preferred detail those fingerprints are kept.
   */
  private async speedCheck() {
    this.progress = { ...this.progress, stage: 'speed-check' };
    await this.emit(true);
    const images: { photo: LibraryPhoto; image: RgbaImage }[] = [];
    const sampled = new Set<string>();
    let failedInARow = 0;
    let token: string | null = null;
    do {
      await this.stopIfAsked();
      const page = await this.readPage(token);
      const photos = page.entries.filter((p) => this.photoKeys.has(p.mediaKey));
      await this.deps.store.savePhotoInfo(photos.map((p) => ({ account: this.deps.account, mediaKey: p.mediaKey, uploadedAtMs: p.uploadedAtMs, width: p.width, height: p.height })));
      for (const photo of page.entries) {
        if (!this.photoKeys.has(photo.mediaKey) || !photo.thumbUrl || sampled.has(photo.mediaKey)) continue;
        sampled.add(photo.mediaKey);
        const image = await this.fetchImage(photo);
        if (image) images.push({ photo, image });
        // Previews failing one after another have stopped working altogether: don't try the whole library.
        failedInARow = image ? 0 : failedInARow + 1;
        if (images.length === SPEED_CHECK_PHOTOS + 1 || failedInARow >= MAX_FAILED_IN_A_ROW) break;
      }
      token = page.nextPageToken;
    } while (token !== null && images.length < SPEED_CHECK_PHOTOS + 1 && failedInARow < MAX_FAILED_IN_A_ROW);
    if (images.length === 0 && failedInARow >= MAX_FAILED_IN_A_ROW) throw new Pause(PREVIEWS_STOPPED_TEXT);
    if (images.length === 0) throw new Pause('Not enough photo previews could be fetched for the speed check. Resume to try again.');
    // The first photo also prepares the graphics card, so it is not timed unless it is the only sample.
    const fingerprints: { photo: LibraryPhoto; image: RgbaImage; vector: Float32Array }[] = [];
    let timedMs = 0;
    for (const [index, { photo, image }] of images.entries()) {
      await this.stopIfAsked();
      const start = this.now();
      const vector = await this.deps.embedder.embed(image, PREFERRED_DETAIL);
      if (index > 0 || images.length === 1) timedMs += this.now() - start;
      fingerprints.push({ photo, image, vector });
    }
    const rate = Math.max(1, images.length - 1) / Math.max(timedMs / 1000, 0.001);
    const detail = chooseDetail(rate, this.photoKeys.size);
    const settings = { account: this.deps.account, detail, modelKey: modelKey(detail), measuredPhotosPerSecond: rate, chosenAtMs: this.now() };
    await this.deps.store.saveSettings(settings);
    if (detail === PREFERRED_DETAIL) {
      for (const f of fingerprints) await this.save(f.photo, f.image, f.vector, settings.modelKey);
    }
    this.progress = { ...this.progress, speedCheckText: speedCheckText(rate, this.photoKeys.size, detail) };
    return settings;
  }

  /**
   * Reads the library newest first and fingerprints every photo without one. New photos are
   * usually the newest, so reading stops as soon as none is left to do.
   */
  private async analyseLibrary(detail: Detail, key: string): Promise<void> {
    const pending = new Set([...this.photoKeys].filter((k) => !this.analysed.has(k)));
    let token: string | null = null;
    let lastPhotoMs = 0;
    let lastEnd: number | null = null;
    let failedInARow = 0;
    do {
      await this.stopIfAsked();
      const page = await this.readPage(token);
      const photos = page.entries.filter((p) => this.photoKeys.has(p.mediaKey));
      await this.deps.store.savePhotoInfo(photos.map((p) => ({ account: this.deps.account, mediaKey: p.mediaKey, uploadedAtMs: p.uploadedAtMs, width: p.width, height: p.height })));
      const todo = photos.filter((p) => !this.analysed.has(p.mediaKey));
      // Previews download a few photos ahead while the graphics card works on the current one.
      const ahead = this.deps.prefetch ?? 4;
      const fetches: Promise<RgbaImage | null>[] = todo.slice(0, ahead).map((p) => this.prefetch(p));
      for (let i = 0; i < todo.length; i++) {
        await this.stopIfAsked();
        const paceStart = this.now();
        lastEnd ??= paceStart;
        await this.deps.pace(lastPhotoMs, async (waiting) => {
          if (waiting === this.progress.waiting) return;
          this.progress = { ...this.progress, waiting };
          await this.emit(true);
        });
        const next = todo[i + ahead];
        if (next) fetches.push(this.prefetch(next));
        const previewStart = this.now();
        const image = await fetches[i]!;
        pending.delete(todo[i]!.mediaKey);
        if (image === null) {
          this.progress = { ...this.progress, failed: this.progress.failed + 1 };
          if (++failedInARow >= MAX_FAILED_IN_A_ROW) throw new Pause(PREVIEWS_STOPPED_TEXT);
          lastEnd = this.now();
          continue;
        }
        failedInARow = 0;
        const aiStart = this.now();
        const vector = await this.deps.embedder.embed(image, detail);
        const saveStart = this.now();
        await this.save(todo[i]!, image, vector, key);
        const end = this.now();
        lastPhotoMs = saveStart - aiStart;
        this.progress = { ...this.progress, newAnalysed: this.progress.newAnalysed + 1 };
        this.speed!.record(end, { other: paceStart - lastEnd, pace: previewStart - paceStart, preview: aiStart - previewStart, ai: saveStart - aiStart, save: end - saveStart });
        await this.emit(false);
        lastEnd = end;
      }
      token = page.nextPageToken;
    } while (token !== null && pending.size > 0);
  }

  private async save(photo: LibraryPhoto, image: RgbaImage, vector: Float32Array, key: string): Promise<void> {
    await this.deps.store.saveEmbedding({ modelKey: key, mediaKey: photo.mediaKey, account: this.deps.account, vector, quality: measureQuality(image), createdAtMs: this.now() });
    this.analysed.add(photo.mediaKey);
  }

  /** Starts fetching ahead; a failure surfaces when the photo's turn comes, not as an unhandled error before. */
  private prefetch(photo: LibraryPhoto): Promise<RgbaImage | null> {
    const fetching = this.fetchImage(photo);
    fetching.catch(() => {});
    return fetching;
  }

  /** A preview as pixels, or null when this photo's preview can't be had right now (counted as failed). */
  private async fetchImage(photo: LibraryPhoto): Promise<RgbaImage | null> {
    if (!photo.thumbUrl) return null;
    let rateLimits = 0;
    for (;;) {
      let preview: Preview;
      try {
        preview = await this.deps.source.preview(photo.thumbUrl, PREVIEW_SIZE_PX);
      } catch (e) {
        if (!(e instanceof SourceError)) throw e; // a bug, not this photo's fault: stops the run with its reason
        switch (e.kind) {
          case 'RATE_LIMIT':
            if (++rateLimits > MAX_RATE_LIMITS) throw new Pause('Google is limiting preview downloads. Resume the analysis later.');
            await this.sleep(RATE_LIMIT_WAIT_MS * rateLimits);
            break;
          case 'SESSION':
          case 'NO_PHOTOS_TAB':
            throw new Pause(waitingForPhotosText(e), true);
          case 'PROTOCOL':
          case 'BAD_REQUEST':
            logGoogleProblem('analysis: preview', e);
            throw new Pause(INCOMPATIBLE_TEXT);
          default: // this photo's preview is missing, or the network hiccuped: counted as failed, tried next time
            return null;
        }
        continue;
      }
      try {
        return await this.deps.decode(preview);
      } catch (e) {
        console.warn('Photo Cleaner: a photo preview could not be decoded', e);
        return null; // counted as failed, tried next time
      }
    }
  }

  private async readPage(token: string | null) {
    for (let attempt = 1; ; attempt++) {
      try {
        const page = await this.deps.source.libraryPhotos(token);
        if (page.accountFingerprint !== this.deps.account) {
          throw new Pause('The Google Photos tab is signed in to a different account. Switch it back, then resume.');
        }
        return page;
      } catch (e) {
        if (!(e instanceof SourceError)) throw e;
        if (waitsForPhotos(e)) throw new Pause(waitingForPhotosText(e), true);
        if (isIncompatible(e.kind)) {
          logGoogleProblem('analysis: library', e);
          throw new Pause(INCOMPATIBLE_TEXT);
        }
        if (attempt >= MAX_PAGE_ATTEMPTS) {
          if (e.kind === 'RATE_LIMIT') throw new Pause('Google is limiting requests. Resume the analysis later.');
          if (e.kind === 'TRANSIENT') throw new Pause('Google Photos could not be reached. Resume when the connection is back.');
          logGoogleProblem('analysis: library', e);
          throw new Pause(refusedText('library', e.rpcCode ?? e.httpStatus));
        }
        await this.sleep(5_000 * attempt);
      }
    }
  }

  private async stopIfAsked(): Promise<void> {
    if (await this.deps.shouldStop()) throw new UserStop();
  }

  /** Progress at most once a second while working, so saving it costs nothing noticeable. */
  private async emit(force: boolean): Promise<void> {
    const now = this.now();
    if (!force && now - this.lastEmitMs < PROGRESS_EVERY_MS) return;
    this.lastEmitMs = now;
    const recent = this.speed?.recent(now) ?? null;
    const rate = recent?.photosPerSecond ?? null;
    const remaining = this.photoKeys.size - this.analysed.size;
    this.progress = {
      ...this.progress,
      analysed: this.analysed.size,
      photosPerSecond: rate,
      etaSeconds: rate && remaining > 0 ? Math.round(remaining / rate) : null,
      perPhotoMs: recent?.perPhoto ?? null,
    };
    await this.deps.onProgress(this.progress);
  }
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a].filter((k) => b.has(k)));
}

/** "Speed check: 5.7 photos/s at detail 140, so your 17,202 photos take about 50 min." */
export function speedCheckText(rate: number, photos: number, detail: Detail): string {
  const minutes = Math.round(photos / rate / 60);
  const duration = minutes >= 90 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  const base = `Speed check: ${rate.toFixed(1)} photos/s at detail ${PREFERRED_DETAIL}`;
  return detail === PREFERRED_DETAIL
    ? `${base}, so your ${photos.toLocaleString('en-GB')} photos take about ${duration}.`
    : `${base}: about ${duration} for your ${photos.toLocaleString('en-GB')} photos, so this library uses detail ${FALLBACK_DETAIL}, about twice as fast and nearly as good.`;
}
