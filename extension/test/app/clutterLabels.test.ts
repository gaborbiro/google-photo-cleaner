import { describe, expect, it } from 'vitest';
import { apart, countAxes, kindOf, matchAxes, STARTING_AXIS_SETTINGS, type AxisCategory, type ScoredAxis } from '../../src/app/search/clutterAxes';
import { kindGuesses, labelSample, OTHER_KIND, offeredIn, readLabels, saveLabels, scoreLabels, type Labels } from '../../src/app/search/clutterLabels';

const v = (...xs: number[]) => Float32Array.from(xs);
const cat = (id: string, axis: 'subject' | 'setting' | 'form', verdict: 'clutter' | 'keep' | 'neutral', descriptions: string[]): AxisCategory => ({ id, label: id[0]!.toUpperCase() + id.slice(1), kind: kindOf(verdict), axis, verdict, descriptions });
// Subjects: Products, Receipts (clutter), People (keep). Setting: Shops (neutral). Form: Screenshots (clutter), Photos (neutral).
const list = [cat('products', 'subject', 'clutter', ['a price tag']), cat('receipts', 'subject', 'clutter', ['a receipt']), cat('people', 'subject', 'keep', ['a selfie']), cat('shops', 'setting', 'neutral', ['inside a shop']), cat('screenshots', 'form', 'clutter', ['a phone screenshot']), cat('photos', 'form', 'neutral', ['a photo'])];
const scored: ScoredAxis[] = list.map((category, i) => ({ category, vectors: [v(...list.map((_, j) => (i === j ? 1 : 0)))] }));
const settings = STARTING_AXIS_SETTINGS.raw;
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

  it('guesses the kind of clutter, best-scoring first, clutter categories and forms only', () => {
    expect(kindGuesses(rows[1]![1], scored, settings)).toEqual(['receipts', 'products', 'screenshots']);
    expect(kindGuesses(rows[3]![1], scored, settings)[0]).toBe('screenshots');
  });

  it('keeps labels and reads them back, refusing what it can’t read', () => {
    const labels: Labels = { tag: { verdict: 'clutter', kind: 'products' }, selfie: { verdict: 'keep', kind: null } };
    expect(readLabels(saveLabels(labels))).toEqual(labels);
    expect(readLabels(null)).toEqual({});
    expect(() => readLabels('[]')).toThrow('aren’t a set of labels');
    expect(() => readLabels('{"x":{"verdict":"maybe","kind":null}}')).toThrow('can’t be read');
    expect(() => readLabels('{"x":{"verdict":"keep","kind":"products"}}')).toThrow('isn’t clutter');
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
  });
});
