// The small rules around the AI analysis: choosing the detail, gentle mode, and similarity.

import { describe, expect, it } from 'vitest';
import { decidePace } from '../../src/app/ai/gentle';
import { chooseDetail, modelKey } from '../../src/app/ai/model';
import { mostSimilar } from '../../src/app/ai/similar';
import { speedCheckText } from '../../src/app/ai/analysis';

describe('choosing the detail', () => {
  it('keeps detail 140 when the whole library takes at most 4 hours', () => {
    expect(chooseDetail(5.7, 17_202)).toBe(140); // RTX: ~50 min
    expect(chooseDetail(1.5, 17_202)).toBe(140); // built-in graphics: ~3¼ h
  });

  it('drops to detail 70 beyond 4 hours', () => {
    expect(chooseDetail(1.5, 50_000)).toBe(70); // ~9 h
    expect(chooseDetail(0, 10)).toBe(70);
  });

  it('fingerprints made differently get different keys, so they are never compared', () => {
    expect(modelKey(140)).not.toBe(modelKey(70));
    expect(modelKey(140)).toContain('/q4/t140/p512');
  });

  it('says what the speed check found, in plain words', () => {
    expect(speedCheckText(5.7, 17_202, 140)).toBe('Speed check: 5.7 photos/s at detail 140, so your 17,202 photos take about 50 min.');
    expect(speedCheckText(1.5, 50_000, 70)).toContain('so this library uses detail 70');
  });
});

describe('gentle mode', () => {
  it('goes at full speed when asked, whatever the computer is doing', () => {
    expect(decidePace({ fullSpeed: true, onBattery: true, userActive: true }, 400)).toEqual({ kind: 'go' });
  });

  it('waits on battery', () => {
    expect(decidePace({ fullSpeed: false, onBattery: true, userActive: false }, 400).kind).toBe('wait');
  });

  it('goes about half speed while the computer is in use', () => {
    expect(decidePace({ fullSpeed: false, onBattery: false, userActive: true }, 400)).toMatchObject({ kind: 'slow', extraMs: 400 });
  });

  it('goes at full speed when nobody is using the computer', () => {
    expect(decidePace({ fullSpeed: false, onBattery: false, userActive: false }, 400)).toEqual({ kind: 'go' });
  });
});

describe('similar photos', () => {
  const v = (...xs: number[]) => Float32Array.from(xs);
  const all = [
    { mediaKey: 'a', vector: v(1, 0, 0) },
    { mediaKey: 'b', vector: v(0.8, 0.6, 0) },
    { mediaKey: 'c', vector: v(0, 1, 0) },
    { mediaKey: 'd', vector: v(0, 0, 1) },
  ];

  it('ranks by similarity, strongest first, leaving the photo itself out', () => {
    expect(mostSimilar(all[0]!, all, 2)).toEqual([
      { mediaKey: 'b', similarity: expect.closeTo(0.8, 6) },
      { mediaKey: 'c', similarity: 0 },
    ]);
  });

  it('refuses to compare fingerprints of different kinds', () => {
    expect(() => mostSimilar({ mediaKey: 'x', vector: v(1, 0) }, all, 1)).toThrow();
  });
});
