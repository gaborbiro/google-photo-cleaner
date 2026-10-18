// The protection choices: saved per account, and applied by the shared rules everywhere.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { classify } from '../../src/app/scan/report';
import { ALL_PROTECTED, IndexedDbPreferences } from '../../src/app/shared/preferences';
import { newStore, NOW, scan, standardAccount } from './fakes';

describe('protection choices', () => {
  it('everything is protected until the user changes it; each account keeps its own', async () => {
    const preferences = new IndexedDbPreferences(new IDBFactory());
    expect(await preferences.protection('acc1')).toEqual({ favourites: true, albums: true, archived: true });
    await preferences.setProtection('acc1', { favourites: true, albums: false, archived: true });
    expect(await preferences.protection('acc1')).toEqual({ favourites: true, albums: false, archived: true });
    expect(await preferences.protection('acc2')).toEqual({ favourites: true, albums: true, archived: true });
  });

  it('with albums unticked, photos protected only by an album become eligible; favourites stay protected', async () => {
    // Photos 1 and 2 are favourites; album A holds 2, 3 and 4, album B 4 and 5.
    const store = newStore();
    await scan(standardAccount(), store);
    const snapshot = await store.snapshot((await store.latestRun('account-a'))!.id);
    const eligible = (choices = ALL_PROTECTED) =>
      classify(snapshot, NOW, choices).items.filter((i) => i.eligibility === 'ELIGIBLE').map((i) => i.mediaKey).sort();
    expect(eligible()).toEqual(['lib-0', 'lib-6', 'lib-7', 'lib-8', 'lib-9']);
    expect(eligible({ ...ALL_PROTECTED, albums: false })).toEqual(['lib-0', 'lib-3', 'lib-4', 'lib-5', 'lib-6', 'lib-7', 'lib-8', 'lib-9']);
    expect(eligible({ ...ALL_PROTECTED, favourites: false })).toEqual(['lib-0', 'lib-1', 'lib-6', 'lib-7', 'lib-8', 'lib-9']); // 2 is also in an album
  });
});
