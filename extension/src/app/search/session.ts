// Connects Search to the saved data of one account: the latest library scan classified by the
// shared protection rules, the analysis's fingerprints, and the decisions (the trash queue).

import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { IndexedDbReviewStore } from '../duplicates/reviewStore';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { classify } from '../scan/report';
import { IndexedDbPreferences } from '../shared/preferences';
import { browserSizeMemory } from '../shared/photoSize';
import { previewDataUrl } from '../shared/previews';
import type { LibraryPhoto, SearchDeps, SearchLibrary, SweepResult } from './searchModel';

/** The saved data Search reads and writes; tests pass their own. */
export interface SearchStores {
  inventory: IndexedDbInventoryStore;
  analysis: IndexedDbAnalysisStore;
  review: IndexedDbReviewStore;
  preferences: IndexedDbPreferences;
}

export function searchStores(factory: IDBFactory = indexedDB): SearchStores {
  return {
    inventory: new IndexedDbInventoryStore(factory),
    analysis: new IndexedDbAnalysisStore(factory),
    review: new IndexedDbReviewStore(factory),
    preferences: new IndexedDbPreferences(factory),
  };
}

let shared: SearchStores | null = null;

/** The search field's AI model, loaded on the first text search (a separate file: search-ai.js). */
type TextModel = { embedQuery(text: string, onProgress: (fraction: number) => void): Promise<Float32Array> };
let textModel: Promise<TextModel> | null = null;

async function loadLibrary({ inventory, analysis, review, preferences }: SearchStores, account: string, nowMs: number): Promise<SearchLibrary> {
  const protection = await preferences.protection(account);
  const run = await inventory.latestRun(account);
  if (!run) return { blocked: 'NOT_SCANNED', photos: new Map(), protection };
  const snapshot = await inventory.snapshot(run.id);
  const classification = classify(snapshot, nowMs, protection);
  const coverage = classification.report.coverage;
  if (!coverage.isComplete) return { blocked: 'SCAN_UNFINISHED', photos: new Map(), protection };
  if (coverage.isStale) return { blocked: 'SCAN_STALE', photos: new Map(), protection };
  const settings = await analysis.settings(account);
  const vectors = new Map((settings ? await analysis.embeddings(settings.modelKey, account) : []).map((e) => [e.mediaKey, e.vector]));
  const eligibility = new Map(classification.items.map((i) => [i.mediaKey, i.eligibility]));
  const approved = new Set((await review.activeDecisions(account)).filter((d) => d.kind === 'APPROVED').flatMap((d) => d.items.map((i) => i.mediaKey)));
  const photos = new Map<string, LibraryPhoto>();
  for (const item of snapshot.items) {
    const vector = vectors.get(item.mediaKey);
    // Photos only, and only analysed ones: videos and photos not analysed yet can't be searched.
    if (item.mediaType !== 'PHOTO' || !vector) continue;
    photos.set(item.mediaKey, {
      mediaKey: item.mediaKey,
      dedupKey: item.dedupKey,
      takenAtMs: item.takenAtMs,
      thumbUrl: item.thumbUrl,
      vector,
      eligible: eligibility.get(item.mediaKey) === 'ELIGIBLE',
      approved: approved.has(item.mediaKey),
    });
  }
  return { blocked: null, photos, protection };
}

/**
 * Moves the photos to the trash queue, after checking each again against a fresh classification: one
 * favourited, put in an album or queued elsewhere since the search is left out, never trashed by it;
 * the rest go. Nothing goes while the scan can't be trusted.
 */
async function sweep(stores: SearchStores, account: string, mediaKeys: string[], nowMs: number): Promise<SweepResult> {
  if (mediaKeys.length === 0) throw new Error('Nothing is selected for the trash.');
  const library = await loadLibrary(stores, account, nowMs);
  if (library.blocked) throw new Error('The library scan is no longer usable; check for new photos on the Scan tab, then search again.');
  const stillTrashable = (k: string) => { const p = library.photos.get(k); return p !== undefined && p.eligible && !p.approved; };
  const queued = mediaKeys.filter(stillTrashable);
  const leftOut = mediaKeys.filter((k) => !stillTrashable(k));
  if (queued.length > 0) {
    const items = [...queued].sort().map((k) => ({ mediaKey: k, dedupKey: library.photos.get(k)!.dedupKey }));
    // A sweep's id never matches a duplicate group's (24 hex characters).
    await stores.review.recordDecision(account, `sweep:${nowMs}`, 'APPROVED', items, queued, nowMs);
  }
  return { queued, leftOut };
}

export function searchDeps(account: string, stores: SearchStores = (shared ??= searchStores()), now: () => number = Date.now): SearchDeps {
  return {
    loadLibrary: () => loadLibrary(stores, account, now()),
    embedQuery: async (text, onProgress) => {
      textModel ??= import(/* @vite-ignore */ chrome.runtime.getURL('search-ai.js')) as Promise<TextModel>;
      return (await textModel).embedQuery(text, onProgress);
    },
    sweep: (mediaKeys) => sweep(stores, account, mediaKeys, now()),
    undo: () => stores.review.undoLast(account, now()),
    preview: (thumbUrl, sizePx) => previewDataUrl(account, thumbUrl, sizePx),
    sizeMemory: browserSizeMemory('photo-cleaner.search-photo-size'),
  };
}
