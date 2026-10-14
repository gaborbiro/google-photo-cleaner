// Connects the Duplicates review to the saved data of one account: the latest library scan, the
// analysis (fingerprints, quality, photo facts), the decisions and the (simulated) trash.

import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { PREFERRED_DETAIL } from '../ai/model';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { classify, type Classification } from '../scan/report';
import { previewDataUrl } from '../ui/hooks';
import type { ReviewDeps } from './reviewModel';
import { IndexedDbReviewStore } from './reviewStore';
import { groupingSettings, reviewQueue, type AnalysedPhoto, type ReviewQueue } from './rules';
import { SimulatedTrash, type TrashQueueDeps } from './trash';

const inventory = new IndexedDbInventoryStore();
const analysis = new IndexedDbAnalysisStore();
const review = new IndexedDbReviewStore();
const trash = new SimulatedTrash();

async function loadQueue(account: string): Promise<ReviewQueue> {
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
  return reviewQueue(snapshot, Date.now(), photos, embeddings.map((e) => e.vector), decisions, groupingSettings(settings?.detail ?? PREFERRED_DETAIL));
}

export function reviewDeps(account: string): ReviewDeps {
  return {
    loadQueue: () => loadQueue(account),
    record: async (group, kind, items) => {
      await review.recordDecision(account, group.id, kind, items, group.members.map((m) => m.mediaKey), Date.now());
    },
    undo: () => review.undoLast(account, Date.now()),
    preview: (thumbUrl, sizePx) => previewDataUrl(account, thumbUrl, sizePx).catch(() => null),
  };
}

async function classifyLatest(account: string): Promise<Classification | null> {
  const run = await inventory.latestRun(account);
  return run ? classify(await inventory.snapshot(run.id), Date.now()) : null;
}

export function trashQueueDeps(account: string): TrashQueueDeps {
  return { account, review, trash, classify: () => classifyLatest(account), now: Date.now };
}
