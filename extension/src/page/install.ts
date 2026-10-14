// Runs in the photos.google.com page (MAIN world) so requests carry the page's
// own session. Session tokens are read here and never posted anywhere.

import { isReadOp, type PageRequest, type PageResponse } from '../shared/protocol';
import { runOp, type PageEnvironment } from './ops';

declare global {
  interface Window {
    WIZ_global_data?: Record<string, unknown>;
  }
}

export interface PageScriptConfig {
  /** postMessage channel shared with this extension's content script. */
  channel: string;
  /** window property naming the instance that answers; distinct per extension. */
  ownerKey: string;
  /**
   * Adds the signed-in email to "status", for showing which account a panel works on.
   * It is displayed, never stored: stored data is labelled with the account fingerprint.
   */
  exposeAccountEmail?: boolean;
}

/**
 * Answers this extension's requests from the page. After an extension reload the
 * previous page script stays alive in the page. Each injection claims ownership, and
 * older instances stop answering, so a request is never executed twice and never by
 * outdated code.
 */
export function installPageScript({ channel, ownerKey, exposeAccountEmail = false }: PageScriptConfig): void {
  const owners = window as unknown as Record<string, string | undefined>;
  const instanceId = crypto.randomUUID();
  owners[ownerKey] = instanceId;

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
    if (event.source !== window || owners[ownerKey] !== instanceId) return;
    const message = event.data as Partial<PageRequest> | null;
    if (message?.channel !== channel || message.dir !== 'request' || typeof message.id !== 'string') return;
    const id = message.id;
    const params = typeof message.params === 'object' && message.params !== null ? message.params : {};

    const respond = (response: PageResponse) => window.postMessage(response, window.location.origin);
    if (!isReadOp(message.op)) {
      respond({ channel, dir: 'response', id, result: { ok: false, error: { kind: 'BAD_REQUEST', message: 'Unknown operation' } } });
      return;
    }
    const op = message.op;
    void runOp(env, op, params).then((result) => {
      const email = window.WIZ_global_data?.['oPEP7c'];
      const withEmail = exposeAccountEmail && op === 'status' && result.ok && typeof email === 'string'
        ? { ok: true as const, data: { ...(result.data as object), accountEmail: email } }
        : result;
      respond({ channel, dir: 'response', id, result: withEmail });
    });
  });
}
