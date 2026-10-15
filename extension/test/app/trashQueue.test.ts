// The review decisions and the trash queue against the real IndexedDB stores (in memory): the
// browser twin of the desktop's TrashQueueTest.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IndexedDbReviewStore } from '../../src/app/duplicates/reviewStore';
import { processTrashQueue, recoverInterrupted, SimulatedTrash, type TrashQueueDeps, type TrashTarget } from '../../src/app/duplicates/trash';
import type { Classification } from '../../src/app/scan/report';
import { classifyLatest, fakeItem, FakePhotos, newStore, NOW, scan } from './fakes';

const item = (i: number) => ({ mediaKey: `lib-${i}`, dedupKey: `dedup-${i}` });
const members = (...indexes: number[]) => indexes.map((i) => `lib-${i}`);

/** A trash that fails for chosen photos, otherwise the simulated one. */
class FlakyTrash extends SimulatedTrash {
  failing = new Set<string>();
  override async moveToTrash(account: string, targets: TrashTarget[]) {
    const ok = targets.filter((t) => !this.failing.has(t.dedupKey));
    await super.moveToTrash(account, ok);
    return targets.map((t) => ({ dedupKey: t.dedupKey, succeeded: !this.failing.has(t.dedupKey), error: this.failing.has(t.dedupKey) ? 'Simulated failure' : null }));
  }
}

async function setup(opts: { favourites?: number[]; videos?: number[] } = {}) {
  const factory = new IDBFactory();
  const review = new IndexedDbReviewStore(factory);
  const trash = new FlakyTrash(factory);
  const inventory = newStore();
  const source = new FakePhotos(Array.from({ length: 6 }, (_, i) => fakeItem(i, { isFavourite: opts.favourites?.includes(i) ?? false, mediaType: opts.videos?.includes(i) ? 'VIDEO' : 'PHOTO' })));
  await scan(source, inventory);
  let classification: Classification | null = await classifyLatest(inventory);
  const deps: TrashQueueDeps = { account: 'account-a', review, trash, classify: async () => classification, now: () => NOW };
  return {
    review, trash, deps, source, inventory,
    /** As after a new library scan: classification follows the current library. */
    rescan: async (nowMs = NOW, opts: { stopEarly?: boolean } = {}) => {
      let checks = 0;
      // Stopped once it has started: an unfinished scan is the latest one.
      await scan(source, inventory, opts.stopEarly ? { shouldStop: async () => ++checks > 2 } : {});
      classification = await classifyLatest(inventory, nowMs);
    },
  };
}

describe('review decisions and the trash queue', () => {
  it('an approval trashes exactly the selection', async () => {
    const { review, trash, deps } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1), item(2)], members(0, 1, 2), NOW);
    const status = await processTrashQueue(deps);
    expect(status).toMatchObject({ counts: { COMPLETED: 2 }, simulated: true, waitingReason: null });
    expect(await trash.inTrash('account-a', ['dedup-0', 'dedup-1', 'dedup-2'])).toEqual(new Map([['dedup-0', false], ['dedup-1', true], ['dedup-2', true]]));
  });

  it('an approval needs a selection from among the photos shown, and only approvals carry one', async () => {
    const { review } = await setup();
    await expect(review.recordDecision('account-a', 'g1', 'APPROVED', [], members(0, 1), NOW)).rejects.toThrow(/at least one/);
    await expect(review.recordDecision('account-a', 'g1', 'APPROVED', [item(5)], members(0, 1), NOW)).rejects.toThrow(/among/);
    await expect(review.recordDecision('account-a', 'g1', 'KEPT', [item(0)], members(0, 1), NOW)).rejects.toThrow(/Only approvals/);
  });

  it('a photo that became a favourite after approval is blocked, never sent', async () => {
    const { review, deps, source, rescan, trash } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1)], members(0, 1), NOW);
    source.library[1] = fakeItem(1, { isFavourite: true });
    source.favourites = [source.library[1]!];
    await rescan();
    await processTrashQueue(deps);
    expect(await review.jobs('account-a', ['BLOCKED'])).toMatchObject([{ mediaKey: 'lib-1', lastError: 'No longer eligible (PROTECTED)' }]);
    expect(await trash.inTrash('account-a', ['dedup-1'])).toEqual(new Map([['dedup-1', false]]));
  });

  it('a video that reached the queue is blocked, never sent', async () => {
    const { review, trash, deps } = await setup({ videos: [2] });
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1), item(2)], members(0, 1, 2), NOW);
    await processTrashQueue(deps);
    expect(await review.jobs('account-a', ['BLOCKED'])).toMatchObject([{ mediaKey: 'lib-2', lastError: 'Not a photo: only photos are trashed' }]);
    expect(await trash.inTrash('account-a', ['dedup-1', 'dedup-2'])).toEqual(new Map([['dedup-1', true], ['dedup-2', false]]));
  });

  it('a photo gone from the library is blocked', async () => {
    const { review, deps, source, rescan } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1)], members(0, 1), NOW);
    source.library.splice(1, 1);
    await rescan();
    await processTrashQueue(deps);
    expect(await review.jobs('account-a', ['BLOCKED'])).toMatchObject([{ lastError: 'No longer in the library' }]);
  });

  it('undo before sending cancels; undo after sending restores', async () => {
    const { review, trash, deps } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1)], members(0, 1), NOW);
    expect(await review.undoLast('account-a', NOW)).toMatchObject({ groupId: 'g1', kind: 'APPROVED', items: [item(1)] });
    expect(await review.jobs('account-a', ['CANCELLED'])).toHaveLength(1);

    await review.recordDecision('account-a', 'g2', 'APPROVED', [item(2)], members(2, 3), NOW);
    await processTrashQueue(deps);
    expect((await trash.inTrash('account-a', ['dedup-2'])).get('dedup-2')).toBe(true);
    await review.undoLast('account-a', NOW);
    expect(await processTrashQueue(deps)).toMatchObject({ counts: { CANCELLED: 1, RESTORED: 1 } });
    expect((await trash.inTrash('account-a', ['dedup-2'])).get('dedup-2')).toBe(false);
  });

  it('a page closed mid-send is reconciled: nothing is sent twice', async () => {
    const { review, trash, deps } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1), item(2)], members(0, 1, 2), NOW);
    const [done, notDone] = await review.jobs('account-a', ['QUEUED']);
    // Both were being sent; photo 1 reached the trash before the page closed, photo 2 didn't.
    await review.transition(done!.id, 'QUEUED', 'SENDING', null, NOW);
    await review.transition(notDone!.id, 'QUEUED', 'SENDING', null, NOW);
    await trash.moveToTrash('account-a', [item(1)]);

    await recoverInterrupted(deps);
    await processTrashQueue(deps);
    const completed = await review.jobs('account-a', ['COMPLETED']);
    expect(completed.map((j) => [j.mediaKey, j.attempts])).toEqual([['lib-1', 1], ['lib-2', 2]]);
  });

  it('a photo whose status became unknown is blocked, never sent', async () => {
    const { review, trash, deps, source, rescan } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1)], members(0, 1), NOW);
    source.library[1] = fakeItem(1, { isOwned: false }); // e.g. now only shared with this account
    await rescan();
    await processTrashQueue(deps);
    expect(await review.jobs('account-a', ['BLOCKED'])).toMatchObject([{ mediaKey: 'lib-1', lastError: 'No longer eligible (UNKNOWN)' }]);
    expect(await trash.inTrash('account-a', ['dedup-1'])).toEqual(new Map([['dedup-1', false]]));
  });

  it('an unfinished library scan holds the queue', async () => {
    const { review, deps, rescan } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1)], members(0, 1), NOW);
    await rescan(NOW, { stopEarly: true });
    expect((await processTrashQueue(deps)).waitingReason).toBe('Waiting: the library scan is unfinished. Finish it to continue.');
    expect(await review.jobs('account-a', ['QUEUED'])).toHaveLength(1);
  });

  it('an out-of-date library scan holds the queue', async () => {
    const { review, deps, rescan } = await setup();
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1)], members(0, 1), NOW);
    await rescan(NOW + 25 * 3_600_000);
    expect((await processTrashQueue(deps)).waitingReason).toBe('Waiting: the library scan is out of date. Check for new photos to continue.');
    expect(await review.jobs('account-a', ['QUEUED'])).toHaveLength(1);
  });

  it('failures are recorded per photo', async () => {
    const { review, trash, deps } = await setup();
    trash.failing.add('dedup-2');
    await review.recordDecision('account-a', 'g1', 'APPROVED', [item(1), item(2)], members(0, 1, 2), NOW);
    expect((await processTrashQueue(deps)).counts).toEqual({ COMPLETED: 1, FAILED: 1 });
    expect(await review.jobs('account-a', ['FAILED'])).toMatchObject([{ mediaKey: 'lib-2', lastError: 'Simulated failure' }]);
  });

  it('keep and skip are recorded and undone too; decisions are per account, newest first', async () => {
    const { review } = await setup();
    await review.recordDecision('account-a', 'g1', 'DEFERRED', [], members(0, 1), NOW);
    await review.recordDecision('account-a', 'g2', 'KEPT', [], members(2, 3), NOW);
    await review.recordDecision('account-b', 'g9', 'KEPT', [], ['x'], NOW);
    expect((await review.activeDecisions('account-a')).map((d) => d.groupId)).toEqual(['g2', 'g1']);
    expect(await review.undoLast('account-a', NOW)).toMatchObject({ groupId: 'g2', kind: 'KEPT' });
    expect(await review.undoLast('account-a', NOW)).toMatchObject({ groupId: 'g1', kind: 'DEFERRED' });
    expect(await review.undoLast('account-a', NOW)).toBeNull();
    expect(await review.activeDecisions('account-b')).toHaveLength(1);
  });
});
