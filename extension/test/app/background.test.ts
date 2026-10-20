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
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'photo-cleaner',
      getURL: (path: string) => `chrome-extension://photo-cleaner/${path}`,
      getManifest: () => ({ version: '9.8.7' }),
      onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    tabs: { ...tabs, onUpdated: updated, onRemoved: removed },
    windows: { update: focusWindow },
    scripting: { executeScript },
    offscreen,
  });
  await import('../../src/app/background/main');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function request(kind: 'app-open-photos' | 'app-show-panel') {
  return send({ kind });
}

function send(message: AppRequest) {
  return new Promise<unknown>((resolve) => {
    expect(receive(message, { id: 'photo-cleaner' }, resolve)).toBe(true);
  });
}

describe('opening Google Photos with its panel', () => {
  it.each(['app-open-photos', 'app-show-panel'] as const)('%s focuses an existing tab and opens its panel', async (kind) => {
    expect(await request(kind)).toBe(true);
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledWith(42, { active: true });
    expect(focusWindow).toHaveBeenCalledWith(7, { focused: true });
    expect(tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(42, { kind: 'app-toggle-panel', open: true });
    expect(updated.listeners.size).toBe(0);
    expect(removed.listeners.size).toBe(0);
  });

  it('waits for the newly created tab, then opens the panel in that tab', async () => {
    const loading = { ...tab, id: 84, status: 'loading' };
    tabs.query.mockResolvedValue([]);
    tabs.create.mockResolvedValue(loading);
    tabs.get.mockResolvedValue(loading);
    const opening = request('app-open-photos');
    await vi.waitFor(() => expect(tabs.get).toHaveBeenCalledWith(84));
    updated.emit(42, { status: 'complete' }, tab);
    expect(tabs.sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
    updated.emit(84, { status: 'complete' }, { ...tab, id: 84 });
    expect(await opening).toBe(true);
    expect(tabs.create).toHaveBeenCalledExactlyOnceWith({ url: 'https://photos.google.com/' });
    expect(tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(84, { kind: 'app-toggle-panel', open: true });
    expect(updated.listeners.size).toBe(0);
    expect(removed.listeners.size).toBe(0);
  });

  it('handles a new tab that finished loading before the listener was attached', async () => {
    tabs.query.mockResolvedValue([]);
    tabs.create.mockResolvedValue({ ...tab, status: 'loading' });
    expect(await request('app-open-photos')).toBe(true);
    expect(tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(42, { kind: 'app-toggle-panel', open: true });
  });

  it('injects the panel into a tab opened before the extension started', async () => {
    tabs.sendMessage.mockRejectedValueOnce(new Error('No listener'));
    expect(await request('app-show-panel')).toBe(true);
    expect(executeScript.mock.calls).toEqual([
      [{ target: { tabId: 42 }, files: ['page.js'], world: 'MAIN' }],
      [{ target: { tabId: 42 }, files: ['content.js'] }],
    ]);
    expect(tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it.each(['closed', 'timed out'] as const)('cleans up when a loading tab is %s', async (outcome) => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tabs.get.mockResolvedValue({ ...tab, status: 'loading' });
    const opening = request('app-open-photos');
    await vi.waitFor(() => expect(tabs.get).toHaveBeenCalled());
    if (outcome === 'closed') removed.emit(42, { windowId: 7, isWindowClosing: false });
    else await vi.advanceTimersByTimeAsync(30_000);
    expect(await opening).toMatchObject({ error: expect.any(String) });
    expect(tabs.sendMessage).not.toHaveBeenCalled();
    expect(updated.listeners.size).toBe(0);
    expect(removed.listeners.size).toBe(0);
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
  function ask(sender: chrome.runtime.MessageSender = { id: 'photo-cleaner' }) {
    return new Promise<unknown>((resolve) => {
      expect(receive({ kind: 'app-account' }, sender, resolve)).toBe(true);
    });
  }
  const notResponding = { account: null, problem: 'The Google Photos tab is not responding; reload it.', photosTabOpen: true };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('says when no Google Photos tab is open', async () => {
    tabs.query.mockResolvedValue([]);
    expect(await ask()).toEqual({ account: null, problem: 'No Google Photos tab is open.', photosTabOpen: false });
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
    expect(await ask()).toEqual({ account: { fingerprint: 'acc3', email: 'acc3@example.com' }, problem: null, photosTabOpen: true });
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
    expect(await ask()).toEqual({ account: null, problem: 'Google Photos is signed out in this tab.', photosTabOpen: true });
  });

  it('without any answer, gives the first tab’s reason', async () => {
    tabs.query.mockResolvedValue([photos(1, { discarded: true }), photos(2, { discarded: true })]);
    expect(await ask()).toEqual({ account: null, problem: 'The Google Photos tab is asleep; click on it to wake it.', photosTabOpen: true });
    expect(tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('for the panel, asks only its own tab', async () => {
    tabs.query.mockResolvedValue([photos(1), photos(42)]);
    tabsAnswer({ 1: () => signedIn('acc1'), 42: () => signedOut });
    expect(await ask({ id: 'photo-cleaner', tab: photos(42) })).toEqual({ account: null, problem: 'Google Photos is signed out in this tab.', photosTabOpen: true });
    expect(tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([42]);
  });

  it('for the panel, a frozen tab is not responding after 5 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tabsAnswer({ 42: never });
    const answer = ask({ id: 'photo-cleaner', tab: photos(42) });
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