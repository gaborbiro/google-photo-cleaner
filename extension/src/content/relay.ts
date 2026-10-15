// Isolated-world relay: service worker command -> page script -> response.

import { isAllowedOp, isOpResult, type OpResult, type PageRequest, type PageResponse, type TabCommand } from '../shared/protocol';

const PAGE_TIMEOUT_MS = 90_000;

/**
 * Relays this extension's tab commands to its page script on [channel]. [writesAllowed]: also the
 * trash operations (Photo Cleaner's own relay; the desktop connector's stays read-only).
 */
export function installRelay(channel: string, writesAllowed = false): void {
  const pending = new Map<string, (result: OpResult) => void>();

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const message = event.data as Partial<PageResponse> | null;
    if (message?.channel !== channel || message.dir !== 'response' || typeof message.id !== 'string') return;
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    // Only the outer shape is checked here; the data is checked where it is read.
    resolve(isOpResult(message.result) ? message.result : { ok: false, error: { kind: 'PROTOCOL', message: 'Malformed answer from the page script' } });
  });

  chrome.runtime.onMessage.addListener((message: Partial<TabCommand>, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.kind !== 'pc-command') return false;
    if (!isAllowedOp(message.op, writesAllowed)) {
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
    const request: PageRequest = { channel, dir: 'request', id, op: message.op, params: message.params ?? {} };
    window.postMessage(request, window.location.origin);
    return true; // async response
  });
}
