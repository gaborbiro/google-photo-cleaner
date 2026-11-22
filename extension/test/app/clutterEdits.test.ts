import { describe, expect, it } from 'vitest';
import { apart, axisBreakdown, kindOf, STARTING_AXIS_SETTINGS, STARTING_AXIS_TUNING, type AxisCategory, type Axis, type ScoredAxis, type Verdict } from '../../src/app/search/clutterAxes';
import {
  addAxisCategory,
  addDescription,
  draftHeading,
  draftOf,
  draftWeights,
  draftProblems,
  floorHint,
  isShipped,
  withBaseline,
  withCardSettings,
  listChanges,
  listOf,
  moveDescription,
  removeCategory,
  removeDescription,
  renameCategory,
  rewordDescription,
  setVerdict,
  settingsForList,
  tuningEdits,
  weightEdits,
  weightLabel,
  weightReworded,
  type DraftWeights,
} from '../../src/app/search/clutterEdits';

const cat = (id: string, label: string, axis: Axis, verdict: Verdict, descriptions: string[]): AxisCategory => ({ id, label, kind: kindOf(verdict), axis, verdict, descriptions });
const screens = cat('screens', 'Screen photos', 'subject', 'clutter', ['a screenshot of an app', 'a photo of a TV screen']);
const memes = cat('memes', 'Memes', 'subject', 'clutter', ['a meme with text']);
const people = cat('people', 'People', 'subject', 'keep', ['a selfie', 'a portrait of a person']);
const shops = cat('shops', 'Shops', 'setting', 'neutral', ['inside a shop']);
const list: AxisCategory[] = [screens, memes, people, shops];
const at = (more: Partial<DraftWeights> = {}): DraftWeights => ({ categoryWeights: {}, descriptionWeights: {}, margins: {}, ...more });

describe('editing the list of subjects and settings', () => {
  it('makes no change by drafting and reading back', () => {
    expect(listOf(draftOf(list))).toEqual({ list, renames: {} });
    expect(isShipped(listOf(draftOf(list)).list, list)).toBe(true);
    expect(listChanges(list, list)).toEqual([]);
  });

  it('adds, rewords, moves and removes descriptions; a reworded one is named so its weight follows', () => {
    let draft = draftOf(list);
    draft = addDescription(draft, 'memes', '  a funny picture  ');
    draft = rewordDescription(draft, 'screens', 0, 'a screenshot of a phone app');
    draft = moveDescription(draft, 'screens', 1, 'people');
    draft = removeDescription(draft, 'people', 1);
    const { list: edited, renames } = listOf(draft);
    expect(edited.map((c) => c.descriptions)).toEqual([['a screenshot of a phone app'], ['a meme with text', 'a funny picture'], ['a selfie', 'a photo of a TV screen'], ['inside a shop']]);
    expect(renames).toEqual({ 'a screenshot of an app': 'a screenshot of a phone app' });
    expect(listChanges(list, edited)).toEqual([
      'Added “a screenshot of a phone app” to Screen photos',
      'Added “a funny picture” to Memes',
      'Moved “a photo of a TV screen” from Screen photos to People',
      'Removed “a screenshot of an app” from Screen photos',
      'Removed “a portrait of a person” from People',
    ]);
    // Moving to its own category changes nothing.
    expect(moveDescription(draft, 'people', 0, 'people')).toBe(draft);
  });

  it('adds, renames, gives a verdict to and removes categories; a new one goes at the end of its axis with an id of its own', () => {
    let draft = draftOf(list);
    draft = addAxisCategory(draft, 'Faces', 'subject', 'keep');
    draft = addAxisCategory(draft, 'Faces', 'setting', 'clutter');
    expect(draft.map((c) => c.id)).toEqual(['screens', 'memes', 'people', 'custom-faces', 'shops', 'custom-faces-2']);
    draft = addDescription(draft, 'custom-faces', 'a face');
    draft = removeCategory(draft, 'custom-faces-2');
    draft = renameCategory(draft, 'memes', 'Memes and forwarded images');
    draft = setVerdict(draft, 'memes', 'neutral');
    draft = removeCategory(draft, 'screens');
    const edited = listOf(draft).list;
    expect(edited.map((c) => [c.id, c.label, c.verdict, c.kind])).toEqual([
      ['memes', 'Memes and forwarded images', 'neutral', 'counterweight'],
      ['people', 'People', 'keep', 'counterweight'],
      ['custom-faces', 'Faces', 'keep', 'counterweight'],
      ['shops', 'Shops', 'neutral', 'counterweight'],
    ]);
    expect(listChanges(list, edited)).toEqual([
      'Renamed Memes to Memes and forwarded images',
      'Memes and forwarded images is now neutral',
      'Added subject Faces (keep)',
      'Removed category Screen photos',
      'Added “a face” to Faces',
    ]);
    expect(() => removeCategory(draft, 'gone')).toThrow('No category gone');
    expect(() => removeDescription(draft, 'people', 9)).toThrow('No description 9 in People');
  });

  it('names what must be put right before saving, and puts nothing right itself', () => {
    let draft = draftOf(list);
    expect(draftProblems(draft)).toEqual([]);
    draft = addDescription(draft, 'memes', 'A selfie');
    draft = addDescription(draft, 'memes', '   ');
    draft = addAxisCategory(draft, 'People', 'subject', 'keep');
    draft = renameCategory(draft, 'screens', ' ');
    draft = addAxisCategory(draft, 'Any photo', 'baseline', 'keep');
    draft = addDescription(draft, 'custom-any-photo', 'a photo');
    expect(draftProblems(draft)).toEqual([
      'A category has no name.',
      'Memes has an empty description.',
      '“a selfie” is in both Memes and People.',
      'People has no descriptions.',
      'Any photo is a baseline, which decides nothing: make it neutral.',
      '2 categories are named “People”.',
    ]);
    expect(draftProblems(draftOf([screens, people]))).toEqual(['The list needs at least one setting.']);
    expect(draftProblems(draftOf([people, shops]))).toEqual(['The list needs at least one clutter category.']);
  });

  it('carries weights over to reworded descriptions and drops what is no longer in the list', () => {
    const settings = at({ categoryWeights: { screens: 0.01, people: 0.02 }, margins: { screens: 0.04 }, descriptionWeights: { 'a screenshot of an app': -0.01, 'a selfie': 0.03 } });
    let draft = rewordDescription(draftOf(list), 'screens', 0, 'a screenshot of a phone app');
    draft = removeCategory(draft, 'people');
    draft = addAxisCategory(draft, 'Faces', 'subject', 'keep');
    draft = addDescription(draft, 'custom-faces', 'a face');
    const { list: edited, renames } = listOf(draft);
    expect(settingsForList(settings, edited, renames)).toEqual(at({ categoryWeights: { screens: 0.01 }, margins: { screens: 0.04 }, descriptionWeights: { 'a screenshot of a phone app': -0.01 } }));
  });

  it('heads a collapsed category with its name, verdict and number of descriptions', () => {
    const draft = draftOf(list);
    expect(draftHeading(draft[0]!)).toBe('Screen photos · clutter · 2 descriptions');
    expect(draftHeading(draft[1]!)).toBe('Memes · clutter · 1 description');
    const added = addAxisCategory(draft, '  ', 'setting', 'keep');
    expect(draftHeading(added.find((c) => c.descriptions.length === 0)!)).toBe('No name yet · keep · 0 descriptions');
  });

  it('edits weights with the list: a reworded description takes its weight along', () => {
    const weights = draftWeights({ ...at({ categoryWeights: { people: 0.02 }, margins: { screens: 0.04 }, descriptionWeights: { 'a selfie': 0.03 } }) });
    expect(weights).toEqual({ categoryWeights: { people: 0.02 }, margins: { screens: 0.04 }, descriptionWeights: { 'a selfie': 0.03 } });
    expect(weightReworded(weights, 'a selfie', 'a selfie with a phone').descriptionWeights).toEqual({ 'a selfie with a phone': 0.03 });
    // No weight to take along, or the same words: nothing changes.
    expect(weightReworded(weights, 'a portrait of a person', 'a portrait')).toBe(weights);
    expect(weightReworded(weights, 'a selfie', 'a selfie')).toBe(weights);
    expect(weightLabel(0.03)).toBe('+0.030');
    expect(weightLabel(-0.01)).toBe('−0.010');
    expect(weightLabel(0)).toBeNull();
    expect(weightLabel(undefined)).toBeNull();
  });

  it('adds a baseline for the floor, moving “a photo” there from wherever it was, and says why the floor can’t be turned on', () => {
    // "a photo" added to People, where the floor doesn't read it.
    const misplaced = listOf(addDescription(draftOf(list), 'people', 'a photo')).list;
    expect(floorHint(misplaced)).toBe('“a photo” is in People, a subject, where it counts as one of its descriptions. The floor needs a category on the baseline side (in Edit, Add with “baseline” chosen). “Add the baseline” does it for you, moving “a photo” there.');
    const fixed = listOf(withBaseline(draftOf(misplaced))).list;
    expect(fixed.find((c) => c.id === 'people')!.descriptions).toEqual(['a selfie', 'a portrait of a person']);
    expect(fixed.at(-1)).toEqual({ id: 'baseline', label: 'Any photo', kind: 'counterweight', axis: 'baseline', verdict: 'neutral', descriptions: ['a photo'] });
    expect(draftProblems(draftOf(fixed))).toEqual([]);
    expect(floorHint(fixed)).toBeNull();
    // Nowhere in the list: added; a list with a baseline already: unchanged.
    expect(floorHint(list)).toBe('The floor needs a category on the baseline side (in Edit, Add with “baseline” chosen). “Add the baseline” does it for you.');
    expect(listOf(withBaseline(draftOf(list))).list.at(-1)!.descriptions).toEqual(['a photo']);
    const draft = draftOf(fixed);
    expect(withBaseline(draft)).toBe(draft);
  });

  it('says how the weights and minimum leads change, for the summary of what the edits do', () => {
    const before = at({ categoryWeights: { people: 0.02 }, margins: { screens: 0.04 }, descriptionWeights: { 'a selfie': 0.03 } });
    const after = at({ categoryWeights: { people: -0.01 }, margins: { memes: 0.03 }, descriptionWeights: { 'a selfie': 0.03, 'a meme with text': 0.01 } });
    const axisLead = (c: AxisCategory) => (c.axis === 'subject' ? 0.02 : 0.03);
    expect(weightEdits(before, after, list, axisLead)).toEqual([
      "Screen photos minimum lead its axis's 0.02 (was 0.04)",
      "Memes minimum lead 0.03 (was its axis's 0.02)",
      'People weight −0.0100 (was +0.0200)',
      '“a meme with text” +0.0100 (was 0)',
    ]);
    expect(weightEdits(before, before, list, axisLead)).toEqual([]);
  });
});

describe('a verdict changed in the editor, as Save shows it', () => {
  it('scores the photo against the new verdict under "With the edits"', () => {
    // Food made clutter: the scores Save shows hover over a photo come from the saved list, so Food reads as clutter there.
    const food = cat('food', 'Food and drink', 'subject', 'neutral', ['a meal on a plate']);
    const people = cat('people', 'People', 'subject', 'keep', ['a selfie']);
    const home = cat('home', 'Home', 'setting', 'neutral', ['a kitchen']);
    const { list } = listOf(setVerdict(draftOf([food, people, home]), 'food', 'clutter'));
    const scored: ScoredAxis[] = list.map((category) => ({ category, vectors: [Float32Array.from([1])] }));
    const rows = axisBreakdown(Float32Array.from([0.8, 0.5, 0.7]), scored, apart(3), STARTING_AXIS_SETTINGS.raw, [], 3).sides[0]!.rows;
    expect(rows.map((r) => [r.label, r.kind])).toEqual([['Food and drink', 'clutter'], ['People', 'counterweight']]);
  });
});

describe('the Settings card, saved before it counts', () => {
  const raw = STARTING_AXIS_SETTINGS.raw;
  const tuning = (scoring: 'raw' | 'evened', rawSettings = raw) => ({ scoring, settings: { ...STARTING_AXIS_TUNING.settings, raw: rawSettings } });

  it('says what the card changes, one line each, and nothing when it is as applied', () => {
    expect(tuningEdits(STARTING_AXIS_TUNING, STARTING_AXIS_TUNING)).toEqual([]);
    const after = tuning('evened', { ...raw, subject: { ...raw.subject, margin: raw.subject.margin + 0.01 }, pooling: 0, baseline: 0.03 });
    expect(tuningEdits(tuning('raw'), after)).toEqual([
      'Scoring: evened out (was raw scores)',
      `Raw scores: subject minimum lead ${raw.subject.margin + 0.01} (was ${raw.subject.margin})`,
      ...(raw.pooling === 0 ? [] : [`Raw scores: pooling off (was ${raw.pooling})`]),
      `Raw scores: floor 0.03 (was ${raw.baseline ?? 'off'})`,
    ]);
  });

  it('applies only the card, keeping weights a buff or the lab applied meanwhile', () => {
    const draft = tuning('raw', { ...raw, pooling: 0.05, margins: {}, descriptionWeights: {} });
    const meanwhile = tuning('raw', { ...raw, margins: { products: 0.005 }, descriptionWeights: { 'a price tag': 0.01 } });
    const applied = withCardSettings(meanwhile, draft);
    expect(applied.settings.raw).toEqual({ ...raw, pooling: 0.05, margins: { products: 0.005 }, descriptionWeights: { 'a price tag': 0.01 } });
    expect(tuningEdits(meanwhile, applied)).toEqual([`Raw scores: pooling 0.05 (was ${raw.pooling === 0 ? 'off' : raw.pooling})`]);
  });
});
