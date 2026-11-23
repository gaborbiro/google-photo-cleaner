import { describe, expect, it } from 'vitest';
import { AXIS_LIST, STARTING_AXIS_TUNING, countAxes, kindOf, matchAxes, apart, PLAIN_AXIS_SETTINGS, STARTING_AXIS_SETTINGS, type AxisCategory, type ScoredAxis } from '../../src/app/search/clutterAxes';
import { labCategoryLines, labRefusal, labReviewIds, labTarget, readLabRequest } from '../../src/app/search/clutterLab';

const v = (...xs: number[]) => Float32Array.from(xs);
const cat = (id: string, axis: 'subject' | 'setting', verdict: 'clutter' | 'keep' | 'neutral', descriptions: string[]): AxisCategory => ({ id, label: id[0]!.toUpperCase() + id.slice(1), kind: kindOf(verdict), axis, verdict, descriptions });

describe('the lab folder: requests an agent writes for the developer page', () => {
  it('reads a request, with what it leaves out kept as it is', () => {
    expect(readLabRequest('{"id":"r1"}')).toEqual({ request: { id: 'r1', list: null, scoring: null, settings: null, apply: false, review: [], labelSheets: false } });
    const full = { id: 'r2', scoring: 'raw', settings: { margins: { screenshots: 0.03 } }, apply: true, review: 'all', labelSheets: true, list: AXIS_LIST };
    expect(readLabRequest(JSON.stringify(full))).toEqual({ request: full });
  });

  it('refuses what it can’t use, and says why', () => {
    const problem = (text: string) => (readLabRequest(text) as { problem: string }).problem;
    expect(problem('not json')).toMatch(/^request\.json isn't JSON/);
    expect(problem('[]')).toBe('request.json needs an "id" of letters, digits, ".", "-" or "_"');
    expect(problem('{"id":"../x"}')).toBe('request.json needs an "id" of letters, digits, ".", "-" or "_"');
    expect(problem('{"id":"r","scoring":"cooked"}')).toBe('"scoring" must be "raw" or "evened"');
    expect(problem('{"id":"r","settings":[1]}')).toBe('"settings" must be an object of settings fields');
    expect(problem('{"id":"r","apply":"yes"}')).toBe('"apply" must be true or false');
    expect(problem('{"id":"r","labelSheets":1}')).toBe('"labelSheets" must be true or false');
    expect(problem('{"id":"r","review":"some"}')).toBe('"review" must be "all" or a list of category ids');
    expect(problem('{"id":"r","list":[]}')).toBe('"list" must be a list like AXIS_LIST: { categories, exceptions }');
  });

  it('works out the list and tuning asked for, checked as the page checks what it keeps', () => {
    const r = (json: object) => (readLabRequest(JSON.stringify({ id: 'r', ...json })) as { request: Parameters<typeof labTarget>[0] }).request;
    // A setting of the scoring asked for, the others as they were.
    const target = labTarget(r({ scoring: 'evened', settings: { margins: { products: 0.1 }, pooling: 0.3 } }), AXIS_LIST, STARTING_AXIS_TUNING);
    expect(target).toMatchObject({ list: AXIS_LIST, notes: [], tuning: { scoring: 'evened', settings: { raw: STARTING_AXIS_SETTINGS.raw, evened: { ...STARTING_AXIS_SETTINGS.evened, margins: { products: 0.1 }, pooling: 0.3 } } } });
    // A list with a description gone: its weight is dropped, and named.
    const fewer = { categories: AXIS_LIST.categories.map((c) => (c.id === 'parcels' ? { ...c, descriptions: ['a cardboard delivery box'] } : c)), exceptions: [] };
    const tuned = { ...STARTING_AXIS_TUNING, settings: { ...STARTING_AXIS_TUNING.settings, raw: { ...STARTING_AXIS_SETTINGS.raw, descriptionWeights: { 'a shipping label on a parcel': 0.01 } } } };
    expect(labTarget(r({ list: fewer }), AXIS_LIST, tuned)).toMatchObject({ list: fewer, notes: ['Dropped the raw weight for “a shipping label on a parcel”, no longer in the list.'] });
    // A list the page couldn't keep, and settings that aren't numbers: refused.
    expect(labTarget(r({ list: { categories: [], exceptions: [] } }), AXIS_LIST, STARTING_AXIS_TUNING)).toEqual({ problem: expect.stringContaining('The list needs at least one subject.') });
    expect(labTarget(r({ settings: { pooling: 'lots' } }), AXIS_LIST, STARTING_AXIS_TUNING)).toEqual({ problem: 'The saved settings have no number for pooling' });
  });

  it('counts every category before and after, and picks the categories to review', () => {
    const products = cat('products', 'subject', 'clutter', ['a product on a shelf']);
    const people = cat('people', 'subject', 'keep', ['a selfie']);
    const shops = cat('shops', 'setting', 'neutral', ['a supermarket aisle']);
    const list = [products, people, shops];
    const scored: ScoredAxis[] = list.map((category, i) => ({ category, vectors: [v(...list.map((_, j) => (i === j ? 1 : 0)))] }));
    const rows: [string, Float32Array][] = [['a', v(0.7, 0.4, 0.6)], ['b', v(0.62, 0.6, 0.6)]];
    const photos = new Map(rows.map(([k]) => [k, { eligible: true, approved: false }]));
    const count = (margin: number) => countAxes(rows.map(([k, row]) => matchAxes(k, row, scored, apart(3), { ...PLAIN_AXIS_SETTINGS.raw, subject: { minScore: 0, margin } })), list, [], photos, PLAIN_AXIS_SETTINGS.raw);
    // b: Products 0.62, People 0.60. With a minimum lead of 0.05 People is heard and keeps it; with 0.01, Products counts.
    expect(labCategoryLines(count(0.05), count(0.01))).toEqual([
      { id: 'products', label: 'Products', axis: 'subject', verdict: 'clutter', before: 1, after: 2, closeCallsAfter: 0 },
      { id: 'people', label: 'People', axis: 'subject', verdict: 'keep', before: 1, after: 0, closeCallsAfter: 0 },
    ]);
    expect(labReviewIds('all', count(0.01))).toEqual(['products']);
    expect(labReviewIds(['products'], count(0.01))).toEqual(['products']);
    expect(() => labReviewIds(['people'], count(0.01))).toThrow('"review" names what isn\'t a clutter category or form: people');
    expect(labRefusal('r9', ['why'])).toMatchObject({ id: 'r9', state: 'refused', problems: ['why'], applied: false });
  });
});
