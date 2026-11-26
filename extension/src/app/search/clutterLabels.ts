// Labels for tuning the clutter suggestions (developer page dev-clutter.html): the user's verdict on a
// sample of photos, "would it be fine, or wrong, to offer this for the trash?", and for clutter which
// kind. They are about the outcome, not how the matcher works, so they stay valid whatever is changed;
// the lab (clutterLab.ts) scores every change against them. Kept in this browser and in the git-ignored
// lab folder only.

import { axisOutcome, checkOutcomes } from './clutterAxes';
import type { AxisCategory, AxisCounts, AxisMatch, AxisSettings, PairException, ScoredAxis, Verdict } from './clutterAxes';
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
  /**
   * What the photo is ([isLabelKind]), for keep or clutter: a category's id, OTHER_KIND when none fits, or null
   * when not given (simple answers, and keep before 2026-11-23). Unsure and taste have none.
   */
  kind: string | null;
  /**
   * Drawn at random from the whole library ([randomSample]), not picked for being a close call: these
   * alone show the library's precision and recall ([labelMetrics]). Absent on labels from the mixed sample.
   */
  random?: true;
  /**
   * Answered again in "Review my random labels" ([reviewQueue]), so the review can stop and pick up where it
   * left off (2026-11-25: the way the labeller answers had changed since the first labels). Only on random labels.
   */
  reviewed?: true;
  /**
   * Not given here but copied from a near-duplicate's label ([withDuplicates]): worked out each time, never
   * kept, so it follows the label it came from. Never random.
   */
  copied?: true;
}

/** Clutter kinds about the shot rather than what it shows (Accidental shots): their labels aren't copied to near-duplicates. */
export const NOT_COPIED_KINDS: readonly string[] = ['accidental'];

/**
 * The labels with each near-duplicate's copied in ([PhotoLabel.copied]): in each moment (photos the Duplicates
 * review groups together, by the shared rules), an unlabelled photo takes the answer and kind of the labelled
 * ones when they all agree; a moment whose labels differ copies nothing. Copies are never random: only the
 * photo drawn counts as drawn at random. The labeller's own labels are never changed.
 */
export function withDuplicates(labels: Labels, moments: readonly (readonly string[])[]): Labels {
  const seen: Labels = { ...labels };
  for (const moment of moments) {
    const own = moment.map((k) => labels[k]).filter((l): l is PhotoLabel => l !== undefined);
    if (own.length === 0) continue;
    const { verdict, kind } = own[0]!;
    if (own.some((l) => l.verdict !== verdict || l.kind !== kind)) continue;
    // About the shot, not what it shows: a blurry frame says nothing of the sharp one beside it. Clutter with
    // no kind might be that too.
    if (verdict === 'clutter' && (kind === null || NOT_COPIED_KINDS.includes(kind))) continue;
    for (const k of moment) if (labels[k] === undefined) seen[k] = { verdict, kind, copied: true };
  }
  return seen;
}

/** [queue] with only the first photo of each moment: one answer covers its near-duplicates ([withDuplicates]). */
export function oneOfEachMoment(queue: readonly string[], moments: readonly (readonly string[])[]): string[] {
  const momentOf = new Map(moments.flatMap((m, i) => m.map((k) => [k, i] as const)));
  const taken = new Set<number>();
  return queue.filter((k) => {
    const m = momentOf.get(k);
    if (m === undefined) return true;
    if (taken.has(m)) return false;
    taken.add(m);
    return true;
  });
}

/** How many labels were copied from near-duplicates, said; null with none. */
export function copiedLine(seen: Labels): string | null {
  const n = Object.values(seen).filter((l) => l.copied).length;
  return n === 0 ? null : `${n.toLocaleString()} more photos take the label of a near-duplicate (the Duplicates review’s moments), not random ones`;
}

/** What a photo is when no category fits: for clutter, shows a category the list is missing. */
export const OTHER_KIND = 'other';

/** Labels by the page's photo key. */
export type Labels = Record<string, PhotoLabel>;

/**
 * A photo's earlier answer on the labelling screen, gone back to: Keep, Clutter or Unsure ([answer], null with
 * none, or for taste, no longer offered); the place of its kind among [kinds], the grid's "what is it?" in order
 * ([chosen], null with no kind or one no longer shown); and where the highlight starts ([at]): on that kind,
 * otherwise on the AI's best guess, [best]. Simple answers have no grid: nothing chosen in it.
 */
export function earlierAnswer(label: PhotoLabel | undefined, kinds: readonly string[], simple = false, best = 0): { answer: 'keep' | 'clutter' | 'unsure' | null; chosen: number | null; at: number } {
  if (!label || label.verdict === 'taste') return { answer: null, chosen: null, at: best };
  const found = simple || label.kind === null ? -1 : kinds.indexOf(label.kind);
  const chosen = found >= 0 ? found : null;
  return { answer: label.verdict, chosen, at: chosen ?? best };
}

/**
 * How the labelling screen asks: 'kinds', what the photo is as well (a grid of every subject, by the AI's
 * guess), recorded with the answer: for tuning, a missed photo's kind says which category should have found it,
 * a keeper offered by mistake which should have kept it; 'simple', only Keep, Clutter or Unsure (precision,
 * recall and the edges need no kind).
 */
export type LabelMode = 'kinds' | 'simple';

/** The grid's highlight moved by an arrow key, by row and column, staying inside it: 0 to [count] − 1, [columns] to a row. */
export function moveInGrid(at: number, arrow: 'up' | 'down' | 'left' | 'right', count: number, columns: number): number {
  switch (arrow) {
    case 'down':
      // Down into a row whose column runs short: its last.
      return Math.floor(at / columns) === Math.floor((count - 1) / columns) ? at : Math.min(at + columns, count - 1);
    case 'up':
      return at - columns >= 0 ? at - columns : at;
    case 'left':
      return at % columns > 0 ? at - 1 : at;
    case 'right':
      return at % columns < columns - 1 && at + 1 < count ? at + 1 : at;
  }
}

/**
 * The keys of the kinds in the labelling screen's "what is it?" grid, in the order shown: a key moves the
 * highlight there. Not k (keep), o (Other) or u (unsure); not 0, once clutter with no kind; not t, which was
 * taste, so a habit doesn't mislabel. Kinds past the last key are reached with the arrows.
 */
export const KIND_KEYS = '123456789abcdefghijlmnpqrsvwxyz';

export interface KindChoice {
  kind: string;
  label: string;
  /** Its key ([KIND_KEYS], o for Other), empty past the last. */
  key: string;
}

/**
 * The kinds to choose from once Keep or Clutter is pressed (2026-11-24): for Keep, the keep categories, which
 * should have kept the photo; for Clutter, the clutter categories, which should have offered it; each in the AI's
 * order of [guesses] (best first, so the first is highlighted), then Other: no category of that side covers it.
 * Neutral categories neither keep nor offer, so they are in neither (a meal is Unsure).
 */
export function kindChoices(answer: 'keep' | 'clutter', guesses: readonly string[], kinds: readonly { id: string; label: string; verdict: Verdict }[]): KindChoice[] {
  const byId = new Map(kinds.map((k) => [k.id, k]));
  const side = guesses
    .map((id) => {
      const k = byId.get(id);
      if (!k) throw new Error(`The AI's guess “${id}” isn't a kind to label with`);
      return k;
    })
    .filter((k) => k.verdict === answer);
  return [...side.map((k, i) => ({ kind: k.id, label: k.label, key: KIND_KEYS[i] ?? '' })), { kind: OTHER_KIND, label: 'Other: kind missing', key: 'o' }];
}

/** Labels as kept ([saveLabels]); refused with the reason when they can't be read, so none are lost silently. */
export function readLabels(text: string | null): Labels {
  if (text === null) return {};
  const saved = JSON.parse(text) as unknown;
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) throw new Error('The labels kept aren’t a set of labels');
  for (const [key, label] of Object.entries(saved as Record<string, unknown>)) {
    const l = label as Partial<PhotoLabel> | null;
    if (typeof l !== 'object' || l === null || (l.verdict !== 'keep' && l.verdict !== 'clutter' && l.verdict !== 'unsure' && l.verdict !== 'taste') || !(l.kind === null || typeof l.kind === 'string')) throw new Error(`A label kept can’t be read (${key.slice(0, 6)}…)`);
    if ((l.verdict === 'unsure' || l.verdict === 'taste') && l.kind !== null) throw new Error('A label kept gives a kind to a photo labelled unsure or taste');
    if (l.random !== undefined && l.random !== true) throw new Error(`A label kept can’t be read (${key.slice(0, 6)}…)`);
    if (l.reviewed !== undefined && (l.reviewed !== true || l.random !== true)) throw new Error(`A label kept can’t be read (${key.slice(0, 6)}…)`);
  }
  return saved as Labels;
}

export function saveLabels(labels: Labels): string {
  return JSON.stringify(labels);
}

/** The clutter categories (ids) [match] is offered in: by subject and setting, and by each check. */
export function offeredIn(match: AxisMatch, categories: readonly AxisCategory[], exceptions: readonly PairException[]): string[] {
  const ids: string[] = [];
  const content = axisOutcome(match, categories, exceptions);
  if (content.verdict === 'clutter') ids.push(categories[content.category!]!.id);
  for (const o of checkOutcomes(match, categories)) if (o.verdict === 'clutter') ids.push(categories[o.category!]!.id);
  return ids;
}

/**
 * What a photo can be labelled as being, kept or trashed alike (2026-11-23: "what is it?", apart from the
 * answer): every subject, clutter, neutral or keep, and the clutter forms and settings (Screenshots, Car parks),
 * and the keep settings (Adventures and events, Occasions): what should have kept a photo is sometimes where it
 * was (2026-11-25: a photo of the boat on a sailing trip). Not the neutral settings, which neither keep nor offer,
 * nor "Not a screenshot" or the baseline.
 */
export function isLabelKind(c: AxisCategory): boolean {
  return c.axis === 'subject' || (c.verdict === 'clutter' && c.axis !== 'baseline') || (c.axis === 'setting' && c.verdict === 'keep');
}

/** The kinds to label with ([isLabelKind]), best-scoring for this photo first, the first pre-selected. */
export function kindGuesses(row: Float32Array, scored: ScoredAxis[], settings: AxisSettings): string[] {
  const scores = weightedScores(row, scored as ScoredCategory[], settings);
  return scored
    .map((s, i) => ({ category: s.category, score: scores[i]!.score }))
    .filter((c) => isLabelKind(c.category))
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
  const neither = matches.filter((m) => open(m.mediaKey) && axisOutcome(m, categories, exceptions).verdict === 'none' && checkOutcomes(m, categories).every((o) => o.verdict !== 'clutter')).map((m) => m.mediaKey);
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
  /**
   * Clutter labelled as a subject the list doesn't call clutter (neutral or keep), per subject: someone finds
   * clutter what the list keeps or leaves alone (tallied also for a taste kind, which counts for nothing else).
   */
  notClutterKinds: KindTally[];
  /** Keepers offered all the same, per what they are: which category should have kept them. */
  keepersOffered: KindTally[];
  /** Photos labelled keep or clutter (unsure counts for nothing). */
  judged: number;
}

/** Labelled photos of one kind ([PhotoLabel.kind]): how many are offered (by a clutter category), and how many not. */
export interface KindTally {
  id: string;
  label: string;
  offered: number;
  missed: number;
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

/**
 * The photos to label again, in library order (2026-11-23, once the neutral subjects became kinds): those
 * labelled unsure or taste, which count for nothing and were mostly neutral things that now have a kind; and
 * clutter with no kind that no category offers, where the kind is what says which category should have found
 * it. Only photos that may be trashed.
 */
export function labelAgainQueue(matches: AxisMatch[], categories: readonly AxisCategory[], exceptions: readonly PairException[], photos: Map<string, ClutterPhoto>, labels: Labels): string[] {
  return matches
    .filter((m) => {
      const label = labels[m.mediaKey];
      const photo = photos.get(m.mediaKey);
      if (!label || !photo || !photo.eligible || photo.approved) return false;
      if (label.verdict === 'unsure' || label.verdict === 'taste') return true;
      return label.verdict === 'clutter' && label.kind === null && offeredIn(m, categories, exceptions).length === 0;
    })
    .map((m) => m.mediaKey);
}

/** The suggestions [matches] make, scored against [labels]: per category, what it offers rightly, harmlessly and wrongly, and what it misses. */
export function scoreLabels(matches: AxisMatch[], categories: readonly AxisCategory[], exceptions: readonly PairException[], photos: Map<string, ClutterPhoto>, labels: Labels): LabelScores {
  const clutterIds = categories.filter((c) => c.verdict === 'clutter' && c.axis !== 'baseline');
  const scores = new Map(clutterIds.map((c) => [c.id, { id: c.id, label: c.label, right: 0, harmless: 0, wrong: 0, missed: 0 }]));
  const tallies = () => new Map(categories.filter(isLabelKind).map((c) => [c.id, { id: c.id, label: c.label, offered: 0, missed: 0 }]));
  const notClutter = new Map([...tallies()].filter(([id]) => !scores.has(id)));
  const keepers = tallies();
  const total: Omit<LabelScores, 'categories' | 'notClutterKinds' | 'keepersOffered'> = { offered: 0, wrong: 0, clutter: 0, found: 0, otherKind: 0, judged: 0 };
  for (const m of matches) {
    const label = labels[m.mediaKey];
    const photo = photos.get(m.mediaKey);
    if (!label || !photo || !photo.eligible || photo.approved) continue;
    const offered = offeredIn(m, categories, exceptions);
    // Clutter of a subject the list doesn't call clutter, tallied also where it is taste and counts for nothing below: the view itself is the news.
    const asNotClutter = label.verdict === 'clutter' && label.kind !== null ? notClutter.get(label.kind) : undefined;
    if (asNotClutter) asNotClutter[offered.length > 0 ? 'offered' : 'missed']++;
    if (!judged(label)) continue;
    total.judged++;
    if (offered.length > 0) total.offered++;
    if (label.verdict === 'keep') {
      if (offered.length > 0) total.wrong++;
      const kept = label.kind === null ? undefined : keepers.get(label.kind);
      if (kept) kept[offered.length > 0 ? 'offered' : 'missed']++;
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
  return {
    categories: [...scores.values()],
    notClutterKinds: [...notClutter.values()].filter((n) => n.offered + n.missed > 0),
    keepersOffered: [...keepers.values()].filter((n) => n.offered > 0),
    ...total,
  };
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

/**
 * The random labels to answer again, in library order: those not yet reviewed ([PhotoLabel.reviewed]), only
 * photos that may be trashed (the others count for nothing). Each comes with its earlier answer shown.
 */
export function reviewQueue(matches: AxisMatch[], photos: Map<string, ClutterPhoto>, labels: Labels): { queue: string[]; button: string } {
  const random = matches.filter((m) => {
    const photo = photos.get(m.mediaKey);
    return labels[m.mediaKey]?.random === true && photo !== undefined && photo.eligible && !photo.approved;
  });
  const queue = random.filter((m) => labels[m.mediaKey]!.reviewed !== true).map((m) => m.mediaKey);
  const n = (x: number) => x.toLocaleString();
  const button = queue.length === 0 ? `Review my random labels (all ${n(random.length)} reviewed)` : `Review my random labels (${n(queue.length)} of ${n(random.length)} left)…`;
  return { queue, button };
}

/**
 * The labels with the review started over: every answer kept, none marked reviewed, so each random label
 * comes back (2026-11-25: halfway through, the labeller's idea of clutter, keep and taste became clearer).
 * Null when nothing is reviewed, so there is nothing to start over.
 */
export function reviewStartedOver(labels: Labels): Labels | null {
  if (!Object.values(labels).some((l) => l.reviewed === true)) return null;
  return Object.fromEntries(Object.entries(labels).map(([k, l]) => {
    const { reviewed: _, ...rest } = l;
    return [k, rest];
  }));
}

/** One kind's labels to answer again: [kind] and its [queue], and the [option] that names it. */
export interface KindAgain { kind: string; option: string; queue: string[] }

/**
 * The edge labels (not random) of each kind and verdict, to answer again in library order, only photos that may be
 * trashed (2026-11-26: shop fronts were labelled Signs, clutter, before the labeller settled on unsure for them).
 * Random labels are left to "Review my random labels", which keeps track of what it has seen. Kinds with no
 * such labels are left out; each shows its earlier answer. [categories]: the list the [matches] were made with.
 */
export function kindAgainChoices(matches: AxisMatch[], photos: Map<string, ClutterPhoto>, labels: Labels, kinds: readonly { id: string; label: string }[], categories: readonly AxisCategory[]): KindAgain[] {
  // Other too ("kind missing"): food and drink was labelled so before it had categories of its own.
  // By kind, A to Z (clutter before keep within one).
  const byName = [...kinds, { id: OTHER_KIND, label: 'Other: kind missing' }].sort((a, b) => a.label.localeCompare(b.label, 'en'));
  const edge = (m: AxisMatch) => {
    const label = labels[m.mediaKey];
    const photo = photos.get(m.mediaKey);
    return label !== undefined && label.random !== true && photo !== undefined && photo.eligible && !photo.approved;
  };
  // Also by the AI's top subject or setting for the photo, whatever the answer (2026-11-26: outfits labelled Keep ·
  // People, before the rules made them unsure; café interiors): the labelled photos whose best one is that one.
  const top = (axis: 'subject' | 'setting') => categories.flatMap((c, i) => (c.axis === axis ? [{ c, i }] : [])).sort((a, b) => a.c.label.localeCompare(b.c.label, 'en'));
  return [
    ...byName.flatMap((kind) => (['clutter', 'keep'] as const).map((verdict) => {
      const queue = matches.filter((m) => edge(m) && labels[m.mediaKey]!.verdict === verdict && labels[m.mediaKey]!.kind === kind.id).map((m) => m.mediaKey);
      return { kind: `${verdict}:${kind.id}`, option: `${verdict === 'clutter' ? 'Clutter' : 'Keep'} · ${kind.label} (${queue.length.toLocaleString()})`, queue };
    })),
    ...(['subject', 'setting'] as const).flatMap((axis) => top(axis).map(({ c, i }) => {
      const queue = matches.filter((m) => edge(m) && m[axis].best === i).map((m) => m.mediaKey);
      return { kind: `top:${c.id}`, option: `Top ${axis} · ${c.label} (${queue.length.toLocaleString()})`, queue };
    })),
  ]
    .filter((c) => c.queue.length > 0)
;
}

/** The user's answer for one photo of a blind sample, by its number on the sheets; no photo key. */
export interface BlindAnswer { number: number; verdict: PhotoLabel['verdict']; kind: string | null; random: boolean; offered: string[] }

/**
 * [size] labelled photos (any answer) for the agent to label blind, only photos that may be trashed, drawn the
 * same way each time for the same [seed] (2026-11-26: can the agent label like the user?). Numbered from 1 in
 * the order drawn, with the user's answers ([BlindAnswer], kinds and categories by name) kept apart from the sheets.
 */
export function blindSample(matches: AxisMatch[], categories: readonly AxisCategory[], exceptions: readonly PairException[], photos: Map<string, ClutterPhoto>, labels: Labels, size: number, seed: string): { keys: string[]; answers: BlindAnswer[] } {
  const open = matches.filter((m) => {
    const photo = photos.get(m.mediaKey);
    return labels[m.mediaKey] !== undefined && photo !== undefined && photo.eligible && !photo.approved;
  });
  const drawn = shuffled(open, random(hash(seed))).slice(0, size);
  const name = (id: string) => categories.find((c) => c.id === id)?.label ?? (id === OTHER_KIND ? 'other' : id);
  return {
    keys: drawn.map((m) => m.mediaKey),
    answers: drawn.map((m, i) => {
      const label = labels[m.mediaKey]!;
      return { number: i + 1, verdict: label.verdict, kind: label.kind === null ? null : name(label.kind), random: label.random === true, offered: offeredIn(m, categories, exceptions).map(name) };
    }),
  };
}

/**
 * Whether [drawn] (blindSample, drawn again) is the draw whose answers were [recorded] (blind-answers.json): the
 * same photos in the same order, told by each one's verdict, randomness and whether it had a kind. Kind names and
 * offered categories are left out, as editing the list changes them; adding or removing labels changes the draw.
 */
export function sameBlindDraw(recorded: readonly Pick<BlindAnswer, 'number' | 'verdict' | 'kind' | 'random'>[], drawn: readonly BlindAnswer[]): boolean {
  return recorded.length === drawn.length && recorded.every((r, i) => {
    const d = drawn[i]!;
    return r.number === d.number && r.verdict === d.verdict && r.random === d.random && (r.kind === null) === (d.kind === null);
  });
}

/** The agent's new answer for a blind photo, by its number on the sheets: a kind's id ([isLabelKind]) or OTHER_KIND, or null. */
export interface BlindEdit {
  number: number;
  verdict: 'keep' | 'clutter' | 'unsure';
  kind: string | null;
}

/**
 * [labels] with the photos of a blind draw ([keys], numbered from 1) answered as [edits] say, for the user who asked the
 * agent to: random and reviewed stay as they were. Refused, changing nothing, when a number isn't in the draw or a kind
 * can't go with its verdict (unsure has none; keep and clutter take one of their side's kinds, Other or none).
 */
export function relabelBlind(keys: readonly string[], edits: readonly BlindEdit[], labels: Labels, categories: readonly AxisCategory[]): { labels: Labels } | { problem: string } {
  const problems: string[] = [];
  const next = { ...labels };
  for (const e of edits) {
    const key = keys[e.number - 1];
    if (!Number.isInteger(e.number) || key === undefined) {
      problems.push(`#${e.number} isn't in the draw of ${keys.length}.`);
      continue;
    }
    const fits = e.kind === null || (e.verdict !== 'unsure' && (e.kind === OTHER_KIND || categories.some((c) => c.id === e.kind && isLabelKind(c) && c.verdict === e.verdict)));
    if (!fits) {
      problems.push(`#${e.number}: "${e.kind}" isn't a kind for ${e.verdict}.`);
      continue;
    }
    const old = labels[key];
    next[key] = { ...(old ?? {}), verdict: e.verdict, kind: e.kind };
  }
  return problems.length > 0 ? { problem: problems.join(' ') } : { labels: next };
}

/** How many blind draws the page remembers ([rememberBlindDraw]), the latest kept. */
export const BLIND_DRAWS_KEPT = 10;

/**
 * [text] (the page's kept blind draws, in this browser only, never the lab folder) with draw [id]'s photos
 * ([keys], in their numbered order) added, so a later relabel finds them whatever changed since.
 */
export function rememberBlindDraw(text: string | null, id: string, keys: readonly string[]): string {
  const draws = readBlindDraws(text).filter((d) => d.id !== id);
  return JSON.stringify([...draws, { id, keys: [...keys] }].slice(-BLIND_DRAWS_KEPT));
}

/** The photos of blind draw [id] in [text] ([rememberBlindDraw]), or null when it isn't kept (drawn before 2026-11-26, or long ago). */
export function blindDrawOf(text: string | null, id: string): string[] | null {
  return readBlindDraws(text).find((d) => d.id === id)?.keys ?? null;
}

function readBlindDraws(text: string | null): { id: string; keys: string[] }[] {
  if (text === null) return [];
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw) || !raw.every((d) => typeof d === 'object' && d !== null && typeof d.id === 'string' && Array.isArray(d.keys) && d.keys.every((k: unknown) => typeof k === 'string'))) {
    throw new Error('The blind draws kept in this browser aren’t a list of { id, keys }');
  }
  return raw as { id: string; keys: string[] }[];
}

/** A whole number for [text], the same every time (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A label answered in the review: random and reviewed. */
export function reviewedLabel(label: PhotoLabel): PhotoLabel {
  return { ...label, random: true, reviewed: true };
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
    `Other clutter, kind missing: ${r.random.otherKind} random · ${r.all.otherKind} in all`,
    // A different view of a category the list has, not a category it lacks: the hint to change a verdict.
    'Clutter the list does not call clutter, all labels (offered all the same · missed):',
    ...(r.all.notClutterKinds.length === 0
      ? ['- none']
      : r.all.notClutterKinds.map((n) => `- ${n.label}: ${n.offered} offered · ${n.missed} missed${TASTE_KINDS.includes(n.id) ? ' (taste: not in the scores)' : ''}`)),
    // Which category should have kept a keeper offered: where to strengthen the keepers.
    'Keepers offered all the same, by what they are, all labels:',
    ...(r.all.keepersOffered.length === 0 ? ['- none'] : r.all.keepersOffered.map((n) => `- ${n.label}: ${n.offered}`)),
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
