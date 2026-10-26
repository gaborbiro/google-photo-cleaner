import { checkedUsage } from './usage';
import type { UsageEnvelope } from './usageSender';

/** Local correlation only. A render may arrive before Chrome resolves its opening request. */
export class UsageLaunches {
  private pending = new Map<string, { token: string; at: number; accepted: boolean; ready: UsageEnvelope | null; reported: boolean }>();
  constructor(private readonly send: (input: UsageEnvelope) => void,
    private readonly probe: (surface: 'panel' | 'review') => void, private readonly now: () => number = Date.now) {}
  clear(): void { this.pending.clear(); }
  record(input: UsageEnvelope): void {
    const event = checkedUsage(input.event);
    if (!event) return;
    if (event.name === 'surface_open_requested') {
      this.pending.set(event.params.target_surface, { token: crypto.randomUUID(), at: this.now(), accepted: false, ready: null, reported: false });
    }
    if (event.name === 'surface_ready') {
      const launch = this.pending.get(event.params.surface);
      if (launch && this.now() - launch.at < 60_000) {
        if (!launch.reported) launch.ready = input;
        if (!launch.accepted || launch.reported) return;
        launch.reported = true;
        this.send({ ...input, receipt: `launch:${launch.token}:ready` });
        return;
      }
    }
    this.send(input);
    if (event.name === 'surface_open_result') {
      const launch = this.pending.get(event.params.target_surface);
      if (!launch) return;
      if (event.params.result === 'failed') { this.pending.delete(event.params.target_surface); return; }
      launch.accepted = true;
      if (launch.ready && !launch.reported) {
        launch.reported = true;
        this.send({ ...launch.ready, receipt: `launch:${launch.token}:ready` });
      } else if (!launch.reported) this.probe(event.params.target_surface);
    }
  }
}
