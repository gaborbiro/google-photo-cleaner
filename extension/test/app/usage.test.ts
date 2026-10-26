import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkedUsage, durationBucket, usageView } from '../../src/app/shared/usage';
import { IndexedDbUsageStore } from '../../src/app/shared/usageStore';
import { UsageSender } from '../../src/app/shared/usageSender';
import { eraseAllData } from '../../src/app/shared/erase';

const config = { measurementId: 'G-TEST123', apiSecret: 'test_secret_only', debug: false };
const event = { name: 'scan_started', params: {} };
function environment(enabled = true) {
  let now = 1_800_000_000_000;
  const factory = new IDBFactory();
  const store = new IndexedDbUsageStore(factory);
  const fetcher = vi.fn().mockResolvedValue({});
  const sender = new UsageSender(store, enabled ? config : null, fetcher, () => now);
  return { factory, store, sender, fetcher, tick: (ms = 1) => { now += ms; }, send: async (receipt?: string) => {
    const state = await store.get();
    await sender.record({ event, receipt, atMs: now, epoch: state.epoch });
  }, now: () => now };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('optional usage collection', () => {
  it('calls native browser fetch with its global receiver so requests reach the network', async () => {
    let requests = 0;
    // Chrome's native fetch rejects a call whose receiver is an ordinary class instance.
    // Node fetch and the other fake transports accept it, masking the missing browser requests.
    vi.stubGlobal('fetch', function (this: unknown) {
      if (this !== globalThis) return Promise.reject(new TypeError('Illegal invocation'));
      requests++;
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const store = new IndexedDbUsageStore(new IDBFactory());
    const sender = new UsageSender(store, config);
    const state = await sender.consent('yes');
    await sender.record({ event, epoch: state.epoch, atMs: Date.now() });
    expect(requests).toBe(1);
  });

  it('has no identity and sends nothing before consent or after refusal; no-op builds stay silent even with consent', async () => {
    const env = environment();
    expect(await env.store.get()).toMatchObject({ answer: 'unknown', clientId: null });
    await env.send();
    await env.sender.consent('no');
    await env.send();
    expect(env.fetcher).not.toHaveBeenCalled();
    expect(await env.store.get()).toMatchObject({ answer: 'no', clientId: null });
    const off = environment(false);
    await off.sender.consent('yes');
    await off.send();
    expect(off.fetcher).not.toHaveBeenCalled();
  });

  it('sends only approved fields, suppresses repeated milestones across worker restarts, and keeps session continuity', async () => {
    const env = environment();
    const state = await env.sender.consent('yes');
    await env.send('local-account:run:started');
    const restarted = new UsageSender(new IndexedDbUsageStore(env.factory), config, env.fetcher, env.now);
    await restarted.record({ event, epoch: state.epoch, atMs: env.now(), receipt: 'local-account:run:started' });
    expect(env.fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(env.fetcher.mock.calls[0][1].body);
    expect(body.client_id).toBe(state.clientId);
    expect(body.events).toEqual([{ name: 'scan_started', params: { schema_version: '1', extension_version: '0.0.0-test', setup_state: 'unknown', session_id: expect.any(Number) } }]);
    expect(JSON.stringify(body)).not.toContain('local-account');
    expect(env.fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    env.tick(30 * 60_000);
    await env.send('second');
    expect((await env.store.get()).sessionId).toBeGreaterThan(body.events[0].params.session_id);
  });

  it('rejects arbitrary strings, extra keys, stale epochs and pre-consent timestamps without leaking them', async () => {
    const env = environment();
    const first = await env.sender.consent('yes');
    const bad = [{ name: 'search_submitted', params: { search_kind: 'passport number' } },
      { name: 'scan_started', params: { account: 'private@example.com' } },
      { ...event, url: 'https://private.example' }, { name: '__proto__', params: {} }];
    for (const item of bad) await env.sender.record({ event: item, epoch: first.epoch, atMs: env.now() });
    await env.sender.record({ event, epoch: first.epoch, atMs: env.now() - 1 });
    env.tick();
    await env.sender.consent('no');
    env.tick();
    const next = await env.sender.consent('yes');
    expect(next.clientId).not.toBe(first.clientId);
    await env.sender.record({ event, epoch: first.epoch, atMs: env.now() });
    expect(env.fetcher).not.toHaveBeenCalled();
    await env.send();
    expect(env.fetcher).toHaveBeenCalledOnce();
  });

  it('withdrawal aborts in-flight requests and refuses events queued before the change', async () => {
    const env = environment();
    env.fetcher.mockImplementation(() => new Promise(() => {}));
    const state = await env.sender.consent('yes');
    await env.send();
    const signal = env.fetcher.mock.calls[0][1].signal as AbortSignal;
    const queued = env.sender.record({ event, epoch: state.epoch, atMs: env.now() });
    await env.sender.consent('no');
    await queued;
    expect(signal.aborted).toBe(true);
    expect(env.fetcher).toHaveBeenCalledOnce();
    env.sender.stop();
  });

  it('erase forgets consent and identity and the same store reconnects; stopped producers cannot recreate a sender identity', async () => {
    const env = environment();
    const state = await env.sender.consent('yes');
    env.sender.stop();
    await eraseAllData(env.factory, { keys: async () => [], delete: async () => true } as unknown as CacheStorage);
    expect(await env.store.get()).toMatchObject({ answer: 'unknown', clientId: null });
    await env.sender.record({ event, epoch: state.epoch, atMs: env.now() });
    expect(env.fetcher).not.toHaveBeenCalled();
  });

  it('drops failures without retry or logs, and preserves producer order', async () => {
    const env = environment();
    const error = vi.spyOn(console, 'error');
    env.fetcher.mockRejectedValue(new Error('private network diagnostic'));
    const state = await env.sender.consent('yes');
    await Promise.all(['scan_started', 'scan_finished'].map((name) => env.sender.record({
      event: { name, params: name === 'scan_finished' ? { duration_bucket: '1m_5m' } : {} }, epoch: state.epoch, atMs: env.now(),
    })));
    expect(env.fetcher.mock.calls.map(([, init]) => JSON.parse(init.body).events[0].name)).toEqual(['scan_started', 'scan_finished']);
    expect(error).not.toHaveBeenCalled();
  });

  it('caps local floods without treating the cap as authentication', async () => {
    const env = environment();
    await env.sender.consent('yes');
    for (let i = 0; i < 125; i++) await env.send();
    expect(env.fetcher).toHaveBeenCalledTimes(120);
    env.tick(60_000);
    await env.send();
    expect(env.fetcher).toHaveBeenCalledTimes(121);
  });
});

describe('privacy vocabulary and view', () => {
  it('validates enums and bucket boundaries rather than accepting arbitrary properties', () => {
    expect(checkedUsage({ name: 'surface_open_result', params: { source_surface: 'popup', target_surface: 'panel', result: 'failed' } })).not.toBeNull();
    expect(checkedUsage({ name: 'surface_ready', params: { surface: 'photos.google.com/account' } })).toBeNull();
    expect([0, 9999, 10000, 60000, 300000, 1800000, 7200000, 28800000, -1, NaN].map(durationBucket)).toEqual([
      'under_10s', 'under_10s', '10s_1m', '1m_5m', '5m_30m', '30m_2h', '2h_8h', '8h_plus', 'unknown', 'unknown',
    ]);
    expect(usageView('unknown', false)).toMatchObject({ ask: true, enabled: false });
    expect(usageView('yes', true)).toMatchObject({ ask: false, enabled: true });
  });
});
