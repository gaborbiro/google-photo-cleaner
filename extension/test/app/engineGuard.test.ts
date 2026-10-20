// @vitest-environment jsdom
//
// The guard loads before the background page's own code: whatever error nobody caught there,
// it tells the service worker, and whether the page had got going.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_STARTED_KEY } from '../../src/app/shared/constants';

let sendMessage: ReturnType<typeof vi.fn>;

// Loaded once, as in the page; it reaches for chrome when it reports.
beforeAll(async () => {
  await import('../../src/app/engine/guard');
});

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[ENGINE_STARTED_KEY];
  sendMessage = vi.fn(async () => true);
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const thrown = (error: unknown) => window.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }));

describe("the background page's guard", () => {
  it('an error before the page got going says it could not start, with what was thrown', () => {
    const error = new TypeError('chrome.runtime.getManifest is not a function');
    thrown(error);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ kind: 'app-engine-error', started: false, message: 'TypeError: chrome.runtime.getManifest is not a function', stack: error.stack });
  });

  it('once it has started, an error or a rejected promise nobody handled is reported as such', () => {
    (globalThis as Record<string, unknown>)[ENGINE_STARTED_KEY] = true;
    thrown(new RangeError('out of range'));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: 'a string, not an Error' });
    window.dispatchEvent(rejection);
    expect(sendMessage.mock.calls.map(([m]) => [m.started, m.message])).toEqual([[true, 'RangeError: out of range'], [true, 'Not an Error: string']]);
  });

  it('if the service worker cannot be told, the console says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendMessage.mockRejectedValue(new Error('Could not establish connection'));
    thrown(new Error('boom'));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Photo Cleaner: could not report an error to the service worker', expect.any(Error)));
  });
});
