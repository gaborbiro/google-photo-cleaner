// Loaded before the background page's own code (see engine.html): any error nobody caught there,
// also one that stops the page from starting at all, goes to the service worker, which keeps it in
// the problem log and, if the page never got going, stops the jobs waiting for it, saying so. On its
// own the background page's console is the only place such an error would show, and nobody sees it.
// Uses only runtime messaging, the one extension API an offscreen document has.

import { ENGINE_STARTED_KEY } from '../shared/constants';
import type { AppRequest } from '../shared/messages';

function report(error: unknown): void {
  const started = (globalThis as Record<string, unknown>)[ENGINE_STARTED_KEY] === true;
  const request: AppRequest = error instanceof Error
    ? { kind: 'app-engine-error', started, message: `${error.name}: ${error.message}`, stack: error.stack ?? null }
    : { kind: 'app-engine-error', started, message: `Not an Error: ${typeof error}`, stack: null };
  chrome.runtime.sendMessage(request).catch((failure: unknown) => console.error('Photo Cleaner: could not report an error to the service worker', failure));
}

addEventListener('error', (event: ErrorEvent) => report(event.error ?? new Error(event.message)));
addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => report(event.reason));
