// The shared Kotlin duplicate rules as the extension runs them (compiled to JavaScript): the
// detailed scenarios are tested in features/shared/duplicates; these check the hand-over.

import { describe, expect, it } from 'vitest';
import { calibrationReport, decisionItems, groupingSettings, reviewQueue, type ActiveDecision, type AnalysedPhoto } from '../../src/app/duplicates/rules';
import { ALL_PROTECTED } from '../../src/app/shared/preferences';
import { fakeDedupKey, fakeItem, FakePhotos, newStore, NOW, scan } from './fakes';

/** A unit vector at [degrees]: photos 3° apart are 99.9% similar, 60° apart 50%. */
const at = (degrees: number) => Float32Array.from([Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]);

const photo = (index: number, sharpness = 100): AnalysedPhoto => ({
  mediaKey: `lib-${index}`, sharpness, clipped: 0, analysedAtMs: NOW, uploadedAtMs: null, width: 4000, height: 3000,
});

async function library() {
  // Photos 0–2 are a burst (1 s apart, near-identical); 3 is a favourite of the same moment; 4 is different.
  const source = new FakePhotos(Array.from({ length: 5 }, (_, i) => fakeItem(i, { isFavourite: i === 3 })));
  const store = newStore();
  await scan(source, store);
  return store.snapshot((await store.latestRun('account-a'))!.id);
}

describe('duplicate rules from Kotlin', () => {
  it('groups a burst behind its favourite and proposes the rest for the trash', async () => {
    const snapshot = await library();
    const photos = [photo(0, 50), photo(1, 400), photo(2), photo(3), photo(4)];
    const vectors = [at(0), at(2), at(4), at(1), at(70)];
    const queue = reviewQueue(snapshot, NOW, photos, vectors, [], groupingSettings(140), ALL_PROTECTED);
    expect(queue).toMatchObject({ blocked: null, totalGroups: 1, decidedGroups: 0, photosAnalysed: 5, photosNotAnalysed: 0, settings: { threshold: 0.915, windowMs: 120_000 } });
    const group = queue.pending[0]!;
    expect(group.id).toMatch(/^[0-9a-f]{24}$/);
    expect(group.members[0]).toMatchObject({ mediaKey: 'lib-3', role: 'KEEPER', selectable: false, eligibility: 'PROTECTED', protectionReasons: ['FAVOURITE'] });
    expect(group.members[0]!.reasons[0]).toBe('Protected: favourite');
    expect(group.members.slice(1).map((m) => [m.mediaKey, m.role, m.selectable])).toEqual(
      expect.arrayContaining([['lib-0', 'PROPOSED', true], ['lib-1', 'PROPOSED', true], ['lib-2', 'PROPOSED', true]]),
    );
    expect(new Set(group.defaultSelection)).toEqual(new Set(['lib-0', 'lib-1', 'lib-2']));
    expect(group.members.find((m) => m.mediaKey === 'lib-0')!.reasons).toContain('Blurrier than the keeper');
  });

  it('what a decision records comes from the shared rules: the selection, sorted, and never a protected photo', async () => {
    const snapshot = await library();
    const photos = [photo(0), photo(1), photo(2), photo(3), photo(4)];
    const vectors = [at(0), at(2), at(4), at(1), at(70)];
    const group = reviewQueue(snapshot, NOW, photos, vectors, [], groupingSettings(140), ALL_PROTECTED).pending[0]!;
    expect(decisionItems(group, 'APPROVED', new Set(['lib-2', 'lib-0']))).toEqual([{ mediaKey: 'lib-0', dedupKey: fakeDedupKey(0) }, { mediaKey: 'lib-2', dedupKey: fakeDedupKey(2) }]);
    expect(() => decisionItems(group, 'APPROVED', new Set(['lib-3']))).toThrow('Only eligible photos can be trashed'); // the favourite
    expect(() => decisionItems(group, 'APPROVED', new Set())).toThrow('Nothing is selected for the trash');
    expect(decisionItems(group, 'KEPT', new Set(['lib-0']))).toEqual([]);
  });

  it('a kept group does not come back, and nothing can be grouped before a scan', async () => {
    const snapshot = await library();
    const photos = [photo(0), photo(1), photo(2), photo(3), photo(4)];
    const vectors = [at(0), at(2), at(4), at(1), at(70)];
    const group = reviewQueue(snapshot, NOW, photos, vectors, [], groupingSettings(140), ALL_PROTECTED).pending[0]!;
    const kept: ActiveDecision = { id: 1, groupId: group.id, kind: 'KEPT', items: [], members: group.members.map((m) => m.mediaKey), createdAtMs: NOW };
    expect(reviewQueue(snapshot, NOW, photos, vectors, [kept], groupingSettings(140), ALL_PROTECTED)).toMatchObject({ pending: [], decidedGroups: 1 });
    expect(reviewQueue(null, NOW, [], [], [], groupingSettings(140), ALL_PROTECTED).blocked).toBe('NOT_SCANNED');
  });

  it('refuses fingerprints that do not line up with their photos', async () => {
    const snapshot = await library();
    expect(() => reviewQueue(snapshot, NOW, [photo(0)], [], [], groupingSettings(140), ALL_PROTECTED)).toThrow(/differ in length/);
  });

  it('recommends the first threshold above every pair labelled different', () => {
    const report = calibrationReport([
      { label: 'SAME', score: 0.99 }, { label: 'NEAR_DUPLICATE', score: 0.93 }, { label: 'DIFFERENT', score: 0.912 },
    ], 140);
    expect(report).toMatchObject({ tokenBudget: 140, labelled: 3, duplicates: 2, different: 1, recommendedThreshold: 0.915 });
    expect(report.rows).toHaveLength(60);
  });
});
