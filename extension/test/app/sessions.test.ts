// Search and Duplicates wired to the saved data, as the review tab runs them, against the real
// IndexedDB stores (in memory): Search's re-check before a sweep, and the user's protection
// choices reaching every check (the groups, Search, the trash queue).

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { modelKey } from '../../src/app/ai/model';
import { duplicatesStores, refreshReviewSummary, reviewDeps, trashQueueDeps } from '../../src/app/duplicates/session';
import { processTrashQueue } from '../../src/app/duplicates/trash';
import { searchDeps, searchStores } from '../../src/app/search/session';
import { ALL_PROTECTED } from '../../src/app/shared/preferences';
import { fakeItem, FakePhotos, NOW, scan } from './fakes';

/** A unit vector at [degrees]: photos 3° apart are 99.9% similar. */
const at = (degrees: number) => Float32Array.from([Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]);
const quality = { sharpness: 100, brightness: 128, clippedDark: 0, clippedBright: 0, width: 256, height: 256 };
const NO_FAVOURITES = { ...ALL_PROTECTED, favourites: false };

/**
 * Six photos, scanned and analysed, in one database that both Search and Duplicates use. Photos
 * 0–2 are a burst (near-identical); photo 0 is a favourite.
 */
async function library() {
  const factory = new IDBFactory();
  const search = searchStores(factory);
  const duplicates = duplicatesStores(factory);
  const source = new FakePhotos(Array.from({ length: 6 }, (_, i) => fakeItem(i, { isFavourite: i === 0 })));
  await scan(source, search.inventory);
  await search.analysis.saveSettings({ account: 'account-a', detail: 140, modelKey: modelKey(140), measuredPhotosPerSecond: 5, chosenAtMs: NOW });
  const degrees = [0, 2, 4, 60, 120, 180];
  for (const [i, d] of degrees.entries()) {
    await search.analysis.saveEmbedding({ modelKey: modelKey(140), mediaKey: `lib-${i}`, account: 'account-a', vector: at(d), quality, createdAtMs: NOW });
  }
  const now = () => NOW;
  return {
    source,
    search: searchDeps('account-a', search, now),
    review: reviewDeps('account-a', duplicates, now),
    queue: trashQueueDeps('account-a', duplicates, now),
    refreshSummary: () => refreshReviewSummary('account-a', duplicates, now),
    stores: search,
    /** As after a new library scan. */
    rescan: () => scan(source, search.inventory),
  };
}

describe('Search sweeps: checked again just before anything is queued', () => {
  it('queues exactly the selection as one decision', async () => {
    const { search, stores } = await library();
    await search.sweep(['lib-4', 'lib-3']);
    expect(await stores.review.activeDecisions('account-a')).toMatchObject([
      { groupId: `sweep:${NOW}`, kind: 'APPROVED', items: [{ mediaKey: 'lib-3', dedupKey: 'dedup-3' }, { mediaKey: 'lib-4', dedupKey: 'dedup-4' }] },
    ]);
  });

  it('a photo favourited since the search stops the whole sweep: nothing is queued', async () => {
    const { search, stores, source, rescan } = await library();
    expect((await search.loadLibrary()).photos.get('lib-3')!.eligible).toBe(true);
    source.library[3] = fakeItem(3, { isFavourite: true });
    source.favourites = [source.library[0]!, source.library[3]!];
    await rescan();
    await expect(search.sweep(['lib-3', 'lib-4'])).rejects.toThrow('1 selected photo is no longer eligible or already in the trash queue; search again.');
    expect(await stores.review.activeDecisions('account-a')).toEqual([]);
  });

  it('a photo already queued, protected or gone is refused', async () => {
    const { search, stores } = await library();
    await search.sweep(['lib-3']);
    await expect(search.sweep(['lib-3', 'lib-4'])).rejects.toThrow(/no longer eligible or already in the trash queue/);
    await expect(search.sweep(['lib-0'])).rejects.toThrow(/no longer eligible/);
    await expect(search.sweep(['lib-99'])).rejects.toThrow(/no longer eligible/);
    await expect(search.sweep([])).rejects.toThrow('Nothing is selected for the trash.');
    expect(await stores.review.activeDecisions('account-a')).toHaveLength(1);
  });

  it('refuses when the scan is out of date', async () => {
    const { stores } = await library();
    const dayLater = searchDeps('account-a', stores, () => NOW + 25 * 60 * 60 * 1000);
    await expect(dayLater.sweep(['lib-3'])).rejects.toThrow(/no longer usable/);
    expect(await stores.review.activeDecisions('account-a')).toEqual([]);
  });
});

describe('protection choices reach every check', () => {
  it('Duplicates: a favourite is protected until favourites are unticked', async () => {
    const { review, stores } = await library();
    const keeperOf = async () => (await review.loadQueue()).pending[0]!.members.find((m) => m.mediaKey === 'lib-0')!;
    expect(await keeperOf()).toMatchObject({ selectable: false, eligibility: 'PROTECTED', protectionReasons: ['FAVOURITE'] });
    await stores.preferences.setProtection('account-a', NO_FAVOURITES);
    expect(await keeperOf()).toMatchObject({ selectable: true, eligibility: 'ELIGIBLE' });
  });

  it('Search: a favourite can be swept only while favourites are unticked', async () => {
    const { search, stores } = await library();
    expect((await search.loadLibrary()).photos.get('lib-0')!.eligible).toBe(false);
    await expect(search.sweep(['lib-0'])).rejects.toThrow(/no longer eligible/);
    await stores.preferences.setProtection('account-a', NO_FAVOURITES);
    expect((await search.loadLibrary()).photos.get('lib-0')!.eligible).toBe(true);
    await search.sweep(['lib-0']);
  });

  it('the trash queue: ticking favourites again blocks a queued favourite; it is never sent', async () => {
    const { search, stores, queue } = await library();
    await stores.preferences.setProtection('account-a', NO_FAVOURITES);
    await search.sweep(['lib-0', 'lib-3']);
    await stores.preferences.setProtection('account-a', ALL_PROTECTED);
    await processTrashQueue(queue);
    expect(await stores.review.jobs('account-a', ['BLOCKED'])).toMatchObject([{ mediaKey: 'lib-0', lastError: 'No longer eligible (PROTECTED)' }]);
    expect(await queue.trash.inTrash('account-a', ['dedup-0', 'dedup-3'])).toEqual(new Map([['dedup-0', false], ['dedup-3', true]]));
  });
});

describe('the count of groups waiting, for the popup', () => {
  it('is worked out after an analysis and with the choices it was built with; nothing while blocked', async () => {
    const { stores, refreshSummary } = await library();
    await refreshSummary();
    expect(await stores.review.summary('account-a')).toEqual({ account: 'account-a', groupsToReview: 1, atMs: NOW, protection: ALL_PROTECTED });

    const later = searchStores(new IDBFactory());
    await refreshReviewSummary('account-a', { ...duplicatesStores(new IDBFactory()), review: later.review }, () => NOW);
    expect(await later.review.summary('account-a')).toBeNull(); // no scan: the groups can't be built
  });
});
