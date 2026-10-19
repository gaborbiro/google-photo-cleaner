import { describe, expect, it } from 'vitest';
import { CATEGORIES, countCategories, countLine, matchPhoto, scoreSpread, suggestions, type Category, type ClutterPhoto, type ScoredCategory } from '../../src/app/search/clutter';

const v = (...xs: number[]) => Float32Array.from(xs);
const parking: Category = { id: 'parking', label: 'Parking spots', kind: 'clutter', descriptions: ['a car park', 'a parking space number'] };
const receipts: Category = { id: 'receipts', label: 'Receipts', kind: 'clutter', descriptions: ['a receipt'] };
const people: Category = { id: 'people', label: 'People', kind: 'keep', descriptions: ['a group of people'] };
const categories = [parking, receipts, people];
// One direction per category; parking's second description leans towards receipts (both have text).
const scored: ScoredCategory[] = [
  { category: parking, vectors: [v(1, 0, 0), v(0.6, 0.6, 0)] },
  { category: receipts, vectors: [v(0, 1, 0)] },
  { category: people, vectors: [v(0, 0, 1)] },
];
const trashable: ClutterPhoto = { eligible: true, approved: false };

describe('clutter suggestions', () => {
  it('scores a category as its best description, and keeps the runner-up category', () => {
    expect(matchPhoto('p', v(0.5, 0.5, 0), scored)).toEqual({ mediaKey: 'p', best: 0, bestScore: expect.closeTo(0.6, 5), secondScore: expect.closeTo(0.5, 5) });
    expect(matchPhoto('q', v(0.1, 0.2, 0.9), scored)).toMatchObject({ best: 2, bestScore: expect.closeTo(0.9, 5), secondScore: expect.closeTo(0.2, 5) });
  });

  it('counts a photo only for its best category, and only when that is clearly ahead', () => {
    const matches = [
      matchPhoto('car park', v(0.9, 0.1, 0), scored),
      // A family in a car park: people is just ahead, so it is never counted as parking.
      matchPhoto('family at the car', v(0.5, 0, 0.52), scored),
      // Parking by a whisker: a close call, not counted.
      matchPhoto('kerb', v(0.4, 0.38, 0), scored),
      // Clearly parking, but weak: below the minimum score.
      matchPhoto('faint', v(0.15, 0, 0), scored),
      matchPhoto('receipt', v(0, 1, 0), scored),
    ];
    const photos = new Map(matches.map((m) => [m.mediaKey, trashable]));
    const counts = countCategories(matches, categories, photos, { minScore: 0.2, margin: 0.1 });
    const byId = new Map(counts.categories.map((c) => [c.category.id, c]));
    expect(byId.get('parking')!.trashable.map((p) => p.mediaKey)).toEqual(['car park']);
    expect(byId.get('parking')!.closeCalls).toBe(2);
    expect(byId.get('people')!.closeCalls).toBe(1);
    expect(byId.get('people')!.trashable).toEqual([]);
    expect(byId.get('receipts')!.trashable.map((p) => p.mediaKey)).toEqual(['receipt']);
    expect(counts.photos).toBe(5);
  });

  it('never counts protected, unknown or queued photos as trashable, and sorts the rest by score', () => {
    const matches = ['a', 'b', 'c', 'd', 'e'].map((k, i) => matchPhoto(k, v(1 - i * 0.05, 0, 0), scored));
    const photos = new Map<string, ClutterPhoto>([
      ['a', { eligible: false, approved: false }],
      ['b', { eligible: true, approved: true }],
      ['c', trashable],
      ['e', trashable],
      // 'd' is missing from the scan: unknown, never trashable.
    ]);
    const parkingCount = countCategories(matches, categories, photos, { minScore: 0, margin: 0 }).categories[0]!;
    expect(parkingCount.category.id).toBe('parking');
    expect(parkingCount.trashable.map((p) => p.mediaKey)).toEqual(['c', 'e']);
    expect(parkingCount.protectedOrUnknown).toBe(2);
    expect(parkingCount.approved).toBe(1);
    expect(countLine(parkingCount)).toBe('Parking spots · 2 (2 protected or unknown, 1 already in the trash queue)');
  });

  it('suggests only clutter categories with enough photos, largest first', () => {
    const matches = [
      ...['p1', 'p2', 'p3'].map((k) => matchPhoto(k, v(1, 0, 0), scored)),
      ...['r1', 'r2'].map((k) => matchPhoto(k, v(0, 1, 0), scored)),
      ...['f1', 'f2', 'f3', 'f4'].map((k) => matchPhoto(k, v(0, 0, 1), scored)),
    ];
    const photos = new Map(matches.map((m) => [m.mediaKey, trashable]));
    const counts = countCategories(matches, categories, photos, { minScore: 0, margin: 0 });
    expect(counts.categories.map((c) => c.category.id)).toEqual(['people', 'parking', 'receipts']);
    expect(suggestions(counts, 2).map((c) => c.category.id)).toEqual(['parking', 'receipts']);
    expect(suggestions(counts, 3).map((c) => c.category.id)).toEqual(['parking']);
  });

  it('reports the spread of scores and leads, to choose the settings', () => {
    const matches = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((s, i) => ({ mediaKey: `${i}`, best: 0, bestScore: s, secondScore: s / 2 }));
    expect(scoreSpread(matches)).toEqual([
      { fraction: 0.1, bestScore: 0.2, lead: 0.1 },
      { fraction: 0.5, bestScore: 0.6, lead: 0.3 },
      { fraction: 0.9, bestScore: 1.0, lead: 0.5 },
    ]);
    expect(scoreSpread([])).toEqual([]);
  });

  it('ships both kinds, with unique ids and descriptions', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    expect(CATEGORIES.some((c) => c.kind === 'clutter')).toBe(true);
    expect(CATEGORIES.some((c) => c.kind === 'keep')).toBe(true);
    // People are always a counterweight, never clutter.
    expect(CATEGORIES.find((c) => c.id === 'people')?.kind).toBe('keep');
    const descriptions = CATEGORIES.flatMap((c) => c.descriptions);
    expect(descriptions.every((d) => d.trim().length > 0)).toBe(true);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
