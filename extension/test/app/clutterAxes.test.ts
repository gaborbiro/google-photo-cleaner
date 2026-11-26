import { describe, expect, it } from 'vitest';
import { leadText, type ClutterPhoto } from '../../src/app/search/clutter';
import {
  AXIS_LIST,
  PLAIN_AXIS_SETTINGS,
  STARTING_AXIS_SETTINGS,
  STARTING_AXIS_TUNING,
  apart,
  descriptionOverlap,
  floorProblem,
  readAxisTuning,
  reviewText,
  type Overlap,
  axisBreakdown,
  axisComparison,
  categoryParts,
  axisBuffButton,
  axisBuffsFor,
  axisCaption,
  axisEffects,
  axisGroups,
  axisDescriptionCount,
  axisListSummary,
  axisOutcome,
  axisSections,
  axisStayRaise,
  axisSummary,
  clutterIn,
  countAxes,
  checkOutcome,
  checkOutcomes,
  checksOf,
  DEFAULT_CHECK,
  groupPairs,
  kindOf,
  matchAxes,
  pairRows,
  withAxisBuff,
  type AxisCategory,
  type AxisSettings,
  type PairException,
  type ScoredAxis,
} from '../../src/app/search/clutterAxes';
import { addAxisCategory, draftOf, draftProblems, exceptionChanges, exceptionProblems, listChanges, listOf, draftChecks, draftSections, isShipped, readAxisList, saveAxisList, setAxis, setCheck, setVerdict, verdictChoices, verdictsFor } from '../../src/app/search/clutterEdits';

const v = (...xs: number[]) => Float32Array.from(xs);
/** No overlap between any of [scored]'s descriptions: pooling as if each stood apart. */
const free = (scored: ScoredAxis[]): Overlap => apart(scored.reduce((n, c) => n + c.vectors.length, 0));
const cat = (id: string, axis: 'subject' | 'setting' | 'form', verdict: 'clutter' | 'keep' | 'neutral', descriptions: string[]): AxisCategory => ({ id, label: id[0]!.toUpperCase() + id.slice(1), kind: kindOf(verdict), axis, verdict, descriptions });
// Subjects: products (clutter), people (keep), repairs (clutter), food (neutral, last). Settings: shops (neutral), museums (keep), carparks (clutter).
const products = cat('products', 'subject', 'clutter', ['a product on a shelf']);
const people = cat('people', 'subject', 'keep', ['a selfie']);
const repairs = cat('repairs', 'subject', 'clutter', ['a broken item']);
const shops = cat('shops', 'setting', 'neutral', ['a supermarket aisle']);
const museums = cat('museums', 'setting', 'keep', ['a museum room']);
const carparks = cat('carparks', 'setting', 'clutter', ['a car park']);
const food = cat('food', 'subject', 'neutral', ['a meal on a plate']);
const categories = [products, people, repairs, shops, museums, carparks, food];
// One direction per description, in the order of the categories.
const scored: ScoredAxis[] = categories.map((category, i) => ({ category, vectors: [v(...categories.map((_, j) => (i === j ? 1 : 0)))] }));
const settings: AxisSettings = PLAIN_AXIS_SETTINGS.raw;
const trashable: ClutterPhoto = { eligible: true, approved: false };
const outcome = (row: Float32Array, exceptions: PairException[] = [], s = settings) => axisOutcome(matchAxes('p', row, scored, free(scored), s), categories, exceptions);

describe('clutter by subject and setting', () => {
  it('picks the best subject and the best setting, each against its own axis only', () => {
    // A selfie in a supermarket: the shop scores higher than the selfie, but they don't compete.
    const m = matchAxes('selfie', v(0.6, 0.63, 0.3, 0.7, 0.4, 0.3, 0), scored, free(scored), settings);
    expect(m.subject).toMatchObject({ best: 1, score: expect.closeTo(0.63, 5), lead: expect.closeTo(0.03, 5), counts: true });
    expect(m.setting).toMatchObject({ best: 3, score: expect.closeTo(0.7, 5), lead: expect.closeTo(0.3, 5), counts: true });
    // A close call on one axis: no say.
    expect(matchAxes('p', v(0.6, 0.59, 0.3, 0.7, 0.4, 0.3, 0), scored, free(scored), settings).subject.counts).toBe(false);
    // A category's own minimum lead, and an axis's minimum score.
    expect(matchAxes('p', v(0.6, 0.63, 0.3, 0.7, 0.4, 0.3, 0), scored, free(scored), { ...settings, margins: { people: 0.05 } }).subject.counts).toBe(false);
    expect(matchAxes('p', v(0.6, 0.63, 0.3, 0.7, 0.4, 0.3, 0), scored, free(scored), { ...settings, setting: { minScore: 0.8, margin: 0.02 } }).setting.counts).toBe(false);
  });

  it('decides by the pair: a keeper near the top keeps, clutter must be clearly ahead of all that is not clutter', () => {
    // Selfie in a shop: People keeps.
    expect(outcome(v(0.6, 0.65, 0.3, 0.7, 0.4, 0.3, 0))).toEqual({ verdict: 'keep', category: 1, reason: 'People keeps' });
    // A product on a shelf in a shop: Products is clutter.
    expect(outcome(v(0.7, 0.4, 0.3, 0.7, 0.4, 0.3, 0))).toEqual({ verdict: 'clutter', category: 0, reason: 'Products is clutter' });
    // A broken chair in a museum: the museum keeps it.
    expect(outcome(v(0.3, 0.4, 0.7, 0.4, 0.7, 0.3, 0))).toEqual({ verdict: 'keep', category: 4, reason: 'Museums keeps' });
    // A selfie in a car park: keep wins over clutter.
    expect(outcome(v(0.3, 0.7, 0.4, 0.3, 0.4, 0.7, 0)).verdict).toBe('keep');
    // The party (2026-11-20): Food 0.686 just ahead of People 0.684, in a "car park" that counts. People is
    // within the minimum lead of the top, so it is heard, and keep wins.
    expect(outcome(v(0.3, 0.684, 0.3, 0.3, 0.4, 0.641, 0.686))).toEqual({ verdict: 'keep', category: 1, reason: 'People keeps (close to the top)' });
    // A keeper further behind than the minimum lead isn't heard: Products 0.6, People 0.55.
    expect(outcome(v(0.6, 0.55, 0.3, 0.7, 0.4, 0.3, 0))).toEqual({ verdict: 'clutter', category: 0, reason: 'Products is clutter' });
    // Two kinds of clutter close together don't make each other too close: Products 0.6, Repairs 0.59.
    expect(outcome(v(0.6, 0.3, 0.59, 0.7, 0.4, 0.3, 0))).toEqual({ verdict: 'clutter', category: 0, reason: 'Products is clutter' });
    // Clutter too close to something that isn't clutter (Food 0.6 just behind), in a car park: the setting decides.
    expect(outcome(v(0.59, 0.3, 0.3, 0.3, 0.4, 0.7, 0.6))).toEqual({ verdict: 'clutter', category: 5, reason: 'Carparks is clutter' });
    // The same in a shop (neutral): neither.
    expect(outcome(v(0.59, 0.3, 0.3, 0.7, 0.4, 0.3, 0.6))).toEqual({ verdict: 'none', category: null, reason: 'nothing that counts says clutter' });
  });

  it('lets an exception for the exact pair decide, when both count', () => {
    const exceptions: PairException[] = [{ subject: 'repairs', setting: 'museums', verdict: 'clutter' }, { subject: 'products', setting: 'shops', verdict: 'keep' }];
    expect(outcome(v(0.3, 0.4, 0.7, 0.4, 0.7, 0.3, 0), exceptions)).toEqual({ verdict: 'clutter', category: 2, reason: 'Exception: Repairs in Museums' });
    expect(outcome(v(0.7, 0.4, 0.3, 0.7, 0.4, 0.3, 0), exceptions)).toEqual({ verdict: 'keep', category: 0, reason: 'Exception: Products in Shops' });
    // Not when the setting is too close (Museums 0.7, Shops 0.69): the rule as usual, and Museums, first
    // on its side, is heard and keeps.
    expect(outcome(v(0.3, 0.4, 0.7, 0.69, 0.7, 0.3, 0), exceptions)).toEqual({ verdict: 'keep', category: 4, reason: 'Museums keeps' });
  });

  it('counts each photo once, for the category that decided it, and what just missed', () => {
    const rows: [string, Float32Array, ClutterPhoto | undefined][] = [
      ['product', v(0.7, 0.4, 0.3, 0.7, 0.4, 0.3, 0), trashable],
      ['selfie', v(0.6, 0.65, 0.3, 0.7, 0.4, 0.3, 0), trashable],
      ['chair in a museum', v(0.3, 0.4, 0.7, 0.4, 0.7, 0.3, 0), trashable],
      // Products only just ahead of Food (neutral), in a shop: a close call that would be clutter if it counted.
      ['close', v(0.61, 0.3, 0.3, 0.7, 0.4, 0.3, 0.6), trashable],
      ['protected product', v(0.7, 0.4, 0.3, 0.7, 0.4, 0.3, 0), { eligible: false, approved: false }],
    ];
    const matches = rows.map(([k, r]) => matchAxes(k, r, scored, free(scored), settings));
    const photos = new Map(rows.filter(([, , p]) => p).map(([k, , p]) => [k, p!]));
    const counts = countAxes(matches, categories, [], photos, settings);
    const productsCount = counts.clutter.find((c) => c.category.id === 'products')!;
    expect(productsCount.trashable.map((p) => p.mediaKey)).toEqual(['product']);
    expect(productsCount.protectedOrUnknown).toBe(1);
    expect(productsCount.closeCalls).toBe(1);
    expect(productsCount.justMissed.map((p) => p.mediaKey)).toEqual(['close']);
    expect(counts.keepers.find((c) => c.category.id === 'people')!.trashable.map((p) => p.mediaKey)).toEqual(['selfie']);
    expect(counts.keepers.find((c) => c.category.id === 'museums')!.trashable.map((p) => p.mediaKey)).toEqual(['chair in a museum']);
    expect(counts.totals).toBe('Clutter 2 (40%) · kept 2 (40%) · neither 1 (20%)');
    // Pairs of the subject and setting that count, most photos first.
    expect(pairRows(matches, categories, []).map((r) => [r.subject, r.setting, r.verdict, r.count])).toEqual([
      ['Products', 'Shops', 'clutter', 2],
      ['People', 'Shops', 'keep', 1],
      ['Repairs', 'Museums', 'keep', 1],
      ['subject too close', 'Shops', 'none', 1],
    ]);
  });

  it('groups the pairs by subject or by setting, the groups with most photos first', () => {
    const row = (subject: string, setting: string, count: number) => ({ subject, setting, verdict: 'none' as const, count, mediaKeys: [] });
    const rows = [row('Products', 'Shops', 30), row('People', 'Shops', 12), row('Products', 'Home', 8), row('People', 'Nature', 20)];
    expect(groupPairs(rows, 'subject').map((g) => [g.name, g.count, g.rows.map((r) => r.setting)])).toEqual([
      ['Products', 38, ['Shops', 'Home']],
      ['People', 32, ['Nature', 'Shops']],
    ]);
    expect(groupPairs(rows, 'setting').map((g) => [g.name, g.count, g.rows.map((r) => r.subject)])).toEqual([
      ['Shops', 42, ['Products', 'People']],
      ['Nature', 20, ['People']],
      ['Home', 8, ['Products']],
    ]);
    expect(groupPairs([], 'subject')).toEqual([]);
  });

  it('breaks a photo down by subject and setting, with its outcome', () => {
    const breakdown = axisBreakdown(v(0.6, 0.65, 0.3, 0.7, 0.4, 0.3, 0), scored, free(scored), { ...settings, descriptionWeights: { 'a selfie': 0.01 } }, [], 2);
    expect(breakdown.outcome).toBe('Kept: People keeps');
    // The lead is against the best of another verdict: People (keep) against Products, Shops (neutral) against Museums.
    expect(breakdown.sides.map((s) => s.title)).toEqual(['Subject: People, 0.0600 ahead of Products (needs 0.02) · counts', 'Setting: Shops, 0.3000 ahead of Museums (needs 0.02) · counts']);
    expect(axisBreakdown(v(0.6, 0.61, 0.3, 0.7, 0.4, 0.3, 0), scored, free(scored), settings, [], 2).sides[0]!.title).toBe('Subject: People, 0.0100 ahead of Products (needs 0.02) · too close, no say');
    // A keeper heard close behind the top is named.
    const party = axisBreakdown(v(0.3, 0.684, 0.3, 0.3, 0.4, 0.641, 0.686), scored, free(scored), settings, [], 2);
    expect(party.outcome).toBe('Kept: People keeps (close to the top)');
    expect(party.sides[0]!.title).toBe('Subject: Food, 0.0020 ahead of People (needs 0.02) · too close, no say · People close behind, keeps');
    expect(breakdown.sides[0]!.rows.map((r) => [r.label, r.kind, r.score, r.weight])).toEqual([['People', 'counterweight', '0.660', '+0.010'], ['Products', 'clutter', '0.600', null]]);
    expect(breakdown.sides[1]!.rows[0]).toMatchObject({ label: 'Shops', kind: 'neutral' });
  });

  it('buffs a keep category, subject or setting, just enough for the photo to be kept', () => {
    // A selfie in a shop that Products wins narrowly: People 0.6, Products 0.63.
    const row = v(0.63, 0.6, 0.3, 0.7, 0.4, 0.3, 0);
    expect(outcome(row).verdict).toBe('clutter');
    const buffs = axisBuffsFor(row, scored, free(scored), settings, [], 'content', 0.2);
    expect(buffs.map((b) => [b.label, b.axis, b.description])).toEqual([['People', 'subject', 'a selfie'], ['Museums', 'setting', 'a museum room']]);
    const people0 = buffs[0]!;
    // People must come within the minimum lead of the top (0.63 − 0.02): from 0.6 to 0.61 is enough, and
    // then it is heard and keeps the photo.
    expect(people0.by).toBeCloseTo(0.01, 3);
    expect(outcome(row, [], withAxisBuff(settings, 'a selfie', people0.by!)).verdict).toBe('keep');
    expect(outcome(row, [], withAxisBuff(settings, 'a selfie', people0.by! - 0.0002)).verdict).toBe('clutter');
    // More, and People wins: kept.
    expect(outcome(row, [], withAxisBuff(settings, 'a selfie', 0.06)).verdict).toBe('keep');
    expect(axisBuffButton(people0)).toBe(`Buff People (subject) “a selfie” +${people0.by!.toFixed(4)}`);
    // A label that already names its side isn't named twice; too far behind, the button says the largest buff of the scoring.
    expect(axisBuffButton({ ...people0, label: 'Celebrations (subject)' })).toBe(`Buff Celebrations (subject) “a selfie” +${people0.by!.toFixed(4)}`);
    expect(axisBuffButton({ ...people0, by: null, max: 3 })).toBe('People (subject) “a selfie”: more than +3 needed');
    expect(() => axisBuffsFor(v(0.6, 0.65, 0.3, 0.7, 0.4, 0.3, 0), scored, free(scored), settings, [], 'content', 0.2)).toThrow('Only a photo that is clutter');
  });

  it('offers buffs as large as the scoring needs: evened-out leads of 0.7 are out of reach of the raw cap', () => {
    // Products 2.1 against People 1.4: People needs about 0.7 to come within the minimum lead.
    const row = v(2.1, 1.4, 0.3, 0.7, 0.4, 0.3, 0);
    expect(axisBuffsFor(row, scored, free(scored), settings, [], 'content', 0.2).map((b) => b.by)).toEqual([null, null]);
    const evened = axisBuffsFor(row, scored, free(scored), settings, [], 'content', 3);
    // People needs 2.1 − 0.02 − 1.4; Museums, 0.3 behind Shops on its side, less.
    expect(evened.map((b) => [b.label, b.by])).toEqual([['Museums', expect.closeTo(0.28, 3)], ['People', expect.closeTo(0.68, 3)]]);
  });

  it('writes a category’s photos as text to review away from the page, numbered as on the contact sheet', () => {
    const breakdown = axisBreakdown(v(0.6, 0.65, 0.3, 0.7, 0.4, 0.3, 0), scored, free(scored), settings, [], 2);
    expect(reviewText('Products · 1', 'raw scores', [{ number: 3, sample: 'Riskiest', caption: '0.650 · lead 0.0500 · “a selfie”', breakdown }]).split('\n')).toEqual([
      'Products · 1',
      'raw scores',
      '',
      '#3 (Riskiest) 0.650 · lead 0.0500 · “a selfie”',
      '  Kept: People keeps',
      '  Subject: People, 0.0500 ahead of Products (needs 0.02) · counts',
      '    0.650 People · a selfie [keep]',
      '    0.600 Products · a product on a shelf [clutter]',
      '  Setting: Shops, 0.3000 ahead of Museums (needs 0.02) · counts',
      '    0.700 Shops · a supermarket aisle [neutral]',
      '    0.400 Museums · a museum room [keep]',
      '',
    ]);
  });

  it('lists every description of every side for a photo opened large, best first', () => {
    // Products (2 descriptions) and People (2) as subjects, Shops as the setting; one direction per description.
    const twoProducts = { ...products, descriptions: ['a product on a shelf', 'a price tag'] };
    const twoPeople = { ...people, descriptions: ['a selfie', 'a family photo'] };
    const s5: ScoredAxis[] = [
      { category: twoProducts, vectors: [v(1, 0, 0, 0, 0), v(0, 1, 0, 0, 0)] },
      { category: twoPeople, vectors: [v(0, 0, 1, 0, 0), v(0, 0, 0, 1, 0)] },
      { category: shops, vectors: [v(0, 0, 0, 0, 1)] },
    ];
    const row = v(0.5, 0.6, 0.4, 0.3, 0.2);
    expect(axisBreakdown(row, s5, apart(5), settings, [], 'large').sides[0]!.rows.map((r) => [r.label, r.description, r.score])).toEqual([
      ['Products', 'a price tag', '0.600'],
      ['Products', 'a product on a shelf', '0.500'],
      ['People', 'a selfie', '0.400'],
      ['People', 'a family photo', '0.300'],
    ]);
    // Per category, as in a hover card: each as its best description.
    expect(axisBreakdown(row, s5, apart(5), settings, [], 7).sides[0]!.rows.map((r) => r.description)).toEqual(['a price tag', 'a selfie']);
  });

  it('keeps a photo opened large to the best tenth of each side, at least 10, and says how many more', () => {
    // 150 subject descriptions: the best 15 (a tenth), 135 more; a side of 4 lists all 4.
    const many = { ...products, descriptions: Array.from({ length: 150 }, (_, i) => `thing ${i}`) };
    const scoredMany: ScoredAxis[] = [{ category: many, vectors: many.descriptions.map(() => v(1, 0)) }, { category: shops, vectors: [v(0, 1)] }];
    const scores = v(...many.descriptions.map((_, i) => 0.9 - i * 0.001), 0.5);
    const side = axisBreakdown(scores, scoredMany, apart(151), settings, [], 'large').sides[0]!;
    expect([side.rows.length, side.rows[0]!.description, side.rows.at(-1)!.description, side.more]).toEqual([15, 'thing 0', 'thing 14', 135]);
    expect(axisBreakdown(scores, scoredMany, apart(151), settings, [], 'large').sides[1]!.more).toBe(0);
  });

  it('works out the smallest raise that makes a photo clutter in its category again (Stay)', () => {
    // Products 0.63, People 0.62: a close call; raising "a product on a shelf" makes Products count.
    const row = v(0.63, 0.62, 0.3, 0.7, 0.4, 0.3, 0);
    expect(clutterIn(row, scored, free(scored), settings, [], 0)).toBe(false);
    const raise = axisStayRaise(row, scored, free(scored), settings, [], 0, 'a product on a shelf', 0.2)!;
    expect(raise).toBeCloseTo(0.01, 3);
    expect(clutterIn(row, scored, free(scored), withAxisBuff(settings, 'a product on a shelf', raise), [], 0)).toBe(true);
    // In a museum, the setting keeps it however strong the subject: no raise does it.
    expect(axisStayRaise(v(0.7, 0.3, 0.3, 0.3, 0.7, 0.3, 0), scored, free(scored), settings, [], 0, 'a product on a shelf', 0.2)).toBeNull();
    expect(() => axisStayRaise(row, scored, free(scored), settings, [], 0, 'a selfie', 0.2)).toThrow("isn't a description of the category");
  });

  it('shows what a change does: photos that leave, join and move, with captions and a summary', () => {
    const rows: [string, Float32Array][] = [
      // Products, in a shop: a buff of "a selfie" makes People win; leaves.
      ['selfie-ish', v(0.63, 0.6, 0.3, 0.7, 0.4, 0.3, 0)],
      // Products (just ahead of Repairs, also clutter), in a car park: clutter (Products); a selfie buff changes nothing.
      ['car park', v(0.5, 0.2, 0.49, 0.3, 0.4, 0.7, 0)],
    ];
    const photos = new Map(rows.map(([k]) => [k, trashable]));
    const before = rows.map(([k, r]) => matchAxes(k, r, scored, free(scored), settings));
    const buffed = withAxisBuff(settings, 'a selfie', 0.06);
    const after = rows.map(([k, r]) => matchAxes(k, r, scored, free(scored), buffed));
    const lists = { before: categories, after: categories, exceptions: { before: [], after: [] } };
    const effects = axisEffects(before, after, lists, photos);
    expect(effects.leaves.map((c) => [c.mediaKey, c.fromDescription])).toEqual([['selfie-ish', 'a product on a shelf']]);
    expect(effects.joins).toEqual([]);
    expect(axisCaption(effects.leaves[0]!, lists).map((p) => p.text).join('')).toBe('Products → kept (People)');
    expect(axisGroups(effects.leaves, categories, (c) => c.before.category!).map((g) => [g.key, g.title])).toEqual([['products', 'Products · 1']]);
    expect(axisSummary('+0.0600 to “a selfie”', effects, lists)).toEqual({ what: '+0.0600 to “a selfie”', leave: '1 photo leaves the suggestions', leaveFrom: 'Products 1', join: null, joinTo: null, move: null });
    // Undone, it joins; with Products made a setting-less clutter elsewhere, a move.
    const undone = axisEffects(after, before, lists, photos);
    expect(undone.joins.map((c) => c.mediaKey)).toEqual(['selfie-ish']);
    expect(axisCaption(undone.joins[0]!, lists).map((p) => p.text).join('')).toBe('kept (People) → Products');
    expect(axisSummary('−0.0600 to “a selfie”', undone, lists)).toEqual({ what: '−0.0600 to “a selfie”', leave: '0 photos leave the suggestions', leaveFrom: null, join: '1 photo joins the suggestions', joinTo: 'Products 1', move: null });
    const moved = axisEffects(before, rows.map(([k, r]) => matchAxes(k, r, scored, free(scored), withAxisBuff(settings, 'a broken item', 0.4))), lists, photos);
    // Both from Products to Repairs, the higher score first.
    expect(moved.moves.map((c) => [c.mediaKey, categories[c.before.category!]!.id, categories[c.after.category!]!.id])).toEqual([['car park', 'products', 'repairs'], ['selfie-ish', 'products', 'repairs']]);
  });

  it('ships a list of subjects and settings that can be saved', () => {
    const draft = draftOf(AXIS_LIST.categories);
    expect(draftProblems(draft)).toEqual([]);
    expect(exceptionProblems(draft, AXIS_LIST.exceptions)).toEqual([]);
    const descriptions = AXIS_LIST.categories.flatMap((c) => c.descriptions);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(AXIS_LIST.categories.every((c) => c.kind === kindOf(c.verdict))).toBe(true);
    // 2026-11-23: Everyday objects folded into Things to buy; Close-up, no clear place added; paper clutter in keep settings.
    // 2026-11-26: Accidental shots a form in a Quality check against Intended photos; Architecture and interiors added.
    expect(axisListSummary(AXIS_LIST)).toBe('35 subjects, 14 settings, 4 forms in 2 checks and 1 baseline, 40 exceptions');
    // Each exception names a clutter subject and a keep setting of the list.
    const byId = new Map(AXIS_LIST.categories.map((c) => [c.id, c]));
    expect(AXIS_LIST.exceptions.every((e) => byId.get(e.subject)?.axis === 'subject' && byId.get(e.setting)?.axis === 'setting' && byId.get(e.setting)?.verdict === 'keep')).toBe(true);
    expect(axisDescriptionCount(AXIS_LIST)).toBe(descriptions.length);
    // A phrase in two categories (as an edit can leave it) counts once.
    const twice = { categories: [{ ...AXIS_LIST.categories[0]!, descriptions: ['a', 'b'] }, { ...AXIS_LIST.categories[1]!, descriptions: ['b', 'c'] }], exceptions: [] };
    expect(axisDescriptionCount(twice)).toBe(3);
    // The forms in one section per check: Screenshots, then Quality.
    expect(axisSections(AXIS_LIST.categories).map((s) => [s.axis, s.categories.length])).toEqual([['subject', 35], ['setting', 14], ['form', 2], ['form', 2], ['baseline', 1]]);
    const named = (id: string) => AXIS_LIST.categories.find((c) => c.id === id)!;
    // Screenshots are a form, against Not a screenshot: as a setting they won wherever no place fitted.
    // Photos of screens stay a subject.
    expect([named('screenshots').axis, named('screenshots').verdict, named('photos').label, named('screens').axis]).toEqual(['form', 'clutter', 'Not a screenshot', 'subject']);
    // Magnets taken out (2026-11-21): beds went to Labels on a bedding care label, front doors to Parcels.
    expect(descriptions).not.toContain('a care label on bedding');
    expect(descriptions).not.toContain('a parcel on a doorstep');
    // Keep wins, so places where clutter is usually photographed are neutral, never keep: an airport
    // would keep boarding passes, a café menus, a car warning lights, an office whiteboards.
    expect(['transport', 'eating', 'work', 'shops', 'home', 'streets'].map((id) => named(id).verdict)).toEqual(['neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral']);
    const verdictOf = (d: string) => AXIS_LIST.categories.find((c) => c.descriptions.includes(d))!.verdict;
    expect(['an airport terminal', 'a cafe', 'inside a car', 'an office with desks'].map(verdictOf)).toEqual(['neutral', 'neutral', 'neutral', 'neutral']);
    // Greeting images with flowers are memes: no keep description names flowers.
    expect(AXIS_LIST.categories.filter((c) => c.verdict === 'keep').flatMap((c) => c.descriptions).filter((d) => /flower/i.test(d))).toEqual([]);
    // Old stone walls are kept as historic places, not taken as walls to fix; the vague "tools" is gone.
    expect(verdictOf('an ancient building, ruin or stone wall')).toBe('keep');
    expect(descriptions).not.toContain('tools');
    // The selfie and the supermarket aisle are on different axes.
    const axisOf = (d: string) => AXIS_LIST.categories.find((c) => c.descriptions.includes(d))!.axis;
    expect(axisOf('a selfie')).toBe('subject');
    expect(axisOf('a supermarket aisle')).toBe('setting');
  });
});

describe('form: screenshots, decided on their own', () => {
  // People (keep), Products (clutter) | Shops (neutral) | Screenshots (clutter form), Not a screenshot (neutral form).
  const fPeople = cat('people', 'subject', 'keep', ['a selfie']);
  const fProducts = cat('products', 'subject', 'clutter', ['a product on a shelf']);
  const fShops = cat('shops', 'setting', 'neutral', ['a supermarket aisle']);
  const shots = { ...cat('screenshots', 'form', 'clutter', ['a screenshot of a chat']), check: 'Screenshots' };
  const notShots = { ...cat('photos', 'form', 'neutral', ['a person holding a phone']), label: 'Not a screenshot', check: 'Screenshots' };
  const list = [fPeople, fProducts, fShops, shots, notShots];
  const formScored: ScoredAxis[] = list.map((category, i) => ({ category, vectors: [v(...list.map((_, j) => (i === j ? 1 : 0)))] }));
  const match = (row: Float32Array, s = settings) => matchAxes('p', row, formScored, free(formScored), s);

  it('says screenshot only when Screenshots is clearly ahead of Not a screenshot, whatever the subject and setting come to', () => {
    // A real screenshot of a chat: 0.7 against 0.58. A screenshot, and its content (a product, in a shop) is clutter too.
    const chat = match(v(0.3, 0.7, 0.6, 0.7, 0.58));
    expect(checkOutcome(chat, list, 'Screenshots')).toEqual({ verdict: 'clutter', category: 3, reason: 'Screenshots is clutter' });
    expect(axisOutcome(chat, list, []).verdict).toBe('clutter');
    // A friend holding a phone: Screenshots 0.647, Not a screenshot 0.68: not a screenshot, named as such.
    const friend = match(v(0.7, 0.3, 0.6, 0.647, 0.68));
    expect(checkOutcome(friend, list, 'Screenshots')).toEqual({ verdict: 'none', category: 4, reason: 'Not a screenshot' });
    // Keepers don't stop it: a screenshot of a selfie is kept by People, and still a screenshot.
    const selfieShot = match(v(0.7, 0.3, 0.6, 0.7, 0.58));
    expect(axisOutcome(selfieShot, list, []).verdict).toBe('keep');
    expect(checkOutcome(selfieShot, list, 'Screenshots').verdict).toBe('clutter');
    // Its outcome says what happens to it: offered, by its check, not "Kept".
    const breakdownOf = (row: Float32Array, s = settings) => axisBreakdown(row, formScored, free(formScored), s, [], 2).outcome;
    expect(breakdownOf(v(0.7, 0.3, 0.6, 0.7, 0.58))).toBe('Offered by its check: Screenshots · subject and setting: People keeps');
    expect(breakdownOf(v(0.3, 0.7, 0.6, 0.7, 0.58))).toBe('Offered by its check: Screenshots · subject and setting: Products is clutter');
    // Neither: no subject reaches the minimum score, so no keeper is heard and no clutter counts.
    expect(breakdownOf(v(0.3, 0.45, 0.6, 0.7, 0.58), { ...settings, subject: { minScore: 0.5, margin: 0.02 } })).toBe('Offered by its check: Screenshots · subject and setting: nothing that counts says clutter');
    expect(breakdownOf(v(0.7, 0.3, 0.6, 0.647, 0.68))).toBe('Kept: People keeps · Screenshots check: Not a screenshot');
    // Too close: neither, named with its best.
    expect(checkOutcome(match(v(0.3, 0.7, 0.6, 0.6, 0.59)), list, 'Screenshots')).toEqual({ verdict: 'none', category: 3, reason: 'Screenshots, too close' });
    // With no form in the list, there are no checks; a check not in the list comes to nothing.
    expect(matchAxes('p', v(0.3, 0.7, 0.6), formScored.slice(0, 3), free(formScored.slice(0, 3)), settings).checks).toEqual([]);
    expect(checkOutcome(chat, list, 'Poor quality')).toEqual({ verdict: 'none', category: null, reason: 'no Poor quality check in the list' });
  });

  it('splits a line into category names, in their verdict’s kind, and descriptions, the same way everywhere', () => {
    const parts = (text: string) => categoryParts(text, list).map((p) => [p.text, p.kind, p.term]);
    expect(parts('Products is clutter')).toEqual([['Products', 'clutter', false], [' is clutter', null, false]]);
    // A check's name isn't its category's; a description is set apart; a keeper green, a neutral grey.
    expect(parts('Screenshots check: Not a screenshot · “a screenshot of a chat” · People keeps · Shops')).toEqual([
      ['Screenshots check: ', null, false],
      ['Not a screenshot', 'neutral', false],
      [' · “', null, false],
      ['a screenshot of a chat', null, true],
      ['” · ', null, false],
      ['People', 'counterweight', false],
      [' keeps · ', null, false],
      ['Shops', 'neutral', false],
    ]);
    // Whole words only: no name inside another word.
    expect(parts('Peoples')).toEqual([['Peoples', null, false]]);
  });

  it('compares a photo under two settings or lists, saying once what didn’t change', () => {
    const row = v(0.7, 0.3, 0.6, 0.7, 0.69);
    const input = (s = settings, sc = formScored) => ({ row, scored: sc, overlap: free(sc), settings: s, exceptions: [] });
    const buffed = { ...settings, descriptionWeights: { 'a screenshot of a chat': 0.02 } };
    const c = axisComparison(input(), input(buffed), ['Now', 'With the buff'], 3);
    expect(c.summary).toEqual({ before: ['People keeps', 'Screenshots check: Screenshots, too close'], after: ['People keeps', 'Screenshots check: Screenshots is clutter'] });
    expect(c.changed).toEqual([
      {
        title: 'Screenshots check: Screenshots too close → counts',
        before: 'Screenshots, 0.0100 ahead of Not a screenshot (needs 0.02) · too close, no say',
        after: 'Screenshots, 0.0300 ahead of Not a screenshot (needs 0.02) · counts',
        // The side's whole scoring, before and after: not only what moved (2026-11-25).
        beforeRows: [expect.objectContaining({ label: 'Screenshots', score: '0.700', weight: null }), expect.objectContaining({ label: 'Not a screenshot', score: '0.690' })],
        rows: [expect.objectContaining({ label: 'Screenshots', score: '0.720', weight: '+0.020' }), expect.objectContaining({ label: 'Not a screenshot', score: '0.690' })],
      },
    ]);
    expect(c.unchangedLine).toBe('Unchanged: subject People (counts, keeps) · setting Shops (counts)');
    expect(c.unchanged.map((x) => x.name)).toEqual(['Subject', 'Setting']);
    // Nothing changed: one breakdown, no fold.
    const same = axisComparison(input(), input(), ['Now', 'With the buff'], 3);
    expect(same.summary).toEqual({ before: ['People keeps', 'Screenshots check: Screenshots, too close'], after: null });
    expect([same.changed, same.unchangedLine, same.unchanged.length]).toEqual([[], null, 3]);
    // A description replaced: the side changed though its outcome didn't, and both its scorings are shown.
    const reworded = formScored.map((x) => (x.category.id === 'photos' ? { ...x, category: { ...x.category, descriptions: ['a photo of a room'] } } : x));
    const r = axisComparison(input(), input(settings, reworded), ['Now', 'With the edits'], 3);
    expect(r.changed.map((x) => [x.title, x.beforeRows.map((y) => y.description), x.rows.map((y) => y.description)])).toEqual([
      ['Screenshots check: Screenshots too close, unchanged', ['a screenshot of a chat', 'a person holding a phone'], ['a screenshot of a chat', 'a photo of a room']],
    ]);
  });

  it('counts screenshots as a suggestion of their own, a photo also in one by subject and setting', () => {
    const rows: [string, Float32Array][] = [
      ['chat', v(0.3, 0.7, 0.6, 0.7, 0.58)],
      ['selfie shot', v(0.7, 0.3, 0.6, 0.7, 0.58)],
      ['friend', v(0.7, 0.3, 0.6, 0.647, 0.68)],
    ];
    const counts = countAxes(rows.map(([k, r]) => matchAxes(k, r, formScored, free(formScored), settings)), list, [], new Map(rows.map(([k]) => [k, trashable])), settings);
    expect(counts.forms.map((c) => [c.category.id, c.trashable.map((p) => p.mediaKey)])).toEqual([['screenshots', ['chat', 'selfie shot']]]);
    expect(counts.clutter.find((c) => c.category.id === 'products')!.trashable.map((p) => p.mediaKey)).toEqual(['chat']);
    expect(counts.clutter.map((c) => c.category.id)).not.toContain('screenshots');
    expect(counts.totals).toBe('Clutter 1 (33%) · kept 2 (67%) · neither 0 (0%) · and clutter in a check 2 (67%)');
  });

  it('buffs Not a screenshot to leave a photo out of Screenshots, and Stay brings it back; effects say which side', () => {
    const row = v(0.3, 0.7, 0.6, 0.65, 0.62);
    const buffs = axisBuffsFor(row, formScored, free(formScored), settings, [], { check: 'Screenshots' }, 0.2);
    expect(buffs.map((b) => [b.label, b.axis, b.description])).toEqual([['Not a screenshot', 'form', 'a person holding a phone']]);
    expect(buffs[0]!.by).toBeCloseTo(0.0101, 3);
    const after = withAxisBuff(settings, 'a person holding a phone', buffs[0]!.by!);
    expect(clutterIn(row, formScored, free(formScored), after, [], 3)).toBe(false);
    const lists = { before: list, after: list, exceptions: { before: [], after: [] } };
    const effects = axisEffects([match(row)], [match(row, after)], lists, new Map([['p', trashable]]));
    expect(effects.leaves.map((c) => [c.side, c.fromDescription])).toEqual([[{ check: 'Screenshots' }, 'a screenshot of a chat']]);
    // Products still offers it: the caption names every category that does, the check's own outcome in brackets (2026-11-25).
    expect(axisCaption(effects.leaves[0]!, lists).map((part) => part.text).join('')).toBe('Products, Screenshots → Products (Screenshots, too close)');
    // The buff left it just under the minimum lead: Stay needs only the smallest step to bring it back.
    expect(axisStayRaise(row, formScored, free(formScored), after, [], 3, 'a screenshot of a chat', 0.2)).toBe(0.0001);
    // Products, the content, is clutter all along: no change on that side.
    expect(effects.leaves.filter((c) => c.side === 'content')).toEqual([]);
  });
});

describe('checks: each a competition of its own', () => {
  // People (keep) | Shops (neutral) | Screenshots check: Screenshots (clutter), Not a screenshot (neutral) |
  // Poor quality check: Accidental shots (clutter), Night lights (neutral).
  const people = cat('people', 'subject', 'keep', ['a selfie']);
  const shops = cat('shops', 'setting', 'neutral', ['a supermarket aisle']);
  const shots = { ...cat('screenshots', 'form', 'clutter', ['a phone screenshot']), check: 'Screenshots' };
  const notShots = { ...cat('photos', 'form', 'neutral', ['a photo of a room']), label: 'Not a screenshot', check: 'Screenshots' };
  const accidental = { ...cat('accidental', 'form', 'clutter', ['a blurry photo']), label: 'Accidental shots', check: 'Poor quality' };
  const night = { ...cat('night', 'form', 'neutral', ['city lights at night']), label: 'Night lights', check: 'Poor quality' };
  const list = [people, shops, shots, notShots, accidental, night];
  const scored: ScoredAxis[] = list.map((category, i) => ({ category, vectors: [v(...list.map((_, j) => (i === j ? 1 : 0)))] }));
  const match = (row: Float32Array) => matchAxes('p', row, scored, free(scored), settings);

  it('decides each check apart: a photo can be in two, and a counterweight holds back its own check only', () => {
    expect(checksOf(list)).toEqual(['Screenshots', 'Poor quality']);
    // A blurry screenshot: both checks offer it.
    const both = match(v(0.3, 0.3, 0.7, 0.6, 0.7, 0.6));
    expect(checkOutcomes(both, list).map((o) => o.reason)).toEqual(['Screenshots is clutter', 'Accidental shots is clutter']);
    expect(axisBreakdown(v(0.7, 0.3, 0.7, 0.6, 0.7, 0.6), scored, free(scored), settings, [], 2).outcome).toBe('Offered by its checks: Screenshots, Accidental shots · subject and setting: People keeps');
    // Not a screenshot high: it holds back Screenshots, not Accidental shots; before checks, the higher of the two forms took the photo.
    const room = match(v(0.3, 0.3, 0.6, 0.75, 0.7, 0.6));
    expect(checkOutcomes(room, list).map((o) => o.reason)).toEqual(['Not a screenshot', 'Accidental shots is clutter']);
    // Night lights high: it holds back Accidental shots only.
    expect(checkOutcomes(match(v(0.3, 0.3, 0.7, 0.6, 0.6, 0.65)), list).map((o) => o.reason)).toEqual(['Screenshots is clutter', 'Night lights']);
    // Counted in each, offered once in the totals.
    const counts = countAxes([both], list, [], new Map([['p', trashable]]), settings);
    expect(counts.forms.map((c) => [c.category.id, c.trashable.length])).toEqual([['screenshots', 1], ['accidental', 1]]);
    expect(counts.totals).toBe('Clutter 0 (0%) · kept 1 (100%) · neither 0 (0%) · and clutter in a check 1 (100%)');
    // Its outcome lines: the checks' results apart by dots, since a result has commas of its own ("…, too close").
    expect(axisBreakdown(v(0.3, 0.3, 0.7, 0.6, 0.7, 0.6), scored, free(scored), settings, [], 2).lines).toEqual(['People keeps', 'Screenshots check: Screenshots is clutter · Poor quality check: Accidental shots is clutter']);
    // The breakdown has a side per check.
    expect(axisBreakdown(v(0.3, 0.3, 0.7, 0.6, 0.7, 0.6), scored, free(scored), settings, [], 2).sides.map((s) => s.name)).toEqual(['Subject', 'Setting', 'Screenshots check', 'Poor quality check']);
  });

  it('buffs only its own check\u2019s counterweights, and a change tells each check apart', () => {
    const row = v(0.3, 0.3, 0.7, 0.6, 0.7, 0.6);
    expect(axisBuffsFor(row, scored, free(scored), settings, [], { check: 'Poor quality' }, 0.2).map((b) => b.label)).toEqual(['Night lights']);
    expect(axisBuffsFor(row, scored, free(scored), settings, [], { check: 'Screenshots' }, 0.2).map((b) => b.label)).toEqual(['Not a screenshot']);
    // Accidental shots moved out of Poor quality into Screenshots: there it competes with Screenshots, which is higher.
    const moved = list.map((c) => (c.id === 'accidental' ? { ...c, check: 'Screenshots' } : c));
    const movedScored: ScoredAxis[] = moved.map((category, i) => ({ category, vectors: scored[i]!.vectors }));
    const after = matchAxes('p', v(0.3, 0.3, 0.72, 0.6, 0.7, 0.6), movedScored, free(movedScored), settings);
    const before = matchAxes('p', v(0.3, 0.3, 0.72, 0.6, 0.7, 0.6), scored, free(scored), settings);
    const effects = axisEffects([before], [after], { before: list, after: moved, exceptions: { before: [], after: [] } }, new Map([['p', trashable]]));
    expect(effects.leaves.map((c) => c.side)).toEqual([{ check: 'Poor quality' }]);
    expect(effects.joins).toEqual([]);
  });

  it('follows a form into a check of another name: still offered is no change, and the comparison pairs the checks', () => {
    // Before checks had names: all four forms in one, "Form", where the higher of Screenshots and Accidental shots took the photo.
    const one = list.map((c) => (c.axis === 'form' ? { ...c, check: 'Form' } : c));
    const oneScored: ScoredAxis[] = one.map((category, i) => ({ category, vectors: scored[i]!.vectors }));
    const row = v(0.3, 0.3, 0.75, 0.6, 0.7, 0.6);
    const [before, after] = [matchAxes('p', row, oneScored, free(oneScored), settings), match(row)];
    const effects = axisEffects([before], [after], { before: one, after: list, exceptions: { before: [], after: [] } }, new Map([['p', trashable]]));
    // Screenshots offers it in both: no change. Accidental shots, apart now, offers it too: it joins.
    expect(effects.leaves).toEqual([]);
    expect(effects.moves).toEqual([]);
    expect(effects.joins.map((c) => [c.side, c.before.verdict, c.after.reason])).toEqual([[{ check: 'Poor quality' }, 'none', 'Accidental shots is clutter']]);
    // Screenshots offered it all along: its caption says so, not "not suggested".
    const lists = { before: one, after: list, exceptions: { before: [], after: [] } };
    expect(axisCaption(effects.joins[0]!, lists).map((p) => p.text).join('')).toBe('Screenshots → Screenshots, Accidental shots');
    // The comparison: the Form check pairs with both checks it was split into, named before and after.
    const input = (sc: ScoredAxis[], r = row) => ({ row: r, scored: sc, overlap: free(sc), settings, exceptions: [] });
    const c = axisComparison(input(oneScored), input(scored), ['Now', 'With the edits'], 3);
    expect(c.changed.map((x) => x.title)).toEqual([
      'Screenshots check: Screenshots counts, unchanged',
      'Poor quality check: Accidental shots counts; was Screenshots counts',
    ]);
    // Its line before is another check's, so it says which.
    expect(c.changed.map((x) => x.before.split(':')[0])).toEqual(['in the Form check', 'in the Form check']);
    // Each shows its check's whole scoring with the edits, and the Form check's before.
    expect(c.changed.map((x) => x.rows.map((r) => r.label))).toEqual([['Screenshots', 'Not a screenshot'], ['Accidental shots', 'Night lights']]);
    expect(c.changed[0]!.beforeRows.map((r) => r.label)).toEqual(['Screenshots', 'Accidental shots', 'Not a screenshot']);
    // A check gone altogether is named, not left out.
    const noChecks = list.filter((x) => x.axis !== 'form');
    const noScored: ScoredAxis[] = noChecks.map((category, i) => ({ category, vectors: [v(...noChecks.map((_, j) => (i === j ? 1 : 0)))] }));
    const g = axisComparison(input(oneScored), input(noScored, v(0.3, 0.3)), ['Now', 'With the edits'], 3);
    expect(g.changed.map((x) => [x.title, x.after])).toEqual([['Form check: Screenshots counts; gone with the edits', 'none']]);
  });
});

describe('pooling, where descriptions that overlap share a vote', () => {
  // Subjects: Tools (clutter); Views (keep: a city view, a landscape); Sights (keep: a famous landmark). Setting: Streets (neutral).
  const tools = cat('tools', 'subject', 'clutter', ['tools']);
  const views = cat('views', 'subject', 'keep', ['a city view', 'a landscape']);
  const sights = cat('sights', 'subject', 'keep', ['a famous landmark']);
  const streets = cat('streets', 'setting', 'neutral', ['a street']);
  const list = [tools, views, sights, streets];
  const width = 5;
  const poolScored: ScoredAxis[] = [
    { category: tools, vectors: [v(1, 0, 0, 0, 0)] },
    { category: views, vectors: [v(0, 1, 0, 0, 0), v(0, 0, 1, 0, 0)] },
    { category: sights, vectors: [v(0, 0, 0, 1, 0)] },
    { category: streets, vectors: [v(0, 0, 0, 0, 1)] },
  ];
  // "A city view" and "a landscape" rise and fall together (0.9); "a famous landmark" stands apart.
  const alike: Overlap = apart(width);
  alike.values[1 * width + 2] = 0.9;
  alike.values[2 * width + 1] = 0.9;
  const pooling = { ...settings, pooling: 0.02 };
  const verdict = (row: Float32Array, overlap: Overlap, s: AxisSettings) => axisOutcome(matchAxes('skyline', row, poolScored, overlap, s), list, []).verdict;
  // A skyline: "tools" 0.66 just ahead; a city view and a landscape 0.63, a landmark 0.625.
  const skyline = v(0.66, 0.63, 0.63, 0.625, 0.5);
  // The same with no landmark in it.
  const noLandmark = v(0.66, 0.63, 0.63, 0.3, 0.5);

  it('with no pooling, only the best counts: Tools is 0.03 ahead and the keepers, 0.03 behind, are not heard', () => {
    expect(verdict(skyline, alike, settings)).toBe('clutter');
    const m = matchAxes('skyline', skyline, poolScored, alike, settings);
    expect(m.subject).toMatchObject({ best: 0, lead: expect.closeTo(0.03, 5), ownScore: expect.closeTo(0.66, 5), rivalScore: expect.closeTo(0.63, 5), keeper: null });
    expect(m.subject.votes.size).toBe(0);
  });

  it('two descriptions that overlap count about once; one that stands apart adds a vote of its own', () => {
    // Views 1, the landscape 1 × (1 − 0.9) = 0.1, the landmark exp(−0.25) = 0.78: keep pools to 0.6426, within 0.02 of Tools, heard.
    const m = matchAxes('skyline', skyline, poolScored, alike, pooling);
    expect(m.subject.keeper).toMatchObject({ index: 1 });
    expect(verdict(skyline, alike, pooling)).toBe('keep');
    expect(m.subject.votes.get(1)).toBeCloseTo(1, 5);
    expect(m.subject.votes.get(2)).toBeCloseTo(0.1, 5);
    expect(m.subject.votes.get(3)).toBeCloseTo(Math.exp(-0.25), 5);
    // Without the landmark, the city view and the landscape alone: 0.63 + 0.02 × ln 1.1, not heard.
    expect(verdict(noLandmark, alike, pooling)).toBe('clutter');
    // Were they apart, two level would add 0.02 × ln 2 and be heard: the overlap is what stops them counting twice.
    expect(verdict(noLandmark, apart(width), pooling)).toBe('keep');
  });

  it('the lead is between pools: clutter pooled against everything that is not clutter pooled', () => {
    const m = matchAxes('skyline', skyline, poolScored, alike, pooling);
    // Tools alone: its pool is its score.
    expect(m.subject.ownScore).toBeCloseTo(0.66, 5);
    expect(m.subject.rivalScore).toBeCloseTo(0.63 + 0.02 * Math.log(1 + 0.1 + Math.exp(-0.25)), 4);
    expect(m.subject.lead).toBeCloseTo(m.subject.ownScore - m.subject.rivalScore!, 6);
  });

  it('counts only the three largest votes, so a photo nothing describes well gains little for their number', () => {
    const many = cat('many', 'subject', 'keep', ['a', 'b', 'c', 'd', 'e']);
    const lone = cat('lone', 'subject', 'clutter', ['x']);
    const place = cat('place', 'setting', 'neutral', ['p']);
    const s: ScoredAxis[] = [lone, many, place].map((category, k) => ({ category, vectors: category.descriptions.map((_, i) => v(...Array.from({ length: 7 }, (_, j) => (j === [0, 1, 6][k]! + (k === 1 ? i : 0) ? 1 : 0)))) }));
    const m = matchAxes('p', v(0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.3), s, apart(7), pooling);
    // Five level keepers: 0.6 + 0.02 × ln 3, not ln 5.
    expect(m.subject.ownScore).toBeCloseTo(0.6 + 0.02 * Math.log(3), 6);
    // Three of the five keepers' descriptions (places 1 to 5) vote; the votes also hold the clutter pool's one.
    expect([...m.subject.votes.keys()].filter((at) => at >= 1 && at <= 5)).toHaveLength(3);
  });

  it('shows each description’s vote and the pools in the hover card', () => {
    const b = axisBreakdown(skyline, poolScored, alike, pooling, [], 3);
    expect(b.outcome).toBe('Kept: Views keeps (close to the top)');
    // Pooled, Tools leads by only 0.0173: too close to count, and Views is heard.
    expect(b.sides[0]!.title).toBe(`Subject: Tools, ${leadText(0.66 - (0.63 + 0.02 * Math.log(1 + 0.1 + Math.exp(-0.25))))} ahead of Views (pooled; needs 0.02) · too close, no say · Views close behind, keeps`);
    // Views scores as its best description, a city view, which votes 1; Sights' landmark 0.78.
    expect(b.sides[0]!.rows.map((r) => [r.label, r.vote])).toEqual([['Tools', '1.00'], ['Views', '1.00'], ['Sights', '0.78']]);
    // No pooling, no votes.
    expect(axisBreakdown(skyline, poolScored, alike, settings, [], 3).sides[0]!.rows.map((r) => r.vote)).toEqual([null, null, null]);
  });

  it('refuses overlaps that do not fit the descriptions, and pooling below 0', () => {
    expect(() => matchAxes('p', skyline, poolScored, apart(4), settings)).toThrow("The overlaps (4) don't fit the descriptions (5)");
    expect(() => matchAxes('p', skyline, poolScored, alike, { ...settings, pooling: -0.01 })).toThrow('Pooling must be 0 or more');
  });
});

describe('how descriptions overlap over the library', () => {
  it('measures descriptions that rise and fall together as close to 1, and ones that don’t as 0', () => {
    // a and b go up and down together across the photos; c goes its own way; d is flat but for one photo.
    const rows = [v(1, 1.1, 0.2, 0), v(2, 2.1, -0.5, 0.1), v(-1, -0.9, 0.4, 0), v(0.5, 0.6, -0.1, -0.1), v(-2, -2.2, 0.1, 0)];
    const o = descriptionOverlap(rows);
    const at = (a: number, b: number) => o.values[a * o.width + b]!;
    expect(o.width).toBe(4);
    expect([0, 1, 2, 3].map((i) => at(i, i))).toEqual([1, 1, 1, 1]);
    expect(at(0, 1)).toBeGreaterThan(0.9);
    expect(at(0, 1)).toBe(at(1, 0));
    expect(at(0, 2)).toBeLessThan(0.3);
    expect([...o.values].every((x) => x >= 0 && x <= 1)).toBe(true);
  });

  it('takes off each photo’s own average first: a photo high on everything doesn’t make all descriptions alike', () => {
    // Every description moves only with the photo's overall level: once that is taken off, nothing is left in common.
    const rows = [v(1, 1, 1), v(2, 2, 2), v(-1, -1, -1), v(0.5, 0.5, 0.5)];
    const o = descriptionOverlap(rows);
    expect(o.values[0 * 3 + 1]).toBe(0);
    expect(o.values[1 * 3 + 2]).toBe(0);
  });

  it('refuses too few photos and rows of different widths', () => {
    expect(() => descriptionOverlap([v(1, 2)])).toThrow('at least two photos');
    expect(() => descriptionOverlap([v(1, 2), v(1, 2, 3)])).toThrow('different descriptions');
  });
});

describe('the floor: clutter must score clearly above “a photo”', () => {
  const fProducts = cat('products', 'subject', 'clutter', ['a product on a shelf']);
  const fPeople = cat('people', 'subject', 'keep', ['a selfie']);
  const fShops = cat('shops', 'setting', 'neutral', ['a supermarket aisle']);
  const any: AxisCategory = { id: 'baseline', label: 'Any photo', kind: 'counterweight', axis: 'baseline', verdict: 'neutral', descriptions: ['a photo'] };
  const list = [fProducts, fPeople, fShops, any];
  const s4: ScoredAxis[] = list.map((category, i) => ({ category, vectors: [v(...list.map((_, j) => (i === j ? 1 : 0)))] }));
  const floored = { ...settings, baseline: 0.02 };
  const verdict = (row: Float32Array, s: AxisSettings) => axisOutcome(matchAxes('p', row, s4, apart(4), s), list, []).verdict;

  it('leaves out clutter less than the floor above the best baseline description, and only clutter', () => {
    // Products 0.62, "a photo" 0.61: 0.01 above it.
    const weak = v(0.62, 0.5, 0.6, 0.61);
    expect(verdict(weak, settings)).toBe('clutter');
    expect(matchAxes('p', weak, s4, apart(4), floored).subject).toMatchObject({ counts: false, baselineGap: expect.closeTo(0.01, 5) });
    expect(verdict(weak, floored)).toBe('none');
    // 0.05 above it: counts.
    expect(verdict(v(0.66, 0.5, 0.6, 0.61), floored)).toBe('clutter');
    // A keeper is never held back by the floor.
    expect(verdict(v(0.5, 0.62, 0.6, 0.61), floored)).toBe('keep');
    expect(axisBreakdown(weak, s4, apart(4), floored, [], 2).sides[0]!.title).toBe('Subject: Products, 0.1200 ahead of People (needs 0.02) · 0.0100 above “a photo”, needs 0.02 · below the floor, no say');
  });

  it('gives the baseline no side of its own, and refuses a floor with no baseline in the list', () => {
    const m = matchAxes('p', v(0.62, 0.5, 0.6, 0.61), s4, apart(4), settings);
    expect(Object.keys(m)).toEqual(['mediaKey', 'subject', 'setting', 'checks']);
    expect(() => matchAxes('p', v(0.62, 0.5, 0.6), s4.slice(0, 3), apart(3), floored)).toThrow('The floor needs a baseline description');
    expect(floorProblem({ raw: floored, evened: PLAIN_AXIS_SETTINGS.evened }, list.slice(0, 3))).toBe('The floor is on (raw), and needs a baseline description such as “a photo”: keep one, or turn the floor off first.');
    expect(floorProblem({ raw: floored, evened: PLAIN_AXIS_SETTINGS.evened }, list)).toBeNull();
    expect(floorProblem(PLAIN_AXIS_SETTINGS, list.slice(0, 3))).toBeNull();
  });
});

describe("the page's saved settings, one set per scoring", () => {
  const list = AXIS_LIST.categories;

  it('starts from the starting tuning when nothing is saved, and reads back what it saved', () => {
    expect(readAxisTuning(null, list)).toEqual({ tuning: STARTING_AXIS_TUNING, notes: [] });
    // The shipped tuning names only what is in the shipped list: read back whole, nothing dropped.
    expect(readAxisTuning(JSON.stringify(STARTING_AXIS_TUNING), list)).toEqual({ tuning: STARTING_AXIS_TUNING, notes: [] });
    expect(STARTING_AXIS_TUNING.settings.raw.pooling).toBe(0.02);
    const tuning = { scoring: 'evened' as const, settings: { raw: { ...PLAIN_AXIS_SETTINGS.raw, pooling: 0.02, baseline: 0.01 }, evened: { ...PLAIN_AXIS_SETTINGS.evened, descriptionWeights: { 'a selfie': 0.2 } } } };
    expect(readAxisTuning(JSON.stringify(tuning), list)).toEqual({ tuning, notes: [] });
  });

  it('reads settings saved before evening out as the raw ones, with no pooling or floor, and says so', () => {
    const old = { subject: { minScore: 0, margin: 0.04 }, setting: { minScore: 0, margin: 0.02 }, form: { minScore: 0, margin: 0.02 }, margins: { repairs: 0.04 }, categoryWeights: {}, descriptionWeights: { 'a selfie': 0.01 } };
    const { tuning, notes } = readAxisTuning(JSON.stringify(old), list);
    // The evened-out ones start as shipped (plain until 2026-11-26, when the page's were shipped).
    expect(tuning).toEqual({ scoring: 'raw', settings: { raw: { ...old, pooling: 0, baseline: null }, evened: STARTING_AXIS_SETTINGS.evened } });
    expect(notes).toEqual(['The settings were saved before evening out came to subject and setting: they are the raw settings now, and the evened-out ones start afresh.']);
  });

  it('drops weights for what is no longer in the list, and turns off a floor with no baseline, naming each', () => {
    const saved = { scoring: 'raw', settings: { raw: { ...PLAIN_AXIS_SETTINGS.raw, baseline: 0.02, descriptionWeights: { tools: 0.01 } }, evened: PLAIN_AXIS_SETTINGS.evened } };
    const { tuning, notes } = readAxisTuning(JSON.stringify(saved), list.filter((c) => c.axis !== 'baseline'));
    expect(tuning.settings.raw).toEqual(PLAIN_AXIS_SETTINGS.raw);
    expect(notes).toEqual(['Turned the raw floor off: the list has no baseline description to measure it by.', 'Dropped the raw weight for “tools”, no longer in the list.']);
    expect(() => readAxisTuning(JSON.stringify({ scoring: 'raw', settings: { raw: { ...PLAIN_AXIS_SETTINGS.raw, pooling: 'x' } } }), list)).toThrow('no number for pooling');
  });
});

describe('editing subjects and settings', () => {
  it('switches axis and verdict, its kind following the verdict, and adds at the end of its axis', () => {
    let draft = draftOf(categories);
    draft = setVerdict(draft, 'shops', 'clutter');
    draft = setAxis(draft, 'repairs', 'setting');
    draft = addAxisCategory(draft, 'Faces', 'subject', 'keep');
    const { list } = listOf(draft);
    expect(list.map((c) => [c.id, (c as AxisCategory).axis, (c as AxisCategory).verdict, c.kind])).toEqual([
      ['products', 'subject', 'clutter', 'clutter'],
      ['people', 'subject', 'keep', 'counterweight'],
      ['repairs', 'setting', 'clutter', 'clutter'],
      ['shops', 'setting', 'clutter', 'clutter'],
      ['museums', 'setting', 'keep', 'counterweight'],
      ['carparks', 'setting', 'clutter', 'clutter'],
      ['food', 'subject', 'neutral', 'counterweight'],
      // At the end of the subjects as they are: after Food, the last subject.
      ['custom-faces', 'subject', 'keep', 'counterweight'],
    ]);
    expect(listChanges(categories, list)).toEqual(['Repairs is now a setting', 'Shops is now clutter', 'Added subject Faces (keep)']);
  });

  it('gives a form clutter or neutral only: forms are a system apart, where keep means nothing', () => {
    expect(verdictsFor('subject')).toEqual(['clutter', 'keep', 'neutral']);
    expect(verdictsFor('setting')).toEqual(['clutter', 'keep', 'neutral']);
    expect(verdictsFor('form')).toEqual(['clutter', 'neutral']);
    expect(verdictsFor('baseline')).toEqual(['neutral']);
    // The picker offers what the axis allows, and a verdict it doesn't allow while it is still there.
    expect(verdictChoices('form', 'neutral')).toEqual(['clutter', 'neutral']);
    expect(verdictChoices('form', 'keep')).toEqual(['clutter', 'neutral', 'keep']);
    // A keeper made a form is named at Save, not put right silently; and a kept list with a keep form is refused.
    const draft = setAxis(draftOf(categories), 'people', 'form');
    expect(draftProblems(draft)).toContain('People is a form, which offers a photo or holds others back, apart from subjects and settings: make it clutter or neutral.');
    expect(readAxisList(JSON.stringify({ categories: listOf(draft).list, exceptions: [] }), { categories, exceptions: [] }).notes[0]).toContain('People is a form');
  });

  it('puts each form in a check, keeps it through saving, and says what moved between checks', () => {
    const shots = { ...cat('screenshots', 'form', 'clutter', ['a phone screenshot']), check: 'Screenshots' };
    const notShots = { ...cat('photos', 'form', 'neutral', ['a photo of a room']), check: 'Screenshots' };
    const withForms = [...categories, shots, notShots];
    let draft = draftOf(withForms);
    expect(draftChecks(draft)).toEqual(['Screenshots']);
    // A subject made a form joins the list's first check; a new name starts a check of its own; a new form joins the list's first.
    draft = setAxis(draft, 'repairs', 'form');
    draft = setCheck(draft, 'repairs', 'Poor quality');
    draft = addAxisCategory(draft, 'Night', 'form', 'neutral');
    expect(draft.filter((c) => c.axis === 'form').map((c) => [c.id, c.check])).toEqual([['repairs', 'Poor quality'], ['screenshots', 'Screenshots'], ['photos', 'Screenshots'], ['custom-night', 'Poor quality']]);
    // A check named when adding: the new form goes there; a new name starts a check.
    const named = addAxisCategory(draft, 'Sharp', 'form', 'neutral', ' Screenshots ');
    expect(named.find((c) => c.id === 'custom-sharp')!.check).toBe('Screenshots');
    expect(addAxisCategory(draft, 'Memes', 'form', 'clutter', 'Forwarded').find((c) => c.id === 'custom-memes')!.check).toBe('Forwarded');
    expect(draftChecks(addAxisCategory(draft, 'Memes', 'form', 'clutter', 'Forwarded'))).toContain('Forwarded');
    expect(draftSections(draft, { subject: 'S', setting: 'T', baseline: 'B' }).map((x) => [x.key, x.categories.map((c) => c.id)])).toEqual([
      ['subject', ['products', 'people', 'food']],
      ['setting', ['shops', 'museums', 'carparks']],
      ['check Poor quality', ['repairs', 'custom-night']],
      ['check Screenshots', ['screenshots', 'photos']],
      ['baseline', []],
    ]);
    const { list } = listOf(draft);
    expect(list.find((c) => c.id === 'repairs')).toMatchObject({ axis: 'form', check: 'Poor quality' });
    // Only forms carry a check.
    expect(list.find((c) => c.id === 'products')).not.toHaveProperty('check');
    expect(listChanges(withForms, list)).toEqual(['Repairs is now a form in the Poor quality check', 'Added form Night (neutral) in the Poor quality check']);
    expect(listChanges(withForms, listOf(setCheck(draftOf(withForms), 'photos', 'Other')).list)).toEqual(['Photos is now in the Other check']);
    expect(isShipped(listOf(setCheck(draftOf(withForms), 'photos', 'Other')).list, withForms)).toBe(false);
    // A check with no name is named at Save; only a form can be put in a check.
    expect(draftProblems(setCheck(draftOf(withForms), 'photos', ' '))).toContain('Photos has no check: name the check it is in.');
    expect(() => setCheck(draftOf(withForms), 'products', 'X')).toThrow('only forms are in a check');
    // A list kept before checks: its forms are in one check, as they competed before; a check on a subject is refused.
    const legacy = readAxisList(JSON.stringify({ categories: [...categories, cat('screenshots', 'form', 'clutter', ['a phone screenshot']), cat('photos', 'form', 'neutral', ['a photo of a room'])], exceptions: [] }), { categories, exceptions: [] });
    expect([legacy.notes, checksOf(legacy.list.categories)]).toEqual([[], [DEFAULT_CHECK]]);
    const odd = readAxisList(JSON.stringify({ categories: categories.map((c) => (c.id === 'products' ? { ...c, check: 'X' } : c)), exceptions: [] }), { categories, exceptions: [] });
    expect(odd.notes[0]).toContain('isn’t a list of subjects and settings');
  });

  it('names what must be put right: both axes, some clutter, and exceptions that name what is there', () => {
    expect(draftProblems(draftOf([products, people]))).toEqual(['The list needs at least one setting.']);
    expect(draftProblems(draftOf([people, museums]))).toEqual(['The list needs at least one clutter category.']);
    const draft = draftOf(categories);
    expect(exceptionProblems(draft, [{ subject: 'repairs', setting: 'museums', verdict: 'clutter' }])).toEqual([]);
    expect(exceptionProblems(draft, [{ subject: 'gone', setting: 'museums', verdict: 'clutter' }])).toEqual(['An exception names a subject no longer in the list (gone in Museums).']);
    expect(exceptionProblems(draft, [{ subject: 'repairs', setting: 'people', verdict: 'keep' }])).toEqual(['An exception names a setting no longer in the list (Repairs in People).']);
    expect(exceptionProblems(draft, [{ subject: 'repairs', setting: 'museums', verdict: 'clutter' }, { subject: 'repairs', setting: 'museums', verdict: 'keep' }])).toEqual(['Repairs in Museums has two exceptions.']);
  });

  it('says how the exceptions change', () => {
    const from: PairException[] = [{ subject: 'repairs', setting: 'museums', verdict: 'clutter' }, { subject: 'products', setting: 'shops', verdict: 'keep' }];
    const to: PairException[] = [{ subject: 'repairs', setting: 'museums', verdict: 'keep' }, { subject: 'people', setting: 'carparks', verdict: 'clutter' }];
    expect(exceptionChanges(from, to, categories)).toEqual(['Exception Repairs in Museums is now keep', 'Added exception: People in Carparks → clutter', 'Removed exception: Products in Shops']);
  });

  it('keeps the edited list in this browser, or nothing when it is the shipped one, and refuses one it can’t use', () => {
    expect(saveAxisList(AXIS_LIST, AXIS_LIST)).toBeNull();
    const edited = { categories: AXIS_LIST.categories, exceptions: [{ subject: 'repairs', setting: 'heritage', verdict: 'clutter' as const }] };
    expect(readAxisList(saveAxisList(edited, AXIS_LIST), AXIS_LIST)).toEqual({ list: edited, notes: [] });
    expect(readAxisList(null, AXIS_LIST)).toEqual({ list: AXIS_LIST, notes: [] });
    expect(readAxisList('[1]', AXIS_LIST).notes[0]).toContain('it isn’t a list of subjects and settings');
    expect(readAxisList(JSON.stringify({ categories: [people], exceptions: [] }), AXIS_LIST).notes[0]).toContain('The list needs at least one setting.');
    const badException = { categories: AXIS_LIST.categories, exceptions: [{ subject: 'gone', setting: 'heritage', verdict: 'keep' }] };
    expect(readAxisList(JSON.stringify(badException), AXIS_LIST).notes[0]).toContain('An exception names a subject no longer in the list');
  });
});
