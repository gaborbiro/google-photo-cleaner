import { USAGE_CONFIG, type UsageEvent } from './usage';
import { IndexedDbUsageStore } from './usageStore';
import type { UsageState } from './usageStore';
import { CHANGES_CHANNEL } from './constants';

let store: IndexedDbUsageStore | null = null;
let snapshot: UsageState | null = null;
let refreshSnapshot: () => Promise<void> = async () => {};
export function refreshUsageConsent(): Promise<void> { return refreshSnapshot(); }
if (USAGE_CONFIG) {
  try {
    store = new IndexedDbUsageStore();
    let revision = 0;
    const refresh = async () => {
      const read = ++revision;
      await store!.get().then((state) => { if (read === revision) snapshot = state; }).catch(() => { snapshot = null; });
    };
    refreshSnapshot = refresh;
    void refresh();
    const channel = new BroadcastChannel(CHANGES_CHANNEL);
    channel.onmessage = (event) => {
      if (event.data?.kind === 'erased') { revision++; snapshot = null; }
      if (event.data?.kind === 'usage-changed') { snapshot = null; void refresh(); }
    };
  } catch { /* Reporting remains unavailable if its consent cannot be read. */ }
}
let local: ((event: UsageEvent, receipt?: string) => void) | null = null;
/** The worker uses its own sender, rather than sending runtime messages to itself. */
export function bindUsageEmitter(emit: (event: UsageEvent, receipt?: string) => void): void { local = emit; }
/** No background replay. The authoritative worker checks this consent epoch again before sending. */
export function emitUsage(event: UsageEvent, receipt?: string, engagementMs?: number): void {
  if (local) { try { local(event, receipt); } catch { /* best effort */ } return; }
  if (!USAGE_CONFIG || snapshot?.answer !== 'yes') return;
  const atMs = Date.now();
  try {
    void chrome.runtime.sendMessage({ kind: 'app-usage-event', input: { event, epoch: snapshot.epoch, atMs, receipt, engagementMs } }).catch(() => {});
  } catch { /* Optional statistics must never interrupt the product. */ }
}

export function decisionSource(groupId: string): 'search' | 'duplicates' { return groupId.startsWith('sweep:') ? 'search' : 'duplicates'; }
