import { describe, expect, it } from 'vitest';
import { apart, countAxes, kindOf, matchAxes, PLAIN_AXIS_SETTINGS, type AxisCategory, type ScoredAxis } from '../../src/app/search/clutterAxes';
import { copiedLine, earlierAnswer, edgeLines, edgeScores, kindChoices, kindGuesses, moveInGrid, oneOfEachMoment, withDuplicates, labelAgainQueue, labelExamples, labelLine, labelMetrics, labelParts, labelSample, OTHER_KIND, offeredIn, randomSample, readLabels, reviewedLabel, reviewQueue, kindAgainChoices, blindSample, blindDrawOf, BLIND_DRAWS_KEPT, relabelBlind, rememberBlindDraw, sameBlindDraw, reviewStartedOver, saveLabels, scoreLabels, scoresChange, scoresLine, scoresReport, type LabelScores, type Labels } from '../../src/app/search/clutterLabels';

const v = (...xs: number[]) => Float32Array.from(xs);
const cat = (id: string, axis: 'subject' | 'setting' | 'form', verdict: 'clutter' | 'keep' | 'neutral', descriptions: string[]): AxisCategory => ({ id, label: id[0]!.toUpperCase() + id.slice(1), kind: kindOf(verdict), axis, verdict, descriptions });
// Subjects: Products, Receipts (clutter), People (keep). Setting: Shops (neutral). Form: Screenshots (clutter), Photos (neutral).
const list = [cat('products', 'subject', 'clutter', ['a price tag']), cat('receipts', 'subject', 'clutter', ['a receipt']), cat('people', 'subject', 'keep', ['a selfie']), cat('shops', 'setting', 'neutral', ['inside a shop']), cat('screenshots', 'form', 'clutter', ['a phone screenshot']), cat('photos', 'form', 'neutral', ['a photo'])];
const scored: ScoredAxis[] = list.map((category, i) => ({ category, vectors: [v(...list.map((_, j) => (i === j ? 1 : 0)))] }));
const settings = PLAIN_AXIS_SETTINGS.raw;
const match = (key: string, row: Float32Array) => matchAxes(key, row, scored, apart(6), settings);
const rows: [string, Float32Array][] = [
  ['tag', v(0.7, 0.3, 0.3, 0.6, 0.3, 0.6)], // Products
  ['till', v(0.3, 0.7, 0.3, 0.6, 0.3, 0.6)], // Receipts
  ['selfie', v(0.3, 0.3, 0.7, 0.6, 0.3, 0.6)], // kept by People
  ['shot', v(0.3, 0.3, 0.3, 0.6, 0.7, 0.4)], // a screenshot, by form; subject too close
  ['vague', v(0.5, 0.49, 0.3, 0.6, 0.3, 0.6)], // Products just ahead of Receipts: still clutter (two kinds of clutter)
  ['blur', v(0.4, 0.3, 0.39, 0.6, 0.3, 0.6)], // Products too close to People, which keeps
];
const matches = rows.map(([k, r]) => match(k, r));
const photos = new Map(rows.map(([k]) => [k, { eligible: true, approved: false }]));

describe('labels: the user’s verdict on photos, to score the suggestions against', () => {
  it('says where a photo is offered, by subject and setting, and by form', () => {
    expect(offeredIn(matches[0]!, list, [])).toEqual(['products']);
    expect(offeredIn(matches[2]!, list, [])).toEqual([]);
    expect(offeredIn(matches[3]!, list, [])).toEqual(['screenshots']);
  });

  it('guesses what the photo is, best-scoring first: every subject and the clutter forms, no setting or neutral form', () => {
    // Since 2026-11-23 "what is it?" for keep and clutter alike: People is a kind too (ties keep the list's order).
    expect(kindGuesses(rows[1]![1], scored, settings)).toEqual(['receipts', 'products', 'people', 'screenshots']);
    expect(kindGuesses(rows[2]![1], scored, settings)[0]).toBe('people');
    expect(kindGuesses(rows[3]![1], scored, settings)[0]).toBe('screenshots');
  });

  it('keeps labels and reads them back, refusing what it can’t read', () => {
    // Keep has a kind since 2026-11-23 (what the photo is); old keep labels have none.
    const labels: Labels = { tag: { verdict: 'clutter', kind: 'products' }, selfie: { verdict: 'keep', kind: null }, friend: { verdict: 'keep', kind: 'people' } };
    expect(readLabels(saveLabels(labels))).toEqual(labels);
    expect(readLabels(null)).toEqual({});
    expect(() => readLabels('[]')).toThrow('aren’t a set of labels');
    expect(() => readLabels('{"x":{"verdict":"maybe","kind":null}}')).toThrow('can’t be read');
    expect(() => readLabels('{"x":{"verdict":"unsure","kind":"products"}}')).toThrow('a kind to a photo labelled unsure or taste');
  });

  it('samples each category’s edge and just missed, some of “neither” and of the whole library, never the same twice nor what is labelled', () => {
    const counts = countAxes(matches, list, [], photos, settings);
    const all = labelSample(matches, counts, list, [], photos, {}, { edge: 8, justMissed: 6, neither: 40, random: 150 }, 7);
    expect(new Set(all)).toEqual(new Set(rows.map(([k]) => k)));
    expect(all).toHaveLength(rows.length);
    // The same seed, the same order; labelled photos and those that can't be trashed are left out.
    expect(labelSample(matches, counts, list, [], photos, {}, { edge: 8, justMissed: 6, neither: 40, random: 150 }, 7)).toEqual(all);
    const some = labelSample(matches, counts, list, [], new Map([...photos, ['blur', { eligible: false, approved: false }]]), { tag: { verdict: 'clutter', kind: 'products' } }, { edge: 8, justMissed: 6, neither: 0, random: 0 }, 7);
    expect(some).not.toContain('tag');
    expect(some).not.toContain('blur');
    expect(new Set(some)).toEqual(new Set(['till', 'shot', 'vague']));
  });

  it('scores the suggestions: right, harmless and wrong per category, what each misses, and how much clutter is found', () => {
    const labels: Labels = {
      tag: { verdict: 'clutter', kind: 'products' }, // right
      till: { verdict: 'clutter', kind: 'products' }, // offered in Receipts: harmless
      selfie: { verdict: 'clutter', kind: 'receipts' }, // kept: missed by Receipts
      shot: { verdict: 'keep', kind: null }, // offered in Screenshots: wrong
      vague: { verdict: 'unsure', kind: null }, // counts for nothing
      blur: { verdict: 'clutter', kind: OTHER_KIND }, // missed, a kind the list lacks
    };
    const s = scoreLabels(matches, list, [], photos, labels);
    expect(s.categories).toEqual([
      { id: 'products', label: 'Products', right: 1, harmless: 0, wrong: 0, missed: 0 },
      { id: 'receipts', label: 'Receipts', right: 0, harmless: 1, wrong: 0, missed: 1 },
      { id: 'screenshots', label: 'Screenshots', right: 0, harmless: 0, wrong: 1, missed: 0 },
    ]);
    expect(s).toMatchObject({ judged: 5, offered: 3, wrong: 1, clutter: 4, found: 2, otherKind: 1 });
    // The photos behind those numbers, to look at: offered though kept, and clutter missed, by its kind.
    expect(labelExamples(matches, list, [], photos, { ...labels, till: { verdict: 'clutter', kind: null } })).toEqual({ wrong: ['shot'], missed: { receipts: ['selfie'], other: ['blur'] } });
    expect(labelExamples(matches, list, [], photos, { vague: { verdict: 'clutter', kind: null }, blur: { verdict: 'clutter', kind: null } }).missed).toEqual({ unspecified: ['blur'] });
  });

  it('asks again about unsure and taste, and clutter missed with no kind; not what counts as it is', () => {
    const labels: Labels = {
      tag: { verdict: 'clutter', kind: null }, // no kind, but offered (Products): counts as it is
      till: { verdict: 'unsure', kind: null, random: true }, // asked again, and random it stays (on the page)
      selfie: { verdict: 'clutter', kind: null }, // no kind, missed: which category should have found it?
      shot: { verdict: 'taste', kind: null }, // taste, from before
      vague: { verdict: 'keep', kind: null },
      blur: { verdict: 'clutter', kind: OTHER_KIND },
    };
    expect(labelAgainQueue(matches, list, [], photos, labels)).toEqual(['till', 'selfie', 'shot']);
    // Only photos that may be trashed.
    expect(labelAgainQueue(matches, list, [], new Map([...photos, ['till', { eligible: false, approved: false }]]), labels)).toEqual(['selfie', 'shot']);
  });

  it('reviews the random labels, in library order, picking up where it left off', () => {
    const labels: Labels = {
      tag: { verdict: 'clutter', kind: 'products', random: true },
      till: { verdict: 'keep', kind: null, random: true, reviewed: true }, // reviewed already
      selfie: { verdict: 'keep', kind: null }, // not random
      shot: { verdict: 'unsure', kind: null, random: true },
    };
    expect(reviewQueue(matches, photos, labels)).toEqual({ queue: ['tag', 'shot'], button: 'Review my random labels (2 of 3 left)…' });
    // Only photos that may be trashed, counted in the total too.
    expect(reviewQueue(matches, new Map([...photos, ['shot', { eligible: false, approved: false }]]), labels)).toEqual({ queue: ['tag'], button: 'Review my random labels (1 of 2 left)…' });
    // Answered in the review: random and reviewed, whatever the answer.
    const answered = { ...labels, tag: reviewedLabel({ verdict: 'keep', kind: null }), shot: reviewedLabel({ verdict: 'clutter', kind: 'screenshots' }) };
    expect(answered.tag).toEqual({ verdict: 'keep', kind: null, random: true, reviewed: true });
    expect(reviewQueue(matches, photos, answered)).toEqual({ queue: [], button: 'Review my random labels (all 3 reviewed)' });
    // Kept and read back; reviewed only on a random label.
    expect(readLabels(saveLabels(answered))).toEqual(answered);
    expect(() => readLabels(JSON.stringify({ x: { verdict: 'keep', kind: null, reviewed: true } }))).toThrow('can’t be read');
    // Started over: every answer kept, every random label back in the review.
    const over = reviewStartedOver(answered)!;
    expect(over.tag).toEqual({ verdict: 'keep', kind: null, random: true });
    expect(over.selfie).toEqual(labels.selfie);
    expect(reviewQueue(matches, photos, over).queue).toEqual(['tag', 'till', 'shot']);
    // Nothing reviewed: nothing to start over.
    expect(reviewStartedOver(over)).toBeNull();
  });

  it('offers the edge labels of each kind and verdict to answer again, leaving random labels to their review', () => {
    const labels: Labels = {
      tag: { verdict: 'clutter', kind: 'products' },
      vague: { verdict: 'clutter', kind: 'products' },
      blur: { verdict: 'clutter', kind: 'products', random: true }, // random: its own review
      till: { verdict: 'keep', kind: 'products' }, // the same kind, kept
      selfie: { verdict: 'keep', kind: 'people' },
      shot: { verdict: 'unsure', kind: null },
      receipt: { verdict: 'clutter', kind: OTHER_KIND }, // not among the photos: left out
    };
    const kinds = list.map((c) => ({ id: c.id, label: c.label }));
    expect(kindAgainChoices(matches, photos, labels, kinds, list).filter((c) => !c.kind.startsWith('top:'))).toEqual([
      // By kind, A to Z, whatever the list's order; clutter before keep.
      { kind: 'keep:people', option: 'Keep · People (1)', queue: ['selfie'] },
      { kind: 'clutter:products', option: 'Clutter · Products (2)', queue: ['tag', 'vague'] },
      { kind: 'keep:products', option: 'Keep · Products (1)', queue: ['till'] },
    ]);
    // Clutter with no kind that fits, too.
    expect(kindAgainChoices(matches, photos, { ...labels, shot: { verdict: 'clutter', kind: OTHER_KIND } }, kinds, list)[0]).toEqual({ kind: 'clutter:other', option: 'Clutter · Other: kind missing (1)', queue: ['shot'] });
    // Only photos that may be trashed.
    const tagApproved = new Map([...photos, ['tag', { eligible: true, approved: true }]]);
    expect(kindAgainChoices(matches, tagApproved, labels, kinds, list)[1]).toEqual({ kind: 'clutter:products', option: 'Clutter · Products (1)', queue: ['vague'] });
    // By what it looks like, whatever the answer: the edge labels whose best subject is that one (blur is random).
    expect(kindAgainChoices(matches, photos, labels, kinds, list).filter((c) => c.kind.startsWith('top:'))).toEqual([
      { kind: 'top:people', option: 'Top subject · People (1)', queue: ['selfie'] },
      { kind: 'top:products', option: 'Top subject · Products (3)', queue: ['tag', 'shot', 'vague'] }, // shot: the screenshot, its subject Products though its form decides it
      { kind: 'top:receipts', option: 'Top subject · Receipts (1)', queue: ['till'] },
      // And by setting: Shops is the only one, so every edge label.
      { kind: 'top:shops', option: 'Top setting · Shops (5)', queue: ['tag', 'till', 'selfie', 'shot', 'vague'] },
    ]);
  });

  it('draws labelled photos for the agent to label blind, the same each time, the answers kept apart by number', () => {
    const labels: Labels = {
      tag: { verdict: 'clutter', kind: 'products' },
      selfie: { verdict: 'keep', kind: 'people', random: true },
      shot: { verdict: 'unsure', kind: null },
      blur: { verdict: 'clutter', kind: 'products' },
    };
    const all = blindSample(matches, list, [], photos, labels, 10, 'b1');
    // Every labelled photo, none unlabelled, each once.
    expect([...all.keys].sort()).toEqual(['blur', 'selfie', 'shot', 'tag']);
    expect(blindSample(matches, list, [], photos, labels, 10, 'b1')).toEqual(all);
    // Numbered in the order drawn, with names instead of ids, and what the list offers it in.
    const n = (key: string) => all.keys.indexOf(key) + 1;
    expect(all.answers.find((a) => a.number === n('tag'))).toEqual({ number: n('tag'), verdict: 'clutter', kind: 'Products', random: false, offered: ['Products'] });
    expect(all.answers.find((a) => a.number === n('selfie'))).toEqual({ number: n('selfie'), verdict: 'keep', kind: 'People', random: true, offered: [] });
    expect(all.answers.map((a) => a.number)).toEqual([1, 2, 3, 4]);
    // No photo keys in the answers.
    expect(JSON.stringify(all.answers)).not.toMatch(/"(tag|selfie|shot|blur)"/);
    // A smaller sample; only photos that may be trashed.
    expect(blindSample(matches, list, [], photos, labels, 2, 'b1').keys).toEqual(all.keys.slice(0, 2));
    expect(blindSample(matches, list, [], new Map([...photos, ['tag', { eligible: false, approved: false }]]), labels, 10, 'b1').keys).not.toContain('tag');
  });

  it('relabels the photos of a blind draw by their numbers, only when the draw is the one recorded', () => {
    const labels: Labels = {
      tag: { verdict: 'clutter', kind: 'products' },
      selfie: { verdict: 'keep', kind: 'people', random: true, reviewed: true },
      shot: { verdict: 'unsure', kind: null },
      blur: { verdict: 'clutter', kind: 'products' },
    };
    const draw = blindSample(matches, list, [], photos, labels, 10, 'b1');
    // Drawn again as it was: the same; with names changed by editing the list, still the same.
    expect(sameBlindDraw(draw.answers, blindSample(matches, list, [], photos, labels, 10, 'b1').answers)).toBe(true);
    expect(sameBlindDraw(draw.answers.map((a) => ({ ...a, kind: a.kind === null ? null : 'Renamed' })), draw.answers)).toBe(true);
    // A label added since, or one answered otherwise: another draw, refused.
    expect(sameBlindDraw(draw.answers, blindSample(matches, list, [], photos, { ...labels, till: { verdict: 'keep', kind: null } }, 10, 'b1').answers)).toBe(false);
    expect(sameBlindDraw(draw.answers, blindSample(matches, list, [], photos, { ...labels, shot: { verdict: 'keep', kind: null } }, 10, 'b1').answers)).toBe(false);
    expect(sameBlindDraw(draw.answers.slice(1), draw.answers)).toBe(false);

    const n = (key: string) => draw.keys.indexOf(key) + 1;
    const done = relabelBlind(draw.keys, [{ number: n('selfie'), verdict: 'unsure', kind: null }, { number: n('shot'), verdict: 'clutter', kind: OTHER_KIND }, { number: n('tag'), verdict: 'keep', kind: 'people' }], labels, list);
    expect(done).toEqual({ labels: {
      ...labels,
      // Random and reviewed stay as they were.
      selfie: { verdict: 'unsure', kind: null, random: true, reviewed: true },
      shot: { verdict: 'clutter', kind: OTHER_KIND },
      tag: { verdict: 'keep', kind: 'people' },
    } });
    // Refused whole, changing nothing: a number not drawn, a kind of the other side, a setting no one labels with, a kind with unsure.
    const problem = (edits: Parameters<typeof relabelBlind>[1]) => (relabelBlind(draw.keys, edits, labels, list) as { problem: string }).problem;
    expect(problem([{ number: n('shot'), verdict: 'unsure', kind: null }, { number: 5, verdict: 'keep', kind: null }])).toBe("#5 isn't in the draw of 4.");
    expect(problem([{ number: 1, verdict: 'clutter', kind: 'people' }])).toBe("#1: \"people\" isn't a kind for clutter.");
    expect(problem([{ number: 1, verdict: 'keep', kind: 'shops' }])).toBe("#1: \"shops\" isn't a kind for keep.");
    expect(problem([{ number: 1, verdict: 'unsure', kind: OTHER_KIND }])).toBe("#1: \"other\" isn't a kind for unsure.");
  });

  it('keeps the latest blind draws in this browser, so their numbers name the same photos later', () => {
    let text = rememberBlindDraw(null, 'b1', ['tag', 'shot']);
    text = rememberBlindDraw(text, 'b2', ['blur']);
    expect(blindDrawOf(text, 'b1')).toEqual(['tag', 'shot']);
    expect(blindDrawOf(text, 'b3')).toBeNull();
    expect(blindDrawOf(null, 'b1')).toBeNull();
    // The same id drawn again replaces it; only the latest are kept.
    expect(blindDrawOf(rememberBlindDraw(text, 'b1', ['selfie']), 'b1')).toEqual(['selfie']);
    for (let i = 0; i < BLIND_DRAWS_KEPT; i++) text = rememberBlindDraw(text, `x${i}`, ['tag']);
    expect(blindDrawOf(text, 'b1')).toBeNull();
    expect(blindDrawOf(text, `x${BLIND_DRAWS_KEPT - 1}`)).toEqual(['tag']);
    expect(() => blindDrawOf('{"b1":[]}', 'b1')).toThrow('The blind draws kept in this browser aren’t a list of { id, keys }');
  });

  it('offers the keep settings as kinds under Keep only: what should have kept a photo is sometimes where it was', () => {
    // Adventures (a keep setting) beside Shops (a neutral setting): a photo of the boat on a sailing trip.
    const withAdventures = [...list, cat('adventures', 'setting', 'keep', ['sailing on a boat'])];
    const scoredAdventures: ScoredAxis[] = withAdventures.map((category, i) => ({ category, vectors: [v(...withAdventures.map((_, j) => (i === j ? 1 : 0)))] }));
    const guesses = kindGuesses(v(0.3, 0.3, 0.5, 0.6, 0.2, 0.6, 0.8), scoredAdventures, settings);
    expect(guesses).toEqual(['adventures', 'people', 'products', 'receipts', 'screenshots']);
    const kinds = withAdventures.map((c) => ({ id: c.id, label: c.label, verdict: c.verdict }));
    expect(kindChoices('keep', guesses, kinds).map((c) => c.kind)).toEqual(['adventures', 'people', OTHER_KIND]);
    expect(kindChoices('clutter', guesses, kinds).map((c) => c.kind)).toEqual(['products', 'receipts', 'screenshots', OTHER_KIND]);
  });

  it('tallies clutter labelled as a subject the list doesn’t call clutter: a different view of a category the list has', () => {
    // The list with a neutral subject, Plants: someone may find a houseplant clutter though the list doesn't.
    const withPlants = [...list, cat('plants', 'subject', 'neutral', ['a houseplant'])];
    const scoredPlants: ScoredAxis[] = withPlants.map((category, i) => ({ category, vectors: [v(...withPlants.map((_, j) => (i === j ? 1 : 0)))] }));
    // Every subject is a kind, the neutral and keep ones too; never a setting or the neutral form.
    expect(kindGuesses(v(0.3, 0.5, 0.9, 0.8, 0.2, 0.9, 0.7), scoredPlants, settings)).toEqual(['people', 'plants', 'receipts', 'products', 'screenshots']);
    const plantRows: [string, Float32Array][] = [
      ['pot', v(0.7, 0.3, 0.3, 0.6, 0.3, 0.6, 0.65)], // offered by Products all the same
      ['garden', v(0.3, 0.3, 0.7, 0.6, 0.3, 0.6, 0.69)], // kept by People: missed
    ];
    const plantMatches = plantRows.map(([k, r]) => matchAxes(k, r, scoredPlants, apart(7), settings));
    const plantPhotos = new Map(plantRows.map(([k]) => [k, { eligible: true, approved: false }]));
    const asPlants: Labels = { pot: { verdict: 'clutter', kind: 'plants' }, garden: { verdict: 'clutter', kind: 'plants' } };
    const s = scoreLabels(plantMatches, withPlants, [], plantPhotos, asPlants);
    expect(s.notClutterKinds).toEqual([{ id: 'plants', label: 'Plants', offered: 1, missed: 1 }]);
    // Clutter like any other: found and missed count; for the category offering it, another kind.
    expect(s).toMatchObject({ clutter: 2, found: 1, otherKind: 0 });
    expect(s.categories.find((c) => c.id === 'products')).toMatchObject({ right: 0, harmless: 1 });
    expect(scoreLabels(plantMatches, withPlants, [], plantPhotos, {}).notClutterKinds).toEqual([]);
    // Food and drink, a matter of taste: tallied as a view all the same, and nothing in the scores.
    const withFood = [...list, cat('food', 'subject', 'neutral', ['a meal'])];
    const food = scoreLabels(plantMatches, withFood, [], plantPhotos, { pot: { verdict: 'clutter', kind: 'food' }, garden: { verdict: 'clutter', kind: 'food' } });
    expect(food.notClutterKinds).toEqual([{ id: 'food', label: 'Food', offered: 1, missed: 1 }]);
    expect(food).toMatchObject({ judged: 0, clutter: 0 });
    // A keep subject labelled clutter (someone trashes this people photo): the same tally.
    expect(scoreLabels(plantMatches, withPlants, [], plantPhotos, { garden: { verdict: 'clutter', kind: 'people' } }).notClutterKinds).toEqual([{ id: 'people', label: 'People', offered: 0, missed: 1 }]);
  });

  it('counts the keepers offered all the same by what they are: which category should have kept them', () => {
    const labels: Labels = {
      shot: { verdict: 'keep', kind: 'people' }, // offered by Screenshots: People should have kept it
      tag: { verdict: 'keep', kind: 'people' }, // offered by Products
      selfie: { verdict: 'keep', kind: 'people' }, // kept: not tallied
      till: { verdict: 'keep', kind: null }, // offered, but no kind (before 2026-11-23)
    };
    const s = scoreLabels(matches, list, [], photos, labels);
    expect(s.keepersOffered).toEqual([{ id: 'people', label: 'People', offered: 2, missed: 1 }]);
    expect(s).toMatchObject({ wrong: 3, judged: 4 });
  });
});
describe('labels drawn at random, and the measures they give', () => {
  it('draws photos at random from the whole library, reusing verdicts already given and skipping those already random', () => {
    const labels: Labels = { tag: { verdict: 'clutter', kind: 'products' }, selfie: { verdict: 'keep', kind: null, random: true } };
    const all = randomSample(matches, photos, labels, 10, 2);
    // Every photo but the one already random; the one labelled in the mixed sample comes back to be reused, not asked again.
    expect([...all.queue, ...all.reused].sort()).toEqual(['blur', 'shot', 'tag', 'till', 'vague']);
    expect(all.reused).toEqual(['tag']);
    // The same order for the same seed; only photos that may be trashed.
    expect(randomSample(matches, photos, labels, 10, 2)).toEqual(all);
    const kept = new Map([...photos].map(([k, p]) => [k, k === 'till' ? { ...p, eligible: false } : p]));
    expect(randomSample(matches, kept, labels, 10, 2).queue).not.toContain('till');
    expect(randomSample(matches, photos, labels, 2, 2).queue.length + randomSample(matches, photos, labels, 2, 2).reused.length).toBe(2);
  });

  it('keeps the random mark, and refuses a mark it can’t read', () => {
    const labels: Labels = { tag: { verdict: 'clutter', kind: 'products', random: true } };
    expect(readLabels(saveLabels(labels))).toEqual(labels);
    expect(() => readLabels('{"x":{"verdict":"keep","kind":null,"random":"yes"}}')).toThrow('can’t be read');
  });

  it('splits labels into the random ones and two fixed halves of all', () => {
    const labels: Labels = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`photo${i}`, { verdict: 'keep' as const, kind: null, ...(i < 5 ? { random: true as const } : {}) }]));
    const parts = labelParts(labels);
    expect(Object.keys(parts.random)).toEqual(['photo0', 'photo1', 'photo2', 'photo3', 'photo4']);
    expect(Object.keys(parts.a).length + Object.keys(parts.b).length).toBe(40);
    expect(Object.keys(parts.a).filter((k) => k in parts.b)).toEqual([]);
    // Both halves get some, and the same photo always lands in the same half.
    expect(Object.keys(parts.a).length).toBeGreaterThan(5);
    expect(Object.keys(parts.b).length).toBeGreaterThan(5);
    expect(labelParts(labels)).toEqual(parts);
  });

  it('gives precision (offered that is clutter) and recall (clutter that is offered), and says them in a line', () => {
    // tag, till, vague, shot offered (vague labelled keep: wrong); blur clutter, not offered; selfie keep, not offered.
    const labels: Labels = {
      tag: { verdict: 'clutter', kind: 'products', random: true }, till: { verdict: 'clutter', kind: 'receipts', random: true }, vague: { verdict: 'keep', kind: null },
      shot: { verdict: 'clutter', kind: OTHER_KIND }, blur: { verdict: 'clutter', kind: 'products' }, selfie: { verdict: 'keep', kind: null },
    };
    const all = scoreLabels(matches, list, [], photos, labels);
    expect(labelMetrics(all)).toEqual({ precision: 3 / 4, recall: 3 / 4 });
    const random = scoreLabels(matches, list, [], photos, labelParts(labels).random);
    expect(labelMetrics(scoreLabels(matches, list, [], photos, {}))).toEqual({ precision: null, recall: null });
    expect(labelLine(all, random)).toBe('Labels: 6 judged · precision 75% (3 of 4 offered) · recall 75% (3 of 4 clutter) · 1 of a kind no category fits · random photos: 2 judged · precision 100% (2 of 2 offered) · recall 100% (2 of 2 clutter)');
    expect(labelLine(all, scoreLabels(matches, list, [], photos, {}))).toMatch(/random photos: none yet \(Label random photos…\)$/);
  });

  it('marks the earlier answer and kind of a photo gone back to, and starts the highlight on that kind', () => {
    const kinds = ['products', 'people', OTHER_KIND];
    expect(earlierAnswer(undefined, kinds)).toEqual({ answer: null, chosen: null, at: 0 });
    // Keep and clutter both carry what the photo is; the highlight starts on it, so Space or Enter gives it again.
    expect(earlierAnswer({ verdict: 'keep', kind: 'people' }, kinds)).toEqual({ answer: 'keep', chosen: 1, at: 1 });
    expect(earlierAnswer({ verdict: 'clutter', kind: OTHER_KIND }, kinds)).toEqual({ answer: 'clutter', chosen: 2, at: 2 });
    // No kind (keep before 2026-11-23, simple answers), or one no longer shown: the answer alone, the highlight on the guess.
    expect(earlierAnswer({ verdict: 'keep', kind: null }, kinds)).toEqual({ answer: 'keep', chosen: null, at: 0 });
    expect(earlierAnswer({ verdict: 'clutter', kind: 'gone', random: true }, kinds)).toEqual({ answer: 'clutter', chosen: null, at: 0 });
    expect(earlierAnswer({ verdict: 'unsure', kind: null }, kinds)).toEqual({ answer: 'unsure', chosen: null, at: 0 });
    // Taste is no longer offered; simple answers have no grid to mark.
    expect(earlierAnswer({ verdict: 'taste', kind: null }, kinds)).toEqual({ answer: null, chosen: null, at: 0 });
    expect(earlierAnswer({ verdict: 'clutter', kind: 'people' }, kinds, true)).toEqual({ answer: 'clutter', chosen: null, at: 0 });
    // Grouped, the AI's best guess may not be first: with no kind to start on, the highlight starts there.
    expect(earlierAnswer(undefined, kinds, false, 1)).toEqual({ answer: null, chosen: null, at: 1 });
    expect(earlierAnswer({ verdict: 'keep', kind: null }, kinds, false, 1)).toEqual({ answer: 'keep', chosen: null, at: 1 });
    expect(earlierAnswer({ verdict: 'keep', kind: 'products' }, kinds, false, 1)).toEqual({ answer: 'keep', chosen: 0, at: 0 });
  });

  describe('labels copied to near-duplicates', () => {
    const moments = [['a1', 'a2', 'a3'], ['b1', 'b2'], ['c1', 'c2']];

    it('gives a moment’s unlabelled photos the answer and kind its labels agree on, never as random, and leaves own labels alone', () => {
      const labels: Labels = { a1: { verdict: 'clutter', kind: 'receipts', random: true }, b1: { verdict: 'keep', kind: 'people' }, b2: { verdict: 'unsure', kind: null }, x: { verdict: 'keep', kind: null } };
      const seen = withDuplicates(labels, moments);
      expect(seen.a2).toEqual({ verdict: 'clutter', kind: 'receipts', copied: true });
      expect(seen.a3).toEqual({ verdict: 'clutter', kind: 'receipts', copied: true });
      // Own labels unchanged; a moment whose labels differ copies nothing; one with none, nothing.
      expect(seen.a1).toBe(labels.a1);
      expect(seen.b1).toBe(labels.b1);
      expect(seen.b2).toBe(labels.b2);
      expect(seen.c1).toBeUndefined();
      expect(seen.x).toBe(labels.x);
      expect(labels.a2).toBeUndefined();
      // Copies are never random: only the photo drawn counts as random.
      expect(Object.keys(labelParts(seen).random)).toEqual(['a1']);
    });

    it('doesn’t copy Accidental shots, about the shot rather than what it shows, nor clutter with no kind; copies keep with no kind', () => {
      expect(withDuplicates({ a1: { verdict: 'clutter', kind: 'accidental' } }, moments).a2).toBeUndefined();
      expect(withDuplicates({ a1: { verdict: 'clutter', kind: null } }, moments).a2).toBeUndefined();
      expect(withDuplicates({ a1: { verdict: 'keep', kind: null } }, moments).a2).toEqual({ verdict: 'keep', kind: null, copied: true });
      expect(withDuplicates({ a1: { verdict: 'clutter', kind: OTHER_KIND } }, moments).a2).toEqual({ verdict: 'clutter', kind: OTHER_KIND, copied: true });
    });

    it('doesn’t copy when the labels of a moment agree on the answer but not the kind', () => {
      expect(withDuplicates({ a1: { verdict: 'clutter', kind: 'receipts' }, a2: { verdict: 'clutter', kind: 'documents' } }, moments).a3).toBeUndefined();
    });

    it('asks one photo of each moment, the first in the queue', () => {
      expect(oneOfEachMoment(['a2', 'x', 'a1', 'b2', 'a3', 'b1', 'y'], moments)).toEqual(['a2', 'x', 'b2', 'y']);
    });

    it('says how many labels were copied', () => {
      expect(copiedLine({ a1: { verdict: 'keep', kind: null } })).toBeNull();
      expect(copiedLine(withDuplicates({ a1: { verdict: 'keep', kind: null } }, moments))).toBe('2 more photos take the label of a near-duplicate (the Duplicates review’s moments), not random ones');
    });
  });

  describe('the kinds after Keep or Clutter', () => {
    const kinds = [
      { id: 'receipts', label: 'Receipts', verdict: 'clutter' as const },
      { id: 'people', label: 'People', verdict: 'keep' as const },
      { id: 'food', label: 'Food and drink', verdict: 'neutral' as const },
      { id: 'screens', label: 'Screen photos', verdict: 'clutter' as const },
      { id: 'pets', label: 'Pets', verdict: 'keep' as const },
    ];
    // The AI takes it for People first.
    const guesses = ['people', 'screens', 'food', 'pets', 'receipts'];
    const shown = (answer: 'keep' | 'clutter') => kindChoices(answer, guesses, kinds).map((c) => `${c.key} ${c.kind}`);

    it('offers after Keep the keep categories, after Clutter the clutter ones, each by the AI’s guess, then Other; neutral in neither', () => {
      expect(shown('keep')).toEqual(['1 people', '2 pets', `o ${OTHER_KIND}`]);
      expect(shown('clutter')).toEqual(['1 screens', '2 receipts', `o ${OTHER_KIND}`]);
    });

    it('offers Other alone when the side has no kinds', () => {
      expect(kindChoices('keep', [], []).map((c) => c.kind)).toEqual([OTHER_KIND]);
    });

    it('refuses a guess that isn’t a kind to label with', () => {
      expect(() => kindChoices('keep', ['gone'], kinds)).toThrow('gone');
    });
  });
  it('moves the highlight with the arrows, by row and column, staying inside the grid', () => {
    // 5 kinds in 2 columns: rows [0 1] [2 3] [4].
    const move = (at: number, arrow: 'up' | 'down' | 'left' | 'right') => moveInGrid(at, arrow, 5, 2);
    expect(move(1, 'down')).toBe(3);
    // Down into a row whose column runs short: its last; from the last row, nowhere.
    expect(move(3, 'down')).toBe(4);
    expect(move(4, 'down')).toBe(4);
    expect(move(4, 'up')).toBe(2);
    expect(move(0, 'up')).toBe(0);
    expect(move(2, 'right')).toBe(3);
    expect(move(4, 'right')).toBe(4);
    expect(move(3, 'left')).toBe(2);
    expect(move(2, 'left')).toBe(2);
  });

  it('says precision and recall in short, random photos first, and what a change does to them', () => {
    const score = (offered: number, wrong: number, clutter: number, found: number, judged: number): LabelScores => ({ categories: [], offered, wrong, clutter, found, otherKind: 0, notClutterKinds: [], keepersOffered: [], judged });
    const before = { all: score(1000, 94, 1200, 906, 2000), random: score(39, 2, 88, 37, 266) };
    const after = { all: score(1000, 45, 1200, 955, 2000), random: score(40, 1, 88, 39, 266) };
    expect(scoresLine(after)).toBe('Random photos: precision 97.5% · recall 44.3% (266 judged) · all labels: precision 95.5% · recall 79.6% (2,000 judged)');
    expect(scoresChange(before, after)).toBe('Random photos: precision 94.9% → 97.5% · recall 42.0% → 44.3% · all labels: precision 90.6% → 95.5% · recall 75.5% → 79.6%');
    // Unchanged says so; no random labels yet says that; no labels at all, nothing to say.
    expect(scoresChange(after, after)).toBe('Random photos: precision 97.5% (no change) · recall 44.3% (no change) · all labels: precision 95.5% (no change) · recall 79.6% (no change)');
    const none = score(0, 0, 0, 0, 0);
    expect(scoresLine({ all: after.all, random: none })).toBe('Random photos: none labelled yet · all labels: precision 95.5% · recall 79.6% (2,000 judged)');
    expect(scoresLine({ all: none, random: none })).toBeNull();
    expect(scoresChange({ all: none, random: none }, { all: none, random: none })).toBeNull();
  });

  it('copies the scores as numbers and the list, never a photo key', () => {
    const labels: Labels = {
      tag: { verdict: 'clutter', kind: 'products', random: true }, till: { verdict: 'clutter', kind: 'receipts', random: true }, vague: { verdict: 'keep', kind: null },
      shot: { verdict: 'clutter', kind: OTHER_KIND }, blur: { verdict: 'clutter', kind: 'products' }, selfie: { verdict: 'keep', kind: null },
    };
    const all = scoreLabels(matches, list, [], photos, labels);
    const random = scoreLabels(matches, list, [], photos, labelParts(labels).random);
    const report = scoresReport({
      version: '0.5.108', matched: 1234, totals: 'Clutter 4 (1%)', changes: ['Products: added "a shelf label"'], scoring: 'raw', settings: PLAIN_AXIS_SETTINGS.raw,
      all, random, edge: [{ id: 'products', label: 'Products', photos: 30, labelled: 10, wrong: 1, state: 'pass' }],
    });
    const lines = report.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Photo Cleaner clutter scores · version 0.5.108 · numbers only: no photos, photo keys or labels',
      `Library: ${(1234).toLocaleString()} photos matched · Clutter 4 (1%)`,
      'List: 1 changes from the shipped list',
      '- Products: added "a shelf label"',
    ]);
    expect(lines).toContain(labelLine(all, random));
    expect(lines).toContain('Other clutter, kind missing: 0 random · 1 in all');
    // The random photos first, each category with anything to say; then all labels; then the edge.
    const randomAt = lines.indexOf('Random photos by category (offered: right · another kind · wrong; missed):');
    const allAt = lines.indexOf('All labels by category:');
    expect(randomAt).toBeGreaterThan(0);
    expect(allAt).toBeGreaterThan(randomAt);
    expect(lines.slice(randomAt + 1, allAt).every((l) => l.startsWith('- '))).toBe(true);
    expect(lines.slice(randomAt + 1, allAt)).toEqual(random.categories.filter((c) => c.right + c.harmless + c.wrong + c.missed > 0).map((c) => `- ${c.label}: ${c.right} right · ${c.harmless} another kind · ${c.wrong} wrong · ${c.missed} missed`));
    expect(lines).toContain(edgeLines([{ id: 'products', label: 'Products', photos: 30, labelled: 10, wrong: 1, state: 'pass' }]).summary);
    for (const key of Object.keys(labels)) expect(report).not.toMatch(new RegExp(`\\b${key}\\b`));
  });
});
describe('a matter of taste, and each category at its edge', () => {
  const counts = countAxes(matches, list, [], photos, settings);

  it('keeps a matter of taste, which counts for nothing, like unsure', () => {
    const labels: Labels = { tag: { verdict: 'taste', kind: null }, till: { verdict: 'clutter', kind: 'receipts' } };
    expect(readLabels(saveLabels(labels))).toEqual(labels);
    expect(() => readLabels('{"x":{"verdict":"taste","kind":"products"}}')).toThrow('a kind to a photo labelled unsure or taste');
    const scores = scoreLabels(matches, list, [], photos, labels);
    expect([scores.judged, scores.offered, scores.found]).toEqual([1, 1, 1]);
    // Clutter of a kind the rules call taste (meals and drinks: food) counts as taste too.
    const meal = scoreLabels(matches, list, [], photos, { ...labels, vague: { verdict: 'clutter', kind: 'food' } });
    expect([meal.judged, meal.clutter]).toEqual([1, 1]);
  });

  it('tops each category’s edge up to the labelled wanted, riskiest first', () => {
    // Products offers tag and vague; vague, just ahead of Receipts, is its riskiest.
    const only = (labels: Labels) => labelSample(matches, counts, list, [], photos, labels, { edge: 1, justMissed: 0, neither: 0, random: 0 }, 7);
    expect(only({})).toContain('vague');
    expect(only({})).not.toContain('tag');
    // vague labelled: Products' edge has the one it wants, so none of its photos is asked; taste doesn't count.
    expect(only({ vague: { verdict: 'keep', kind: null } })).not.toContain('tag');
    expect(only({ vague: { verdict: 'taste', kind: null } })).toContain('tag');
  });

  it('says whether each category passes at its edge: enough labelled, at most one wrong', () => {
    const products = (labels: Labels) => edgeScores(counts, labels).find((s) => s.id === 'products')!;
    // Products offers 2: both must be labelled (fewer than 10 in all), at most 1 of them keep.
    expect(products({ vague: { verdict: 'keep', kind: null } })).toMatchObject({ photos: 2, labelled: 1, wrong: 1, state: 'unlabelled' });
    expect(products({ vague: { verdict: 'keep', kind: null }, tag: { verdict: 'clutter', kind: 'products' } })).toMatchObject({ labelled: 2, wrong: 1, state: 'pass' });
    expect(products({ vague: { verdict: 'keep', kind: null }, tag: { verdict: 'keep', kind: null } })).toMatchObject({ wrong: 2, state: 'fail' });
    expect(products({ vague: { verdict: 'taste', kind: null }, tag: { verdict: 'clutter', kind: 'products' } }).state).toBe('unlabelled');
    const lines = edgeLines(edgeScores(counts, { vague: { verdict: 'keep', kind: null }, tag: { verdict: 'keep', kind: null } }));
    expect(lines.summary).toMatch(/: 0 pass · 1 fail · \d need labels$/);
    expect(lines.lines).toContain('Products · 2 photos · 2 of its riskiest 2 labelled, 2 wrong · fails');
  });
});
