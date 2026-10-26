import { describe, expect, it, vi } from 'vitest';
import { UsageLaunches } from '../../src/app/shared/usageLaunches';
import type { UsageEvent } from '../../src/app/shared/usage';
describe('launch observations', () => {
  const request: UsageEvent = { name: 'surface_open_requested', params: { source_surface: 'popup', target_surface: 'panel' } };
  const accepted: UsageEvent = { name: 'surface_open_result', params: { source_surface: 'popup', target_surface: 'panel', result: 'accepted' } };
  const ready: UsageEvent = { name: 'surface_ready', params: { surface: 'panel' } };
  it('orders Chrome acceptance before early render acknowledgements and counts a requested destination only once', () => {
    const send = vi.fn(), probe = vi.fn();
    const tracker = new UsageLaunches(send, probe, () => 1000);
    const record = (event: UsageEvent) => tracker.record({ event, epoch: 'consented', atMs: 1000 });
    record(request); record(ready);
    expect(send.mock.calls.map(([input]) => input.event)).toEqual([request]);
    record(accepted); record(ready);
    expect(send.mock.calls.map(([input]) => input.event)).toEqual([request, accepted, ready]);
    expect(probe).not.toHaveBeenCalled();
    expect(send.mock.calls[2][0].receipt).toMatch(/^launch:/);
  });
  it('probes an already-open destination, does not invent success without a reply, and preserves direct opens', () => {
    const send = vi.fn(), probe = vi.fn();
    const tracker = new UsageLaunches(send, probe, () => 1000);
    const record = (event: UsageEvent) => tracker.record({ event, epoch: 'consented', atMs: 1000 });
    record(request); record(accepted);
    expect(probe).toHaveBeenCalledWith('panel');
    expect(send.mock.calls.map(([input]) => input.event)).toEqual([request, accepted]);
    record(ready);
    expect(send.mock.calls.map(([input]) => input.event)).toEqual([request, accepted, ready]);
    tracker.clear();
    record(ready);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it('records a rejected launch without a successful render and starts a fresh observation on retry', () => {
    const send = vi.fn();
    const tracker = new UsageLaunches(send, vi.fn());
    const record = (event: UsageEvent) => tracker.record({ event, epoch: 'consented', atMs: Date.now() });
    record(request); record({ ...accepted, params: { ...accepted.params, result: 'failed' } });
    record(request); record(accepted); record(ready);
    expect(send.mock.calls.map(([input]) => input.event.name)).toEqual(['surface_open_requested', 'surface_open_result', 'surface_open_requested', 'surface_open_result', 'surface_ready']);
  });
});
