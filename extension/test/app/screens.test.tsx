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
import { IndexedDbUsageStore } from '../../src/app/shared/usageStore';
import { UsageSender } from '../../src/app/shared/usageSender';
import { eraseAllData } from '../../src/app/shared/erase';
import { IndexedDbAnalysisStore } from '../../src/app/ai/analysisStore';
import { modelKey } from '../../src/app/ai/model';
import { IndexedDbReviewStore } from '../../src/app/duplicates/reviewStore';
import { IndexedDbInventoryStore } from '../../src/app/scan/inventoryStore';
import { endJob, jobId, NO_PROGRESS, reportProgress, startAnalysisJob, startScanJob } from '../../src/app/shared/job';
import type { AccountAnswer } from '../../src/app/shared/messages';
import { ALL_PROTECTED, IndexedDbPreferences } from '../../src/app/shared/preferences';
import { IndexedDbProblemLog } from '../../src/app/shared/problemLog';
import { IndexedDbJobStore } from '../../src/app/shared/store';
import type { PageOp } from '../../src/shared/protocol';
import { fakeAlbum, fakeDedupKey, fakeItem, FakeGoogle, FakePhotos, NOW, scan } from './fakes';

/** Every root a page creates, so each test can take its page down again. */
const roots = vi.hoisted(() => [] as Root[]);
vi.mock('react-dom/client', async (original) => {
  const real = await original<typeof import('react-dom/client')>();
  return { ...real, createRoot: (...args: Parameters<typeof real.createRoot>) => { const root = real.createRoot(...args); roots.push(root); return root; } };
});

/** The Google Photos tab: the panel's, and the one signed in. */
const PHOTOS_TAB = 42;
const SIGNED_IN: AccountAnswer = { account: { fingerprint: 'account-a', email: 'someone@example.com' }, problem: null, photosTabOpen: true, tabId: PHOTOS_TAB };
const NO_TAB: AccountAnswer = { account: null, problem: 'No Google Photos tab is open.', photosTabOpen: false, tabId: null };

/** The background's answer to which account is signed in: as it is, or one at a time, when each is asked. */
let account: AccountAnswer | { error: string } | (() => Promise<AccountAnswer>);
/** What the pages asked the background page, in order. */
let sent: { kind: string; [key: string]: unknown }[];
let eraseAnswer: { ok?: true; error?: string };
/** What the pages asked of Chrome's side panel, in order. */
let sidePanelCalls: [string, unknown][];
/** Google Photos' trash. */
let google: FakeGoogle;
let errors: MockInstance;

/** Chrome's side of the extension: the background page answers who is signed in, previews, and Google Photos' trash. */
function pretendExtension() {
  const usage = new UsageSender(new IndexedDbUsageStore(indexedDB), null);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (request: { kind: string; op?: PageOp; account?: string; params?: Record<string, unknown>; answer?: 'yes' | 'no' }) => {
        sent.push(request);
        if (request.kind === 'app-usage-consent') {
          await usage.consent(request.answer!);
          return { ok: true };
        }
        if (request.kind === 'app-account') return typeof account === 'function' ? account() : account;
        if (request.kind === 'app-erase-all') return eraseAnswer;
        if (request.kind === 'app-open-photos') return { tabId: PHOTOS_TAB };
        if (request.kind === 'app-run-op' && request.op === 'fetchPreview') return { ok: true, data: { contentType: 'image/jpeg', base64: 'AAAA' } };
        if (request.kind === 'app-run-op' && (request.op === 'listTrashPage' || request.op === 'moveToTrash' || request.op === 'restoreFromTrash')) {
          return google.run(request.account!, request.op, request.params ?? {});
        }
        return undefined;
      },
      getURL: (path: string) => `chrome-extension://photo-cleaner/${path}`,
      getManifest: () => ({ version: '1.2.3' }),
    },
    sidePanel: {
      setOptions: async (options: unknown) => { sidePanelCalls.push(['setOptions', options]); },
      open: async (options: unknown) => { sidePanelCalls.push(['open', options]); },
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

/** Account A: six photos scanned and analysed, and [notAnalysed] more only scanned. Photos 0–2 are a burst; photo 0 is a favourite. */
async function scannedAndAnalysed(factory: IDBFactory, notAnalysed = 0) {
  const source = new FakePhotos(Array.from({ length: 6 + notAnalysed }, (_, i) => fakeItem(i, { isFavourite: i === 0 })));
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

/** Opens a page as Chrome would: its HTML's root element, then its script. The panel is the Photos tab's. */
async function open(page: 'popup' | 'panel' | 'review', query = page === 'panel' ? `?tab=${PHOTOS_TAB}` : '') {
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

/** Open Google Photos was clicked: the background found or opened the Photos tab, then the page opened its panel and asked for the tab to come forward. */
async function photosOpenedWithPanel() {
  await vi.waitFor(() => expect(requests('app-show-panel')).toEqual([{ kind: 'app-show-panel', tabId: PHOTOS_TAB }]));
  expect(requests('app-open-photos')).toHaveLength(1);
  expect(sidePanelCalls).toEqual([
    ['setOptions', { tabId: PHOTOS_TAB, path: `panel.html?tab=${PHOTOS_TAB}`, enabled: true }],
    ['open', { tabId: PHOTOS_TAB }],
  ]);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('indexedDB', new IDBFactory()); // each test its own saved data
  account = SIGNED_IN;
  sent = [];
  eraseAnswer = { ok: true };
  sidePanelCalls = [];
  google = new FakeGoogle();
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
  it('launch tracking distinguishes the popup, a successful Chrome request, and a destination that actually renders', async () => {
    const { bindUsageEmitter } = await import('../../src/app/shared/usageClient');
    const events: import('../../src/app/shared/usage').UsageEvent[] = [];
    bindUsageEmitter((event) => { events.push(event); });
    const popup = await open('popup');
    await shows(popup, 'Open panel in Google Photos');
    await click(popup, 'Open panel in Google Photos');
    await vi.waitFor(() => expect(events).toContainEqual({ name: 'surface_open_result', params: { source_surface: 'popup', target_surface: 'panel', result: 'accepted' } }));
    expect(events).toContainEqual({ name: 'surface_view', params: { surface: 'popup' } });
    expect(events.some((event) => event.name === 'surface_ready')).toBe(false);
    for (const mounted of roots.splice(0)) mounted.unmount();
    const panel = await open('panel');
    await shows(panel, 'Photo Cleaner');
    await vi.waitFor(() => expect(events).toContainEqual({ name: 'surface_ready', params: { surface: 'panel' } }));
  });

  for (const page of ['popup', 'panel', 'review'] as const) {
    it(`${page}: asks for usage consent before a scan, remembers refusal and can be enabled or disabled`, async () => {
      account = NO_TAB;
      const root = await open(page);
      await shows(root, 'Help improve Photo Cleaner?', 'Reporting is not configured');
      await click(root, 'No thanks');
      await shows(root, 'Send optional usage statistics');
      expect(root.textContent).not.toContain('Help improve Photo Cleaner?');
      expect((await new IndexedDbUsageStore(indexedDB).get()).answer).toBe('no');
      const toggle = root.querySelector<HTMLInputElement>('.usage-card input')!;
      toggle.click();
      await vi.waitFor(() => expect(toggle.checked).toBe(true));
      expect((await new IndexedDbUsageStore(indexedDB).get()).answer).toBe('yes');
      toggle.click();
      await vi.waitFor(() => expect(toggle.checked).toBe(false));
      expect((await new IndexedDbUsageStore(indexedDB).get()).clientId).toBeNull();
    });
  }

  it('popup: allowing usage is saved; reopening remembers it; erase brings back the question', async () => {
    const root = await open('popup');
    await click(root, 'Allow usage statistics');
    await shows(root, 'Send optional usage statistics');
    expect(root.querySelector<HTMLInputElement>('.usage-card input')!.checked).toBe(true);
    for (const mounted of roots.splice(0)) mounted.unmount();
    vi.resetModules();
    const reopened = await open('panel');
    await shows(reopened, 'Send optional usage statistics');
    expect(reopened.querySelector<HTMLInputElement>('.usage-card input')!.checked).toBe(true);
    for (const mounted of roots.splice(0)) mounted.unmount();
    await eraseAllData(indexedDB, { keys: async () => [] } as unknown as CacheStorage);
    vi.resetModules();
    await shows(await open('popup'), 'Help improve Photo Cleaner?');
  });

  it('popup: the account, its Scan and the buttons', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('popup');
    await shows(root, 'Photo Cleaner', 'someone@example.com', 'Open in tab');
    // Erasing lives in the review tab; the popup stays short.
    expect(root.textContent).not.toContain('Erase Photo Cleaner');
  });

  it('popup without a Google Photos tab says so', async () => {
    account = NO_TAB;
    const root = await open('popup');
    await shows(root, 'Photo Cleaner works inside Google Photos', 'Open Google Photos');
  });

  it('panel: the account and its Scan', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('panel');
    await shows(root, 'Photo Cleaner', 'someone@example.com', 'Photos never leave your computer', 'Open in tab');
    expect(root.textContent).not.toContain('Reads the list of your photos');
  });

  it('panel before any scan offers to scan', async () => {
    const root = await open('panel');
    await shows(root, 'Scan library');
  });

  it('review tab: Scan, then Duplicates with the burst, then Search with its photos as examples', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('review', '?account=account-a');
    await shows(root, 'Photo Cleaner', 'someone@example.com', 'Never trash photos that are', 'Erase Photo Cleaner');
    expect(root.querySelector('h1')?.textContent).toBe('Photo Cleaner');
    expect(root.querySelector('.title-line .version')?.textContent).toBe('v1.2.3');

    await click(root, '2 · Duplicates');
    await vi.waitFor(() => expect(root.querySelectorAll('.duplicates:not([hidden]) .tiles > *')).toHaveLength(3), { timeout: 3_000 });
    await shows(root, 'D · Trash selected');

    await click(root, 'Search more like these');
    await vi.waitFor(() => expect(root.querySelectorAll('.search-grid > *').length).toBeGreaterThan(0), { timeout: 3_000 });
    await shows(root, 'More like:');

    await click(root, '1 · Scan');
    await shows(root, 'Never trash photos that are');
  });

  it('review tab: Duplicates says how many photos are not analysed yet', async () => {
    await scannedAndAnalysed(indexedDB, 2);
    const root = await open('review', '?account=account-a');
    await click(root, '2 · Duplicates');
    await shows(root, '2 photos are not analysed yet', 'D · Trash selected');
  });

  it('review tab before any scan: every tab says what to do first', async () => {
    const root = await open('review', '?account=account-a');
    await shows(root, 'Scan library');
    await click(root, '2 · Duplicates');
    await shows(root, 'Open Scan');
    await click(root, 'Search');
    await shows(root, 'Open Scan');
  });

  it('after the data was erased the review tab says so, and offers erasing even with no account signed in', async () => {
    account = NO_TAB;
    const root = await open('review', '?erased=1');
    await shows(root, 'erased', 'No account yet', 'Erase Photo Cleaner');
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

async function searchShown() {
  const root = await duplicatesShown();
  await click(root, 'Search more like these');
  await vi.waitFor(() => expect(searchTiles(root).length).toBeGreaterThanOrEqual(3), { timeout: 3_000 });
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
    const turn = () => root.querySelector<HTMLElement>('.viewer-photo img')!.style.transform;
    press('r');
    await vi.waitFor(() => expect(turn()).toBe('rotate(90deg)'));
    await shows(root, 'Turned for viewing only');
    await click(root, '↺ Rotate left');
    await vi.waitFor(() => expect(turn()).toBe('rotate(0deg)'));
    await click(root, 'R · Rotate right');
    await vi.waitFor(() => expect(turn()).toBe('rotate(90deg)'));
    press('Escape');
    await vi.waitFor(() => expect(root.querySelector('.viewer')).toBeNull());
    expect(labels(root)).toEqual(['KEEP · protected (favourite)', 'TRASH', 'KEEP (your choice)']);
    expect(await decisions()).toEqual([]); // looking and choosing decide nothing
  });

  it('Duplicates: D trashes the selection (the trash queue sends it), Z undoes (and it comes back out)', async () => {
    const root = await duplicatesShown();
    press('ArrowRight');
    press('ArrowRight');
    press(' '); // photo 2 kept: only photo 1 goes
    await shows(root, '1 of 3 photos selected for the trash');

    press('d');
    await vi.waitFor(() => expect(dupTiles(root)).toHaveLength(0));
    expect(await decisions()).toMatchObject([{ kind: 'APPROVED', items: [{ mediaKey: 'lib-1' }] }]);
    await vi.waitFor(() => expect([...google.trash]).toEqual([fakeDedupKey(1)]), { timeout: 6_000 });

    press('z');
    await vi.waitFor(() => expect(dupTiles(root)).toHaveLength(3));
    expect(await decisions()).toEqual([]);
    await vi.waitFor(() => expect(google.trash.size).toBe(0), { timeout: 6_000 });
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
    press('ArrowRight'); // the arrows move a single selection
    await vi.waitFor(() => expect(selectedCount(root)).toBe(1));
    press('a');
    await vi.waitFor(() => expect(selectedCount(root)).toBe(searchTiles(root).length));
    searchTiles(root)[0]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    searchTiles(root)[2]!.querySelector<HTMLElement>('.search-tile-image')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await vi.waitFor(() => expect(selectedCount(root)).toBe(3));

    press('d', root.querySelector('input[type="search"]')!);
    // A later change drawn on screen means the key press above was handled by then.
    searchTiles(root)[2]!.querySelector<HTMLElement>('.search-tile-image')!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await vi.waitFor(() => expect(selectedCount(root)).toBe(2));
    expect(searchTiles(root)[2]!.className).toBe('search-tile'); // unselected by Ctrl-click: nothing marks it
    expect(root.textContent).not.toContain('to the trash?');
    searchTiles(root)[2]!.querySelector<HTMLElement>('.search-tile-image')!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
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

    // Back on Duplicates, the burst's photos are in the trash queue: its group is gone.
    await click(root, '2 · Duplicates');
    await vi.waitFor(() => expect(dupTiles(root)).toHaveLength(0), { timeout: 3_000 });
  });

  it('Search: M keeps the selected photos selected as they become examples', async () => {
    const root = await duplicatesShown();
    await click(root, 'Search more like these');
    await vi.waitFor(() => expect(searchTiles(root).length).toBeGreaterThanOrEqual(3), { timeout: 3_000 });
    searchTiles(root)[0]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    await vi.waitFor(() => expect(selectedCount(root)).toBe(1));
    const before = root.querySelectorAll('.search .examples').length;
    press('m');
    await shows(root, '1 selected');
    expect(root.querySelectorAll('.search .examples').length).toBe(before);
    expect(selectedCount(root)).toBe(1);
  });

  it('Search: clicks select one, Ctrl/Cmd-click toggles individuals, and Shift-click selects a range without trash decisions', async () => {
    const root = await searchShown();
    const image = (index: number) => searchTiles(root)[index]!.querySelector<HTMLElement>('.search-tile-image')!;
    image(0).click();
    await vi.waitFor(() => expect(selectedCount(root)).toBe(1));
    image(0).click();
    image(1).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await vi.waitFor(() => expect(selectedCount(root)).toBe(2));
    image(0).dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    await vi.waitFor(() => expect(selectedCount(root)).toBe(1));
    expect(searchTiles(root)[1]!.classList.contains('selected')).toBe(true);
    image(2).click();
    await vi.waitFor(() => expect(searchTiles(root)[2]!.classList.contains('selected')).toBe(true));
    expect(selectedCount(root)).toBe(1);
    image(0).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await vi.waitFor(() => expect(selectedCount(root)).toBe(3));
    expect(root.querySelector('.search [role="alertdialog"]')).toBeNull();
    expect(await decisions()).toEqual([]);
  });

  it('Search: the Hide button and H confirm multiple selections; Cancel keeps them, Enter hides them without trashing', async () => {
    const root = await searchShown();
    const before = searchTiles(root).length;
    searchTiles(root)[0]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    searchTiles(root)[1]!.querySelector<HTMLElement>('.search-tile-image')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await vi.waitFor(() => expect(selectedCount(root)).toBe(2));
    press('h', root.querySelector('input[type="search"]')!);
    press('Delete');
    await click(root, 'Oldest');
    await vi.waitFor(() => expect(root.querySelector('.search button[aria-pressed="true"]')!.textContent).toBe('Oldest'));
    expect(root.querySelector('.search [role="alertdialog"]')).toBeNull();
    expect(searchTiles(root)).toHaveLength(before);
    await click(root, 'H · Hide from results');
    await shows(root, 'Hide 2 selected photos from these results?', 'Nothing will be trashed.');
    expect(root.querySelector('.search [role="alertdialog"]')!.getAttribute('aria-label')).toBe('Hide from results?');
    expect(searchTiles(root)).toHaveLength(before);
    await click(root, 'Esc · Cancel');
    await vi.waitFor(() => expect(root.querySelector('.search [role="alertdialog"]')).toBeNull());
    press('H');
    await shows(root, 'Hide 2 selected photos from these results?');
    press('Enter');
    await vi.waitFor(() => expect(searchTiles(root)).toHaveLength(before - 2));
    expect(selectedCount(root)).toBe(0);
    expect(root.querySelector('.search [role="alertdialog"]')).toBeNull();
    expect(await decisions()).toEqual([]);
    expect(google.trash.size).toBe(0);
  });

  it('Search: the × hides just its result immediately, keeping other selections; H hides a single selection immediately', async () => {
    const root = await searchShown();
    const before = searchTiles(root).length;
    const selected = searchTiles(root)[0]!;
    selected.querySelector<HTMLElement>('.search-tile-image')!.click();
    await vi.waitFor(() => expect(selectedCount(root)).toBe(1));
    let scrollY = 600;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {
      scrollY = 0;
    });
    searchTiles(root)[1]!.querySelector<HTMLButtonElement>('[aria-label="Hide this result"]')!.click();
    await vi.waitFor(() => expect(searchTiles(root)).toHaveLength(before - 1));
    expect(window.scrollY).toBe(600);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(selected.classList.contains('selected')).toBe(true);
    expect(selectedCount(root)).toBe(1);
    expect(root.querySelector('.search [role="alertdialog"]')).toBeNull();
    expect(root.querySelector('.viewer')).toBeNull();
    press('h');
    await vi.waitFor(() => expect(searchTiles(root)).toHaveLength(before - 2));
    expect(selectedCount(root)).toBe(0);
    expect(root.querySelector('.search [role="alertdialog"]')).toBeNull();
    expect(await decisions()).toEqual([]);
    expect(google.trash.size).toBe(0);
  });

  it('Search: H works in the viewer, and hiding all results asks first and closes it safely', async () => {
    const root = await searchShown();
    const before = searchTiles(root).length;
    searchTiles(root)[0]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    await vi.waitFor(() => expect(selectedCount(root)).toBe(1));
    press('Enter');
    await shows(root, 'Toggle selection');
    expect(root.querySelector('.viewer-info strong')!.textContent).toBe('Selected');
    press('h');
    await vi.waitFor(() => expect(searchTiles(root)).toHaveLength(before - 1));
    expect(root.querySelector('.viewer')).not.toBeNull();
    press('Escape');
    await vi.waitFor(() => expect(root.querySelector('.viewer')).toBeNull());
    await click(root, 'A · Select all');
    await vi.waitFor(() => expect(selectedCount(root)).toBe(before - 1));
    press('Enter');
    await vi.waitFor(() => expect(root.querySelector('.viewer')).not.toBeNull());
    press('h');
    await vi.waitFor(() => expect(root.querySelector('.viewer')).toBeNull());
    await shows(root, `Hide ${before - 1} selected photos from these results?`);
    press('Escape');
    await vi.waitFor(() => expect(root.querySelector('.search [role="alertdialog"]')).toBeNull());
    press('h');
    await shows(root, `Hide ${before - 1} selected photos from these results?`);
    await click(root, 'Enter · Hide from results');
    await vi.waitFor(() => expect(searchTiles(root)).toHaveLength(0));
    expect(root.querySelector('.viewer')).toBeNull();
    expect(await decisions()).toEqual([]);
    expect(google.trash.size).toBe(0);
  });

  it('Duplicates and Search: the − and + buttons and the - and + keys change the photo size, each tab its own', async () => {
    const root = await duplicatesShown();
    const size = (tab: string) => root.querySelector<HTMLElement>(`.${tab}`)!.style.getPropertyValue('--tile-px');
    const sizeButton = (tab: string, label: string) => root.querySelector<HTMLButtonElement>(`.${tab}:not([hidden]) [aria-label="${label}"]`)!;
    expect(size('duplicates')).toBe('300px');
    sizeButton('duplicates', 'Larger photos').click();
    await vi.waitFor(() => expect(size('duplicates')).toBe('400px'));
    press('+');
    await vi.waitFor(() => expect(size('duplicates')).toBe('520px'));
    press('-');
    press('-');
    press('-');
    await vi.waitFor(() => expect(size('duplicates')).toBe('200px'));
    expect(sizeButton('duplicates', 'Smaller photos').disabled).toBe(true);

    await click(root, 'Search more like these');
    await vi.waitFor(() => expect(searchTiles(root).length).toBeGreaterThanOrEqual(3), { timeout: 3_000 });
    expect(size('search')).toBe('160px');
    press('=');
    await vi.waitFor(() => expect(size('search')).toBe('220px'));
    sizeButton('search', 'Smaller photos').click();
    await vi.waitFor(() => expect(size('search')).toBe('160px'));
    expect(size('duplicates')).toBe('200px');
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

  it("Search: D asks first, saying the photos go to Google Photos' trash", async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('review', '?account=account-a');
    await click(root, '2 · Duplicates');
    await vi.waitFor(() => expect(dupTiles(root)).toHaveLength(3), { timeout: 3_000 });
    await click(root, 'Search more like these');
    await vi.waitFor(() => expect(searchTiles(root).length).toBeGreaterThan(0), { timeout: 3_000 });
    searchTiles(root)[0]!.querySelector<HTMLElement>('.search-tile-image')!.click();
    press('d');
    await shows(root, "They go to Google Photos' trash, where they stay for 60 days.");
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

  it('popup: its two buttons ask for the review tab on Scan, and open the signed-in Photos tab’s panel, bringing the tab forward', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('popup');
    await shows(root, 'Open in tab');
    expect([...root.querySelectorAll('.launch button')].map((b) => b.textContent)).toEqual(['Open in tab ↗', 'Open panel in Google Photos ↗']);
    await click(root, 'Open in tab');
    await click(root, 'Open panel in Google Photos');
    expect(requests('app-open-review')).toEqual([{ kind: 'app-open-review', account: 'account-a', tab: 'scan' }]);
    // Chrome opens a side panel only straight from a click: the popup asks Chrome itself, not the service worker.
    expect(sidePanelCalls).toEqual([
      ['setOptions', { tabId: PHOTOS_TAB, path: `panel.html?tab=${PHOTOS_TAB}`, enabled: true }],
      ['open', { tabId: PHOTOS_TAB }],
    ]);
    await vi.waitFor(() => expect(requests('app-show-panel')).toEqual([{ kind: 'app-show-panel', tabId: PHOTOS_TAB }]));
  });

  it('panel: asks which account its own Photos tab is signed in to', async () => {
    const root = await open('panel', '?tab=7');
    await shows(root, 'someone@example.com');
    expect(requests('app-account').length).toBeGreaterThan(0);
    expect(requests('app-account').every((r) => r.tabId === 7)).toBe(true);
  });

  it('popup: asks about the best Photos tab, naming none', async () => {
    const root = await open('popup');
    await shows(root, 'someone@example.com');
    expect(requests('app-account').every((r) => r.tabId === undefined)).toBe(true);
  });

  it.each(['popup', 'panel'] as const)('%s: with groups waiting its button offers to review them, opening the review tab on Duplicates', async (page) => {
    await scannedAndAnalysed(indexedDB);
    await new IndexedDbReviewStore(indexedDB).saveSummary({ account: 'account-a', groupsToReview: 1_731, atMs: NOW + 1, protection: ALL_PROTECTED });
    const root = await open(page);
    await click(root, 'Review 1,731 groups');
    expect(root.textContent).not.toContain('Open in tab');
    expect(requests('app-open-review')).toEqual([{ kind: 'app-open-review', account: 'account-a', tab: 'duplicates' }]);
  });

  it('review tab: opens on the tab asked for, and switches when asked again while open', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('review', '?account=account-a#duplicates');
    await vi.waitFor(() => expect(labels(root)).toHaveLength(3), { timeout: 3_000 });
    expect(location.hash).toBe(''); // taken out, so asking again works
    expect(location.search).toBe('?account=account-a');

    location.hash = 'scan';
    await vi.waitFor(() => expect(root.querySelector('.scan-tab')?.hasAttribute('hidden')).toBe(false));
    expect(dupTiles(root)).toHaveLength(0); // Duplicates hidden
    location.hash = 'duplicates';
    await vi.waitFor(() => expect(labels(root)).toHaveLength(3)); // the same page: its groups kept
    expect(location.hash).toBe('');
  });

  it.each([
    ['still looking', null],
    ['a sleeping tab', 'The Google Photos tab is asleep; click on it to wake it.'],
    ['a tab not responding', 'The Google Photos tab is not responding; reload it.'],
    ['a signed-out tab', 'Google Photos is signed out in this tab.'],
  ])('popup with %s says why, and offers to open Google Photos once it knows', async (_, problem) => {
    account = problem === null ? () => new Promise(() => {}) : { account: null, problem, photosTabOpen: true, tabId: PHOTOS_TAB };
    const root = await open('popup');
    if (problem === null) {
      await shows(root, 'Looking for Google Photos…');
      expect(root.querySelector('button')).toBeNull(); // over within seconds; a button would flash up on every opening
      return;
    }
    await shows(root, problem);
    await click(root, 'Open Google Photos');
    await photosOpenedWithPanel();
  });

  it.each(['popup', 'panel'] as const)('%s: when the extension fails to say which account, it says why', async (page) => {
    account = { error: 'Could not open the saved data.' };
    const root = await open(page);
    await shows(root, 'Could not open the saved data.');
    expect(root.textContent).not.toContain('Photo Cleaner works inside Google Photos');
    if (page === 'popup') await shows(root, 'Open Google Photos');
  });

  it('panel in a tab that is signed out says so', async () => {
    account = { account: null, problem: 'Google Photos is signed out in this tab.', photosTabOpen: true, tabId: PHOTOS_TAB };
    const root = await open('panel');
    await shows(root, 'Google Photos is signed out in this tab.');
  });

  it('popup: an answer that arrives late does not replace a newer one', async () => {
    const answers: ((answer: AccountAnswer) => void)[] = [];
    account = () => new Promise((resolve) => answers.push(resolve));
    const root = await open('popup');
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    window.dispatchEvent(new Event('focus')); // asks again
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1](SIGNED_IN);
    await shows(root, 'someone@example.com');
    answers[0](NO_TAB);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(root.textContent).toContain('someone@example.com');
    expect(root.textContent).not.toContain('Photo Cleaner works inside Google Photos');
  });

  it('popup without Google Photos: Open Google Photos asks for it, and opens its panel', async () => {
    account = NO_TAB;
    const root = await open('popup');
    await shows(root, 'Open Google Photos');
    await click(root, 'Open Google Photos');
    await photosOpenedWithPanel();
  });

  it('review tab: Open Google Photos asks for it, and opens its panel', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('review', '?account=account-a');
    await click(root, 'Open Google Photos');
    await photosOpenedWithPanel();
  });

  it.each(['popup', 'panel', 'review'] as const)('%s: Full speed can be chosen in stage 1 and stays checked in stage 2', async (page) => {
    const jobs = new IndexedDbJobStore(indexedDB);
    const reading = startScanJob('account-a', NOW);
    await jobs.update(reading.id, () => reading);
    const root = await open(page, page === 'review' ? '?account=account-a' : undefined);
    await shows(root, 'Read your library', 'Analyse photos', 'Full speed');
    const steps = () => [...root.querySelectorAll<HTMLElement>('.scan-step')];
    expect(steps()).toHaveLength(2);
    expect(steps()[0].getAttribute('aria-current')).toBe('step');
    expect(steps()[0].textContent).not.toContain('Full speed');
    expect(steps()[1].textContent).toContain('Up next');
    expect(steps()[1].textContent).toContain('Full speed');
    const checkbox = () => [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.closest('label')?.textContent?.includes('Full speed'))!;
    expect(checkbox().checked).toBe(false);
    checkbox().click();
    await vi.waitFor(async () => expect(await jobs.get(jobId('analysis', 'account-a'))).toMatchObject({ status: 'paused', fullSpeed: true }));
    await vi.waitFor(() => expect(checkbox().checked).toBe(true));
    expect(steps()[1].querySelector('button')).toBeNull(); // Choosing speed doesn't offer analysis before step 1 finishes.

    await jobs.update(reading.id, (job) => endJob(job!, 'completed', null, NOW));
    await jobs.update(jobId('analysis', 'account-a'), (previous) => startAnalysisJob('account-a', NOW, previous?.kind === 'analysis' ? previous : null, NO_ANALYSIS));
    await vi.waitFor(() => expect(steps()[1].getAttribute('aria-current')).toBe('step'));
    expect(steps()[0].textContent).toContain('Complete');
    expect(checkbox().checked).toBe(true);
    checkbox().click();
    await vi.waitFor(async () => expect(await jobs.get(jobId('analysis', 'account-a'))).toMatchObject({ status: 'running', fullSpeed: false }));
  });

  it.each(['popup', 'panel', 'review'] as const)('%s: the protection report stays in step 1 with the analysis detail beside its scan times, and Resume stays at the top', async (page) => {
    await scannedAndAnalysed(indexedDB);
    const jobs = new IndexedDbJobStore(indexedDB);
    await jobs.update(jobId('analysis', 'account-a'), () => reportProgress(startAnalysisJob('account-a', NOW, null, NO_ANALYSIS), {
      ...NO_ANALYSIS, stage: 'analysing', detail: 140, photos: 6, newPhotos: 6, newAnalysed: 2,
    }, NOW));
    const root = await open(page, page === 'review' ? '?account=account-a' : undefined);
    await shows(root, 'Protection details', 'Detail 140');
    const [library, analysis] = [...root.querySelectorAll<HTMLElement>('.scan-step')];
    const timesRow = () => library.querySelector('details.protection .report-times');
    expect(timesRow()?.textContent).toMatch(/^Scan started .*Detail 140$/);
    expect(analysis.querySelector('details.protection')).toBeNull();
    expect(analysis.textContent).not.toContain('Detail 140');
    expect(analysis.getAttribute('aria-current')).toBe('step');
    library.querySelector('summary')!.click();
    expect(library.querySelector('details')!.open).toBe(true);
    expect(library.querySelector('.protection-report .tables')).not.toBeNull();
    expect(library.querySelector('.protection-report .version-line')?.textContent).toBe('Photo Cleaner 1.2.3');
    expect(library.querySelector('.protection-report .report-actions button')?.textContent).toBe('Copy report');
    await click(root, 'Pause');
    await vi.waitFor(async () => expect(await jobs.get(jobId('analysis', 'account-a'))).toMatchObject({ status: 'paused' }));
    await vi.waitFor(() => expect(root.querySelector('.scan-title button')?.textContent).toBe('Resume'));
    expect(analysis.querySelector('.step-heading button')).toBeNull();
    expect(analysis.querySelector('.step-status')?.textContent).toBe('Paused');
    expect(timesRow()?.textContent).toMatch(/Detail 140$/);
    expect(analysis.textContent).not.toContain('Detail 140');
    expect(library.querySelector('details')!.open).toBe(true);
    await click(root, 'Resume');
    await vi.waitFor(async () => expect(await jobs.get(jobId('analysis', 'account-a'))).toMatchObject({ status: 'running' }));
    await vi.waitFor(() => expect(analysis.querySelector('.step-status')?.textContent).toBe('In progress'));
    expect(root.querySelector('.scan-title button')?.textContent).toBe('Pause');
    library.querySelector('summary')!.click();
    expect(library.querySelector('details')!.open).toBe(false);
  });

  it("review: after Google's answer stopped the analysis, the protection details show the details for support, and Copy report copies them", async () => {
    await scannedAndAnalysed(indexedDB);
    const jobs = new IndexedDbJobStore(indexedDB);
    const problem = { where: 'analysis: preview', kind: 'PROTOCOL' as const, message: 'Preview response is not an image', rpcCode: null, httpStatus: 200 };
    const running = reportProgress(startAnalysisJob('account-a', NOW, null, NO_ANALYSIS), {
      ...NO_ANALYSIS, stage: 'analysing', detail: 140, photos: 6, newPhotos: 6, newAnalysed: 2, googleProblem: problem,
    }, NOW);
    await jobs.update(jobId('analysis', 'account-a'), () => endJob(running, 'paused', 'Google may have changed something.', NOW));
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const root = await open('review', '?account=account-a');
      const line = 'For support: analysis: preview · PROTOCOL · Preview response is not an image · HTTP 200';
      await shows(root, 'Protection details', line);
      const [library, analysis] = [...root.querySelectorAll<HTMLElement>('.scan-step')];
      expect(library.querySelector('details.protection .support-line')?.textContent).toBe(line);
      expect(analysis.textContent).not.toContain('For support');
      library.querySelector('summary')!.click();
      await click(root, 'Copy report');
      await vi.waitFor(() => expect(library.querySelector('.report-actions button')?.textContent).toBe('Copied'));
      const copied = writeText.mock.calls[0]![0];
      expect(copied).toMatch(/^Protection coverage/);
      expect(copied.endsWith(`\nPhoto Cleaner 1.2.3\n${line}`)).toBe(true);

      // Resumed: the old details are gone.
      await click(root, 'Resume');
      await vi.waitFor(() => expect(root.textContent).not.toContain('For support'));
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  /** A scan that stopped while reading the album list, as the developer's did, with its entry in the problem log. */
  async function stoppedAtAlbums() {
    const jobs = new IndexedDbJobStore(indexedDB);
    const problem = { where: 'scan: album list', kind: 'PROTOCOL' as const, message: 'Album has 10 fields, expected 9 or 12', rpcCode: null, httpStatus: null };
    const reading = reportProgress(startScanJob('account-a', NOW), { ...NO_PROGRESS, phase: 'ALBUM_LIST', libraryEntries: 18_432, favouriteEntries: 15, googleProblem: problem }, NOW);
    await jobs.update(jobId('library-scan', 'account-a'), () => endJob(reading, 'failed', 'Photo Cleaner no longer understands Google Photos’ answers.', NOW));
    await new IndexedDbProblemLog(indexedDB).add({
      ...problem, atMs: NOW, version: '9.8.7', request: { op: 'listAlbumsPage', sent: [] }, stack: null,
      answer: { rpcId: 'Z5xsfc', at: [0, 1], answer: [[['key:44'], ['key:44', null]]], focus: ['key:44', null], envelope: null, cause: null },
    });
    return `For support: ${problem.where} · PROTOCOL · ${problem.message}`;
  }

  /** The button starting with [label] in [within], once it can be pressed. */
  const ready = (within: HTMLElement, label: string) => vi.waitFor(() => {
    const button = [...within.querySelectorAll('button')].find((b) => b.textContent?.startsWith(label));
    if (!button || button.disabled) throw new Error(`"${label}" is not ready in: ${within.textContent}`);
    return button;
  }, { timeout: 3_000 });

  it('review: a scan stopped while reading albums shows Google’s details on step 1, and Copy diagnostics copies the problem log', async () => {
    const line = await stoppedAtAlbums();
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const root = await open('review', '?account=account-a');
      await shows(root, 'Scan stopped', line);
      const library = root.querySelector<HTMLElement>('.scan-step')!;
      expect(library.querySelector('.support-line')?.textContent).toBe(line);
      expect(root.querySelector('details.protection')).toBeNull(); // the library was never read
      (await ready(library, 'Copy diagnostics')).click();
      await vi.waitFor(() => expect(library.querySelector('.diagnostics button')?.textContent).toBe('Copied'));
      const copied = writeText.mock.calls[0]![0];
      expect(copied).toMatch(/^Photo Cleaner 1\.2\.3 · diagnostics copied/);
      expect(copied).toContain('Step 1, read your library: failed at ALBUM_LIST · library 18,432 · favourites 15');
      expect(copied).toContain('1. ');
      expect(copied).toContain('scan: album list\n   PROTOCOL · Album has 10 fields, expected 9 or 12\n   Request: listAlbumsPage (Z5xsfc) · sent with nothing\n   Gave up at: [0][1]');
      expect(copied).not.toContain('someone@example.com');

      // What it copies can be looked at first.
      expect(library.querySelector('textarea')).toBeNull();
      const details = library.querySelector<HTMLDetailsElement>('.diagnostics details')!;
      details.querySelector('summary')!.click();
      await vi.waitFor(() => expect(library.querySelector('textarea')?.value).toBe(copied));
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('a scan whose background page shows no sign of life says it is not responding; Restart asks for a new page and keeps the problem', async () => {
    const jobs = new IndexedDbJobStore(indexedDB);
    await jobs.update(jobId('library-scan', 'account-a'), () => startScanJob('account-a', NOW - 120_000)); // nothing since
    for (const page of ['popup', 'review'] as const) {
      const root = await open(page, page === 'review' ? '?account=account-a' : undefined);
      await shows(root, 'Scan not responding', "Photo Cleaner's background work stopped responding", 'Not responding');
      await ready(root.querySelector<HTMLElement>('.scan-step')!, 'Copy diagnostics');
      if (page === 'popup') {
        for (const r of roots.splice(0)) r.unmount();
        vi.resetModules();
      }
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await click(document.getElementById('root')!, 'Restart');
    await vi.waitFor(() => expect(requests('app-restart-engine')).toHaveLength(1));
    expect(await jobs.get(jobId('library-scan', 'account-a'))).toMatchObject({ status: 'running' });
    expect((await jobs.get(jobId('library-scan', 'account-a')))!.aliveAtMs).toBeGreaterThanOrEqual(NOW);
    await vi.waitFor(async () => expect(await new IndexedDbProblemLog(indexedDB).recent(NOW)).toMatchObject([{ where: 'scan: background page not responding', kind: 'UNEXPECTED' }]));
    await shows(document.getElementById('root')!, 'Scanning');
  });

  it('a finished scan whose report lets nothing be trashed names why, and Copy diagnostics explains it without album titles', async () => {
    const source = new FakePhotos(Array.from({ length: 4 }, (_, i) => fakeItem(i)), [fakeAlbum('Wedding in Rome', [1]), fakeAlbum('Family secret', [2])]);
    source.inaccessibleAlbums.add('Family secret');
    await scan(source, new IndexedDbInventoryStore(indexedDB));
    const jobs = new IndexedDbJobStore(indexedDB);
    await jobs.update(jobId('library-scan', 'account-a'), () => endJob(startScanJob('account-a', NOW), 'completed', null, NOW));
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const root = await open('review', '?account=account-a');
      await shows(root, "No photo can be trashed: 1 album couldn't be read");
      const library = root.querySelector<HTMLElement>('.scan-step')!;
      (await ready(library, 'Copy diagnostics')).click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
      const copied = writeText.mock.calls[0]![0];
      expect(copied).toContain("Blocking trashing: 1 album couldn't be read");
      expect(copied).toContain('Album issue 1 (blocks): could not be read');
      expect(copied).toContain('Photos: 3 unknown for scan incomplete');
      expect(copied).not.toMatch(/Wedding|Rome|Family|secret/);
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('a paused analysis on a photo list days old offers Check for new photos, which reads the list again', async () => {
    const jobs = new IndexedDbJobStore(indexedDB);
    const daysAgo = NOW - 3 * 24 * 60 * 60 * 1000;
    await jobs.update(jobId('library-scan', 'account-a'), () => endJob(startScanJob('account-a', daysAgo), 'completed', null, daysAgo));
    const analysing = reportProgress(startAnalysisJob('account-a', daysAgo, null, NO_ANALYSIS), { ...NO_ANALYSIS, stage: 'analysing', photos: 6, newPhotos: 6, newAnalysed: 2 }, daysAgo);
    await jobs.update(jobId('analysis', 'account-a'), () => endJob(analysing, 'paused', 'Google may have changed something.', daysAgo));
    const popup = await open('popup');
    await shows(popup, 'Scan paused', 'More than a day old, so nothing can be trashed yet', 'Check for new photos');
    for (const r of roots.splice(0)) r.unmount();
    vi.resetModules();

    const root = await open('review', '?account=account-a');
    await shows(root, 'Check for new photos');
    expect(root.querySelector('.scan-title button')?.textContent).toBe('Check for new photos');
    await click(root, 'Check for new photos');
    await vi.waitFor(async () => expect(await jobs.get(jobId('library-scan', 'account-a'))).toMatchObject({ status: 'running' }));
    expect((await jobs.get(jobId('library-scan', 'account-a')))!.startedAtMs).toBeGreaterThanOrEqual(NOW); // a new read, not the old one
    expect(await jobs.get(jobId('analysis', 'account-a'))).toMatchObject({ status: 'paused' }); // it follows the new read
    expect(requests('app-wake-engine').length).toBeGreaterThan(0);
  });

  it('popup and panel: a stopped scan offers Copy diagnostics too', async () => {
    const line = await stoppedAtAlbums();
    for (const page of ['popup', 'panel'] as const) {
      const root = await open(page);
      await shows(root, line);
      await ready(root, 'Copy diagnostics');
      for (const r of roots.splice(0)) r.unmount();
      vi.resetModules();
    }
  });

  it('review: Copy diagnostics is always there, also with nothing stopped and with no account; the Scan card offers it only after a stop', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('review', '?account=account-a');
    await shows(root, 'Scan complete', 'Something not working?');
    await ready(root.querySelector<HTMLElement>('.diagnostics-card')!, 'Copy diagnostics');
    expect(root.querySelector('.scan-card .diagnostics')).toBeNull();
    for (const r of roots.splice(0)) r.unmount();
    vi.resetModules();

    account = NO_TAB;
    const empty = await open('review');
    await shows(empty, 'No account yet', 'Something not working?');
    await ready(empty, 'Copy diagnostics');
  });

  it('panel: Open in tab asks for the review tab on Scan', async () => {
    await scannedAndAnalysed(indexedDB);
    const root = await open('panel');
    await shows(root, 'Open in tab');
    await click(root, 'Open in tab');
    expect(requests('app-open-review')).toEqual([{ kind: 'app-open-review', account: 'account-a', tab: 'scan' }]);
  });

  it('erase (in the review tab) takes two clicks; Cancel goes back; a failure is shown and can be tried again', async () => {
    const root = await open('review', '?account=account-a');
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
