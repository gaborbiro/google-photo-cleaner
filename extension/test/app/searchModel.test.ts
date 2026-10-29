// Search & sweep's state machine and texts, with a fake library, model and trash queue.

import { describe, expect, it, vi } from 'vitest';
import { ACTION_FAILED } from '../../src/app/duplicates/reviewModel';
import type { StoredDecision } from '../../src/app/duplicates/reviewStore';
import { SearchModel, searchIntroText, type LibraryPhoto, type SearchDeps, type SearchLibrary } from '../../src/app/search/searchModel';
import { SourceError } from '../../src/app/scan/source';
import { memorySizeMemory } from '../../src/app/shared/photoSize';
import { ROTATED_TEXT } from '../../src/app/shared/viewRotation';
import { ALL_PROTECTED } from '../../src/app/shared/preferences';

const at = (degrees: number) => Float32Array.from([Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]);

/** Photo [key] at [degrees] (the description "boxes" is at 0°), taken on day [day] of Oct 2026. */
function photo(key: string, degrees: number, day: number, opts: Partial<LibraryPhoto> = {}): LibraryPhoto {
  return { mediaKey: key, dedupKey: `d-${key}`, takenAtMs: new Date(2026, 9, day, 12).getTime(), thumbUrl: `thumb-${key}`, vector: at(degrees), eligible: true, approved: false, ...opts };
}

class Fakes implements SearchDeps {
  library: SearchLibrary = {
    blocked: null,
    scanOutOfDate: false,
    photos: new Map([photo('box1', 0, 3), photo('box2', 5, 1), photo('fav', 2, 2, { eligible: false }), photo('tub', 30, 4), photo('cat', 80, 5)].map((p) => [p.mediaKey, p])),
    protection: ALL_PROTECTED,
  };
  swept: string[][] = [];
  undone: StoredDecision[] = [];
  sweepError: Error | null = null;
  /** Photos the sweep's re-check finds changed since the search (protected now, or queued elsewhere). */
  changedSince = new Set<string>();
  loads = 0;
  sizeMemory = memorySizeMemory();
  /** Every thumbnail asked for, with its size. */
  previews: string[] = [];

  async loadLibrary() {
    this.loads++;
    return this.library;
  }
  async embedQuery(_text: string, onProgress: (f: number) => void): Promise<Float32Array> {
    onProgress(0.5);
    onProgress(1);
    return at(0);
  }
  async sweep(keys: string[]) {
    if (this.sweepError) throw this.sweepError;
    const queued = keys.filter((k) => !this.changedSince.has(k));
    if (queued.length > 0) this.swept.push(queued);
    return { queued, leftOut: keys.filter((k) => this.changedSince.has(k)) };
  }
  undoError: Error | null = null;
  async undo() {
    if (this.undoError) throw this.undoError;
    return this.undone.shift() ?? null;
  }
  /** Thumbnails that fail, and how. */
  failingPreviews = new Map<string, SourceError>();
  async preview(thumbUrl: string, sizePx: number) {
    this.previews.push(`${thumbUrl}@${sizePx}`);
    const failure = this.failingPreviews.get(thumbUrl);
    if (failure) throw failure;
    return `data:${thumbUrl}`;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function searched(text = 'boxes', fakes = new Fakes()) {
  const model = new SearchModel(fakes);
  model.gridMeasured(3);
  model.setQueryText(text);
  model.searchText();
  await settle();
  return { model, fakes, view: () => model.getView() };
}

const keys = (model: SearchModel) => model.getView().tiles.map((t) => t.mediaKey);

describe('Search & sweep', () => {
  it('hiding multiple selected results asks first, cancels, then hides without a trash decision', async () => {
    const { model, view, fakes } = await searched();
    const changed = vi.fn();
    model.onDecisionsChanged(changed);
    model.tileClicked(0, false);
    model.tileClicked(1, true);
    model.hideSelected();
    expect(keys(model)).toHaveLength(4);
    expect(view()).toMatchObject({ confirmKind: 'hide', confirmText: expect.stringContaining('Hide 2 selected photos') });
    model.cancel();
    expect(view().confirmText).toBeNull();
    expect(keys(model)).toHaveLength(4);
    model.hideSelected();
    model.enter();
    expect(keys(model)).toEqual(['tub', 'cat']);
    expect(view()).toMatchObject({ resultText: '2 best matches · 0 selected', confirmText: null });
    expect(fakes.swept).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });

  it('hiding one result is immediate, preserves other selections, and never returns on sort or refinement', async () => {
    const { model, view, fakes } = await searched();
    model.tileClicked(2, false);
    model.hideResult('box1');
    expect(view().confirmText).toBeNull();
    expect(view().tiles.filter((t) => t.selected).map((t) => t.mediaKey)).toEqual(['tub']);
    expect(view().tiles.find((t) => t.current)?.mediaKey).toBe('tub');
    model.setSort('oldest');
    model.addExamples('more');
    await settle();
    expect(keys(model)).not.toContain('box1');
    model.hideSelected();
    expect(keys(model)).not.toContain('tub');
    expect(view().confirmText).toBeNull();
    expect(fakes.swept).toEqual([]);
    model.searchText();
    await settle();
    expect(keys(model)).toContain('box1');
    expect(keys(model)).toContain('tub');
  });

  it('hiding keeps Show more available and never brings hidden results back', async () => {
    const fakes = new Fakes();
    fakes.library.photos = new Map(Array.from({ length: 305 }, (_, i) => {
      const p = photo(`p${i}`, 0, 1);
      return [p.mediaKey, p];
    }));
    const { model, view } = await searched('boxes', fakes);
    model.hideResult('p0');
    expect(view().showMoreVisible).toBe(true);
    model.showMore();
    expect(keys(model)).toHaveLength(304);
    expect(keys(model)).not.toContain('p0');
    model.startOver();
    model.setQueryText('boxes');
    model.searchText();
    await settle();
    expect(keys(model)).toContain('p0');
  });

  it('hiding every selected result cancels a pending trash confirmation and leaves safe empty results', async () => {
    const { model, view, fakes } = await searched();
    model.selectAll();
    model.approve();
    model.hideSelected();
    expect(view().confirmKind).toBe('hide');
    model.enter();
    expect(keys(model)).toEqual([]);
    expect(view()).toMatchObject({ viewer: null, confirmText: null, resultText: '0 best matches · 0 selected' });
    model.enter();
    expect(fakes.swept).toEqual([]);
  });

  it('shows the best matches, none selected; protected photos never appear, only counted', async () => {
    const { model, view } = await searched();
    expect(keys(model)).toEqual(['box1', 'box2', 'tub', 'cat']);
    expect(view()).toMatchObject({ resultText: '4 best matches · 0 selected', hiddenText: '1 protected or unknown photo hidden', searching: false, progressText: null, showMoreVisible: false });
    expect(view().tiles[0]).toMatchObject({ selected: false, current: true, caption: '3 Oct 2026 · match #1', link: 'https://photos.google.com/photo/box1' });
  });

  it('says the first search gets the AI model ready', async () => {
    let release!: (v: Float32Array) => void;
    const fakes = new Fakes();
    fakes.embedQuery = () => new Promise<Float32Array>((resolve) => (release = resolve));
    const model = new SearchModel(fakes);
    model.setQueryText('boxes');
    model.searchText();
    await settle();
    expect(model.getView().progressText).toBe('Searching… the first search also gets the AI model ready on the graphics card (about 10–20 s).');
    release(at(0));
    await settle();
    expect(model.getView().progressText).toBeNull();
  });

  it('sorts the same matches by date', async () => {
    const { model } = await searched();
    model.setSort('newest');
    expect(keys(model)).toEqual(['cat', 'tub', 'box1', 'box2']);
    model.setSort('oldest');
    expect(keys(model)).toEqual(['box2', 'box1', 'tub', 'cat']);
  });

  it('more like the selected photos; less like others: they show as examples and steer the results', async () => {
    const { model, view } = await searched();
    model.tileClicked(3, false); // cat
    model.addExamples('more');
    await settle();
    expect(view().more.map((e) => e.mediaKey)).toEqual(['cat']);
    // Photos to find more of are usually ones to trash too: they stay selected.
    expect(view().tiles.filter((t) => t.selected).map((t) => t.mediaKey)).toEqual(['cat']);
    expect(view().resultText).toBe('4 best matches · 1 selected');
    model.tileClicked(keys(model).indexOf('cat'), false, true); // Ctrl-click removes cat from the selection
    const tub = keys(model).indexOf('tub');
    model.tileClicked(tub, false);
    model.addExamples('less');
    await settle();
    expect(view().less.map((e) => e.mediaKey)).toEqual(['tub']);
    expect(keys(model)).not.toContain('tub');
    expect(view().tiles.filter((t) => t.selected)).toEqual([]); // they were only examples
    expect(view().hiddenText).toContain('more like the unwanted examples hidden');
    model.removeExample('tub');
    await settle();
    expect(keys(model)).toContain('tub');
  });

  it('more like the selected: the selection stays, except photos no longer among the results, which the user is told of', async () => {
    const { model, view, fakes } = await searched();
    model.tileClicked(keys(model).indexOf('box2'), false);
    model.tileClicked(keys(model).indexOf('tub'), false, true);
    // Meanwhile tub became a favourite: the next search reads the library again and leaves it out.
    fakes.library.photos.get('tub')!.eligible = false;
    model.libraryChanged();
    model.addExamples('more');
    await settle();
    expect(view().more.map((e) => e.mediaKey)).toEqual(['box2', 'tub']);
    expect(keys(model)).not.toContain('tub');
    expect(view().tiles.filter((t) => t.selected).map((t) => t.mediaKey)).toEqual(['box2']);
    expect(view().notice).toMatchObject({ text: '1 selected photo is no longer among the best matches, so it is not selected now.', tone: 'caution' });
    // What the trash question counts and the sweep moves is what is shown as selected.
    model.approve();
    expect(view().confirmText).toContain('Move 1 photo to the trash?');
    model.enter();
    await settle();
    expect(fakes.swept).toEqual([['box2']]);
  });

  it('a new description starts a new selection', async () => {
    const { model, view } = await searched();
    model.tileClicked(0, false);
    model.searchText();
    await settle();
    expect(view().tiles.filter((t) => t.selected)).toEqual([]);
  });

  it('- and + make the results smaller and larger: the rows follow, sharper thumbnails come into view, the size is remembered', async () => {
    const { model, view, fakes } = await searched();
    expect(view()).toMatchObject({ tilePx: 160, canShrink: true, canGrow: true });
    model.tileVisible('box1');
    await settle();
    expect(view().tiles[0]).toMatchObject({ imageUrl: 'data:thumb-box1', imageWanted: false });
    expect(fakes.previews).toEqual(['thumb-box1@200']);
    model.gridWidthMeasured(3 * 220 + 2 * 16); // three of the next size; all four results of this one
    model.focusMove(0, 1); // one row: nowhere to go
    expect(view().tiles.findIndex((t) => t.current)).toBe(0);

    const pulse = view().focusPulse;
    model.resize(1);
    expect(view()).toMatchObject({ tilePx: 220, focusPulse: pulse + 1 });
    model.focusMove(0, 1);
    expect(view().tiles.findIndex((t) => t.current)).toBe(3); // three a row now
    // The thumbnail there stays until the sharper one, fetched once the tile is in view, comes.
    expect(view().tiles[0]).toMatchObject({ imageUrl: 'data:thumb-box1', imageWanted: true });
    model.tileVisible('box1');
    await settle();
    expect(fakes.previews).toEqual(['thumb-box1@200', 'thumb-box1@300']);
    expect(view().tiles[0]!.imageWanted).toBe(false);
    expect(fakes.sizeMemory.load()).toBe(2);

    model.resize(-1);
    expect(view().tiles[0]!.imageWanted).toBe(false); // sharp enough already
    model.resize(-1);
    model.resize(-1);
    expect(view()).toMatchObject({ tilePx: 120, canShrink: false, notice: { text: 'The photos are at their smallest.', tone: 'caution' } });
    expect(new SearchModel(fakes).getView().tilePx).toBe(120); // remembered for the next review tab
  });

  it('Start over clears the description, the examples and the results', async () => {
    const { model, view } = await searched();
    expect(view().canStartOver).toBe(true);
    model.tileClicked(3, false);
    model.addExamples('more');
    await settle();
    model.startOver();
    expect(view()).toMatchObject({ query: '', more: [], less: [], tiles: [], resultText: null, hiddenText: null, canStartOver: false });
  });

  it('M or L with nothing selected says what to do', async () => {
    const { model, view } = await searched();
    model.addExamples('more');
    expect(view().notice!.text).toBe('Select a few example photos first.');
  });

  it('D asks first; Enter moves exactly the selection to the trash queue and out of the results', async () => {
    const { model, fakes, view } = await searched();
    model.approve();
    expect(view().notice!.text).toBe('Select photos to trash first.');
    model.tileClicked(0, false);
    model.tileClicked(2, true); // shift: box1 to tub
    expect(view().resultText).toBe('4 best matches · 3 selected');
    model.approve();
    expect(view().confirmText).toBe("Move 3 photos to the trash? They go to Google Photos' trash, where they stay for 30 days.");
    model.cancel();
    expect(view().confirmText).toBeNull();
    model.approve();
    model.enter();
    await settle();
    expect(fakes.swept).toEqual([['box1', 'box2', 'tub']]);
    expect(keys(model)).toEqual(['cat']);
    expect(view().notice).toMatchObject({ text: 'Moved 3 photos to the trash queue. Z undoes it.', tone: 'positive' });
    expect(view().hiddenText).toContain('3 already in the trash queue hidden');
  });

  it('tells Duplicates after a sweep and an undo, not after a refused sweep or nothing to undo', async () => {
    const { model, fakes } = await searched();
    const heard = vi.fn();
    model.onDecisionsChanged(heard);
    model.tileClicked(0, false);
    fakes.sweepError = new Error('refused');
    model.approve();
    model.enter();
    await settle();
    expect(heard).not.toHaveBeenCalled();
    fakes.sweepError = null;
    model.approve();
    model.enter();
    await settle();
    expect(heard).toHaveBeenCalledTimes(1);
    fakes.undone = [{ id: 1, account: 'a', groupId: 'sweep:1', kind: 'APPROVED', items: [], members: [], createdAtMs: 0, undoneAtMs: null }];
    model.undo();
    await settle();
    await settle();
    expect(heard).toHaveBeenCalledTimes(2);
    model.undo();
    await settle();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('a photo changed since the search is left out; the rest go, and it leaves the results', async () => {
    const fakes = new Fakes();
    fakes.changedSince.add('box2');
    const { model, view } = await searched('boxes', fakes);
    model.tileClicked(0, false);
    model.tileClicked(2, true); // box1, box2, tub
    model.approve();
    model.enter();
    await settle();
    expect(fakes.swept).toEqual([['box1', 'tub']]);
    expect(keys(model)).toEqual(['cat']);
    expect(view().notice).toMatchObject({ tone: 'caution', text: 'Moved 2 photos to the trash queue. Z undoes it. 1 photo was left out: it is protected now, gone from the library or already in the trash queue.' });
    expect(view().resultText).toBe('1 best match · 0 selected');
    expect(view().hiddenText).toContain('2 already in the trash queue hidden');
  });

  it('when every selected photo changed since the search, nothing is moved and Duplicates is not told', async () => {
    const fakes = new Fakes();
    fakes.changedSince = new Set(['box1', 'box2']);
    const { model, view } = await searched('boxes', fakes);
    const heard = vi.fn();
    model.onDecisionsChanged(heard);
    model.tileClicked(0, false);
    model.tileClicked(1, true);
    model.approve();
    model.enter();
    await settle();
    expect(fakes.swept).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
    expect(keys(model)).toEqual(['tub', 'cat']);
    expect(view().notice).toMatchObject({ tone: 'caution', text: 'Nothing was moved to the trash: the 2 selected photos changed since the search; they are protected now, gone from the library or already in the trash queue.' });
  });

  it('a refused sweep says why and keeps the selection', async () => {
    const fakes = new Fakes();
    fakes.sweepError = new Error('1 selected photo is no longer eligible or already in the trash queue; search again');
    const { model, view } = await searched('boxes', fakes);
    model.tileClicked(0, false);
    model.approve();
    model.enter();
    await settle();
    expect(view().notice).toMatchObject({ tone: 'negative', text: '1 selected photo is no longer eligible or already in the trash queue; search again' });
    expect(view().resultText).toBe('4 best matches · 1 selected');
  });

  it("the grid's measured width sets how far up and down move; a hidden grid keeps the last width", async () => {
    const { model, view } = await searched();
    model.tileClicked(0, false); // with nothing selected, the first arrow would only select
    model.gridWidthMeasured(3 * 160 + 2 * 16 - 1); // just too narrow for 3 tiles
    model.focusMove(0, 1, false);
    expect(view().tiles.findIndex((t) => t.current)).toBe(2);
    model.focusMove(0, -1, false);
    model.gridWidthMeasured(3 * 160 + 2 * 16); // exactly 3
    model.gridWidthMeasured(0);
    model.focusMove(0, 1, false);
    expect(view().tiles.findIndex((t) => t.current)).toBe(3);
  });

  it('a failed undo says so', async () => {
    const { model, view, fakes } = await searched();
    fakes.undoError = new Error('database closed');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    model.undo();
    await settle();
    expect(view().notice).toMatchObject({ text: ACTION_FAILED, tone: 'negative' });
    errors.mockRestore();
  });

  it('Z undoes and searches again so the photos come back', async () => {
    const { model, fakes, view } = await searched();
    model.tileClicked(0, false);
    model.approve();
    model.enter();
    await settle();
    fakes.library.photos.get('box1')!.approved = false; // what undoing does to the saved data
    fakes.undone = [{ id: 1, account: 'a', groupId: 'sweep:1', kind: 'APPROVED', items: [], members: [], createdAtMs: 0, undoneAtMs: null }];
    const loads = fakes.loads;
    model.undo();
    await settle();
    await settle();
    expect(fakes.loads).toBe(loads + 1); // the saved data is read again
    expect(keys(model)).toContain('box1');
    expect(view().notice!.text).toBe('Undid the trashing: photos not yet sent are cancelled and any already trashed are restored');
  });

  it('Shift-click selects the range from the photo last clicked; the arrows move one selected photo', async () => {
    const { model, view } = await searched();
    const selected = () => view().tiles.flatMap((t, i) => (t.selected ? [i] : []));
    model.tileClicked(2, true); // nothing clicked yet: from the first result
    expect(selected()).toEqual([0, 1, 2]);
    expect(view().tiles.findIndex((t) => t.current)).toBe(2);
    model.tileClicked(1, false); // a plain click: one photo again
    expect(selected()).toEqual([1]);
    model.focusMove(1, 0); // the selection itself moves
    expect(selected()).toEqual([2]);
    model.tileClicked(3, true); // from the photo the arrows moved to
    expect(selected()).toEqual([2, 3]);
    model.tileClicked(0, true); // the range keeps its start
    expect(selected()).toEqual([0, 1, 2]);
    model.focusMove(1, 0); // arrows go back to one photo, next to the one last clicked
    expect(selected()).toEqual([1]);
  });

  it('with nothing selected, the first arrow selects the photo last clicked without moving', async () => {
    const { model, view } = await searched();
    const selected = () => view().tiles.flatMap((t, i) => (t.selected ? [i] : []));
    model.focusMove(1, 0);
    expect(selected()).toEqual([0]);
    model.tileClicked(2, false, true);
    model.tileClicked(2, false, true); // Ctrl-click on and off again
    model.tileClicked(0, false, true); // and the first off: nothing selected, the last click was on it
    expect(selected()).toEqual([]);
    model.focusMove(0, 1);
    expect(selected()).toEqual([0]);
  });

  it('A selects every result; A again clears the selection', async () => {
    const { model, view } = await searched();
    model.selectAll();
    expect(view().tiles.every((t) => t.selected)).toBe(true);
    model.tileClicked(1, false, true); // Ctrl-click takes one off
    expect(view().resultText).toBe('4 best matches · 3 selected');
    model.selectAll(); // not all selected: A selects them all
    expect(view().resultText).toBe('4 best matches · 4 selected');
    model.selectAll();
    expect(view().resultText).toBe('4 best matches · 0 selected');
  });

  it('plain clicks select one; Ctrl/Cmd-click toggles without changing the other selections', async () => {
    const { model, view, fakes } = await searched();
    const selected = () => view().tiles.filter((t) => t.selected).map((t) => t.mediaKey);
    model.tileClicked(0, false);
    model.tileClicked(0, false);
    expect(selected()).toEqual(['box1']);
    model.tileClicked(2, false, true);
    expect(selected()).toEqual(['box1', 'tub']);
    model.tileClicked(0, false, true); // Ctrl-click on a selected photo unselects it
    expect(selected()).toEqual(['tub']);
    expect(view().tiles[0]).toMatchObject({ selected: false, current: true });
    model.tileClicked(1, false);
    expect(selected()).toEqual(['box2']);
    model.tileClicked(3, true, true);
    expect(selected()).toEqual(['box2', 'tub', 'cat']);
    expect(view().confirmText).toBeNull();
    expect(fakes.swept).toEqual([]);
  });

  it('arrows stay within rows and columns; a tap at the edge bounces, a slide into it just stops', async () => {
    const { model, view } = await searched();
    const pulse = view().focusPulse;
    model.focusMove(-1, 0); // tap at the left edge
    expect(view().focusPulse).toBe(pulse + 1);
    model.focusMove(-1, 0, true); // held against it
    expect(view().focusPulse).toBe(pulse + 1);
    model.focusMove(1, 0);
    model.focusMove(1, 0);
    model.focusMove(1, 0); // end of the row of three: stays
    expect(view().tiles.findIndex((t) => t.current)).toBe(2);
    model.focusMove(0, 1); // nothing below tub's column on the short last row
    expect(view().tiles.findIndex((t) => t.current)).toBe(2);
  });

  it('a blocked library says why and shows nothing', async () => {
    const fakes = new Fakes();
    fakes.library = { blocked: 'SCAN_UNFINISHED', scanOutOfDate: false, photos: new Map(), protection: ALL_PROTECTED };
    const { view } = await searched('boxes', fakes);
    expect(view()).toMatchObject({ blockedText: 'The library scan is unfinished, so no photo can be trashed. Finish it on the Scan tab.', tiles: [], resultText: null });
  });

  it('a scan more than a day old is searched and selected, but D refuses to ask about the trash', async () => {
    const fakes = new Fakes();
    fakes.library = { ...fakes.library, scanOutOfDate: true };
    const { model, view } = await searched('boxes', fakes);
    expect(keys(model)).toEqual(['box1', 'box2', 'tub', 'cat']);
    expect(view().blockedText).toBe('The library scan is more than a day old. Searching works, but to trash photos, check for new photos on the Scan tab first (about 2–3 minutes).');
    model.tileClicked(0, false);
    model.approve();
    expect(view().confirmText).toBeNull();
    expect(view().notice).toMatchObject({ text: 'Nothing was moved to the trash: the library scan is more than a day old. Check for new photos on the Scan tab, then try again.', tone: 'caution' });
    model.enter(); // with no question asked, Enter only views the photo
    await settle();
    expect(fakes.swept).toEqual([]);
  });

  it('after a new scan may have come in, D asks again and the sweep checks the scan', async () => {
    const fakes = new Fakes();
    fakes.library = { ...fakes.library, scanOutOfDate: true };
    const { model, view } = await searched('boxes', fakes);
    model.libraryChanged();
    model.tileClicked(0, false);
    model.approve();
    expect(view().confirmText).not.toBeNull();
    model.enter();
    await settle();
    expect(fakes.swept).toEqual([['box1']]);
  });

  it('"Search more like these" from Duplicates searches by those photos', async () => {
    const model = new SearchModel(new Fakes());
    model.searchLike(['cat']);
    await settle();
    expect(model.getView().more.map((e) => e.mediaKey)).toEqual(['cat']);
    expect(keys(model)[0]).toBe('cat');
    expect(model.getView().notice!.text).toBe('Searching for photos like the 1 photo from the duplicate group.');
  });

  it('the viewer shows a result large and toggles it', async () => {
    const { model, view } = await searched();
    model.enter();
    await settle();
    expect(view().viewer).toMatchObject({ infoText: '1 of 4 · 3 Oct 2026 · match #1', selectionText: 'Not selected', imageUrl: 'data:thumb-box1' });
    model.viewerToggle();
    expect(view().viewer).toMatchObject({ selectionText: 'Selected', tone: 'neutral' });
    model.viewerStep(2);
    model.viewerClose();
    expect(view().tiles.findIndex((t) => t.current)).toBe(2);
  });

  it('the viewer turns a result for viewing only; it keeps its turn, and nothing is selected or swept', async () => {
    const { model, view, fakes } = await searched();
    model.enter();
    model.viewerRotate(1);
    expect(view().viewer).toMatchObject({ rotationDeg: 90, sideways: true, rotationText: ROTATED_TEXT });
    model.viewerStep(1);
    expect(view().viewer).toMatchObject({ rotationDeg: 0, rotationText: null });
    model.viewerStep(-1);
    model.viewerRotate(-1);
    model.viewerRotate(-1);
    expect(view().viewer).toMatchObject({ rotationDeg: 270, sideways: true });
    model.viewerClose();
    model.enter();
    expect(view().viewer!.rotationDeg).toBe(270);
    expect(view().resultText).toBe('4 best matches · 0 selected');
    expect(fakes.swept).toEqual([]);
  });

  it('fetches a sharper thumbnail when photos grow while the smaller request is pending', async () => {
    const fakes = new Fakes();
    let finishSmall!: (url: string) => void;
    let finishLarge!: (url: string) => void;
    const preview = vi.spyOn(fakes, 'preview')
      .mockImplementationOnce(() => new Promise<string>((resolve) => { finishSmall = resolve; }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => { finishLarge = resolve; }));
    const { model, view } = await searched('boxes', fakes);
    model.tileVisible('box1');
    model.resize(1);
    expect(preview.mock.calls).toEqual([['thumb-box1', 200]]);
    finishSmall('data:small');
    await settle();
    expect(preview.mock.calls).toEqual([['thumb-box1', 200], ['thumb-box1', 300]]);
    expect(view().tiles.find((t) => t.mediaKey === 'box1')).toMatchObject({ imageUrl: 'data:small', imageWanted: true });
    finishLarge('data:large');
    await settle();
    expect(view().tiles.find((t) => t.mediaKey === 'box1')).toMatchObject({ imageUrl: 'data:large', imageWanted: false });
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it.each(['failed', 'hidden'] as const)('does not automatically replace a %s thumbnail after resizing', async (outcome) => {
    const fakes = new Fakes();
    let finish!: (url: string) => void;
    let fail!: (error: Error) => void;
    const preview = vi.spyOn(fakes, 'preview').mockImplementationOnce(() => new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }));
    const { model } = await searched('boxes', fakes);
    model.tileVisible('box1');
    model.resize(1);
    if (outcome === 'hidden') {
      model.hideResult('box1');
      finish('data:small');
    } else {
      fail(new SourceError('TRANSIENT', 'Offline'));
    }
    await settle();
    expect(preview.mock.calls).toEqual([['thumb-box1', 200]]);
  });

  it('thumbnails are fetched as tiles come into view', async () => {
    const { model, view } = await searched();
    model.tileVisible('box1');
    await settle();
    await settle();
    expect(view().tiles[0]!.imageUrl).toBe('data:thumb-box1');
  });

  it('a thumbnail that fails says why, and is tried again when it comes back into view', async () => {
    const { model, view, fakes } = await searched();
    fakes.failingPreviews.set('thumb-box1', new SourceError('BAD_REQUEST', 'Preview host not allowed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    model.tileVisible('box1');
    await settle();
    await settle();
    expect(view().tiles[0]).toMatchObject({ imageUrl: null, error: 'Preview unavailable: Photo Cleaner needs an update' });
    expect(warn).toHaveBeenCalledWith('Photo Cleaner: unexpected answer from Google Photos (Search: preview)', expect.objectContaining({ kind: 'BAD_REQUEST' }));
    warn.mockRestore();

    fakes.failingPreviews.clear();
    model.tileVisible('box1');
    await settle();
    await settle();
    expect(view().tiles[0]).toMatchObject({ imageUrl: 'data:thumb-box1', error: null });
  });
});

describe('what Search says never appears', () => {
  it('follows the protection choices', () => {
    expect(searchIntroText(ALL_PROTECTED)).toContain('; favourites, photos in albums, archived photos and photos of unknown status never appear.');
    expect(searchIntroText({ favourites: false, albums: true, archived: false })).toContain('; photos in albums and photos of unknown status never appear.');
    expect(searchIntroText({ favourites: false, albums: false, archived: false })).toContain('; photos of unknown status never appear.');
    expect(searchIntroText(null)).toContain('; protected photos and photos of unknown status never appear.');
  });
});
