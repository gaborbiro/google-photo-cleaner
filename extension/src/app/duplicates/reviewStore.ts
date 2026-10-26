// Where review decisions and the trash queue are saved, per Google account. Recording an approval saves the selection and queues
// one trash job per photo in the same transaction; undoing is one transaction too.

import { CHANGES_CHANNEL } from '../shared/constants';
import { decisionSource, emitUsage } from '../shared/usageClient';
import { committed, openDatabase, request, STORES } from '../shared/db';
import type { ProtectionChoices } from '../shared/preferences';
import type { ActiveDecision, DecisionKind } from './rules';

export type TrashJobState =
  /** Waiting to be sent. */
  | 'QUEUED'
  /** Sent; no result recorded yet. If the page closes now the outcome is uncertain. */
  | 'SENDING'
  /** Interrupted while SENDING; must be reconciled with the trash before any retry. */
  | 'UNCERTAIN'
  /** Confirmed in the trash. */
  | 'COMPLETED'
  /** The trash request failed; see the error. */
  | 'FAILED'
  /** No longer eligible when checked again; never sent. */
  | 'BLOCKED'
  /** Undone before it was sent. */
  | 'CANCELLED'
  /** Undone after it was trashed: waiting to be restored. */
  | 'RESTORE_REQUESTED'
  /** Confirmed restored from the trash. */
  | 'RESTORED';

export interface StoredDecision extends ActiveDecision {
  account: string;
  undoneAtMs: number | null;
}

export interface TrashJob {
  id: number;
  account: string;
  decisionId: number;
  mediaKey: string;
  dedupKey: string;
  state: TrashJobState;
  attempts: number;
  lastError: string | null;
  updatedAtMs: number;
}

type NewRecord<T> = Omit<T, 'id'>;

/** How many duplicate groups wait for a decision (skipped ones included), worked out at [atMs] with [protection]. */
export interface ReviewSummary {
  account: string;
  groupsToReview: number;
  atMs: number;
  protection: ProtectionChoices;
}

export class IndexedDbReviewStore {
  private db: Promise<IDBDatabase> | null = null;
  private changes: BroadcastChannel | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private database(): Promise<IDBDatabase> {
    // Opened again on the next call after a failed open (an upgrade blocked by an older page) or
    // after the connection closed (a newer version took over, or the data was erased).
    this.db ??= openDatabase(this.factory, () => (this.db = null)).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  private async tx(stores: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    return (await this.database()).transaction(stores, mode);
  }

  private announce(account: string): void {
    this.changes ??= new BroadcastChannel(CHANGES_CHANNEL);
    this.changes.postMessage({ kind: 'review-changed', account });
  }

  /** How many duplicate groups [account] has waiting, as last worked out; null before the first time. */
  async summary(account: string): Promise<ReviewSummary | null> {
    const tx = await this.tx([STORES.reviewSummaries], 'readonly');
    return (await request(tx.objectStore(STORES.reviewSummaries).get(account) as IDBRequest<ReviewSummary | undefined>)) ?? null;
  }

  async saveSummary(summary: ReviewSummary): Promise<void> {
    const tx = await this.tx([STORES.reviewSummaries], 'readwrite');
    tx.objectStore(STORES.reviewSummaries).put(summary);
    await committed(tx);
    this.announce(summary.account);
  }

  /**
   * Records a decision on [members] (every photo shown, which must include the [items]); for
   * APPROVED, also queues one trash job per item. Returns the decision id.
   */
  async recordDecision(account: string, groupId: string, kind: DecisionKind, items: { mediaKey: string; dedupKey: string }[], members: string[], atMs: number): Promise<number> {
    if (kind !== 'APPROVED' && items.length > 0) throw new Error('Only approvals carry a selection');
    if (kind === 'APPROVED' && items.length === 0) throw new Error('An approval needs at least one selected photo');
    const shown = new Set(members);
    if (!items.every((i) => shown.has(i.mediaKey))) throw new Error("The selected photos must be among the decision's photos");
    const tx = await this.tx([STORES.decisions, STORES.trashJobs], 'readwrite');
    const decision: NewRecord<StoredDecision> = { account, groupId, kind, items, members, createdAtMs: atMs, undoneAtMs: null };
    const id = (await request(tx.objectStore(STORES.decisions).add(decision))) as number;
    for (const item of items) {
      const job: NewRecord<TrashJob> = { account, decisionId: id, mediaKey: item.mediaKey, dedupKey: item.dedupKey, state: 'QUEUED', attempts: 0, lastError: null, updatedAtMs: atMs };
      tx.objectStore(STORES.trashJobs).add(job);
    }
    await committed(tx);
    this.announce(account);
    if (kind === 'APPROVED') emitUsage({ name: 'trash_approved', params: { source: decisionSource(groupId) } }, `decision:${id}:approved`);
    return id;
  }

  /** Decisions not undone, newest first. */
  async activeDecisions(account: string): Promise<StoredDecision[]> {
    const tx = await this.tx([STORES.decisions], 'readonly');
    const all = await request(tx.objectStore(STORES.decisions).index('account').getAll(account) as IDBRequest<StoredDecision[]>);
    return all.filter((d) => d.undoneAtMs === null).sort((a, b) => b.id - a.id);
  }

  /**
   * Undoes the newest active decision: queued jobs are cancelled, trashed ones are marked for
   * restoring. Returns the decision as it was, or null when there is nothing to undo.
   */
  async undoLast(account: string, atMs: number): Promise<StoredDecision | null> {
    const tx = await this.tx([STORES.decisions, STORES.trashJobs], 'readwrite');
    const decisions = tx.objectStore(STORES.decisions);
    const all = await request(decisions.index('account').getAll(account) as IDBRequest<StoredDecision[]>);
    const latest = all.filter((d) => d.undoneAtMs === null).sort((a, b) => b.id - a.id)[0];
    if (!latest) return null;
    decisions.put({ ...latest, undoneAtMs: atMs });
    const jobs = tx.objectStore(STORES.trashJobs);
    let cancelled = false;
    for (const job of await request(jobs.index('decisionId').getAll(latest.id) as IDBRequest<TrashJob[]>)) {
      const to: TrashJobState | null =
        job.state === 'QUEUED' || job.state === 'FAILED' || job.state === 'BLOCKED' ? 'CANCELLED' : job.state === 'COMPLETED' ? 'RESTORE_REQUESTED' : null;
      if (to) jobs.put({ ...job, state: to, updatedAtMs: atMs });
      if (to === 'CANCELLED') cancelled = true;
    }
    await committed(tx);
    this.announce(account);
    emitUsage({ name: 'undo_used', params: { source: decisionSource(latest.groupId) } });
    if (cancelled) emitUsage({ name: 'trash_result', params: { source: decisionSource(latest.groupId), result: 'cancelled' } }, `decision:${latest.id}:CANCELLED`);
    return latest;
  }

  /** The oldest jobs in [states], at most [limit]. */
  async jobs(account: string, states: TrashJobState[], limit = Number.MAX_SAFE_INTEGER): Promise<TrashJob[]> {
    const tx = await this.tx([STORES.trashJobs], 'readonly');
    const all = await request(tx.objectStore(STORES.trashJobs).index('account').getAll(account) as IDBRequest<TrashJob[]>);
    return all.filter((j) => states.includes(j.state)).sort((a, b) => a.id - b.id).slice(0, limit);
  }

  /** Moves a job to [to] only if it is still in [from]; returns whether it moved. Sending counts an attempt. */
  async transition(jobId: number, from: TrashJobState, to: TrashJobState, error: string | null, atMs: number): Promise<boolean> {
    const tx = await this.tx([STORES.trashJobs, STORES.decisions], 'readwrite');
    const jobs = tx.objectStore(STORES.trashJobs);
    const job = (await request(jobs.get(jobId) as IDBRequest<TrashJob | undefined>)) ?? null;
    if (job === null || job.state !== from) return false;
    const decision = await request(tx.objectStore(STORES.decisions).get(job.decisionId) as IDBRequest<StoredDecision | undefined>);
    jobs.put({ ...job, state: to, lastError: error, updatedAtMs: atMs, attempts: job.attempts + (to === 'SENDING' ? 1 : 0) });
    await committed(tx);
    this.announce(job.account);
    const results: Partial<Record<TrashJobState, 'confirmed' | 'failed' | 'uncertain' | 'blocked' | 'cancelled' | 'restored'>> = { COMPLETED: 'confirmed', FAILED: 'failed', UNCERTAIN: 'uncertain', BLOCKED: 'blocked', CANCELLED: 'cancelled', RESTORED: 'restored' };
    const result = results[to];
    if (decision && result && to !== from) emitUsage({ name: 'trash_result', params: { source: decisionSource(decision.groupId), result } }, `decision:${job.decisionId}:${to}`);
    return true;
  }

  async jobCounts(account: string): Promise<Partial<Record<TrashJobState, number>>> {
    const counts: Partial<Record<TrashJobState, number>> = {};
    for (const job of await this.jobs(account, ALL_STATES)) counts[job.state] = (counts[job.state] ?? 0) + 1;
    return counts;
  }
}

export const ALL_STATES: TrashJobState[] = ['QUEUED', 'SENDING', 'UNCERTAIN', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'RESTORE_REQUESTED', 'RESTORED'];
