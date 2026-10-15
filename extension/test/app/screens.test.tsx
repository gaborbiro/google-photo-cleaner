// @vitest-environment jsdom
//
// Each page as Chrome opens it (popup, panel, review tab), drawn into a browser-like document with
// a pretend extension and the app's own stores (in memory, holding a made-up library): it draws,
// it shows the account's data, clicks and keys reach what they should, and nothing goes wrong on
// the way (no error is logged). What each action does is tested in the models' tests; these check
// that the buttons and keys are connected to it.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NO_ANALYSIS } from '../../src/app/ai/analysis';
import { IndexedDbAnalysisStore } from '../../src/app/ai/analysisStore';
import { modelKey } from '../../src/app/ai/model';
import { IndexedDbReviewStore } from '../../src/app/duplicates/reviewStore';
import { SimulatedTrash } from '../../src/app/duplicates/trash';
import { IndexedDbInventoryStore } from '../../src/app/scan/inventoryStore';
import { endJob, jobId, NO_PROGRESS, reportProgress, startAnalysisJob, startScanJob } from '../../src/app/shared/job';
import type { AccountAnswer } from '../../src/app/shared/messages';
import { ALL_PROTECTED, IndexedDbPreferences } from '../../src/app/shared/preferences';
import { IndexedDbJobStore } from '../../src/app/shared/store';
import { fakeItem, FakePhotos, NOW, scan } from './fakes';

/** Every root a page creates, so each test can take its page down again. */
const roots = vi.hoisted(() => [] as Root[]);
vi.mock('react-dom/client', async (original) => {
  const real = await original<typeof import('react-dom/client')>();
  return { ...real, createRoot: (...args: Parameters<typeof real.createRoot>) => { const root = real.createRoot(...args); roots.push(root); return root; } };
});

const SIGNED_IN: AccountAnswer = { account: { fingerprint: 'account-a', email: 'someone@example.com' }, problem: null, photosTabOpen: true };
const NO_TAB: AccountAnswer = { account: null, problem: 'No Google Photos tab is open.', photosTabOpen: false };

let account: AccountAnswer;
/** What the pages asked the background page, in order. */
let sent: { kind: string; [key: string]: unknown }[];
let eraseAnswer: { ok?: true; error?: string };
let errors: MockInstance;

/** Chrome's side of the extension: the background page answers who is signed in, and previews. */
function pretendExtension() {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (request: { kind: string; op?: string }) => {
        sent.push(request);
        if (request.kind === 'app-account') return account;
        if (request.kind === 'app-erase-all') return eraseAnswer;
        if (request.kind === 'app-run-op' && request.op === 'fetchPreview') return { ok: true, data: { contentType: 'image/jpeg', base64: 'AAAA' } };
        return undefined;
      },
      getURL: (path: string) => `chrome-extension://photo-cleaner/${path}`,
    },
  });
}

/** What jsdom lacks; sizes and visibility answer at once, as a laid-out page would. */
function pretendLayout() {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target, contentRect: { width: 1000, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() }) as unknown as Animation;
  Element.prototype.scrollIntoView = () => {};
  // Newer Chrome returns a Promise here; an effect that passed it on to React blanked the review tab.
  window.scrollTo = (() => Promise.resolve()) as unknown as typeof window.scrollTo;
}

/** Account A: six photos scanned and analysed. Photos 0–2 are a burst; photo 0 is a favourite. */
async function scannedAndAnalysed(factory: IDBFactory) {
  const source = new FakePhotos(Array.from({ length: 6 }, (_, i) => fakeItem(i, { isFavourite: i === 0 })));
  await scan(source, new IndexedDbInventoryStore(factory));
  const analysis = new IndexedDbAnalysisStore(factory);
  await analysis.saveSettings({ account: 'account-a', detail: 140, modelKey: modelKey(140), measuredPhotosPerSecond: 5, chosenAtMs: NOW });
  for (const [i, degrees] of [0, 2, 4, 60, 120, 180].entries()) {
    const vector = Float32Array.from([Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]);
    const quality = { sharpness: 100 + i, brightness: 128, clippedDark: 0, clippedBright: 0, width: 256, height: 256 };
    await analysis.saveEmbedding({ modelKey: modelKey(140), mediaKey: `lib-${i}`, account: 'account-a', vector, quality, createdAtMs: NOW });
  }
  const jobs = new IndexedDbJobStore(factory);
  const scanned = reportProgress(startScanJob('account-a', NOW), { ...NO_PROGRESS, phase: null, libraryEntries: 6 }, NOW);
  await jobs.update(jobId('library-scan', 'account-a'), () => endJob(scanned, 'completed', null, NOW));
  const analysed = reportProgress(startAnalysisJob('account-a', NOW, null, NO_ANALYSIS), { ...NO_ANALYSIS, stage: 'analysing', photos: 6, analysed: 6, detail: 140 }, NOW);
  await jobs.update(jobId('analysis', 'account-a'), () => endJob(analysed, 'completed', null, NOW));
}

/** Opens a page as Chrome would: its HTML's root element, then its script. */
async function open(page: 'popup' | 'panel' | 'review', query = '') {
  window.history.replaceState(null, '', `/${page}.html${query}`);
  document.body.innerHTML = '<div id="root"></div>';
  await import(`../../src/app/${page}/main.tsx`);
  return document.getElementById('root')!;
}

const shows = (root: HTMLElement, ...texts: string[]) => vi.waitFor(() => { for (const t of texts) expect(root.textContent).toContain(t); }, { timeout: 3_000 });

/** Clicks the button whose text starts with [label], once it is on screen. */
async function click(root: HTMLElement, label: string) {
  const button = await vi.waitFor(() => {
    const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label));
    if (!found) throw new Error(`No button "${label}" in: ${root.textContent}`);
    return found;
  }, { timeout: 3_000 });
  button.click();
}

/** A key pressed and let go, as the keyboard sends it (to the page, or to [target] such as a text field). */
function press(key: string, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

const requests = (kind: string) => sent.filter((r) => r.kind === kind);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('indexedDB', new IDBFactory()); // each test its own saved data
  account = SIGNED_IN;
  sent = [];
  eraseAnswer = { ok: true };
  pretendExtension();
  pretendLayout();
  localStorage.clear();
  errors = vi.spyOn(console, 'error');
});

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  expect(errors.mock.calls).toEqual([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the pages draw', () => {
  it('popup: the account, its Scan and the buttons', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('popup');
    await shows(root, 'Photo Cleaner', 'someone@example.com', 'Open in tab', 'Erase Photo Cleaner');
  });

  it('popup without a Google Photos tab says so', async () => {
    account = NO_TAB;
    const root = await open('popup');
    await shows(root, 'Photo Cleaner works inside Google Photos', 'Open Google Photos');
  });

  it('panel: the account and its Scan', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('panel');
    await shows(root, 'Photo Cleaner', 'someone@example.com', 'Reads the list of your photos', 'Open in tab');
  });

  it('panel before any scan offers to scan', async () => {
    const root = await open('panel');
    await shows(root, 'Scan library');
  });

  it('review tab: Scan, then Duplicates with the burst, then Search with its photos as examples', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('review', '?account=account-a');
    await shows(root, 'Photo Cleaner', 'Account:', 'someone@example.com', 'Never trash photos that are', 'Erase Photo Cleaner');

    await click(root, '2 · Duplicates');
    await vi.waitFor(() => expect(root.querySelectorAll('.duplicates:not([hidden]) .tiles > *')).toHaveLength(3), { timeout: 3_000 });
    await shows(root, 'D · Trash selected');

    await click(root, 'Search more like these');
    await vi.waitFor(() => expect(root.querySelectorAll('.search-grid > *').length).toBeGreaterThan(0), { timeout: 3_000 });
    await shows(root, 'More like:');

    await click(root, '1 · Scan');
    await shows(root, 'Never trash photos that are');
  });

  it('review tab before any scan: every tab says what to do first', async () => {
    const root = await open('review', '?account=account-a');
    await shows(root, 'Scan library');
    await click(root, '2 · Duplicates');
    await shows(root, 'Open Scan');
    await click(root, 'Search');
    await shows(root, 'Open Scan');
  });

  it('after the data was erased the review tab says so', async () => {
    const root = await open('review', '?erased=1');
    await shows(root, 'erased');
  });
});

// --- clicks and keys ---

const dupTiles = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.duplicates:not([hidden]) .tiles > figure')];
const labels = (root: HTMLElement) => dupTiles(root).map((t) => t.querySelector('figcaption strong')!.textContent);
const focusedTile = (tiles: HTMLElement[]) => tiles.findIndex((t) => t.classList.contains('focused'));
const searchTiles = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.search:not([hidden]) .search-grid > figure')];
const selectedCount = (root: HTMLElement) => searchTiles(root).filter((t) => t.classList.contains('selected')).length;
const examples = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('.search:not([hidden]) .examples')].find((e) => e.textContent?.startsWith(label))?.querySelectorAll('.example').length ?? 0;
const decisions = () => new IndexedDbReviewStore(indexedDB).activeDecisions('account-a');

/** The review tab on Duplicates, showing the burst: the favourite keeper, then photos 1 and 2 proposed. */
async function duplicatesShown() {
  await scannedAndAnalysed(indexedDB);
  const root = await open('review', '?account=account-a');
  await click(root, '2 · Duplicates');
  await vi.waitFor(() => expect(labels(root)).toEqual(['KEEP · protected (favourite)', 'TRASH', 'TRASH']), { timeout: 3_000 });
  return root;
}

describe('clicks and keys reach what they should', () => {
  it('Duplicates: arrows move the focus; Space and a click toggle a photo; Enter, arrows and Esc work the viewer', async () => {
    const root = await duplicatesShown();
    await vi.waitFor(() => expect(focusedTile(dupTiles(root))).toBe(0));
    await shows(root, '2 of 3 photos selected for the trash');

    press('ArrowRight');
    await vi.waitFor(() => expect(focusedTile(dupTiles(root))).toBe(1));
    press(' ');
    await vi.waitFor(() => expect(labels(root)).toEqual(['KEEP · protected (favourite)', 'KEEP (your choice)', 'TRASH']));
    await shows(root, '1 of 3 photos selected for the trash');
    dupTiles(root)[1]!.querySelector<HTMLElement>('.tile-image')!.click();
    await vi.waitFor(() => expect(labels(root)).toEqual(['KEEP · protected (favourite)', 'TRASH', 'TRASH']));

    press('Enter');
    await shows(root, '2 of 3 · Proposed for the trash', 'Selected for the trash');
    press('ArrowRight');
    await shows(root, '3 of 3 · Proposed for the trash');
    press(' ');
    await shows(root, 'Kept (not selected)');
    press('Escape');
    await vi.waitFor(() => expect(root.querySelector('.viewer')).toBeNull());
    expect(labels(root)).toEqual(['KEEP · protected (favourite)', 'TRASH', 'KEEP (your choice)']);
    expect(await decisions()).toEqual([]); // looking and choosing decide nothing
  });

  it('Duplicates: D trashes the selection (the trash queue sends it), Z undoes (and it comes back out)', async () => {
    const root = await duplicatesShown();
    const trash = new SimulatedTrash(indexedDB);
    press('ArrowRight');
    press('ArrowRight');
    press(' '); // photo 2 kept: only photo 1 goes
    await shows(root, '1 of 3 photos selected for the trash');

    press('d');
    await vi.waitFor(() => expect(dupTiles(root)).toHaveLength(0));
    expect(await decisions()).toMatchObject([{ kind: 'APPROVED', items: [{ mediaKey: 'lib-1' }] }]);
    await vi.waitFor(async () => expect(await trash.inTrash('account-a', ['dedup-1', 'dedup-2'])).toEqual(new Map([['dedup-1', true], ['dedup-2', false]])), { timeout: 6_000 });

    press('z');
    await vi.waitFor(() => expect(dupTiles(root)).toHaveLength(3));
    expect(await decisions()).toEqual([]);
    await vi.waitFor(async () => expect((await trash.inTrash('account-a', ['dedup-1'])).get('dedup-1')).toBe(false), { timeout: 6_000 });
  }, 20_000);

  it('Duplicates: F keeps all, the S · Skip button skips, the Z · Undo button undoes', async () => {
    const root = await duplicatesShown();
    press('f');
    await vi.waitFor(async () => expect(await decisions()).toMatchObject([{ kind: 'KEPT' }]));
    await click(root, 'Z · Undo');
    await vi.waitFor(async () => expect(await decisions()).toEqual([]));
    await vi.waitFor(() => expect(dupTiles(root)).toHaveLength(3));
    await click(root, 'S · Skip');
    await vi.waitFor(async () => expect(await decisions()).toMatchObject([{ kind: 'DEFERRED' }]));
  });

  it('Search: click and Shift-click select; D asks, Esc cancels, Enter queues; typing in the field is left alone', async () => {
    const root = await duplicatesShown();
    await click(root, 'Search more like these');
    await vi.waitFor(() => expect(searchTiles(root).length).toBeGreaterThanOrEqual(3), { timeout: 3_000 });
    expect(examples(root, 'More like:')).toBe(3);

    searchTiles(root)[0]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    await vi.waitFor(() => expect(selectedCount(root)).toBe(1));
    searchTiles(root)[2]!.querySelector<HTMLElement>('.search-tile-image')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await vi.waitFor(() => expect(selectedCount(root)).toBe(3));

    press('d', root.querySelector('input[type="search"]')!);
    // A later change drawn on screen means the key press above was handled by then.
    searchTiles(root)[2]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    await vi.waitFor(() => expect(selectedCount(root)).toBe(2));
    expect(root.textContent).not.toContain('to the trash?');
    searchTiles(root)[2]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    await vi.waitFor(() => expect(selectedCount(root)).toBe(3));

    press('d');
    await shows(root, 'Move 3 photos to the trash?');
    press('Escape');
    await vi.waitFor(() => expect(root.textContent).not.toContain('to the trash?'));
    expect(await decisions()).toEqual([]);

    press('d');
    await shows(root, 'Move 3 photos to the trash?');
    press('Enter');
    await vi.waitFor(async () => expect(await decisions()).toMatchObject([{ kind: 'APPROVED', groupId: expect.stringMatching(/^sweep:/) }]));
    expect((await decisions())[0]!.items).toHaveLength(3);
    await shows(root, 'already in the trash queue hidden');
  });

  it('Search: L adds a less-like example, its × removes it, Start over clears everything', async () => {
    const root = await duplicatesShown();
    await click(root, 'Search more like these');
    await vi.waitFor(() => expect(searchTiles(root).length).toBeGreaterThanOrEqual(3), { timeout: 3_000 });
    searchTiles(root).at(-1)!.querySelector<HTMLElement>('.search-tile-image')!.click();
    press('l');
    await vi.waitFor(() => expect(examples(root, 'Less like:')).toBe(1));

    const lessRow = [...root.querySelectorAll('.search:not([hidden]) .examples')].find((e) => e.textContent?.startsWith('Less like:'))!;
    lessRow.querySelector<HTMLElement>('.remove')!.click();
    await vi.waitFor(() => expect(examples(root, 'Less like:')).toBe(0));
    expect(examples(root, 'More like:')).toBe(3);

    await click(root, 'Start over');
    await vi.waitFor(() => expect(searchTiles(root)).toHaveLength(0));
    expect(examples(root, 'More like:')).toBe(0);
  });

  it("Scan tab: Trash for real is off until ticked; then Search's question says the photos really go to the trash", async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('review', '?account=account-a');
    const real = await vi.waitFor(() => {
      const box = root.querySelector<HTMLInputElement>('.trash-mode-card input[type="checkbox"]');
      if (!box) throw new Error('no Trash for real switch yet');
      return box;
    }, { timeout: 3_000 });
    expect(real.checked).toBe(false);
    real.click();
    await vi.waitFor(async () => expect(await new IndexedDbPreferences(indexedDB).trashForReal('account-a')).toBe(true));

    await click(root, '2 · Duplicates');
    await vi.waitFor(() => expect(dupTiles(root)).toHaveLength(3), { timeout: 3_000 });
    await click(root, 'Search more like these');
    await vi.waitFor(() => expect(searchTiles(root).length).toBeGreaterThan(0), { timeout: 3_000 });
    searchTiles(root)[0]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    press('d');
    await shows(root, "They go to Google Photos' trash, where they stay for 60 days.");
    expect(root.textContent).not.toContain('Simulated');
  }, 15_000);

  it('Scan tab: the protection checkboxes are saved and change the counts; the Scan button starts a scan', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('review', '?account=account-a');
    await shows(root, 'Eligible5');
    const favourites = root.querySelector<HTMLInputElement>('.protection-card input[type="checkbox"]')!;
    expect(favourites.checked).toBe(true);

    favourites.click();
    await shows(root, 'Eligible6');
    expect(await new IndexedDbPreferences(indexedDB).protection('account-a')).toEqual({ favourites: false, albums: true, archived: true });
    favourites.click();
    await shows(root, 'Eligible5');

    await click(root, 'Check for new photos');
    await vi.waitFor(() => expect(requests('app-wake-engine')).toHaveLength(1));
    expect((await new IndexedDbJobStore(indexedDB).get(jobId('library-scan', 'account-a')))!.status).toBe('running');
  });

  it('the review tab comes back on the tab it was left on', async () => {
    await duplicatesShown();
    for (const root of roots.splice(0)) root.unmount();
    vi.resetModules();
    const again = await open('review', '?account=account-a');
    await vi.waitFor(() => expect(labels(again)).toHaveLength(3), { timeout: 3_000 });
  });

  it('popup: its buttons ask the background page for the right thing', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('popup');
    await shows(root, 'Open in tab');
    await click(root, 'Open in tab');
    await click(root, 'Show panel in Google Photos');
    expect(requests('app-open-review')).toEqual([{ kind: 'app-open-review', account: 'account-a' }]);
    expect(requests('app-show-panel')).toHaveLength(1);
  });

  it('popup: with groups waiting it offers to review them, opening the review tab', async () => {
    await scannedAndAnalysed(indexedDB);
    await new IndexedDbReviewStore(indexedDB).saveSummary({ account: 'account-a', groupsToReview: 1_731, atMs: NOW + 1, protection: ALL_PROTECTED });
    const root = await open('popup');
    await click(root, 'Review 1,731 groups');
    expect(requests('app-open-review')).toEqual([{ kind: 'app-open-review', account: 'account-a' }]);
  });

  it('popup without Google Photos: Open Google Photos asks for it', async () => {
    account = NO_TAB;
    const root = await open('popup');
    await shows(root, 'Open Google Photos');
    await click(root, 'Open Google Photos');
    expect(requests('app-open-photos')).toHaveLength(1);
  });

  it('panel: Open in tab asks for the review tab', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('panel');
    await shows(root, 'Open in tab');
    await click(root, 'Open in tab');
    expect(requests('app-open-review')).toEqual([{ kind: 'app-open-review', account: 'account-a' }]);
  });

  it('erase takes two clicks; Cancel goes back; a failure is shown and can be tried again', async () => {
    const root = await open('popup');
    await click(root, "Erase Photo Cleaner's data");
    await shows(root, 'Your photos in Google Photos are not touched', 'Confirm to erase');
    expect(requests('app-erase-all')).toEqual([]);
    await click(root, 'Cancel');
    await vi.waitFor(() => expect(root.textContent).not.toContain('Confirm to erase'));

    eraseAnswer = { error: 'Another Photo Cleaner page is still holding the saved data.' };
    await click(root, "Erase Photo Cleaner's data");
    await shows(root, 'Confirm to erase');
    await click(root, 'Confirm to erase');
    await shows(root, 'Another Photo Cleaner page is still holding the saved data.', 'Confirm to erase');

    eraseAnswer = { ok: true };
    await click(root, 'Confirm to erase');
    await vi.waitFor(() => expect(requests('app-erase-all')).toHaveLength(2));
    await shows(root, 'Erasing…'); // the background page then makes every page start over
  });
});
