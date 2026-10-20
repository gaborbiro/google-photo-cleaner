// The background page, where scans and analyses run, is an offscreen document: Chrome gives it only
// runtime messaging. Anything else it touches throws, the page stops before it runs a single job,
// and every scan sits at "Scanning" with nothing read (as with getManifest in 0.4.33).

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobId, startScanJob } from '../../src/app/shared/job';
import { IndexedDbProblemLog } from '../../src/app/shared/problemLog';
import { IndexedDbJobStore } from '../../src/app/shared/store';
import type { OpResult } from '../../src/shared/protocol';

// The AI model isn't needed to start, nor for a scan.
vi.mock('../../src/app/ai/embedder', () => ({
  TransformersEmbedder: class {},
  decodePreview: async () => { throw new Error('not used'); },
}));

/** What Chrome gives an offscreen document: runtime messaging. Reaching for anything else fails, as in Chrome. */
const MESSAGING = new Set(['id', 'getURL', 'sendMessage', 'onMessage', 'connect', 'onConnect']);

function offscreenChrome(answer: (message: { kind: string; op?: string }) => unknown) {
  const runtime: Record<string, unknown> = {
    id: 'photo-cleaner',
    getURL: (path: string) => `chrome-extension://photo-cleaner/${path}`,
    sendMessage: vi.fn(async (message: { kind: string; op?: string }) => answer(message)),
    onMessage: { addListener: () => {} },
    connect: () => { throw new Error('not used'); },
    onConnect: { addListener: () => {} },
  };
  const strict = new Proxy(runtime, {
    get(target, name) {
      if (typeof name === 'string' && !MESSAGING.has(name)) throw new TypeError(`chrome.runtime.${name} is not available in an offscreen document`);
      return target[name as string];
    },
  });
  return { chrome: new Proxy({ runtime: strict }, {
    get(target, name) {
      if (name !== 'runtime') throw new TypeError(`chrome.${String(name)} is not available in an offscreen document`);
      return target.runtime;
    },
  }), sendMessage: runtime['sendMessage'] as ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sentKinds = (sendMessage: ReturnType<typeof vi.fn>) => sendMessage.mock.calls.map(([m]) => (m as { kind: string; op?: string }).op ?? (m as { kind: string }).kind);

describe('the background page', () => {
  it('starts with only what Chrome gives an offscreen document, and asks to be closed with nothing to run', async () => {
    const { chrome, sendMessage } = offscreenChrome(() => undefined);
    vi.stubGlobal('chrome', chrome);
    await import('../../src/app/engine/main');
    await vi.waitFor(() => expect(sentKinds(sendMessage)).toEqual(['app-engine-idle']), { timeout: 3_000 });
  });

  it('runs a scan there: one that stops on a changed answer is saved as stopped, with its problem kept, before it asks to be closed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const jobs = new IndexedDbJobStore(indexedDB);
    await jobs.update(jobId('library-scan', 'account-a'), () => startScanJob('account-a', Date.now()));
    const { chrome, sendMessage } = offscreenChrome((message): OpResult | undefined => {
      if (message.kind !== 'app-run-op') return undefined;
      if (message.op === 'status') return { ok: true, data: { accountFingerprint: 'account-a' } };
      return { ok: false, error: { kind: 'PROTOCOL', message: 'Library page is not an array', diagnostic: { rpcId: 'lcxiM', at: null, answer: { k1: 's:6' }, focus: null, envelope: null, cause: null } } };
    });
    vi.stubGlobal('chrome', chrome);
    await import('../../src/app/engine/main');
    await vi.waitFor(async () => expect(await jobs.get(jobId('library-scan', 'account-a'))).toMatchObject({ status: 'failed' }), { timeout: 5_000 });
    const sent = () => sentKinds(sendMessage);
    await vi.waitFor(() => expect(sent().lastIndexOf('app-engine-idle')).toBeGreaterThan(sent().indexOf('listLibraryPage')), { timeout: 3_000 });
    // (It also says it is idle each time a saved change finds nothing new to run; the service worker closes it only with no job running.)
    expect(sent().filter((kind) => kind !== 'app-engine-idle')).toEqual(['status', 'listLibraryPage']);
    expect(await new IndexedDbProblemLog(indexedDB).recent(Date.now())).toMatchObject([{
      where: 'scan: library', kind: 'PROTOCOL', version: '0.0.0-test', request: { op: 'listLibraryPage', sent: [] }, answer: { rpcId: 'lcxiM', answer: { k1: 's:6' } },
    }]);
    expect(warn).toHaveBeenCalled();
  }, 10_000);
});
