// Search & sweep: find photos by description or by example ("more like these", "less like these"),
// select them and move them to the trash queue, with the keyboard of the Duplicates review. The
// state machine lives here, and view() works out every text the screen shows.

import { count, n } from '../shared/format';
import { emitUsage } from '../shared/usageClient';
import { durationBucket } from '../shared/usage';
import { ACTION_FAILED } from '../duplicates/reviewModel';
import type { StoredDecision } from '../duplicates/reviewStore';
import type { Blocked } from '../duplicates/rules';
import { previewProblem } from '../shared/googleProblems';
import { PhotoSize, type SizeMemory, type SizeStep } from '../shared/photoSize';
import { ViewRotations } from '../shared/viewRotation';
import type { ProtectionChoices } from '../shared/preferences';
import { rankSearch, type SearchHit } from './rules';

/** The result sizes − and + step through; 160 px at first. */
export const TILE_SIZES: readonly SizeStep[] = [
  { tilePx: 120, previewPx: 200 }, { tilePx: 160, previewPx: 200 }, { tilePx: 220, previewPx: 300 },
  { tilePx: 300, previewPx: 400 }, { tilePx: 400, previewPx: 600 }, { tilePx: 520, previewPx: 800 },
];
const DEFAULT_SIZE = 1;
/** The space between tiles in a row, as `.search-grid` in app.css lays them out (var(--space-4)). */
const TILE_GAP_PX = 16;

/** What Search knows about one analysed photo of the latest library scan. */
export interface LibraryPhoto {
  mediaKey: string;
  dedupKey: string;
  takenAtMs: number;
  thumbUrl: string | null;
  vector: Float32Array;
  eligible: boolean;
  approved: boolean;
}

export interface SearchLibrary {
  blocked: Blocked | null;
  photos: Map<string, LibraryPhoto>;
  /** The account's protection choices: which kinds of photo never appear. */
  protection: ProtectionChoices;
}

/** What a sweep did: the photos it queued, and those it left out (no longer eligible, or already queued). */
export interface SweepResult {
  queued: string[];
  leftOut: string[];
}

export interface SearchDeps {
  /** The latest scan's analysed photos with their protection and trash-queue state. */
  loadLibrary(): Promise<SearchLibrary>;
  /** A description's fingerprint; the first call gets the AI model ready ([onProgress] 0–1 while downloading). */
  embedQuery(text: string, onProgress: (fraction: number) => void): Promise<Float32Array>;
  /** Checks each photo again against a fresh scan and queues those still trashable; throws with the reason if it can't queue any. */
  sweep(mediaKeys: string[]): Promise<SweepResult>;
  /** Undoes the newest decision (a sweep or one made in Duplicates); null when there is none. */
  undo(): Promise<StoredDecision | null>;
  /** A preview as an image address, fetched through Google Photos; throws when it can't be had. */
  preview(thumbUrl: string, sizePx: number): Promise<string>;
  /** Where the chosen photo size is remembered. */
  sizeMemory: SizeMemory;
}

export type Tone = 'positive' | 'caution' | 'negative' | 'neutral';
export type Sort = 'best' | 'newest' | 'oldest';
export const SORTS: { id: Sort; label: string }[] = [{ id: 'best', label: 'Best match' }, { id: 'newest', label: 'Newest' }, { id: 'oldest', label: 'Oldest' }];

export interface Notice {
  text: string;
  tone: Tone;
  sequence: number;
  visibleMs: number;
}

export interface SearchTile {
  mediaKey: string;
  imageUrl: string | null;
  /** A thumbnail (or a sharper one, after the photos were made larger) is to be fetched once the tile is in view. */
  imageWanted: boolean;
  selected: boolean;
  focused: boolean;
  /** The one photo the keys act on (not when A outlines them all). */
  current: boolean;
  caption: string;
  link: string;
  /** Why the thumbnail is missing, once fetching it failed (it is tried again when it comes back into view). */
  error: string | null;
}

export interface ExampleView {
  mediaKey: string;
  imageUrl: string | null;
}

export interface ViewerView {
  imageUrl: string | null;
  loading: boolean;
  statusText: string | null;
  infoText: string;
  selectionText: string;
  toggleText: string;
  tone: Tone;
  link: string;
  /** The photo's turn for viewing (0, 90, 180 or 270 degrees clockwise); on its side at 90 and 270. */
  rotationDeg: number;
  sideways: boolean;
  rotationText: string | null;
}

export interface SearchView {
  /** How Search works and which photos never appear (following the protection choices). */
  introText: string;
  query: string;
  /** There is a search to clear (a description, examples or results). */
  canStartOver: boolean;
  searching: boolean;
  progressText: string | null;
  /** "300 best matches · 12 selected"; null before a search. */
  resultText: string | null;
  hiddenText: string | null;
  blockedText: string | null;
  sort: Sort;
  /** How large the results are shown, and whether − and + can change it. */
  tilePx: number;
  canShrink: boolean;
  canGrow: boolean;
  more: ExampleView[];
  less: ExampleView[];
  tiles: SearchTile[];
  /** Changes with every new result list, so the screen can take keyboard focus off the search field. */
  resultsVersion: number;
  focusPulse: number;
  showMoreVisible: boolean;
  confirmText: string | null;
  confirmKind: 'trash' | 'hide' | null;
  confirmTitle: string;
  confirmButtonText: string;
  canHideSelected: boolean;
  notice: Notice | null;
  viewer: ViewerView | null;
}

const PAGE = 300;
const THUMB_CACHE = 900;
const FETCH_CONCURRENCY = 6;
const VIEWER_PX = 1024;

const BLOCKED_TEXT: Record<Blocked, string> = {
  NOT_SCANNED: 'The library has not been scanned yet. Start a scan on the Scan tab.',
  SCAN_UNFINISHED: 'The library scan is unfinished, so no photo can be trashed. Finish it on the Scan tab.',
  SCAN_STALE: 'The library scan is more than a day old. Check for new photos on the Scan tab (about 2–3 minutes).',
};

/**
 * The explanation above the search field. Which photos never appear follows the account's protection
 * choices; before the library is loaded it can't say which kinds those are.
 */
export function searchIntroText(protection: ProtectionChoices | null): string {
  const kinds = protection === null ? ['protected photos'] : [
    ...(protection.favourites ? ['favourites'] : []),
    ...(protection.albums ? ['photos in albums'] : []),
    ...(protection.archived ? ['archived photos'] : []),
  ];
  const never = [...kinds, 'photos of unknown status'];
  const listed = never.length === 1 ? never[0] : `${never.slice(0, -1).join(', ')} and ${never.at(-1)}`;
  return 'Describe what to search for (for example “meal prep boxes in plastic containers”, “printed documents”, “screenshots”). ' +
    `The strongest matches are shown; ${listed} never appear. Click to select, Ctrl/Cmd-click to add or remove a photo, Shift-click to select a range. ` +
    'H hides selected photos from these results; a new search shows them again. M finds more like the selected photos, L fewer. D asks before trashing.';
}

/** What a sweep did, in words: how many went to the trash queue, and how many were left out and why. */
function sweepText(queued: number, leftOut: number): string {
  const why = leftOut === 1
    ? 'it is protected now, gone from the library or already in the trash queue'
    : 'they are protected now, gone from the library or already in the trash queue';
  if (queued === 0) return `Nothing was moved to the trash: ${leftOut === 1 ? 'the selected photo changed since the search' : `the ${n(leftOut)} selected photos changed since the search`}; ${why}.`;
  const moved = `Moved ${count(queued, 'photo', 'photos')} to the trash queue. Z undoes it.`;
  return leftOut === 0 ? moved : `${moved} ${count(leftOut, 'photo was', 'photos were')} left out: ${why}.`;
}

function photoDay(ms: number): string {
  if ([0, 315_532_800_000].some((d) => Math.abs(ms - d) <= 14 * 3_600_000)) return 'Date unknown';
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The current search: the words, their fingerprint, and the example photos. */
interface Query {
  text: string | null;
  textVector: Float32Array | null;
  more: string[];
  less: string[];
}

export class SearchModel {
  private usageSelectionRecorded = false;
  private usageSelectionEnabled = true;
  private readonly listeners = new Set<() => void>();
  private readonly decisionListeners = new Set<() => void>();
  private current: SearchView;

  private library: SearchLibrary | null = null;
  /** The saved data changed (a scan, an undo): the next search reads it again. The old copy stays until then, as the results on screen need it. */
  private libraryStale = false;
  private queryText = '';
  private query: Query | null = null;
  private limit = PAGE;
  private sort: Sort = 'best';
  /** Ranked strongest first; [shown] is the same in the chosen order. */
  private ranked: SearchHit[] = [];
  private shown: SearchHit[] = [];
  private hidden = { protectedOrUnknown: 0, alreadyApproved: 0, lessLike: 0 };
  private readonly selected = new Set<string>();
  /** Hidden only in this search, including refinements and Show more; never a saved decision. */
  private readonly hiddenResults = new Set<string>();
  private hasMore = false;
  private searching = false;
  private modelReady = false;
  /** The first text search is getting the AI model ready (it takes a while). */
  private loadingModel = false;
  private modelPercent: number | null = null;
  private confirming: 'trash' | 'hide' | null = null;
  private notice: Notice | null = null;
  private sequence = 0;
  private resultsVersion = 0;

  private focusedIndex = 0;
  /** After a Shift-click: where the outlined range starts; it ends at [focusedIndex]. */
  private rangeStart: number | null = null;
  private columns = 1;
  /** The width the grid last measured; the columns follow it and the photo size. */
  private gridWidthPx: number | null = null;
  private allFocused = false;
  private focusPulse = 0;
  private readonly size: PhotoSize;

  /** Each photo's thumbnail, with the size it was fetched at (a larger photo size fetches a sharper one). */
  private readonly thumbs = new Map<string, { url: string; px: number }>();
  private readonly thumbErrors = new Map<string, string>();
  private readonly loading = new Set<string>();
  private readonly waiting: LibraryPhoto[] = [];
  private fetching = 0;
  private readonly large = new Map<string, string | null>();
  private viewerIndex: number | null = null;
  private readonly rotations = new ViewRotations();

  constructor(private readonly deps: SearchDeps) {
    this.size = new PhotoSize(TILE_SIZES, DEFAULT_SIZE, deps.sizeMemory);
    this.current = this.view();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): SearchView => this.current;

  /** [listener] hears when Search changed the saved decisions (a sweep, an undo), so Duplicates can rebuild its groups. */
  onDecisionsChanged(listener: () => void): () => void {
    this.decisionListeners.add(listener);
    return () => this.decisionListeners.delete(listener);
  }

  private decisionsChanged(): void {
    for (const l of this.decisionListeners) l();
  }

  private publish(): void {
    if (this.usageSelectionEnabled && !this.usageSelectionRecorded && !this.searching && this.selected.size > 0) {
      this.usageSelectionRecorded = true;
      emitUsage({ name: 'search_selected', params: {} });
    }
    this.current = this.view();
    for (const l of this.listeners) l();
  }

  private say(text: string, tone: Tone): void {
    this.notice = { text, tone, sequence: ++this.sequence, visibleMs: Math.min(4_000 + 70 * text.length, 15_000) };
  }

  // --- searching ---

  setQueryText(text: string): void {
    this.queryText = text;
    this.publish();
  }

  /** Enter in the search field, or the Search button: a new search by description (examples cleared). */
  searchText(): void {
    const text = this.queryText.trim();
    if (text === '') return;
    void this.run({ text, textVector: null, more: [], less: [] }, { resetHidden: true });
  }

  /** "Search more like these" from Duplicates: a new search by these example photos. */
  searchLike(mediaKeys: string[]): void {
    if (this.searching) return this.sayAndPublish('A search is still running. Try again when it has finished.', 'caution');
    this.queryText = '';
    this.say(`Searching for photos like the ${count(mediaKeys.length, 'photo', 'photos')} from the duplicate group.`, 'neutral');
    void this.run({ text: null, textVector: null, more: [...mediaKeys], less: [] }, { resetHidden: true });
  }

  /** M / L: the selected photos become examples to find more of, or fewer of; the search runs again. */
  addExamples(kind: 'more' | 'less'): void {
    if (this.selected.size === 0) return this.sayAndPublish('Select a few example photos first.', 'caution');
    const base = this.query ?? { text: null, textVector: null, more: [], less: [] };
    const keys = [...this.selected];
    const next: Query = kind === 'more'
      ? { ...base, more: [...new Set([...base.more, ...keys])], less: base.less.filter((k) => !this.selected.has(k)) }
      : { ...base, less: [...new Set([...base.less, ...keys])], more: base.more.filter((k) => !this.selected.has(k)) };
    if (next.text === null && next.more.length === 0) return this.sayAndPublish('“Less like these” needs something to search for: a description or photos to find more of.', 'caution');
    // Keep the selection for more-like refinements; the less-like examples are no longer selected.
    void this.run(next, { keepSelection: kind === 'more', usageKind: 'examples' });
  }

  /** The × on an example: it no longer counts; the search runs again (unless nothing is left to look for). */
  removeExample(mediaKey: string): void {
    if (!this.query) return;
    const next = { ...this.query, more: this.query.more.filter((k) => k !== mediaKey), less: this.query.less.filter((k) => k !== mediaKey) };
    if (next.text === null && next.more.length === 0) {
      this.query = next;
      this.ranked = [];
      this.shown = [];
      this.hasMore = false;
      this.selected.clear();
      this.confirming = null;
      this.resetFocus();
      return this.publish();
    }
    void this.run(next);
  }

  /** Start over: no description, no examples, no results. */
  startOver(): void {
    if (this.searching) return;
    this.queryText = '';
    this.query = null;
    this.ranked = [];
    this.shown = [];
    this.hidden = { protectedOrUnknown: 0, alreadyApproved: 0, lessLike: 0 };
    this.selected.clear();
    this.hiddenResults.clear();
    this.hasMore = false;
    this.confirming = null;
    this.resetFocus();
    this.resultsVersion++;
    this.publish();
  }

  /** The library or the decisions changed (a scan finished, a decision in Duplicates): the next search reads them again. */
  libraryChanged(): void {
    this.libraryStale = true;
  }

  private sayAndPublish(text: string, tone: Tone): void {
    this.say(text, tone);
    this.publish();
  }

  /** Runs [query]; [keepSelection]: the selected photos still among the results stay selected. */
  private async run(query: Query, { keepSelection = false, resetHidden = false, trackUsage = true, usageKind }: {
    keepSelection?: boolean; resetHidden?: boolean; trackUsage?: boolean; usageKind?: 'text' | 'like' | 'examples';
  } = {}): Promise<void> {
    if (this.searching) return;
    const startedAt = Date.now();
    const searchKind = usageKind ?? (query.text !== null ? (query.more.length || query.less.length ? 'examples' : 'text') : query.less.length ? 'examples' : 'like');
    this.usageSelectionEnabled = trackUsage;
    this.usageSelectionRecorded = false;
    if (trackUsage) emitUsage({ name: 'search_submitted', params: { search_kind: searchKind } });
    this.searching = true;
    this.notice = this.notice?.tone === 'neutral' ? this.notice : null;
    this.publish();
    try {
      if (!this.library || this.libraryStale) {
        this.library = await this.deps.loadLibrary();
        this.libraryStale = false;
      }
      if (this.library.blocked) {
        this.query = query;
        this.ranked = [];
        this.shown = [];
        this.hasMore = false;
        this.selected.clear();
        this.confirming = null;
        if (trackUsage) emitUsage({ name: 'search_results', params: { search_kind: searchKind, state: 'blocked', duration_bucket: durationBucket(Date.now() - startedAt) } });
        return;
      }
      let textVector = query.textVector;
      if (query.text !== null && textVector === null) {
        const modelStart = Date.now();
        if (!this.modelReady) emitUsage({ name: 'model_load_started', params: { feature: 'search' } });
        this.loadingModel = !this.modelReady;
        this.publish();
        textVector = await this.deps.embedQuery(query.text, (fraction) => {
          this.modelPercent = fraction < 1 ? Math.floor(fraction * 100) : null;
          this.publish();
        });
        if (!this.modelReady) emitUsage({ name: 'model_ready', params: { feature: 'search', duration_bucket: durationBucket(Date.now() - modelStart) } });
        this.modelReady = true;
      }
      this.query = { ...query, textVector };
      if (resetHidden) this.hiddenResults.clear();
      this.limit = PAGE;
      this.rank();
      this.keepSelectedResults(keepSelection);
      this.confirming = null;
      this.resetFocus();
      this.resultsVersion++;
      if (trackUsage) emitUsage({ name: 'search_results', params: { search_kind: searchKind, state: this.shown.length ? 'usable' : 'empty', duration_bucket: durationBucket(Date.now() - startedAt) } });
    } catch (error) {
      emitUsage({ name: 'feature_failed', params: { feature: 'search', reason: this.loadingModel ? 'model' : 'unknown' } });
      this.say(error instanceof Error ? error.message : String(error), 'negative');
    } finally {
      this.searching = false;
      this.loadingModel = false;
      this.modelPercent = null;
      this.publish();
    }
  }

  /**
   * After a new search: what is selected is only ever among the results on screen, so a
   * selected photo no longer among them is no longer selected (and the user is told).
   */
  private keepSelectedResults(keep: boolean): void {
    if (!keep) return this.selected.clear();
    const results = new Set(this.ranked.map((h) => h.mediaKey));
    const dropped = [...this.selected].filter((key) => !results.has(key));
    for (const key of dropped) this.selected.delete(key);
    if (dropped.length > 0) {
      this.say(`${count(dropped.length, 'selected photo is', 'selected photos are')} no longer among the best matches, so ${dropped.length === 1 ? 'it is' : 'they are'} not selected now.`, 'caution');
    }
  }

  /** Ranks the library for the current query, keeping the strongest [limit]. */
  private rank(): void {
    const library = this.library!;
    const query = this.query!;
    const vectorOf = (key: string) => library.photos.get(key)?.vector;
    const more = query.more.map(vectorOf).filter((v): v is Float32Array => v !== undefined);
    const less = query.less.map(vectorOf).filter((v): v is Float32Array => v !== undefined);
    if (query.textVector === null && more.length === 0) {
      throw new Error('None of the chosen photos has been analysed yet. Check for new photos on the Scan tab first.');
    }
    const candidates = [...library.photos.values()].filter((photo) => !this.hiddenResults.has(photo.mediaKey));
    const result = rankSearch(candidates, { text: query.textVector, more, less }, this.limit);
    this.ranked = result.hits;
    this.hasMore = result.hits.length >= this.limit;
    this.hidden = { protectedOrUnknown: result.protectedOrUnknownHidden, alreadyApproved: result.alreadyApprovedHidden, lessLike: result.lessLikeHidden };
    this.applySort();
  }

  private applySort(): void {
    const taken = (h: SearchHit) => this.library!.photos.get(h.mediaKey)!.takenAtMs;
    this.shown = this.sort === 'best' ? [...this.ranked]
      : [...this.ranked].sort((a, b) => (this.sort === 'newest' ? taken(b) - taken(a) : taken(a) - taken(b)));
  }

  setSort(sort: Sort): void {
    if (sort === this.sort) return;
    this.sort = sort;
    if (this.query && this.library) this.applySort();
    this.resetFocus();
    this.resultsVersion++;
    this.publish();
  }

  /** Show more: the next 300 matches; the selection and the photo in focus stay. */
  showMore(): void {
    if (!this.query || !this.library || this.searching) return;
    const focusedKey = this.shown[this.focusedIndex]?.mediaKey;
    this.limit += PAGE;
    try {
      this.rank();
    } catch (error) {
      this.say(error instanceof Error ? error.message : String(error), 'negative');
    }
    const index = this.shown.findIndex((h) => h.mediaKey === focusedKey);
    this.focusedIndex = Math.max(0, index);
    this.rangeStart = null;
    this.publish();
  }

  // --- focus and selection (as in the Duplicates review) ---

  private resetFocus(): void {
    this.focusedIndex = 0;
    this.rangeStart = null;
    this.allFocused = false;
  }

  gridMeasured(columns: number): void {
    this.columns = Math.max(1, columns);
  }

  /** The grid's width in pixels, as the screen measured it; a hidden grid (0) keeps the last real width. */
  gridWidthMeasured(widthPx: number): void {
    if (widthPx <= 0) return;
    this.gridWidthPx = widthPx;
    this.measureColumns();
  }

  private measureColumns(): void {
    if (this.gridWidthPx !== null) this.gridMeasured(Math.floor((this.gridWidthPx + TILE_GAP_PX) / (this.size.current.tilePx + TILE_GAP_PX)));
  }

  /** − and +: the results one size smaller or larger; the outlined photo stays in view. */
  resize(delta: 1 | -1): void {
    if (!this.size.change(delta)) {
      return this.sayAndPublish(delta > 0 ? 'The photos are at their largest.' : 'The photos are at their smallest.', 'caution');
    }
    this.measureColumns();
    this.focusPulse++;
    this.publish();
  }

  /** The examples' thumbnails, for those not fetched yet. */
  loadExampleThumbs(): void {
    for (const mediaKey of [...(this.query?.more ?? []), ...(this.query?.less ?? [])]) {
      if (!this.thumbs.has(mediaKey)) this.tileVisible(mediaKey);
    }
  }

  /** Whether [mediaKey]'s thumbnail is missing, or smaller than the photo size now wants. */
  private thumbWanted(mediaKey: string): boolean {
    return (this.thumbs.get(mediaKey)?.px ?? 0) < this.size.current.previewPx;
  }

  private resultsOrSay(): boolean {
    if (this.shown.length > 0) return true;
    this.sayAndPublish(this.query ? 'No results to act on.' : 'No results yet. Describe the photos above and press Enter.', 'caution');
    return false;
  }

  /** Arrows: within the row and the column; a tap at the edge bounces, a slide into it just stops. */
  focusMove(dx: number, dy: number, held = false): void {
    if (!this.resultsOrSay()) return;
    this.rangeStart = null;
    if (this.allFocused) {
      this.allFocused = false;
    } else {
      const column = this.focusedIndex % this.columns;
      const target = this.focusedIndex + dx + dy * this.columns;
      if (column + dx < 0 || column + dx >= this.columns || target < 0 || target >= this.shown.length) {
        if (held) return;
        this.focusPulse++;
        return this.publish();
      }
      this.focusedIndex = target;
    }
    this.focusPulse++;
    this.publish();
  }

  /**
   * A click selects just this photo. Ctrl/Cmd-click toggles it without changing other selections.
   * Shift selects the range from the outlined photo; Ctrl/Cmd with Shift adds the range.
   */
  tileClicked(index: number, shift: boolean, additive = false): void {
    if (index < 0 || index >= this.shown.length) return;
    if (index !== this.focusedIndex || this.allFocused || this.rangeStart !== null || shift) this.focusPulse++;
    if (shift && !this.allFocused) {
      const start = this.rangeStart ?? this.focusedIndex;
      if (!additive) this.selected.clear();
      for (const i of this.rangeIndices(start, index)) this.selected.add(this.shown[i]!.mediaKey);
      this.rangeStart = start;
    } else {
      if (additive) this.toggle(this.shown[index]!.mediaKey);
      else {
        this.selected.clear();
        this.selected.add(this.shown[index]!.mediaKey);
      }
      this.rangeStart = null;
    }
    this.focusedIndex = index;
    this.allFocused = false;
    this.confirming = null;
    this.publish();
  }

  private rangeIndices(from: number, to: number): number[] {
    const low = Math.min(from, to);
    return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => low + i);
  }

  /** The outlined photos' places in the results: every result after A, the range after a Shift-click, or the one photo. */
  private focusedIndices(): number[] {
    if (this.allFocused) return this.shown.map((_, i) => i);
    return this.rangeIndices(this.rangeStart ?? this.focusedIndex, this.focusedIndex);
  }

  private toggle(mediaKey: string): void {
    if (this.selected.has(mediaKey)) this.selected.delete(mediaKey);
    else this.selected.add(mediaKey);
  }

  /** Space: the outlined photos, every one of them (or none, when they all are). */
  toggleFocused(): void {
    if (!this.resultsOrSay()) return;
    const outlined = this.focusedIndices().map((i) => this.shown[i]!.mediaKey);
    const all = outlined.every((key) => this.selected.has(key));
    for (const key of outlined) {
      if (all) this.selected.delete(key);
      else this.selected.add(key);
    }
    this.confirming = null;
    this.publish();
  }

  /** A: select and outline every result; A again clears the selection. */
  focusAll(): void {
    if (!this.resultsOrSay()) return;
    this.allFocused = !this.allFocused;
    this.selected.clear();
    if (this.allFocused) for (const hit of this.shown) this.selected.add(hit.mediaKey);
    this.rangeStart = null;
    this.confirming = null;
    this.focusPulse++;
    this.publish();
  }

  // --- hiding results ---

  /** H / Hide from results: one selected photo at once, several only after confirmation. */
  hideSelected(): void {
    if (this.searching) return;
    if (this.selected.size === 0) return this.sayAndPublish('Select photos to hide from these results first.', 'caution');
    if (this.selected.size === 1) return this.hideResults([...this.selected]);
    if (this.viewerIndex !== null) this.viewerClose();
    this.confirming = 'hide';
    this.publish();
  }

  /** The × on a result hides only that photo, whether selected or not. */
  hideResult(mediaKey: string): void {
    if (this.searching || !this.shown.some((hit) => hit.mediaKey === mediaKey)) return;
    this.hideResults([mediaKey], false);
  }

  private hideResults(keys: string[], focusFeedback = true): void {
    const focusedKey = this.shown[this.focusedIndex]?.mediaKey;
    const viewerKey = this.viewerIndex === null ? null : this.shown[this.viewerIndex]?.mediaKey;
    for (const key of keys) {
      this.hiddenResults.add(key);
      this.selected.delete(key);
    }
    this.ranked = this.ranked.filter((hit) => !this.hiddenResults.has(hit.mediaKey));
    this.shown = this.shown.filter((hit) => !this.hiddenResults.has(hit.mediaKey));
    const remainingIndex = (key: string | undefined, previous: number) => {
      const kept = this.shown.findIndex((hit) => hit.mediaKey === key);
      return kept >= 0 ? kept : Math.min(previous, Math.max(0, this.shown.length - 1));
    };
    this.focusedIndex = remainingIndex(focusedKey, this.focusedIndex);
    if (this.viewerIndex !== null) {
      this.viewerIndex = this.shown.length === 0 ? null : remainingIndex(viewerKey ?? undefined, this.viewerIndex);
      if (this.viewerIndex !== null) this.loadLarge();
    }
    this.rangeStart = null;
    this.allFocused = false;
    this.confirming = null;
    if (focusFeedback) this.focusPulse++;
    this.say(`Hidden ${count(keys.length, 'photo', 'photos')} from these results. Nothing was trashed. A new search shows them again.`, 'neutral');
    this.publish();
  }

  // --- the sweep ---

  /** D: asks to confirm moving the selection to the trash. */
  approve(): void {
    if (this.selected.size === 0) return this.sayAndPublish('Select photos to trash first.', 'caution');
    if (this.confirming === 'trash') return this.sayAndPublish('Press Enter to move them to the trash, or Esc to cancel.', 'caution');
    this.confirming = 'trash';
    emitUsage({ name: 'trash_confirmation', params: { action: 'shown' } });
    this.publish();
  }

  /** Enter: confirms while asking; otherwise views the outlined photo large. */
  enter(): void {
    if (this.confirming === 'hide') return this.hideResults([...this.selected]);
    if (this.confirming === 'trash') return void this.confirm();
    if (!this.resultsOrSay()) return;
    this.openViewer(this.focusedIndex);
  }

  /** Esc: cancels the question. */
  cancel(): void {
    if (!this.confirming) return;
    if (this.confirming === 'trash') emitUsage({ name: 'trash_confirmation', params: { action: 'cancelled' } });
    this.confirming = null;
    this.publish();
  }

  private async confirm(): Promise<void> {
    const keys = [...this.selected];
    this.confirming = null;
    let result: SweepResult;
    try {
      result = await this.deps.sweep(keys);
    } catch (error) {
      return this.sayAndPublish(error instanceof Error ? error.message : 'Moving to the trash failed.', 'negative');
    }
    const { queued, leftOut } = result;
    if (queued.length === 0) emitUsage({ name: 'feature_blocked', params: { feature: 'search', reason: 'protection' } });
    if (queued.length > 0) this.decisionsChanged();
    // The queued ones are in the trash queue now: gone from the results, and from future searches.
    for (const key of queued) {
      const photo = this.library?.photos.get(key);
      if (photo) photo.approved = true;
    }
    // The ones left out changed since the search (protected now, or queued elsewhere): they go too, and
    // the next search reads the saved data again to show them as they are.
    for (const key of leftOut) {
      const photo = this.library?.photos.get(key);
      if (photo) photo.eligible = false;
    }
    if (leftOut.length > 0) this.libraryStale = true;
    const gone = new Set(keys);
    this.ranked = this.ranked.filter((h) => !gone.has(h.mediaKey));
    this.shown = this.shown.filter((h) => !gone.has(h.mediaKey));
    this.hidden.alreadyApproved += queued.length;
    this.selected.clear();
    this.focusedIndex = Math.min(this.focusedIndex, Math.max(0, this.shown.length - 1));
    this.rangeStart = null;
    this.say(sweepText(queued.length, leftOut.length), leftOut.length > 0 ? 'caution' : 'positive');
    this.publish();
  }

  /** Z: undoes the newest decision (a sweep, or one made in Duplicates); the search runs again to show it. */
  undo(): void {
    void (async () => {
      const undone = await this.deps.undo();
      if (undone === null) return this.sayAndPublish('Nothing to undo.', 'caution');
      this.decisionsChanged();
      this.libraryStale = true;
      if (this.query) await this.run(this.query, { trackUsage: false });
      this.say(undone.kind === 'APPROVED' ? 'Undid the trashing: photos not yet sent are cancelled and any already trashed are restored' : 'Undid the last decision in Duplicates', 'positive');
      this.publish();
    })().catch((error: unknown) => {
      console.error('Photo Cleaner: undo failed', error);
      this.sayAndPublish(ACTION_FAILED, 'negative');
    });
  }

  // --- thumbnails and the viewer ---

  /** A tile came into view: its thumbnail (or a sharper one) is fetched, a few at a time. */
  tileVisible(mediaKey: string): void {
    if (!this.thumbWanted(mediaKey) || this.loading.has(mediaKey)) return;
    const photo = this.library?.photos.get(mediaKey);
    if (!photo?.thumbUrl) return;
    this.loading.add(mediaKey);
    this.waiting.push(photo);
    this.pump();
  }

  private pump(): void {
    while (this.fetching < FETCH_CONCURRENCY && this.waiting.length > 0) {
      const photo = this.waiting.shift()!;
      const px = this.size.current.previewPx;
      this.fetching++;
      void this.deps.preview(photo.thumbUrl!, px).then(
        (url) => {
          this.thumbErrors.delete(photo.mediaKey);
          this.thumbs.delete(photo.mediaKey);
          this.thumbs.set(photo.mediaKey, { url, px });
          while (this.thumbs.size > THUMB_CACHE) this.thumbs.delete(this.thumbs.keys().next().value!);
        },
        (e: unknown) => void this.thumbErrors.set(photo.mediaKey, previewProblem('Search', e)),
      ).finally(() => {
        this.fetching--;
        this.loading.delete(photo.mediaKey);
        this.publish();
        this.pump();
      });
    }
  }

  openViewer(index: number): void {
    if (index < 0 || index >= this.shown.length) return;
    this.confirming = null;
    this.viewerIndex = index;
    this.loadLarge();
    this.publish();
  }

  viewerStep(delta: number): void {
    if (this.viewerIndex === null) return;
    this.viewerIndex = Math.min(Math.max(this.viewerIndex + delta, 0), this.shown.length - 1);
    this.loadLarge();
    this.publish();
  }

  viewerClose(): void {
    if (this.viewerIndex === null) return;
    this.focusedIndex = this.viewerIndex;
    this.rangeStart = null;
    this.allFocused = false;
    this.viewerIndex = null;
    this.publish();
  }

  viewerToggle(): void {
    if (this.viewerIndex === null) return;
    this.toggle(this.shown[this.viewerIndex]!.mediaKey);
    this.confirming = null;
    this.publish();
  }

  /** R and the rotate buttons: the photo shown a quarter turn clockwise (1) or back (−1), for viewing only. */
  viewerRotate(delta: 1 | -1): void {
    if (this.viewerIndex === null) return;
    this.rotations.turn(this.shown[this.viewerIndex]!.mediaKey, delta);
    this.publish();
  }

  private loadLarge(): void {
    for (const offset of [0, 1, -1, 2]) {
      const hit = this.shown[this.viewerIndex! + offset];
      const photo = hit && this.library?.photos.get(hit.mediaKey);
      if (!photo?.thumbUrl || this.large.has(photo.mediaKey)) continue;
      this.large.set(photo.mediaKey, null);
      void this.deps.preview(photo.thumbUrl, VIEWER_PX).then(
        (url) => this.large.set(photo.mediaKey, url),
        (e: unknown) => {
          previewProblem('Search viewer', e);
          this.large.set(photo.mediaKey, 'failed');
        },
      ).finally(() => this.publish());
    }
  }

  // --- what the screen shows ---

  view(): SearchView {
    const photos = this.library?.photos;
    const caption = (h: SearchHit) => `${photoDay(photos!.get(h.mediaKey)!.takenAtMs)} · match #${h.rank}`;
    const hiddenParts = [
      ...(this.hiddenResults.size > 0 ? [`${count(this.hiddenResults.size, 'photo', 'photos')} hidden from these results`] : []),
      ...(this.hidden.protectedOrUnknown > 0 ? [`${count(this.hidden.protectedOrUnknown, 'protected or unknown photo', 'protected or unknown photos')} hidden`] : []),
      ...(this.hidden.alreadyApproved > 0 ? [`${n(this.hidden.alreadyApproved)} already in the trash queue hidden`] : []),
      ...(this.hidden.lessLike > 0 ? [`${n(this.hidden.lessLike)} more like the unwanted examples hidden`] : []),
    ];
    const example = (mediaKey: string): ExampleView => ({ mediaKey, imageUrl: this.thumbs.get(mediaKey)?.url ?? null });
    const outlined = new Set(this.focusedIndices());
    return {
      introText: searchIntroText(this.library?.protection ?? null),
      query: this.queryText,
      canStartOver: this.query !== null || this.queryText !== '',
      searching: this.searching,
      progressText: !this.searching ? null
        : this.modelPercent !== null ? `Searching… downloading the AI model (once): ${this.modelPercent}%`
          : this.loadingModel ? 'Searching… the first search also gets the AI model ready on the graphics card (about 10–20 s).'
            : 'Searching…',
      resultText: this.query && !this.library?.blocked ? `${count(this.shown.length, 'best match', 'best matches')} · ${n(this.selected.size)} selected` : null,
      hiddenText: this.query && hiddenParts.length > 0 ? hiddenParts.join(' · ') : null,
      blockedText: this.library?.blocked ? BLOCKED_TEXT[this.library.blocked] : null,
      sort: this.sort,
      tilePx: this.size.current.tilePx,
      canShrink: this.size.canShrink,
      canGrow: this.size.canGrow,
      more: (this.query?.more ?? []).map(example),
      less: (this.query?.less ?? []).map(example),
      tiles: this.shown.map((h, index) => ({
        mediaKey: h.mediaKey,
        imageUrl: this.thumbs.get(h.mediaKey)?.url ?? null,
        imageWanted: this.thumbWanted(h.mediaKey),
        selected: this.selected.has(h.mediaKey),
        focused: outlined.has(index),
        current: !this.allFocused && index === this.focusedIndex,
        caption: caption(h),
        link: `https://photos.google.com/photo/${h.mediaKey}`,
        error: this.thumbErrors.get(h.mediaKey) ?? null,
      })),
      resultsVersion: this.resultsVersion,
      focusPulse: this.focusPulse,
      showMoreVisible: this.hasMore,
      canHideSelected: this.selected.size > 0 && !this.searching,
      confirmKind: this.confirming,
      confirmTitle: this.confirming === 'hide' ? 'Hide from results?' : 'Move to the trash?',
      confirmButtonText: this.confirming === 'hide' ? 'Hide from results' : 'Move to trash',
      confirmText: this.confirming === 'hide'
        ? `Hide ${count(this.selected.size, 'selected photo', 'selected photos')} from these results? Nothing will be trashed. A new search will show them again.`
        : this.confirming === 'trash'
          ? `Move ${count(this.selected.size, 'photo', 'photos')} to the trash? They go to Google Photos' trash, where they stay for 60 days.`
          : null,
      notice: this.notice,
      viewer: this.viewerIndex === null ? null : this.viewerView(this.viewerIndex, caption),
    };
  }

  private viewerView(index: number, caption: (h: SearchHit) => string): ViewerView {
    const hit = this.shown[index]!;
    const large = this.large.get(hit.mediaKey);
    const failed = large === 'failed';
    const selected = this.selected.has(hit.mediaKey);
    return {
      imageUrl: (large && !failed ? large : null) ?? this.thumbs.get(hit.mediaKey)?.url ?? null,
      loading: large === null || large === undefined,
      statusText: failed ? 'The large preview could not be loaded; showing the thumbnail.' : large ? null : 'Loading the large preview…',
      infoText: `${index + 1} of ${n(this.shown.length)} · ${caption(hit)}`,
      selectionText: selected ? 'Selected' : 'Not selected',
      toggleText: 'Toggle selection',
      tone: 'neutral',
      link: `https://photos.google.com/photo/${hit.mediaKey}`,
      ...this.rotations.of(hit.mediaKey),
    };
  }
}
