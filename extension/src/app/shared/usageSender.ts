// The only analytics network sender. Best effort, bounded, and independent of Photos writes.
import { BUILT_VERSION } from './version';
import { checkedUsage, type UsageAnswer, type UsageConfig } from './usage';
import { IndexedDbUsageStore, type UsageState } from './usageStore';

export interface UsageEnvelope { event: unknown; epoch: string; atMs: number; receipt?: string; engagementMs?: number }
const SESSION_MS = 30 * 60_000;
const MAX_RECEIPTS = 1024;

export class UsageSender {
  private pending = Promise.resolve();
  private generation = 0;
  private active = new Set<AbortController>();
  private minute = 0;
  private sent = 0;
  private suspended = false;
  private waiting = 0;
  constructor(private readonly store: IndexedDbUsageStore, private readonly config: UsageConfig | null,
    private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.then(() => {}, () => {});
    return result;
  }
  /** Lets the worker keep the message alive until accepted events have reached their bounded send attempt. */
  settled(): Promise<void> { return this.pending; }
  /** Immediately abort sends, before waiting for storage or closing the engine. */
  stop(): void {
    this.suspended = true;
    this.generation++;
    for (const active of this.active) active.abort();
    this.active.clear();
  }
  async consent(answer: Exclude<UsageAnswer, 'unknown'>, setupState: UsageState['setupState'] = 'unknown'): Promise<UsageState> {
    this.stop();
    const generation = this.generation;
    return this.serial(async () => {
      const state = await this.store.change(() => ({
        id: 'settings', answer, epoch: crypto.randomUUID(), answeredAt: this.now(),
        clientId: answer === 'yes' ? crypto.randomUUID() : null, setupState, sessionId: 0, lastEventAt: 0, receipts: [],
      }));
      if (generation === this.generation) this.suspended = answer !== 'yes';
      return state;
    });
  }
  async record(input: UsageEnvelope): Promise<void> {
    if (!input || typeof input !== 'object') return;
    const event = checkedUsage(input.event);
    if (!this.config || !event || typeof input.epoch !== 'string' || !Number.isFinite(input.atMs) ||
      (input.engagementMs !== undefined && (!Number.isFinite(input.engagementMs) || input.engagementMs < 1 || input.engagementMs > 60_000)) ||
      (input.receipt !== undefined && (typeof input.receipt !== 'string' || input.receipt.length > 240))) return;
    const generation = this.generation;
    if (this.waiting >= 256) return;
    this.waiting++;
    await this.serial(async () => {
      if (generation !== this.generation || this.suspended) return;
      const now = this.now();
      if (input.atMs > now + 1000 || input.atMs < now - 60_000) return;
      const minute = Math.floor(now / 60_000);
      if (minute !== this.minute) { this.minute = minute; this.sent = 0; }
      if (this.sent >= 120 || this.active.size >= 8) return;
      let accepted = false;
      const state = await this.store.change((state) => {
        if (state.answer !== 'yes' || state.epoch !== input.epoch || input.atMs < state.answeredAt ||
          (input.receipt && state.receipts.includes(input.receipt))) return state;
        accepted = true;
        const newSession = !state.sessionId || now - state.lastEventAt >= SESSION_MS;
        return { ...state, lastEventAt: now, sessionId: newSession ? Math.max(Math.floor(now / 1000), state.sessionId + 1) : state.sessionId,
          receipts: input.receipt ? [...state.receipts, input.receipt].slice(-MAX_RECEIPTS) : state.receipts };
      });
      if (!accepted || generation !== this.generation) return;
      this.sent++;
      const controller = new AbortController();
      this.active.add(controller);
      const timer = setTimeout(() => controller.abort(), 5000);
      const url = new URL('https://www.google-analytics.com/mp/collect');
      url.searchParams.set('measurement_id', this.config!.measurementId);
      url.searchParams.set('api_secret', this.config!.apiSecret);
      // Do not include the envelope/receipt, URLs, raw errors, referrers or account data.
      try {
        // Native browser fetch requires Window/WorkerGlobalScope, not this UsageSender, as its receiver.
        void this.fetcher.call(globalThis, url.href, {
          method: 'POST', mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'text/plain' }, signal: controller.signal,
          body: JSON.stringify({ client_id: state.clientId,
            consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
            events: [{ name: event.name, params: { ...event.params, schema_version: '1', extension_version: BUILT_VERSION,
              setup_state: state.setupState, session_id: state.sessionId,
              ...(event.name === 'surface_engagement' && input.engagementMs ? { engagement_time_msec: Math.round(input.engagementMs) } : {}),
              ...(this.config!.debug ? { debug_mode: 1 } : {}) } }] }),
        }).catch(() => {}).finally(() => { clearTimeout(timer); this.active.delete(controller); });
      } catch { clearTimeout(timer); this.active.delete(controller); }
    }).catch(() => {}).finally(() => { this.waiting--; });
  }
}
