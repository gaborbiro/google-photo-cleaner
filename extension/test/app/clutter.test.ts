import { describe, expect, it } from 'vitest';
import {
  categorySamples,
  countLine,
  descriptionNorms,
  descriptionScores,
  evenedRow,
  evenedRows,
  hoverCardTop,
  leadText,
  MAX_BUFFS,
  nudged,
  phrase,
  photoCaption,
  smallestStep,
  stayButton,
  stayTitle,
  typedNumber,
  unknownWeights,
  weightChanges,
  weightedDescriptionScores,
  weightedScores,
  withWeight,
  type Category,
  type ScoredCategory,
  type Weights,
} from '../../src/app/search/clutter';

// What the subject-and-setting matching (clutterAxes.test.ts) is built on.

const v = (...xs: number[]) => Float32Array.from(xs);
const parking: Category = { id: 'parking', label: 'Parking spots', kind: 'clutter', descriptions: ['a car park', 'a parking space number'] };
const receipts: Category = { id: 'receipts', label: 'Receipts', kind: 'clutter', descriptions: ['a receipt'] };
const people: Category = { id: 'people', label: 'People', kind: 'counterweight', descriptions: ['a group of people'] };
// One direction per category; parking's second description leans towards receipts (both have text).
const scored: ScoredCategory[] = [
  { category: parking, vectors: [v(1, 0, 0), v(0.6, 0.6, 0)] },
  { category: receipts, vectors: [v(0, 1, 0)] },
  { category: people, vectors: [v(0, 0, 1)] },
];
const none: Weights = { categoryWeights: {}, descriptionWeights: {} };

describe('scores', () => {
  it('scores every description, and a category as its best description', () => {
    const row = descriptionScores(v(0.5, 0.5, 0), scored);
    expect([...row]).toEqual([0.5, 0.6, 0.5, 0].map((x) => expect.closeTo(x, 5)));
    expect(weightedScores(row, scored, none)).toEqual([
      { score: expect.closeTo(0.6, 5), description: 1 },
      { score: expect.closeTo(0.5, 5), description: 0 },
      { score: 0, description: 0 },
    ]);
  });

  it('adds a description weight to it alone, and a category weight to all its descriptions', () => {
    const row = v(0.5, 0.6, 0.5, 0);
    expect([...weightedDescriptionScores(row, scored, { categoryWeights: {}, descriptionWeights: { 'a car park': 0.2 } })]).toEqual([0.7, 0.6, 0.5, 0].map((x) => expect.closeTo(x, 5)));
    // Enough on "a car park" changes which description parking scores as.
    expect(weightedScores(row, scored, { categoryWeights: {}, descriptionWeights: { 'a car park': 0.2 } })[0]).toEqual({ score: expect.closeTo(0.7, 5), description: 0 });
    expect([...weightedDescriptionScores(row, scored, { categoryWeights: { parking: -0.1 }, descriptionWeights: { 'a car park': 0.02 } })]).toEqual([0.42, 0.5, 0.5, 0].map((x) => expect.closeTo(x, 5)));
  });

  it("refuses weights for what isn't in the list, weights that aren't numbers, and scores that don't fit", () => {
    const stale: Weights = { categoryWeights: { gone: 0.01 }, descriptionWeights: { 'a photo of the floor': 0.01 } };
    expect(unknownWeights(stale, scored.map((s) => s.category))).toEqual(['gone', 'a photo of the floor']);
    expect(() => weightedScores(v(0.5, 0.6, 0.5, 0), scored, stale)).toThrow("Weights for what isn't in the list: gone, a photo of the floor");
    expect(() => weightedScores(v(0.5, 0.6, 0.5, 0), scored, { categoryWeights: { people: NaN }, descriptionWeights: {} })).toThrow("isn't a number");
    expect(() => weightedScores(v(0.5, 0.6, 0.5), scored, none)).toThrow("don't fit");
  });
});

describe('evening out', () => {
  // Scores per description, in the order parking (2), receipts, people. Parking's first description
  // scores about 0.70 on every photo; people's scores vary much more.
  const library = [v(0.7, 0.1, 0.3, 0.4), v(0.68, 0.2, 0.1, 0.5), v(0.7, 0.1, 0.2, 0.45), v(0.72, 0.2, 0.2, 0.65)];

  it("measures each description's average and spread over the library", () => {
    const norms = descriptionNorms(library);
    expect([...norms.mean]).toEqual([0.7, 0.15, 0.2, 0.5].map((x) => expect.closeTo(x, 5)));
    expect([...norms.spread]).toEqual([Math.sqrt(0.0002), 0.05, Math.sqrt(0.005), Math.sqrt(0.00875)].map((x) => expect.closeTo(x, 5)));
  });

  it('evened out, a description that scores high on every photo no longer wins by default', () => {
    // A selfie in a car park: raw, parking's always-high description wins.
    const selfie = library[3]!;
    expect(weightedScores(selfie, scored, none).map((s) => s.score)).toEqual([0.72, 0.2, 0.65].map((x) => expect.closeTo(x, 5)));
    // Evened out, people does: 0.15 above its average, 1.60 spreads; parking 0.02 above, 1.41 spreads; receipts at its average.
    const evened = evenedRow(selfie, descriptionNorms(library));
    expect(weightedScores(evened, scored, none).map((s) => s.score)).toEqual([Math.SQRT2, 0, 0.15 / Math.sqrt(0.00875)].map((x) => expect.closeTo(x, 4)));
    // Every photo, by its key, evened out over all of them.
    const rows = evenedRows(new Map(library.map((row, i) => [`p${i}`, row])));
    expect([...rows.keys()]).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect([...rows.get('p3')!]).toEqual([...evened].map((x) => expect.closeTo(x, 5)));
  });

  it('refuses to even out what it cannot', () => {
    expect(() => descriptionNorms([library[0]!])).toThrow('at least two photos');
    expect(() => descriptionNorms([library[0]!, v(0.7, 0.1, 0.3)])).toThrow('different descriptions');
    expect(() => descriptionNorms([v(0.7, 0.1, 0.3, 0.4), v(0.7, 0.2, 0.1, 0.5)])).toThrow('Description 0 scores every photo the same');
    expect(() => evenedRow(v(0.7, 0.1, 0.3), descriptionNorms(library))).toThrow("don't fit");
  });
});

describe('weights', () => {
  it('sets and clears a weight; 0 is no weight', () => {
    expect(withWeight({ a: 0.01 }, 'b', 0.02)).toEqual({ a: 0.01, b: 0.02 });
    expect(withWeight({ a: 0.01, b: 0.02 }, 'b', undefined)).toEqual({ a: 0.01 });
    expect(withWeight({ a: 0.01 }, 'a', 0)).toEqual({});
  });

  it('adds to a weight, keeping it as typed', () => {
    expect(nudged({}, 'a screenshot of an app', 0.01)).toEqual({ 'a screenshot of an app': 0.01 });
    expect(nudged({ 'a screenshot of an app': 0.02 }, 'a screenshot of an app', 0.0123)).toEqual({ 'a screenshot of an app': 0.0323 });
    // Back to no weight: left out.
    expect(nudged({ 'a selfie': -0.01, 'a lake': 0.02 }, 'a selfie', 0.01)).toEqual({ 'a lake': 0.02 });
  });

  it('lists the description weights that changed, in the order of the list', () => {
    const categories = scored.map((s) => s.category);
    expect(weightChanges({ descriptionWeights: { 'a receipt': 0.01, 'a car park': 0.02 } }, { descriptionWeights: { 'a car park': 0.02, 'a group of people': 0.0071, 'a receipt': 0.0150001 } }, categories)).toEqual([
      { description: 'a receipt', by: 0.005 },
      { description: 'a group of people', by: 0.0071 },
    ]);
  });

  it('reads what is typed into a field as a number only once it is one', () => {
    expect(typedNumber('')).toBeUndefined();
    expect(typedNumber('  ')).toBeUndefined();
    expect(typedNumber('-')).toBeNull();
    expect(typedNumber('0.02x')).toBeNull();
    expect(typedNumber('-0.03')).toBe(-0.03);
    expect(typedNumber('0.')).toBe(0);
  });
});

describe("a category's photos on the page", () => {
  const photo = (mediaKey: string, score: number, lead: number) => ({ mediaKey, description: 'a car park', score, lead });

  it('samples a category as Search will show it (best, riskiest) and for the developer page (lowest scores, just missed)', () => {
    const count = {
      category: parking,
      // Best score first, as counted.
      trashable: [photo('a', 0.9, 0.3), photo('b', 0.8, 0.05), photo('c', 0.7, 0.2), photo('d', 0.6, 0.1), photo('e', 0.5, 0.04)],
      protectedOrUnknown: 0,
      approved: 0,
      closeCalls: 3,
      justMissed: [photo('x', 0.7, 0.03), photo('y', 0.6, 0.02), photo('z', 0.9, 0.01)],
    };
    const samples = categorySamples(count, 2);
    expect(samples.best.map((p) => p.mediaKey)).toEqual(['a', 'b']);
    // Smallest leads first, not repeating the best: b (lead 0.05) is among the best, so e, d.
    expect(samples.riskiest.map((p) => p.mediaKey)).toEqual(['e', 'd']);
    expect(samples.lowestScores.map((p) => p.mediaKey)).toEqual(['d', 'e']);
    expect(samples.justMissed.map((p) => p.mediaKey)).toEqual(['x', 'y']);
    // Counted order is left alone.
    expect(count.trashable.map((p) => p.mediaKey)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // Too few for both ends: neither repeats the best.
    expect(categorySamples(count, 3).lowestScores.map((p) => p.mediaKey)).toEqual(['d', 'e']);
    expect(categorySamples(count, 3).riskiest.map((p) => p.mediaKey)).toEqual(['e', 'd']);
    expect(categorySamples(count, 5).riskiest).toEqual([]);
    expect(countLine(count)).toBe('Parking spots · 5 (3 close calls not counted)');
    expect(countLine({ ...count, protectedOrUnknown: 2, approved: 1, closeCalls: 0 })).toBe('Parking spots · 5 (2 protected or unknown, 1 already in the trash queue)');
  });

  it('captions a photo with its score and lead, never rounding a lead up to the minimum', () => {
    expect(photoCaption(photo('a', 6.3491, 1.2))).toBe('6.349 · lead 1.2000 · “a car park”');
    // Just under a minimum lead of 0.02: shown as under it, never rounded up to it.
    expect(photoCaption(photo('b', 0.663, 0.019996))).toBe('0.663 · lead 0.0199 · “a car park”');
    expect(photoCaption(photo('b', 0.663, 0.02))).toBe('0.663 · lead 0.0200 · “a car park”');
    expect(photoCaption(photo('b', 0.663, 0.0123))).toBe('0.663 · lead 0.0123 · “a car park”');
    // Float32 scores: 0.9 − 0.2 is 0.69999999, still "0.7000"; a real 0.69996 is "0.6999".
    expect(leadText(Math.fround(0.9) - Math.fround(0.2))).toBe('0.7000');
    expect(leadText(0.69996)).toBe('0.6999');
    expect(leadText(-0.0031)).toBe('-0.0031');
    expect(phrase(parking, 1)).toBe('a parking space number');
    expect(() => phrase(parking, 2)).toThrow("isn't in its category");
  });

  it('finds the smallest step that reaches something, to a ten-thousandth, or none beyond the largest buff of the scoring', () => {
    expect(smallestStep((by) => by >= 0.01234, MAX_BUFFS.raw)).toBe(0.0124);
    expect(smallestStep((by) => by >= 0.00995, MAX_BUFFS.raw)).toBe(0.01);
    expect(smallestStep((by) => by > MAX_BUFFS.raw, MAX_BUFFS.raw)).toBeNull();
    // Evened-out scores count in spreads, where a lead of 0.7 is ordinary: within reach there, not with raw scores.
    expect(smallestStep((by) => by >= 0.6995, MAX_BUFFS.raw)).toBeNull();
    expect(smallestStep((by) => by >= 0.6995, MAX_BUFFS.evened)).toBeCloseTo(0.6995, 3);
  });

  it('says what Stay does, or why it can’t', () => {
    expect(stayButton(0.0123)).toBe('Stay +0.0123');
    expect(stayTitle(0.0123, 'a receipt', 'Receipts', MAX_BUFFS.raw)).toBe('+0.0123 to “a receipt”: just enough for this photo to stay in Receipts; it applies to every photo');
    expect(stayButton(null)).toBe('Can’t stay');
    expect(stayTitle(null, 'a receipt', 'Receipts', MAX_BUFFS.raw)).toBe('“a receipt” would need more than +0.2 for this photo to stay in Receipts');
    expect(stayTitle(null, 'a receipt', 'Receipts', MAX_BUFFS.evened)).toBe('“a receipt” would need more than +3 for this photo to stay in Receipts');
  });

  it('opens a hover card level with its photo, or lifted to stay inside the window', () => {
    // Fits below: level with the photo.
    expect(hoverCardTop(100, 300, 1000, 8)).toBe(0);
    // A photo in the bottom row: lifted so the card ends 8px above the window's bottom.
    expect(hoverCardTop(900, 300, 1000, 8)).toBe(-208);
    // A card taller than the window: lifted only up to the window's top.
    expect(hoverCardTop(200, 1500, 1000, 8)).toBe(-192);
    // A photo partly above the window: not lifted further.
    expect(hoverCardTop(-50, 1500, 1000, 8)).toBe(0);
  });
});
