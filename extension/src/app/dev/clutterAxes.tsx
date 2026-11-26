// Developer tool: clutter by subject and setting (search/clutterAxes.ts), on dev-clutter.html. Each
// photo gets its best subject (what it is of) and its best setting (where it is); their verdicts decide
// whether it is clutter. Scores raw or evened out, each scoring with its own settings. Nothing is
// trashed from here; the list, the exceptions and the settings are kept in this browser.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { categorySamples, countLine, descriptionScores, evenedRows, MAX_BUFFS, photoCaption, weightChanges, type CaptionPart, type CategoryCount, type CategoryPhoto, type ClutterPhoto, type Scoring, type WeightChange } from '../search/clutter';
import {
  AXIS_LIST,
  STARTING_AXIS_TUNING,
  STARTING_FLOOR,
  STARTING_POOLING,
  axisBreakdown,
  axisComparison,
  categoryParts,
  axisBuffButton,
  axisBuffsFor,
  axisCaption,
  axisEffects,
  axisGroups,
  axisDescriptionCount,
  axisListSummary,
  axisOutcome,
  sideOf,
  sideOutcome,
  axisStayRaise,
  axisSummary,
  changesLine,
  clutterIn,
  countAxes,
  descriptionOverlap,
  floorProblem,
  groupPairs,
  matchAxes,
  pairRows,
  readAxisTuning,
  reviewText,
  withAxisBuff,
  withAxisChanges,
  type Axis,
  type ContentAxis,
  type AxisBuff,
  type AxisCategory,
  type AxisChange,
  type AxisLists,
  type AxisMatch,
  type AxisSettings,
  type AxisTuning,
  type Overlap,
  type PairException,
  type PairRow,
  type ReviewPhoto,
  type ScoredAxis,
  type BreakdownInput,
  type BreakdownSide,
  type Side,
  type SideAxis,
  type Verdict,
} from '../search/clutterAxes';
import {
  addAxisCategory,
  addDescription,
  draftHeading,
  draftOf,
  draftProblems,
  draftWeights,
  exceptionChanges,
  exceptionProblems,
  floorHint,
  listChanges,
  listOf,
  moveDescription,
  readAxisList,
  removeCategory,
  removeDescription,
  renameCategory,
  rewordDescription,
  saveAxisList,
  setAxis,
  setCheck,
  draftChecks,
  draftSections,
  verdictChoices,
  setVerdict,
  settingsForList,
  tuningEdits,
  weightEdits,
  weightReworded,
  withBaseline,
  withCardSettings,
  type Draft,
  type DraftWeights,
} from '../search/clutterEdits';
import { edgeLines, edgeScores, kindGuesses, labelExamples, labelLine, labelParts, labelSample, OTHER_KIND, RANDOM_SAMPLE_SIZE, randomSample, readLabels, earlierAnswer, isLabelKind, labelAgainQueue, reviewQueue, reviewedLabel, reviewStartedOver, kindAgainChoices, blindSample, blindDrawOf, relabelBlind, rememberBlindDraw, sameBlindDraw, kindChoices, moveInGrid, withDuplicates, oneOfEachMoment, copiedLine, SAMPLE_SIZES, saveLabels, scoreLabels, scoresChange, scoresLine, scoresReport, type BlindAnswer, type LabelScorePair, type LabelMode, type Labels, type PhotoLabel } from '../search/clutterLabels';
import { LAB_SHEET_MAX, labCategoryLines, labRefusal, labReviewIds, labTarget, readLabRequest, type LabMoveGroup, type LabRequest, type LabResult } from '../search/clutterLab';
import type { LibraryPhoto } from '../search/searchModel';
import { searchDeps } from '../search/session';
import { accountLabel } from '../shared/jobView';
import { extensionVersion, openPhotos, useAccount } from '../ui/hooks';
import { cachedRows, ClutterCache, packScores, scoresKey } from './clutterCache';
import { duplicateMoments } from '../duplicates/session';
import { AddField, ANSWER, CommitField, APPLIED, APPLY, APPLY_WAIT_MS, ASK, ChangePopup, CHUNK, Collapsible, HANDOVER_WAIT_MS, OptionalNumber, pause, PhotoGrid, SAMPLE, useOverlayKeys, usePageScrollLocked, ZOOM_PX, type BuffOption, type Nudge, type Preview, type Tile, type TitledBreakdown } from './clutterUi';

/** Where the page keeps its list (with exceptions) and its settings in this browser. */
const LIST_KEY = 'dev-clutter-axes-list';
const SAVED_KEY = 'dev-clutter-axes-tuning';
/** Where the page keeps the labels in this browser. */
const LABELS_KEY = 'dev-clutter-labels';
/** Where the page keeps how the labelling screen asks ([LabelMode]); all kinds unless switched to simple. */
const LABEL_MODE_KEY = 'dev-clutter-label-mode';
/** Where the page keeps the photos of its latest blind draws (rememberBlindDraw), for relabelling by number. */
const BLIND_DRAWS_KEY = 'dev-clutter-blind-draws';
/** Rows of each axis in a photo's hover card, best first. */
const SIDE_ROWS = 7;
/** Pairs listed in the grid of subject and setting, most photos first. */
const PAIR_ROWS = 60;

type Deps = ReturnType<typeof searchDeps>;

interface AxisWorked {
  photos: Map<string, LibraryPhoto>;
  scored: ScoredAxis[];
  /** Every photo's score for every description, raw and evened out, kept so a change of settings needs no AI work. */
  rows: Record<Scoring, Map<string, Float32Array>>;
  /** How the descriptions overlap over this library, for pooling. */
  overlap: Overlap;
}

/** The list and tuning kept in this browser, or the shipped ones; [notes] says what couldn't be used. */
function loadSaved(): { list: { categories: AxisCategory[]; exceptions: PairException[] }; tuning: AxisTuning; notes: string[] } {
  let listText: string | null;
  let text: string | null;
  try {
    listText = localStorage.getItem(LIST_KEY);
    text = localStorage.getItem(SAVED_KEY);
  } catch (error) {
    return { list: AXIS_LIST, tuning: STARTING_AXIS_TUNING, notes: [`This browser keeps no settings for the page (${String(error)}); they start afresh.`] };
  }
  const { list, notes } = readAxisList(listText, AXIS_LIST);
  try {
    const read = readAxisTuning(text, list.categories);
    return { list, tuning: read.tuning, notes: [...notes, ...read.notes] };
  } catch (error) {
    return { list, tuning: STARTING_AXIS_TUNING, notes: [...notes, `The saved settings couldn't be read (${error instanceof Error ? error.message : String(error)}); they start afresh.`] };
  }
}

/** Each description's words as the AI model reads them, kept so an edit only describes what is new. */
const described = new Map<string, Float32Array>();

/**
 * The AI work kept from one visit to the next (clutterCache.ts): a cache that can't be read or written
 * only costs time, so the page says so in the console and does the work.
 */
// globalThis: where there's no database at all, opening it fails as a read or write would, not the page.
const cache = () => new ClutterCache(globalThis.indexedDB);
const cacheProblem = (what: string) => (error: unknown) => console.warn(`Photo Cleaner: the clutter page's cache couldn't ${what}; the AI work is done afresh`, error);

async function describe(deps: Deps, categories: readonly AxisCategory[], say: (text: string) => void): Promise<ScoredAxis[]> {
  const wanted = [...new Set(categories.flatMap((c) => c.descriptions))].filter((d) => !described.has(d));
  if (wanted.length > 0) {
    const kept = await cache().texts(wanted).catch((error: unknown) => (cacheProblem('be read')(error), new Map<string, Float32Array>()));
    for (const [d, v] of kept) described.set(d, v);
  }
  const fresh = wanted.filter((d) => !described.has(d));
  const made = new Map<string, Float32Array>();
  for (const [i, d] of fresh.entries()) {
    const vector = await deps.embedQuery(d, (f) => say(`Loading the AI model… ${Math.round(f * 100)}%`));
    described.set(d, vector);
    made.set(d, vector);
    say(`Describing the categories to the AI model: ${i + 1} of ${fresh.length}`);
  }
  if (made.size > 0) await cache().keepTexts(made).catch(cacheProblem('keep the descriptions'));
  return categories.map((category) => ({ category, vectors: category.descriptions.map((d) => described.get(d)!) }));
}

/**
 * Every photo's scores for [scored], raw and evened out, and how the descriptions overlap, a chunk at a time so the page keeps drawing;
 * kept from before when the descriptions and every photo's fingerprint are the same.
 */
async function work(photos: Map<string, LibraryPhoto>, order: LibraryPhoto[], scored: ScoredAxis[], say: (text: string) => void): Promise<AxisWorked> {
  say('Looking for the scores kept from before…');
  await pause();
  const key = scoresKey(scored.flatMap((s) => s.category.descriptions), order);
  const kept = await cache().scores(key).catch((error: unknown) => (cacheProblem('be read')(error), null));
  if (kept) {
    say('Evening out the scores kept from before…');
    await pause();
    const raw = cachedRows(kept);
    return { photos, scored, rows: { raw, evened: evenedRows(raw) }, overlap: { width: kept.width, values: kept.overlap } };
  }
  const raw = new Map<string, Float32Array>();
  for (let i = 0; i < order.length; i += CHUNK) {
    for (const p of order.slice(i, i + CHUNK)) raw.set(p.mediaKey, descriptionScores(p.vector, scored));
    say(`Scoring photos: ${raw.size.toLocaleString()} of ${order.length.toLocaleString()}`);
    await pause();
  }
  say('Evening out the scores and measuring how the descriptions overlap…');
  await pause();
  const evened = evenedRows(raw);
  const overlap = descriptionOverlap([...evened.values()]);
  await cache().keepScores(packScores(key, raw, overlap.values, Date.now())).catch(cacheProblem('keep the scores'));
  return { photos, scored, rows: { raw, evened }, overlap };
}

/** A caption from [text], its category names and descriptions set apart as in the hover cards ([categoryParts]). */
function captionOf(text: string, scored: ScoredAxis[]): CaptionPart[] {
  return categoryParts(text, scored.map((s) => s.category)).map((p) => ({ text: p.text, kind: p.kind, term: p.term }));
}

/** [cards] with their category names set apart, those of [scored] lists ([categoryParts]). */
function named(cards: TitledBreakdown[], ...scored: ScoredAxis[][]): TitledBreakdown[] {
  const labels = scored.flatMap((list) => list.map((s) => s.category));
  return cards.map((c) => ({
    ...c,
    titleParts: c.title === null ? undefined : categoryParts(c.title, labels),
    fold: c.fold ? { ...c.fold, summaryParts: categoryParts(c.fold.summary, labels), parts: named(c.fold.parts, ...scored) } : undefined,
  }));
}

/** A photo's hover card: its outcome, then its best subjects and best settings, under [title] when there are two. */
function axisCards(row: Float32Array, scored: ScoredAxis[], overlap: Overlap, settings: AxisSettings, exceptions: readonly PairException[], title: string | null, shown: number | 'large' = SIDE_ROWS): TitledBreakdown[] {
  const b = axisBreakdown(row, scored, overlap, settings, exceptions, shown);
  // A part's name and its outcome on one line ("Now · Clutter: Products is clutter"); without a name, the outcome alone.
  return named([{ title: title === null ? b.outcome : `${title} · ${b.outcome}`, breakdown: { heading: '', rows: [], more: null } }, ...b.sides.map((s) => ({ title: s.title, side: true, breakdown: { heading: '', rows: s.rows, more: s.more > 0 ? `and ${s.more.toLocaleString()} more, lower` : null } }))], scored);
}

/** A photo's breakdown under two lists or settings ([names]), each part said once where they agree ([axisComparison]). */
function comparedCards(before: BreakdownInput, after: BreakdownInput, names: readonly [string, string]): TitledBreakdown[] {
  const c = axisComparison(before, after, names, SIDE_ROWS);
  const sideCard = (s: BreakdownSide): TitledBreakdown => ({ title: s.title, side: true, breakdown: { heading: '', rows: s.rows, more: s.more > 0 ? `and ${s.more.toLocaleString()} more, lower` : null } });
  const empty = { heading: '', rows: [], more: null };
  // Three sections: what each part comes to, each side that changed, and what didn't change; one divider between sections.
  const changed = c.changed.flatMap((s): TitledBreakdown[] => [{ title: s.title, breakdown: empty }, { title: s.before, side: true, joined: true, breakdown: { heading: '', rows: s.beforeRows, more: null } }, { title: '↓', side: true, joined: true, breakdown: empty }, { title: s.after, side: true, joined: true, breakdown: { heading: '', rows: s.rows, more: null } }]);
  const rest: TitledBreakdown[] = c.unchangedLine === null ? c.unchanged.map(sideCard) : [{ title: null, breakdown: empty, fold: { summary: c.unchangedLine, parts: c.unchanged.map(sideCard) } }];
  const lines = (texts: string[], first: boolean) => texts.map((line, i): TitledBreakdown => ({ title: line, side: true, joined: !first || i > 0, breakdown: empty }));
  const outcome = [...lines(c.summary.before, true), ...(c.summary.after ? [{ title: '↓', side: true, joined: true, breakdown: empty }, ...lines(c.summary.after, false)] : [])];
  return named([...outcome, ...changed, ...rest], before.scored, after.scored);
}

/** What a tab of finds needs: the photos to show, and for a clutter category's, what a buff needs to weigh its effect. */
interface AxisFinds {
  account: string;
  /** The side the photos were counted on: by subject and setting, or in a check (Screenshots). */
  side: Side;
  title: string;
  settingsLine: string;
  photos: { mediaKey: string; thumbUrl: string | null; caption: CaptionPart[]; row: Float32Array }[];
  scored: ScoredAxis[];
  overlap: Overlap;
  /** The scoring the rows and settings are for, which buffs applied from the tab go to. */
  scoring: Scoring;
  settings: AxisSettings;
  exceptions: PairException[];
  buffing: { rows: Map<string, Float32Array>; photos: Map<string, ClutterPhoto>; thumbUrls: Map<string, string | null> } | null;
}

/** A buff applied in a tab, sent to the page that opened it ([APPLY]): its changes, each added to the weight there, for [scoring]. */
interface AppliedChanges {
  type: typeof APPLY;
  id: string;
  scoring: Scoring;
  changes: WeightChange[];
}

const scoringName = (s: Scoring) => (s === 'raw' ? 'raw scores' : 'evened-out scores');

/** A contact sheet's columns, and each photo's cell (px): numbered photos, to review away from the page. */
const SHEET_COLUMNS = 6;
// 192 px: still recognisable, and a sheet half the size of one at 256 for the agent reading it (lab/).
const SHEET_CELL = 192;
/** A zoom sheet's columns and photos (a lab request's zoom): a few at a time, large. */
const ZOOM_COLUMNS = 2;
const ZOOM_PER_SHEET = 4;

/**
 * [photos] as one numbered contact sheet (PNG), their previews fitted into square cells of [cell] px in [columns];
 * "no preview" where there is none. Larger cells for a closer look (a lab request's zoom).
 */
async function contactSheet(photos: { number: number; url: string | null }[], cell = SHEET_CELL, columns = SHEET_COLUMNS): Promise<Blob> {
  const rows = Math.ceil(photos.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * cell;
  canvas.height = rows * cell;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser can’t draw a contact sheet');
  g.fillStyle = '#111';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, p] of photos.entries()) {
    const [x, y] = [(i % columns) * cell, Math.floor(i / columns) * cell];
    if (p.url) {
      const image = new Image();
      image.src = p.url;
      await image.decode();
      const fit = Math.min((cell - 4) / image.width, (cell - 4) / image.height);
      const [w, h] = [image.width * fit, image.height * fit];
      g.drawImage(image, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    } else {
      g.fillStyle = '#888';
      g.font = '16px sans-serif';
      g.fillText('no preview', x + 8, y + cell / 2);
    }
    g.fillStyle = '#000c';
    g.fillRect(x + 2, y + 2, 58, 30);
    g.fillStyle = '#ff0';
    g.font = 'bold 22px sans-serif';
    g.fillText(`#${p.number}`, x + 6, y + 25);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The contact sheet couldn’t be saved'))), 'image/png'));
}

/**
 * A category's review files: a numbered contact sheet each of Riskiest, Lowest scores and Just missed
 * (numbered through), and one text file with every photo's scores.
 */
async function reviewFiles(count: CategoryCount, worked: AxisWorked, rows: Map<string, Float32Array>, settings: AxisSettings, settingsLine: string, exceptions: PairException[], preview: Preview): Promise<{ name: string; blob: Blob }[]> {
  const samples = categorySamples(count, SAMPLE);
  const id = count.category.id;
  // A small category (no more photos than a sample) has nothing beyond Best: then Best is reviewed instead.
  const groups = count.trashable.length <= SAMPLE
    ? ([['Best', samples.best], ['Just missed', samples.justMissed]] as const)
    : ([['Riskiest', samples.riskiest], ['Lowest scores', samples.lowestScores], ['Just missed', samples.justMissed]] as const);
  let number = 0;
  const files: { name: string; blob: Blob }[] = [];
  const reviewed = [];
  for (const [sample, photos] of groups) {
    const sheet = [];
    for (const photo of photos) {
      number++;
      const thumbUrl = worked.photos.get(photo.mediaKey)?.thumbUrl ?? null;
      sheet.push({ number, url: thumbUrl ? await preview(thumbUrl, SHEET_CELL) : null });
      const row = rows.get(photo.mediaKey);
      if (!row) throw new Error('A counted photo is missing from the scores');
      reviewed.push({ number, sample, caption: photoCaption(photo), breakdown: axisBreakdown(row, worked.scored, worked.overlap, settings, exceptions, SIDE_ROWS) });
    }
    if (sheet.length > 0) files.push({ name: `${id}-${sample.toLowerCase().replace(/ /g, '-')}.png`, blob: await contactSheet(sheet) });
  }
  files.push({ name: `${id}.txt`, blob: new Blob([reviewText(countLine(count), settingsLine, reviewed)], { type: 'text/plain' }) });
  return files;
}

/** Chrome's folders (File System Access), which the DOM types this project builds with don't name. */
interface WritableFolder {
  getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>; getFile(): Promise<File> }>;
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<WritableFolder>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

/** Chrome's folder picker. */
function pickFolder(): Promise<WritableFolder> {
  return (window as unknown as { showDirectoryPicker(options: { mode: 'readwrite' }): Promise<WritableFolder> }).showDirectoryPicker({ mode: 'readwrite' });
}

/** [content] written to [name] in [folder], replacing what was there. */
async function writeFile(folder: WritableFolder, name: string, content: Blob | string): Promise<void> {
  const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
  await writable.write(typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : content);
  await writable.close();
}

/**
 * The lab folder, kept in a small database of the developer page's own (a folder can't be kept in
 * localStorage), so it is found again after a reload; Chrome then asks once more for permission.
 */
const LAB_DB = 'dev-clutter-lab';
function labStore<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(LAB_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('folder');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = act(open.result.transaction('folder', mode).objectStore('folder'));
      request.onsuccess = () => {
        resolve(request.result);
        open.result.close();
      };
      request.onerror = () => reject(request.error);
    };
  });
}
const keepLabFolder = (folder: WritableFolder) => labStore('readwrite', (s) => s.put(folder, 'lab'));
const findLabFolder = () => labStore<WritableFolder | undefined>('readonly', (s) => s.get('lab') as IDBRequest<WritableFolder | undefined>);

/** How often the page looks for a new request in the lab folder (ms). */
const LAB_POLL_MS = 3000;

/** A clutter or keep category's photos: samples, and Open all, where a clutter one's can be buffed. */
function AxisCategoryCard({ count, worked, rows, settings, exceptions, preview, openAll }: { count: CategoryCount; worked: AxisWorked; rows: Map<string, Float32Array>; settings: AxisSettings; exceptions: PairException[]; preview: Preview; openAll: () => void }) {
  const [open, setOpen] = useState(false);
  const samples = useMemo(() => (open ? categorySamples(count, SAMPLE) : null), [open, count]);
  const tile = (p: CategoryPhoto): Tile => {
    const row = rows.get(p.mediaKey);
    if (!row) throw new Error('A counted photo is missing from the scores');
    return { mediaKey: p.mediaKey, thumbUrl: worked.photos.get(p.mediaKey)?.thumbUrl ?? null, caption: captionOf(photoCaption(p), worked.scored), breakdowns: () => axisCards(row, worked.scored, worked.overlap, settings, exceptions, null), everything: () => axisCards(row, worked.scored, worked.overlap, settings, exceptions, null, 'large') };
  };
  const grid = (title: string, photos: CategoryPhoto[]) =>
    photos.length > 0 && (
      <>
        <p className="clutter-sample-title">{title}</p>
        <PhotoGrid tiles={photos.map(tile)} preview={preview} />
      </>
    );
  const c = count.category as AxisCategory;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{countLine(count)}</summary>
      {samples && (
        <>
          <div className="buttons clutter-show-all">
            <button onClick={openAll}>Open all {count.trashable.length.toLocaleString()} in a new tab</button>            {c.verdict === 'clutter' && (
              <span className="muted small">
                There, a photo opened large can be buffed out of {c.label}: {c.axis === 'form' ? 'a form of its check that isn’t clutter (Not a screenshot)' : 'a subject or setting that keeps it'} strengthened just enough, shown first for every photo it changes.
              </span>
            )}
          </div>
          {grid('Best: the highest scores (Search will show these first)', samples.best)}
          {grid('Riskiest: the smallest leads that still made it (Search will show these last, below “Show all”)', samples.riskiest)}
          {grid('Lowest scores still counted (developer page only, to compare with Riskiest)', samples.lowestScores)}
          {grid('Just missed: too close to the next of its kind to count; would be clutter here if it counted (developer page only)', samples.justMissed)}
        </>
      )}
    </details>
  );
}

/** The columns of the kinds' grid (`.clutter-kinds` in app.css): ↑ ↓ move a whole row. */
const KIND_COLUMNS = 2;

/**
 * Labelling, one photo at a time, from the keyboard, all on one screen (2026-11-24). First the answer: Space (or
 * K) keep, Delete clutter, U unsure, which saves. After Keep or Clutter, what should have decided the photo: that
 * side's kinds ([kindChoices]), the AI's best guess highlighted; Enter or the same key again, a click, or a kind's
 * key saves with it; Backspace goes back to the answer. Simple mode saves the answer alone. Backspace on the answer
 * goes back a photo, Shift+Delete clears an answer, → skips a photo labelled before, ← goes back a photo (both only on the answer, as the arrows move between kinds). (2026-11-25: clutter was Enter, which also confirmed, so Enter on
 * a keeper picked with the arrows switched to Clutter instead; Enter now only confirms.) (Taste, from before, is no
 * longer offered here; its labels still count as taste.)
 */
function LabelScreen({ mode, onMode, queue, labels, kinds, guesses, thumbUrl, preview, onLabel, onSkip, onUndo, onClear, onClose }: {
  /** With the kind after the answer, or simple: Keep, Clutter or Unsure alone; switched on the screen, for anyone. */
  mode: LabelMode;
  onMode: (mode: LabelMode) => void;
  /** The photos still to label, in order. */
  queue: string[];
  labels: Labels;
  /** What a photo can be ([isLabelKind]), by id, with its side. */
  kinds: { id: string; label: string; verdict: Verdict }[];
  guesses: (key: string) => string[];
  thumbUrl: (key: string) => string | null;
  preview: Preview;
  onLabel: (key: string, label: PhotoLabel) => void;
  /** Moves on past a photo labelled before, its label as it was; Back returns to it. */
  onSkip: (key: string) => void;
  /** Goes back to the photo labelled last here, its label kept; false when there is none. */
  onUndo: () => boolean;
  /** Takes the photo's label away: unlabelled, as if never answered. */
  onClear: (key: string) => void;
  onClose: () => void;
}) {
  const key = queue[0] ?? null;
  const simple = mode === 'simple';
  // Keep or Clutter pressed, its kinds shown; null while the answer is asked.
  const [asking, setAsking] = useState<'keep' | 'clutter' | null>(null);
  const [selected, setSelected] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const order = useMemo(() => (key ? guesses(key) : []), [key, guesses]);
  const choices = useMemo(() => (asking ? kindChoices(asking, order, kinds) : []), [asking, order, kinds]);
  const label = key ? labels[key] : undefined;
  // Gone back to a photo labelled before: its answer is marked, and its kind when that answer's kinds are shown.
  const earlier = useMemo(() => earlierAnswer(label, choices.map((c) => c.kind), simple), [label, choices, simple]);
  const earlierHere = asking !== null && earlier.answer === asking ? earlier.chosen : null;
  useEffect(() => {
    setAsking(null);
  }, [key, simple]);
  useEffect(() => {
    setSelected(earlierHere ?? 0);
  }, [key, asking, earlierHere]);
  const choiceButtons = useRef<(HTMLButtonElement | null)[]>([]);
  // The highlighted kind is always in view, also when the arrows move it past the column's scrolled edge.
  useEffect(() => {
    choiceButtons.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected, asking]);
  useEffect(() => {
    setUrl(null);
    if (!key) return;
    let alive = true;
    const own = thumbUrl(key);
    if (own) preview(own, ZOOM_PX).then((u) => alive && setUrl(u), (error: unknown) => console.warn('Photo Cleaner: a preview didn’t load', error));
    // The next one, so it is ready.
    const next = queue[1] ? thumbUrl(queue[1]) : null;
    if (next) preview(next, ZOOM_PX).catch((error: unknown) => console.warn('Photo Cleaner: a preview didn’t load', error));
    return () => {
      alive = false;
    };
  }, [key, queue, thumbUrl, preview]);
  const save = (verdict: 'keep' | 'clutter' | 'unsure', kind: string | null) => {
    if (key) onLabel(key, { verdict, kind });
  };
  // Keep or Clutter: in simple mode saved at once; otherwise its kinds are shown, and pressed again it saves with the highlighted one.
  const answer = (verdict: 'keep' | 'clutter') => {
    if (simple) save(verdict, null);
    else if (asking === verdict) save(verdict, choices[selected]!.kind);
    else setAsking(verdict);
  };
  usePageScrollLocked();
  useOverlayKeys((e) => {
    const k = e.key.toLowerCase();
    // A button tapped last keeps the focus: Enter or Space would click it too, and label a second photo. The arrows would scroll.
    if (['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
    if (e.key === 'Escape') onClose();
    else if (e.key === 'Backspace') {
      if (asking) setAsking(null);
      else onUndo();
    } else if (!key) return;
    else if (e.key === 'Delete' && e.shiftKey) {
      if (earlier.answer !== null) onClear(key);
    } else if (k === 'k' || e.key === ' ') answer('keep');
    else if (e.key === 'Delete') answer('clutter');
    else if (k === 'u') save('unsure', null);
    // → on the answer passes over a photo labelled before, its label kept (2026-11-26: going through a list again
    // needed Space or Del for each). Not on a new photo: skipping the hard ones of a random sample would flatter it.
    else if (!asking && e.key === 'ArrowRight') {
      if (earlier.answer !== null) onSkip(key);
    } else if (!asking && e.key === 'ArrowLeft') onUndo();
    else if (!asking) return;
    // Enter confirms the highlighted kind, on either side.
    else if (e.key === 'Enter') save(asking, choices[selected]!.kind);
    else if (e.key === 'ArrowDown') setSelected((s) => moveInGrid(s, 'down', choices.length, KIND_COLUMNS));
    else if (e.key === 'ArrowUp') setSelected((s) => moveInGrid(s, 'up', choices.length, KIND_COLUMNS));
    else if (e.key === 'ArrowLeft') setSelected((s) => moveInGrid(s, 'left', choices.length, KIND_COLUMNS));
    else if (e.key === 'ArrowRight') setSelected((s) => moveInGrid(s, 'right', choices.length, KIND_COLUMNS));
    else {
      // A kind's key saves with it.
      const chosen = choices.find((c) => c.key === k);
      if (chosen) save(asking, chosen.kind);
    }
  });
  const done = Object.keys(labels).length;
  // The kind given with the earlier answer, on that answer's button only.
  const earlierKind = label && (label.verdict === 'keep' || label.verdict === 'clutter') && label.kind !== null ? (label.kind === OTHER_KIND ? 'Other' : kinds.find((c) => c.id === label.kind)?.label ?? null) : null;
  const answerClass = (verdict: 'keep' | 'clutter' | 'unsure') => `clutter-answer ${verdict}${earlier.answer === verdict ? ' chosen' : ''}${asking === verdict ? ' asking' : ''}`;
  return (
    <div className="viewer clutter-labeller" role="dialog" aria-modal="true" aria-label="Label photos">
      <div className="clutter-viewer-body">
        {/* The count and question over the photo only, so the answers beside it get the full height. */}
        <div className="clutter-label-main">
          <div className="clutter-label-info">
            <span className="mono">{key ? `${queue.length.toLocaleString()} to go` : 'All labelled'} · {done.toLocaleString()} labelled in all</span>
            <span className="muted">If Photo Cleaner offered this for the trash, would that be fine, or wrong?</span>
          </div>
          <div className="viewer-photo">{key ? (url ? <img src={url} alt="" /> : <span className="muted">Loading…</span>) : <span className="muted">Nothing left to label in this sample. Esc closes.</span>}</div>
        </div>
        {/* Beside the photo, so the eyes don't leave it; large, so a touch screen works as well as the keys. */}
        <div className="clutter-label-side">
          {/* For anyone, off by default: simple asks only keep, clutter or unsure. */}
          <label className="clutter-switch">
            <input type="checkbox" role="switch" checked={simple} onChange={(e) => onMode(e.target.checked ? 'simple' : 'kinds')} />
            <span className="clutter-switch-track" aria-hidden="true" />
            Simple mode
          </label>
          {earlier.answer !== null && <p className="clutter-earlier small">Labelled before: your answer is marked ✓. Give it again, another, or clear it (Shift+Delete).</p>}
          <button className={answerClass('keep')} disabled={!key} onClick={() => answer('keep')}>
            <kbd>Space</kbd> Keep. Don't offer{earlier.answer === 'keep' && ' ✓'}
            {earlier.answer === 'keep' && earlierKind && <span className="clutter-answer-kind"> · {earlierKind}</span>}
          </button>
          <button className={answerClass('clutter')} disabled={!key} onClick={() => answer('clutter')}>
            <kbd>Del</kbd> Clutter. Fine to offer for the trash{earlier.answer === 'clutter' && ' ✓'}
            {earlier.answer === 'clutter' && earlierKind && <span className="clutter-answer-kind"> · {earlierKind}</span>}
          </button>
          <button className={answerClass('unsure')} disabled={!key} onClick={() => save('unsure', null)}>
            <kbd>U</kbd> Unsure: people differ{earlier.answer === 'unsure' && ' ✓'}
          </button>
          {asking && (
            <fieldset className={`clutter-answer clutter-kinds-box ${asking}`} disabled={!key}>
              <legend>{asking === 'keep' ? 'Keep: what should have kept it?' : 'Clutter: what should have offered it?'}</legend>
              <div className="clutter-kinds" role="group" aria-label={asking === 'keep' ? 'What should have kept it' : 'What should have offered it'}>
                {choices.map((c, i) => (
                  <button key={c.kind} ref={(el) => { choiceButtons.current[i] = el; }} className={`${i === selected ? 'selected' : ''}${i === earlierHere ? ' chosen' : ''}`} onClick={() => save(asking, c.kind)}>
                    <kbd>{c.key}</kbd> {c.label}{i === earlierHere && ' ✓'}
                  </button>
                ))}
              </div>
              <p className="muted small clutter-kinds-note">
                Enter, or {asking === 'keep' ? 'Space' : 'Del'} again, saves the highlighted one, the AI&apos;s best guess unless the arrows move it; a kind&apos;s key or a click saves with that kind. Backspace goes back to the answer.
              </p>
            </fieldset>
          )}
          <div className="clutter-label-nav">
            <button onClick={() => (asking ? setAsking(null) : onUndo())}><kbd>⌫</kbd>{!asking && <kbd>←</kbd>} {asking ? 'Back to the answer' : 'Back'}</button>
            <button disabled={!key || earlier.answer === null} onClick={() => key && onSkip(key)}><kbd>→</kbd> Skip, as it is</button>
            <button disabled={!key || earlier.answer === null} onClick={() => key && onClear(key)}><kbd>Shift+Del</kbd> Clear answer</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The editor of subjects, settings, their weights and the exceptions; nothing counts until saved and applied. */
interface AxisEditing {
  draft: Draft;
  weights: DraftWeights;
  exceptions: PairException[];
}

const AXIS_HEADINGS = {
  subject: 'Subjects: what a photo is of',
  setting: 'Settings: where it is',
  baseline: 'Baseline: what any photo scores (for the floor; decides nothing on its own)',
};

function AxisEditor({ editing, edited, onChange, settings, scoring, problems, working, canSave, onSave, onDiscard }: {
  editing: AxisEditing;
  /** Whether there are edits not yet applied, to save or discard. */
  edited: boolean;
  onChange: (e: AxisEditing) => void;
  settings: AxisSettings;
  scoring: Scoring;
  problems: string[];
  working: string | null;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { draft, weights, exceptions } = editing;
  const [newAxis, setNewAxis] = useState<Axis>('subject');
  const [newVerdict, setNewVerdict] = useState<Verdict>('neutral');
  const [newCheck, setNewCheck] = useState('');
  const [pair, setPair] = useState<PairException>({ subject: '', setting: '', verdict: 'keep' });
  const list = (next: Draft) => onChange({ ...editing, draft: next });
  const weighted = (next: DraftWeights) => onChange({ ...editing, weights: next });
  const axisSelect = (value: Axis, label: string, set: (a: Axis) => void) => (
    <select aria-label={label} value={value} onChange={(e) => set(e.target.value as Axis)}>
      <option value="subject">subject</option>
      <option value="setting">setting</option>
      <option value="form">form (in a check)</option>
      <option value="baseline">baseline</option>
    </select>
  );
  const verdictSelect = (axis: Axis, value: Verdict, label: string, set: (v: Verdict) => void) => (
    <select aria-label={label} value={value} onChange={(e) => set(e.target.value as Verdict)}>
      {verdictChoices(axis, value).map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
  const named = (id: string) => draft.find((c) => c.id === id)?.label ?? id;
  const ofAxis = (axis: Axis) => draft.filter((c) => c.axis === axis);
  const checks = draftChecks(draft);
  return (
    <div className="clutter-editor">
      <p className="muted small">
        A subject is what a photo is of, a setting where it is; each photo gets its best of each. A verdict says what a subject or setting means when it counts: clutter,
        keep or neutral. Keep wins over clutter; an exception decides one exact pair. Weights are added to scores before photos are compared (these are the weights for{' '}
        {scoringName(scoring)}; each scoring keeps its own); an empty minimum lead uses its axis&apos;s. Edits count only once saved and applied (the lab measures against what is applied): Save shows what they do,
        to apply or go back to; Discard drops them.
      </p>
      <div className="buttons clutter-clear-weights">
        <button onClick={() => weighted({ categoryWeights: {}, descriptionWeights: {}, margins: {} })}>Clear weights and minimum leads</button>
      </div>
      <datalist id="clutter-checks">
        {checks.map((check) => <option key={check} value={check} />)}
      </datalist>
      {draftSections(draft, AXIS_HEADINGS).map((section) => (
        <details key={section.key} className="clutter-axis-part">
          <summary className="clutter-axis-heading">{section.title}</summary>
          {section.categories.length === 0 && <p className="muted small">None yet: add one with Add at the bottom, choosing “{section.axis}”.</p>}
          {section.categories.map((c) => (
            <Collapsible key={c.id} heading={draftHeading(c)} kind={c.verdict === 'clutter' ? 'clutter' : c.verdict === 'keep' ? 'counterweight' : 'neutral'} startOpen={c.descriptions.length === 0} closedNote={c.descriptions.map((d) => d.text).join(' · ')}>
              <div className="clutter-tuning-head">
                <input type="text" className="clutter-edit-label" aria-label="Category name" value={c.label} onChange={(e) => list(renameCategory(draft, c.id, e.target.value))} />
                {axisSelect(c.axis, `${c.label} is a`, (a) => list(setAxis(draft, c.id, a)))}
                {c.axis === 'form' && (
                  <label className="small">check <CommitField list="clutter-checks" className="clutter-edit-check" label={`${c.label}'s check`} value={c.check ?? ''} onCommit={(text) => list(setCheck(draft, c.id, text))} /></label>
                )}
                {verdictSelect(c.axis, c.verdict, `${c.label}'s verdict`, (v) => list(setVerdict(draft, c.id, v)))}
                <label className="small">weight <OptionalNumber value={weights.categoryWeights[c.id]} label={`${c.label} weight`} placeholder="0" onChange={(w) => weighted({ ...weights, categoryWeights: withWeightOrNone(weights.categoryWeights, c.id, w) })} /></label>
                {c.axis !== 'baseline' && (
                  <label className="small">minimum lead <OptionalNumber value={weights.margins[c.id]} label={`${c.label} minimum lead`} placeholder={String(settings[c.axis].margin)} onChange={(m) => weighted({ ...weights, margins: withLead(weights.margins, c.id, m) })} /></label>
                )}
                <button aria-label={`Remove ${c.label}`} onClick={() => list(removeCategory(draft, c.id))}>Remove</button>
              </div>
              <div className="clutter-edit-descriptions">
                {c.descriptions.map((d, i) => (
                  <div key={`${i} ${d.was ?? ''}`} className="clutter-edit-description">
                    <OptionalNumber value={weights.descriptionWeights[d.text]} label={`${d.text} weight`} placeholder="0" onChange={(w) => weighted({ ...weights, descriptionWeights: withWeightOrNone(weights.descriptionWeights, d.text, w) })} />
                    <input type="text" aria-label="Description" value={d.text} onChange={(e) => onChange({ ...editing, draft: rewordDescription(draft, c.id, i, e.target.value), weights: weightReworded(weights, d.text, e.target.value) })} />
                    <select aria-label={`Move “${d.text}” to`} value="" onChange={(e) => list(moveDescription(draft, c.id, i, e.target.value))}>
                      <option value="" disabled>Move to…</option>
                      {draft.filter((o) => o.id !== c.id).map((o) => <option key={o.id} value={o.id}>{o.label} ({o.axis})</option>)}
                    </select>
                    <button aria-label={`Remove “${d.text}”`} onClick={() => list(removeDescription(draft, c.id, i))}>×</button>
                  </div>
                ))}
                <AddField label="Add description" placeholder="a new description" onAdd={(text) => list(addDescription(draft, c.id, text))} />
              </div>
            </Collapsible>
          ))}
        </details>
      ))}
      <div className="clutter-tuning-category">
        <AddField label="Add" placeholder="a new category's name" onAdd={(label) => list(addAxisCategory(draft, label, newAxis, newVerdict, newCheck))}>
          {axisSelect(newAxis, 'The new one is a', setNewAxis)}
          {verdictSelect(newAxis, newVerdict, "The new one's verdict", setNewVerdict)}
          {newAxis === 'form' && <input type="text" list="clutter-checks" className="clutter-edit-check" aria-label="The new one's check" placeholder="its check" value={newCheck} onChange={(e) => setNewCheck(e.target.value)} />}
        </AddField>
      </div>
      <details className="clutter-axis-part">
        <summary className="clutter-axis-heading">Exceptions: what one exact pair comes to</summary>
        {exceptions.length === 0 && <p className="muted small">None yet.</p>}
        {exceptions.map((e, i) => (
          <div key={`${e.subject} ${e.setting}`} className="clutter-edit-description">
            <span className="small">{named(e.subject)} in {named(e.setting)} →</span>
            <select aria-label="The pair's verdict" value={e.verdict} onChange={(ev) => onChange({ ...editing, exceptions: exceptions.map((x, j) => (j === i ? { ...x, verdict: ev.target.value as 'clutter' | 'keep' } : x)) })}>
              <option value="clutter">clutter</option>
              <option value="keep">keep</option>
            </select>
            <button aria-label="Remove the exception" onClick={() => onChange({ ...editing, exceptions: exceptions.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <div className="clutter-add">
          <select aria-label="Subject" value={pair.subject} onChange={(e) => setPair({ ...pair, subject: e.target.value })}>
            <option value="" disabled>Subject…</option>
            {ofAxis('subject').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <span className="small">in</span>
          <select aria-label="Setting" value={pair.setting} onChange={(e) => setPair({ ...pair, setting: e.target.value })}>
            <option value="" disabled>Setting…</option>
            {ofAxis('setting').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select aria-label="Verdict" value={pair.verdict} onChange={(e) => setPair({ ...pair, verdict: e.target.value as 'clutter' | 'keep' })}>
            <option value="clutter">clutter</option>
            <option value="keep">keep</option>
          </select>
          <button disabled={pair.subject === '' || pair.setting === ''} onClick={() => onChange({ ...editing, exceptions: [...exceptions, pair] })}>Add exception</button>
        </div>
      </details>
      {/* For every part above, not only the exceptions: set apart by a rule across the whole list. */}
      <div className="clutter-edit-footer">
        {problems.map((p) => <p key={p} className="warn small">{p}</p>)}
        {!canSave && <p className="muted small">Save works once the library is read: new words need the AI model.</p>}
        {working && <p className="working" role="status"><span className="spinner-inline" />{working}</p>}
        <div className="buttons">
          <button className="primary" disabled={!edited || !canSave || working !== null} onClick={onSave}>Save categories…</button>
          <button disabled={!edited || working !== null} onClick={onDiscard}>Discard</button>
          <span className="muted small">{edited ? 'Edits to the categories not applied yet.' : 'No edits: change anything in the categories, then Save.'}</span>
        </div>
      </div>
    </div>
  );
}

/** [record] with [key] set to [value], or without it when undefined or 0. */
function withWeightOrNone(record: Record<string, number>, key: string, value: number | undefined): Record<string, number> {
  const rest = Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
  return value === undefined || value === 0 ? rest : { ...rest, [key]: value };
}

/** [record] with [key]'s own minimum lead set to [value], or left out (its axis's) when undefined; 0 is kept. */
function withLead(record: Record<string, number>, key: string, value: number | undefined): Record<string, number> {
  const rest = Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
  return value === undefined ? rest : { ...rest, [key]: value };
}

/** The list, weights and leads, always open to editing ([children]: the editor), then how it differs from the shipped list, folded away. */
function AxisListView({ list, changes, copied, open, onToggle, onCopy, canReset, onReset, children }: {
  list: { categories: AxisCategory[]; exceptions: PairException[] };
  /** Whether the list is open: kept by the page. */
  open: boolean;
  onToggle: (open: boolean) => void;
  changes: string[];
  copied: string | null;
  onCopy: () => void;
  canReset: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <details className="clutter-categories" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>Categories: {axisListSummary(list)}{changes.length > 0 && ' (edited)'}</summary>
      {children}
      {changes.length > 0 && (
        <details className="clutter-list-changes">
          <summary>Your changes to the shipped list · {changes.length.toLocaleString()} <span className="muted small">(kept in this browser only)</span></summary>
          <ul className="small">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="buttons">
            <button onClick={onCopy}>Copy changes</button>
            <button disabled={!canReset} onClick={onReset}>Reset to the shipped list…</button>
            {copied && <span className="muted small">{copied}</span>}
          </div>
        </details>
      )}
    </details>
  );
}

/** The photos a change makes leave, join or move, as grids with hover cards for now and after, and Stay under those leaving. */
function changeGrids(effects: { leaves: AxisChange[]; joins: AxisChange[]; moves: AxisChange[] }, lists: AxisLists, tile: (change: AxisChange) => Tile): { key: string; title: string; open: boolean; tiles: Tile[] }[] {
  return [
    ...axisGroups(effects.leaves, lists.before, (c) => c.before.category!).map((g) => ({ key: `leave ${g.key}`, title: `Leave ${g.title}`, open: true, tiles: g.changes.map(tile) })),
    ...axisGroups(effects.joins, lists.after, (c) => c.after.category!).map((g) => ({ key: `join ${g.key}`, title: `Join ${g.title}`, open: true, tiles: g.changes.map(tile) })),
    ...(effects.moves.length === 0 ? [] : [{ key: 'moves', title: `Moved between suggestions · ${effects.moves.length.toLocaleString()}`, open: false, tiles: effects.moves.map(tile) }]),
  ];
}

/** Pairs of subject and setting: what each comes to, how many photos, and a button to see them. */
function PairTable({ rows, onOpen }: { rows: PairRow[]; onOpen: (row: PairRow) => void }) {
  return (
    <table className="clutter-pairs">
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.subject} ${r.setting}`}>
            <td>{r.subject}</td>
            <td className="muted">in</td>
            <td>{r.setting}</td>
            <td className={`clutter-pair-${r.verdict}`}>{r.verdict === 'none' ? 'neither' : r.verdict === 'keep' ? 'kept' : 'clutter'}</td>
            <td className="mono">{r.count.toLocaleString()}</td>
            <td><button onClick={() => onOpen(r)}>Open</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The developer page: clutter by subject and setting. */
export function AxesPage() {
  const { answer } = useAccount();
  const account = new URLSearchParams(location.search).get('account') ?? answer?.account?.fingerprint ?? null;
  const deps = useMemo(() => (account === null ? null : searchDeps(account)), [account]);
  const [loaded] = useState(loadSaved);
  const [list, setList] = useState(loaded.list);
  const [tuning, setTuning] = useState<AxisTuning>(loaded.tuning);
  const { scoring } = tuning;
  const settings = tuning.settings[scoring];
  // The Settings card edits a draft: nothing counts (and the lab measures against what is applied) until
  // Save shows what it changes and Apply puts it in place.
  const [cardDraft, setCardDraft] = useState<AxisTuning | null>(null);
  const [cardSaving, setCardSaving] = useState(false);
  // Kept from one redraw to the next, so what Save shows isn't worked out again (and its photos redrawn) each time.
  const card = useMemo(() => (cardDraft ? withCardSettings(tuning, cardDraft) : tuning), [tuning, cardDraft]);
  const cardScoring = card.scoring;
  const cardSettings = card.settings[cardScoring];
  const cardEdits = useMemo(() => (cardDraft ? tuningEdits(tuning, withCardSettings(tuning, cardDraft)) : []), [tuning, cardDraft]);
  const setCard = (change: (t: AxisTuning) => AxisTuning) => setCardDraft((d) => change(d ? withCardSettings(tuning, d) : tuning));
  const setSettings = (change: (s: AxisSettings) => AxisSettings) => setCard((t) => ({ ...t, settings: { ...t.settings, [t.scoring]: change(t.settings[t.scoring]) } }));
  const [worked, setWorked] = useState<AxisWorked | null>(null);
  // The library's moments of near-duplicates (the Duplicates review's groups), for copying labels.
  const [moments, setMoments] = useState<string[][]>([]);
  const [momentsProblem, setMomentsProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [minPhotos, setMinPhotos] = useState(20);
  // The pairs of subject and setting all in one list, or grouped by their subject or their setting.
  const [pairsBy, setPairsBy] = useState<ContentAxis | null>(null);
  // Pooling and the floor turned off, per scoring, to bring back when they are turned on again.
  const [lastOn, setLastOn] = useState<Partial<Record<`${Scoring} ${'pooling' | 'baseline'}`, number>>>({});
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(tuning));
      const text = saveAxisList(list, AXIS_LIST);
      if (text === null) localStorage.removeItem(LIST_KEY);
      else localStorage.setItem(LIST_KEY, text);
      setSaveProblem(null);
    } catch (error) {
      setSaveProblem(`These settings couldn't be kept in this browser (${String(error)}); use Copy changes before closing the page.`);
    }
  }, [tuning, list]);

  // No Google Photos tab yet, so no account: the page says so with a link, and reads the library once one is open.
  const [needsPhotos, setNeedsPhotos] = useState(false);
  const workOut = async () => {
    setWorked(null);
    setProblem(null);
    setNeedsPhotos(deps === null);
    if (!deps) return;
    try {
      setProgress('Reading the library…');
      const library = await deps.loadLibrary();
      if (library.blocked) throw new Error(`The library scan can't be used (${library.blocked}): check for new photos on the Scan tab first.`);
      const scored = await describe(deps, list.categories, setProgress);
      setWorked(await work(library.photos, [...library.photos.values()], scored, setProgress));
      // Near-duplicates take a label given to one of them (withDuplicates); without them, labels are only not copied.
      if (account !== null) duplicateMoments(account).then((m) => { setMoments(m); setMomentsProblem(null); }, (error: unknown) => setMomentsProblem(`The near-duplicates couldn't be read (${error instanceof Error ? error.message : String(error)}); labels aren't copied to them.`));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current || (deps === null && answer === undefined)) return;
    started.current = true;
    void workOut();
  });
  useEffect(() => {
    if (needsPhotos && deps) void workOut();
  }, [needsPhotos, deps]);

  // The categories the photos were scored against: the list when worked out, or since applied.
  const inUse = useMemo(() => (worked ? worked.scored.map((s) => s.category) : list.categories), [worked, list]);
  const rows = worked ? worked.rows[scoring] : null;
  const matches = useMemo(() => (worked && rows ? [...rows].map(([key, row]) => matchAxes(key, row, worked.scored, worked.overlap, settings)) : null), [worked, rows, settings]);
  const counts = useMemo(() => (worked && matches ? countAxes(matches, inUse, list.exceptions, worked.photos, settings) : null), [worked, matches, inUse, list.exceptions, settings]);
  const pairs = useMemo(() => (matches ? pairRows(matches, inUse, list.exceptions) : []), [matches, inUse, list.exceptions]);
  const preview: Preview = useCallback((thumbUrl: string, sizePx: number) => deps!.preview(thumbUrl, sizePx), [deps]);
  const hasBaseline = inUse.some((c) => c.axis === 'baseline');
  const floorHintText = useMemo(() => floorHint(inUse), [inUse]);

  // Tabs of finds ask for them, and send back buffs applied there.
  const handovers = useRef(new Map<string, AxisFinds>());
  const inUseNow = useRef(inUse);
  inUseNow.current = inUse;
  useEffect(() => {
    const answerTab = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source === null) return;
      if (e.data?.type === ASK) {
        (e.source as Window).postMessage({ type: ANSWER, id: e.data.id, finds: handovers.current.get(e.data.id) ?? null }, location.origin);
      } else if (e.data?.type === APPLY) {
        const { id, scoring: to, changes } = e.data as AppliedChanges;
        const known = new Set(inUseNow.current.flatMap((c) => c.descriptions));
        const gone = changes.filter((c) => !known.has(c.description)).map((c) => `“${c.description}”`);
        if (gone.length > 0) {
          (e.source as Window).postMessage({ type: APPLIED, id, problem: `The list was edited since this tab opened: ${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} no longer in it. Nothing was changed; open the finds again from the clutter page.` }, location.origin);
          return;
        }
        setTuning((t) => ({ ...t, settings: { ...t.settings, [to]: withAxisChanges(t.settings[to], changes) } }));
        (e.source as Window).postMessage({ type: APPLIED, id, problem: null }, location.origin);
      }
    };
    window.addEventListener('message', answerTab);
    return () => {
      window.removeEventListener('message', answerTab);
    };
  }, []);
  const hand = (finds: Omit<AxisFinds, 'account'>) => {
    if (account === null) throw new Error('Finds can only be opened for an account');
    const id = crypto.randomUUID();
    handovers.current.set(id, { account, ...finds });
    window.open(`dev-clutter.html?all=${id}`, '_blank');
  };
  const settingsLine = `${scoringName(scoring)}: subjects need a lead of ${settings.subject.margin}, settings ${settings.setting.margin}${settings.pooling > 0 ? `, pooling ${settings.pooling}` : ''}${settings.baseline !== null ? `, floor ${settings.baseline}` : ''}`;
  const photoOf = (mediaKey: string, caption: CaptionPart[]) => {
    const row = rows?.get(mediaKey);
    if (!worked || !row) throw new Error('A photo is missing from the scores');
    return { mediaKey, thumbUrl: worked.photos.get(mediaKey)?.thumbUrl ?? null, caption, row };
  };
  const forBuffs = (w: AxisWorked) => ({ rows: w.rows[scoring], photos: new Map([...w.photos].map(([k, p]) => [k, { eligible: p.eligible, approved: p.approved }])), thumbUrls: new Map([...w.photos].map(([k, p]) => [k, p.thumbUrl])) });
  const openAll = (count: CategoryCount) => {
    if (!worked) throw new Error('Finds can only be opened once they are worked out');
    const clutter = (count.category as AxisCategory).verdict === 'clutter';
    hand({ side: sideOf(count.category as AxisCategory), title: countLine(count), settingsLine, photos: count.trashable.map((p) => photoOf(p.mediaKey, captionOf(photoCaption(p), worked.scored))), scored: worked.scored, overlap: worked.overlap, scoring, settings, exceptions: list.exceptions, buffing: clutter ? forBuffs(worked) : null });
  };
  const openPair = (row: PairRow) => {
    if (!worked) throw new Error('Pairs can only be opened once they are worked out');
    hand({ side: 'content', title: `${row.subject} in ${row.setting}: ${row.count.toLocaleString()} photos (${row.verdict === 'none' ? 'neither' : row.verdict})`, settingsLine, photos: row.mediaKeys.map((k) => photoOf(k, captionOf(`${row.subject} · ${row.setting}`, worked.scored))), scored: worked.scored, overlap: worked.overlap, scoring, settings, exceptions: list.exceptions, buffing: null });
  };

  // Editing, Save (what it does), Stay under photos leaving, Apply.
  const [editing, setEditing] = useState<AxisEditing | null>(null);
  // Whether the list of subjects and settings is open, kept here so it stays open when the editor closes.
  const [listOpen, setListOpen] = useState(false);
  const [editProblems, setEditProblems] = useState<string[]>([]);
  const [editWorking, setEditWorking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingEdit, setPendingEdit] = useState<{ categories: AxisCategory[]; exceptions: PairException[]; edits: string[]; worked: AxisWorked; settings: Record<Scoring, AxisSettings>; balance: Record<string, number> } | null>(null);
  const changesFromShipped = useMemo(() => [...listChanges(AXIS_LIST.categories, list.categories), ...exceptionChanges(AXIS_LIST.exceptions, list.exceptions, list.categories)], [list]);
  // The editor shows what is applied until something is changed; the edits ([editing]) count once saved and applied.
  const applied = useMemo<AxisEditing>(() => ({ draft: draftOf(inUse), weights: draftWeights(settings), exceptions: list.exceptions }), [inUse, settings, list.exceptions]);
  const axisLead = (s: AxisSettings) => (c: AxisCategory) => (c.axis === 'baseline' ? 0 : s[c.axis].margin);
  const saveEdits = async (edits = editing) => {
    if (!edits) throw new Error('No edits to save');
    const problems = [...draftProblems(edits.draft), ...exceptionProblems(edits.draft, edits.exceptions)];
    const { list: edited, renames } = listOf(edits.draft);
    const other: Scoring = scoring === 'raw' ? 'evened' : 'raw';
    const afterSettings = { [scoring]: settingsForList({ ...settings, ...edits.weights }, edited, {}), [other]: settingsForList(tuning.settings[other], edited, renames) } as Record<Scoring, AxisSettings>;
    const floor = floorProblem(afterSettings, edited);
    if (floor) problems.push(floor);
    setEditProblems(problems);
    if (problems.length > 0) return;
    if (!worked || !deps) throw new Error('Edits can only be saved once suggestions are worked out');
    try {
      const scored = await describe(deps, edited, setEditWorking);
      // The same photos in the same order as the matches now, so before and after line up.
      const order = [...worked.rows.raw.keys()].map((key) => worked.photos.get(key)!);
      const after = await work(worked.photos, order, scored, setEditWorking);
      const lines = [...listChanges(inUse, edited), ...exceptionChanges(list.exceptions, edits.exceptions, edited), ...weightEdits(settings, afterSettings[scoring], edited, axisLead(settings))];
      setPendingEdit({ categories: edited, exceptions: edits.exceptions, edits: lines, worked: after, settings: afterSettings, balance: afterSettings[scoring].descriptionWeights });
    } catch (error) {
      setEditProblems([error instanceof Error ? error.message : String(error)]);
    } finally {
      setEditWorking(null);
    }
  };
  const editWeighed = useMemo(() => {
    if (!pendingEdit || !matches || !worked) return null;
    const after: AxisSettings = { ...pendingEdit.settings[scoring], descriptionWeights: pendingEdit.balance };
    const afterMatches = [...pendingEdit.worked.rows[scoring]].map(([key, row]) => matchAxes(key, row, pendingEdit.worked.scored, pendingEdit.worked.overlap, after));
    const lists: AxisLists = { before: inUse, after: pendingEdit.categories, exceptions: { before: list.exceptions, after: pendingEdit.exceptions } };
    const effects = axisEffects(matches, afterMatches, lists, new Map([...worked.photos].map(([k, p]) => [k, p as ClutterPhoto])));
    const raised = weightChanges(pendingEdit.settings[scoring], after, pendingEdit.categories).map((c) => `${c.by > 0 ? '+' : '−'}${Math.abs(c.by).toFixed(4)} to “${c.description}”`);
    const what = [...pendingEdit.edits, ...raised];
    return { after, afterMatches, lists, effects, summary: axisSummary(what.length === 0 ? 'No changes' : what.join(' · '), effects, lists) };
  }, [pendingEdit, matches, worked, inUse, list.exceptions, scoring]);
  const applyEdits = () => {
    if (!pendingEdit || !editWeighed) throw new Error('No edits to apply');
    setList({ categories: pendingEdit.categories, exceptions: pendingEdit.exceptions });
    setWorked(pendingEdit.worked);
    setTuning((t) => ({ ...t, settings: { ...pendingEdit.settings, [t.scoring]: editWeighed.after } }));
    setPendingEdit(null);
    setEditing(null);
    setCopied(null);
  };
  // The floor's baseline, added straight to what it does (nothing, while the floor is off); one Apply adds it.
  const addBaseline = () => {
    const edits = { draft: withBaseline(draftOf(inUse)), weights: draftWeights(settings), exceptions: list.exceptions };
    setEditProblems([]);
    setEditing(edits);
    void saveEdits(edits);
  };
  const resetToShipped = () => {
    const edits = { draft: draftOf(AXIS_LIST.categories), weights: draftWeights(settings), exceptions: AXIS_LIST.exceptions };
    setEditProblems([]);
    setEditing(edits);
    void saveEdits(edits);
  };
  const copyChanges = () => {
    const text = changesFromShipped.length === 0 ? 'No changes from the shipped list.' : ['Changes to the subjects and settings (dev-clutter.html):', ...changesFromShipped.map((l) => `- ${l}`)].join('\n');
    navigator.clipboard.writeText(text).then(() => setCopied('Copied.'), (error: unknown) => setCopied(`Couldn't copy (${String(error)}).`));
  };
  const editGrids = useMemo(() => {
    if (!worked || !pendingEdit || !editWeighed) return [];
    const { lists } = editWeighed;
    const tile = (c: AxisChange): Tile => {
      const [before, after] = [worked.rows[scoring].get(c.mediaKey), pendingEdit.worked.rows[scoring].get(c.mediaKey)];
      if (!before || !after) throw new Error('A photo the edits change is missing from the scores');
      let nudge: Nudge | undefined;
      if (c.before.verdict === 'clutter' && c.after.verdict !== 'clutter' && c.fromDescription) {
        const id = lists.before[c.before.category!]!.id;
        const at = lists.after.findIndex((x) => x.id === id);
        const description = c.fromDescription;
        if (at >= 0 && lists.after[at]!.descriptions.includes(description)) {
          const raise = axisStayRaise(after, pendingEdit.worked.scored, pendingEdit.worked.overlap, editWeighed.after, pendingEdit.exceptions, at, description, MAX_BUFFS[scoring]);
          nudge = {
            description,
            category: lists.after[at]!.label,
            value: pendingEdit.balance[description],
            onChange: (value) => setPendingEdit((p) => (p ? { ...p, balance: withWeightOrNone(p.balance, description, value) } : p)),
            raise,
            max: MAX_BUFFS[scoring],
            onRaise: () => setPendingEdit((p) => (p && raise !== null ? { ...p, balance: withAxisBuff({ ...p.settings[scoring], descriptionWeights: p.balance }, description, raise).descriptionWeights } : p)),
          };
        }
      }
      return {
        mediaKey: c.mediaKey,
        thumbUrl: worked.photos.get(c.mediaKey)?.thumbUrl ?? null,
        caption: axisCaption(c, lists),
        breakdowns: () => comparedCards({ row: before, scored: worked.scored, overlap: worked.overlap, settings, exceptions: list.exceptions }, { row: after, scored: pendingEdit.worked.scored, overlap: pendingEdit.worked.overlap, settings: editWeighed.after, exceptions: pendingEdit.exceptions }, ['Now', 'With the edits']),
        nudge,
      };
    };
    return changeGrids(editWeighed.effects, lists, tile);
  }, [worked, pendingEdit, editWeighed, settings, list.exceptions, scoring]);

  // Save on the Settings card: what the card's edits do to the suggestions, before Apply.
  const cardWeighed = useMemo(() => {
    if (!cardSaving || !matches || !worked || cardEdits.length === 0) return null;
    const afterMatches = [...worked.rows[cardScoring]].map(([key, row]) => matchAxes(key, row, worked.scored, worked.overlap, cardSettings));
    const lists: AxisLists = { before: inUse, after: inUse, exceptions: { before: list.exceptions, after: list.exceptions } };
    const effects = axisEffects(matches, afterMatches, lists, new Map([...worked.photos].map(([k, p]) => [k, p as ClutterPhoto])));
    const tile = (c: AxisChange): Tile => {
      const [before, after] = [worked.rows[scoring].get(c.mediaKey), worked.rows[cardScoring].get(c.mediaKey)];
      if (!before || !after) throw new Error('A photo the settings change is missing from the scores');
      return {
        mediaKey: c.mediaKey,
        thumbUrl: worked.photos.get(c.mediaKey)?.thumbUrl ?? null,
        caption: axisCaption(c, lists),
        breakdowns: () => comparedCards({ row: before, scored: worked.scored, overlap: worked.overlap, settings, exceptions: list.exceptions }, { row: after, scored: worked.scored, overlap: worked.overlap, settings: cardSettings, exceptions: list.exceptions }, ['Now', 'With the settings']),
      };
    };
    return { afterMatches, summary: axisSummary(cardEdits.join(' · '), effects, lists), grids: changeGrids(effects, lists, tile) };
  }, [cardSaving, matches, worked, cardEdits, cardScoring, cardSettings, inUse, list.exceptions, scoring, settings]);
  const applyCard = () => {
    if (!cardDraft) throw new Error('No settings to apply');
    setTuning((t) => withCardSettings(t, cardDraft));
    setCardDraft(null);
    setCardSaving(false);
  };

  const number = (value: number, set: (n: number) => void, step: number, label: string) => (
    <input type="number" aria-label={label} value={value} step={step} min={0} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber >= 0 && set(e.target.valueAsNumber)} />
  );
  const leadField = (axis: SideAxis, key: 'minScore' | 'margin', label: string) => (
    <label>
      {label} {number(cardSettings[axis][key], (x) => setSettings((s) => ({ ...s, [axis]: { ...s[axis], [key]: x } })), cardScoring === 'raw' ? (key === 'margin' ? 0.002 : 0.005) : 0.05, `${axis} ${label}`)}
    </label>
  );
  // A setting that can be off (null or 0): turned off, it is remembered to bring back.
  const toggle = (key: 'pooling' | 'baseline', on: boolean) => {
    const now = cardSettings[key];
    if (!on && now !== null && now > 0) setLastOn((l) => ({ ...l, [`${cardScoring} ${key}`]: now }));
    const back = lastOn[`${cardScoring} ${key}`] ?? (key === 'pooling' ? STARTING_POOLING : STARTING_FLOOR)[cardScoring];
    setSettings((s) => ({ ...s, [key]: on ? back : key === 'pooling' ? 0 : null }));
  };
  // Export summary to folder: one folder picked, then every clutter category's files written into it.
  const [reviewing, setReviewing] = useState<string | null>(null);
  // Set by Cancel; the saving stops before the next category, keeping the files already written.
  const cancelReview = useRef(false);
  const saveAllForReview = async () => {
    cancelReview.current = false;
    if (!worked || !rows || !counts) throw new Error('Review files need suggestions worked out');
    let folder: WritableFolder;
    try {
      folder = await pickFolder();
    } catch (error) {
      // Cancelled: nothing to save.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
    const all = [...counts.forms, ...counts.clutter].filter((c) => c.trashable.length > 0 || c.justMissed.length > 0);
    try {
      for (const [i, count] of all.entries()) {
        if (cancelReview.current) {
          setReviewing(`Cancelled after ${i} of ${all.length} categories; their files are saved.`);
          return;
        }
        setReviewing(`Saving ${count.category.label} (${i + 1} of ${all.length})…`);
        for (const file of await reviewFiles(count, worked, rows, settings, settingsLine, list.exceptions, preview)) await writeFile(folder, file.name, file.blob);
      }
      setReviewing(`Saved ${all.length} categories.`);
    } catch (error) {
      setReviewing(`Couldn’t save (${error instanceof Error ? error.message : String(error)})`);
    }
  };
  // The lab folder: request.json written by a coding agent, applied here, the results written back.
  const [lab, setLab] = useState<{ folder: WritableFolder | null; state: 'none' | 'reconnect' | 'watching'; message: string }>({ folder: null, state: 'none', message: 'Not connected.' });
  useEffect(() => {
    void findLabFolder().then(
      async (folder) => {
        if (!folder) return;
        const granted = (await folder.queryPermission({ mode: 'readwrite' })) === 'granted';
        setLab({ folder, state: granted ? 'watching' : 'reconnect', message: granted ? 'Watching for request.json.' : 'Chrome needs permission again after a reload.' });
      },
      (error: unknown) => setLab((l) => ({ ...l, message: `The lab folder couldn’t be found again (${String(error)}).` })),
    );
  }, []);
  const connectLab = async () => {
    try {
      const folder = lab.state === 'reconnect' && lab.folder ? lab.folder : await pickFolder();
      if ((await folder.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        setLab({ folder, state: 'reconnect', message: 'Chrome wasn’t given permission to the folder.' });
        return;
      }
      await keepLabFolder(folder);
      setLab({ folder, state: 'watching', message: 'Watching for request.json.' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setLab((l) => ({ ...l, message: `Couldn’t connect (${error instanceof Error ? error.message : String(error)})` }));
    }
  };
  /** Carries out [request] against the library as it is now; writes <id>/result.json and its contact sheets and review files. */
  const runLab = async (folder: WritableFolder, request: LabRequest): Promise<string> => {
    const out = await folder.getDirectoryHandle(request.id, { create: true });
    const refuse = async (problems: string[]) => {
      await writeFile(out, 'result.json', JSON.stringify(labRefusal(request.id, problems), null, 2));
      return `${request.id}: refused (${problems.join(' ')})`;
    };
    // Only run when ready ([labReady], checked before): this guards the types, and a page that became busy since.
    if (!worked || !deps || !matches || !counts) throw new Error('The suggestions aren’t worked out');
    const target = labTarget(request, list, tuning);
    if ('problem' in target) return refuse([target.problem]);
    let afterWorked = worked;
    if (request.list) {
      const scored = await describe(deps, target.list.categories, (t) => setLab((l) => ({ ...l, message: `${request.id}: ${t}` })));
      afterWorked = await work(worked.photos, [...worked.rows.raw.keys()].map((key) => worked.photos.get(key)!), scored, (t) => setLab((l) => ({ ...l, message: `${request.id}: ${t}` })));
    }
    const afterScoring = target.tuning.scoring;
    const afterSettings = target.tuning.settings[afterScoring];
    const afterRows = afterWorked.rows[afterScoring];
    const photos = new Map([...worked.photos].map(([k, p]) => [k, { eligible: p.eligible, approved: p.approved }]));
    const afterMatches = [...afterRows].map(([key, row]) => matchAxes(key, row, afterWorked.scored, afterWorked.overlap, afterSettings));
    const afterCounts = countAxes(afterMatches, target.list.categories, target.list.exceptions, photos, afterSettings);
    const lists: AxisLists = { before: inUse, after: target.list.categories, exceptions: { before: list.exceptions, after: target.list.exceptions } };
    const effects = axisEffects(matches, afterMatches, lists, photos);
    // The photos it moves: a numbered contact sheet per group, and their scores after the change as text.
    const afterLine = `${scoringName(afterScoring)}: subjects need a lead of ${afterSettings.subject.margin}, settings ${afterSettings.setting.margin}${afterSettings.pooling > 0 ? `, pooling ${afterSettings.pooling}` : ''}${afterSettings.baseline !== null ? `, floor ${afterSettings.baseline}` : ''}`;
    const groups = [
      ...axisGroups(effects.leaves, lists.before, (c) => c.before.category!).map((g) => ({ key: `leave-${g.key}`, title: `Leave ${g.title}`, changes: g.changes })),
      ...axisGroups(effects.joins, lists.after, (c) => c.after.category!).map((g) => ({ key: `join-${g.key}`, title: `Join ${g.title}`, changes: g.changes })),
      ...(effects.moves.length > 0 ? [{ key: 'move', title: `Moved between suggestions · ${effects.moves.length}`, changes: effects.moves }] : []),
    ];
    let number = 0;
    const moved: ReviewPhoto[] = [];
    const moves: LabMoveGroup[] = [];
    for (const g of groups) {
      setLab((l) => ({ ...l, message: `${request.id}: drawing ${g.title}…` }));
      const shown = g.changes.slice(0, LAB_SHEET_MAX).map((change) => ({ change, number: ++number }));
      const sheet = [];
      for (const { change, number: n } of shown) {
        const thumbUrl = worked.photos.get(change.mediaKey)?.thumbUrl ?? null;
        sheet.push({ number: n, url: thumbUrl ? await preview(thumbUrl, SHEET_CELL) : null });
        const caption = axisCaption(change, lists).map((p) => p.text).join('');
        moved.push({ number: n, sample: g.title, caption, breakdown: axisBreakdown(afterRows.get(change.mediaKey)!, afterWorked.scored, afterWorked.overlap, afterSettings, target.list.exceptions, SIDE_ROWS) });
      }
      const name = sheet.length > 0 ? `${g.key}.png` : null;
      if (name) await writeFile(out, name, await contactSheet(sheet));
      const numbers = new Set(shown.map((s) => s.number));
      moves.push({ key: g.key, title: g.title, sheet: name, photos: moved.filter((p) => numbers.has(p.number)).map((p) => ({ number: p.number, caption: p.caption })), total: g.changes.length });
    }
    if (moved.length > 0) await writeFile(out, 'moves.txt', reviewText(`What ${request.id} moves`, afterLine, moved));
    // The labelled photos behind the scores, with the change: offered though kept, and clutter missed, by kind (most first).
    const labelGroups: LabMoveGroup[] = [];
    if (request.labelSheets && Object.keys(seen).length > 0) {
      const examples = labelExamples(afterMatches, target.list.categories, target.list.exceptions, photos, seen);
      const kindName = (kind: string) => target.list.categories.find((c) => c.id === kind)?.label ?? (kind === OTHER_KIND ? 'kind missing' : 'kind unspecified');
      const sheets = [
        { key: 'label-wrong', title: 'Offered, labelled keep', keys: examples.wrong },
        ...Object.entries(examples.missed).sort((a, b) => b[1].length - a[1].length).map(([kind, keys]) => ({ key: `label-missed-${kind}`, title: `Missed: ${kindName(kind)}`, keys })),
      ].filter((s) => s.keys.length > 0);
      let n = 0;
      const looked: ReviewPhoto[] = [];
      for (const s of sheets) {
        setLab((l) => ({ ...l, message: `${request.id}: drawing ${s.title}…` }));
        const shown = s.keys.slice(0, LAB_SHEET_MAX).map((k) => ({ key: k, number: ++n }));
        const sheet = [];
        for (const { key: k, number: num } of shown) {
          const thumbUrl = worked.photos.get(k)?.thumbUrl ?? null;
          sheet.push({ number: num, url: thumbUrl ? await preview(thumbUrl, SHEET_CELL) : null });
          looked.push({ number: num, sample: s.title, caption: '', breakdown: axisBreakdown(afterRows.get(k)!, afterWorked.scored, afterWorked.overlap, afterSettings, target.list.exceptions, SIDE_ROWS) });
        }
        await writeFile(out, `${s.key}.png`, await contactSheet(sheet));
        labelGroups.push({ key: s.key, title: s.title, sheet: `${s.key}.png`, photos: shown.map((x) => ({ number: x.number, caption: '' })), total: s.keys.length });
      }
      if (looked.length > 0) await writeFile(out, 'labels.txt', reviewText(`Labelled photos ${request.id} gets wrong or misses`, afterLine, looked));
    }
    // New answers for an earlier blind draw's photos, by number, which the user asked the agent to give: by the draw
    // kept in this browser, or drawn again when it is exactly as recorded (drawn before draws were kept).
    const notes = [...target.notes];
    // The photos of an earlier blind draw, in their numbered order: as kept in this browser, or drawn again when it is
    // exactly as recorded (drawn before draws were kept); why not, when neither.
    const drawnKeys = async (from: string): Promise<string[] | string> => {
      const kept = blindDrawOf(localStorage.getItem(BLIND_DRAWS_KEY), from);
      if (kept !== null) return kept;
      let recorded: unknown;
      try {
        recorded = JSON.parse(await (await (await (await folder.getDirectoryHandle(from, { create: false })).getFileHandle('blind-answers.json', { create: false })).getFile()).text());
      } catch (error) {
        return `${from}/blind-answers.json couldn’t be read (${error instanceof Error ? error.message : String(error)}).`;
      }
      if (!Array.isArray(recorded)) return `${from}/blind-answers.json isn’t a list.`;
      const again = blindSample(matches, inUse, list.exceptions, photos, seen, recorded.length, from);
      if (!sameBlindDraw(recorded as BlindAnswer[], again.answers)) {
        return `${from} isn’t kept in this browser, and drawing it again gives other photos (labels were added or removed since), so its numbers no longer name the same photos.`;
      }
      localStorage.setItem(BLIND_DRAWS_KEY, rememberBlindDraw(localStorage.getItem(BLIND_DRAWS_KEY), from, again.keys));
      return again.keys;
    };
    // The list and tuning as this browser has them, to ship (2026-11-26).
    if (request.exportList) {
      await writeFile(out, 'list.json', JSON.stringify(list, null, 2));
      await writeFile(out, 'tuning.json', JSON.stringify(tuning, null, 2));
      notes.push('Wrote the list in use (list.json) and its tuning (tuning.json).');
    }
    if (request.zoom) {
      const keys = await drawnKeys(request.zoom.from);
      if (typeof keys === 'string') return refuse([`"zoom": ${keys}`]);
      const missing = request.zoom.numbers.filter((n) => keys[n - 1] === undefined);
      if (missing.length > 0) return refuse([`"zoom": ${missing.map((n) => `#${n}`).join(', ')} isn’t in the draw of ${keys.length}.`]);
      const { numbers, size } = request.zoom;
      for (let start = 0; start < numbers.length; start += ZOOM_PER_SHEET) {
        const page = start / ZOOM_PER_SHEET + 1;
        setLab((l) => ({ ...l, message: `${request.id}: drawing zoom sheet ${page}…` }));
        const sheet = [];
        for (const n of numbers.slice(start, start + ZOOM_PER_SHEET)) {
          const thumbUrl = worked.photos.get(keys[n - 1]!)?.thumbUrl ?? null;
          sheet.push({ number: n, url: thumbUrl ? await preview(thumbUrl, size) : null });
        }
        await writeFile(out, `zoom-${String(page).padStart(2, '0')}.png`, await contactSheet(sheet, size, ZOOM_COLUMNS));
      }
      notes.push(`Drew ${numbers.length} photos of ${request.zoom.from} at ${size} px.`);
    }
    if (request.relabel) {
      const from = request.relabel.from;
      const keys = await drawnKeys(from);
      if (typeof keys === 'string') return refuse([`"relabel": ${keys}`]);
      const done = relabelBlind(keys, request.relabel.labels, labels, inUse);
      if ('problem' in done) return refuse([`"relabel": ${done.problem}`]);
      setLabels(done.labels);
      notes.push(`Relabelled ${request.relabel.labels.length} photos of ${from}; the scores here are from before.`);
    }
    // Labelled photos for the agent to label blind: numbered sheets, and the user's answers in a file apart.
    if (request.blind > 0 && Object.keys(seen).length > 0) {
      const blind = blindSample(afterMatches, target.list.categories, target.list.exceptions, photos, seen, request.blind, request.id);
      localStorage.setItem(BLIND_DRAWS_KEY, rememberBlindDraw(localStorage.getItem(BLIND_DRAWS_KEY), request.id, blind.keys));
      for (let start = 0; start < blind.keys.length; start += LAB_SHEET_MAX) {
        const page = start / LAB_SHEET_MAX + 1;
        setLab((l) => ({ ...l, message: `${request.id}: drawing blind sheet ${page}…` }));
        const sheet = [];
        for (const [i, k] of blind.keys.slice(start, start + LAB_SHEET_MAX).entries()) {
          const thumbUrl = worked.photos.get(k)?.thumbUrl ?? null;
          sheet.push({ number: start + i + 1, url: thumbUrl ? await preview(thumbUrl, SHEET_CELL) : null });
        }
        await writeFile(out, `blind-${String(page).padStart(2, '0')}.png`, await contactSheet(sheet));
      }
      await writeFile(out, 'blind-answers.json', JSON.stringify(blind.answers, null, 2));
    }
    // Review files of the categories asked for, with the change.
    let reviews: string[] = [];
    try {
      reviews = labReviewIds(request.review, afterCounts);
    } catch (error) {
      return refuse([error instanceof Error ? error.message : String(error)]);
    }
    for (const id of reviews) {
      setLab((l) => ({ ...l, message: `${request.id}: reviewing ${id}…` }));
      const count = [...afterCounts.forms, ...afterCounts.clutter].find((c) => c.category.id === id)!;
      for (const file of await reviewFiles(count, afterWorked, afterRows, afterSettings, afterLine, target.list.exceptions, preview)) await writeFile(out, file.name, file.blob);
    }
    const result: LabResult = {
      id: request.id,
      state: 'done',
      problems: [],
      notes,
      applied: request.apply,
      scoring: afterScoring,
      totals: { before: counts.totals, after: afterCounts.totals },
      categories: labCategoryLines(counts, afterCounts),
      moves,
      reviews,
      labels: Object.keys(seen).length === 0 ? null : { before: scoreLabels(matches, inUse, list.exceptions, photos, seen), after: scoreLabels(afterMatches, target.list.categories, target.list.exceptions, photos, seen) },
      labelGroups,
      labelParts: Object.keys(seen).length === 0 ? null : (() => {
        const parts = labelParts(seen);
        const both = (part: Labels) => ({ before: scoreLabels(matches, inUse, list.exceptions, photos, part), after: scoreLabels(afterMatches, target.list.categories, target.list.exceptions, photos, part) });
        return { random: both(parts.random), a: both(parts.a), b: both(parts.b) };
      })(),
      edge: Object.keys(seen).length === 0 ? null : edgeScores(afterCounts, seen),
    };
    await writeFile(out, 'result.json', JSON.stringify(result, null, 2));
    if (request.apply) {
      setList(target.list);
      setWorked(afterWorked);
      setTuning(target.tuning);
    }
    return `${request.id}: done${request.apply ? ', applied' : ''}.`;
  };
  // Looks for a new request every few seconds; one whose folder already has a result is done.
  const runLabNow = useRef(runLab);
  runLabNow.current = runLab;
  // Whether the page can take a request now: suggestions worked out, nothing being worked out, no popup of
  // what a change does open. Edits not yet applied don't stop it: it measures against what is applied.
  const labReady = useRef(false);
  labReady.current = worked !== null && matches !== null && counts !== null && progress === null && pendingEdit === null && !cardSaving;
  const labBusy = useRef(false);
  useEffect(() => {
    const folder = lab.folder;
    if (lab.state !== 'watching' || !folder) return;
    const look = async () => {
      if (labBusy.current) return;
      labBusy.current = true;
      try {
        const notFound = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
        let text: string;
        try {
          text = await (await (await folder.getFileHandle('request.json', { create: false })).getFile()).text();
        } catch (error) {
          // No request yet; anything else (a lost permission) is said.
          if (!notFound(error)) setLab((l) => ({ ...l, message: `request.json couldn’t be read (${String(error)})` }));
          return;
        }
        const read = readLabRequest(text);
        if ('problem' in read) {
          setLab((l) => ({ ...l, message: `request.json: ${read.problem}` }));
          return;
        }
        try {
          await (await folder.getDirectoryHandle(read.request.id, { create: false })).getFileHandle('result.json', { create: false });
          return;
        } catch (error) {
          // Not done yet.
          if (!notFound(error)) throw error;
        }
        if (!labReady.current) {
          // The same message each time it looks: kept as it is, so the page isn't redrawn every few seconds.
          const waiting = `${read.request.id}: waiting until the page is ready (suggestions worked out, no Save popup open).`;
          setLab((l) => (l.message === waiting ? l : { ...l, message: waiting }));
          return;
        }
        setLab((l) => ({ ...l, message: `${read.request.id}: working…` }));
        await writeFile(folder, 'status.json', JSON.stringify({ state: 'working', request: read.request.id }));
        let message: string;
        try {
          message = await runLabNow.current(folder, read.request);
        } catch (error) {
          message = `${read.request.id}: failed (${error instanceof Error ? error.message : String(error)})`;
          const out = await folder.getDirectoryHandle(read.request.id, { create: true });
          await writeFile(out, 'result.json', JSON.stringify(labRefusal(read.request.id, [message]), null, 2));
        }
        await writeFile(folder, 'status.json', JSON.stringify({ state: 'idle', last: read.request.id, message }));
        setLab((l) => ({ ...l, message }));
      } finally {
        labBusy.current = false;
      }
    };
    const timer = setInterval(() => void look(), LAB_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [lab.folder, lab.state]);
  // Labels: the user's verdict on a sample of photos, kept in this browser; the lab scores every change against them.
  const [labels, setLabels] = useState<Labels>(() => {
    try {
      return readLabels(localStorage.getItem(LABELS_KEY));
    } catch (error) {
      console.warn('Photo Cleaner: the labels kept in this browser couldn’t be read; they start afresh', error);
      return {};
    }
  });
  // The labels with near-duplicates' copied in (withDuplicates): what the scores, the edges and the samples count; the
  // labelling screen and Label again use the labeller's own.
  const seen = useMemo(() => withDuplicates(labels, moments), [labels, moments]);
  const copiedText = useMemo(() => copiedLine(seen), [seen]);
  // The labels scored against suggestions [m] from a list: all of them and the random ones; null with no labels yet.
  const scored = useCallback((m: AxisMatch[] | null, categories: readonly AxisCategory[], exceptions: readonly PairException[]): LabelScorePair | null => {
    if (!worked || !m || Object.keys(labels).length === 0) return null;
    const photos = new Map([...worked.photos].map(([k, p]) => [k, { eligible: p.eligible, approved: p.approved }]));
    return { all: scoreLabels(m, categories, exceptions, photos, seen), random: scoreLabels(m, categories, exceptions, photos, labelParts(seen).random) };
  }, [worked, labels, seen]);
  // What the edits and settings waiting in a Save popup do to precision and recall.
  const editScores = useMemo(() => {
    if (!pendingEdit || !editWeighed) return null;
    const [before, after] = [scored(matches, inUse, list.exceptions), scored(editWeighed.afterMatches, pendingEdit.categories, pendingEdit.exceptions)];
    return before && after ? scoresChange(before, after) : null;
  }, [pendingEdit, editWeighed, scored, matches, inUse, list.exceptions]);
  const cardScores = useMemo(() => {
    if (!cardWeighed) return null;
    const [before, after] = [scored(matches, inUse, list.exceptions), scored(cardWeighed.afterMatches, inUse, list.exceptions)];
    return before && after ? scoresChange(before, after) : null;
  }, [cardWeighed, scored, matches, inUse, list.exceptions]);
  useEffect(() => {
    try {
      localStorage.setItem(LABELS_KEY, saveLabels(labels));
    } catch (error) {
      setSaveProblem(`The labels couldn't be kept in this browser (${String(error)}).`);
    }
  }, [labels]);
  // The photos to label (the sample, when opened), and the ones labelled since, to go back through.
  // [random]: photos drawn at random from the library, whose labels are marked so (labelParts).
  // [review]: answering random labels again (Review my random labels…).
  const [labelling, setLabelling] = useState<{ queue: string[]; history: string[]; random: boolean; review: boolean } | null>(null);
  const openLabelling = (random: boolean) => {
    if (!worked || !matches || !counts) throw new Error('Labelling needs the suggestions worked out');
    const photos = new Map([...worked.photos].map(([k, p]) => [k, { eligible: p.eligible, approved: p.approved }]));
    if (!random) {
      setLabelling({ queue: oneOfEachMoment(labelSample(matches, counts, inUse, list.exceptions, photos, seen, SAMPLE_SIZES, 1), moments), history: [], random, review: false });
      return;
    }
    // Drawn photos labelled before keep their verdict, now counted as random too; the rest are asked.
    // A drawn photo with a near-duplicate's label keeps it as its own, now random.
    const { queue, reused } = randomSample(matches, photos, seen, RANDOM_SAMPLE_SIZE, 2);
    setLabels((l) => ({ ...l, ...Object.fromEntries(reused.map((k) => [k, { verdict: seen[k]!.verdict, kind: seen[k]!.kind, random: true as const }])) }));
    setLabelling({ queue: oneOfEachMoment(queue, moments), history: [], random, review: false });
  };
  // Unsure and taste, and clutter missed with no kind, to answer again now that the neutral subjects are kinds.
  const againQueue = useMemo(() => {
    if (!worked || !matches) return [];
    const photos = new Map([...worked.photos].map(([k, p]) => [k, { eligible: p.eligible, approved: p.approved }]));
    return labelAgainQueue(matches, inUse, list.exceptions, photos, labels);
  }, [worked, matches, inUse, list.exceptions, labels]);
  // The random labels to answer again, after the way of labelling changed; each shows its earlier answer.
  const review = useMemo(() => {
    if (!worked || !matches) return null;
    const photos = new Map([...worked.photos].map(([k, p]) => [k, { eligible: p.eligible, approved: p.approved }]));
    return reviewQueue(matches, photos, labels);
  }, [worked, matches, labels]);
  // The edge labels of one kind and verdict, to answer again (shop fronts labelled Signs before they were unsure).
  const kindAgain = useMemo(() => {
    if (!worked || !matches) return [];
    const photos = new Map([...worked.photos].map(([k, p]) => [k, { eligible: p.eligible, approved: p.approved }]));
    return kindAgainChoices(matches, photos, labels, inUse.filter(isLabelKind), inUse);
  }, [worked, matches, labels, inUse]);
  const [againKind, setAgainKind] = useState<string | null>(null);
  const againChoice = kindAgain.find((c) => c.kind === againKind) ?? kindAgain[0];
  // The labels with the review started over (answers kept), or null when nothing is reviewed yet.
  const restarted = useMemo(() => reviewStartedOver(labels), [labels]);
  const labelKinds = useMemo(() => inUse.filter(isLabelKind).map((c) => ({ id: c.id, label: c.label, verdict: c.verdict })), [inUse]);
  // How the labelling screen asks, kept in this browser: a friend's laptop stays on simple.
  const [labelMode, setLabelMode] = useState<LabelMode>(() => {
    try {
      return localStorage.getItem(LABEL_MODE_KEY) === 'simple' ? 'simple' : 'kinds';
    } catch (error) {
      console.warn('Photo Cleaner: the labelling mode kept in this browser couldn’t be read', error);
      return 'kinds';
    }
  });
  const chooseLabelMode = (mode: LabelMode) => {
    setLabelMode(mode);
    try {
      localStorage.setItem(LABEL_MODE_KEY, mode);
    } catch (error) {
      setSaveProblem(`The labelling mode couldn't be kept in this browser (${String(error)}).`);
    }
  };
  const labelGuesses = useCallback((key: string) => {
    const row = rows?.get(key);
    if (!worked || !row) throw new Error('A photo to label is missing from the scores');
    return kindGuesses(row, worked.scored, settings);
  }, [worked, rows, settings]);
  const labelThumb = useCallback((key: string) => worked?.photos.get(key)?.thumbUrl ?? null, [worked]);
  const labelText = useMemo(() => {
    const now = scored(matches, inUse, list.exceptions);
    return now ? labelLine(now.all, now.random) : null;
  }, [scored, matches, inUse, list.exceptions]);
  // Precision and recall now, for the top of Results.
  const scoresText = useMemo(() => {
    const now = scored(matches, inUse, list.exceptions);
    return now ? scoresLine(now) : null;
  }, [scored, matches, inUse, list.exceptions]);
  const edge = useMemo(() => (counts && Object.keys(seen).length > 0 ? edgeLines(edgeScores(counts, seen)) : null), [counts, seen]);
  // Copy scores: the numbers alone, for someone who labelled their own library to send back.
  const [scoresCopied, setScoresCopied] = useState<string | null>(null);
  const copyScores = () => {
    if (!worked || !matches || !counts) throw new Error('Copy scores needs the suggestions worked out');
    const photos = new Map([...worked.photos].map(([k, p]) => [k, { eligible: p.eligible, approved: p.approved }]));
    const text = scoresReport({
      version: extensionVersion(), matched: counts.photos, totals: counts.totals, changes: changesFromShipped, scoring, settings,
      all: scoreLabels(matches, inUse, list.exceptions, photos, seen), random: scoreLabels(matches, inUse, list.exceptions, photos, labelParts(seen).random), edge: edgeScores(counts, seen),
    });
    navigator.clipboard.writeText(text).then(() => setScoresCopied('Copied: numbers only, no photos.'), (error: unknown) => setScoresCopied(`Couldn't copy (${String(error)}).`));
  };
  const suggested = counts ? counts.clutter.filter((c) => c.trashable.length >= minPhotos) : [];
  const tooFew = counts ? counts.clutter.filter((c) => c.trashable.length < minPhotos) : [];
  const floorWords = inUse.filter((c) => c.axis === 'baseline').flatMap((c) => c.descriptions).map((d) => `“${d}”`).join(', ');
  return (
    <main className="review calibration">
      <header>
        <h1>Photo Cleaner <span className="muted">/ clutter categories (developer tool)</span></h1>
        <p className="account mono">{account ? `Google Photos account: ${accountLabel(account, answer?.account?.email ?? null)}` : 'No account yet'}</p>
        {/* Folded: one line that says it is there, the whole of it for whoever opens it. */}
        <details className="clutter-intro">
          <summary>How it works <span className="muted small">· nothing is trashed from this page: it is for tuning the suggestions</span></summary>
          <p className="muted">
            The AI compares each analysed photo with {axisDescriptionCount(list).toLocaleString()} short descriptions, grouped into categories ({axisListSummary(list)}),
            and gives it its best subject (what it is of) and its best setting (where it is). Each category is either clutter, keep or neutral. A subject or setting counts only
            when it leads the best one of another verdict by at least its minimum lead; too close, it has no say. Then an exception for that exact pair of subject and
            setting decides first; otherwise a keeper keeps the photo; otherwise clutter offers it for the trash. A check (such as Screenshots) decides on its own: its forms compete only among themselves, so a photo can be in several checks. Hover
            over a photo to see how it scored. Nothing is trashed from this page: it is for tuning the suggestions, and its list and settings stay in this browser.
          </p>
        </details>
      </header>
      {/* The library, read and scored when the page opens: every photo against every description, the slow part. A saved change to the
          categories scores the same photos again by itself (only new descriptions go to the AI); the settings need no scoring at all. */}
      <section className="card">
        <h2>Library</h2>
        {progress && <p className="working" role="status"><span className="spinner-inline" />{progress}</p>}
        {problem && <p className="warn">{problem}</p>}
        {needsPhotos && (
          <p className="warn">
            <a href="https://photos.google.com/" onClick={(e) => { e.preventDefault(); void openPhotos(); }}>Open Google Photos</a> first, so the account is known.
          </p>
        )}
        {counts && <p className="mono">{counts.photos.toLocaleString()} photos matched</p>}
        <div className="buttons clutter-show-all">
          <button disabled={progress !== null} onClick={() => void workOut()}>Read the library again</button>
          <span className="muted small">Read and scored automatically when this page opens, which takes a while. Needed again only after a new scan finds new photos: saving changes to the categories or settings works out the suggestions again by itself.</span>
        </div>
      </section>
      <section className="card">
        {loaded.notes.map((note) => <p key={note} className="warn small">{note}</p>)}
        {saveProblem && <p className="warn small">{saveProblem}</p>}
        {momentsProblem && <p className="warn small">{momentsProblem}</p>}
        <AxisListView list={{ categories: [...inUse], exceptions: list.exceptions }} changes={changesFromShipped} copied={copied} open={listOpen} onToggle={setListOpen} onCopy={copyChanges} canReset={worked !== null && progress === null && editing === null} onReset={resetToShipped}>
          <AxisEditor editing={editing ?? applied} edited={editing !== null} onChange={setEditing} settings={settings} scoring={scoring} problems={editProblems} working={editWorking} canSave={worked !== null && progress === null} onSave={() => void saveEdits()} onDiscard={() => { setEditing(null); setEditProblems([]); }} />
        </AxisListView>
      </section>
      {/* Shown straight away, like the categories: the fields need no scores; Save waits for them. */}
        <section className="card">
          <details className="clutter-settings">
          <summary>Settings{cardEdits.length > 0 && <span className="muted small"> · not saved yet</span>}</summary>
          <div className="row">
            <label>Photos for a suggestion <input type="number" value={minPhotos} step={5} min={0} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setMinPhotos(e.target.valueAsNumber)} /></label>
            <span className="muted small">A category offering fewer isn't suggested (it is listed at the end of Suggested searches). Counts at once, without Save.</span>
          </div>
          <div className="segmented" role="group" aria-label="Scoring">
            <button className={cardScoring === 'raw' ? 'selected' : ''} aria-pressed={cardScoring === 'raw'} onClick={() => setCard((t) => ({ ...t, scoring: 'raw' }))}>Raw scores</button>
            <button className={cardScoring === 'evened' ? 'selected' : ''} aria-pressed={cardScoring === 'evened'} onClick={() => setCard((t) => ({ ...t, scoring: 'evened' }))}>Evened out</button>
          </div>
          <p className="muted small">
            {cardScoring === 'raw'
              ? 'Scores as the AI model gives them. Some descriptions (short, vague ones most) score high on every photo, so they win more often.'
              : 'Each score is how far above that description\'s average over the whole library the photo is, counted in its usual spread: 0 is average, 2 is far above it. A description that is high on every photo no longer wins by default.'}{' '}
            Each scoring keeps its own settings and weights.
          </p>
          <div className="row">
            {leadField('subject', 'minScore', 'Subject: minimum score')}
            {leadField('subject', 'margin', 'minimum lead')}
          </div>
          <div className="row">
            {leadField('setting', 'minScore', 'Setting: minimum score')}
            {leadField('setting', 'margin', 'minimum lead')}
          </div>
          {inUse.some((c) => c.axis === 'form') && (
            <div className="row">
              {leadField('form', 'minScore', 'Checks: minimum score')}
              {leadField('form', 'margin', 'minimum lead')}
            </div>
          )}
          <div className="row">
            <label className="clutter-toggle">
              <input type="checkbox" checked={cardSettings.pooling > 0} onChange={(e) => toggle('pooling', e.target.checked)} /> Pooling
            </label>
            {cardSettings.pooling > 0 && number(cardSettings.pooling, (x) => setSettings((s) => ({ ...s, pooling: x })), cardScoring === 'raw' ? 0.005 : 0.05, 'Pooling')}
          </div>
          <p className="muted small">
            On each side, the descriptions of one verdict (clutter, keep, or neither) close behind the best add to it, and the lead is measured between those pools.
            Each votes exp(−gap ÷ pooling), 1 when level with the best, then shrinks by how much it overlaps with one above it over the whole library: “a city view”, “a
            landscape” and “a sky adventure” count about once, “a famous landmark” on its own. The best three votes count: pool = best + pooling × ln(sum). Off: only
            the best counts.
          </p>
          <div className="row">
            <label className="clutter-toggle">
              <input type="checkbox" disabled={!hasBaseline && cardSettings.baseline === null} checked={cardSettings.baseline !== null} onChange={(e) => toggle('baseline', e.target.checked)} /> Floor
            </label>
            {cardSettings.baseline !== null && number(cardSettings.baseline, (x) => setSettings((s) => ({ ...s, baseline: x })), cardScoring === 'raw' ? 0.002 : 0.05, 'Floor')}
          </div>
          {floorHintText === null ? (
            <p className="muted small">Clutter counts only when it scores at least this far above the best of {floorWords}, which is close to every photo: a photo nothing in the list fits well stays out.</p>
          ) : (
            <div className="row">
              <p className="warn small">{floorHintText}</p>
              <button disabled={worked === null || progress !== null || editing !== null} onClick={addBaseline}>Add the baseline…</button>
            </div>
          )}
          <div className="buttons clutter-show-all">
            <button className="primary" disabled={cardEdits.length === 0 || worked === null || progress !== null} onClick={() => setCardSaving(true)}>Save settings…</button>
            <button disabled={cardDraft === null} onClick={() => setCardDraft(null)}>Discard</button>
            <span className="muted small">{cardEdits.length === 0 ? 'Changes here count only once saved and applied; the lab measures against what is applied.' : `Not applied yet: ${cardEdits.join(' · ')}`}</span>
          </div>
          </details>
        </section>
      {/* What the list and settings come to, as they stand: worked out again at once on every saved change. */}
      {/* Shown from the start, greyed out until the library is read, so the page keeps its shape. */}
      {!(counts && worked && rows) && (
        <section className="card clutter-results-waiting" aria-busy="true">
          <h2 className="clutter-results-title">Results</h2>
          <p className="clutter-results-totals">{needsPhotos ? 'Once Google Photos is open and the library is read.' : 'Once the library is read.'}</p>
          <div className="buttons clutter-show-all clutter-results-export">
            <button disabled>Export summary to folder…</button>
          </div>
          {['To suggest for deletion', 'Kept', 'Subject × setting matrix'].map((part) => (
            <p key={part} className="clutter-results-part clutter-results-part-waiting">▸ {part}</p>
          ))}
        </section>
      )}
      {counts && worked && rows && (
        <section className="card clutter-appear">
          <h2 className="clutter-results-title">Results</h2>
          <p className="mono clutter-results-totals">{counts.totals}</p>
          <p className="clutter-results-scores">{scoresText ?? 'Precision and recall: none yet. They show once photos are labelled (Labelling lab, below).'}</p>
          <div className="buttons clutter-show-all clutter-results-export">
            <button disabled={reviewing !== null && reviewing.endsWith('…')} onClick={() => void saveAllForReview()}>Export summary to folder…</button>
            {reviewing !== null && reviewing.endsWith('…') && (
              <button onClick={() => { cancelReview.current = true; setReviewing('Cancelling after this category…'); }}>Cancel</button>
            )}
            <span className="muted small">{reviewing ?? 'Every clutter category’s Riskiest, Lowest scores and Just missed as numbered contact sheets, with each photo’s scores as text, into a folder you choose.'}</span>
          </div>
          {/* Its parts fold away, closed until wanted. */}
          <details className="clutter-results-part">
          <summary>To suggest for deletion</summary>
          {counts.forms.length > 0 && <p className="muted small">By check, each a system of its own: a photo here may also be in another check, in a suggestion below, or kept by subjects and settings.</p>}
          {counts.forms.map((c) => <AxisCategoryCard key={c.category.id} count={c} worked={worked} rows={rows} settings={settings} exceptions={list.exceptions} preview={preview} openAll={() => openAll(c)} />)}
          {suggested.length === 0 && <p className="muted">None by subject and setting with these settings.</p>}
          {suggested.map((c) => <AxisCategoryCard key={c.category.id} count={c} worked={worked} rows={rows} settings={settings} exceptions={list.exceptions} preview={preview} openAll={() => openAll(c)} />)}
          {tooFew.length > 0 && <p className="muted small">Too few to suggest: {tooFew.map(countLine).join(' · ')}</p>}
          </details>
          <details className="clutter-results-part">
          <summary>Kept</summary>
          <p className="muted small">The photos each keep subject or setting keeps. A clutter photo here is one a keeper took away; check these hold the photos that should not be offered for the trash.</p>
          {counts.keepers.map((c) => <AxisCategoryCard key={c.category.id} count={c} worked={worked} rows={rows} settings={settings} exceptions={list.exceptions} preview={preview} openAll={() => openAll(c)} />)}
          </details>
          {pairs.length > 0 && (
          <details className="clutter-results-part">
          <summary>Subject × setting matrix</summary>
          <div className="segmented" role="group" aria-label="Group the pairs">
            <button className={pairsBy === null ? 'selected' : ''} aria-pressed={pairsBy === null} onClick={() => setPairsBy(null)}>All pairs</button>
            <button className={pairsBy === 'subject' ? 'selected' : ''} aria-pressed={pairsBy === 'subject'} onClick={() => setPairsBy('subject')}>By subject</button>
            <button className={pairsBy === 'setting' ? 'selected' : ''} aria-pressed={pairsBy === 'setting'} onClick={() => setPairsBy('setting')}>By setting</button>
          </div>
          {pairsBy === null ? (
            <>
              <p className="muted small">Every pair of subject and setting, by those that count (or too close), most photos first ({Math.min(PAIR_ROWS, pairs.length)} of {pairs.length.toLocaleString()}). A pair that should come to something else is one for an exception.</p>
              <PairTable rows={pairs.slice(0, PAIR_ROWS)} onOpen={openPair} />
            </>
          ) : (
            <>
              <p className="muted small">Every {pairsBy} with its pairs, the {pairsBy === 'subject' ? 'subjects' : 'settings'} with most photos first. Open one to see where it is found (or what is found there).</p>
              {groupPairs(pairs, pairsBy).map((g) => (
                <details key={g.name} className="clutter-pair-group">
                  <summary>{g.name} <span className="muted small">· {g.count.toLocaleString()} photos in {g.rows.length.toLocaleString()} {g.rows.length === 1 ? 'pair' : 'pairs'}</span></summary>
                  <PairTable rows={g.rows} onOpen={openPair} />
                </details>
              ))}
            </>
          )}
          </details>
          )}
        </section>
      )}
      {/* Like Results: shown from the start, greyed out until the library is read. */}
      {!counts && (
        <section className="card clutter-results-waiting" aria-busy="true">
          <h2>Labelling lab</h2>
          <div className="buttons clutter-show-all">
            <button disabled>Label edges and misses…</button>
            <button disabled>Label random photos…</button>
            <button disabled>Label again: unsure or missing a kind…</button>
            <button disabled>Label these again…</button>
            <button disabled>Copy scores</button>
            <span className="muted small">Once the library is read.</span>
          </div>
        </section>
      )}
      {counts && (
        <section className="card clutter-appear">
          <h2>Labelling lab</h2>
          <div className="buttons clutter-show-all">
            <button onClick={() => openLabelling(false)}>Label edges and misses…</button>
            <button onClick={() => openLabelling(true)}>Label random photos…</button>
            <button disabled={!review || review.queue.length === 0} onClick={() => review && setLabelling({ queue: review.queue, history: [], random: true, review: true })}>
              {review?.button ?? 'Review my random labels'}
            </button>
            <button disabled={restarted === null} onClick={() => restarted && setLabels(restarted)}>Start the review over</button>
            <button disabled={againQueue.length === 0} onClick={() => setLabelling({ queue: againQueue, history: [], random: false, review: false })}>
              Label again: unsure or missing a kind ({againQueue.length.toLocaleString()})…
            </button>
            <select aria-label="Which edge labels to answer again" disabled={!againChoice} value={againChoice?.kind ?? ''} onChange={(e) => setAgainKind(e.target.value)}>
              {kindAgain.map((c) => <option key={c.kind} value={c.kind}>{c.option}</option>)}
            </select>
            <button disabled={!againChoice} onClick={() => againChoice && setLabelling({ queue: againChoice.queue, history: [], random: false, review: false })}>
              Label these again…
            </button>
            <button disabled={Object.keys(labels).length === 0} onClick={copyScores}>Copy scores</button>
            {scoresCopied && <span className="muted small">{scoresCopied}</span>}
            <span className="muted small">
              {copiedText && <>{copiedText}. </>}
              {labelText ?? 'Your verdict on a sample of photos (keep, clutter and which kind, unsure), which the lab scores every change against. Random photos, drawn from the whole library, show its precision and recall.'}
            </span>
          </div>
          {edge && (
            <details className="clutter-edge">
              <summary className="small">{edge.summary}</summary>
              <ul className="small">{edge.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </details>
          )}
        </section>
      )}
      {labelling && (
        <LabelScreen
          mode={labelMode}
          onMode={chooseLabelMode}
          queue={labelling.queue}
          labels={labels}
          kinds={labelKinds}
          guesses={labelGuesses}
          thumbUrl={labelThumb}
          preview={preview}
          onLabel={(key, label) => {
            // A photo drawn at random stays so when labelled again (Label again…, or gone back to).
            // In the review it is marked reviewed, so the review picks up where it left off.
            setLabels((l) => ({ ...l, [key]: labelling.review ? reviewedLabel(label) : labelling.random || l[key]?.random ? { ...label, random: true } : label }));
            setLabelling((s) => (s ? { ...s, queue: s.queue.filter((k) => k !== key), history: [...s.history, key] } : s));
          }}
          onSkip={(key) => setLabelling((s) => (s ? { ...s, queue: s.queue.filter((k) => k !== key), history: [...s.history, key] } : s))}
          onUndo={() => {
            const last = labelling.history.at(-1);
            if (last === undefined) return false;
            // Its label stays (shown on the screen, replaced by a new answer): Back and then Close loses nothing.
            setLabelling((s) => (s ? { ...s, queue: [last, ...s.queue], history: s.history.slice(0, -1) } : s));
            return true;
          }}
          onClear={(key) => setLabels((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== key)))}
          onClose={() => setLabelling(null)}
        />
      )}
      {/* For a coding agent tuning the list from the project (lab/ in it): of no use without one, so folded away at the foot. */}
      <section className="card">
        <details className="clutter-settings" open={lab.state === 'reconnect'}>
          <summary>Lab folder <span className="muted small">· {lab.message}</span></summary>
          <div className="buttons clutter-show-all">
            {lab.state !== 'watching' && <button onClick={() => void connectLab()}>{lab.state === 'reconnect' ? 'Reconnect the lab folder' : 'Connect a lab folder…'}</button>}
            <span className="muted small">Only for a coding agent working in the project: it writes request.json into lab/ there; this page applies it to the list and settings and writes the results back. Without one, leave it unconnected.</span>
          </div>
        </details>
      </section>
      {pendingEdit && editWeighed && (
        <ChangePopup
          title="What the edits change"
          summary={editWeighed.summary}
          scores={editScores}
          note="Each caption says what the photo was and what it becomes; hover over one to see how it scores now and with the edits. Under a photo the edits take out of clutter: the description it scored as there, whose weight Stay raises just enough to keep it there (and others like it). Nothing changes until you apply them; Back to editing keeps your edits."
          applyLabel="Apply the edits"
          cancelLabel="Back to editing"
          grids={editGrids}
          preview={preview}
          problem={null}
          onApply={applyEdits}
          onCancel={() => setPendingEdit(null)}
        />
      )}
      {cardWeighed && (
        <ChangePopup
          title="What the settings change"
          summary={cardWeighed.summary}
          scores={cardScores}
          note="Each caption says what the photo was and what it becomes; hover over one to see how it scores now and with the settings. Nothing changes until you apply them; Back to the settings keeps your changes."
          applyLabel="Apply the settings"
          cancelLabel="Back to the settings"
          grids={cardWeighed.grids}
          preview={preview}
          problem={null}
          onApply={applyCard}
          onCancel={() => setCardSaving(false)}
        />
      )}
    </main>
  );
}

/** A tab with a list of photos handed over by the subject-and-setting page; a clutter category's can be buffed. */
export function AxesFindsPage({ id }: { id: string }) {
  const [finds, setFinds] = useState<AxisFinds | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      setProblem('This tab has lost the clutter page that opened it. Open it again from there.');
      return;
    }
    let answered = false;
    const receive = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== ANSWER || e.data.id !== id) return;
      answered = true;
      if (e.data.finds) setFinds(e.data.finds as AxisFinds);
      else setProblem('The clutter page that opened this tab no longer has these finds (it was reloaded or worked them out again). Open them again from there.');
    };
    window.addEventListener('message', receive);
    opener.postMessage({ type: ASK, id }, location.origin);
    const timer = setTimeout(() => {
      if (!answered) setProblem('The clutter page that opened this tab did not answer. Open the finds again from there.');
    }, HANDOVER_WAIT_MS);
    return () => {
      window.removeEventListener('message', receive);
      clearTimeout(timer);
    };
  }, [id]);
  useEffect(() => {
    if (finds) document.title = `${finds.title} · Photo Cleaner`;
  }, [finds]);
  const deps = useMemo(() => (finds ? searchDeps(finds.account) : null), [finds]);
  const preview: Preview = useCallback((thumbUrl: string, sizePx: number) => deps!.preview(thumbUrl, sizePx), [deps]);
  const buffing = finds?.buffing ?? null;
  const categories = useMemo(() => (finds ? finds.scored.map((s) => s.category) : []), [finds]);

  // The settings this tab counts with: the handed-over ones plus every buff applied from here.
  const [tuned, setTuned] = useState<AxisSettings | null>(null);
  useEffect(() => {
    setTuned(finds?.settings ?? null);
  }, [finds]);
  const [pending, setPending] = useState<{ buff: AxisBuff; mediaKey: string; balance: Record<string, number> } | null>(null);
  const [applyProblem, setApplyProblem] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const matches = useMemo(() => (finds && buffing && tuned ? [...buffing.rows].map(([key, row]) => matchAxes(key, row, finds.scored, finds.overlap, tuned)) : null), [finds, buffing, tuned]);
  const weighed = useMemo(() => {
    if (!finds || !buffing || !tuned || !matches || !pending || pending.buff.by === null) return null;
    const after = withAxisBuff({ ...tuned, descriptionWeights: pending.balance }, pending.buff.description, pending.buff.by);
    const afterMatches = [...buffing.rows].map(([key, row]) => matchAxes(key, row, finds.scored, finds.overlap, after));
    const lists: AxisLists = { before: categories, after: categories, exceptions: { before: finds.exceptions, after: finds.exceptions } };
    const effects = axisEffects(matches, afterMatches, lists, buffing.photos);
    const changes = weightChanges(tuned, after, categories);
    const row = buffing.rows.get(pending.mediaKey);
    if (!row) throw new Error('The photo a buff was chosen for is missing from the scores handed over');
    const own = categories[pending.buff.from]!;
    return { after, lists, effects, changes, own, summary: axisSummary(changesLine(changes, categories), effects, lists), stillOut: !clutterIn(row, finds.scored, finds.overlap, after, finds.exceptions, pending.buff.from) };
  }, [finds, buffing, tuned, matches, pending, categories]);
  const chooseBuff = useCallback(
    (buff: AxisBuff, mediaKey: string) => {
      if (!tuned || buff.by === null) throw new Error('A buff can only be weighed in a tab of a clutter category’s finds');
      setApplyProblem(null);
      setPending({ buff, mediaKey, balance: tuned.descriptionWeights });
    },
    [tuned],
  );
  const applyBuff = () => {
    const opener = window.opener as Window | null;
    if (!weighed || !finds) throw new Error('No buff to apply');
    if (!opener) {
      setApplyProblem('This tab has lost the clutter page that opened it, so the buff can’t be added to its weights. Open the finds again from there.');
      return;
    }
    const message: AppliedChanges = { type: APPLY, id: crypto.randomUUID(), scoring: finds.scoring, changes: weighed.changes };
    const { after, summary } = weighed;
    const timer = setTimeout(() => {
      window.removeEventListener('message', confirm);
      setApplyProblem('The clutter page didn’t confirm the buff. Check its weights there before trying again.');
    }, APPLY_WAIT_MS);
    const confirm = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== APPLIED || e.data.id !== message.id) return;
      window.removeEventListener('message', confirm);
      clearTimeout(timer);
      if (e.data.problem) {
        setApplyProblem(String(e.data.problem));
        return;
      }
      setTuned(after);
      setApplied((a) => [...a, `${summary.what}: ${summary.leave}${summary.join ? `, ${summary.join}` : ''}${summary.move ? `, ${summary.move}` : ''}.`]);
      setPending(null);
    };
    window.addEventListener('message', confirm);
    opener.postMessage(message, location.origin);
  };

  const tiles = useMemo(
    () =>
      finds
        ? finds.photos.map((p): Tile => ({
            ...p,
            breakdowns: () => axisCards(p.row, finds.scored, finds.overlap, tuned ?? finds.settings, finds.exceptions, null),
            everything: () => axisCards(p.row, finds.scored, finds.overlap, tuned ?? finds.settings, finds.exceptions, null, 'large'),
            buff:
              buffing && tuned
                ? {
                    options: () => {
                      // Not clutter any more on this tab's side, with the buffs applied from it: nothing to buff.
                      const match = matchAxes('', p.row, finds.scored, finds.overlap, tuned);
                      const now = sideOutcome(match, categories, finds.exceptions, finds.side);
                      if (now.verdict !== 'clutter') return null;
                      return axisBuffsFor(p.row, finds.scored, finds.overlap, tuned, finds.exceptions, finds.side, MAX_BUFFS[finds.scoring]).map((b): BuffOption => ({ key: String(b.category), label: axisBuffButton(b), onChoose: b.by === null ? null : () => chooseBuff(b, p.mediaKey) }));
                    },
                  }
                : undefined,
          }))
        : [],
    [finds, buffing, tuned, chooseBuff, categories],
  );
  const grids = useMemo(() => {
    if (!finds || !buffing || !tuned || !weighed || !pending) return { chosen: [] as Tile[], changes: [] };
    const tile = (c: AxisChange): Tile => {
      const row = buffing.rows.get(c.mediaKey);
      if (!row) throw new Error('A photo the buff changes is missing from the scores handed over');
      let nudge: Nudge | undefined;
      if (c.before.verdict === 'clutter' && c.after.verdict !== 'clutter' && c.fromDescription) {
        const description = c.fromDescription;
        const at = c.before.category!;
        const raise = axisStayRaise(row, finds.scored, finds.overlap, weighed.after, finds.exceptions, at, description, MAX_BUFFS[finds.scoring]);
        nudge = {
          description,
          category: categories[at]!.label,
          value: pending.balance[description],
          onChange: (value) => setPending((p) => (p ? { ...p, balance: withWeightOrNone(p.balance, description, value) } : p)),
          raise,
          max: MAX_BUFFS[finds.scoring],
          onRaise: () => setPending((p) => (p && raise !== null ? { ...p, balance: withAxisBuff({ ...tuned, descriptionWeights: p.balance }, description, raise).descriptionWeights } : p)),
        };
      }
      return {
        mediaKey: c.mediaKey,
        thumbUrl: buffing.thumbUrls.get(c.mediaKey) ?? null,
        caption: axisCaption(c, weighed.lists),
        breakdowns: () => comparedCards({ row, scored: finds.scored, overlap: finds.overlap, settings: tuned, exceptions: finds.exceptions }, { row, scored: finds.scored, overlap: finds.overlap, settings: weighed.after, exceptions: finds.exceptions }, ['Now', 'With the buff']),
        nudge,
      };
    };
    const chosenRow = buffing.rows.get(pending.mediaKey)!;
    const chosen: Tile[] = [{ mediaKey: pending.mediaKey, thumbUrl: buffing.thumbUrls.get(pending.mediaKey) ?? null, caption: [{ text: weighed.stillOut ? `Left out of ${weighed.own.label}` : `Clutter in ${weighed.own.label} again`, kind: null, strong: true }], breakdowns: () => comparedCards({ row: chosenRow, scored: finds.scored, overlap: finds.overlap, settings: tuned, exceptions: finds.exceptions }, { row: chosenRow, scored: finds.scored, overlap: finds.overlap, settings: weighed.after, exceptions: finds.exceptions }, ['Now', 'With the buff']) }];
    return { chosen, changes: changeGrids(weighed.effects, weighed.lists, tile) };
  }, [finds, buffing, tuned, weighed, pending, categories]);

  return (
    <main className="review calibration clutter-finds">
      <header>
        <h1>Photo Cleaner <span className="muted">/ all finds, by subject and setting (developer tool)</span></h1>
        {finds && <p>{finds.title}</p>}
        {finds && <p className="muted">{finds.settingsLine}. Best score first; hover over a photo to see how it scored. Keep a Google Photos tab open for the previews.</p>}
        {buffing && <p className="muted">Open a photo large to buff it out of clutter: a subject or setting that keeps it strengthened just enough, shown first for every photo it changes.</p>}
      </header>
      {problem && <section className="card"><p className="warn">{problem}</p></section>}
      {applied.length > 0 && (
        <section className="card">
          <h2>Buffs applied from this tab</h2>
          {applied.map((line, i) => <p key={i} className="small">{line}</p>)}
          <p className="muted small">They are in the clutter page’s weights. This list stays as it was when the tab opened, to compare; open it again from the clutter page to see it with them.</p>
        </section>
      )}
      {!finds && !problem && <section className="card"><p className="working" role="status"><span className="spinner-inline" />Getting the finds from the clutter page…</p></section>}
      {finds && (
        <section className="card">
          <PhotoGrid tiles={tiles} preview={preview} />
        </section>
      )}
      {pending && weighed && (
        <ChangePopup
          title="What the buff changes"
          note="Each caption says what the photo was and what it becomes; hover over one to see how it scores now and with the buff. Under a photo the buff takes out of clutter: the description it scored as there, whose weight Stay raises just enough to keep it there (and others like it); that can bring photos in, shown under Join. Nothing changes until you apply it, which adds it all to the weights on the clutter page that opened this tab."
          applyLabel="Apply the buff"
          cancelLabel="Cancel"
          summary={weighed.summary}
          chosen={{ tiles: grids.chosen, line: weighed.stillOut ? `The photo you chose is left out of ${weighed.own.label}.` : `The photo you chose is clutter in ${weighed.own.label} again: the weights raised here outweigh the buff.` }}
          grids={grids.changes}
          preview={preview}
          problem={applyProblem}
          onApply={applyBuff}
          onCancel={() => setPending(null)}
        />
      )}
    </main>
  );
}
