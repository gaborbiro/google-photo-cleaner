// Moving approved photos to the trash: the browser twin of the desktop's ProcessTrashQueueUseCase
// and SimulatedTrashService. Until M6 the trash is simulated: nothing is sent to Google.

import { committed, openDatabase, request, STORES } from '../shared/db';
import type { Classification } from '../scan/report';
import type { IndexedDbReviewStore, TrashJob, TrashJobState } from './reviewStore';

export interface TrashTarget {
  mediaKey: string;
  dedupKey: string;
}

export interface TrashOutcome {
  dedupKey: string;
  succeeded: boolean;
  error: string | null;
}

export interface TrashService {
  readonly simulated: boolean;
  moveToTrash(account: string, targets: TrashTarget[]): Promise<TrashOutcome[]>;
  restore(account: string, targets: TrashTarget[]): Promise<TrashOutcome[]>;
  /** Whether each dedup key is in the trash now. */
  inTrash(account: string, dedupKeys: string[]): Promise<Map<string, boolean>>;
}

/** Records what would be trashed, in the browser database; Google is never contacted. */
export class SimulatedTrash implements TrashService {
  readonly simulated = true;
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private database(): Promise<IDBDatabase> {
    this.db ??= openDatabase(this.factory, () => (this.db = null)).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  private async change(account: string, targets: TrashTarget[], put: boolean): Promise<TrashOutcome[]> {
    const tx = (await this.database()).transaction(STORES.simulatedTrash, 'readwrite');
    const store = tx.objectStore(STORES.simulatedTrash);
    for (const t of targets) {
      if (put) store.put({ account, dedupKey: t.dedupKey, mediaKey: t.mediaKey });
      else store.delete([account, t.dedupKey]);
    }
    await committed(tx);
    return targets.map((t) => ({ dedupKey: t.dedupKey, succeeded: true, error: null }));
  }

  moveToTrash(account: string, targets: TrashTarget[]) {
    return this.change(account, targets, true);
  }

  restore(account: string, targets: TrashTarget[]) {
    return this.change(account, targets, false);
  }

  async inTrash(account: string, dedupKeys: string[]): Promise<Map<string, boolean>> {
    const store = (await this.database()).transaction(STORES.simulatedTrash, 'readonly').objectStore(STORES.simulatedTrash);
    const found = await Promise.all(dedupKeys.map((k) => request(store.getKey([account, k]))));
    return new Map(dedupKeys.map((k, i) => [k, found[i] !== undefined]));
  }
}

export interface TrashQueueStatus {
  counts: Partial<Record<TrashJobState, number>>;
  simulated: boolean;
  /** Why queued jobs are not moving, e.g. the library scan needs refreshing; null when they are. */
  waitingReason: string | null;
}

export interface TrashQueueDeps {
  account: string;
  review: IndexedDbReviewStore;
  trash: TrashService;
  /** The latest library scan, classified now; null before any scan. */
  classify: () => Promise<Classification | null>;
  now: () => number;
  batchSize?: number;
}

/** At start: jobs left SENDING when a page closed mid-request become UNCERTAIN, to be checked before any retry. */
export async function recoverInterrupted(deps: TrashQueueDeps): Promise<void> {
  for (const job of await deps.review.jobs(deps.account, ['SENDING'])) {
    await deps.review.transition(job.id, 'SENDING', 'UNCERTAIN', 'Interrupted while sending', deps.now());
  }
}

/**
 * One pass of the trash queue:
 * 1. UNCERTAIN jobs are reconciled against the trash before anything is retried.
 * 2. Restorations requested by undo are carried out.
 * 3. Queued jobs are checked against a fresh, complete library scan: a photo no longer eligible
 *    (now a favourite, in an album, archived, unknown) is BLOCKED; the rest are sent.
 */
export async function processTrashQueue(deps: TrashQueueDeps): Promise<TrashQueueStatus> {
  await reconcileUncertain(deps);
  await restoreRequested(deps);
  const waitingReason = await sendQueued(deps);
  return { counts: await deps.review.jobCounts(deps.account), simulated: deps.trash.simulated, waitingReason };
}

const batch = (deps: TrashQueueDeps) => deps.batchSize ?? 25;

async function activeIds(deps: TrashQueueDeps): Promise<Set<number>> {
  return new Set((await deps.review.activeDecisions(deps.account)).map((d) => d.id));
}

async function reconcileUncertain(deps: TrashQueueDeps): Promise<void> {
  const uncertain = await deps.review.jobs(deps.account, ['UNCERTAIN'], batch(deps));
  if (uncertain.length === 0) return;
  const inTrash = await deps.trash.inTrash(deps.account, uncertain.map((j) => j.dedupKey));
  const active = await activeIds(deps);
  for (const job of uncertain) {
    // Undone while its outcome was unknown, and it never reached the trash: cancelled.
    const to: TrashJobState = inTrash.get(job.dedupKey) ? 'COMPLETED' : active.has(job.decisionId) ? 'QUEUED' : 'CANCELLED';
    await deps.review.transition(job.id, 'UNCERTAIN', to, null, deps.now());
  }
  // A reconciled COMPLETED job whose decision was undone in the meantime still needs restoring.
  await markUndoneCompletions(deps, uncertain);
}

async function restoreRequested(deps: TrashQueueDeps): Promise<void> {
  const jobs = await deps.review.jobs(deps.account, ['RESTORE_REQUESTED'], batch(deps));
  if (jobs.length === 0) return;
  const outcomes = new Map((await deps.trash.restore(deps.account, jobs.map(target))).map((o) => [o.dedupKey, o]));
  for (const job of jobs) {
    const outcome = outcomes.get(job.dedupKey);
    // A failed restore stays RESTORE_REQUESTED and is retried; the error is kept for display.
    if (outcome?.succeeded) await deps.review.transition(job.id, 'RESTORE_REQUESTED', 'RESTORED', null, deps.now());
    else await deps.review.transition(job.id, 'RESTORE_REQUESTED', 'RESTORE_REQUESTED', outcome?.error ?? 'No result', deps.now());
  }
}

/** Returns why queued jobs are waiting, or null. */
async function sendQueued(deps: TrashQueueDeps): Promise<string | null> {
  const queued = await deps.review.jobs(deps.account, ['QUEUED'], batch(deps));
  if (queued.length === 0) return null;
  const classification = await deps.classify();
  if (classification === null) return 'Waiting: no library scan.';
  const coverage = classification.report.coverage;
  if (!coverage.isComplete) return 'Waiting: the library scan is unfinished. Finish it to continue.';
  if (coverage.isStale) return 'Waiting: the library scan is out of date. Check for new photos to continue.';
  const eligibility = new Map(classification.items.map((i) => [i.mediaKey, i.eligibility]));
  const identities = new Map(classification.items.map((i) => [i.mediaKey, i.dedupKey]));
  // Videos are never cleanup candidates, whatever approved them.
  const photos = new Set(classification.items.filter((i) => i.mediaType === 'PHOTO').map((i) => i.mediaKey));
  const active = await activeIds(deps);

  const sendable: TrashJob[] = [];
  for (const job of queued) {
    const now = eligibility.get(job.mediaKey);
    if (!active.has(job.decisionId)) await deps.review.transition(job.id, 'QUEUED', 'CANCELLED', null, deps.now());
    else if (identities.has(job.mediaKey) && identities.get(job.mediaKey) !== job.dedupKey) {
      await deps.review.transition(job.id, 'QUEUED', 'BLOCKED', 'Photo identity changed since approval', deps.now());
    } else if (now === 'ELIGIBLE' && !photos.has(job.mediaKey)) {
      await deps.review.transition(job.id, 'QUEUED', 'BLOCKED', 'Not a photo: only photos are trashed', deps.now());
    } else if (now === 'ELIGIBLE') sendable.push(job);
    else if (now === undefined) await deps.review.transition(job.id, 'QUEUED', 'BLOCKED', 'No longer in the library', deps.now());
    else await deps.review.transition(job.id, 'QUEUED', 'BLOCKED', `No longer eligible (${now})`, deps.now());
  }
  const sending: TrashJob[] = [];
  for (const job of sendable) if (await deps.review.transition(job.id, 'QUEUED', 'SENDING', null, deps.now())) sending.push(job);
  if (sending.length === 0) return null;
  const outcomes = new Map((await deps.trash.moveToTrash(deps.account, sending.map(target))).map((o) => [o.dedupKey, o]));
  for (const job of sending) {
    const outcome = outcomes.get(job.dedupKey);
    if (outcome?.succeeded) await deps.review.transition(job.id, 'SENDING', 'COMPLETED', null, deps.now());
    else await deps.review.transition(job.id, 'SENDING', 'FAILED', outcome?.error ?? 'No result for this photo', deps.now());
  }
  await markUndoneCompletions(deps, sending);
  return null;
}

/** Jobs whose decision was undone while they were in flight are restored rather than left in the trash. */
async function markUndoneCompletions(deps: TrashQueueDeps, jobs: TrashJob[]): Promise<void> {
  const active = await activeIds(deps);
  for (const job of jobs) {
    if (!active.has(job.decisionId)) await deps.review.transition(job.id, 'COMPLETED', 'RESTORE_REQUESTED', null, deps.now());
  }
}

const target = (job: TrashJob): TrashTarget => ({ mediaKey: job.mediaKey, dedupKey: job.dedupKey });
