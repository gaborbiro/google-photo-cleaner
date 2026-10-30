// The only analytics network sender. Best effort, bounded, and independent of Photos writes.
// Before the user answers, events are kept on this computer only and nothing is sent: at most
// MAX_KEPT, none older than KEEP_MS. Allowing sends them, dated when they happened; declining drops them.
import { BUILT_VERSION } from './version';
import { checkedUsage, type UsageAnswer, type UsageConfig, type UsageEvent } from './usage';
import { IndexedDbUsageStore, type KeptUsage, type UsageState } from './usageStore';

export interface UsageEnvelope { event: unknown; epoch: string; atMs: number; receipt?: string; engagementMs?: number }
const SESSION_MS = 30 * 60_000;
const MAX_RECEIPTS = 1024;
/** Enough for a first launch and scan; later events wait for the answer. */
export const MAX_KEPT = 200;
/** Google Analytics accepts events dated at most 72 hours back. */
export const KEEP_MS = 72 * 60 * 60_000;
/** Google Analytics takes at most 25 events in one request. */
const BATCH = 25;

interface Outgoing { event: UsageEvent; sessionId: number; engagementMs?: number; atMs?: number }

/** The kept events still young enough to send, each in its session as if it had been sent then. */
function keptOutgoing(kept: KeptUsage[], now: number): Outgoing[] {
  const items: Outgoing[] = [];
  let sessionId = 0;
  let last = 0;
  for (const k of kept) {
    const event = checkedUsage(k.event);
    if (!event || now - k.atMs >= KEEP_MS) continue;
    if (!sessionId || k.atMs - last >= SESSION_MS) sessionId = Math.max(Math.floor(k.atMs / 1000), sessionId + 1);
    last = k.atMs;
    items.push({ event, sessionId, atMs: k.atMs });
  }
  return items;
}

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
  /** Yes sends the events kept while the question was open; no drops them. */
  async consent(answer: Exclude<UsageAnswer, 'unknown'>, setupState: UsageState['setupState'] = 'unknown'): Promise<UsageState> {
    this.stop();
    const generation = this.generation;
    return this.serial(async () => {
      const now = this.now();
      let replay: Outgoing[] = [];
      const state = await this.store.change((previous) => {
        const firstAnswer = previous.answer === 'unknown';
        replay = answer === 'yes' && firstAnswer ? keptOutgoing(previous.kept, now) : [];
        const last = replay[replay.length - 1];
        return {
          id: 'settings', answer, epoch: crypto.randomUUID(), answeredAt: now,
          clientId: answer === 'yes' ? crypto.randomUUID() : null, setupState,
          sessionId: last?.sessionId ?? 0, lastEventAt: last?.atMs ?? 0,
          // Milestones already kept count as reported, so a yes doesn't send them twice.
          receipts: answer === 'yes' && firstAnswer ? previous.receipts : [], kept: [],
        };
      });
      if (generation === this.generation) this.suspended = answer !== 'yes';
      if (this.config && generation === this.generation) {
        for (let i = 0; i < replay.length; i += BATCH) {
          this.sent++;
          this.post(state, replay.slice(i, i + BATCH));
        }
      }
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
      const network = this.sent < 120 && this.active.size < 8;
      let send = false;
      const state = await this.store.change((state) => {
        if (state.epoch !== input.epoch || (input.receipt && state.receipts.includes(input.receipt))) return state;
        const receipts = input.receipt ? [...state.receipts, input.receipt].slice(-MAX_RECEIPTS) : state.receipts;
        if (state.answer === 'unknown') {
          // Kept, not sent. Engagement ticks every 15 seconds would crowd out the steps that matter.
          const kept = state.kept.filter((k) => now - k.atMs < KEEP_MS);
          if (event.name === 'surface_engagement' || kept.length >= MAX_KEPT) return state;
          return { ...state, receipts, kept: [...kept, { event, atMs: input.atMs }] };
        }
        if (state.answer !== 'yes' || input.atMs < state.answeredAt || !network) return state;
        send = true;
        const newSession = !state.sessionId || now - state.lastEventAt >= SESSION_MS;
        return { ...state, lastEventAt: now, sessionId: newSession ? Math.max(Math.floor(now / 1000), state.sessionId + 1) : state.sessionId, receipts };
      });
      if (!send || generation !== this.generation) return;
      this.sent++;
      this.post(state, [{ event, sessionId: state.sessionId, engagementMs: input.engagementMs }]);
    }).catch(() => {}).finally(() => { this.waiting--; });
  }
  /** One bounded request; kept events carry the time they happened ([Outgoing.atMs]). */
  private post(state: UsageState, items: Outgoing[]): void {
    const controller = new AbortController();
    this.active.add(controller);
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = new URL('https://www.google-analytics.com/mp/collect');
    url.searchParams.set('measurement_id', this.config!.measurementId);
    url.searchParams.set('api_secret', this.config!.apiSecret);
    const dated = items[0]!.atMs;
    // Do not include the envelope/receipt, URLs, raw errors, referrers or account data.
    try {
      // Native browser fetch requires Window/WorkerGlobalScope, not this UsageSender, as its receiver.
      void this.fetcher.call(globalThis, url.href, {
        method: 'POST', mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'text/plain' }, signal: controller.signal,
        body: JSON.stringify({ client_id: state.clientId,
          ...(dated !== undefined ? { timestamp_micros: dated * 1000 } : {}),
          consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
          events: items.map(({ event, sessionId, engagementMs, atMs }) => ({
            name: event.name,
            params: { ...event.params, schema_version: '1', extension_version: BUILT_VERSION,
              setup_state: state.setupState, session_id: sessionId,
              ...(event.name === 'surface_engagement' && engagementMs ? { engagement_time_msec: Math.round(engagementMs) } : {}),
              ...(this.config!.debug ? { debug_mode: 1 } : {}) },
            ...(atMs !== undefined ? { timestamp_micros: atMs * 1000 } : {}),
          })) }),
      }).catch(() => {}).finally(() => { clearTimeout(timer); this.active.delete(controller); });
    } catch { clearTimeout(timer); this.active.delete(controller); }
  }
}
