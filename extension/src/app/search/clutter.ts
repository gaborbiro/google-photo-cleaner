// Suggested searches for clutter (an experiment, shown only on the developer page dev-clutter.html):
// what the subject-and-setting matching (clutterAxes.ts) is built on. Categories described to the AI
// model, every photo's score for every description, evening those scores out over the library, weights,
// and the pieces the page shows a category's photos with. Which photos may be counted at all comes from
// the shared protection rules (LibraryPhoto.eligible).
// A single list, where every photo went to the one category it looked most like, came first; it was
// removed on 2026-11-21 for subject and setting, which did better (see docs/cleanup-roadmap.md).

import { dot } from '../ai/similar';

/** clutter: may be suggested for the trash. counterweight: never suggested (keep, or neutral). */
export type CategoryKind = 'clutter' | 'counterweight';

export interface Category {
  id: string;
  label: string;
  kind: CategoryKind;
  /** Ways of describing it to the AI model; the category scores as its best-matching description. */
  descriptions: string[];
}

/** A category with its descriptions' fingerprints (one per description, in the same order). */
export interface ScoredCategory {
  category: Category;
  vectors: Float32Array[];
}

/** Weights added to scores before photos are compared: a category's to all its descriptions, a description's to it alone. */
export interface Weights {
  categoryWeights: Record<string, number>;
  descriptionWeights: Record<string, number>;
}

/** The weight added to [description] of [category]: its category's and its own. */
function weightOf(weights: Weights, category: Category, description: string): number {
  return (weights.categoryWeights[category.id] ?? 0) + (weights.descriptionWeights[description] ?? 0);
}

/** The weights in [weights] that name no category or description in [categories], e.g. saved before a description was taken out. */
export function unknownWeights(weights: Weights, categories: readonly Category[]): string[] {
  const ids = new Set(categories.map((c) => c.id));
  const descriptions = new Set(categories.flatMap((c) => c.descriptions));
  return [...Object.keys(weights.categoryWeights).filter((id) => !ids.has(id)), ...Object.keys(weights.descriptionWeights).filter((d) => !descriptions.has(d))];
}

/** Refuses weights for what isn't in [categories], and weights that aren't numbers. */
function checkWeights(weights: Weights, categories: readonly Category[]): void {
  const unknown = unknownWeights(weights, categories);
  if (unknown.length > 0) throw new Error(`Weights for what isn't in the list: ${unknown.join(', ')}`);
  for (const w of [...Object.values(weights.categoryWeights), ...Object.values(weights.descriptionWeights)]) {
    if (!Number.isFinite(w)) throw new Error(`A weight isn't a number (${w})`);
  }
}

/** A photo's score for every description, category by category in the order matched against. */
export function descriptionScores(vector: Float32Array, categories: ScoredCategory[]): Float32Array {
  return Float32Array.from(categories.flatMap((c) => c.vectors.map((v) => dot(v, vector))));
}

/**
 * Each description's usual score over the whole library. Some descriptions score higher than others on
 * every photo (a short, vague one like "tools" is close to everything), so raw scores favour them;
 * evened out, a photo scores as how far above a description's average it is, counted in that
 * description's spread (standard deviation).
 */
export interface DescriptionNorms {
  /** Per description, in the order of [descriptionScores]. */
  mean: Float64Array;
  spread: Float64Array;
}

/** The average and spread of every description's scores over [rows], one row per photo. */
export function descriptionNorms(rows: Float32Array[]): DescriptionNorms {
  if (rows.length < 2) throw new Error('Evening out the descriptions needs at least two photos');
  const width = rows[0]!.length;
  const mean = new Float64Array(width);
  for (const row of rows) {
    if (row.length !== width) throw new Error(`Photos were scored against different descriptions (${row.length} and ${width})`);
    for (let i = 0; i < width; i++) mean[i]! += row[i]!;
  }
  for (let i = 0; i < width; i++) mean[i]! /= rows.length;
  const spread = new Float64Array(width);
  for (const row of rows) {
    for (let i = 0; i < width; i++) spread[i]! += (row[i]! - mean[i]!) ** 2;
  }
  for (let i = 0; i < width; i++) {
    spread[i] = Math.sqrt(spread[i]! / rows.length);
    if (!(spread[i]! > 0)) throw new Error(`Description ${i} scores every photo the same, so it can't be evened out`);
  }
  return { mean, spread };
}

/** [row] evened out with [norms]: each score as spreads above its description's average. */
export function evenedRow(row: Float32Array, norms: DescriptionNorms): Float32Array {
  if (row.length !== norms.mean.length) throw new Error(`A photo's scores (${row.length}) don't fit the evened-out averages (${norms.mean.length})`);
  return Float32Array.from(row, (s, i) => (s - norms.mean[i]!) / norms.spread[i]!);
}

/** Every photo's scores evened out over all of them ([descriptionNorms]), by the same keys. */
export function evenedRows(rows: Map<string, Float32Array>): Map<string, Float32Array> {
  const norms = descriptionNorms([...rows.values()]);
  return new Map([...rows].map(([key, row]) => [key, evenedRow(row, norms)]));
}

/** Every description's score for a photo, in the order of [descriptionScores], with its weight added. */
export function weightedDescriptionScores(row: Float32Array, categories: ScoredCategory[], weights: Weights): Float64Array {
  checkWeights(weights, categories.map((c) => c.category));
  const width = categories.reduce((n, c) => n + c.vectors.length, 0);
  if (row.length !== width) throw new Error(`A photo's scores (${row.length}) don't fit the categories' descriptions (${width})`);
  const out = new Float64Array(width);
  let at = 0;
  for (const c of categories) {
    for (let i = 0; i < c.vectors.length; i++, at++) out[at] = row[at]! + weightOf(weights, c.category, c.category.descriptions[i]!);
  }
  return out;
}

/** Where each category's descriptions start in a row of [descriptionScores]. */
export function descriptionStarts(categories: ScoredCategory[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const c of categories) {
    starts.push(at);
    at += c.vectors.length;
  }
  return starts;
}

/**
 * Each category's score for a photo, with the weights added, and the description it scores as (its
 * best): what the subject-and-setting matching ([matchAxes] in clutterAxes.ts) compares.
 */
export function weightedScores(row: Float32Array, categories: ScoredCategory[], weights: Weights): { score: number; description: number }[] {
  const all = weightedDescriptionScores(row, categories, weights);
  const starts = descriptionStarts(categories);
  return categories.map((c, k) => {
    let score = -Infinity;
    let description = -1;
    for (let i = 0; i < c.vectors.length; i++) {
      const s = all[starts[k]! + i]!;
      if (s > score) {
        score = s;
        description = i;
      }
    }
    return { score, description };
  });
}

/** One category's line in a photo's breakdown. */
export interface BreakdownRow {
  label: string;
  /** neutral: a subject or setting with no verdict (clutterAxes.ts). */
  kind: CategoryKind | 'neutral';
  /** With its weight added. */
  score: string;
  /** The description that scored best for this photo, which the category scores as. */
  description: string;
  /** The weight added to [score] ("+0.030"), or null when none. */
  weight: string | null;
  /** Its description's vote in its pool ("0.37", after what it shares with those above), or null when not pooled. */
  vote: string | null;
}

/** How one photo scored, for the developer page's hover card. */
export interface Breakdown {
  heading: string;
  rows: BreakdownRow[];
  /** How many categories scored lower than those shown, or null when all are shown. */
  more: string | null;
}

/** [weights] with [key]'s weight set to [weight], or left out when it is undefined or 0 (no weight). */
export function withWeight(weights: Record<string, number>, key: string, weight: number | undefined): Record<string, number> {
  const rest = Object.fromEntries(Object.entries(weights).filter(([k]) => k !== key));
  return weight === undefined || weight === 0 ? rest : { ...rest, [key]: weight };
}

/** A number typed into a field: undefined when it is empty, null while it isn't a number yet ("-", "0.0x"). */
export function typedNumber(text: string): number | undefined | null {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** raw: a description's score as the AI model gives it. evened: evened out with [DescriptionNorms]. */
export type Scoring = 'raw' | 'evened';

/** What is known about a photo besides its match: the same as Search uses. */
export interface ClutterPhoto {
  eligible: boolean;
  approved: boolean;
}

export interface CategoryPhoto {
  mediaKey: string;
  /** The category's description the photo scored as. */
  description: string;
  score: number;
  /** How far ahead of what it is measured against. */
  lead: number;
}

export interface CategoryCount {
  category: Category;
  /** Counted photos that may be trashed and aren't in the trash queue yet, best match first. */
  trashable: CategoryPhoto[];
  /** Counted, but protected or of unknown status: never suggested. */
  protectedOrUnknown: number;
  /** Counted, but already in the trash queue. */
  approved: number;
  /** Best match here, but not clearly enough: not counted. */
  closeCalls: number;
  /** The close calls that would be trashable if counted, largest lead first: what a smaller minimum lead would add first. */
  justMissed: CategoryPhoto[];
}

/** Description [index] of [category]: the phrase a match scored as, which must be one of its descriptions. */
export function phrase(category: Category | undefined, index: number): string {
  const text = category?.descriptions[index];
  if (text === undefined) throw new Error(`A match names a description that isn't in its category (${category?.id ?? 'no category'}, ${index})`);
  return text;
}

/**
 * The photos the developer page shows from one category, [size] of each, to judge where it goes wrong.
 * [best] and [riskiest] are what Search will show of a suggestion, above and below "Show all"; the other
 * two are for the developer page only.
 */
export interface CategorySamples {
  /** The highest scores. */
  best: CategoryPhoto[];
  /** Counted with the smallest leads, smallest first, not repeating [best]: what a larger minimum lead would drop first. */
  riskiest: CategoryPhoto[];
  /** The lowest scores still counted, not repeating [best]: to compare with [riskiest]. */
  lowestScores: CategoryPhoto[];
  /** Not counted, with the largest leads: what a smaller minimum lead would add first. */
  justMissed: CategoryPhoto[];
}

export function categorySamples(count: CategoryCount, size: number): CategorySamples {
  const all = count.trashable;
  const rest = all.slice(size);
  return {
    best: all.slice(0, size),
    riskiest: [...rest].sort((a, b) => a.lead - b.lead).slice(0, size),
    lowestScores: rest.slice(-size),
    justMissed: count.justMissed.slice(0, size),
  };
}

/**
 * A lead to four places, rounded down, so a lead just under the minimum lead never shows as the
 * minimum (0.01996 is "0.0199", not "0.0200"). The allowance of 0.0000001 keeps 0.0123 from showing as
 * 0.0122 when a score's float32 rounding lands a hair below (0.9 − 0.2 is 0.69999999 in float32).
 */
export function leadText(lead: number): string {
  return (Math.floor(lead * 10_000 + 1e-3) / 10_000).toFixed(4);
}

/** Under a photo: its score and its lead ([leadText]). */
export function photoCaption(photo: CategoryPhoto): string {
  return `${photo.score.toFixed(3)} · lead ${leadText(photo.lead)} · “${photo.description}”`;
}

/**
 * The largest buff offered, per scoring: a keeper that needs more is too far behind to be the reason.
 * Evened-out scores count in spreads, where a lead of 0.7 is ordinary, so their largest is far larger.
 */
export const MAX_BUFFS: Record<Scoring, number> = { raw: 0.2, evened: 3 };

/** [weights] with [by] added to [description]'s weight. */
export function nudged(weights: Record<string, number>, description: string, by: number): Record<string, number> {
  // Rounded to a millionth, so the weight reads as typed ("0.0063", not "0.006300000000000001").
  return withWeight(weights, description, Math.round(((weights[description] ?? 0) + by) * 1e6) / 1e6);
}

/**
 * The smallest amount (rounded up to 0.0001, at most [max]) for which [reached] holds, when more only
 * ever brings it closer; null when [max] isn't enough. Found by halving.
 */
export function smallestStep(reached: (by: number) => boolean, max: number): number | null {
  if (!reached(max)) return null;
  // Not reached at [low], reached at [high].
  let [low, high] = [0, max];
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (reached(middle)) high = middle;
    else low = middle;
  }
  let by = Math.ceil(high * 10_000) / 10_000;
  while (!reached(by)) by += 0.0001;
  return Math.round(by * 10_000) / 10_000;
}

/**
 * Where a photo's hover card starts, from the photo's top (px): level with the photo when it fits below,
 * else lifted just enough to end [margin] above the window's bottom, but never above the window's top.
 */
export function hoverCardTop(photoTop: number, cardHeight: number, windowHeight: number, margin: number): number {
  const overflow = photoTop + cardHeight + margin - windowHeight;
  const lift = Math.min(overflow, photoTop - margin);
  return lift > 0 ? -lift : 0;
}

/** The button under a leaving photo, short: "Stay +0.0123", or "Can’t stay" ([stayTitle] says more). */
export function stayButton(by: number | null): string {
  return by === null ? 'Can’t stay' : `Stay +${by.toFixed(4)}`;
}

/** The Stay button's tooltip: what it raises, and where the photo stays, or why it can't (more than [max] needed). */
export function stayTitle(by: number | null, description: string, category: string, max: number): string {
  return by === null
    ? `“${description}” would need more than +${max} for this photo to stay in ${category}`
    : `+${by.toFixed(4)} to “${description}”: just enough for this photo to stay in ${category}; it applies to every photo`;
}

/** One description's weight changed, by how much. */
export interface WeightChange {
  description: string;
  by: number;
}

/** The description weights that differ between [before] and [after], by how much (to a millionth), in the order of [categories]. */
export function weightChanges(before: Pick<Weights, 'descriptionWeights'>, after: Pick<Weights, 'descriptionWeights'>, categories: readonly Category[]): WeightChange[] {
  return categories.flatMap((c) => c.descriptions).flatMap((description) => {
    const by = Math.round(((after.descriptionWeights[description] ?? 0) - (before.descriptionWeights[description] ?? 0)) * 1e6) / 1e6;
    return by === 0 ? [] : [{ description, by }];
  });
}

/** What a change does, in parts the popup shows on lines of their own. */
export interface ChangeSummary {
  /** The change: '+0.0071 to “a selfie” (People)', or the edits to the list. */
  what: string;
  /** '491 photos leave the suggestions'. */
  leave: string;
  /** Where they leave from: 'Screen photos 65 · Products 161', or null when none leave. */
  leaveFrom: string | null;
  /** '20 photos join the suggestions', or null when none join. */
  join: string | null;
  /** Where they join: 'Screen photos 18 · Memes and forwarded images 2', or null when none join. */
  joinTo: string | null;
  /** '24 move between them', or null when none move. */
  move: string | null;
}

/** A piece of a caption, with the kind of category it names (null when it names none), so the page can colour keepers. */
export interface CaptionPart {
  text: string;
  kind: CategoryKind | 'neutral' | null;
  /** A description: shown apart, as everywhere on the developer page. */
  term?: boolean;
  /** Shown bold: where a photo goes ("Products → kept (People)"). */
  strong?: boolean;
}

/** One line per category for the page. */
export function countLine(c: CategoryCount): string {
  const extras = [
    c.protectedOrUnknown > 0 ? `${c.protectedOrUnknown} protected or unknown` : null,
    c.approved > 0 ? `${c.approved} already in the trash queue` : null,
    c.closeCalls > 0 ? `${c.closeCalls} close calls not counted` : null,
  ].filter((x) => x !== null);
  return `${c.category.label} · ${c.trashable.length}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`;
}
