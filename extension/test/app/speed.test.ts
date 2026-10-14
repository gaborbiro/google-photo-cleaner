import { describe, expect, it } from 'vitest';
import { SpeedMeter, type PhotoTiming } from '../../src/app/ai/speed';

const timing = (ai: number, rest: Partial<PhotoTiming> = {}): PhotoTiming => ({ other: 0, pace: 0, preview: 0, ai, save: 0, ...rest });

describe('speed over the last minute', () => {
  it('nothing to say before the first photo', () => {
    expect(new SpeedMeter(0).recent(5_000)).toBeNull();
  });

  it('early on it is the speed since the start', () => {
    const meter = new SpeedMeter(0);
    for (let t = 200; t <= 10_000; t += 200) meter.record(t, timing(200));
    expect(meter.recent(10_000)!.photosPerSecond).toBeCloseTo(5);
  });

  it('a slow start is forgotten after a minute: ticking Full speed shows straight away', () => {
    const meter = new SpeedMeter(0);
    let t = 0;
    while (t < 120_000) meter.record((t += 400), timing(200, { pace: 200 })); // gentle: 2.5/s
    while (t < 240_000) meter.record((t += 200), timing(200)); // full speed: 5/s
    const recent = meter.recent(t)!;
    expect(recent.photosPerSecond).toBeCloseTo(5);
    expect(recent.perPhoto).toEqual(timing(200));
  });

  it('shows where the time goes, averaged per photo', () => {
    const meter = new SpeedMeter(0);
    meter.record(1_000, timing(300, { preview: 100, save: 10 }));
    meter.record(2_000, timing(100, { preview: 0, save: 30, other: 20 }));
    expect(meter.recent(2_000)!.perPhoto).toEqual({ other: 10, pace: 0, preview: 50, ai: 200, save: 20 });
  });
});
