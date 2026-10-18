import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRequest } from '../../src/app/shared/messages';

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
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'photo-cleaner',
      getURL: (path: string) => `chrome-extension://photo-cleaner/${path}`,
      onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    tabs: { ...tabs, onUpdated: updated, onRemoved: removed },
    windows: { update: focusWindow },
    scripting: { executeScript },
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