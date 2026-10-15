// @vitest-environment jsdom
//
// Each page as Chrome opens it (popup, panel, review tab), drawn into a browser-like document with
// a pretend extension and the real stores (in memory): it draws, it shows the account's data, and
// nothing goes wrong on the way (no error is logged). The screens only draw what the tested models
// work out, so these check that the pieces fit, not every text.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NO_ANALYSIS } from '../../src/app/ai/analysis';
import { IndexedDbAnalysisStore } from '../../src/app/ai/analysisStore';
import { modelKey } from '../../src/app/ai/model';
import { IndexedDbInventoryStore } from '../../src/app/scan/inventoryStore';
import { endJob, jobId, NO_PROGRESS, reportProgress, startAnalysisJob, startScanJob } from '../../src/app/shared/job';
import type { AccountAnswer } from '../../src/app/shared/messages';
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
let errors: MockInstance;

/** Chrome's side of the extension: the background page answers who is signed in, and previews. */
function pretendExtension() {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (request: { kind: string; op?: string }) => {
        if (request.kind === 'app-account') return account;
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

function click(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label));
  if (!button) throw new Error(`No button "${label}" in: ${root.textContent}`);
  button.click();
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('indexedDB', new IDBFactory()); // each test its own saved data
  account = SIGNED_IN;
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

    click(root, '2 · Duplicates');
    await vi.waitFor(() => expect(root.querySelectorAll('.duplicates:not([hidden]) .tiles > *')).toHaveLength(3), { timeout: 3_000 });
    await shows(root, 'D · Trash selected');

    click(root, 'Search more like these');
    await vi.waitFor(() => expect(root.querySelectorAll('.search-grid > *').length).toBeGreaterThan(0), { timeout: 3_000 });
    await shows(root, 'More like:');

    click(root, '1 · Scan');
    await shows(root, 'Never trash photos that are');
  });

  it('review tab before any scan: every tab says what to do first', async () => {
    const root = await open('review', '?account=account-a');
    await shows(root, 'Scan library');
    click(root, '2 · Duplicates');
    await shows(root, 'Open Scan');
    click(root, 'Search');
    await shows(root, 'Open Scan');
  });

  it('after the data was erased the review tab says so', async () => {
    const root = await open('review', '?erased=1');
    await shows(root, 'erased');
  });
});
