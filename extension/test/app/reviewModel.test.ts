// The Duplicates review's state machine and texts, with fake decisions and previews: the twin of
// the desktop's ReviewViewModel behaviour.

import { describe, expect, it, vi } from 'vitest';
import { ACTION_FAILED, DuplicatesReview, type ReviewDeps } from '../../src/app/duplicates/reviewModel';
import type { StoredDecision } from '../../src/app/duplicates/reviewStore';
import type { DecisionKind, DuplicateGroup, GroupMember, ReviewQueue } from '../../src/app/duplicates/rules';
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
  blocked: ReviewQueue['blocked'] = null;
  decisions: StoredDecision[] = [];
  loads = 0;
  /** When set, undo waits for it, so the screen can be checked meanwhile. */
  undoGate: Promise<void> | null = null;
  /** Every "groups left" the review reported, oldest first. */
  groupsLeftReported: number[] = [];

  async groupsLeft(count: number) {
    this.groupsLeftReported.push(count);
  }

  async loadQueue(): Promise<ReviewQueue> {
    this.loads++;
    const decided = new Set(this.decisions.filter((d) => d.kind !== 'DEFERRED').map((d) => d.groupId));
    const pending = this.blocked ? [] : this.pending.filter((g) => !decided.has(g.id));
    return {
      blocked: this.blocked, pending, deferredIds: [], totalGroups: this.pending.length, decidedGroups: decided.size,
      analysedAtMs: null, photosAnalysed: 100, photosNotAnalysed: 0, settings: { threshold: 0.915, windowMs: 120_000 },
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
    if (thumbUrl === 'thumb-no-tab') throw new SourceError('NO_PHOTOS_TAB', 'no Photos tab');
    if (thumbUrl === 'thumb-changed') throw new SourceError('BAD_REQUEST', 'Preview host not allowed');
    return `data:${thumbUrl}@${sizePx}`;
  }
}

/** Lets pending promises (loading, saving) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function opened(fakes = new Fakes()) {
  const review = new DuplicatesReview(fakes);
  review.gridWidthMeasured(3 * 300 + 2 * 12); // as the screen reports it: three photos a row
  review.show();
  await settle();
  return { review, fakes, view: () => review.getView() };
}

describe('the Duplicates review', () => {
  it('shows the first group with the proposals selected for the trash', async () => {
    const { view } = await opened();
    expect(view()).toMatchObject({
      groupsText: '2 groups', progressText: '0 decided · 2 to go', emptyText: null, blockedText: null,
      missingText: null,
      ruleText: 'Photos count as duplicates when they are at least 91.5% similar and taken within 2 minutes of each other. The threshold was chosen from your calibration labels.',
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

  it('says when photos are missing from the groups, and only then', async () => {
    const fakes = new Fakes();
    const load = fakes.loadQueue.bind(fakes);
    fakes.loadQueue = async () => ({ ...(await load()), photosNotAnalysed: 1_240 });
    const { view } = await opened(fakes);
    expect(view().missingText).toBe("1,240 photos aren’t in the groups yet: the Scan hasn't finished with them, or their preview could not be read. Check for new photos on the Scan tab to include them.");
  });

  it('D with nothing selected says what to do; F keeps the group and the next one appears without a message', async () => {
    const { review, fakes, view } = await opened();
    review.tileClicked('b'); // unselect the only proposal
    review.approve();
    expect(view().notice).toMatchObject({ text: 'Nothing is selected for the trash. Press F to keep the whole group.', tone: 'caution', visibleMs: 4_000 + 70 * 67 });
    review.keep();
    await settle();
    expect(fakes.decisions[0]).toMatchObject({ groupId: 'g1', kind: 'KEPT', items: [] });
    expect(view()).toMatchObject({ notice: null, progressText: '1 decided · 1 to go' });
    expect(view().group!.tiles[0]!.mediaKey).toBe('d');
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
    review.gridWidthMeasured(2 * 300 + 12); // two columns: [k p1] [p2 p3] [p4]
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

  it('a click bounces only when it moves the outline, not when it toggles the outlined photo', async () => {
    const { review, view } = await opened();
    const pulse = view().group!.focusPulse;
    review.tileClicked('a'); // already outlined: toggles only
    expect(view().group!.focusPulse).toBe(pulse);
    expect(view().group!.selectionText).toBe('2 of 3 photos selected for the trash');
    review.tileClicked('b'); // moves the outline
    expect(view().group!.focusPulse).toBe(pulse + 1);
    review.focusAll();
    review.tileClicked('b'); // from the whole group back to one photo
    expect(view().group!.focusPulse).toBe(pulse + 3);
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
    review.gridWidthMeasured(2 * 300 + 12); // two columns: [k p1] [p2 p3] [p4]
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

  it('S skips: the group goes to the end and says so when it comes round', async () => {
    const { review, view } = await opened();
    review.defer();
    await settle();
    expect(view().progressText).toBe('0 decided · 2 to go (1 skipped)');
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
    expect(view().progressText).toBe('1 decided · 1 to go (1 skipped)');
    review.undo(); // the skip
    await settle();
    expect(view().progressText).toBe('1 decided · 1 to go');
    expect(view().group!.tiles[0]!.mediaKey).toBe('d');
    review.undo(); // the keep
    await settle();
    expect(view().progressText).toBe('0 decided · 2 to go');
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
    expect(view().progressText).toBe('0 decided · 2 to go');
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

  it('a blocked review says why, also when a key is pressed', async () => {
    const fakes = new Fakes();
    fakes.blocked = 'SCAN_STALE';
    const { review, view } = await opened(fakes);
    expect(view()).toMatchObject({ blockedText: 'The library scan is more than a day old. Check for new photos on the Scan tab: it re-reads the list of your photos (about 2–3 minutes) and only looks at new ones.', group: null, emptyText: null, missingText: null });
    review.approve();
    expect(view().notice!.text).toBe(view().blockedText);
  });

  it('a missing preview says so; the trash queue line counts the jobs', async () => {
    const fakes = new Fakes();
    fakes.pending = [group('g', member('a', 'KEEPER'), member('b', 'PROPOSED', { thumbUrl: 'thumb-no-tab' }), member('c', 'PROPOSED', { thumbUrl: 'thumb-changed' }))];
    const { review, view } = await opened(fakes);
    expect(view().group!.tiles[1]).toMatchObject({ imageUrl: null, error: 'Preview unavailable: open Google Photos' });
    expect(view().group!.tiles[2]).toMatchObject({ imageUrl: null, error: 'Preview unavailable: Photo Cleaner needs an update' });
    review.setQueueStatus({ counts: { QUEUED: 1, COMPLETED: 3, RESTORED: 1 }, simulated: true, waitingReason: null });
    expect(view().queueText).toBe('Trash queue (SIMULATED, nothing is sent to Google): 1 queued · 3 in trash · 0 blocked · 0 failed · 0 cancelled · 1 restored');
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
    blocked.blocked = 'SCAN_STALE';
    await opened(blocked);
    expect(blocked.groupsLeftReported).toEqual([]);
  });
});
