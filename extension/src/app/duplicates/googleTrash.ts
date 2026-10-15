// The real trash: Google Photos' own, reached through a Photos tab signed in to the account (the
// service worker picks the tab; the page script refuses a tab signed in to anyone else).
//
// What counts is where each photo is afterwards, read back from Google's trash, not what Google
// answered: a request can fail after doing its work, or succeed without it. A photo whose request
// failed for a passing reason is "uncertain": the trash queue checks it again on its next pass and
// sends it again if it isn't in the trash. While Google is limiting requests, or no Photos tab is
// signed in to the account, the queue waits instead of trying every two seconds.

import { MAX_TRASH_BATCH, type OpError, type OpResult, type PageOp } from '../../shared/protocol';
import { INCOMPATIBLE_TEXT, isIncompatible, logGoogleProblem } from '../shared/googleProblems';
import type { TrashOutcome, TrashService, TrashTarget } from './trash';

/** Runs one operation in a Photos tab signed in to [account]. */
export type RunPageOp = (account: string, op: PageOp, params: Record<string, unknown>) => Promise<OpResult>;

/** A trash this long (pages of Google's listing) is not read to the end: the photos' state is then uncertain. */
const MAX_TRASH_PAGES = 400;
/** How long the queue rests after Google limited requests, or when no Photos tab was signed in to the account. */
export const REST_AFTER_RATE_LIMIT_MS = 60_000;
export const REST_WITHOUT_PHOTOS_MS = 15_000;

const PASSING: ReadonlySet<OpError['kind']> = new Set(['TRANSIENT', 'RATE_LIMIT', 'NO_PHOTOS_TAB', 'SESSION', 'RPC_ERROR']);

export class GoogleTrash implements TrashService {
  readonly simulated = false;
  private restUntilMs = 0;
  private restReason: string | null = null;

  constructor(private readonly run: RunPageOp, private readonly now: () => number = Date.now) {}

  /** Why the queue should wait before the next request, or null. */
  waitingReason(): string | null {
    return this.now() < this.restUntilMs ? this.restReason : null;
  }

  moveToTrash(account: string, targets: TrashTarget[]): Promise<TrashOutcome[]> {
    return this.change(account, targets, 'moveToTrash', true);
  }

  restore(account: string, targets: TrashTarget[]): Promise<TrashOutcome[]> {
    return this.change(account, targets, 'restoreFromTrash', false);
  }

  /** Reads Google's trash until every key is found, or to its end. Throws when it can't be read. */
  async inTrash(account: string, dedupKeys: string[]): Promise<Map<string, boolean>> {
    const wanted = new Set(dedupKeys);
    const found = new Set<string>();
    let token: string | null = null;
    let pages = 0;
    do {
      if (++pages > MAX_TRASH_PAGES) throw new Error(`The trash is longer than ${MAX_TRASH_PAGES} pages; it can't be checked`);
      const result = await this.call(account, 'listTrashPage', token ? { pageToken: token } : {});
      if (!result.ok) throw new Error(`The trash could not be read: ${result.error.message}`);
      const page = result.data as { dedupKeys: string[]; nextPageToken: string | null; accountFingerprint: string };
      if (page.accountFingerprint !== account) throw new Error('The trash was read in a tab signed in to another account');
      for (const key of page.dedupKeys) if (wanted.has(key)) found.add(key);
      token = page.nextPageToken;
    } while (token !== null && found.size < wanted.size);
    return new Map(dedupKeys.map((k) => [k, found.has(k)]));
  }

  private async change(account: string, targets: TrashTarget[], op: 'moveToTrash' | 'restoreFromTrash', wantInTrash: boolean): Promise<TrashOutcome[]> {
    const outcomes: TrashOutcome[] = [];
    for (let i = 0; i < targets.length; i += MAX_TRASH_BATCH) {
      const keys = targets.slice(i, i + MAX_TRASH_BATCH).map((t) => t.dedupKey);
      // A request held back while resting counts as failed for a passing reason: tried again later.
      const answer: OpResult = this.waitingReason() !== null
        ? { ok: false, error: { kind: 'TRANSIENT', message: 'Waiting before trying again' } }
        : await this.call(account, op, { account, dedupKeys: keys });
      const problem = answer.ok ? null : answer.error;
      if (problem) this.noteProblem(problem, `trash: ${op}`);

      let where: Map<string, boolean>;
      try {
        where = await this.inTrash(account, keys);
      } catch (error) {
        console.warn('Photo Cleaner: could not check the trash after a trash request', error);
        outcomes.push(...keys.map((dedupKey) => ({ dedupKey, succeeded: false, uncertain: true, error: "Couldn't check Google Photos' trash afterwards" })));
        continue;
      }
      for (const dedupKey of keys) {
        if (where.get(dedupKey) === wantInTrash) outcomes.push({ dedupKey, succeeded: true, error: null });
        else outcomes.push(this.failure(dedupKey, problem, wantInTrash));
      }
    }
    return outcomes;
  }

  private failure(dedupKey: string, problem: OpError | null, wantInTrash: boolean): TrashOutcome {
    if (problem && PASSING.has(problem.kind)) return { dedupKey, succeeded: false, uncertain: true, error: problem.message };
    if (problem && isIncompatible(problem.kind)) return { dedupKey, succeeded: false, error: INCOMPATIBLE_TEXT };
    return { dedupKey, succeeded: false, error: wantInTrash ? 'Google Photos accepted the request, but the photo is not in its trash' : 'Google Photos accepted the request, but the photo is still in its trash' };
  }

  private noteProblem(problem: OpError, where: string): void {
    if (isIncompatible(problem.kind)) logGoogleProblem(where, problem);
    if (problem.kind === 'RATE_LIMIT') this.rest(REST_AFTER_RATE_LIMIT_MS, 'Waiting: Google is limiting requests; trying again in a minute.');
    if (problem.kind === 'NO_PHOTOS_TAB' || problem.kind === 'SESSION') this.rest(REST_WITHOUT_PHOTOS_MS, 'Waiting: open Google Photos, signed in to this account.');
  }

  private rest(ms: number, reason: string): void {
    this.restUntilMs = this.now() + ms;
    this.restReason = reason;
  }

  /** One operation; a message that never came back counts as a passing failure. */
  private async call(account: string, op: PageOp, params: Record<string, unknown>): Promise<OpResult> {
    try {
      return (await this.run(account, op, params)) ?? { ok: false, error: { kind: 'TRANSIENT', message: 'No answer from the extension' } };
    } catch (error) {
      console.warn('Photo Cleaner: a trash request was cut off inside the browser', error);
      return { ok: false, error: { kind: 'TRANSIENT', message: 'The request was cut off inside the browser' } };
    }
  }
}
