// The lab folder of the developer page (dev-clutter.html): a folder in the project (lab/, git-ignored)
// that the page watches, so a coding agent can tune the subjects and settings on its own. The agent
// writes request.json; the page applies it to the library with the real AI model, and writes back
// result-<id>.json, numbered contact sheets of the photos the change moves, and review files. Nothing
// is trashed from here, and no photo keys or addresses are written: photos are only numbered.

import { readAxisTuning, type AxisCategory, type AxisCounts, type AxisList, type AxisSettings, type AxisTuning } from './clutterAxes';
import { readAxisList } from './clutterEdits';
import type { CategoryCount, Scoring } from './clutter';
import type { EdgeScore, LabelScores } from './clutterLabels';

/**
 * What the agent asks for. [list]: the whole list of subjects, settings and forms to use (as
 * clutterAxes.ts's AXIS_LIST), or null to keep the page's. [scoring]: the scoring to switch to, or null
 * to keep it. [settings]: fields of that scoring's settings to replace (a field replaces the whole of
 * it, e.g. all of `margins`). [apply]: keep the change on the page afterwards, as Apply does; otherwise
 * it is only measured. [review]: the categories (ids) to save review files for, with the change.
 * [labelSheets]: contact sheets of the labelled photos offered wrongly and missed, by kind, with the change.
 */
export interface LabRequest {
  id: string;
  list: AxisList | null;
  scoring: Scoring | null;
  settings: Partial<AxisSettings> | null;
  apply: boolean;
  review: string[] | 'all';
  labelSheets: boolean;
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
    },
  };
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
