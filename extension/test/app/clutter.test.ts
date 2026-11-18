import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryList, categorySamples, clearWeights, countCategories, countLine, countSections, descriptionNorms, descriptionScores, evenSample, fitPriority, isCounted, kindTotals, leadOf, matchCaption, matchPhoto, moveCaption, movePriority, movesLine, NO_WEIGHTING, photoBreakdown, photoCaption, pooledScore, readTuning, saveTuning, scoreSpread, scoringMoves, shippedPriority, STARTING_SETTINGS, suggestions, tuningLine, typedNumber, unknownWeights, weakestMatches, withMargin, withWeight, type Category, type ClutterPhoto, type ClutterSettings, type ScoredCategory, type Weighting } from '../../src/app/search/clutter';

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
/** Settings with this minimum score and lead, no weights and no pooling. */
const at = (minScore: number, margin: number, more: Partial<ClutterSettings> = {}): ClutterSettings => ({ ...NO_WEIGHTING, minScore, margin, margins: {}, ...more });
/** Suggestions in the order the categories are listed. */
const ORDER = shippedPriority(categories);
/** Matched on raw scores. */
const match = (mediaKey: string, vector: Float32Array) => matchPhoto(mediaKey, descriptionScores(vector, scored), scored, null, NO_WEIGHTING);

describe('clutter suggestions', () => {
  it('scores a category as its best description, and keeps the runner-up category', () => {
    expect(match('p', v(0.5, 0.5, 0))).toEqual({ mediaKey: 'p', best: 0, description: 1, bestScore: expect.closeTo(0.6, 5), secondScore: expect.closeTo(0.5, 5), ownKindScore: expect.closeTo(0.6, 5), otherKindScore: expect.closeTo(0, 5) });
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
    const counts = countCategories(matches, categories, photos, at(0.2, 0.1), 'next');
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
    const parkingCount = countCategories(matches, categories, photos, at(0, 0), 'next').categories[0]!;
    expect(parkingCount.category.id).toBe('parking');
    expect(parkingCount.trashable.map((p) => p.mediaKey)).toEqual(['c', 'e']);
    expect(parkingCount.protectedOrUnknown).toBe(2);
    expect(parkingCount.approved).toBe(1);
    expect(countLine(parkingCount)).toBe('Parking spots · 2 (2 protected or unknown, 1 already in the trash queue)');
    // Protected, unknown and queued photos are counted too: every photo is somewhere.
    expect(kindTotals(countCategories(matches, categories, photos, at(0, 0), 'next'))).toBe('Clutter 5 (100%) · counterweights 0 (0%) · close calls 0 (0%)');
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
    const byId = (over: 'next' | 'otherKind') => new Map(countCategories(matches, categories, photos, at(0, 0.1), over).categories.map((c) => [c.category.id, c]));
    expect(byId('next').get('parking')!.trashable).toEqual([]);
    expect(byId('next').get('parking')!.closeCalls).toBe(2);
    expect(byId('otherKind').get('parking')!.trashable).toEqual([{ mediaKey: 'ticket', description: 'a parking space number', score: expect.closeTo(0.63, 5), lead: expect.closeTo(0.53, 5) }]);
    expect(byId('otherKind').get('parking')!.justMissed.map((p) => p.mediaKey)).toEqual(['selfie']);
    expect(byId('otherKind').get('people')!.trashable.map((p) => p.mediaKey)).toEqual(['party']);
    expect(scoreSpread(matches, 'otherKind').map((s) => s.lead)).toEqual([0.02, 0.53, 0.7].map((x) => expect.closeTo(x, 5)));
    expect(photoBreakdown(descriptionScores(v(0.5, 0.55, 0.1), scored), scored, null, NO_WEIGHTING, 'otherKind', 1).heading).toBe('Parking spots, 0.530 ahead of People');
    expect(photoBreakdown(descriptionScores(v(0.2, 0.1, 0.9), scored), scored, null, NO_WEIGHTING, 'otherKind', 1).heading).toBe('People, 0.700 ahead of Parking spots');
  });

  it('the lead over the other kind is never smaller, so it only adds photos', () => {
    for (const vector of [v(0.5, 0.55, 0.1), v(0.6, 0, 0.58), v(0.2, 0.1, 0.9), v(0.3, 0.3, 0.3), v(0, 1, 0), v(0.1, 0.9, 0.85)]) {
      const m = match('p', vector);
      expect(leadOf(m, 'otherKind')).toBeGreaterThanOrEqual(leadOf(m, 'next'));
    }
  });

  it('refuses to match without both kinds of category', () => {
    const clutterOnly = scored.slice(0, 2);
    expect(() => matchPhoto('p', descriptionScores(v(1, 0, 0), clutterOnly), clutterOnly, null, NO_WEIGHTING)).toThrow('both clutter categories and counterweights');
  });

  describe('what evening out moves', () => {
    /** A match whose lead over the next category and over the other kind is [lead]. */
    const m = (mediaKey: string, best: number, score: number, lead: number) => ({ mediaKey, best, description: 0, bestScore: score, secondScore: score - lead, ownKindScore: score, otherKindScore: score - lead });
    const settings = { raw: at(0, 0.02), evened: at(0, 0.2) };
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
      expect(isCounted(m('p', 0, 0.7, 0.02), categories, settings.raw, 'next')).toBe(true);
      expect(isCounted(m('p', 0, 0.7, 0.019), categories, settings.raw, 'next')).toBe(false);
      expect(isCounted(m('p', 0, 0.7, 0.5), categories, at(0.8, 0), 'next')).toBe(false);
      const counts = countCategories(raw, categories, photos, settings.raw, 'next');
      const counted = counts.categories.reduce((sum, c) => sum + c.trashable.length + c.protectedOrUnknown + c.approved, 0);
      expect(counted).toBe(raw.filter((r) => isCounted(r, categories, settings.raw, 'next')).length);
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
    const matches = leads.map((lead, i) => ({ mediaKey: `m${i}`, best: 0, description: 0, bestScore: 0.7, secondScore: 0.7 - lead, ownKindScore: 0.7, otherKindScore: 0 }));
    const photos = new Map<string, ClutterPhoto>([
      ['m0', trashable],
      ['m1', trashable],
      ['m2', { eligible: false, approved: false }],
      ['m3', { eligible: true, approved: true }],
      ['m4', trashable],
    ]);
    const parkingCount = countCategories(matches, categories, photos, at(0, 0.08), 'next').categories.find((c) => c.category.id === 'parking')!;
    expect(parkingCount.trashable.map((p) => p.mediaKey)).toEqual(['m0']);
    expect(parkingCount.closeCalls).toBe(4);
    // m2 is protected and m3 already queued: never shown as just missed.
    expect(parkingCount.justMissed.map((p) => p.mediaKey)).toEqual(['m1', 'm4']);
  });

  it('samples a category as Search will show it (best, riskiest) and for the developer page (lowest scores, just missed)', () => {
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
    const counts = countCategories(matches, categories, photos, at(0, 0), 'next');
    expect(counts.categories.map((c) => c.category.id)).toEqual(['people', 'parking', 'receipts']);
    expect(kindTotals(counts)).toBe('Clutter 5 (56%) · counterweights 4 (44%) · close calls 0 (0%)');
    expect(suggestions(counts, 2, ORDER).map((c) => c.category.id)).toEqual(['parking', 'receipts']);
    expect(suggestions(counts, 3, ORDER).map((c) => c.category.id)).toEqual(['parking']);
  });

  it('reports the spread of scores and leads, to choose the settings', () => {
    const matches = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((s, i) => ({ mediaKey: `${i}`, best: 0, description: 0, bestScore: s, secondScore: s / 2, ownKindScore: s, otherKindScore: 0 }));
    expect(scoreSpread(matches, 'next')).toEqual([
      { fraction: 0.1, bestScore: 0.2, lead: 0.1 },
      { fraction: 0.5, bestScore: 0.6, lead: 0.3 },
      { fraction: 0.9, bestScore: 1.0, lead: 0.5 },
    ]);
    expect(scoreSpread([], 'next')).toEqual([]);
  });

  it('breaks a photo down by category, best first, with the description each scored as', () => {
    expect(photoBreakdown(descriptionScores(v(0.5, 0.5, 0), scored), scored, null, NO_WEIGHTING, 'next', 2)).toEqual({
      heading: 'Parking spots, 0.100 ahead of Receipts',
      rows: [
        { label: 'Parking spots', kind: 'clutter', score: '0.600', description: 'a parking space number', weight: null },
        { label: 'Receipts', kind: 'clutter', score: '0.500', description: 'a receipt', weight: null },
      ],
      more: '1 more category scored lower',
    });
    expect(photoBreakdown(descriptionScores(v(0.1, 0.2, 0.9), scored), scored, null, NO_WEIGHTING, 'next', 3)).toMatchObject({ heading: 'People, 0.700 ahead of Receipts', more: null });
  });

  it('puts first the category the photo was matched to, ties included', () => {
    for (const vector of [v(0.5, 0.5, 0), v(0.1, 0.2, 0.9), v(0, 1, 0), v(0, 0, 0), v(0.3, 0.3, 0.3)]) {
      const best = scored[match('p', vector).best]!.category.label;
      expect(photoBreakdown(descriptionScores(vector, scored), scored, null, NO_WEIGHTING, 'next', 1).rows[0]!.label).toBe(best);
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
    expect(matchPhoto('selfie', selfie, scored, null, NO_WEIGHTING)).toMatchObject({ best: 0, bestScore: expect.closeTo(0.72, 5), secondScore: expect.closeTo(0.65, 5) });
    const norms = descriptionNorms(library);
    // People: 0.15 above its average of 0.5, 1.60 spreads; parking: 0.02 above 0.70, 1.41 spreads.
    expect(matchPhoto('selfie', selfie, scored, norms, NO_WEIGHTING)).toMatchObject({ best: 2, bestScore: expect.closeTo(0.15 / Math.sqrt(0.00875), 4), secondScore: expect.closeTo(Math.SQRT2, 4) });
    expect(photoBreakdown(selfie, scored, norms, NO_WEIGHTING, 'next', 2)).toMatchObject({
      heading: 'People, 0.189 ahead of Parking spots',
      rows: [
        { label: 'People', score: '1.604', description: 'a group of people' },
        { label: 'Parking spots', score: '1.414', description: 'a car park' },
      ],
    });
    for (const [i, row] of library.entries()) {
      const best = scored[matchPhoto(`${i}`, row, scored, norms, NO_WEIGHTING).best]!.category.label;
      expect(photoBreakdown(row, scored, norms, NO_WEIGHTING, 'next', 1).rows[0]!.label).toBe(best);
    }
  });

  it('refuses to even out what it cannot, and scores that do not fit the categories', () => {
    expect(() => descriptionNorms([library[0]!])).toThrow('at least two photos');
    expect(() => descriptionNorms([library[0]!, v(0.7, 0.1, 0.3)])).toThrow('different descriptions');
    expect(() => descriptionNorms([v(0.7, 0.1, 0.3, 0.4), v(0.7, 0.2, 0.1, 0.5)])).toThrow('Description 0 scores every photo the same');
    expect(() => matchPhoto('p', v(0.7, 0.1, 0.3), scored, null, NO_WEIGHTING)).toThrow("don't fit");
    expect(() => matchPhoto('p', library[0]!, scored, descriptionNorms([v(1, 2), v(2, 1)]), NO_WEIGHTING)).toThrow("don't fit");
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
    const sections = countSections(countCategories(matches, categories, photos, at(0, 0), 'next'), 2, ORDER);
    expect(sections.suggested.map((c) => c.category.id)).toEqual(['parking']);
    expect(sections.tooFew).toBe('Too few to suggest: Receipts · 1');
    // Counterweights are never suggested, however many photos they hold.
    expect(sections.counterweights.map((c) => c.category.id)).toEqual(['people']);
    expect(countSections(countCategories(matches, categories, photos, at(0, 0), 'next'), 1, ORDER).tooFew).toBeNull();
  });

  describe('pooling', () => {
    it('adds nothing to a lone score, and more the more scores are close to the best', () => {
      expect(pooledScore([0.7], 0.02)).toBeCloseTo(0.7, 10);
      expect(pooledScore([0.7, 0.7], 0.02)).toBeCloseTo(0.7 + 0.02 * Math.log(2), 10);
      expect(pooledScore([0.7, 0.7, 0.7], 0.02)).toBeCloseTo(0.7 + 0.02 * Math.log(3), 10);
      // Far behind: next to nothing.
      expect(pooledScore([0.7, 0.5], 0.02)).toBeCloseTo(0.7, 4);
      // No pooling: the best alone.
      expect(pooledScore([0.7, 0.69, 0.68], 0)).toBe(0.7);
      expect(pooledScore([], 0.02)).toBe(-Infinity);
      expect(() => pooledScore([0.7], -0.01)).toThrow('0 or more');
    });

    it('never pools below the best, nor lower for an extra score', () => {
      const scores = [0.64, 0.61, 0.606, 0.6];
      for (let i = 1; i <= scores.length; i++) {
        const some = scores.slice(0, i);
        expect(pooledScore(some, 0.02)).toBeGreaterThanOrEqual(Math.max(...some));
        if (i > 1) expect(pooledScore(some, 0.02)).toBeGreaterThan(pooledScore(scores.slice(0, i - 1), 0.02));
      }
    });

    // A photo of a computer screen with a child in it, from my library: one clutter category well
    // ahead of each counterweight, but several counterweights close together behind it.
    const screens: Category = { id: 'screens', label: 'Photos of screens', kind: 'clutter', descriptions: ['a computer screen'] };
    const children: Category = { id: 'children', label: 'Children', kind: 'counterweight', descriptions: ['a child playing'] };
    const family: Category = { id: 'family', label: 'People', kind: 'counterweight', descriptions: ['a family photo'] };
    const rooms: Category = { id: 'rooms', label: 'Ordinary scenes', kind: 'counterweight', descriptions: ['a room in a house'] };
    const four: ScoredCategory[] = [screens, children, family, rooms].map((category, i) => ({ category, vectors: [v(...[0, 1, 2, 3].map((j) => (i === j ? 1 : 0)))] }));
    // Scores 0.669 for screens, then 0.638, 0.626 and 0.623 (#166 on 2026-11-18).
    const row = v(0.669, 0.623, 0.626, 0.638);
    const pooled: Weighting = { ...NO_WEIGHTING, pooling: 0.02 };

    it('leaves out a clutter photo with several counterweights close behind, which the best one alone would let through', () => {
      const alone = matchPhoto('p', row, four, null, NO_WEIGHTING);
      expect(leadOf(alone, 'otherKind')).toBeCloseTo(0.031, 5);
      const together = matchPhoto('p', row, four, null, pooled);
      expect(together).toMatchObject({ best: 0, bestScore: expect.closeTo(0.669, 5), ownKindScore: expect.closeTo(0.669, 5) });
      const votes = 1 + Math.exp(-0.012 / 0.02) + Math.exp(-0.015 / 0.02);
      expect(together.otherKindScore).toBeCloseTo(0.638 + 0.02 * Math.log(votes), 6);
      // 0.669 − 0.652: under a minimum lead of 0.02, where the best counterweight alone left 0.031.
      expect(leadOf(together, 'otherKind')).toBeCloseTo(0.669 - 0.638 - 0.02 * Math.log(votes), 6);
      expect(leadOf(together, 'otherKind')).toBeCloseTo(0.0169, 4);
      expect(isCounted(alone, [screens, children, family, rooms], at(0, 0.02), 'otherKind')).toBe(true);
      expect(isCounted(together, [screens, children, family, rooms], at(0, 0.02), 'otherKind')).toBe(false);
      expect(photoBreakdown(row, four, null, pooled, 'otherKind', 2).heading).toBe('Photos of screens, 0.017 ahead: clutter pooled 0.669, counterweights pooled 0.652');
      expect(photoBreakdown(row, four, null, pooled, 'next', 2).heading).toBe('Photos of screens, 0.017 ahead of the other categories pooled (0.652)');
    });

    it('the lead over the other kind is never smaller with pooling either', () => {
      for (const vector of [v(0.5, 0.55, 0.1), v(0.6, 0, 0.58), v(0.2, 0.1, 0.9), v(0.3, 0.3, 0.3), v(0, 1, 0), v(0.1, 0.9, 0.85)]) {
        const m = matchPhoto('p', descriptionScores(vector, scored), scored, null, { ...NO_WEIGHTING, pooling: 0.05 });
        expect(leadOf(m, 'otherKind')).toBeGreaterThanOrEqual(leadOf(m, 'next') - 1e-12);
      }
    });
  });

  describe('weights', () => {
    // A boy at a computer (#74): Children 0.646 behind Photos of screens 0.686.
    const screens: Category = { id: 'screens', label: 'Photos of screens', kind: 'clutter', descriptions: ['a computer screen'] };
    const children: Category = { id: 'children', label: 'Children', kind: 'counterweight', descriptions: ['a child playing', 'a baby'] };
    const two: ScoredCategory[] = [{ category: screens, vectors: [v(1, 0, 0)] }, { category: children, vectors: [v(0, 1, 0), v(0, 0, 1)] }];
    const row = v(0.686, 0.646, 0.3);

    it('a description weight is added to its score before comparing, and only to it', () => {
      expect(leadOf(matchPhoto('p', row, two, null, NO_WEIGHTING), 'otherKind')).toBeCloseTo(0.04, 5);
      const stronger: Weighting = { ...NO_WEIGHTING, descriptionWeights: { 'a child playing': 0.03 } };
      expect(leadOf(matchPhoto('p', row, two, null, stronger), 'otherKind')).toBeCloseTo(0.01, 5);
      expect(photoBreakdown(row, two, null, stronger, 'otherKind', 2).rows).toEqual([
        { label: 'Photos of screens', kind: 'clutter', score: '0.686', description: 'a computer screen', weight: null },
        { label: 'Children', kind: 'counterweight', score: '0.676', description: 'a child playing', weight: '+0.030' },
      ]);
      // A weight on another description doesn't touch this one.
      expect(leadOf(matchPhoto('p', row, two, null, { ...NO_WEIGHTING, descriptionWeights: { 'a baby': 0.03 } }), 'otherKind')).toBeCloseTo(0.04, 5);
    });

    it("a category's weight is added to all its descriptions, with the description's own; enough of it changes the best category", () => {
      const both: Weighting = { ...NO_WEIGHTING, categoryWeights: { children: 0.03 }, descriptionWeights: { 'a child playing': 0.02 } };
      expect(matchPhoto('p', row, two, null, both)).toMatchObject({ best: 1, description: 0, bestScore: expect.closeTo(0.696, 5) });
      expect(photoBreakdown(row, two, null, both, 'next', 1).rows[0]).toMatchObject({ label: 'Children', weight: '+0.050' });
      // Weakening clutter works the same way, shown with a minus sign.
      const weaker: Weighting = { ...NO_WEIGHTING, categoryWeights: { screens: -0.05 } };
      expect(matchPhoto('p', row, two, null, weaker).best).toBe(1);
      expect(photoBreakdown(row, two, null, weaker, 'next', 2).rows[1]).toMatchObject({ label: 'Photos of screens', score: '0.636', weight: '−0.050' });
    });

    it("refuses weights for what isn't in the list, and weights that aren't numbers", () => {
      const stale: Weighting = { ...NO_WEIGHTING, categoryWeights: { gone: 0.01 }, descriptionWeights: { 'a photo of the floor': 0.01 } };
      expect(unknownWeights(stale, [screens, children])).toEqual(['gone', 'a photo of the floor']);
      expect(() => matchPhoto('p', row, two, null, stale)).toThrow("Weights for what isn't in the list: gone, a photo of the floor");
      expect(() => matchPhoto('p', row, two, null, { ...NO_WEIGHTING, categoryWeights: { children: NaN } })).toThrow("isn't a number");
    });

    it('sets, clears and resets weights and minimum leads', () => {
      expect(withWeight({ a: 0.01 }, 'b', 0.02)).toEqual({ a: 0.01, b: 0.02 });
      expect(withWeight({ a: 0.01, b: 0.02 }, 'b', undefined)).toEqual({ a: 0.01 });
      // A weight of 0 is no weight.
      expect(withWeight({ a: 0.01 }, 'a', 0)).toEqual({});
      // A minimum lead of 0 is a setting of its own, unlike the shared one.
      expect(withMargin({}, 'signs', 0)).toEqual({ signs: 0 });
      expect(withMargin({ signs: 0.04 }, 'signs', undefined)).toEqual({});
      const tuned = at(0.1, 0.02, { pooling: 0.02, categoryWeights: { children: 0.03 }, descriptionWeights: { 'a baby': 0.01 }, margins: { signs: 0.04 } });
      expect(clearWeights(tuned)).toEqual(at(0.1, 0.02, { pooling: 0.02 }));
      expect(tuningLine('raw', tuned)).toBe("raw scores, minimum score 0.1, minimum lead 0.02, pooling 0.02, 2 weights, 1 category's own minimum lead");
      expect(tuningLine('evened', at(0, 0.2))).toBe('evened out, minimum score 0, minimum lead 0.2, no pooling, 0 weights');
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

  it("a category's own minimum lead replaces the shared one, for its photos only", () => {
    const leads = [0.03, 0.05];
    const matches = leads.flatMap((lead, i) => [
      { mediaKey: `p${i}`, best: 0, description: 0, bestScore: 0.7, secondScore: 0.7 - lead, ownKindScore: 0.7, otherKindScore: 0.7 - lead },
      { mediaKey: `r${i}`, best: 1, description: 0, bestScore: 0.7, secondScore: 0.7 - lead, ownKindScore: 0.7, otherKindScore: 0.7 - lead },
    ]);
    const photos = new Map(matches.map((m) => [m.mediaKey, trashable]));
    const settings = at(0, 0.02, { margins: { parking: 0.04 } });
    const byId = new Map(countCategories(matches, categories, photos, settings, 'next').categories.map((c) => [c.category.id, c]));
    expect(byId.get('parking')!.trashable.map((p) => p.mediaKey)).toEqual(['p1']);
    expect(byId.get('parking')!.justMissed.map((p) => p.mediaKey)).toEqual(['p0']);
    expect(byId.get('receipts')!.trashable.map((p) => p.mediaKey).sort()).toEqual(['r0', 'r1']);
    for (const m of matches) expect(isCounted(m, categories, settings, 'next')).toBe(m.mediaKey !== 'p0');
  });

  describe('priority order', () => {
    const matches = [
      ...['p1', 'p2'].map((k) => match(k, v(1, 0, 0))),
      ...['r1', 'r2', 'r3'].map((k) => match(k, v(0, 1, 0))),
    ];
    const counts = countCategories(matches, categories, new Map(matches.map((m) => [m.mediaKey, trashable])), at(0, 0), 'next');

    it('shows suggestions in the priority order, not by size', () => {
      expect(shippedPriority(categories)).toEqual(['parking', 'receipts']);
      expect(suggestions(counts, 1, ['parking', 'receipts']).map((c) => c.category.id)).toEqual(['parking', 'receipts']);
      expect(suggestions(counts, 1, ['receipts', 'parking']).map((c) => c.category.id)).toEqual(['receipts', 'parking']);
      expect(countSections(counts, 1, ['receipts', 'parking']).suggested.map((c) => c.category.id)).toEqual(['receipts', 'parking']);
      expect(() => suggestions(counts, 1, ['receipts'])).toThrow('parking has no place in the priority order');
    });

    it('moves a category up or down, staying within the list', () => {
      const order = ['a', 'b', 'c'];
      expect(movePriority(order, 'c', -1)).toEqual(['a', 'c', 'b']);
      expect(movePriority(order, 'a', 1)).toEqual(['b', 'a', 'c']);
      expect(movePriority(order, 'a', -1)).toEqual(['a', 'b', 'c']);
      expect(movePriority(order, 'c', 5)).toEqual(['a', 'b', 'c']);
      expect(order).toEqual(['a', 'b', 'c']);
      expect(() => movePriority(order, 'x', 1)).toThrow("x isn't in the priority order");
    });

    it('fits a saved order to the list: gone categories dropped and named, new ones at the end', () => {
      expect(fitPriority(['receipts', 'gone', 'parking'], categories)).toEqual({ priority: ['receipts', 'parking'], dropped: ['gone'] });
      expect(fitPriority(['receipts'], categories)).toEqual({ priority: ['receipts', 'parking'], dropped: [] });
      // Counterweights never have a place.
      expect(fitPriority(['people', 'parking'], categories)).toEqual({ priority: ['parking', 'receipts'], dropped: ['people'] });
    });
  });

  describe("the developer page's saved settings", () => {
    it('starts from the starting settings when nothing is saved', () => {
      expect(readTuning(null, categories)).toEqual({ tuning: { settings: STARTING_SETTINGS, over: 'next', priority: ['parking', 'receipts'] }, notes: [] });
    });

    it('reads back what it saved', () => {
      const tuning = {
        settings: { raw: at(0.1, 0.01, { pooling: 0.03, categoryWeights: { people: 0.02 }, descriptionWeights: { 'a receipt': -0.01 }, margins: { parking: 0.04 } }), evened: STARTING_SETTINGS.evened },
        over: 'otherKind' as const,
        priority: ['receipts', 'parking'],
      };
      expect(readTuning(saveTuning(tuning), categories)).toEqual({ tuning, notes: [] });
    });

    it('drops, and names, settings for what is no longer in the list', () => {
      const saved = saveTuning({
        settings: { raw: at(0, 0.02, { categoryWeights: { gone: 0.01 }, descriptionWeights: { 'a photo of the floor': 0.02, 'a receipt': 0.01 }, margins: { gone: 0.04 } }), evened: STARTING_SETTINGS.evened },
        over: 'next',
        priority: ['gone', 'receipts', 'parking'],
      });
      const { tuning, notes } = readTuning(saved, categories);
      expect(tuning.settings.raw).toEqual(at(0, 0.02, { descriptionWeights: { 'a receipt': 0.01 } }));
      expect(tuning.priority).toEqual(['receipts', 'parking']);
      expect(notes).toEqual([
        'Dropped the raw minimum lead for “gone”, no longer in the list.',
        'Dropped the raw weight for “gone”, no longer in the list.',
        'Dropped the raw weight for “a photo of the floor”, no longer in the list.',
        'Dropped “gone” from the priority order, no longer in the list.',
      ]);
    });

    it('refuses saved settings that are not numbers', () => {
      expect(() => readTuning(JSON.stringify({ settings: { raw: { minScore: 'x' } } }), categories)).toThrow('no number for the minimum score');
      expect(() => readTuning('not json', categories)).toThrow();
    });
  });

  it('Accidental shots no longer describe floors or ceilings, which matched interiors and architecture', () => {
    const accidental = CATEGORIES.find((c) => c.id === 'accidental')!;
    expect(accidental.descriptions).not.toContain('a photo of the floor');
    expect(accidental.descriptions).not.toContain('a photo of a ceiling');
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
