import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_FAILED_TEXT, jobId, pauseJob, startScanJob } from '../../src/app/shared/job';
import type { AppRequest } from '../../src/app/shared/messages';
import { IndexedDbProblemLog } from '../../src/app/shared/problemLog';
import { IndexedDbJobStore } from '../../src/app/shared/store';

function event<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    listeners,
    addListener: vi.fn((listener: (...args: Args) => void) => { listeners.add(listener); }),
    removeListener: vi.fn((listener: (...args: Args) => void) => { listeners.delete(listener); }),
    emit: (...args: Args) => { for (const listener of [...listeners]) listener(...args); },
  };
}

const tab = { id: 42, windowId: 7, url: 'https://photos.google.com/', status: 'complete' } as chrome.tabs.Tab;
let receive: (message: AppRequest, sender: chrome.runtime.MessageSender, reply: (answer: unknown) => void) => boolean;
let updated: ReturnType<typeof event<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>>;
let removed: ReturnType<typeof event<[number, chrome.tabs.OnRemovedInfo]>>;
let tabs: {
  query: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
};
let executeScript: ReturnType<typeof vi.fn>;
let focusWindow: ReturnType<typeof vi.fn>;
let installed: () => void;
/** Chrome's side panel, with the options set for each tab so far. */
let sidePanel: { options: Map<number, chrome.sidePanel.PanelOptions>; getOptions: ReturnType<typeof vi.fn>; setOptions: ReturnType<typeof vi.fn> };
/** The background page (offscreen document): open until closed. */
let offscreen: { open: boolean; hasDocument: ReturnType<typeof vi.fn>; closeDocument: ReturnType<typeof vi.fn>; createDocument: ReturnType<typeof vi.fn>; Reason: { WORKERS: string } };

beforeEach(async () => {
  vi.resetModules();
  updated = event();
  removed = event();
  tabs = {
    query: vi.fn().mockResolvedValue([tab]),
    create: vi.fn().mockResolvedValue(tab),
    update: vi.fn().mockResolvedValue(tab),
    get: vi.fn().mockResolvedValue(tab),
    sendMessage: vi.fn().mockResolvedValue(true),
  };
  executeScript = vi.fn().mockResolvedValue([]);
  focusWindow = vi.fn().mockResolvedValue(undefined);
  offscreen = {
    open: true,
    hasDocument: vi.fn(async () => offscreen.open),
    closeDocument: vi.fn(async () => { offscreen.open = false; }),
    createDocument: vi.fn(async () => { offscreen.open = true; }),
    Reason: { WORKERS: 'WORKERS' },
  };
  sidePanel = {
    options: new Map(),
    // A tab without options of its own has the default ones: enabled, and no page (none in the manifest).
    getOptions: vi.fn(async ({ tabId }: { tabId: number }) => sidePanel.options.get(tabId) ?? { enabled: true }),
    setOptions: vi.fn(async (options: chrome.sidePanel.PanelOptions) => { sidePanel.options.set(options.tabId!, options); }),
  };
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'photo-cleaner',
      getURL: (path: string) => `chrome-extension://photo-cleaner/${path}`,
      getManifest: () => ({ version: '9.8.7' }),
      onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: (listener: () => void) => { installed = listener; } },
    },
    tabs: { ...tabs, onUpdated: updated, onRemoved: removed },
    windows: { update: focusWindow },
    scripting: { executeScript },
    sidePanel,
    offscreen,
  });
  await import('../../src/app/background/main');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function send(message: AppRequest) {
  return new Promise<unknown>((resolve) => {
    expect(receive(message, { id: 'photo-cleaner' }, resolve)).toBe(true);
  });
}

describe('opening Google Photos', () => {
  // The page that asked opens the tab's panel, then asks for the tab to come forward (app-show-panel).
  it('Open Google Photos names the open tab, leaving it where it is', async () => {
    expect(await send({ kind: 'app-open-photos' })).toEqual({ tabId: 42 });
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).not.toHaveBeenCalled();
    expect(focusWindow).not.toHaveBeenCalled();
  });

  it('Open Google Photos opens a tab behind the page when none is open, so a popup stays to open its panel', async () => {
    tabs.query.mockResolvedValue([]);
    tabs.create.mockResolvedValue({ id: 51, windowId: 7, url: '', pendingUrl: 'https://photos.google.com/', status: 'loading' });
    expect(await send({ kind: 'app-open-photos' })).toEqual({ tabId: 51 });
    expect(tabs.create).toHaveBeenCalledExactlyOnceWith({ url: 'https://photos.google.com/', active: false });
    expect(tabs.update).not.toHaveBeenCalled();
  });

  it('after the popup opened a tab’s panel, that tab is brought forward, in its window', async () => {
    const other = { ...tab, id: 84, windowId: 9 };
    tabs.get.mockResolvedValue(other);
    expect(await send({ kind: 'app-show-panel', tabId: 84 })).toBe(true);
    expect(tabs.get).toHaveBeenCalledWith(84);
    expect(tabs.update).toHaveBeenCalledExactlyOnceWith(84, { active: true });
    expect(focusWindow).toHaveBeenCalledExactlyOnceWith(9, { focused: true });
  });
});

describe('the panel (Chrome’s side panel)', () => {
  const page = (id: number, url?: string) => ({ id, windowId: 7, url }) as chrome.tabs.Tab;

  it('is offered on a Google Photos page as it loads, naming its tab, and taken away when the tab goes elsewhere', async () => {
    updated.emit(5, { status: 'loading' }, page(5, 'https://photos.google.com/album/x'));
    await vi.waitFor(() => expect(sidePanel.options.get(5)).toEqual({ tabId: 5, path: 'panel.html?tab=5', enabled: true }));
    // Another site: Chrome gives no address without the "tabs" permission.
    updated.emit(5, { status: 'loading' }, page(5));
    await vi.waitFor(() => expect(sidePanel.options.get(5)).toEqual({ tabId: 5, enabled: false }));
    updated.emit(5, { status: 'loading' }, page(5, 'https://photos.google.com/'));
    await vi.waitFor(() => expect(sidePanel.options.get(5)).toMatchObject({ enabled: true }));
    expect(sidePanel.setOptions).toHaveBeenCalledTimes(3);
  });

  it('is kept in a tab just opened on Google Photos, which says where it is going only as its pending address', async () => {
    sidePanel.options.set(5, { tabId: 5, path: 'panel.html?tab=5', enabled: true }); // the popup has just opened it
    updated.emit(5, { status: 'loading' }, { ...page(5, ''), pendingUrl: 'https://photos.google.com/' });
    await vi.waitFor(() => expect(sidePanel.getOptions).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sidePanel.setOptions).not.toHaveBeenCalled();
    // Coming from another site (no address without the "tabs" permission), it is offered too.
    updated.emit(6, { status: 'loading' }, { ...page(6), pendingUrl: 'https://photos.google.com/' });
    await vi.waitFor(() => expect(sidePanel.options.get(6)).toEqual({ tabId: 6, path: 'panel.html?tab=6', enabled: true }));
  });

  it('is set only when it changes, so a panel in use is not reloaded; and only as a page starts loading', async () => {
    sidePanel.options.set(5, { tabId: 5, path: 'panel.html?tab=5', enabled: true });
    updated.emit(5, { status: 'loading' }, page(5, 'https://photos.google.com/'));
    updated.emit(5, { status: 'complete' }, page(6, 'https://photos.google.com/'));
    updated.emit(6, { title: 'Photos' }, page(6, 'https://photos.google.com/'));
    await vi.waitFor(() => expect(sidePanel.getOptions).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sidePanel.setOptions).not.toHaveBeenCalled();
  });

  it('after an install or update, every open Photos tab gets it, also those asleep (which get the page script once awake)', async () => {
    tabs.query.mockResolvedValue([page(1, 'https://photos.google.com/'), { ...page(2, 'https://photos.google.com/'), discarded: true }]);
    installed();
    await vi.waitFor(() => expect([...sidePanel.options.keys()].sort()).toEqual([1, 2]));
    await vi.waitFor(() => expect(executeScript.mock.calls.map(([{ target }]) => target.tabId)).toEqual([1, 1]));
  });
});

describe('opening the review tab', () => {
  const page = 'chrome-extension://photo-cleaner/review.html';

  it('opens a new tab on the tab asked for', async () => {
    tabs.query.mockResolvedValue([]);
    expect(await send({ kind: 'app-open-review', account: 'acc 1', tab: 'duplicates' })).toBe(true);
    expect(tabs.query).toHaveBeenCalledWith({ url: `${page}*` });
    expect(tabs.create).toHaveBeenCalledExactlyOnceWith({ url: `${page}?account=acc%201#duplicates` });
    expect(tabs.update).not.toHaveBeenCalled();
  });

  it('brings an open review tab of the same account forward, changing only what follows # (so Chrome does not reload it)', async () => {
    const open = { id: 9, windowId: 3, url: `${page}?account=acc1`, status: 'complete' } as chrome.tabs.Tab;
    tabs.query.mockResolvedValue([open]);
    expect(await send({ kind: 'app-open-review', account: 'acc1', tab: 'duplicates' })).toBe(true);
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledExactlyOnceWith(9, { active: true, url: `${open.url}#duplicates` });
    expect(focusWindow).toHaveBeenCalledWith(3, { focused: true });
  });
});
describe('which account is signed in', () => {
  const photos = (id: number, more: Partial<chrome.tabs.Tab> = {}) => ({ ...tab, id, ...more }) as chrome.tabs.Tab;
  const signedIn = (fingerprint: string) => ({ ok: true, data: { accountFingerprint: fingerprint, accountEmail: `${fingerprint}@example.com` } });
  const signedOut = { ok: false, error: { kind: 'SESSION', message: 'signed out' } };
  const never = () => new Promise(() => {});
  /** Each tab's answer to the account check, by its id. */
  function tabsAnswer(answers: Record<number, () => unknown>) {
    tabs.sendMessage.mockImplementation(async (tabId: number) => answers[tabId]());
  }
  /** Asks as the popup does, or as the panel of tab [tabId]. */
  function ask(tabId?: number) {
    return send({ kind: 'app-account', tabId });
  }
  const notResponding = { account: null, problem: 'The Google Photos tab is not responding; reload it.', photosTabOpen: true, tabId: 42 };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('says when no Google Photos tab is open', async () => {
    tabs.query.mockResolvedValue([]);
    expect(await ask()).toEqual({ account: null, problem: 'No Google Photos tab is open.', photosTabOpen: false, tabId: null });
  });

  it('gives a tab that does not answer 5 seconds, then says it is not responding', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tabsAnswer({ 42: never });
    let answer: unknown;
    void ask().then((a) => { answer = a; });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toEqual(notResponding);
  });

  it('asks the other Photos tabs when the first is asleep or does not answer', async () => {
    tabs.query.mockResolvedValue([photos(1, { discarded: true }), photos(2), photos(3)]);
    tabsAnswer({ 2: () => Promise.reject(new Error('No listener')), 3: () => signedIn('acc3') });
    executeScript.mockImplementation(async ({ target }: { target: { tabId: number } }) => {
      if (target.tabId === 2) throw new Error('Cannot access the tab');
      return [];
    });
    expect(await ask()).toEqual({ account: { fingerprint: 'acc3', email: 'acc3@example.com' }, problem: null, photosTabOpen: true, tabId: 3 });
    expect(tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).not.toContain(1); // a sleeping tab is not woken for this
  });

  it('asks every tab at once, so a frozen first tab costs the time limit once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tabs.query.mockResolvedValue([photos(1), photos(2)]);
    tabsAnswer({ 1: never, 2: () => signedIn('acc2') });
    let answer: unknown;
    void ask().then((a) => { answer = a; });
    await vi.waitFor(() => expect(tabs.sendMessage).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers(); // the saved jobs, read once an account is known, need real timers
    await vi.waitFor(() => expect(answer).toMatchObject({ account: { fingerprint: 'acc2' } }));
  });

  it('without an account, gives the reason of a tab that answered before that of one asleep or not responding', async () => {
    tabs.query.mockResolvedValue([photos(1, { discarded: true }), photos(2)]);
    tabsAnswer({ 2: () => signedOut });
    expect(await ask()).toEqual({ account: null, problem: 'Google Photos is signed out in this tab.', photosTabOpen: true, tabId: 2 });
  });

  it('without any answer, gives the first tab’s reason', async () => {
    tabs.query.mockResolvedValue([photos(1, { discarded: true }), photos(2, { discarded: true })]);
    expect(await ask()).toEqual({ account: null, problem: 'The Google Photos tab is asleep; click on it to wake it.', photosTabOpen: true, tabId: 1 });
    expect(tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('for the panel, asks only its own tab', async () => {
    tabs.query.mockResolvedValue([photos(1), photos(42)]);
    tabs.get.mockResolvedValue(photos(42));
    tabsAnswer({ 1: () => signedIn('acc1'), 42: () => signedOut });
    expect(await ask(42)).toEqual({ account: null, problem: 'Google Photos is signed out in this tab.', photosTabOpen: true, tabId: 42 });
    expect(tabs.get).toHaveBeenCalledWith(42);
    expect(tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([42]);
  });

  it('for the panel, a frozen tab is not responding after 5 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tabsAnswer({ 42: never });
    const answer = ask(42);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await answer).toEqual(notResponding);
  });
});

describe('the background page failing', () => {
  const running = (account: string) => startScanJob(account, Date.now());

  it('one that could not start: the error is kept (scrubbed), its jobs pause saying why, and it is closed so Resume starts a new one', async () => {
    const jobs = new IndexedDbJobStore();
    await jobs.update(jobId('library-scan', 'never-started'), () => running('never-started'));
    await jobs.update(jobId('library-scan', 'already-paused'), () => pauseJob(running('already-paused'), Date.now()));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stack = 'TypeError: chrome.runtime.getManifest is not a function\n    at keepProblemsHere (chrome-extension://abcdefghijklmnopabcdefghijklmnop/engine.js:2:30)';
    expect(await send({ kind: 'app-engine-error', started: false, message: 'TypeError: chrome.runtime.getManifest is not a function', stack })).toBe(true);
    expect(await jobs.get(jobId('library-scan', 'never-started'))).toMatchObject({ status: 'paused', resumeWhenPhotosOpen: false, progress: { notice: ENGINE_FAILED_TEXT } });
    expect(await jobs.get(jobId('library-scan', 'already-paused'))).toMatchObject({ status: 'paused', progress: { notice: null } });
    expect(offscreen.closeDocument).toHaveBeenCalledOnce();
    const [kept] = await new IndexedDbProblemLog().recent(Date.now());
    expect(kept).toMatchObject({
      where: 'background page: could not start', kind: 'UNEXPECTED', version: '0.0.0-test',
      message: 'TypeError: chrome.runtime.getManifest is not a function', stack: 'at keepProblemsHere (engine.js:2:30)',
    });
    expect(error).toHaveBeenCalled();
  });

  it('an error after it started is only kept: its jobs go on', async () => {
    const jobs = new IndexedDbJobStore();
    await jobs.update(jobId('library-scan', 'still-going'), () => running('still-going'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await send({ kind: 'app-engine-error', started: true, message: 'Error: something minor', stack: null })).toBe(true);
    expect(await jobs.get(jobId('library-scan', 'still-going'))).toMatchObject({ status: 'running' });
    expect(offscreen.closeDocument).not.toHaveBeenCalled();
    expect((await new IndexedDbProblemLog().recent(Date.now()))[0]).toMatchObject({ where: 'background page: error', message: 'Error: something minor', stack: null });
  });

  it('Restart closes a page that stopped responding and starts a new one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await send({ kind: 'app-restart-engine' })).toBe(true);
    expect(offscreen.closeDocument).toHaveBeenCalledOnce();
    expect(offscreen.createDocument).toHaveBeenCalledOnce();
    expect(offscreen.open).toBe(true);
  });
});