// Editing the list of subjects, settings and forms on the developer page (dev-clutter.html): a draft
// the page edits, the checks it must pass before it is saved, how it differs from the shipped list, and
// the settings carried over to it. The edited list is kept in this browser only; "Copy changes" gives
// the edits as text, to make them permanent in clutterAxes.ts.

import { withWeight, type Scoring } from './clutter';
import { kindOf, type Axis, type AxisCategory, type AxisList, type AxisSettings, type AxisTuning, type PairException, type Verdict } from './clutterAxes';

/** A description being edited: its words, and what they were in the list the draft started from (null when added here). */
export interface DraftDescription {
  text: string;
  was: string | null;
}

/** A category being edited. Its id stays as it was; a category added here gets one from its first name. Its kind follows its verdict. */
export interface DraftCategory {
  id: string;
  label: string;
  axis: Axis;
  verdict: Verdict;
  descriptions: DraftDescription[];
}

export type Draft = DraftCategory[];

/** A draft of [list], to edit. */
export function draftOf(list: readonly AxisCategory[]): Draft {
  return list.map((c) => ({ id: c.id, label: c.label, axis: c.axis, verdict: c.verdict, descriptions: c.descriptions.map((text) => ({ text, was: text })) }));
}

/** The list a draft makes, and the descriptions reworded in it (the words before → after), so their weights carry over. */
export function listOf(draft: Draft): { list: AxisCategory[]; renames: Record<string, string> } {
  const renames: Record<string, string> = {};
  const list = draft.map((c) => ({
    id: c.id,
    label: c.label.trim(),
    kind: kindOf(c.verdict),
    axis: c.axis,
    verdict: c.verdict,
    descriptions: c.descriptions.map((d) => {
      const text = d.text.trim();
      if (d.was !== null && d.was !== text) renames[d.was] = text;
      return text;
    }),
  }));
  return { list, renames };
}

function categoryIn(draft: Draft, id: string): DraftCategory {
  const category = draft.find((c) => c.id === id);
  if (!category) throw new Error(`No category ${id} in the list being edited`);
  return category;
}

function changed(draft: Draft, id: string, change: (c: DraftCategory) => DraftCategory): Draft {
  categoryIn(draft, id);
  return draft.map((c) => (c.id === id ? change(c) : c));
}

function descriptionAt(category: DraftCategory, index: number): DraftDescription {
  const description = category.descriptions[index];
  if (!description) throw new Error(`No description ${index} in ${category.label}`);
  return description;
}

/** A category's heading in the editor, where it is collapsed: "Screen photos · clutter · 9 descriptions". */
export function draftHeading(category: DraftCategory): string {
  const count = category.descriptions.length;
  return `${category.label.trim() || 'No name yet'} · ${category.verdict} · ${count} ${count === 1 ? 'description' : 'descriptions'}`;
}

/** [draft] with [text] added to category [id]. Empty or repeated words are refused at Save ([draftProblems]). */
export function addDescription(draft: Draft, id: string, text: string): Draft {
  return changed(draft, id, (c) => ({ ...c, descriptions: [...c.descriptions, { text, was: null }] }));
}

export function removeDescription(draft: Draft, id: string, index: number): Draft {
  return changed(draft, id, (c) => {
    descriptionAt(c, index);
    return { ...c, descriptions: c.descriptions.filter((_, i) => i !== index) };
  });
}

/** [draft] with description [index] of category [id] reworded to [text]; its weight follows it ([listOf]). */
export function rewordDescription(draft: Draft, id: string, index: number, text: string): Draft {
  return changed(draft, id, (c) => {
    descriptionAt(c, index);
    return { ...c, descriptions: c.descriptions.map((d, i) => (i === index ? { ...d, text } : d)) };
  });
}

/** [draft] with description [index] of category [id] moved to the end of category [to]; its weight goes with it. */
export function moveDescription(draft: Draft, id: string, index: number, to: string): Draft {
  if (id === to) return draft;
  const description = descriptionAt(categoryIn(draft, id), index);
  categoryIn(draft, to);
  return draft.map((c) => {
    if (c.id === id) return { ...c, descriptions: c.descriptions.filter((_, i) => i !== index) };
    if (c.id === to) return { ...c, descriptions: [...c.descriptions, description] };
    return c;
  });
}

export function removeCategory(draft: Draft, id: string): Draft {
  categoryIn(draft, id);
  return draft.filter((c) => c.id !== id);
}

export function renameCategory(draft: Draft, id: string, label: string): Draft {
  return changed(draft, id, (c) => ({ ...c, label }));
}

/** A draft's category made [axis]: what a photo is of, where it is, what kind of image, or a baseline. */
export function setAxis(draft: Draft, id: string, axis: Axis): Draft {
  return changed(draft, id, (c) => ({ ...c, axis }));
}

/** A draft's category given [verdict]: clutter, keep or neutral; its kind follows. */
export function setVerdict(draft: Draft, id: string, verdict: Verdict): Draft {
  return changed(draft, id, (c) => ({ ...c, verdict }));
}

/** [draft] with a new category named [label] at the end of its axis, with an id of its own and no descriptions yet. */
export function addAxisCategory(draft: Draft, label: string, axis: Axis, verdict: Verdict): Draft {
  const base = `custom-${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category'}`;
  const ids = new Set(draft.map((c) => c.id));
  let id = base;
  for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
  const category: DraftCategory = { id, label, axis, verdict, descriptions: [] };
  const last = draft.map((c) => c.axis).lastIndexOf(axis);
  return last < 0 ? [...draft, category] : [...draft.slice(0, last + 1), category, ...draft.slice(last + 1)];
}

/** The baseline the floor measures by, when a list has none: "a photo", which is close to every photo. */
export const BASELINE_DESCRIPTION = 'a photo';

/**
 * [draft] with a baseline, for the floor: a category "Any photo" on the baseline side holding "a photo",
 * moved there from wherever it is in the list. Unchanged when the list already has a baseline.
 */
export function withBaseline(draft: Draft): Draft {
  if (draft.some((c) => c.axis === 'baseline')) return draft;
  const ids = new Set(draft.map((c) => c.id));
  let id = 'baseline';
  for (let i = 2; ids.has(id); i++) id = `baseline-${i}`;
  const same = (d: DraftDescription) => d.text.trim().toLowerCase() === BASELINE_DESCRIPTION;
  const moved = draft.flatMap((c) => c.descriptions.filter(same));
  const rest = draft.map((c) => ({ ...c, descriptions: c.descriptions.filter((d) => !same(d)) }));
  return [...rest, { id, label: 'Any photo', axis: 'baseline', verdict: 'neutral', descriptions: moved.length > 0 ? [moved[0]!] : [{ text: BASELINE_DESCRIPTION, was: null }] }];
}

/**
 * Why the floor can't be turned on with [list], as the page says it, or null when it can: the floor reads
 * only categories on the baseline side, so "a photo" elsewhere in the list doesn't count.
 */
export function floorHint(list: readonly AxisCategory[]): string | null {
  if (list.some((c) => c.axis === 'baseline')) return null;
  const holder = list.find((c) => c.descriptions.some((d) => d.trim().toLowerCase() === BASELINE_DESCRIPTION));
  const where = holder ? `“${BASELINE_DESCRIPTION}” is in ${holder.label}, a ${holder.axis}, where it counts as one of its descriptions. ` : '';
  return `${where}The floor needs a category on the baseline side (in Edit, Add with “baseline” chosen). “Add the baseline” does it for you${holder ? `, moving “${BASELINE_DESCRIPTION}” there` : ''}.`;
}

/**
 * What must be put right before [draft] can be saved, as the page says it; none when it can be. Nothing
 * is put right for the user: an empty or repeated description could only be guessed at.
 */
export function draftProblems(draft: Draft): string[] {
  const problems: string[] = [];
  const labels = new Map<string, number>();
  const seen = new Map<string, string>();
  for (const c of draft) {
    const label = c.label.trim();
    if (label === '') problems.push('A category has no name.');
    else labels.set(label.toLowerCase(), (labels.get(label.toLowerCase()) ?? 0) + 1);
    if (c.descriptions.length === 0) problems.push(`${label || 'A category'} has no descriptions.`);
    if (c.axis === 'baseline' && c.verdict !== 'neutral') problems.push(`${label || 'A baseline'} is a baseline, which decides nothing: make it neutral.`);
    for (const d of c.descriptions) {
      const text = d.text.trim();
      if (text === '') {
        problems.push(`${label || 'A category'} has an empty description.`);
        continue;
      }
      const other = seen.get(text.toLowerCase());
      if (other !== undefined) problems.push(`“${text}” is in ${other === label ? `${label} twice` : `both ${other} and ${label}`}.`);
      else seen.set(text.toLowerCase(), label);
    }
  }
  for (const [label, count] of labels) if (count > 1) problems.push(`${count} categories are named “${draft.find((c) => c.label.trim().toLowerCase() === label)!.label.trim()}”.`);
  if (!draft.some((c) => c.axis === 'subject')) problems.push('The list needs at least one subject.');
  if (!draft.some((c) => c.axis === 'setting')) problems.push('The list needs at least one setting.');
  if (!draft.some((c) => c.verdict === 'clutter' && c.axis !== 'baseline')) problems.push('The list needs at least one clutter category.');
  return problems;
}

/**
 * What must be put right in the exceptions before saving: each must name a subject and a setting that
 * are in [draft], and each pair once.
 */
export function exceptionProblems(draft: Draft, exceptions: readonly PairException[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of exceptions) {
    const [subject, setting] = [draft.find((c) => c.id === e.subject), draft.find((c) => c.id === e.setting)];
    if (!subject || subject.axis !== 'subject' || !setting || setting.axis !== 'setting') {
      problems.push(`An exception names ${!subject || subject.axis !== 'subject' ? 'a subject' : 'a setting'} no longer in the list (${subject?.label ?? e.subject} in ${setting?.label ?? e.setting}).`);
      continue;
    }
    const key = `${e.subject}\u0000${e.setting}`;
    if (seen.has(key)) problems.push(`${subject.label} in ${setting.label} has two exceptions.`);
    seen.add(key);
  }
  return problems;
}

/** Whether [list] is the same as [shipped]: the same categories, names, axes, verdicts and descriptions, in the same order. */
export function isShipped(list: readonly AxisCategory[], shipped: readonly AxisCategory[]): boolean {
  const form = (l: readonly AxisCategory[]) => JSON.stringify(l.map((c) => [c.id, c.label, c.axis, c.verdict, c.descriptions]));
  return form(list) === form(shipped);
}

/**
 * How [list] differs from [from], one line per change, for the panel and "Copy changes": categories added,
 * removed, renamed, of another axis or verdict, and descriptions added, removed or moved. A reworded
 * description shows as removed and added, which is what it is to the code.
 */
export function listChanges(from: readonly AxisCategory[], list: readonly AxisCategory[]): string[] {
  const lines: string[] = [];
  const before = new Map(from.map((c) => [c.id, c]));
  const after = new Map(list.map((c) => [c.id, c]));
  const homeBefore = new Map(from.flatMap((c) => c.descriptions.map((d) => [d, c] as const)));
  const homeAfter = new Map(list.flatMap((c) => c.descriptions.map((d) => [d, c] as const)));
  for (const c of list) {
    const was = before.get(c.id);
    if (!was) lines.push(`Added ${c.axis} ${c.label} (${c.verdict})`);
    else {
      if (was.label !== c.label) lines.push(`Renamed ${was.label} to ${c.label}`);
      if (was.axis !== c.axis) lines.push(`${c.label} is now a ${c.axis}`);
      if (was.verdict !== c.verdict) lines.push(`${c.label} is now ${c.verdict}`);
    }
  }
  for (const c of from) if (!after.has(c.id)) lines.push(`Removed category ${c.label}`);
  for (const c of list) {
    for (const d of c.descriptions) {
      const was = homeBefore.get(d);
      if (!was) lines.push(`Added “${d}” to ${c.label}`);
      else if (was.id !== c.id) lines.push(`Moved “${d}” from ${was.label} to ${c.label}`);
    }
  }
  for (const c of from) {
    for (const d of c.descriptions) {
      // Gone with its category: said once, above.
      if (!homeAfter.has(d) && after.has(c.id)) lines.push(`Removed “${d}” from ${c.label}`);
    }
  }
  return lines;
}

/** The weights and minimum leads an edit makes, edited with the list: the ones of the scoring shown. */
export interface DraftWeights {
  categoryWeights: Record<string, number>;
  descriptionWeights: Record<string, number>;
  margins: Record<string, number>;
}

/** A weight as the list shows it outside the editor: "+0.030", "−0.010", or null for none. */
export function weightLabel(weight: number | undefined): string | null {
  return weight === undefined || weight === 0 ? null : `${weight > 0 ? '+' : '−'}${Math.abs(weight).toFixed(3)}`;
}

/** The weights and minimum leads of [settings], to edit. */
export function draftWeights(settings: DraftWeights): DraftWeights {
  return { categoryWeights: settings.categoryWeights, descriptionWeights: settings.descriptionWeights, margins: settings.margins };
}

/** [weights] with description [from] reworded to [to]: its weight follows it. */
export function weightReworded(weights: DraftWeights, from: string, to: string): DraftWeights {
  if (from === to || weights.descriptionWeights[from] === undefined) return weights;
  const weight = weights.descriptionWeights[from];
  return { ...weights, descriptionWeights: withWeight(withWeight(weights.descriptionWeights, from, undefined), to, weight) };
}

/**
 * How the weights and minimum leads of [after] differ from [before], one line each, for the summary of
 * what the edits do: "“a selfie” +0.0300 (was 0)", "People weight −0.0100 (was +0.0200)", "Signs minimum
 * lead 0.04 (was its axis's 0.02)". Categories and descriptions named as they are in [list]; [axisLead]
 * is the minimum lead a category without its own has.
 */
export function weightEdits(before: DraftWeights, after: DraftWeights, list: readonly AxisCategory[], axisLead: (c: AxisCategory) => number): string[] {
  const signed = (x: number | undefined) => (x === undefined || x === 0 ? '0' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(4)}`);
  const lines: string[] = [];
  for (const c of list) {
    const [was, now] = [before.categoryWeights[c.id], after.categoryWeights[c.id]];
    if ((was ?? 0) !== (now ?? 0)) lines.push(`${c.label} weight ${signed(now)} (was ${signed(was)})`);
    const [leadWas, leadNow] = [before.margins[c.id], after.margins[c.id]];
    if (leadWas !== leadNow) lines.push(`${c.label} minimum lead ${leadNow ?? `its axis's ${axisLead(c)}`} (was ${leadWas ?? `its axis's ${axisLead(c)}`})`);
  }
  for (const d of list.flatMap((c) => c.descriptions)) {
    const [was, now] = [before.descriptionWeights[d], after.descriptionWeights[d]];
    if ((was ?? 0) !== (now ?? 0)) lines.push(`“${d}” ${signed(now)} (was ${signed(was)})`);
  }
  return lines;
}

/**
 * How the Settings card's fields differ between [before] and [after], one line each, as Save shows them:
 * "Scoring: evened out (was raw scores)", "Raw scores: subject minimum lead 0.03 (was 0.02)", "Raw
 * scores: pooling off (was 0.02)". Weights and categories' own minimum leads are edited elsewhere
 * ([weightEdits]) and left out. None: nothing to save.
 */
export function tuningEdits(before: AxisTuning, after: AxisTuning): string[] {
  const name = (s: Scoring) => (s === 'raw' ? 'raw scores' : 'evened out');
  const lines: string[] = [];
  if (before.scoring !== after.scoring) lines.push(`Scoring: ${name(after.scoring)} (was ${name(before.scoring)})`);
  for (const scoring of ['raw', 'evened'] as const) {
    const [was, now] = [before.settings[scoring], after.settings[scoring]];
    const line = (what: string, a: number | null, b: number | null, off: string) => {
      if (a !== b) lines.push(`${name(scoring)[0]!.toUpperCase()}${name(scoring).slice(1)}: ${what} ${b ?? off} (was ${a ?? off})`);
    };
    for (const axis of ['subject', 'setting', 'form'] as const) {
      line(`${axis} minimum score`, was[axis].minScore, now[axis].minScore, '');
      line(`${axis} minimum lead`, was[axis].margin, now[axis].margin, '');
    }
    line('pooling', was.pooling === 0 ? null : was.pooling, now.pooling === 0 ? null : now.pooling, 'off');
    line('floor', was.baseline, now.baseline, 'off');
  }
  return lines;
}

/**
 * [current] with the Settings card's fields of [draft]: its scoring, and per scoring the axes' minimum
 * scores and leads, pooling and the floor. Weights and categories' own minimum leads stay as [current]
 * has them, so a buff or the lab applied while the card was being edited is kept.
 */
export function withCardSettings(current: AxisTuning, draft: AxisTuning): AxisTuning {
  const card = (now: AxisSettings, from: AxisSettings): AxisSettings => ({ ...now, subject: from.subject, setting: from.setting, form: from.form, pooling: from.pooling, baseline: from.baseline });
  return { scoring: draft.scoring, settings: { raw: card(current.settings.raw, draft.settings.raw), evened: card(current.settings.evened, draft.settings.evened) } };
}

/** How a list's exceptions differ from [from]'s, one line each, named as in [list]. */
export function exceptionChanges(from: readonly PairException[], to: readonly PairException[], list: readonly AxisCategory[]): string[] {
  const label = (id: string) => list.find((c) => c.id === id)?.label ?? id;
  const key = (e: PairException) => `${e.subject}\u0000${e.setting}`;
  const before = new Map(from.map((e) => [key(e), e]));
  const after = new Map(to.map((e) => [key(e), e]));
  const lines: string[] = [];
  for (const e of to) {
    const was = before.get(key(e));
    if (!was) lines.push(`Added exception: ${label(e.subject)} in ${label(e.setting)} → ${e.verdict}`);
    else if (was.verdict !== e.verdict) lines.push(`Exception ${label(e.subject)} in ${label(e.setting)} is now ${e.verdict}`);
  }
  for (const e of from) if (!after.has(key(e))) lines.push(`Removed exception: ${label(e.subject)} in ${label(e.setting)}`);
  return lines;
}

/** A list as the page keeps it in this browser; null (nothing kept) when it is the shipped one. */
export function saveAxisList(list: AxisList, shipped: AxisList): string | null {
  return isShipped(list.categories, shipped.categories) && JSON.stringify(list.exceptions) === JSON.stringify(shipped.exceptions) ? null : JSON.stringify(list);
}

const AXES: readonly Axis[] = ['subject', 'setting', 'form', 'baseline'];

/**
 * The list the page works with: the one kept in this browser ([text], as [saveAxisList] wrote it), or
 * the shipped one when none is kept or the kept one can't be used, which [notes] then says.
 */
export function readAxisList(text: string | null, shipped: AxisList): { list: AxisList; notes: string[] } {
  if (text === null) return { list: shipped, notes: [] };
  const refuse = (why: string) => ({ list: shipped, notes: [`The edited subjects and settings kept in this browser can't be used (${why}); the shipped list is used instead.`] });
  let saved: Partial<AxisList>;
  try {
    saved = JSON.parse(text) as Partial<AxisList>;
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
  const isCategory = (c: unknown): c is AxisCategory => {
    const x = c as Partial<AxisCategory> | null;
    return typeof x === 'object' && x !== null && typeof x.id === 'string' && typeof x.label === 'string' && AXES.includes(x.axis as Axis) && (x.verdict === 'clutter' || x.verdict === 'keep' || x.verdict === 'neutral') && x.kind === kindOf(x.verdict) && Array.isArray(x.descriptions) && x.descriptions.every((d) => typeof d === 'string');
  };
  const isException = (e: unknown): e is PairException => {
    const x = e as Partial<PairException> | null;
    return typeof x === 'object' && x !== null && typeof x.subject === 'string' && typeof x.setting === 'string' && (x.verdict === 'clutter' || x.verdict === 'keep');
  };
  if (!Array.isArray(saved.categories) || !saved.categories.every(isCategory) || !Array.isArray(saved.exceptions) || !saved.exceptions.every(isException)) return refuse('it isn’t a list of subjects and settings');
  const ids = saved.categories.map((c) => c.id);
  if (new Set(ids).size !== ids.length) return refuse('two categories share an id');
  const draft = draftOf(saved.categories);
  const problems = [...draftProblems(draft), ...exceptionProblems(draft, saved.exceptions)];
  if (problems.length > 0) return refuse(problems.join(' '));
  return { list: { categories: saved.categories, exceptions: saved.exceptions }, notes: [] };
}

/**
 * [settings] for [list]: weights of reworded descriptions carried to their new words ([renames]), and
 * weights and minimum leads of what is no longer in the list dropped.
 */
export function settingsForList<T extends DraftWeights>(settings: T, list: readonly AxisCategory[], renames: Record<string, string>): T {
  const ids = new Set(list.map((c) => c.id));
  const descriptions = new Set(list.flatMap((c) => c.descriptions));
  const keep = (record: Record<string, number>, known: Set<string>) => Object.fromEntries(Object.entries(record).filter(([k]) => known.has(k)));
  let descriptionWeights: Record<string, number> = {};
  for (const [text, weight] of Object.entries(settings.descriptionWeights)) descriptionWeights = withWeight(descriptionWeights, renames[text] ?? text, weight);
  return {
    ...settings,
    categoryWeights: keep(settings.categoryWeights, ids),
    margins: keep(settings.margins, ids),
    descriptionWeights: keep(descriptionWeights, descriptions),
  };
}
