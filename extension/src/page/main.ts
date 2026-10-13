// Runs in the photos.google.com page (MAIN world) so requests carry the page's
// own session. Session tokens are read here and never posted anywhere.

import { isReadOp, PAGE_CHANNEL, type PageRequest, type PageResponse } from '../shared/protocol';
import { runOp, type PageEnvironment } from './ops';

declare global {
  interface Window {
    WIZ_global_data?: Record<string, unknown>;
    /** Id of the page script instance that answers requests; set by the newest injection. */
    __photoCleanerPageId?: string;
  }
}

// After an extension reload the previous page script stays alive in the page. Each
// injection claims ownership, and older instances stop answering, so a request is
// never executed twice and never by outdated code.
const instanceId = crypto.randomUUID();
window.__photoCleanerPageId = instanceId;

const env: PageEnvironment = {
  wiz: () => window.WIZ_global_data,
  sourcePath: () => window.location.pathname,
  fetcher: (url, init) => window.fetch(url, init),
  sha256Hex: async (text) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
};

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || window.__photoCleanerPageId !== instanceId) return;
  const message = event.data as Partial<PageRequest> | null;
  if (message?.channel !== PAGE_CHANNEL || message.dir !== 'request' || typeof message.id !== 'string') return;
  const id = message.id;
  const params = typeof message.params === 'object' && message.params !== null ? message.params : {};

  const respond = (response: PageResponse) => window.postMessage(response, window.location.origin);
  if (!isReadOp(message.op)) {
    respond({ channel: PAGE_CHANNEL, dir: 'response', id, result: { ok: false, error: { kind: 'BAD_REQUEST', message: 'Unknown operation' } } });
    return;
  }
  void runOp(env, message.op, params).then((result) => respond({ channel: PAGE_CHANNEL, dir: 'response', id, result }));
});
