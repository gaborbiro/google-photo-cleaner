// The real trash, against a pretend Google Photos that keeps its own trash and can be told to fail:
// what counts is where each photo is afterwards, and passing failures are tried again, not lost.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { GoogleTrash, REST_AFTER_RATE_LIMIT_MS } from '../../src/app/duplicates/googleTrash';
import { IndexedDbReviewStore } from '../../src/app/duplicates/reviewStore';
import { processTrashQueue, type TrashQueueDeps } from '../../src/app/duplicates/trash';
import { INCOMPATIBLE_TEXT } from '../../src/app/shared/googleProblems';
import { classifyLatest, fakeItem, FakeGoogle, FakePhotos, newStore, NOW, scan } from './fakes';

const target = (i: number) => ({ mediaKey: `lib-${i}`, dedupKey: `dedup-${i}` });

describe('the real trash', () => {
  it('trashes and restores, counting only what is really in the trash afterwards', async () => {
    const google = new FakeGoogle();
    google.trash.add('someone-elses-old-photo');
    const trash = new GoogleTrash(google.run);
    expect(await trash.moveToTrash('acc', [target(1), target(2), target(3)])).toEqual([1, 2, 3].map((i) => ({ dedupKey: `dedup-${i}`, succeeded: true, error: null })));
    expect(google.calls.filter((c) => c.op === 'moveToTrash')).toEqual([{ op: 'moveToTrash', params: { account: 'acc', dedupKeys: ['dedup-1', 'dedup-2', 'dedup-3'] } }]);
    expect(await trash.inTrash('acc', ['dedup-2', 'dedup-9'])).toEqual(new Map([['dedup-2', true], ['dedup-9', false]]));

    expect(await trash.restore('acc', [target(2)])).toEqual([{ dedupKey: 'dedup-2', succeeded: true, error: null }]);
    expect(google.trash.has('dedup-2')).toBe(false);
  });

  it('sends at most 50 photos a request', async () => {
    const google = new FakeGoogle();
    await new GoogleTrash(google.run).moveToTrash('acc', Array.from({ length: 120 }, (_, i) => target(i)));
    expect(google.calls.filter((c) => c.op === 'moveToTrash').map((c) => (c.params['dedupKeys'] as string[]).length)).toEqual([50, 50, 20]);
  });

  it('a request that failed after doing its work still counts as done', async () => {
    const google = new FakeGoogle();
    google.fail = { error: { kind: 'TRANSIENT', message: 'connection reset' }, workDone: true };
    expect(await new GoogleTrash(google.run).moveToTrash('acc', [target(1)])).toEqual([{ dedupKey: 'dedup-1', succeeded: true, error: null }]);
  });

  it('a passing failure is uncertain (tried again later); a changed answer from Google fails, saying so', async () => {
    const google = new FakeGoogle();
    const trash = new GoogleTrash(google.run);
    google.fail = { error: { kind: 'TRANSIENT', message: 'connection reset' }, workDone: false };
    expect(await trash.moveToTrash('acc', [target(1)])).toEqual([{ dedupKey: 'dedup-1', succeeded: false, uncertain: true, error: 'connection reset' }]);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    google.fail = { error: { kind: 'PROTOCOL', message: 'shape changed' }, workDone: false };
    expect(await trash.moveToTrash('acc', [target(2)])).toEqual([{ dedupKey: 'dedup-2', succeeded: false, error: INCOMPATIBLE_TEXT }]);

    // The trash can't be read afterwards: nobody knows, so it is checked again later.
    google.unreadable = true;
    expect(await trash.moveToTrash('acc', [target(3)])).toMatchObject([{ dedupKey: 'dedup-3', succeeded: false, uncertain: true }]);
    warn.mockRestore();
  });

  it('after Google limits requests it rests a minute before contacting Google again', async () => {
    let now = 0;
    const google = new FakeGoogle();
    const trash = new GoogleTrash(google.run, () => now);
    google.fail = { error: { kind: 'RATE_LIMIT', message: 'HTTP 429' }, workDone: false };
    await trash.moveToTrash('acc', [target(1)]);
    expect(trash.waitingReason()).toBe('Waiting: Google is limiting requests; trying again in a minute.');
    now += REST_AFTER_RATE_LIMIT_MS;
    expect(trash.waitingReason()).toBeNull();
  });
});

describe('the trash queue with the real trash', () => {
  async function setup() {
    const factory = new IDBFactory();
    const review = new IndexedDbReviewStore(factory);
    const inventory = newStore();
    await scan(new FakePhotos(Array.from({ length: 6 }, (_, i) => fakeItem(i))), inventory);
    const classification = await classifyLatest(inventory);
    let now = NOW;
    const google = new FakeGoogle();
    const trash = new GoogleTrash(google.run, () => now);
    const deps: TrashQueueDeps = { account: 'account-a', review, trash, classify: async () => classification, now: () => now };
    return { review, google, deps, later: (ms: number) => void (now += ms) };
  }

  it('a passing failure is sent again on a later pass, without re-approving', async () => {
    const { review, google, deps } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [target(1)], ['lib-0', 'lib-1'], NOW);
    google.fail = { error: { kind: 'TRANSIENT', message: 'connection reset' }, workDone: false };
    await processTrashQueue(deps);
    expect(await review.jobs('account-a', ['UNCERTAIN'])).toHaveLength(1);
    await processTrashQueue(deps); // checked: not in the trash, still approved: queued again
    await processTrashQueue(deps); // sent
    expect(await review.jobs('account-a', ['COMPLETED'])).toHaveLength(1);
    expect(google.trash.has('dedup-1')).toBe(true);
  });

  it('while Google is limiting requests the queue waits, saying so, and contacts Google not at all', async () => {
    const { review, google, deps, later } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [target(1)], ['lib-0', 'lib-1'], NOW);
    google.fail = { error: { kind: 'RATE_LIMIT', message: 'HTTP 429' }, workDone: false };
    expect((await processTrashQueue(deps)).waitingReason).toBe('Waiting: Google is limiting requests; trying again in a minute.');
    const calls = google.calls.length;
    expect((await processTrashQueue(deps)).waitingReason).toMatch(/limiting requests/);
    expect(google.calls).toHaveLength(calls);
    later(REST_AFTER_RATE_LIMIT_MS);
    await processTrashQueue(deps);
    await processTrashQueue(deps);
    expect(google.trash.has('dedup-1')).toBe(true);
  });

  it('undo restores a photo already in the real trash', async () => {
    const { review, google, deps } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [target(1)], ['lib-0', 'lib-1'], NOW);
    await processTrashQueue(deps);
    expect(google.trash.has('dedup-1')).toBe(true);
    await review.undoLast('account-a', NOW);
    await processTrashQueue(deps);
    expect(google.trash.has('dedup-1')).toBe(false);
    expect(await review.jobs('account-a', ['RESTORED'])).toHaveLength(1);
  });
});
