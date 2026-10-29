// The Duplicates review's state machine and texts, with fake decisions and previews: the twin of
// the desktop's ReviewViewModel behaviour.

import { describe, expect, it, vi } from 'vitest';
import { ACTION_FAILED, DuplicatesReview, type LoadedQueue, type ReviewDeps } from '../../src/app/duplicates/reviewModel';
import type { StoredDecision } from '../../src/app/duplicates/reviewStore';
import type { DecisionKind, DuplicateGroup, GroupMember } from '../../src/app/duplicates/rules';
import { memorySizeMemory } from '../../src/app/shared/photoSize';
import { ROTATED_TEXT } from '../../src/app/shared/viewRotation';
import { SourceError } from '../../src/app/scan/source';

function member(key: string, role: GroupMember['role'], opts: Partial<GroupMember> = {}): GroupMember {
  return {
    mediaKey: key, dedupKey: `d-${key}`, takenAtMs: new Date(2026, 9, 14, 13, 0, 0).getTime(), thumbUrl: `thumb-${key}`, role,
    similarity: role === 'KEEPER' ? 1 : 0.951, reasons: role === 'KEEPER' ? ['Sharpest'] : ['95.1% similar to the keeper'],
    previouslyReviewed: false, selectable: role !== 'REFERENCE', eligibility: role === 'REFERENCE' ? 'PROTECTED' : 'ELIGIBLE',
    protectionReasons: role === 'REFERENCE' ? ['FAVOURITE'] : [], pixels: 12_000_000, ...opts,
  };
}

function group(id: string, ...members: GroupMember[]): DuplicateGroup {
  return { id, takenAtMs: 0, members, defaultSelection: members.filter((m) => m.role === 'PROPOSED' && !m.previouslyReviewed).map((m) => m.mediaKey) };
}

const g1 = () => group('g1', member('a', 'KEEPER'), member('b', 'PROPOSED'), member('c', 'REFERENCE'));
const g2 = () => group('g2', member('d', 'KEEPER'), member('e', 'PROPOSED'));

class Fakes implements ReviewDeps {
  pending: DuplicateGroup[] = [g1(), g2()];
  blocked: LoadedQueue['blocked'] = null;
  scanOutOfDate = false;
  notAnalysed = 0;
  decisions: StoredDecision[] = [];
  loads = 0;
  /** When set, undo waits for it, so the screen can be checked meanwhile. */
  undoGate: Promise<void> | null = null;
  /** Every "groups left" the review reported, oldest first. */
  groupsLeftReported: number[] = [];
  sizeMemory = memorySizeMemory();
  /** The size of every preview asked for, in order. */
  previewSizes: number[] = [];

  async groupsLeft(count: number) {
    this.groupsLeftReported.push(count);
  }

  async loadQueue(): Promise<LoadedQueue> {
    this.loads++;
    const decided = new Set(this.decisions.filter((d) => d.kind !== 'DEFERRED').map((d) => d.groupId));
    const pending = this.blocked ? [] : this.pending.filter((g) => !decided.has(g.id));
    return {
      blocked: this.blocked, scanOutOfDate: this.scanOutOfDate, pending, deferredIds: [], totalGroups: this.pending.length, decidedGroups: decided.size,
      analysedAtMs: null, photosAnalysed: 100, photosNotAnalysed: this.notAnalysed, settings: { threshold: 0.915, windowMs: 120_000 },
    };
  }

  async record(g: DuplicateGroup, kind: DecisionKind, items: { mediaKey: string; dedupKey: string }[]) {
    this.decisions.unshift({ id: this.decisions.length + 1, account: 'acc', groupId: g.id, kind, items, members: g.members.map((m) => m.mediaKey), createdAtMs: 0, undoneAtMs: null });
  }

  undoError: Error | null = null;
  async undo() {
    await this.undoGate;
    if (this.undoError) throw this.undoError;
    return this.decisions.shift() ?? null;
  }

  async preview(thumbUrl: string, sizePx: number) {
    this.previewSizes.push(sizePx);
    if (thumbUrl === 'thumb-no-tab') throw new SourceError('NO_PHOTOS_TAB', 'no Photos tab');
    if (thumbUrl === 'thumb-changed') throw new SourceError('BAD_REQUEST', 'Preview host not allowed');
    return `data:${thumbUrl}@${sizePx}`;
  }
}

/** Lets pending promises (loading, saving) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function opened(fakes = new Fakes()) {
  const review = new DuplicatesReview(fakes);
  review.gridWidthMeasured(3 * 300 + 2 * 24); // as the screen reports it: three photos a row
  review.show();
  await settle();
  return { review, fakes, view: () => review.getView() };
}

describe('the Duplicates review', () => {
  it('shows the first group with the proposals selected for the trash', async () => {
    const { view } = await opened();
    expect(view()).toMatchObject({
      groupsText: '2 groups (0 decided · 2 to go)', emptyText: null, blockedText: null, notAnalysedText: null,
      ruleText: 'Photos count as duplicates when they are at least 91.5% similar and taken within 2 minutes of each other. Nothing is trashed without your approval.',
    });
    const g = view().group!;
    expect(g.selectionText).toBe('1 of 3 photos selected for the trash');
    expect(g.warningText).toBeNull();
    expect(g.tiles.map((t) => [t.label, t.tone, t.similarityText])).toEqual([
      ['KEEP (recommended)', 'positive', null],
      ['TRASH', 'negative', '95.1% similar'],
      ['KEEP · protected (favourite)', 'neutral', '95.1% similar'],
    ]);
    expect(g.tiles[0]).toMatchObject({ imageUrl: 'data:thumb-a@400', caption: '14 Oct 2026, 13:00:00 · 12.0 MP', link: 'https://photos.google.com/photo/a', focused: true });
    // The first photo is outlined from the start; only it.
    expect(g.tiles.map((t) => t.focused)).toEqual([true, false, false]);
  });

  it('says it is finding the groups from the start until they are ready', async () => {
    const review = new DuplicatesReview(new Fakes());
    expect(review.getView().loadingText).toBe('Finding duplicate groups…');
    review.show();
    expect(review.getView().loadingText).toBe('Finding duplicate groups…');
    await settle();
    expect(review.getView().loadingText).toBeNull();
  });

  it('D with nothing selected says what to do; F keeps the group and the next one appears without a message', async () => {
    const { review, fakes, view } = await opened();
    review.focusMove(1, 0);
    review.toggleFocused(); // unselect the only proposal
    review.approve();
    expect(view().notice).toMatchObject({ text: 'Nothing is selected for the trash. Press F to keep the whole group.', tone: 'caution', visibleMs: 4_000 + 70 * 67 });
    review.keep();
    await settle();
    expect(fakes.decisions[0]).toMatchObject({ groupId: 'g1', kind: 'KEPT', items: [] });
    expect(view()).toMatchObject({ notice: null, groupsText: '2 groups (1 decided · 1 to go)' });
    expect(view().group!.tiles[0]!.mediaKey).toBe('d');
  });

  it('decisions made in Search rebuild the groups, once the tab has opened', async () => {
    const fakes = new Fakes();
    const review = new DuplicatesReview(fakes);
    review.decisionsChangedElsewhere(); // never opened: nothing to rebuild
    await settle();
    expect(fakes.loads).toBe(0);
    review.show();
    await settle();
    expect(review.getView().group!.tiles[0]!.mediaKey).toBe('a');
    fakes.pending = [g2()]; // a sweep took g1's photos
    review.decisionsChangedElsewhere();
    await settle();
    expect(fakes.loads).toBe(2);
    expect(review.getView().group!.tiles[0]!.mediaKey).toBe('d');
  });

  it('tells Search when it decides or undoes, not when there was nothing to undo', async () => {
    const { review, fakes } = await opened();
    const heard = vi.fn();
    review.onDecisionsChanged(heard);
    review.keep();
    await settle();
    expect(heard).toHaveBeenCalledTimes(1);
    review.undo();
    await settle();
    expect(heard).toHaveBeenCalledTimes(2);
    fakes.decisions = [];
    review.undo();
    await settle();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('D trashes exactly the selection', async () => {
    const { review, fakes } = await opened();
    review.approve();
    await settle();
    expect(fakes.decisions[0]).toMatchObject({ groupId: 'g1', kind: 'APPROVED', items: [{ mediaKey: 'b', dedupKey: 'd-b' }] });
  });

  it('Space acts on the outlined photo straight away; arrows move the outline', async () => {
    const { review, view } = await opened();
    review.toggleFocused(); // the first photo, outlined from the start
    expect(view().group!.tiles[0]).toMatchObject({ focused: true, label: 'TRASH (was the recommended keeper)' });
    expect(view().group!.selectionText).toBe('2 of 3 photos selected for the trash');
    review.focusMove(1, 0);
    review.toggleFocused();
    expect(view().group!.tiles[1]).toMatchObject({ focused: true, label: 'KEEP (your choice)' });
    review.focusMove(1, 0);
    review.focusMove(1, 0); // the end of the row: stays
    expect(view().group!.tiles[2]!.focused).toBe(true);
    review.toggleFocused();
    expect(view().notice!.text).toBe('This photo is a favourite, so it is always kept.');
  });

  it('A again goes back to the single outline and leaves the marks as they are', async () => {
    const { review, view } = await opened();
    review.focusMove(1, 0);
    review.focusAll();
    review.toggleFocused(); // marks a and b
    review.focusAll();
    expect(view().group!.tiles.map((t) => t.focused)).toEqual([false, true, false]);
    expect(view().group!.selectionText).toBe('2 of 3 photos selected for the trash');
    review.toggleFocused(); // the single outlined photo again, not the whole group
    expect(view().group!.selectionText).toBe('1 of 3 photos selected for the trash');
  });

  it('the next group starts with its first photo outlined', async () => {
    const { review, view } = await opened();
    review.focusMove(1, 0);
    review.keep();
    await settle();
    expect(view().group!.tiles.map((t) => t.focused)).toEqual([true, false]);
  });

  it('A then Space marks every photo that can go, and again keeps them all', async () => {
    const { review, view } = await opened();
    review.focusAll();
    expect(view().group!.tiles.every((t) => t.focused)).toBe(true);
    review.toggleFocused();
    expect(view().group!.tiles.map((t) => t.label)).toEqual(['TRASH (was the recommended keeper)', 'TRASH', 'KEEP · protected (favourite)']);
    review.toggleFocused();
    expect(view().group!.selectionText).toBe('0 of 3 photos selected for the trash');
  });

  it('warns when no photo of the moment would be kept', async () => {
    const fakes = new Fakes();
    fakes.pending = [g2()];
    const { review, view } = await opened(fakes);
    review.focusAll();
    review.toggleFocused();
    expect(view().group!.warningText).toBe('No photo of this moment will be kept.');
  });

  it('left and right stop at the ends of a row instead of wrapping into the next', async () => {
    const fakes = new Fakes();
    fakes.pending = [group('big', member('k', 'KEEPER'), ...['p1', 'p2', 'p3', 'p4'].map((k) => member(k, 'PROPOSED')))];
    const { review, view } = await opened(fakes);
    review.gridWidthMeasured(2 * 300 + 24); // two columns: [k p1] [p2 p3] [p4]
    const at = () => view().group!.tiles.findIndex((t) => t.current);
    review.focusMove(-1, 0); // start of the first row
    expect(at()).toBe(0);
    review.focusMove(1, 0);
    review.focusMove(1, 0); // end of the row: stays, no wrap to p2
    expect(at()).toBe(1);
    review.focusMove(0, 1);
    review.focusMove(-1, 0);
    review.focusMove(-1, 0); // start of the second row: stays, no wrap to p1
    expect(at()).toBe(2);
    review.focusMove(0, 1);
    review.focusMove(1, 0); // the last photo, alone on its row
    expect(at()).toBe(4);
  });

  it('A outlines every photo without moving the photo the keys act on; each focus action pulses', async () => {
    const { review, view } = await opened();
    const pulse = view().group!.focusPulse;
    review.focusMove(1, 0);
    expect(view().group!.focusPulse).toBe(pulse + 1);
    review.focusAll();
    expect(view().group!.tiles.map((t) => [t.focused, t.current])).toEqual([[true, false], [true, false], [true, false]]);
    expect(view().group!.focusPulse).toBe(pulse + 2);
    review.focusAll();
    expect(view().group!.tiles.map((t) => t.current)).toEqual([false, true, false]);
    expect(view().group!.focusPulse).toBe(pulse + 3);
  });

  it('a click only outlines, as in Search: it never switches keep and trash, and bounces only when the outline changes', async () => {
    const { review, view } = await opened();
    const pulse = view().group!.focusPulse;
    review.tileClicked('a'); // already the one outlined: nothing changes
    expect(view().group!.focusPulse).toBe(pulse);
    review.tileClicked('b'); // moves the outline
    expect(view().group!.focusPulse).toBe(pulse + 1);
    expect(view().group!.tiles.map((t) => [t.focused, t.current])).toEqual([[false, false], [true, true], [false, false]]);
    review.focusAll();
    review.tileClicked('b'); // from the whole group back to one photo
    expect(view().group!.focusPulse).toBe(pulse + 3);
    expect(view().group!.selectionText).toBe('1 of 3 photos selected for the trash');
    expect(view().group!.tiles.map((t) => t.label)).toEqual(['KEEP (recommended)', 'TRASH', 'KEEP · protected (favourite)']);
  });

  it('Ctrl/Cmd-click adds or removes a photo from the outline, never the last one; Space then marks them all', async () => {
    const { review, view } = await opened();
    const outlined = () => view().group!.tiles.map((t) => t.focused);
    review.tileClicked('b', false, true);
    expect(outlined()).toEqual([true, true, false]);
    expect(view().group!.tiles.map((t) => t.current)).toEqual([false, false, false]); // several: nothing is scrolled to
    review.tileClicked('a', false, true);
    expect(outlined()).toEqual([false, true, false]);
    review.tileClicked('b', false, true); // the last outlined photo stays
    expect(outlined()).toEqual([false, true, false]);
    review.tileClicked('a', false, true);
    review.toggleFocused(); // a and b: not all marked yet, so both are
    expect(view().group!.tiles.map((t) => t.label)).toEqual(['TRASH (was the recommended keeper)', 'TRASH', 'KEEP · protected (favourite)']);
    review.toggleFocused(); // all marked: both kept
    expect(view().group!.selectionText).toBe('0 of 3 photos selected for the trash');
  });

  it('Shift-click outlines the range from the photo last clicked; Ctrl/Cmd-Shift adds it; the next arrow goes back to one photo', async () => {
    const fakes = new Fakes();
    fakes.pending = [group('big', member('k', 'KEEPER'), ...['p1', 'p2', 'p3', 'p4'].map((k) => member(k, 'PROPOSED')))];
    const { review, view } = await opened(fakes);
    const outlined = () => view().group!.tiles.map((t) => t.focused);
    review.tileClicked('p1');
    review.tileClicked('p3', true);
    expect(outlined()).toEqual([false, true, true, true, false]);
    review.tileClicked('k', true); // the range keeps its start
    expect(outlined()).toEqual([true, true, false, false, false]);
    review.tileClicked('p4', false, true);
    review.tileClicked('p2', true, true); // added to what is outlined
    expect(outlined()).toEqual([true, true, true, true, true]);
    expect(view().group!.selectionText).toBe('4 of 5 photos selected for the trash'); // outlining marks nothing
    review.focusMove(1, 0); // back to the single outline on the photo last clicked, without moving
    expect(view().group!.tiles.map((t) => [t.focused, t.current])).toEqual([[false, false], [false, false], [true, true], [false, false], [false, false]]);
  });

  it('Space on several photos that are all always kept says so', async () => {
    const fakes = new Fakes();
    fakes.pending = [group('g', member('a', 'KEEPER'), member('r1', 'REFERENCE'), member('r2', 'REFERENCE'))];
    const { review, view } = await opened(fakes);
    review.tileClicked('r1');
    review.tileClicked('r2', true);
    review.toggleFocused();
    expect(view().notice!.text).toBe('These photos are always kept: each is protected or has an unknown status.');
    expect(view().group!.selectionText).toBe('0 of 3 photos selected for the trash');
  });

  it('a slide that runs into the edge just stops; a fresh tap at the edge bounces, so the eye finds the outline', async () => {
    const { review, view } = await opened();
    review.focusMove(1, 0);
    review.focusMove(1, 0, true); // held, reaching the end of the row
    const pulse = view().group!.focusPulse;
    for (let i = 0; i < 5; i++) review.focusMove(1, 0, true); // still held against the edge: no bounce
    expect(view().group!.focusPulse).toBe(pulse);
    review.focusMove(1, 0); // a fresh tap at the edge: one bounce
    expect(view().group!.focusPulse).toBe(pulse + 1);
    review.focusMove(1, 0); // and another tap, another bounce
    expect(view().group!.focusPulse).toBe(pulse + 2);
    expect(view().group!.tiles.findIndex((t) => t.current)).toBe(2);
  });

  it('up and down move within the column and stay put at the top and bottom', async () => {
    const fakes = new Fakes();
    fakes.pending = [group('big', member('k', 'KEEPER'), ...['p1', 'p2', 'p3', 'p4'].map((k) => member(k, 'PROPOSED')))];
    const { review, view } = await opened(fakes);
    review.gridWidthMeasured(2 * 300 + 24); // two columns: [k p1] [p2 p3] [p4]
    const at = () => view().group!.tiles.findIndex((t) => t.current);
    review.focusMove(0, -1); // top row: stays
    expect(at()).toBe(0);
    review.focusMove(0, 1);
    expect(at()).toBe(2);
    review.focusMove(0, 1);
    expect(at()).toBe(4);
    review.focusMove(0, 1); // bottom row: stays
    expect(at()).toBe(4);
    review.focusMove(0, -1);
    review.focusMove(1, 0);
    review.focusMove(0, 1); // nothing directly below p3 on the short last row: stays in its column
    expect(at()).toBe(3);
  });

  it('- and + make the photos smaller and larger, step by step: the rows follow, sharper previews come, the size is remembered', async () => {
    const fakes = new Fakes();
    fakes.pending = [group('big', member('k', 'KEEPER'), ...['p1', 'p2', 'p3', 'p4'].map((k) => member(k, 'PROPOSED')))];
    const { review, view } = await opened(fakes);
    expect(view()).toMatchObject({ tilePx: 300, canShrink: true, canGrow: true });
    expect(view().group!.tiles[0]!.imageUrl).toBe('data:thumb-k@400');
    // The grid fits three photos a row of this size, two of the next: [k p1 p2] [p3 p4].
    review.focusMove(0, 1);
    expect(view().group!.tiles.findIndex((t) => t.current)).toBe(3);
    review.focusMove(0, -1);

    const pulse = view().group!.focusPulse;
    review.resize(1);
    expect(view()).toMatchObject({ tilePx: 400, canShrink: true, canGrow: true });
    expect(view().group!.focusPulse).toBe(pulse + 1); // the outlined photo is brought into view
    review.focusMove(0, 1);
    expect(view().group!.tiles.findIndex((t) => t.current)).toBe(2); // two a row now
    // Until the sharper preview comes, the one there is stays.
    expect(view().group!.tiles[0]!.imageUrl).toBe('data:thumb-k@400');
    await settle();
    expect(view().group!.tiles[0]!.imageUrl).toBe('data:thumb-k@600');
    expect(fakes.sizeMemory.load()).toBe(2);

    // Smaller again: what is fetched already is sharp enough.
    const asked = fakes.previewSizes.length;
    review.resize(-1);
    review.resize(-1);
    await settle();
    expect(view()).toMatchObject({ tilePx: 200, canShrink: false, canGrow: true });
    expect(fakes.previewSizes.length).toBe(asked);
    review.resize(-1);
    expect(view()).toMatchObject({ tilePx: 200, notice: { text: 'The photos are at their smallest.', tone: 'caution' } });

    // A new review tab starts at the size chosen last.
    const again = new DuplicatesReview(fakes);
    expect(again.getView().tilePx).toBe(200);
    for (let i = 0; i < 5; i++) again.resize(1);
    expect(again.getView()).toMatchObject({ tilePx: 880, canGrow: false });
    again.resize(1);
    expect(again.getView().notice).toMatchObject({ text: 'The photos are at their largest.' });
  });

  it('S skips: the group goes to the end and says so when it comes round', async () => {
    const { review, view } = await opened();
    review.defer();
    await settle();
    expect(view().groupsText).toBe('2 groups (0 decided · 2 to go · 1 skipped)');
    expect(view().group!.tiles[0]!.mediaKey).toBe('d');
    review.keep();
    await settle();
    expect(view().group!.selectionText).toContain(' · skipped earlier');
  });

  it('Z brings the group back first with its previous selection', async () => {
    const { review, view } = await opened();
    review.focusAll();
    review.toggleFocused(); // a and b selected
    review.approve();
    await settle();
    expect(view().group!.tiles[0]!.mediaKey).toBe('d');
    review.undo();
    await settle();
    expect(view().notice).toMatchObject({ text: 'Undid the trashing: photos not yet sent are cancelled and any already trashed are restored', tone: 'positive' });
    expect(view().group!.selectionText).toBe('2 of 3 photos selected for the trash');
    review.undo();
    await settle();
    expect(view().notice!.text).toBe('Nothing to undo.');
  });

  it('undoing a decision made since the groups were built is instant: nothing is built again', async () => {
    const { review, fakes, view } = await opened();
    const loads = fakes.loads;
    review.keep();
    await settle();
    review.defer(); // g2 goes to the end
    await settle();
    expect(view().groupsText).toBe('2 groups (1 decided · 1 to go · 1 skipped)');
    review.undo(); // the skip
    await settle();
    expect(view().groupsText).toBe('2 groups (1 decided · 1 to go)');
    expect(view().group!.tiles[0]!.mediaKey).toBe('d');
    review.undo(); // the keep
    await settle();
    expect(view().groupsText).toBe('2 groups (0 decided · 2 to go)');
    expect(view().group!.tiles[0]!.mediaKey).toBe('a');
    expect(fakes.loads).toBe(loads);
  });

  it('an older decision is undone through the saved data, with a spinner meanwhile', async () => {
    const fakes = new Fakes();
    fakes.decisions = [{ id: 1, account: 'acc', groupId: 'g1', kind: 'KEPT', items: [], members: ['a', 'b', 'c'], createdAtMs: 0, undoneAtMs: null }];
    const { review, view } = await opened(fakes);
    expect(view().group!.tiles[0]!.mediaKey).toBe('d');
    let open!: () => void;
    fakes.undoGate = new Promise((resolve) => (open = resolve));
    const loads = fakes.loads;
    review.undo();
    expect(view().workingText).toBe('Undoing…');
    open();
    await settle();
    expect(view().workingText).toBeNull();
    expect(fakes.loads).toBe(loads + 1);
    expect(view().group!.tiles[0]!.mediaKey).toBe('a');
    expect(view().groupsText).toBe('2 groups (0 decided · 2 to go)');
  });

  it('the viewer steps through the group, toggles, and leaves the focus on the last photo shown', async () => {
    const { review, view } = await opened();
    review.openViewer('a');
    await settle();
    expect(view().viewer).toMatchObject({ imageUrl: 'data:thumb-a@1024', infoText: '1 of 3 · Recommended keeper · 14 Oct 2026, 13:00:00', selectionText: 'Kept (not selected)', tone: 'positive' });
    review.viewerStep(1);
    expect(view().viewer).toMatchObject({ selectionText: 'Selected for the trash', tone: 'negative' });
    review.viewerToggle();
    expect(view().viewer!.selectionText).toBe('Kept (not selected)');
    review.viewerStep(5);
    expect(view().viewer).toMatchObject({ infoText: expect.stringContaining('3 of 3 · Always kept: protected (favourite)'), tone: 'neutral' });
    review.viewerClose();
    expect(view().viewer).toBeNull();
    expect(view().group!.tiles[2]!.focused).toBe(true);
  });

  it('the viewer turns a photo for viewing only: each photo keeps its turn, nothing is saved or decided', async () => {
    const { review, view, fakes } = await opened();
    review.openViewer('a');
    expect(view().viewer).toMatchObject({ rotationDeg: 0, sideways: false, rotationText: null });
    review.viewerRotate(1);
    expect(view().viewer).toMatchObject({ rotationDeg: 90, sideways: true, rotationText: ROTATED_TEXT });
    review.viewerStep(1);
    expect(view().viewer).toMatchObject({ rotationDeg: 0, sideways: false, rotationText: null }); // another photo: as it is
    review.viewerRotate(-1);
    expect(view().viewer).toMatchObject({ rotationDeg: 270, sideways: true });
    review.viewerStep(-1);
    review.viewerRotate(1);
    expect(view().viewer).toMatchObject({ rotationDeg: 180, sideways: false, rotationText: ROTATED_TEXT });
    review.viewerRotate(1);
    review.viewerRotate(1);
    expect(view().viewer).toMatchObject({ rotationDeg: 0, rotationText: null }); // a full turn: as it is
    review.viewerClose();
    review.viewerRotate(1); // closed: nothing to turn
    review.openViewer('b');
    expect(view().viewer!.rotationDeg).toBe(270);
    expect(fakes.decisions).toEqual([]);
    expect(view().group!.selectionText).toBe('1 of 3 photos selected for the trash');
  });

  it('a blocked review says why, also when a key is pressed', async () => {
    const fakes = new Fakes();
    fakes.blocked = 'SCAN_UNFINISHED';
    const { review, view } = await opened(fakes);
    expect(view()).toMatchObject({ blockedText: 'The library scan is unfinished, so no photo can be proposed. Finish it on the Scan tab.', group: null, emptyText: null });
    // The reason takes the place of the counts, which mean nothing without a usable scan.
    expect(view()).toMatchObject({ groupsText: null });
    review.approve();
    expect(view().notice!.text).toBe(view().blockedText);
  });

  it('a scan more than a day old can be reviewed, kept and skipped, but D refuses to approve', async () => {
    const fakes = new Fakes();
    fakes.scanOutOfDate = true;
    const { review, view } = await opened(fakes);
    expect(view()).toMatchObject({
      blockedText: 'The library scan is more than a day old. You can review the groups, but to trash photos, check for new photos on the Scan tab first: it re-reads the list of your photos (about 2–3 minutes) and only looks at new ones.',
      groupsText: '2 groups (0 decided · 2 to go)',
    });
    expect(view().group!.selectionText).toBe('1 of 3 photos selected for the trash');
    review.approve();
    await settle();
    expect(fakes.decisions).toEqual([]);
    expect(view().notice).toMatchObject({ text: 'Nothing was moved to the trash: the library scan is more than a day old. Check for new photos on the Scan tab, then try again.', tone: 'caution' });
    review.keep();
    await settle();
    expect(fakes.decisions.map((d) => [d.groupId, d.kind])).toEqual([['g1', 'KEPT']]);
    // A fresh scan builds the groups again, and approving works.
    fakes.scanOutOfDate = false;
    review.show();
    await settle();
    expect(view().blockedText).toBeNull();
    review.approve();
    await settle();
    expect(fakes.decisions[0]).toMatchObject({ groupId: 'g2', kind: 'APPROVED' });
  });

  it('says how many photos are not analysed yet, since their moments can come back with them', async () => {
    const fakes = new Fakes();
    fakes.notAnalysed = 437;
    const { review, view } = await opened(fakes);
    expect(view().notAnalysedText).toBe(
      '437 photos are not analysed yet, so a moment you have decided on may come back with a photo you haven’t seen. Check for new photos on the Scan tab to analyse them.',
    );
    fakes.notAnalysed = 1;
    review.show();
    await settle();
    expect(view().notAnalysedText).toMatch(/^1 photo is not analysed yet,/);
    // Gone once every photo is analysed.
    fakes.notAnalysed = 0;
    review.show();
    await settle();
    expect(view().notAnalysedText).toBeNull();
    // While the review is blocked, the reason is what counts.
    fakes.notAnalysed = 5;
    fakes.blocked = 'SCAN_UNFINISHED';
    review.show();
    await settle();
    expect(view().notAnalysedText).toBeNull();
  });

  it('a missing preview says so; the trash queue line counts the jobs', async () => {
    const fakes = new Fakes();
    fakes.pending = [group('g', member('a', 'KEEPER'), member('b', 'PROPOSED', { thumbUrl: 'thumb-no-tab' }), member('c', 'PROPOSED', { thumbUrl: 'thumb-changed' }))];
    const { review, view } = await opened(fakes);
    expect(view().group!.tiles[1]).toMatchObject({ imageUrl: null, error: 'Preview unavailable: open Google Photos' });
    expect(view().group!.tiles[2]).toMatchObject({ imageUrl: null, error: 'Preview unavailable: Photo Cleaner needs an update' });
    review.setQueueStatus({ counts: { QUEUED: 1, COMPLETED: 3, RESTORED: 1 }, waitingReason: null });
    expect(view().queueText).toBe('Trash queue: 1 queued · 3 in trash · 0 blocked · 0 failed · 0 cancelled · 1 restored');
  });

  it('a failed undo says so and leaves the review usable', async () => {
    const fakes = new Fakes();
    fakes.undoError = new Error('database closed');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { review, view } = await opened(fakes);
    review.undo();
    await settle();
    expect(view().notice).toMatchObject({ text: ACTION_FAILED, tone: 'negative' });
    expect(view().workingText).toBeNull();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('says how many groups are left as they change, for the popup; nothing while the groups are blocked', async () => {
    const fakes = new Fakes();
    const { review } = await opened(fakes);
    expect(fakes.groupsLeftReported).toEqual([2]);
    review.keep();
    await settle();
    expect(fakes.groupsLeftReported).toEqual([2, 1]);
    review.undo();
    await settle();
    expect(fakes.groupsLeftReported.at(-1)).toBe(2);

    const blocked = new Fakes();
    blocked.blocked = 'SCAN_UNFINISHED';
    await opened(blocked);
    expect(blocked.groupsLeftReported).toEqual([]);
  });
});
