// Isolated-world relay: service worker command -> page script -> response.

import { isReadOp, PAGE_CHANNEL, type OpResult, type PageRequest, type PageResponse, type TabCommand } from '../shared/protocol';

declare global {
  // eslint-disable-next-line no-var
  var __photoCleanerContentInstalled: boolean | undefined;
}

const PAGE_TIMEOUT_MS = 90_000;
const pending = new Map<string, (result: OpResult) => void>();

function installRelay(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const message = event.data as Partial<PageResponse> | null;
    if (message?.channel !== PAGE_CHANNEL || message.dir !== 'response' || typeof message.id !== 'string') return;
    const resolve = pending.get(message.id);
    if (resolve && message.result) {
      pending.delete(message.id);
      resolve(message.result);
    }
  });

  chrome.runtime.onMessage.addListener((message: Partial<TabCommand>, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.kind !== 'pc-command') return false;
    if (!isReadOp(message.op)) {
      sendResponse({ ok: false, error: { kind: 'BAD_REQUEST', message: 'Unknown operation' } } satisfies OpResult);
      return false;
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      sendResponse({ ok: false, error: { kind: 'TRANSIENT', message: 'Page script did not answer in time' } } satisfies OpResult);
    }, PAGE_TIMEOUT_MS);
    pending.set(id, (result) => {
      clearTimeout(timer);
      sendResponse(result);
    });
    const request: PageRequest = { channel: PAGE_CHANNEL, dir: 'request', id, op: message.op, params: message.params ?? {} };
    window.postMessage(request, window.location.origin);
    return true; // async response
  });
}

// The manifest injects this into new tabs and the service worker injects it into
// tabs that were open before an install or update; only the first copy registers.
if (!globalThis.__photoCleanerContentInstalled) {
  globalThis.__photoCleanerContentInstalled = true;
  installRelay();
  // Wake the service worker so it connects to the app now rather than at its next alarm.
  chrome.runtime.sendMessage({ kind: 'pc-wake' }).catch(() => {
    // The worker may be restarting; its alarm reconnects soon anyway.
  });
}
