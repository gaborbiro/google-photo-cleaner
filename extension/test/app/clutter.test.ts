import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryList, categorySamples, countCategories, countLine, countSections, descriptionNorms, descriptionScores, evenSample, isCounted, kindTotals, leadOf, matchCaption, matchPhoto, moveCaption, movesLine, photoBreakdown, photoCaption, scoreSpread, scoringMoves, suggestions, weakestMatches, type Category, type ClutterPhoto, type ScoredCategory } from '../../src/app/search/clutter';

const v = (...xs: number[]) => Float32Array.from(xs);
const parking: Category = { id: 'parking', label: 'Parking spots', kind: 'clutter', descriptions: ['a car park', 'a parking space number'] };
const receipts: Category = { id: 'receipts', label: 'Receipts', kind: 'clutter', descriptions: ['a receipt'] };
const people: Category = { id: 'people', label: 'People', kind: 'counterweight', descriptions: ['a group of people'] };
const categories = [parking, receipts, people];
// One direction per category; parking's second description leans towards receipts (both have text).
const scored: ScoredCategory[] = [
  { category: parking, vectors: [v(1, 0, 0), v(0.6, 0.6, 0)] },
  { category: receipts, vectors: [v(0, 1, 0)] },
  { category: people, vectors: [v(0, 0, 1)] },
];
const trashable: ClutterPhoto = { eligible: true, approved: false };
/** Matched on raw scores. */
const match = (mediaKey: string, vector: Float32Array) => matchPhoto(mediaKey, descriptionScores(vector, scored), scored, null);

describe('clutter suggestions', () => {
  it('scores a category as its best description, and keeps the runner-up category', () => {
    expect(match('p', v(0.5, 0.5, 0))).toEqual({ mediaKey: 'p', best: 0, description: 1, bestScore: expect.closeTo(0.6, 5), secondScore: expect.closeTo(0.5, 5), otherKindScore: expect.closeTo(0, 5) });
    expect(match('q', v(0.1, 0.2, 0.9))).toMatchObject({ best: 2, bestScore: expect.closeTo(0.9, 5), secondScore: expect.closeTo(0.2, 5) });
  });

  it('counts a photo only for its best category, and only when that is clearly ahead', () => {
    const matches = [
      match('car park', v(0.9, 0.1, 0)),
      // A family in a car park: people is just ahead, so it is never counted as parking.
      match('family at the car', v(0.5, 0, 0.52)),
      // Parking by a whisker: a close call, not counted.
      match('kerb', v(0.4, 0.38, 0)),
      // Clearly parking, but weak: below the minimum score.
      match('faint', v(0.15, 0, 0)),
      match('receipt', v(0, 1, 0)),
    ];
    const photos = new Map(matches.map((m) => [m.mediaKey, trashable]));
    const counts = countCategories(matches, categories, photos, { minScore: 0.2, margin: 0.1 }, 'next');
    const byId = new Map(counts.categories.map((c) => [c.category.id, c]));
    expect(byId.get('parking')!.trashable.map((p) => p.mediaKey)).toEqual(['car park']);
    expect(byId.get('parking')!.closeCalls).toBe(2);
    expect(byId.get('people')!.closeCalls).toBe(1);
    expect(byId.get('people')!.trashable).toEqual([]);
    // Only close calls that cleared the minimum score are just missed; 'faint' missed the score.
    expect(byId.get('parking')!.justMissed).toEqual([{ mediaKey: 'kerb', description: 'a parking space number', score: expect.closeTo(0.468, 5), lead: expect.closeTo(0.088, 5) }]);
    expect(byId.get('people')!.justMissed.map((p) => p.mediaKey)).toEqual(['family at the car']);
    expect(byId.get('receipts')!.trashable.map((p) => p.mediaKey)).toEqual(['receipt']);
    expect(counts.photos).toBe(5);
    expect(kindTotals(counts)).toBe('Clutter 2 (40%) · counterweights 0 (0%) · close calls 3 (60%)');
  });

  it('never counts protected, unknown or queued photos as trashable, and sorts the rest by score', () => {
    const matches = ['a', 'b', 'c', 'd', 'e'].map((k, i) => match(k, v(1 - i * 0.05, 0, 0)));
    const photos = new Map<string, ClutterPhoto>([
      ['a', { eligible: false, approved: false }],
      ['b', { eligible: true, approved: true }],
      ['c', trashable],
      ['e', trashable],
      // 'd' is missing from the scan: unknown, never trashable.
    ]);
    const parkingCount = countCategories(matches, categories, photos, { minScore: 0, margin: 0 }, 'next').categories[0]!;
    expect(parkingCount.category.id).toBe('parking');
    expect(parkingCount.trashable.map((p) => p.mediaKey)).toEqual(['c', 'e']);
    expect(parkingCount.protectedOrUnknown).toBe(2);
    expect(parkingCount.approved).toBe(1);
    expect(countLine(parkingCount)).toBe('Parking spots · 2 (2 protected or unknown, 1 already in the trash queue)');
    // Protected, unknown and queued photos are counted too: every photo is somewhere.
    expect(kindTotals(countCategories(matches, categories, photos, { minScore: 0, margin: 0 }, 'next'))).toBe('Clutter 5 (100%) · counterweights 0 (0%) · close calls 0 (0%)');
  });

  it('lead over the other kind: two kinds of clutter close together still count, a close counterweight does not', () => {
    const matches = [
      // Parking or a receipt? Clutter either way, with people far behind.
      match('ticket', v(0.5, 0.55, 0.1)),
      // Parking only just ahead of people.
      match('selfie', v(0.6, 0, 0.58)),
      // People, measured against the best clutter.
      match('party', v(0.2, 0.1, 0.9)),
    ];
    expect(matches[0]).toMatchObject({ best: 0, description: 1, bestScore: expect.closeTo(0.63, 5), secondScore: expect.closeTo(0.55, 5), otherKindScore: expect.closeTo(0.1, 5) });
    expect(leadOf(matches[0]!, 'next')).toBeCloseTo(0.08, 5);
    expect(leadOf(matches[0]!, 'otherKind')).toBeCloseTo(0.53, 5);
    expect(leadOf(matches[2]!, 'otherKind')).toBeCloseTo(0.7, 5);
    const photos = new Map(matches.map((m) => [m.mediaKey, trashable]));
    const byId = (over: 'next' | 'otherKind') => new Map(countCategories(matches, categories, photos, { minScore: 0, margin: 0.1 }, over).categories.map((c) => [c.category.id, c]));
    expect(byId('next').get('parking')!.trashable).toEqual([]);
    expect(byId('next').get('parking')!.closeCalls).toBe(2);
    expect(byId('otherKind').get('parking')!.trashable).toEqual([{ mediaKey: 'ticket', description: 'a parking space number', score: expect.closeTo(0.63, 5), lead: expect.closeTo(0.53, 5) }]);
    expect(byId('otherKind').get('parking')!.justMissed.map((p) => p.mediaKey)).toEqual(['selfie']);
    expect(byId('otherKind').get('people')!.trashable.map((p) => p.mediaKey)).toEqual(['party']);
    expect(scoreSpread(matches, 'otherKind').map((s) => s.lead)).toEqual([0.02, 0.53, 0.7].map((x) => expect.closeTo(x, 5)));
    expect(photoBreakdown(descriptionScores(v(0.5, 0.55, 0.1), scored), scored, null, 'otherKind', 1).heading).toBe('Parking spots, 0.530 ahead of People');
    expect(photoBreakdown(descriptionScores(v(0.2, 0.1, 0.9), scored), scored, null, 'otherKind', 1).heading).toBe('People, 0.700 ahead of Parking spots');
  });

  it('the lead over the other kind is never smaller, so it only adds photos', () => {
    for (const vector of [v(0.5, 0.55, 0.1), v(0.6, 0, 0.58), v(0.2, 0.1, 0.9), v(0.3, 0.3, 0.3), v(0, 1, 0), v(0.1, 0.9, 0.85)]) {
      const m = match('p', vector);
      expect(leadOf(m, 'otherKind')).toBeGreaterThanOrEqual(leadOf(m, 'next'));
    }
  });

  it('refuses to match without both kinds of category', () => {
    const clutterOnly = scored.slice(0, 2);
    expect(() => matchPhoto('p', descriptionScores(v(1, 0, 0), clutterOnly), clutterOnly, null)).toThrow('both clutter categories and counterweights');
  });

  describe('what evening out moves', () => {
    /** A match whose lead over the next category and over the other kind is [lead]. */
    const m = (mediaKey: string, best: number, score: number, lead: number) => ({ mediaKey, best, description: 0, bestScore: score, secondScore: score - lead, otherKindScore: score - lead });
    const settings = { raw: { minScore: 0, margin: 0.02 }, evened: { minScore: 0, margin: 0.2 } };
    const raw = [m('a', 2, 0.7, 0.1), m('b', 2, 0.7, 0.1), m('c', 0, 0.7, 0.1), m('d', 2, 0.7, 0.1), m('e', 2, 0.7, 0.1), m('f', 0, 0.7, 0.1)];
    const evened = [
      m('a', 0, 3, 1), // people → parking
      m('b', 0, 3, 0.05), // people → parking, but a close call evened out: not counted, so not moved
      m('c', 2, 2, 1), // parking → people
      m('d', 1, 4, 1), // people → receipts
      m('e', 0, 3, 1), // people → parking, but protected
      m('f', 1, 3, 1), // parking → receipts: clutter either way
    ];
    const photos = new Map<string, ClutterPhoto>(raw.map((r) => [r.mediaKey, r.mediaKey === 'e' ? { eligible: false, approved: false } : trashable]));

    it('lists photos counted as one kind with raw scores and the other evened out, each with its own settings', () => {
      const moves = scoringMoves(raw, evened, categories, photos, settings, 'next');
      expect(moves.toClutter.map((p) => p.mediaKey)).toEqual(['d', 'a']);
      expect(moves.toCounterweights.map((p) => p.mediaKey)).toEqual(['c']);
      expect(moveCaption(moves.toClutter[0]!, categories)).toEqual([
        { text: 'People', kind: 'counterweight' },
        { text: ' “a group of people” → ', kind: null },
        { text: 'Receipts', kind: 'clutter' },
        { text: ' “a receipt”', kind: null },
      ]);
      expect(movesLine(moves)).toBe('Evening out moves 2 photos from counterweights to clutter, and 1 the other way (only photos that may be trashed).');
    });

    it('refuses scorings that matched different photos', () => {
      expect(() => scoringMoves(raw, evened.slice(1), categories, photos, settings, 'next')).toThrow('same photos');
      expect(() => scoringMoves(raw, [...evened].reverse(), categories, photos, settings, 'next')).toThrow('same order');
    });

    it('counts a photo exactly as the counts do', () => {
      expect(isCounted(m('p', 0, 0.7, 0.02), settings.raw, 'next')).toBe(true);
      expect(isCounted(m('p', 0, 0.7, 0.019), settings.raw, 'next')).toBe(false);
      expect(isCounted(m('p', 0, 0.7, 0.5), { minScore: 0.8, margin: 0 }, 'next')).toBe(false);
      const counts = countCategories(raw, categories, photos, settings.raw, 'next');
      const counted = counts.categories.reduce((sum, c) => sum + c.trashable.length + c.protectedOrUnknown + c.approved, 0);
      expect(counted).toBe(raw.filter((r) => isCounted(r, settings.raw, 'next')).length);
    });

    it('samples evenly from first to last, the same each time', () => {
      expect(evenSample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([0, 2, 5, 7]);
      expect(evenSample([1, 2], 5)).toEqual([1, 2]);
    });
  });

  it('finds the photos nothing matches well: lowest best score first, captioned with where they went', () => {
    const matches = [match('strong', v(1, 0, 0)), match('weak', v(0.2, 0.1, 0)), match('weakest', v(0, 0, 0.1)), match('middle', v(0.5, 0.5, 0))];
    expect(weakestMatches(matches, 2).map((m) => m.mediaKey)).toEqual(['weakest', 'weak']);
    expect(weakestMatches(matches, 10)).toHaveLength(4);
    expect(matches.map((m) => m.mediaKey)).toEqual(['strong', 'weak', 'weakest', 'middle']);
    expect(matchCaption(matches[2]!, categories)).toEqual([
      { text: '0.100 · ', kind: null },
      { text: 'People', kind: 'counterweight' },
      { text: ' “a group of people”', kind: null },
    ]);
    expect(() => matchCaption({ ...matches[0]!, best: 9 }, categories)).toThrow("wasn't matched against");
  });

  it('just missed: trashable close calls only, largest lead first', () => {
    // Parking leads receipts by 0.10, 0.05, 0.07, 0.02 and 0.01.
    const leads = [0.1, 0.05, 0.07, 0.02, 0.01];
    const matches = leads.map((lead, i) => ({ mediaKey: `m${i}`, best: 0, description: 0, bestScore: 0.7, secondScore: 0.7 - lead, otherKindScore: 0 }));
    const photos = new Map<string, ClutterPhoto>([
      ['m0', trashable],
      ['m1', trashable],
      ['m2', { eligible: false, approved: false }],
      ['m3', { eligible: true, approved: true }],
      ['m4', trashable],
    ]);
    const parkingCount = countCategories(matches, categories, photos, { minScore: 0, margin: 0.08 }, 'next').categories.find((c) => c.category.id === 'parking')!;
    expect(parkingCount.trashable.map((p) => p.mediaKey)).toEqual(['m0']);
    expect(parkingCount.closeCalls).toBe(4);
    // m2 is protected and m3 already queued: never shown as just missed.
    expect(parkingCount.justMissed.map((p) => p.mediaKey)).toEqual(['m1', 'm4']);
  });

  it('samples a category from both ends of its scores and both sides of the minimum lead', () => {
    const photo = (mediaKey: string, score: number, lead: number) => ({ mediaKey, description: 'a car park', score, lead });
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
    expect(samples.strongest.map((p) => p.mediaKey)).toEqual(['a', 'b']);
    expect(samples.weakest.map((p) => p.mediaKey)).toEqual(['d', 'e']);
    expect(samples.justCounted.map((p) => p.mediaKey)).toEqual(['e', 'b']);
    expect(samples.justMissed.map((p) => p.mediaKey)).toEqual(['x', 'y']);
    // Counted order is left alone.
    expect(count.trashable.map((p) => p.mediaKey)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // Too few for both ends: the weakest don't repeat the strongest.
    expect(categorySamples(count, 3).weakest.map((p) => p.mediaKey)).toEqual(['d', 'e']);
    expect(photoCaption(photo('a', 6.3491, 1.2))).toBe('6.349 · lead 1.2000 · “a car park”');
    // Just under a minimum lead of 0.02: shown as under it, never rounded up to it.
    expect(photoCaption(photo('b', 0.663, 0.019996))).toBe('0.663 · lead 0.0199 · “a car park”');
    expect(photoCaption(photo('b', 0.663, 0.02))).toBe('0.663 · lead 0.0200 · “a car park”');
    expect(photoCaption(photo('b', 0.663, 0.0123))).toBe('0.663 · lead 0.0123 · “a car park”');
  });

  it('suggests only clutter categories with enough photos, largest first', () => {
    const matches = [
      ...['p1', 'p2', 'p3'].map((k) => match(k, v(1, 0, 0))),
      ...['r1', 'r2'].map((k) => match(k, v(0, 1, 0))),
      ...['f1', 'f2', 'f3', 'f4'].map((k) => match(k, v(0, 0, 1))),
    ];
    const photos = new Map(matches.map((m) => [m.mediaKey, trashable]));
    const counts = countCategories(matches, categories, photos, { minScore: 0, margin: 0 }, 'next');
    expect(counts.categories.map((c) => c.category.id)).toEqual(['people', 'parking', 'receipts']);
    expect(kindTotals(counts)).toBe('Clutter 5 (56%) · counterweights 4 (44%) · close calls 0 (0%)');
    expect(suggestions(counts, 2).map((c) => c.category.id)).toEqual(['parking', 'receipts']);
    expect(suggestions(counts, 3).map((c) => c.category.id)).toEqual(['parking']);
  });

  it('reports the spread of scores and leads, to choose the settings', () => {
    const matches = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((s, i) => ({ mediaKey: `${i}`, best: 0, description: 0, bestScore: s, secondScore: s / 2, otherKindScore: 0 }));
    expect(scoreSpread(matches, 'next')).toEqual([
      { fraction: 0.1, bestScore: 0.2, lead: 0.1 },
      { fraction: 0.5, bestScore: 0.6, lead: 0.3 },
      { fraction: 0.9, bestScore: 1.0, lead: 0.5 },
    ]);
    expect(scoreSpread([], 'next')).toEqual([]);
  });

  it('breaks a photo down by category, best first, with the description each scored as', () => {
    expect(photoBreakdown(descriptionScores(v(0.5, 0.5, 0), scored), scored, null, 'next', 2)).toEqual({
      heading: 'Parking spots, 0.100 ahead of Receipts',
      rows: [
        { label: 'Parking spots', kind: 'clutter', score: '0.600', description: 'a parking space number' },
        { label: 'Receipts', kind: 'clutter', score: '0.500', description: 'a receipt' },
      ],
      more: '1 more category scored lower',
    });
    expect(photoBreakdown(descriptionScores(v(0.1, 0.2, 0.9), scored), scored, null, 'next', 3)).toMatchObject({ heading: 'People, 0.700 ahead of Receipts', more: null });
  });

  it('puts first the category the photo was matched to, ties included', () => {
    for (const vector of [v(0.5, 0.5, 0), v(0.1, 0.2, 0.9), v(0, 1, 0), v(0, 0, 0), v(0.3, 0.3, 0.3)]) {
      const best = scored[match('p', vector).best]!.category.label;
      expect(photoBreakdown(descriptionScores(vector, scored), scored, null, 'next', 1).rows[0]!.label).toBe(best);
    }
  });

  // Scores per description, in the order parking (2), receipts, people. Parking's first description
  // scores about 0.70 on every photo; people's scores vary much more.
  const library = [
    v(0.70, 0.1, 0.3, 0.40),
    v(0.68, 0.2, 0.1, 0.50),
    v(0.70, 0.1, 0.2, 0.45),
    // A selfie in a car park: raw, parking's always-high description wins; evened out, people does.
    v(0.72, 0.2, 0.2, 0.65),
  ];

  it("measures each description's average and spread over the library", () => {
    const norms = descriptionNorms(library);
    expect([...norms.mean]).toEqual([0.7, 0.15, 0.2, 0.5].map((x) => expect.closeTo(x, 5)));
    expect([...norms.spread]).toEqual([Math.sqrt(0.0002), 0.05, Math.sqrt(0.005), Math.sqrt(0.00875)].map((x) => expect.closeTo(x, 5)));
  });

  it('evened out, a description that scores high on every photo no longer wins by default', () => {
    const selfie = library[3]!;
    expect(matchPhoto('selfie', selfie, scored, null)).toMatchObject({ best: 0, bestScore: expect.closeTo(0.72, 5), secondScore: expect.closeTo(0.65, 5) });
    const norms = descriptionNorms(library);
    // People: 0.15 above its average of 0.5, 1.60 spreads; parking: 0.02 above 0.70, 1.41 spreads.
    expect(matchPhoto('selfie', selfie, scored, norms)).toMatchObject({ best: 2, bestScore: expect.closeTo(0.15 / Math.sqrt(0.00875), 4), secondScore: expect.closeTo(Math.SQRT2, 4) });
    expect(photoBreakdown(selfie, scored, norms, 'next', 2)).toMatchObject({
      heading: 'People, 0.189 ahead of Parking spots',
      rows: [
        { label: 'People', score: '1.604', description: 'a group of people' },
        { label: 'Parking spots', score: '1.414', description: 'a car park' },
      ],
    });
    for (const [i, row] of library.entries()) {
      const best = scored[matchPhoto(`${i}`, row, scored, norms).best]!.category.label;
      expect(photoBreakdown(row, scored, norms, 'next', 1).rows[0]!.label).toBe(best);
    }
  });

  it('refuses to even out what it cannot, and scores that do not fit the categories', () => {
    expect(() => descriptionNorms([library[0]!])).toThrow('at least two photos');
    expect(() => descriptionNorms([library[0]!, v(0.7, 0.1, 0.3)])).toThrow('different descriptions');
    expect(() => descriptionNorms([v(0.7, 0.1, 0.3, 0.4), v(0.7, 0.2, 0.1, 0.5)])).toThrow('Description 0 scores every photo the same');
    expect(() => matchPhoto('p', v(0.7, 0.1, 0.3), scored, null)).toThrow("don't fit");
    expect(() => matchPhoto('p', library[0]!, scored, descriptionNorms([v(1, 2), v(2, 1)]))).toThrow("don't fit");
  });

  it('lists every category once, clutter first, with a summary', () => {
    const list = categoryList(categories);
    expect(list.summary).toBe('2 clutter categories and 1 counterweight');
    expect(list.groups.map((g) => [g.title, g.count, g.categories.map((c) => c.id)])).toEqual([
      ['Clutter', 2, ['parking', 'receipts']],
      ['Counterweights', 1, ['people']],
    ]);
    const shipped = categoryList(CATEGORIES).groups.flatMap((g) => g.categories);
    expect(shipped).toHaveLength(CATEGORIES.length);
    expect(new Set(shipped)).toEqual(new Set(CATEGORIES));
  });

  it('splits the counts into suggestions, too few to suggest, and counterweights', () => {
    const matches = [
      ...['p1', 'p2', 'p3'].map((k) => match(k, v(1, 0, 0))),
      ...['r1'].map((k) => match(k, v(0, 1, 0))),
      ...['f1', 'f2', 'f3', 'f4'].map((k) => match(k, v(0, 0, 1))),
    ];
    const photos = new Map(matches.map((m) => [m.mediaKey, trashable]));
    const sections = countSections(countCategories(matches, categories, photos, { minScore: 0, margin: 0 }, 'next'), 2);
    expect(sections.suggested.map((c) => c.category.id)).toEqual(['parking']);
    expect(sections.tooFew).toBe('Too few to suggest: Receipts · 1');
    // Counterweights are never suggested, however many photos they hold.
    expect(sections.counterweights.map((c) => c.category.id)).toEqual(['people']);
    expect(countSections(countCategories(matches, categories, photos, { minScore: 0, margin: 0 }, 'next'), 1).tooFew).toBeNull();
  });

  it('ships both kinds, with unique ids and descriptions', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    expect(CATEGORIES.some((c) => c.kind === 'clutter')).toBe(true);
    expect(CATEGORIES.some((c) => c.kind === 'counterweight')).toBe(true);
    // People are always a counterweight, never clutter.
    expect(CATEGORIES.find((c) => c.id === 'people')?.kind).toBe('counterweight');
    const descriptions = CATEGORIES.flatMap((c) => c.descriptions);
    expect(descriptions.every((d) => d.trim().length > 0)).toBe(true);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
