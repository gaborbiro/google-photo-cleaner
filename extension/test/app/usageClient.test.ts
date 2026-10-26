import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../src/app/shared/usage', async (original) => ({
  ...await original<typeof import('../../src/app/shared/usage')>(),
  USAGE_CONFIG: { measurementId: 'G-TEST123', apiSecret: 'test_secret_only', debug: true },
}));

let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  send = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('configured producers drop events before consent, never replay them, and attach the current consent epoch', async () => {
  const client = await import('../../src/app/shared/usageClient');
  const { IndexedDbUsageStore } = await import('../../src/app/shared/usageStore');
  const { UsageSender } = await import('../../src/app/shared/usageSender');
  const store = new IndexedDbUsageStore(indexedDB);
  const sender = new UsageSender(store, null);
  await client.refreshUsageConsent();
  client.emitUsage({ name: 'scan_started', params: {} });
  expect(send).not.toHaveBeenCalled();
  const state = await sender.consent('yes');
  await client.refreshUsageConsent();
  expect(send).not.toHaveBeenCalled();
  client.emitUsage({ name: 'scan_started', params: {} }, 'local-only-key');
  expect(send).toHaveBeenCalledExactlyOnceWith({ kind: 'app-usage-event', input: {
    event: { name: 'scan_started', params: {} }, epoch: state.epoch, atMs: expect.any(Number), receipt: 'local-only-key', engagementMs: undefined,
  } });
  await sender.consent('no');
  await client.refreshUsageConsent();
  client.emitUsage({ name: 'scan_started', params: {} });
  expect(send).toHaveBeenCalledOnce();
});

it('a stopped or restarting worker cannot turn a producer error into an application error', async () => {
  const client = await import('../../src/app/shared/usageClient');
  const { IndexedDbUsageStore } = await import('../../src/app/shared/usageStore');
  const { UsageSender } = await import('../../src/app/shared/usageSender');
  await new UsageSender(new IndexedDbUsageStore(indexedDB), null).consent('yes');
  await client.refreshUsageConsent();
  send.mockImplementation(() => { throw new Error('worker stopped'); });
  expect(() => client.emitUsage({ name: 'scan_started', params: {} })).not.toThrow();
});
