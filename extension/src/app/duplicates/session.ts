// Connects the Duplicates review to the saved data of one account: the latest library scan, the
// analysis (fingerprints, quality, photo facts), the decisions and the trash: simulated, or Google
// Photos' own when the account has "Trash for real" on.

import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { PREFERRED_DETAIL } from '../ai/model';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { classify, type Classification } from '../scan/report';
import { runPageOp } from '../shared/pageOps';
import { IndexedDbPreferences } from '../shared/preferences';
import { previewDataUrl } from '../shared/previews';
import { GoogleTrash, type RunPageOp } from './googleTrash';
import type { ReviewDeps } from './reviewModel';
import { IndexedDbReviewStore } from './reviewStore';
import { groupingSettings, reviewQueue, type AnalysedPhoto, type ReviewQueue } from './rules';
import { processTrashQueue, SimulatedTrash, type TrashQueueDeps, type TrashQueueStatus } from './trash';

/** The saved data the Duplicates review and the trash queue read and write; tests pass their own. */
export interface DuplicatesStores {
  inventory: IndexedDbInventoryStore;
  analysis: IndexedDbAnalysisStore;
  review: IndexedDbReviewStore;
  /** Where trashed photos go while trashing is simulated. */
  trash: SimulatedTrash;
  /** Google Photos' own trash, for accounts with "Trash for real" on. */
  googleTrash: GoogleTrash;
  preferences: IndexedDbPreferences;
}

export function duplicatesStores(factory: IDBFactory = indexedDB, run: RunPageOp = runPageOp): DuplicatesStores {
  return {
    inventory: new IndexedDbInventoryStore(factory),
    analysis: new IndexedDbAnalysisStore(factory),
    review: new IndexedDbReviewStore(factory),
    trash: new SimulatedTrash(factory),
    googleTrash: new GoogleTrash(run),
    preferences: new IndexedDbPreferences(factory),
  };
}

let shared: DuplicatesStores | null = null;
const sharedStores = () => (shared ??= duplicatesStores());

async function loadQueue({ inventory, analysis, review, preferences }: DuplicatesStores, account: string, nowMs: number): Promise<ReviewQueue> {
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
  return reviewQueue(snapshot, nowMs, photos, embeddings.map((e) => e.vector), decisions, groupingSettings(settings?.detail ?? PREFERRED_DETAIL), await preferences.protection(account));
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
  };
}

/**
 * Works out how many groups [account] has waiting and saves it, so the popup can say so before the
 * review tab is opened (the background page does this when an analysis finishes). Nothing is saved
 * while the groups can't be built (no finished, recent scan).
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

/**
 * One pass of [account]'s trash queue, with the trash its "Trash for real" choice says: Google Photos'
 * own when on, the simulated one otherwise (read again at every pass, so turning it off stops sending).
 */
export async function trashQueuePass(account: string, stores: DuplicatesStores = sharedStores(), now: () => number = Date.now): Promise<TrashQueueStatus> {
  const trash = (await stores.preferences.trashForReal(account)) ? stores.googleTrash : stores.trash;
  return processTrashQueue({ ...trashQueueDeps(account, stores, now), trash });
}
