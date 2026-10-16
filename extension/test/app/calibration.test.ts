import { describe, expect, it } from 'vitest';
import { modelKey } from '../../src/app/ai/model';
import { atDetail, calibrate, calibrationView, parseLabels } from '../../src/app/duplicates/calibration';

const at = (degrees: number) => Float32Array.from([Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]);

describe('calibrating the duplicate threshold', () => {
  it('reads the exported labels and refuses anything else', () => {
    expect(parseLabels('{"pairs":[{"a":"x","b":"y","label":"SAME"}]}')).toEqual([{ a: 'x', b: 'y', label: 'SAME' }]);
    expect(() => parseLabels('{"photos":[]}')).toThrow(/Not a labels file/);
    expect(() => parseLabels('{"pairs":[{"a":"x","b":"y","label":"MAYBE"}]}')).toThrow(/Pair 1/);
  });

  it('scores the pairs with the fingerprints, skips photos not analysed, and recommends a threshold', () => {
    const fingerprints = new Map([['a', at(0)], ['b', at(5)], ['c', at(20)], ['d', at(40)]]);
    const result = calibrate([
      { a: 'a', b: 'b', label: 'NEAR_DUPLICATE' }, // cos 5° = 0.9962
      { a: 'a', b: 'c', label: 'DIFFERENT' }, // cos 20° = 0.9397
      { a: 'a', b: 'gone', label: 'SAME' },
    ], fingerprints, 140);
    expect(result.missing).toBe(1);
    expect(result.report).toMatchObject({ labelled: 2, highestDifferent: expect.closeTo(0.9397, 4), recommendedThreshold: 0.94 });

    const view = calibrationView(result);
    expect(view.lines[0]).toBe('Detail 140: 2 labelled pairs scored (1 duplicates, 1 different), 1 skipped (a photo not analysed)');
    expect(view.lines[2]).toBe('Recommended threshold: 0.940 (finds 100.0% of duplicates, none wrongly)');
    expect(view.lines[3]).toBe("At the desktop's 0.925: finds 100.0% of duplicates, 1 wrongly");
    expect(view.rows.filter((r) => r.recommended).map((r) => r.threshold)).toEqual(['0.940']);
    expect(view.rows[0]!.threshold).toBe('0.850');
  });

  it('switching the detail changes which fingerprints are made and scored, keeping the measured speed', () => {
    const settings = { account: 'acc', detail: 140 as const, modelKey: modelKey(140), measuredPhotosPerSecond: 5.3, chosenAtMs: 1 };
    const at70 = atDetail(settings, 70, 2);
    expect(at70).toEqual({ account: 'acc', detail: 70, modelKey: modelKey(70), measuredPhotosPerSecond: 5.3, chosenAtMs: 2 });
    expect(at70.modelKey).not.toBe(settings.modelKey);
    expect(atDetail(at70, 140, 3)).toEqual({ ...settings, chosenAtMs: 3 });
  });
});
