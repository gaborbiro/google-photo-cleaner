// The Duplicates review: one group at a time, decided with the keyboard. The browser twin of the
// desktop's ReviewViewModel: the state machine (focus, selection, decisions, undo, previews,
// viewer) lives here, and view() works out every text and colour the screen shows.

import { count, n } from '../shared/format';
import { previewProblem, previewProblemText } from '../shared/googleProblems';
import type { StoredDecision } from './reviewStore';
import { decisionItems, type Blocked, type DecisionKind, type DuplicateGroup, type GroupMember, type ReviewQueue } from './rules';
import type { TrashQueueStatus } from './trash';

/** When saving or reading the decisions failed (details in the log). */
export const ACTION_FAILED = "That didn't work: Photo Cleaner couldn't read or save its data. Try again.";

export type Tone = 'positive' | 'caution' | 'negative' | 'neutral';

/** Feedback for the last key press or click; [sequence] changes with every message, so a repeat shows again. */
export interface Notice {
  text: string;
  tone: Tone;
  sequence: number;
  /** How long it stays: time to read it at a relaxed pace (4 s plus 70 ms a character), up to 15 s. */
  visibleMs: number;
}

export interface ReviewDeps {
  /** The groups still to review, built from the saved scan, analysis and decisions. */
  loadQueue(): Promise<ReviewQueue>;
  /** Saves a decision (and, for an approval, queues its photos for the trash). */
  record(group: DuplicateGroup, kind: DecisionKind, items: { mediaKey: string; dedupKey: string }[]): Promise<void>;
  /** Undoes the newest decision; null when there is none. */
  undo(): Promise<StoredDecision | null>;
  /** A preview as an image address, fetched through Google Photos; throws (a SourceError saying why) when it can't be had. */
  preview(thumbUrl: string, sizePx: number): Promise<string>;
  /** How many groups are left to review now (skipped ones included), for the popup to say. */
  groupsLeft(count: number): Promise<void>;
}

export const TILE_PX = 300;
export const TILE_GAP_PX = 12;
const PREVIEW_PX = 400;
const PREVIEW_CACHE = 60;
const VIEWER_PX = 1024;
const VIEWER_CACHE = 12;

export interface TileView {
  mediaKey: string;
  imageUrl: string | null;
  /** Why there is no image; null while loading. */
  error: string | null;
  label: string;
  tone: Tone;
  selectable: boolean;
  focused: boolean;
  /** The one photo the keys act on (not when A outlines the whole group): kept scrolled into view. */
  current: boolean;
  /** A photo new to a moment decided before. */
  newBadge: boolean;
  similarityText: string | null;
  reasons: string[];
  caption: string;
  link: string;
}

export interface GroupView {
  /** Changes when another group comes on. */
  id: string;
  /** Changes with every focus action (arrow, click, A), so the outlined photos bounce again. */
  focusPulse: number;
  selectionText: string;
  warningText: string | null;
  tiles: TileView[];
}

export interface ViewerView {
  imageUrl: string | null;
  loading: boolean;
  statusText: string | null;
  infoText: string;
  selectionText: string;
  tone: Tone;
  link: string;
}

export interface DuplicatesView {
  loadingText: string | null;
  /** Shown with a spinner while something takes a moment ("Undoing…"); null otherwise. */
  workingText: string | null;
  groupsText: string | null;
  progressText: string | null;
  ruleText: string | null;
  blockedText: string | null;
  emptyText: string | null;
  problemText: string | null;
  queueText: string | null;
  queueWaitingText: string | null;
  group: GroupView | null;
  notice: Notice | null;
  viewer: ViewerView | null;
}

const BLOCKED_TEXT: Record<Blocked, string> = {
  NOT_SCANNED: 'The library has not been scanned yet. Start a scan from the Scan tab or the Photo Cleaner panel in Google Photos.',
  SCAN_UNFINISHED: 'The library scan is unfinished, so no photo can be proposed. Finish it on the Scan tab.',
  SCAN_STALE: 'The library scan is more than a day old. Check for new photos on the Scan tab: it re-reads the list of your photos (about 2–3 minutes) and only looks at new ones.',
};

const PROTECTION_WORDS = { FAVOURITE: 'favourite', IN_ALBUM: 'in an album', ARCHIVED: 'archived' } as const;
const PROTECTION_PHRASES = { FAVOURITE: 'a favourite', IN_ALBUM: 'in an album', ARCHIVED: 'archived' } as const;

/** Factory-default camera dates (1 Jan 1970 and 1 Jan 1980) are not when a photo was taken. */
function photoTime(ms: number): string {
  if ([0, 315_532_800_000].some((d) => Math.abs(ms - d) <= 14 * 3_600_000)) return 'Date unknown';
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

/** "protected (favourite, in an album)" or "status unknown": why a photo can never be selected. */
function keepReasonLabel(m: GroupMember): string {
  return m.eligibility === 'PROTECTED' ? `protected (${m.protectionReasons.map((r) => PROTECTION_WORDS[r]).join(', ')})` : 'status unknown';
}

/** "is a favourite and in an album" or "has an unknown status (…)". */
function whyKept(m: GroupMember): string {
  return m.eligibility === 'PROTECTED'
    ? `is ${m.protectionReasons.map((r) => PROTECTION_PHRASES[r]).join(' and ')}`
    : 'has an unknown status (uploaded by someone else and not matched to an album, or missing data)';
}

export class DuplicatesReview {
  private readonly listeners = new Set<() => void>();
  private readonly decisionListeners = new Set<() => void>();
  private current: DuplicatesView;

  private pending: DuplicateGroup[] = [];
  private deferredIds = new Set<string>();
  private totalGroups = 0;
  private decidedGroups = 0;
  private blocked: Blocked | null = null;
  private problem: string | null = null;
  private loaded = false;
  private busy = false;
  private working: string | null = null;
  /** This session's decisions, newest last, with their groups: undone without rebuilding everything. */
  private decided: { group: DuplicateGroup; kind: DecisionKind; wasDeferred: boolean }[] = [];
  private refreshAgain = false;
  private settings: ReviewQueue['settings'] | null = null;
  private notice: Notice | null = null;
  private sequence = 0;
  private queue: TrashQueueStatus | null = null;
  private readonly selections = new Map<string, Set<string>>();
  private readonly previews = new Map<string, string>();
  private readonly previewErrors = new Map<string, string>();
  private readonly loading = new Set<string>();
  private readonly large = new Map<string, string | null>();
  private viewerIndex: number | null = null;

  // Keyboard focus in the group grid: one photo is always outlined, the first when a group comes on.
  private focusedIndex = 0;
  private columns = 1;
  /** After A, the whole group is focused (outline on every photo) until A again, an arrow or a click. */
  private allFocused = false;
  private focusPulse = 0;

  constructor(private readonly deps: ReviewDeps) {
    this.current = this.view();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The screen's state; the same object until something changes. */
  getView = (): DuplicatesView => this.current;

  /** [listener] hears when Duplicates changed the saved decisions (a decision, an undo), so Search can read them again. */
  onDecisionsChanged(listener: () => void): () => void {
    this.decisionListeners.add(listener);
    return () => this.decisionListeners.delete(listener);
  }

  private decisionsChanged(): void {
    for (const l of this.decisionListeners) l();
  }

  private publish(): void {
    this.current = this.view();
    for (const l of this.listeners) l();
  }

  private say(text: string, tone: Tone): void {
    this.notice = { text, tone, sequence: ++this.sequence, visibleMs: Math.min(4_000 + 70 * text.length, 15_000) };
  }

  // --- loading ---

  /** The tab was opened, or a scan or analysis finished: groups are built again. */
  show(): void {
    if (this.busy) {
      this.refreshAgain = true;
      return;
    }
    this.busy = true;
    if (this.loaded) this.working = 'Updating the groups…';
    this.publish();
    void this.run(() => this.reload());
  }

  /**
   * Decisions were made elsewhere (a sweep or an undo in Search): the groups are built again, without
   * the photos now in the trash queue. Before the tab first opens there is nothing to rebuild.
   */
  decisionsChangedElsewhere(): void {
    if (this.loaded || this.busy) this.show();
  }

  private async run(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error('Photo Cleaner: a Duplicates action failed', error);
      this.say(ACTION_FAILED, 'negative');
    } finally {
      this.busy = false;
      this.working = null;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        this.show();
      }
      this.publish();
    }
  }

  private async reload(): Promise<void> {
    const shownBefore = this.pending[0]?.id;
    let queue: ReviewQueue;
    try {
      queue = await this.deps.loadQueue();
    } catch (error) {
      console.error('Photo Cleaner: could not build the duplicate groups', error);
      this.problem = 'The duplicate groups could not be built. Reload this tab to try again.';
      return;
    }
    this.problem = null;
    this.pending = [...queue.pending];
    // The groups in memory may have changed (e.g. a new photo joined one): undo goes through the saved data now.
    this.decided = [];
    // Coming back to the same group (e.g. returning to the tab) keeps the place in it.
    if (this.pending[0]?.id !== shownBefore) this.resetFocus();
    this.focusedIndex = Math.min(this.focusedIndex, Math.max(0, (this.pending[0]?.members.length ?? 1) - 1));
    this.deferredIds = new Set(queue.deferredIds);
    this.totalGroups = queue.totalGroups;
    this.decidedGroups = queue.decidedGroups;
    this.blocked = queue.blocked;
    this.settings = queue.settings;
    this.loaded = true;
    if (!queue.blocked) this.reportGroupsLeft();
    this.publish();
    this.preload();
  }

  private reportGroupsLeft(): void {
    this.deps.groupsLeft(this.pending.length).catch((error: unknown) => console.warn('Photo Cleaner: could not save how many groups are left', error));
  }

  setQueueStatus(status: TrashQueueStatus): void {
    this.queue = status;
    this.publish();
  }

  /** Previews for the current group and the next two, so deciding never waits on the network. */
  private preload(): void {
    for (const group of this.pending.slice(0, 3)) for (const m of group.members) void this.loadPreview(m);
  }

  private async loadPreview(m: GroupMember): Promise<void> {
    if (this.previews.has(m.mediaKey) || this.previewErrors.has(m.mediaKey) || this.loading.has(m.mediaKey)) return;
    if (m.thumbUrl === null) {
      this.previewErrors.set(m.mediaKey, previewProblemText(null));
      return this.publish();
    }
    this.loading.add(m.mediaKey);
    try {
      const url = await this.deps.preview(m.thumbUrl, PREVIEW_PX);
      this.previews.set(m.mediaKey, url);
      while (this.previews.size > PREVIEW_CACHE) this.previews.delete(this.previews.keys().next().value!);
    } catch (e) {
      this.previewErrors.set(m.mediaKey, previewProblem('Duplicates', e));
    } finally {
      this.loading.delete(m.mediaKey);
      this.publish();
    }
  }

  // --- focus and selection ---

  private resetFocus(): void {
    this.focusedIndex = 0;
    this.allFocused = false;
  }

  /** The grid reports its width so up and down can move by a whole row. */
  gridWidthMeasured(widthPx: number): void {
    this.columns = Math.max(1, Math.floor((widthPx + TILE_GAP_PX) / (TILE_PX + TILE_GAP_PX)));
  }

  /** The group on screen; when there is none, says why, so a key press is not met with silence. */
  private currentOrSay(): DuplicateGroup | null {
    const group = this.pending[0] ?? null;
    if (group === null) {
      this.say(!this.loaded ? 'The duplicate groups are still loading.' : this.blocked ? BLOCKED_TEXT[this.blocked] : 'No groups left to review.', 'caution');
      this.publish();
    }
    return group;
  }

  /** Starts with the proposals, except photos decided on in an earlier version of this moment. */
  private selectionOf(group: DuplicateGroup): Set<string> {
    let selected = this.selections.get(group.id);
    if (!selected) {
      selected = new Set(group.defaultSelection);
      this.selections.set(group.id, selected);
    }
    return selected;
  }

  /**
   * Arrows: left and right within the row, up and down within the column; at an edge (or with no
   * photo directly below on a short last row) the outline stays put. A fresh tap there bounces it,
   * so the eye finds it; a slide that runs into the edge ([held]: the repeats of a held arrow) just
   * stops. The first press after A returns to the single outline where the user was.
   */
  focusMove(dx: number, dy: number, held = false): void {
    const group = this.currentOrSay();
    if (!group) return;
    if (this.allFocused) {
      this.allFocused = false;
    } else {
      const last = group.members.length - 1;
      const column = this.focusedIndex % this.columns;
      const target = this.focusedIndex + dx + dy * this.columns;
      const inRow = column + dx >= 0 && column + dx < this.columns;
      if (!inRow || target < 0 || target > last) {
        if (held) return;
        this.focusPulse++;
        return this.publish();
      }
      this.focusedIndex = target;
    }
    this.focusPulse++;
    this.publish();
  }

  /** A click focuses the photo and, when it can go, switches it between keep and trash. */
  tileClicked(mediaKey: string): void {
    const group = this.pending[0];
    if (!group) return;
    const index = group.members.findIndex((m) => m.mediaKey === mediaKey);
    if (index < 0) return;
    // Only a click that moves the outline bounces; clicking the outlined photo just toggles it.
    if (index !== this.focusedIndex || this.allFocused) this.focusPulse++;
    this.focusedIndex = index;
    this.allFocused = false;
    if (group.members[index]!.selectable) this.toggle(group, mediaKey);
    this.publish();
  }

  private toggle(group: DuplicateGroup, mediaKey: string): void {
    const selected = this.selectionOf(group);
    if (selected.has(mediaKey)) selected.delete(mediaKey);
    else selected.add(mediaKey);
  }

  private toggleOrExplain(mediaKey: string): void {
    const group = this.pending[0];
    if (!group) return;
    const member = group.members.find((m) => m.mediaKey === mediaKey)!;
    if (member.selectable) this.toggle(group, mediaKey);
    else this.say(`This photo ${whyKept(member)}, so it is always kept.`, 'caution');
    this.publish();
  }

  /**
   * Space: switch the focused photo between keep and trash. With the whole group focused (A),
   * mark every photo that can go, or, when they all are already, keep them all.
   */
  toggleFocused(): void {
    const group = this.currentOrSay();
    if (!group) return;
    if (this.allFocused) {
      const selectable = group.members.filter((m) => m.selectable).map((m) => m.mediaKey);
      const selected = this.selectionOf(group);
      const all = selectable.every((k) => selected.has(k));
      for (const k of selectable) {
        if (all) selected.delete(k);
        else selected.add(k);
      }
      return this.publish();
    }
    const member = group.members[this.focusedIndex];
    if (member) this.toggleOrExplain(member.mediaKey);
  }

  /**
   * A: outline the whole group without marking anything; Space then marks or unmarks them all.
   * A again goes back to the single outline; what is marked for the trash stays as it is.
   */
  focusAll(): void {
    if (!this.currentOrSay()) return;
    this.allFocused = !this.allFocused;
    this.focusPulse++;
    this.publish();
  }

  /** "Search more like these": every photo of the group on screen (or why there is none). */
  groupKeysOrSay(): string[] | null {
    return this.currentOrSay()?.members.map((m) => m.mediaKey) ?? null;
  }

  // --- decisions ---

  approve(): void {
    const group = this.currentOrSay();
    if (!group) return;
    const selected = this.selectionOf(group);
    if (selected.size === 0) {
      this.say('Nothing is selected for the trash. Press F to keep the whole group.', 'caution');
      return this.publish();
    }
    this.decide(group, 'APPROVED', selected);
  }

  keep(): void {
    const group = this.currentOrSay();
    if (group) this.decide(group, 'KEPT', new Set());
  }

  defer(): void {
    const group = this.currentOrSay();
    if (group) this.decide(group, 'DEFERRED', new Set());
  }

  private decide(group: DuplicateGroup, kind: DecisionKind, selected: Set<string>): void {
    if (this.busy) return;
    this.busy = true;
    void this.run(async () => {
      try {
        await this.deps.record(group, kind, decisionItems(group, kind, selected));
      } catch (error) {
        this.say(error instanceof Error ? error.message : 'The decision was refused.', 'negative');
        return;
      }
      this.decisionsChanged();
      this.pending.shift();
      this.resetFocus();
      this.decided.push({ group, kind, wasDeferred: this.deferredIds.has(group.id) });
      if (kind === 'DEFERRED') {
        this.pending.push(group);
        this.deferredIds.add(group.id);
      } else {
        this.decidedGroups++;
      }
      // The next group appearing is the feedback; a message about the old one would mislead.
      this.notice = null;
      this.reportGroupsLeft();
      this.preload();
    });
  }

  /**
   * Z: undoes the newest decision; its group comes first again with its previous selection. A
   * decision made since the groups were built is put back from memory, at once; an older one
   * means building the groups again.
   */
  undo(): void {
    if (this.busy) return;
    this.busy = true;
    this.working = 'Undoing…';
    this.publish();
    void this.run(async () => {
      const undone = await this.deps.undo();
      if (undone === null) {
        this.say('Nothing to undo.', 'caution');
        return;
      }
      this.decisionsChanged();
      const local = this.decided.at(-1);
      if (local && local.group.id === undone.groupId && local.kind === undone.kind) {
        this.decided.pop();
        if (undone.kind === 'DEFERRED') {
          const at = this.pending.lastIndexOf(local.group);
          if (at >= 0) this.pending.splice(at, 1);
          if (!local.wasDeferred) this.deferredIds.delete(local.group.id);
        } else {
          this.decidedGroups--;
        }
        this.pending.unshift(local.group);
        this.reportGroupsLeft();
      } else {
        await this.reload();
        const index = this.pending.findIndex((g) => g.id === undone.groupId);
        if (index > 0) this.pending.unshift(...this.pending.splice(index, 1));
      }
      if (undone.kind === 'APPROVED') this.selections.set(undone.groupId, new Set(undone.items.map((i) => i.mediaKey)));
      this.resetFocus();
      const texts: Record<DecisionKind, string> = {
        APPROVED: 'Undid the trashing: photos not yet sent are cancelled and any already trashed are restored',
        KEPT: 'Undid “keep”',
        DEFERRED: 'Undid “skip”',
      };
      this.say(texts[undone.kind], 'positive');
      this.preload();
    });
  }

  // --- the viewer ---

  /** Enter: view the focused photo large. */
  openFocused(): void {
    const group = this.currentOrSay();
    const member = group?.members[this.focusedIndex];
    if (member) this.openViewer(member.mediaKey);
  }

  openViewer(mediaKey: string): void {
    const group = this.pending[0];
    const index = group?.members.findIndex((m) => m.mediaKey === mediaKey) ?? -1;
    if (!group || index < 0) return;
    this.viewerIndex = index;
    this.loadLarge(group);
    this.publish();
  }

  viewerStep(delta: number): void {
    const group = this.pending[0];
    if (!group || this.viewerIndex === null) return;
    this.viewerIndex = Math.min(Math.max(this.viewerIndex + delta, 0), group.members.length - 1);
    this.loadLarge(group);
    this.publish();
  }

  /** Closing leaves the grid focus on the photo last shown. */
  viewerClose(): void {
    if (this.viewerIndex === null) return;
    this.focusedIndex = this.viewerIndex;
    this.allFocused = false;
    this.viewerIndex = null;
    this.publish();
  }

  viewerToggle(): void {
    const member = this.viewerIndex === null ? undefined : this.pending[0]?.members[this.viewerIndex];
    if (member) this.toggleOrExplain(member.mediaKey);
  }

  /** The photo shown and its neighbours, large; kept for the last few. */
  private loadLarge(group: DuplicateGroup): void {
    for (const offset of [0, 1, -1, 2]) {
      const m = group.members[this.viewerIndex! + offset];
      if (!m || m.thumbUrl === null || this.large.has(m.mediaKey)) continue;
      this.large.set(m.mediaKey, null);
      void this.deps.preview(m.thumbUrl, VIEWER_PX).then(
        (url) => {
          this.large.set(m.mediaKey, url);
          while (this.large.size > VIEWER_CACHE) this.large.delete(this.large.keys().next().value!);
          this.publish();
        },
        (e: unknown) => {
          previewProblem('Duplicates viewer', e);
          this.large.set(m.mediaKey, 'failed');
          this.publish();
        },
      );
    }
  }

  // --- what the screen shows ---

  view(): DuplicatesView {
    const group = this.pending[0] ?? null;
    const loaded = this.loaded;
    return {
      // From the moment the tab opens (also while the saved jobs are still being read) until the first groups are ready.
      loadingText: !loaded && this.problem === null ? 'Finding duplicate groups…' : null,
      workingText: this.working,
      // Only once there are groups to count: while blocked (no scan yet, an old one) the reason takes their place.
      groupsText: loaded && this.blocked === null ? count(this.totalGroups, 'group', 'groups') : null,
      progressText: loaded && this.blocked === null
        ? `${n(this.decidedGroups)} decided · ${n(this.pending.length)} to go` + (this.deferredIds.size > 0 ? ` (${n(this.deferredIds.size)} skipped)` : '')
        : null,
      // What counts as a duplicate, in the same terms as each photo's "% similar".
      ruleText: this.settings
        ? `Photos count as duplicates when they are at least ${percent(this.settings.threshold)} similar and taken within ${this.settings.windowMs / 60_000} minutes of each other. ` +
          'Nothing is trashed without your approval.'
        : null,
      blockedText: this.blocked ? BLOCKED_TEXT[this.blocked] : null,
      emptyText: loaded && this.blocked === null && group === null ? 'No groups left to review.' : null,
      problemText: this.problem,
      queueText: this.queueText(),
      queueWaitingText: this.queue?.waitingReason ?? null,
      group: group ? this.groupView(group) : null,
      notice: this.notice,
      viewer: group && this.viewerIndex !== null ? this.viewerView(group, this.viewerIndex) : null,
    };
  }

  private groupView(group: DuplicateGroup): GroupView {
    const selected = this.selectionOf(group);
    // A group decided before that gained photos: the new ones carry a badge.
    const returning = group.members.some((m) => m.previouslyReviewed);
    const newCount = group.members.filter((m) => !m.previouslyReviewed).length;
    return {
      id: group.id,
      focusPulse: this.focusPulse,
      selectionText: `${n(selected.size)} of ${count(group.members.length, 'photo', 'photos')} selected for the trash` +
        (returning ? ` · ${n(newCount)} new since your last decision` : '') +
        (this.deferredIds.has(group.id) ? ' · skipped earlier' : ''),
      warningText: selected.size === group.members.length ? 'No photo of this moment will be kept.' : null,
      tiles: group.members.map((m, index) => this.tileView(m, selected.has(m.mediaKey), this.allFocused || index === this.focusedIndex, !this.allFocused && index === this.focusedIndex, returning && !m.previouslyReviewed)),
    };
  }

  private tileView(m: GroupMember, selected: boolean, focused: boolean, current: boolean, newBadge: boolean): TileView {
    const [label, tone]: [string, Tone] =
      !m.selectable ? [`KEEP · ${keepReasonLabel(m)}`, 'neutral']
        : m.role === 'KEEPER' && selected ? ['TRASH (was the recommended keeper)', 'negative']
          : m.role === 'KEEPER' ? ['KEEP (recommended)', 'positive']
            : selected ? ['TRASH', 'negative']
              : m.previouslyReviewed ? ['KEEP (you kept it before)', 'positive']
                // Colour says what will happen: green is kept, whoever decided it.
                : ['KEEP (your choice)', 'positive'];
    return {
      mediaKey: m.mediaKey,
      imageUrl: this.previews.get(m.mediaKey) ?? null,
      error: this.previewErrors.get(m.mediaKey) ?? null,
      label,
      tone,
      selectable: m.selectable,
      focused,
      current,
      newBadge,
      similarityText: m.role === 'KEEPER' ? null : `${percent(m.similarity)} similar`,
      reasons: m.reasons,
      caption: photoTime(m.takenAtMs) + (m.pixels !== null ? ` · ${(m.pixels / 1e6).toFixed(1)} MP` : ''),
      link: `https://photos.google.com/photo/${m.mediaKey}`,
    };
  }

  private viewerView(group: DuplicateGroup, index: number): ViewerView {
    const m = group.members[index]!;
    const large = this.large.get(m.mediaKey);
    const failed = large === 'failed';
    const role = m.role === 'KEEPER' ? 'Recommended keeper' : m.role === 'PROPOSED' ? 'Proposed for the trash' : `Always kept: ${keepReasonLabel(m)}`;
    const [selectionText, tone]: [string, Tone] = this.selectionOf(group).has(m.mediaKey)
      ? ['Selected for the trash', 'negative']
      : m.selectable ? ['Kept (not selected)', 'positive'] : ['Always kept', 'neutral'];
    return {
      imageUrl: (large && !failed ? large : null) ?? this.previews.get(m.mediaKey) ?? null,
      loading: large === null || large === undefined,
      statusText: failed ? 'The large preview could not be loaded; showing the thumbnail.' : large ? null : 'Loading the large preview…',
      infoText: `${index + 1} of ${group.members.length} · ${role} · ${photoTime(m.takenAtMs)}`,
      selectionText,
      tone,
      link: `https://photos.google.com/photo/${m.mediaKey}`,
    };
  }

  private queueText(): string | null {
    const status = this.queue;
    if (!status) return null;
    const c = (s: keyof TrashQueueStatus['counts']) => status.counts[s] ?? 0;
    const prefix = status.simulated ? 'Trash queue (SIMULATED, nothing is sent to Google)' : 'Trash queue';
    return `${prefix}: ${n(c('QUEUED') + c('SENDING') + c('UNCERTAIN'))} queued · ${n(c('COMPLETED'))} in trash · ${n(c('BLOCKED'))} blocked · ` +
      `${n(c('FAILED'))} failed · ${n(c('CANCELLED'))} cancelled · ${n(c('RESTORED') + c('RESTORE_REQUESTED'))} restored`;
  }
}
