// Connects the Duplicates review to the saved data of one account: the latest library scan, the
// analysis (fingerprints, quality, photo facts), the decisions and the (simulated) trash.

import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { PREFERRED_DETAIL } from '../ai/model';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { classify, type Classification } from '../scan/report';
import { IndexedDbPreferences } from '../shared/preferences';
import { previewDataUrl } from '../ui/hooks';
import type { ReviewDeps } from './reviewModel';
import { IndexedDbReviewStore } from './reviewStore';
import { groupingSettings, reviewQueue, type AnalysedPhoto, type ReviewQueue } from './rules';
import { SimulatedTrash, type TrashQueueDeps } from './trash';

/** The saved data the Duplicates review and the trash queue read and write; tests pass their own. */
export interface DuplicatesStores {
  inventory: IndexedDbInventoryStore;
  analysis: IndexedDbAnalysisStore;
  review: IndexedDbReviewStore;
  trash: SimulatedTrash;
  preferences: IndexedDbPreferences;
}

export function duplicatesStores(factory: IDBFactory = indexedDB): DuplicatesStores {
  return {
    inventory: new IndexedDbInventoryStore(factory),
    analysis: new IndexedDbAnalysisStore(factory),
    review: new IndexedDbReviewStore(factory),
    trash: new SimulatedTrash(factory),
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
  };
}

/** The latest library scan, classified now with the account's current protection choices. */
async function classifyLatest({ inventory, preferences }: DuplicatesStores, account: string, nowMs: number): Promise<Classification | null> {
  const run = await inventory.latestRun(account);
  return run ? classify(await inventory.snapshot(run.id), nowMs, await preferences.protection(account)) : null;
}

export function trashQueueDeps(account: string, stores: DuplicatesStores = sharedStores(), now: () => number = Date.now): TrashQueueDeps {
  return { account, review: stores.review, trash: stores.trash, classify: () => classifyLatest(stores, account, now()), now };
}
