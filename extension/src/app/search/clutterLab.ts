// The lab folder of the developer page (dev-clutter.html): a folder in the project (lab/, git-ignored)
// that the page watches, so a coding agent can tune the subjects and settings on its own. The agent
// writes request.json; the page applies it to the library with the real AI model, and writes back
// result-<id>.json, numbered contact sheets of the photos the change moves, and review files. Nothing
// is trashed from here, and no photo keys or addresses are written: photos are only numbered.

import { readAxisTuning, type AxisCategory, type AxisCounts, type AxisList, type AxisSettings, type AxisTuning } from './clutterAxes';
import { readAxisList } from './clutterEdits';
import type { CategoryCount, Scoring } from './clutter';
import type { BlindEdit, EdgeScore, LabelScores } from './clutterLabels';

/**
 * What the agent asks for. [list]: the whole list of subjects, settings and forms to use (as
 * clutterAxes.ts's AXIS_LIST), or null to keep the page's. [scoring]: the scoring to switch to, or null
 * to keep it. [settings]: fields of that scoring's settings to replace (a field replaces the whole of
 * it, e.g. all of `margins`). [apply]: keep the change on the page afterwards, as Apply does; otherwise
 * it is only measured. [review]: the categories (ids) to save review files for, with the change.
 * [labelSheets]: contact sheets of the labelled photos offered wrongly and missed, by kind, with the change.
 * [blind]: how many labelled photos to draw as numbered contact sheets (blind-NN.png) for the agent to label
 * without seeing the user's answers, which go apart into blind-answers.json (clutterLabels.ts blindSample); 0 for none.
 * [relabel]: new answers for photos of an earlier blind request ([from], its id), by their numbers there, which the page
 * saves as the user's labels; for when the user asks the agent to relabel them (2026-11-26). Null for none.
 * [zoom]: photos of an earlier blind request by number, drawn larger ([size] px a side) as zoom-NN.png, for a closer look
 * at what a 192 px sheet hides (a cat in a dark window). Null for none.
 * [exportList]: write the page's list (list.json, as AXIS_LIST) and tuning (tuning.json, as STARTING_AXIS_TUNING) as
 * they are in this browser, to ship them; only descriptions and numbers, nothing about photos.
 */
export interface LabRequest {
  id: string;
  list: AxisList | null;
  scoring: Scoring | null;
  settings: Partial<AxisSettings> | null;
  apply: boolean;
  review: string[] | 'all';
  labelSheets: boolean;
  blind: number;
  relabel: { from: string; labels: BlindEdit[] } | null;
  zoom: { from: string; numbers: number[]; size: number } | null;
  exportList: boolean;
}

/** [text] (request.json) as a request, or why it can't be one, as the result file says it. */
export function readLabRequest(text: string): { request: LabRequest } | { problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { problem: `request.json isn't JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  const r = raw as Record<string, unknown> | null;
  if (typeof r !== 'object' || r === null) return { problem: 'request.json must be an object' };
  if (typeof r.id !== 'string' || r.id.trim() === '' || !/^[\w.-]+$/.test(r.id)) return { problem: 'request.json needs an "id" of letters, digits, ".", "-" or "_"' };
  if (r.scoring !== undefined && r.scoring !== null && r.scoring !== 'raw' && r.scoring !== 'evened') return { problem: '"scoring" must be "raw" or "evened"' };
  if (r.settings !== undefined && r.settings !== null && (typeof r.settings !== 'object' || Array.isArray(r.settings))) return { problem: '"settings" must be an object of settings fields' };
  if (r.apply !== undefined && typeof r.apply !== 'boolean') return { problem: '"apply" must be true or false' };
  if (r.labelSheets !== undefined && typeof r.labelSheets !== 'boolean') return { problem: '"labelSheets" must be true or false' };
  if (r.exportList !== undefined && typeof r.exportList !== 'boolean') return { problem: '"exportList" must be true or false' };
  if (r.blind !== undefined && !(Number.isInteger(r.blind) && (r.blind as number) >= 0 && (r.blind as number) <= BLIND_MAX)) return { problem: `"blind" must be a whole number from 0 to ${BLIND_MAX}` };
  const relabel = r.relabel === undefined || r.relabel === null ? null : readRelabel(r.relabel);
  if (typeof relabel === 'string') return { problem: relabel };
  const zoom = r.zoom === undefined || r.zoom === null ? null : readZoom(r.zoom);
  if (typeof zoom === 'string') return { problem: zoom };
  const review = r.review === undefined ? [] : r.review;
  if (review !== 'all' && !(Array.isArray(review) && review.every((x) => typeof x === 'string'))) return { problem: '"review" must be "all" or a list of category ids' };
  if (r.list !== undefined && r.list !== null && (typeof r.list !== 'object' || Array.isArray(r.list))) return { problem: '"list" must be a list like AXIS_LIST: { categories, exceptions }' };
  return {
    request: {
      id: r.id,
      list: (r.list as AxisList | undefined) ?? null,
      scoring: (r.scoring as Scoring | undefined) ?? null,
      settings: (r.settings as Partial<AxisSettings> | undefined) ?? null,
      apply: r.apply === true,
      review: review as string[] | 'all',
      labelSheets: r.labelSheets === true,
      blind: (r.blind as number | undefined) ?? 0,
      relabel,
      zoom,
      exportList: r.exportList === true,
    },
  };
}

/** The most photos one zoom draws, and the sizes it draws them at (px a side). */
export const ZOOM_MAX = 24;
export const ZOOM_SIZES = { min: 192, max: 1024 };

/** [raw] as a request's zoom, or why it can't be one. */
function readZoom(raw: unknown): LabRequest['zoom'] | string {
  const shape = `"zoom" must be { "from": the id of a blind request, "numbers": 1 to ${ZOOM_MAX} different numbers, "size": ${ZOOM_SIZES.min} to ${ZOOM_SIZES.max} }`;
  const r = raw as Record<string, unknown> | null;
  if (typeof r !== 'object' || r === null || Array.isArray(r) || typeof r.from !== 'string' || !/^[\w.-]+$/.test(r.from)) return shape;
  const numbers = r.numbers;
  if (!Array.isArray(numbers) || numbers.length === 0 || numbers.length > ZOOM_MAX || !numbers.every((n) => Number.isInteger(n) && n >= 1) || new Set(numbers).size !== numbers.length) return shape;
  if (!Number.isInteger(r.size) || (r.size as number) < ZOOM_SIZES.min || (r.size as number) > ZOOM_SIZES.max) return shape;
  return { from: r.from, numbers: numbers as number[], size: r.size as number };
}

/** [raw] as a request's relabel, or why it can't be one. */
function readRelabel(raw: unknown): LabRequest['relabel'] | string {
  const shape = '"relabel" must be { "from": the id of a blind request, "labels": [{ "number", "verdict": "keep", "clutter" or "unsure", "kind": an id or null }] }';
  const r = raw as Record<string, unknown>;
  if (typeof r !== 'object' || r === null || Array.isArray(r) || typeof r.from !== 'string' || !/^[\w.-]+$/.test(r.from) || !Array.isArray(r.labels) || r.labels.length === 0) return shape;
  const labels: BlindEdit[] = [];
  for (const raw of r.labels as unknown[]) {
    const e = raw as Record<string, unknown> | null;
    if (typeof e !== 'object' || e === null || !Number.isInteger(e.number) || (e.number as number) < 1) return shape;
    if (e.verdict !== 'keep' && e.verdict !== 'clutter' && e.verdict !== 'unsure') return shape;
    if (e.kind !== undefined && e.kind !== null && typeof e.kind !== 'string') return shape;
    labels.push({ number: e.number as number, verdict: e.verdict, kind: (e.kind as string | undefined) ?? null });
  }
  if (new Set(labels.map((l) => l.number)).size !== labels.length) return '"relabel" names a number twice';
  return { from: r.from, labels };
}

/**
 * The list and tuning [request] asks for, from the page's [list] and [tuning], checked as the page
 * checks what it keeps (readAxisList, readAxisTuning): refused with the reasons when the list can't be
 * used; [notes] name weights dropped for what the list no longer has.
 */
export function labTarget(request: LabRequest, list: AxisList, tuning: AxisTuning): { list: AxisList; tuning: AxisTuning; notes: string[] } | { problem: string } {
  let target = list;
  if (request.list) {
    const read = readAxisList(JSON.stringify(request.list), list);
    if (read.notes.length > 0) return { problem: read.notes.join(' ') };
    target = read.list;
  }
  const scoring = request.scoring ?? tuning.scoring;
  const merged = { scoring, settings: { ...tuning.settings, [scoring]: { ...tuning.settings[scoring], ...(request.settings ?? {}) } } };
  try {
    const read = readAxisTuning(JSON.stringify(merged), target.categories);
    return { list: target, tuning: read.tuning, notes: read.notes };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

/** The ids of the categories to review: every clutter category and form with photos, or those asked for, which must be in the list. */
export function labReviewIds(review: LabRequest['review'], counts: AxisCounts): string[] {
  const all = [...counts.forms, ...counts.clutter].filter((c) => c.trashable.length > 0 || c.justMissed.length > 0).map((c) => c.category.id);
  if (review === 'all') return all;
  const known = new Set([...counts.forms, ...counts.clutter].map((c) => c.category.id));
  const unknown = review.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`"review" names what isn't a clutter category or form: ${unknown.join(', ')}`);
  return review;
}

/** One category's line in a result: its photos before the change and after (those Search would offer), and its close calls. */
export interface LabCategoryLine {
  id: string;
  label: string;
  axis: AxisCategory['axis'];
  verdict: AxisCategory['verdict'];
  before: number | null;
  after: number | null;
  closeCallsAfter: number | null;
}

/** Every clutter, form and keep category before and after, by id; null where it isn't in that list. */
export function labCategoryLines(before: AxisCounts, after: AxisCounts): LabCategoryLine[] {
  const all = (c: AxisCounts) => [...c.forms, ...c.clutter, ...c.keepers];
  const was = new Map(all(before).map((c) => [c.category.id, c]));
  const now = new Map(all(after).map((c) => [c.category.id, c]));
  const ids = [...new Set([...all(after), ...all(before)].map((c) => c.category.id))];
  return ids.map((id) => {
    const c = (now.get(id) ?? was.get(id))!.category as AxisCategory;
    const size = (x: CategoryCount | undefined) => (x ? x.trashable.length : null);
    return { id, label: c.label, axis: c.axis, verdict: c.verdict, before: size(was.get(id)), after: size(now.get(id)), closeCallsAfter: now.get(id)?.closeCalls ?? null };
  });
}

/** A group of photos the change moves, numbered as on its contact sheet. */
export interface LabMoveGroup {
  /** "leave products", "join memes", "move". */
  key: string;
  title: string;
  /** The contact sheet's file name, or null when there are no photos. */
  sheet: string | null;
  photos: { number: number; caption: string }[];
  /** How many there are in all; only the first [LAB_SHEET_MAX] are on the sheet. */
  total: number;
}

/** The most photos of a moved group on its contact sheet: enough to judge a change, few enough to read cheaply. */
export const LAB_SHEET_MAX = 24;

/** The most photos a blind request draws ([LabRequest.blind]). */
export const BLIND_MAX = 500;

/** What the result file says: the request, what it did, and where its files are. */
export interface LabResult {
  id: string;
  /** "done", or "refused" with [problems]. */
  state: 'done' | 'refused';
  problems: string[];
  notes: string[];
  applied: boolean;
  scoring: Scoring | null;
  totals: { before: string; after: string } | null;
  categories: LabCategoryLine[];
  moves: LabMoveGroup[];
  /** The review files written, by category id. */
  reviews: string[];
  /** The suggestions scored against the user's labels (clutterLabels.ts), before and after; null with no labels yet. */
  labels: { before: LabelScores; after: LabelScores } | null;
  /** With [LabRequest.labelSheets]: the labelled photos offered wrongly, and missed by kind, after the change. */
  labelGroups: LabMoveGroup[];
  /**
   * The same scores for parts of the labels (clutterLabels.ts labelParts): [random], those drawn at random from
   * the library, for its precision and recall; [a] and [b], every label in two fixed halves, so a change tuned
   * looking at one half can be checked on the other. Null with no labels yet.
   */
  labelParts: { random: LabelPart; a: LabelPart; b: LabelPart } | null;
  /** Each clutter category and form at its edge after the change (clutterLabels.ts edgeScores); null with no labels yet. */
  edge: EdgeScore[] | null;
}

/** A part of the labels scored before and after a change. */
export interface LabelPart {
  before: LabelScores;
  after: LabelScores;
}

/** A refused request's result. */
export function labRefusal(id: string, problems: string[]): LabResult {
  return { id, state: 'refused', problems, notes: [], applied: false, scoring: null, totals: null, categories: [], moves: [], reviews: [], labels: null, labelGroups: [], labelParts: null, edge: null };
}
