// Labels for tuning the clutter suggestions (developer page dev-clutter.html): the user's verdict on a
// sample of photos, "would it be fine, or wrong, to offer this for the trash?", and for clutter which
// kind. They are about the outcome, not how the matcher works, so they stay valid whatever is changed;
// the lab (clutterLab.ts) scores every change against them. Kept in this browser and in the git-ignored
// lab folder only.

import { axisOutcome, formOutcome } from './clutterAxes';
import type { AxisCategory, AxisCounts, AxisMatch, AxisSettings, PairException, ScoredAxis } from './clutterAxes';
import { weightedScores, type CategoryPhoto, type ClutterPhoto, type ScoredCategory } from './clutter';

/**
 * keep: wrong to offer. clutter: fine to offer. unsure: counts for nothing. taste: a matter of taste, kept by
 * some and trashed by others (docs/clutter-rules.md): counts for nothing either, but shows the grey zone.
 */
export type LabelVerdict = 'keep' | 'clutter' | 'unsure' | 'taste';

/**
 * Kinds of clutter the rules call a matter of taste (docs/clutter-rules.md): a photo labelled clutter of
 * one of these kinds counts as taste. Meals and drinks ("food", Food and drink) were labelled clutter
 * before the rules said so (decided 2026-11-22).
 */
export const TASTE_KINDS: readonly string[] = ['food'];

/** Whether a label counts in the scores: keep or clutter, not unsure or taste, nor clutter of a kind that is taste. */
const judged = (label: PhotoLabel | undefined): label is PhotoLabel & { verdict: 'keep' | 'clutter' } =>
  label !== undefined && (label.verdict === 'keep' || (label.verdict === 'clutter' && (label.kind === null || !TASTE_KINDS.includes(label.kind))));

export interface PhotoLabel {
  verdict: LabelVerdict;
  /** For clutter: the clutter category's id it is, OTHER_KIND when none fits, or null when not given. */
  kind: string | null;
  /**
   * Drawn at random from the whole library ([randomSample]), not picked for being a close call: these
   * alone show the library's precision and recall ([labelMetrics]). Absent on labels from the mixed sample.
   */
  random?: true;
}

/** The kind of clutter for which no category fits: shows a category the list is missing. */
export const OTHER_KIND = 'other';

/** Labels by the page's photo key. */
export type Labels = Record<string, PhotoLabel>;

/** Labels as kept ([saveLabels]); refused with the reason when they can't be read, so none are lost silently. */
export function readLabels(text: string | null): Labels {
  if (text === null) return {};
  const saved = JSON.parse(text) as unknown;
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) throw new Error('The labels kept aren’t a set of labels');
  for (const [key, label] of Object.entries(saved as Record<string, unknown>)) {
    const l = label as Partial<PhotoLabel> | null;
    if (typeof l !== 'object' || l === null || (l.verdict !== 'keep' && l.verdict !== 'clutter' && l.verdict !== 'unsure' && l.verdict !== 'taste') || !(l.kind === null || typeof l.kind === 'string')) throw new Error(`A label kept can’t be read (${key.slice(0, 6)}…)`);
    if (l.verdict !== 'clutter' && l.kind !== null) throw new Error('A label kept gives a kind of clutter to a photo that isn’t clutter');
    if (l.random !== undefined && l.random !== true) throw new Error(`A label kept can’t be read (${key.slice(0, 6)}…)`);
  }
  return saved as Labels;
}

export function saveLabels(labels: Labels): string {
  return JSON.stringify(labels);
}

/** The clutter categories (ids) [match] is offered in: by subject and setting, and by form. */
export function offeredIn(match: AxisMatch, categories: readonly AxisCategory[], exceptions: readonly PairException[]): string[] {
  const ids: string[] = [];
  const content = axisOutcome(match, categories, exceptions);
  if (content.verdict === 'clutter') ids.push(categories[content.category!]!.id);
  const form = formOutcome(match, categories);
  if (form.verdict === 'clutter') ids.push(categories[form.category!]!.id);
  return ids;
}

/** The clutter categories and forms, best-scoring for this photo first: the kinds to pick from, the first pre-selected. */
export function kindGuesses(row: Float32Array, scored: ScoredAxis[], settings: AxisSettings): string[] {
  const scores = weightedScores(row, scored as ScoredCategory[], settings);
  return scored
    .map((s, i) => ({ category: s.category, score: scores[i]!.score }))
    .filter((c) => c.category.verdict === 'clutter' && c.category.axis !== 'baseline')
    .sort((a, b) => b.score - a.score)
    .map((c) => c.category.id);
}

/** A small seeded random number generator (mulberry32), so a sample is the same each time for the same seed. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** How many photos of each part the sample takes. */
export interface SampleSizes {
  /** Per clutter category and form: labelled photos wanted at its edge (its [EDGE_SIZE] riskiest), and its just missed. */
  edge: number;
  justMissed: number;
  /** Photos offered nowhere and kept by nothing ("neither"). */
  neither: number;
  /** Any photo of the library: what shows how much clutter is missed altogether. */
  random: number;
}

/**
 * A category's edge: its [EDGE_SIZE] riskiest offered photos (smallest leads), where mistakes bunch up. It
 * passes when at least [EDGE_LABELLED] of them are labelled and at most [EDGE_MAX_WRONG] of those are
 * labelled keep (docs/clutter-rules.md): then the whole category is well above that.
 */
export const EDGE_SIZE = 24;
export const EDGE_LABELLED = 10;
export const EDGE_MAX_WRONG = 1;

const riskiest = (photos: CategoryPhoto[]) => [...photos].sort((a, b) => a.lead - b.lead).slice(0, EDGE_SIZE);
export const SAMPLE_SIZES: SampleSizes = { edge: EDGE_LABELLED, justMissed: 6, neither: 40, random: 150 };

/**
 * The photos to label, in a shuffled order (the same for the same [seed]): each category's edge, topped up
 * to [SampleSizes.edge] labelled, its just missed, some of "neither", and a random sample of the library; only photos that may be trashed (others
 * are never offered), and none labelled already.
 */
export function labelSample(matches: AxisMatch[], counts: AxisCounts, categories: readonly AxisCategory[], exceptions: readonly PairException[], photos: Map<string, ClutterPhoto>, labels: Labels, sizes: SampleSizes, seed: number): string[] {
  const next = random(seed);
  const open = (key: string) => {
    const p = photos.get(key);
    return p !== undefined && p.eligible && !p.approved && labels[key] === undefined;
  };
  const chosen = new Set<string>();
  for (const c of [...counts.forms, ...counts.clutter]) {
    // Its edge topped up to [sizes.edge] labelled: the riskiest of its edge not labelled yet, as many as are missing.
    const edge = riskiest(c.trashable);
    const missing = Math.max(0, sizes.edge - edge.filter((p) => judged(labels[p.mediaKey])).length);
    for (const p of edge.filter((p) => open(p.mediaKey)).slice(0, missing)) chosen.add(p.mediaKey);
    for (const p of c.justMissed.filter((p) => open(p.mediaKey)).slice(0, sizes.justMissed)) chosen.add(p.mediaKey);
  }
  const neither = matches.filter((m) => open(m.mediaKey) && axisOutcome(m, categories, exceptions).verdict === 'none' && formOutcome(m, categories).verdict !== 'clutter').map((m) => m.mediaKey);
  for (const key of shuffled(neither, next).slice(0, sizes.neither)) chosen.add(key);
  for (const key of shuffled(matches.map((m) => m.mediaKey).filter(open), next).slice(0, sizes.random)) chosen.add(key);
  return shuffled([...chosen], next);
}

/** How one clutter category does against the labels. */
export interface CategoryScore {
  id: string;
  label: string;
  /** Labelled photos offered here: right (clutter of this kind, or kind not given), harmless (clutter of another kind), wrong (keep). */
  right: number;
  harmless: number;
  wrong: number;
  /** Labelled as clutter of this kind, and offered nowhere. */
  missed: number;
}

export interface LabelScores {
  categories: CategoryScore[];
  /** Labelled photos offered somewhere, and how many of them are wrong (keep). */
  offered: number;
  wrong: number;
  /** Labelled clutter, and how much of it is offered somewhere: what the list finds. */
  clutter: number;
  found: number;
  /** Clutter labelled "other": kinds the list has no category for. */
  otherKind: number;
  /** Photos labelled keep or clutter (unsure counts for nothing). */
  judged: number;
}

/**
 * The labelled photos to look at: offered though labelled keep ([wrong]), and labelled clutter offered
 * nowhere ([missed], by the kind given: a category's id, OTHER_KIND, or "unspecified").
 */
export function labelExamples(matches: AxisMatch[], categories: readonly AxisCategory[], exceptions: readonly PairException[], photos: Map<string, ClutterPhoto>, labels: Labels): { wrong: string[]; missed: Record<string, string[]> } {
  const wrong: string[] = [];
  const missed: Record<string, string[]> = {};
  for (const m of matches) {
    const label = labels[m.mediaKey];
    const photo = photos.get(m.mediaKey);
    if (!judged(label) || !photo || !photo.eligible || photo.approved) continue;
    const offered = offeredIn(m, categories, exceptions).length > 0;
    if (label.verdict === 'keep' && offered) wrong.push(m.mediaKey);
    if (label.verdict === 'clutter' && !offered) (missed[label.kind ?? 'unspecified'] ??= []).push(m.mediaKey);
  }
  return { wrong, missed };
}

/** The suggestions [matches] make, scored against [labels]: per category, what it offers rightly, harmlessly and wrongly, and what it misses. */
export function scoreLabels(matches: AxisMatch[], categories: readonly AxisCategory[], exceptions: readonly PairException[], photos: Map<string, ClutterPhoto>, labels: Labels): LabelScores {
  const clutterIds = categories.filter((c) => c.verdict === 'clutter' && c.axis !== 'baseline');
  const scores = new Map(clutterIds.map((c) => [c.id, { id: c.id, label: c.label, right: 0, harmless: 0, wrong: 0, missed: 0 }]));
  const total: Omit<LabelScores, 'categories'> = { offered: 0, wrong: 0, clutter: 0, found: 0, otherKind: 0, judged: 0 };
  for (const m of matches) {
    const label = labels[m.mediaKey];
    const photo = photos.get(m.mediaKey);
    if (!judged(label) || !photo || !photo.eligible || photo.approved) continue;
    total.judged++;
    const offered = offeredIn(m, categories, exceptions);
    if (offered.length > 0) total.offered++;
    if (label.verdict === 'keep') {
      if (offered.length > 0) total.wrong++;
      for (const id of offered) scores.get(id)!.wrong++;
      continue;
    }
    total.clutter++;
    if (label.kind === OTHER_KIND) total.otherKind++;
    if (offered.length > 0) total.found++;
    for (const id of offered) {
      const s = scores.get(id)!;
      if (label.kind === null || label.kind === id) s.right++;
      else s.harmless++;
    }
    // Missed in its own category; a kind the list no longer has (labelled before a category was taken out) counts only in the totals.
    const own = offered.length === 0 && label.kind !== null ? scores.get(label.kind) : undefined;
    if (own) own.missed++;
  }
  return { categories: [...scores.values()], ...total };
}

/**
 * The next [size] photos of the library in a fixed random order (the same for the same [seed]), only those
 * that may be trashed, past those already labelled as random. Photos labelled before in the mixed sample
 * are not skipped, which would leave the close calls out and flatter the list: they come back in [reused],
 * to be marked random with the verdict already given, and only the rest in [queue], to be labelled.
 */
export function randomSample(matches: AxisMatch[], photos: Map<string, ClutterPhoto>, labels: Labels, size: number, seed: number): { queue: string[]; reused: string[] } {
  const open = (key: string) => {
    const p = photos.get(key);
    return p !== undefined && p.eligible && !p.approved && labels[key]?.random !== true;
  };
  const drawn = shuffled(matches.map((m) => m.mediaKey).filter(open), random(seed)).slice(0, size);
  return { queue: drawn.filter((k) => labels[k] === undefined), reused: drawn.filter((k) => labels[k] !== undefined) };
}

/** How many random photos "Label random photos…" offers at a time. */
export const RANDOM_SAMPLE_SIZE = 100;

/**
 * The labels in three parts: [random], those drawn at random from the library; and [a] and [b], every label
 * split in two halves by its photo (the same photo always in the same half), so a change tuned while
 * looking at one half can be checked on the other.
 */
export function labelParts(labels: Labels): { random: Labels; a: Labels; b: Labels } {
  const parts = { random: {} as Labels, a: {} as Labels, b: {} as Labels };
  for (const [key, label] of Object.entries(labels)) {
    if (label.random) parts.random[key] = label;
    (half(key) === 0 ? parts.a : parts.b)[key] = label;
  }
  return parts;
}

/** 0 or 1 for a photo key, the same every time (FNV-1a). */
function half(key: string): 0 | 1 {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 2) as 0 | 1;
}

/**
 * Precision: of the labelled photos offered, the share that is clutter (safety). Recall: of the labelled
 * clutter, the share offered (usefulness). Null where there is nothing to divide by.
 */
export function labelMetrics(scores: LabelScores): { precision: number | null; recall: number | null } {
  return { precision: scores.offered === 0 ? null : (scores.offered - scores.wrong) / scores.offered, recall: scores.clutter === 0 ? null : scores.found / scores.clutter };
}

/**
 * The developer page's line about the labels: all of them, then the random ones alone: "Labels: 561 judged ·
 * precision 91% (278 of 304 offered) · recall 71% (278 of 389 clutter) · 15 of a kind no category fits ·
 * random photos: 120 judged · precision 96% (24 of 25) · recall 80% (24 of 30)".
 */
export function labelLine(all: LabelScores, random: LabelScores): string {
  const part = (s: LabelScores) => {
    const { precision, recall } = labelMetrics(s);
    const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
    return `${s.judged.toLocaleString()} judged · precision ${pct(precision)} (${s.offered - s.wrong} of ${s.offered} offered) · recall ${pct(recall)} (${s.found} of ${s.clutter} clutter)`;
  };
  const other = all.otherKind > 0 ? ` · ${all.otherKind} of a kind no category fits` : '';
  return `Labels: ${part(all)}${other} · random photos: ${random.judged === 0 ? 'none yet (Label random photos…)' : part(random)}`;
}

/** The labels scored two ways: [random], those drawn at random (the fair measure), and [all]. */
export interface LabelScorePair {
  all: LabelScores;
  random: LabelScores;
}

const pct1 = (x: number | null) => (x === null ? '–' : `${(Math.round(x * 1000) / 10).toFixed(1)}%`);

/**
 * The scores in short, for the top of Results: random photos first, the fair measure, then all labels:
 * "Random photos: precision 97.5% · recall 44.3% (266 judged) · all labels: precision 95.5% · recall 64.6% (1,000 judged)".
 * Null with no labels.
 */
export function scoresLine(s: LabelScorePair): string | null {
  if (s.all.judged === 0) return null;
  const part = (x: LabelScores) => {
    const { precision, recall } = labelMetrics(x);
    return `precision ${pct1(precision)} · recall ${pct1(recall)} (${x.judged.toLocaleString()} judged)`;
  };
  const random = s.random.judged === 0 ? 'Random photos: none labelled yet' : `Random photos: ${part(s.random)}`;
  return `${random} · all labels: ${part(s.all)}`;
}

/**
 * What a change does to the scores, for a Save popup: "Random photos: precision 94.9% → 97.5% · recall
 * 42.0% → 44.3% · all labels: precision 90.6% → 95.5% · recall 59.1% → 64.6%". Null with no labels.
 */
export function scoresChange(before: LabelScorePair, after: LabelScorePair): string | null {
  if (before.all.judged === 0) return null;
  const part = (b: LabelScores, a: LabelScores) => {
    const [mb, ma] = [labelMetrics(b), labelMetrics(a)];
    const step = (x: number | null, y: number | null) => (pct1(x) === pct1(y) ? `${pct1(y)} (no change)` : `${pct1(x)} → ${pct1(y)}`);
    return `precision ${step(mb.precision, ma.precision)} · recall ${step(mb.recall, ma.recall)}`;
  };
  const random = before.random.judged === 0 ? 'Random photos: none labelled yet' : `Random photos: ${part(before.random, after.random)}`;
  return `${random} · all labels: ${part(before.all, after.all)}`;
}

/** What "Copy scores" reports: the list and settings it was scored with, and the scores. */
export interface ScoresReportInput {
  version: string;
  /** Photos matched, and the page's totals line ("Clutter 1,862 (10%) · …"). */
  matched: number;
  totals: string;
  /** How the list differs from the shipped one, one line each (Copy changes). */
  changes: string[];
  scoring: 'raw' | 'evened';
  settings: AxisSettings;
  all: LabelScores;
  random: LabelScores;
  edge: EdgeScore[];
}

/**
 * The scores as text to paste into a message, for someone who labelled their own library: only numbers, the
 * list's own words and the settings, never a photo key, address or label. Per category: offered rightly,
 * clutter of another kind, wrongly (labelled keep), and missed. The random photos first: they are the fair test.
 */
export function scoresReport(r: ScoresReportInput): string {
  const byCategory = (s: LabelScores) => {
    const rows = s.categories.filter((c) => c.right + c.harmless + c.wrong + c.missed > 0);
    return rows.length === 0 ? ['- none'] : rows.map((c) => `- ${c.label}: ${c.right} right · ${c.harmless} another kind · ${c.wrong} wrong · ${c.missed} missed`);
  };
  const edge = edgeLines(r.edge);
  return [
    `Photo Cleaner clutter scores · version ${r.version} · numbers only: no photos, photo keys or labels`,
    `Library: ${r.matched.toLocaleString()} photos matched · ${r.totals}`,
    r.changes.length === 0 ? 'List: the shipped list' : `List: ${r.changes.length} changes from the shipped list`,
    ...r.changes.map((l) => `- ${l}`),
    `Settings (${r.scoring === 'raw' ? 'raw scores' : 'evened out'}): ${JSON.stringify(r.settings)}`,
    labelLine(r.all, r.random),
    `Other clutter, no category fits: ${r.random.otherKind} random · ${r.all.otherKind} in all`,
    'Random photos by category (offered: right · another kind · wrong; missed):',
    ...byCategory(r.random),
    'All labels by category:',
    ...byCategory(r.all),
    edge.summary,
    ...edge.lines.map((l) => `- ${l}`),
  ].join('\n');
}

/** A clutter category or form at its edge: how many photos it offers, how many of its edge are labelled, how many of those wrongly. */
export interface EdgeScore {
  id: string;
  label: string;
  photos: number;
  labelled: number;
  wrong: number;
  /** pass: enough labelled, few enough wrong; fail: too many wrong; unlabelled: fewer than [EDGE_LABELLED] labelled yet. */
  state: 'pass' | 'fail' | 'unlabelled';
}

/** Every clutter category and form at its edge, largest first. */
export function edgeScores(counts: AxisCounts, labels: Labels): EdgeScore[] {
  return [...counts.forms, ...counts.clutter]
    .map((c) => {
      const labelled = riskiest(c.trashable).filter((p) => judged(labels[p.mediaKey]));
      const wrong = labelled.filter((p) => labels[p.mediaKey]!.verdict === 'keep').length;
      const state: EdgeScore['state'] = wrong > EDGE_MAX_WRONG ? 'fail' : labelled.length < Math.min(EDGE_LABELLED, c.trashable.length) || labelled.length === 0 ? 'unlabelled' : 'pass';
      return { id: c.category.id, label: c.category.label, photos: c.trashable.length, labelled: labelled.length, wrong, state };
    })
    .sort((a, b) => b.photos - a.photos);
}

/** The edge in words, for the page: "Edge: 10 pass · 6 fail · 5 need labels", then a line per category. */
export function edgeLines(scores: EdgeScore[]): { summary: string; lines: string[] } {
  const n = (state: EdgeScore['state']) => scores.filter((s) => s.state === state).length;
  const word = { pass: 'passes', fail: 'fails', unlabelled: 'needs labels' };
  return {
    summary: `Edge (each category's ${EDGE_SIZE} riskiest, at most ${EDGE_MAX_WRONG} wrong of ${EDGE_LABELLED}+ labelled): ${n('pass')} pass · ${n('fail')} fail · ${n('unlabelled')} need labels`,
    lines: scores.map((s) => `${s.label} · ${s.photos.toLocaleString()} photos · ${s.labelled} of its riskiest ${Math.min(EDGE_SIZE, s.photos)} labelled, ${s.wrong} wrong · ${word[s.state]}`),
  };
}
