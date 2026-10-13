// Service worker: holds the loopback WebSocket to the desktop app and routes
// read-only commands to a photos.google.com tab.

import {
  DEFAULT_PORT,
  isReadOp,
  type AppToExtension,
  type ExtensionToApp,
  type OpResult,
  type TabCommand,
} from '../shared/protocol';

const KEEPALIVE_MS = 20_000;
/** Short, so a restarted app is found within seconds while the worker is awake. */
const MAX_BACKOFF_MS = 5_000;
const HEALTH_TIMEOUT_MS = 2_000;
const TOKEN_REJECTED_CODE = 4401;

type LinkState = 'unpaired' | 'connecting' | 'connected' | 'token-rejected' | 'app-unreachable';

interface Config {
  port: number;
  token: string | null;
}

let socket: WebSocket | null = null;
let state: LinkState = 'unpaired';
let backoffMs = 1_000;
let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
/** Set while a connection attempt is in progress, so overlapping triggers do not open two sockets. */
let attempt: Promise<void> | null = null;

async function loadConfig(): Promise<Config> {
  const stored = await chrome.storage.local.get(['port', 'token']);
  const port = typeof stored['port'] === 'number' ? stored['port'] : DEFAULT_PORT;
  const token = typeof stored['token'] === 'string' && stored['token'] !== '' ? stored['token'] : null;
  return { port, token };
}

function send(message: ExtensionToApp): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function photosTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: 'https://photos.google.com/*' });
  return tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

/**
 * Injects the page script and relay into a tab that was open before this
 * extension instance started (install, update or reload). Both scripts guard
 * against running twice.
 */
async function injectInto(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'], world: 'MAIN' });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function injectIntoOpenTabs(): Promise<void> {
  for (const tab of await photosTabs()) {
    if (tab.id === undefined || tab.discarded) continue;
    try {
      await injectInto(tab.id);
    } catch (error) {
      console.warn('Could not inject into a Photos tab', error instanceof Error ? error.message : error);
    }
  }
}

async function sendToTab(tabId: number, command: TabCommand): Promise<OpResult> {
  try {
    return (await chrome.tabs.sendMessage(tabId, command)) as OpResult;
  } catch {
    // No relay in the tab (opened before this extension instance): inject and retry once.
    try {
      await injectInto(tabId);
      return (await chrome.tabs.sendMessage(tabId, command)) as OpResult;
    } catch {
      return { ok: false, error: { kind: 'NO_PHOTOS_TAB', message: 'The Photos tab is not responding; reload it' } };
    }
  }
}

const RELOAD_COOLDOWN_MS = 120_000;
const RELOAD_TIMEOUT_MS = 30_000;
let lastReloadAt = 0;

/**
 * Reloads the Photos tab and waits until it has loaded. Used when Chrome has put
 * the tab to sleep (Memory Saver) or the page's session data has gone stale after
 * hours open. At most once per cooldown, so a real sign-out cannot cause a loop.
 */
async function reloadPhotosTab(tabId: number): Promise<boolean> {
  if (Date.now() - lastReloadAt < RELOAD_COOLDOWN_MS) return false;
  lastReloadAt = Date.now();
  const loaded = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, RELOAD_TIMEOUT_MS);
    function listener(updatedId: number, info: chrome.tabs.OnUpdatedInfo) {
      if (updatedId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
  await chrome.tabs.reload(tabId);
  return loaded;
}

async function runInTab(op: string, params: Record<string, unknown>): Promise<OpResult> {
  if (!isReadOp(op)) return { ok: false, error: { kind: 'BAD_REQUEST', message: 'Unknown operation' } };
  const tabs = await photosTabs();
  const tab = tabs[0];
  if (tab?.id === undefined) {
    return { ok: false, error: { kind: 'NO_PHOTOS_TAB', message: 'Open photos.google.com in this Chrome profile' } };
  }
  if (tab.discarded) await reloadPhotosTab(tab.id);
  let result = await sendToTab(tab.id, { kind: 'pc-command', op, params });
  // A stale or unresponsive page: reload it once and retry.
  if (!result.ok && (result.error.kind === 'SESSION' || result.error.kind === 'NO_PHOTOS_TAB') && (await reloadPhotosTab(tab.id))) {
    result = await sendToTab(tab.id, { kind: 'pc-command', op, params });
  }
  if (op === 'status' && result.ok) {
    return { ok: true, data: { ...(result.data as object), photosTabCount: tabs.length } };
  }
  return result;
}

function scheduleReconnect(): void {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => void connect(), backoffMs);
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
}

/**
 * Quietly checks whether the app is listening. A WebSocket to a closed port makes
 * Chrome log an error on every attempt; a failed fetch is caught silently.
 */
async function appIsListening(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

function connect(): Promise<void> {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return Promise.resolve();
  attempt ??= openSocket().finally(() => {
    attempt = null;
  });
  return attempt;
}

async function openSocket(): Promise<void> {
  const config = await loadConfig();
  if (config.token === null) {
    state = 'unpaired';
    return;
  }
  if (!(await appIsListening(config.port))) {
    state = 'app-unreachable';
    scheduleReconnect();
    return;
  }
  const token = config.token;
  state = 'connecting';
  const ws = new WebSocket(`ws://127.0.0.1:${config.port}/bridge`);
  socket = ws;

  ws.onopen = () => {
    send({ t: 'hello', token, extensionVersion: chrome.runtime.getManifest().version });
  };
  ws.onmessage = (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    let message: AppToExtension;
    try {
      message = JSON.parse(event.data) as AppToExtension;
    } catch {
      return;
    }
    if (message.t === 'welcome') {
      state = 'connected';
      backoffMs = 1_000;
      clearInterval(keepaliveTimer);
      keepaliveTimer = setInterval(() => send({ t: 'keepalive' }), KEEPALIVE_MS);
    } else if (message.t === 'cmd' && state === 'connected') {
      const id = message.id;
      void runInTab(message.op, message.params ?? {}).then((result) => send({ t: 'result', id, result }));
    }
  };
  ws.onclose = (event: CloseEvent) => {
    clearInterval(keepaliveTimer);
    if (socket === ws) socket = null;
    if (event.code === TOKEN_REJECTED_CODE) {
      state = 'token-rejected';
      return; // wait for a new token from the popup
    }
    state = 'app-unreachable';
    scheduleReconnect();
  };
}

function reconnectNow(): void {
  backoffMs = 1_000;
  clearTimeout(reconnectTimer);
  socket?.close(1000);
  socket = null;
  void connect();
}

chrome.runtime.onMessage.addListener((message: { kind?: string }, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.kind === 'pc-get-state') {
    // Opening the popup is also a cue to reconnect straight away.
    if (state !== 'connected') {
      backoffMs = 1_000;
      void connect();
    }
    void photosTabs().then((tabs) => sendResponse({ state, photosTabCount: tabs.length }));
    return true;
  }
  if (message?.kind === 'pc-wake') {
    // A photos.google.com tab loaded: the user is about to need the connection.
    if (state !== 'connected') {
      backoffMs = 1_000;
      void connect();
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message?.kind === 'pc-config-changed') {
    reconnectNow();
    sendResponse({ ok: true });
  }
  return false;
});

// Wakes the worker periodically so it reconnects after the app (re)starts.
// 30 seconds is the shortest period Chrome allows.
chrome.alarms.create('pc-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pc-reconnect') void connect();
});
chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => {
  void injectIntoOpenTabs();
  void connect();
});
void connect();
