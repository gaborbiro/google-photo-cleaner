// Labels for tuning the clutter suggestions (developer page dev-clutter.html): the user's verdict on a
// sample of photos, "would it be fine, or wrong, to offer this for the trash?", and for clutter which
// kind. They are about the outcome, not how the matcher works, so they stay valid whatever is changed;
// the lab (clutterLab.ts) scores every change against them. Kept in this browser and in the git-ignored
// lab folder only.

import { axisOutcome, formOutcome } from './clutterAxes';
import type { AxisCategory, AxisCounts, AxisMatch, AxisSettings, PairException, ScoredAxis } from './clutterAxes';
import { weightedScores, type ClutterPhoto, type ScoredCategory } from './clutter';

/** keep: wrong to offer. clutter: fine to offer. unsure: counts for nothing. */
export type LabelVerdict = 'keep' | 'clutter' | 'unsure';

export interface PhotoLabel {
  verdict: LabelVerdict;
  /** For clutter: the clutter category's id it is, OTHER_KIND when none fits, or null when not given. */
  kind: string | null;
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
    if (typeof l !== 'object' || l === null || (l.verdict !== 'keep' && l.verdict !== 'clutter' && l.verdict !== 'unsure') || !(l.kind === null || typeof l.kind === 'string')) throw new Error(`A label kept can’t be read (${key.slice(0, 6)}…)`);
    if (l.verdict !== 'clutter' && l.kind !== null) throw new Error('A label kept gives a kind of clutter to a photo that isn’t clutter');
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
  /** Per clutter category and form: its riskiest offered photos (smallest leads), and its just missed. */
  edge: number;
  justMissed: number;
  /** Photos offered nowhere and kept by nothing ("neither"). */
  neither: number;
  /** Any photo of the library: what shows how much clutter is missed altogether. */
  random: number;
}

export const SAMPLE_SIZES: SampleSizes = { edge: 8, justMissed: 6, neither: 40, random: 150 };

/**
 * The photos to label, in a shuffled order (the same for the same [seed]): each category's edge and just
 * missed, some of "neither", and a random sample of the library; only photos that may be trashed (others
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
    for (const p of [...c.trashable].sort((a, b) => a.lead - b.lead).filter((p) => open(p.mediaKey)).slice(0, sizes.edge)) chosen.add(p.mediaKey);
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

/** The suggestions [matches] make, scored against [labels]: per category, what it offers rightly, harmlessly and wrongly, and what it misses. */
export function scoreLabels(matches: AxisMatch[], categories: readonly AxisCategory[], exceptions: readonly PairException[], photos: Map<string, ClutterPhoto>, labels: Labels): LabelScores {
  const clutterIds = categories.filter((c) => c.verdict === 'clutter' && c.axis !== 'baseline');
  const scores = new Map(clutterIds.map((c) => [c.id, { id: c.id, label: c.label, right: 0, harmless: 0, wrong: 0, missed: 0 }]));
  const total: Omit<LabelScores, 'categories'> = { offered: 0, wrong: 0, clutter: 0, found: 0, otherKind: 0, judged: 0 };
  for (const m of matches) {
    const label = labels[m.mediaKey];
    const photo = photos.get(m.mediaKey);
    if (!label || label.verdict === 'unsure' || !photo || !photo.eligible || photo.approved) continue;
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
