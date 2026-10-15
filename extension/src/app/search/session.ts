// Connects Search to the saved data of one account: the latest library scan classified by the
// shared protection rules, the analysis's fingerprints, and the decisions (the trash queue).

import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { IndexedDbReviewStore } from '../duplicates/reviewStore';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { classify } from '../scan/report';
import { count } from '../shared/format';
import { previewDataUrl } from '../ui/hooks';
import type { LibraryPhoto, SearchDeps, SearchLibrary } from './searchModel';

const inventory = new IndexedDbInventoryStore();
const analysis = new IndexedDbAnalysisStore();
const review = new IndexedDbReviewStore();

/** The search field's AI model, loaded on the first text search (a separate file: search-ai.js). */
type TextModel = { embedQuery(text: string, onProgress: (fraction: number) => void): Promise<Float32Array> };
let textModel: Promise<TextModel> | null = null;

async function loadLibrary(account: string): Promise<SearchLibrary> {
  const run = await inventory.latestRun(account);
  if (!run) return { blocked: 'NOT_SCANNED', photos: new Map() };
  const snapshot = await inventory.snapshot(run.id);
  const classification = classify(snapshot, Date.now());
  const coverage = classification.report.coverage;
  if (!coverage.isComplete) return { blocked: 'SCAN_UNFINISHED', photos: new Map() };
  if (coverage.isStale) return { blocked: 'SCAN_STALE', photos: new Map() };
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
  return { blocked: null, photos };
}

/**
 * Moves the photos to the trash queue, after checking them again against a fresh classification:
 * all or nothing, so a photo favourited since the search is never trashed by it.
 */
async function sweep(account: string, mediaKeys: string[]): Promise<void> {
  if (mediaKeys.length === 0) throw new Error('Nothing is selected for the trash.');
  const library = await loadLibrary(account);
  if (library.blocked) throw new Error('The library scan is no longer usable; check for new photos on the Scan tab, then search again.');
  const stale = mediaKeys.filter((k) => { const p = library.photos.get(k); return !p || !p.eligible || p.approved; });
  if (stale.length > 0) {
    throw new Error(`${count(stale.length, 'selected photo is', 'selected photos are')} no longer eligible or already in the trash queue; search again.`);
  }
  const items = [...mediaKeys].sort().map((k) => ({ mediaKey: k, dedupKey: library.photos.get(k)!.dedupKey }));
  // A sweep's id never matches a duplicate group's (24 hex characters).
  await review.recordDecision(account, `sweep:${Date.now()}`, 'APPROVED', items, mediaKeys, Date.now());
}

export function searchDeps(account: string): SearchDeps {
  return {
    loadLibrary: () => loadLibrary(account),
    embedQuery: async (text, onProgress) => {
      textModel ??= import(/* @vite-ignore */ chrome.runtime.getURL('search-ai.js')) as Promise<TextModel>;
      return (await textModel).embedQuery(text, onProgress);
    },
    sweep: (mediaKeys) => sweep(account, mediaKeys),
    undo: () => review.undoLast(account, Date.now()),
    preview: (thumbUrl, sizePx) => previewDataUrl(account, thumbUrl, sizePx).catch(() => null),
  };
}
