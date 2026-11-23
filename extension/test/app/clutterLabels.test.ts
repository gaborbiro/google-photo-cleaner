import { describe, expect, it } from 'vitest';
import { apart, countAxes, kindOf, matchAxes, PLAIN_AXIS_SETTINGS, type AxisCategory, type ScoredAxis } from '../../src/app/search/clutterAxes';
import { edgeLines, edgeScores, kindGuesses, labelExamples, labelLine, labelMetrics, labelParts, labelSample, OTHER_KIND, offeredIn, randomSample, readLabels, saveLabels, scoreLabels, scoresChange, scoresLine, scoresReport, type LabelScores, type Labels } from '../../src/app/search/clutterLabels';

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
    // The photos behind those numbers, to look at: offered though kept, and clutter missed, by its kind.
    expect(labelExamples(matches, list, [], photos, { ...labels, till: { verdict: 'clutter', kind: null } })).toEqual({ wrong: ['shot'], missed: { receipts: ['selfie'], other: ['blur'] } });
    expect(labelExamples(matches, list, [], photos, { vague: { verdict: 'clutter', kind: null }, blur: { verdict: 'clutter', kind: null } }).missed).toEqual({ unspecified: ['blur'] });
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

  it('says precision and recall in short, random photos first, and what a change does to them', () => {
    const score = (offered: number, wrong: number, clutter: number, found: number, judged: number): LabelScores => ({ categories: [], offered, wrong, clutter, found, otherKind: 0, judged });
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
    expect(lines).toContain('Other clutter, no category fits: 0 random · 1 in all');
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
    expect(() => readLabels('{"x":{"verdict":"taste","kind":"products"}}')).toThrow('isn’t clutter');
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
