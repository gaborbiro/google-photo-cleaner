// Connects the Duplicates review to the saved data of one account: the latest library scan, the
// analysis (fingerprints, quality, photo facts), the decisions and Google Photos' trash.

import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { PREFERRED_DETAIL } from '../ai/model';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { classify, type Classification } from '../scan/report';
import { runPageOp } from '../shared/pageOps';
import { IndexedDbPreferences } from '../shared/preferences';
import { browserSizeMemory } from '../shared/photoSize';
import { previewDataUrl } from '../shared/previews';
import { GoogleTrash, type RunPageOp } from './googleTrash';
import type { LoadedQueue, ReviewDeps } from './reviewModel';
import { IndexedDbReviewStore } from './reviewStore';
import { groupingSettings, reviewQueue, type AnalysedPhoto, type ReviewQueue } from './rules';
import { processTrashQueue, type TrashQueueDeps, type TrashQueueStatus } from './trash';

/** The saved data the Duplicates review and the trash queue read and write; tests pass their own. */
export interface DuplicatesStores {
  inventory: IndexedDbInventoryStore;
  analysis: IndexedDbAnalysisStore;
  review: IndexedDbReviewStore;
  /** Google Photos' own trash. */
  trash: GoogleTrash;
  preferences: IndexedDbPreferences;
}

export function duplicatesStores(factory: IDBFactory = indexedDB, run: RunPageOp = runPageOp): DuplicatesStores {
  return {
    inventory: new IndexedDbInventoryStore(factory),
    analysis: new IndexedDbAnalysisStore(factory),
    review: new IndexedDbReviewStore(factory),
    trash: new GoogleTrash(run),
    preferences: new IndexedDbPreferences(factory),
  };
}

let shared: DuplicatesStores | null = null;
const sharedStores = () => (shared ??= duplicatesStores());

async function loadQueue({ inventory, analysis, review, preferences }: DuplicatesStores, account: string, nowMs: number): Promise<LoadedQueue> {
  const run = await inventory.latestRun(account);
  const snapshot = run ? await inventory.snapshot(run.id) : null;
  const settings = await analysis.settings(account);
  const embeddings = settings ? await analysis.embeddings(settings.modelKey, account) : [];
  const info = new Map((await analysis.photoInfo(account)).map((i) => [i.mediaKey, i]));
  const photos: AnalysedPhoto[] = embeddings.map((e) => {
    const facts = info.get(e.mediaKey);
    return {
      mediaKey: e.mediaKey,
      sharpness: e.quality.sharpness,
      clipped: e.quality.clippedDark + e.quality.clippedBright,
      analysedAtMs: e.createdAtMs,
      uploadedAtMs: facts?.uploadedAtMs ?? null,
      width: facts?.width ?? null,
      height: facts?.height ?? null,
    };
  });
  const decisions = (await review.activeDecisions(account)).map(({ id, groupId, kind, items, members, createdAtMs }) => ({ id, groupId, kind, items, members, createdAtMs }));
  const choices = await preferences.protection(account);
  const queueAt = (atMs: number): ReviewQueue =>
    reviewQueue(snapshot, atMs, photos, embeddings.map((e) => e.vector), decisions, groupingSettings(settings?.detail ?? PREFERRED_DETAIL), choices);
  const queue = queueAt(nowMs);
  if (queue.blocked !== 'SCAN_STALE') return { ...queue, blocked: queue.blocked, scanOutOfDate: false };
  // An old scan proves nothing now, so every photo would be unknown. It is grouped as it was when it
  // finished, and protected photos stay kept; only approving waits for a fresh scan (the trash queue checks again).
  const finishedAtMs = snapshot?.run.finishedAtMs ?? null;
  if (finishedAtMs === null) throw new Error('A finished library scan has no finish time.');
  const asScanned = queueAt(finishedAtMs);
  if (asScanned.blocked === 'SCAN_STALE') throw new Error('A library scan is out of date even when it finished.');
  return { ...asScanned, blocked: asScanned.blocked, scanOutOfDate: true };
}

export function reviewDeps(account: string, stores: DuplicatesStores = sharedStores(), now: () => number = Date.now): ReviewDeps {
  return {
    loadQueue: () => loadQueue(stores, account, now()),
    record: async (group, kind, items) => {
      await stores.review.recordDecision(account, group.id, kind, items, group.members.map((m) => m.mediaKey), now());
    },
    undo: () => stores.review.undoLast(account, now()),
    preview: (thumbUrl, sizePx) => previewDataUrl(account, thumbUrl, sizePx),
    groupsLeft: async (count) => stores.review.saveSummary({ account, groupsToReview: count, atMs: now(), protection: await stores.preferences.protection(account) }),
    sizeMemory: browserSizeMemory('photo-cleaner.duplicates-photo-size'),
  };
}

/**
 * Works out how many groups [account] has waiting and saves it, so the popup can say so before the
 * review tab is opened (the background page does this when an analysis finishes). Nothing is saved
 * while the groups can't be built (no finished scan).
 */
export async function refreshReviewSummary(account: string, stores: DuplicatesStores = sharedStores(), now: () => number = Date.now): Promise<void> {
  const queue = await loadQueue(stores, account, now());
  if (queue.blocked) return;
  await stores.review.saveSummary({ account, groupsToReview: queue.pending.length, atMs: now(), protection: await stores.preferences.protection(account) });
}

/** The latest library scan, classified now with the account's current protection choices. */
async function classifyLatest({ inventory, preferences }: DuplicatesStores, account: string, nowMs: number): Promise<Classification | null> {
  const run = await inventory.latestRun(account);
  return run ? classify(await inventory.snapshot(run.id), nowMs, await preferences.protection(account)) : null;
}

export function trashQueueDeps(account: string, stores: DuplicatesStores = sharedStores(), now: () => number = Date.now): TrashQueueDeps {
  return { account, review: stores.review, trash: stores.trash, classify: () => classifyLatest(stores, account, now()), now };
}

/** One pass of [account]'s trash queue. */
export function trashQueuePass(account: string, stores: DuplicatesStores = sharedStores(), now: () => number = Date.now): Promise<TrashQueueStatus> {
  return processTrashQueue(trashQueueDeps(account, stores, now));
}
