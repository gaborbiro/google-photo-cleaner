// Search & sweep's state machine and texts, with a fake library, model and trash queue.

import { describe, expect, it } from 'vitest';
import type { StoredDecision } from '../../src/app/duplicates/reviewStore';
import { SearchModel, type LibraryPhoto, type SearchDeps, type SearchLibrary } from '../../src/app/search/searchModel';

const at = (degrees: number) => Float32Array.from([Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]);

/** Photo [key] at [degrees] (the description "boxes" is at 0°), taken on day [day] of Oct 2026. */
function photo(key: string, degrees: number, day: number, opts: Partial<LibraryPhoto> = {}): LibraryPhoto {
  return { mediaKey: key, dedupKey: `d-${key}`, takenAtMs: new Date(2026, 9, day, 12).getTime(), thumbUrl: `thumb-${key}`, vector: at(degrees), eligible: true, approved: false, ...opts };
}

class Fakes implements SearchDeps {
  library: SearchLibrary = {
    blocked: null,
    photos: new Map([photo('box1', 0, 3), photo('box2', 5, 1), photo('fav', 2, 2, { eligible: false }), photo('tub', 30, 4), photo('cat', 80, 5)].map((p) => [p.mediaKey, p])),
  };
  swept: string[][] = [];
  undone: StoredDecision[] = [];
  sweepError: Error | null = null;
  loads = 0;

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
    this.swept.push(keys);
  }
  async undo() {
    return this.undone.shift() ?? null;
  }
  async preview(thumbUrl: string) {
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
  it('shows the best matches with the first outlined; protected photos never appear, only counted', async () => {
    const { model, view } = await searched();
    expect(keys(model)).toEqual(['box1', 'box2', 'tub', 'cat']);
    expect(view()).toMatchObject({ resultText: '4 best matches · 0 selected for the trash', hiddenText: '1 protected or unknown photo hidden', searching: false, progressText: null, showMoreVisible: false });
    expect(view().tiles[0]).toMatchObject({ focused: true, current: true, caption: '3 Oct 2026 · match #1', link: 'https://photos.google.com/photo/box1' });
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
    expect(view().tiles.find((t) => t.mediaKey === 'cat')!.selected).toBe(false); // selection cleared
    const tub = keys(model).indexOf('tub');
    model.tileClicked(tub, false);
    model.addExamples('less');
    await settle();
    expect(view().less.map((e) => e.mediaKey)).toEqual(['tub']);
    expect(keys(model)).not.toContain('tub');
    expect(view().hiddenText).toContain('more like the unwanted examples hidden');
    model.removeExample('tub');
    await settle();
    expect(keys(model)).toContain('tub');
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
    expect(view().notice!.text).toBe('Nothing is selected for the trash.');
    model.tileClicked(0, false);
    model.tileClicked(2, true); // shift: box1 to tub
    expect(view().resultText).toBe('4 best matches · 3 selected for the trash');
    model.approve();
    expect(view().confirmText).toBe('Move 3 photos to the trash? (Simulated: nothing is sent to Google.)');
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

  it('a refused sweep says why and keeps the selection', async () => {
    const fakes = new Fakes();
    fakes.sweepError = new Error('1 selected photo is no longer eligible or already in the trash queue; search again');
    const { model, view } = await searched('boxes', fakes);
    model.tileClicked(0, false);
    model.approve();
    model.enter();
    await settle();
    expect(view().notice).toMatchObject({ tone: 'negative', text: '1 selected photo is no longer eligible or already in the trash queue; search again' });
    expect(view().resultText).toBe('4 best matches · 1 selected for the trash');
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

  it('A outlines every result; Space then marks them all, and again none', async () => {
    const { model, view } = await searched();
    model.focusAll();
    expect(view().tiles.every((t) => t.focused && !t.current)).toBe(true);
    model.toggleFocused();
    expect(view().resultText).toBe('4 best matches · 4 selected for the trash');
    model.toggleFocused();
    expect(view().resultText).toBe('4 best matches · 0 selected for the trash');
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
    fakes.library = { blocked: 'SCAN_STALE', photos: new Map() };
    const { view } = await searched('boxes', fakes);
    expect(view()).toMatchObject({ blockedText: 'The library scan is more than a day old. Check for new photos on the Scan tab (about 2–3 minutes).', tiles: [], resultText: null });
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
    expect(view().viewer).toMatchObject({ infoText: '1 of 4 · 3 Oct 2026 · match #1', selectionText: 'Kept (not selected)', imageUrl: 'data:thumb-box1' });
    model.viewerToggle();
    expect(view().viewer).toMatchObject({ selectionText: 'Selected for the trash', tone: 'negative' });
    model.viewerStep(2);
    model.viewerClose();
    expect(view().tiles.findIndex((t) => t.current)).toBe(2);
  });

  it('thumbnails are fetched as tiles come into view', async () => {
    const { model, view } = await searched();
    model.tileVisible('box1');
    await settle();
    await settle();
    expect(view().tiles[0]!.imageUrl).toBe('data:thumb-box1');
  });
});
