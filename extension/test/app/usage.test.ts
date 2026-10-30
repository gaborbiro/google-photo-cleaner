import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { anyScanFinished, checkedUsage, durationBucket, setupStateOf, usageView } from '../../src/app/shared/usage';
import { IndexedDbUsageStore } from '../../src/app/shared/usageStore';
import { KEEP_MS, MAX_KEPT, UsageSender } from '../../src/app/shared/usageSender';
import { eraseAllData } from '../../src/app/shared/erase';
import type { Job } from '../../src/app/shared/job';

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

  it('before an answer keeps events on this computer, sending nothing; a yes sends them dated when they happened', async () => {
    const env = environment();
    const start = env.now();
    await env.send('local-account:run:started');
    env.tick(40 * 60_000); // a new session
    await env.sender.record({ event: { name: 'scan_finished', params: { duration_bucket: '1m_5m' } }, epoch: '', atMs: env.now() });
    await env.sender.record({ event: { name: 'surface_engagement', params: { surface: 'popup' } }, epoch: '', atMs: env.now(), engagementMs: 15_000 });
    expect(env.fetcher).not.toHaveBeenCalled();
    expect(await env.store.get()).toMatchObject({ answer: 'unknown', clientId: null });
    expect((await env.store.get()).kept.map((k) => k.event.name)).toEqual(['scan_started', 'scan_finished']); // engagement ticks aren't kept

    env.tick(60_000);
    const state = await env.sender.consent('yes');
    expect(env.fetcher).toHaveBeenCalledOnce();
    const body = JSON.parse(env.fetcher.mock.calls[0][1].body);
    expect(body.client_id).toBe(state.clientId);
    expect(body.events.map((e: { name: string }) => e.name)).toEqual(['scan_started', 'scan_finished']);
    expect(body.events.map((e: { timestamp_micros: number }) => e.timestamp_micros)).toEqual([start * 1000, (start + 40 * 60_000) * 1000]);
    const [first, second] = body.events.map((e: { params: { session_id: number } }) => e.params.session_id);
    expect(second).toBeGreaterThan(first);
    expect(JSON.stringify(body)).not.toContain('local-account');
    expect((await env.store.get()).kept).toEqual([]);

    // The kept milestone counts as reported: not sent again.
    await env.sender.record({ event, epoch: state.epoch, atMs: env.now(), receipt: 'local-account:run:started' });
    expect(env.fetcher).toHaveBeenCalledOnce();
    // Later events continue the last kept session when they come within half an hour.
    await env.send();
    expect(JSON.parse(env.fetcher.mock.calls[1][1].body).events[0].params.session_id).toBe(second);
  });

  it('a no drops the kept events unsent; nothing older than Google accepts and no more than the cap is kept', async () => {
    const env = environment();
    await env.send();
    await env.sender.consent('no');
    expect((await env.store.get()).kept).toEqual([]);
    await env.sender.consent('yes');
    expect(env.fetcher).not.toHaveBeenCalled();

    const fresh = environment();
    await fresh.send();
    fresh.tick(KEEP_MS);
    for (let i = 0; i < MAX_KEPT + 10; i++) await fresh.send();
    const kept = (await fresh.store.get()).kept;
    expect(kept).toHaveLength(MAX_KEPT);
    expect(kept.every((k) => k.atMs === fresh.now())).toBe(true); // the old one went
    await fresh.sender.consent('yes');
    expect(fresh.fetcher).toHaveBeenCalledTimes(MAX_KEPT / 25); // in batches of 25
    expect(JSON.parse(fresh.fetcher.mock.calls[0][1].body).events).toHaveLength(25);
  });

  it('builds without reporting keep nothing; erasing removes the kept events', async () => {
    const off = environment(false);
    await off.send();
    expect((await off.store.get()).kept).toEqual([]);
    const env = environment();
    await env.send();
    env.sender.stop();
    await eraseAllData(env.factory, { keys: async () => [], delete: async () => true } as unknown as CacheStorage);
    expect((await env.store.get()).kept).toEqual([]);
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
    expect(checkedUsage({ name: 'surface_view', params: { surface: 'settings' } })).not.toBeNull();
  });

  it('asks once a scan has finished; Settings offers it at any time; the popup and panel keep the checkbox, the Scan tab does not', () => {
    for (const place of ['surface', 'question'] as const) {
      expect(usageView('unknown', true, place, false).shown).toBe(false);
      expect(usageView('unknown', true, place, true).shown).toBe(true);
    }
    expect(usageView('unknown', true, 'setting', false).shown).toBe(true);
    expect(usageView('no', true, 'surface', true).shown).toBe(true);
    expect(usageView('no', true, 'question', true).shown).toBe(false);
    expect(usageView('yes', true, 'question', true).shown).toBe(false);
    expect(usageView('no', true, 'setting', false).shown).toBe(true);
    const scan = { kind: 'library-scan', status: 'finished' } as Job;
    expect(anyScanFinished([])).toBe(false);
    expect(anyScanFinished([{ ...scan, status: 'running' } as Job, { ...scan, kind: 'analysis' } as Job])).toBe(false);
    expect(anyScanFinished([scan])).toBe(true);
  });

  it('counts a setup as new when reporting began before it, so a later yes still tells new from existing', () => {
    expect(setupStateOf([], null)).toBe('new');
    expect(setupStateOf([100, 50], 40)).toBe('new');
    expect(setupStateOf([100, 50], 60)).toBe('existing');
    expect(setupStateOf([100], null)).toBe('existing');
  });
});
