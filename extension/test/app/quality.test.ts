// The quality measurements must equal the desktop worker's (quality.py, OpenCV + PIL): reference
// values below were produced by the worker itself; the port matched it to 1e-16 on random images.

import { describe, expect, it } from 'vitest';
import { measureQuality } from '../../src/app/ai/quality';

function rgba(rgb: number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray((rgb.length / 3) * 4);
  for (let i = 0; i < rgb.length / 3; i++) {
    out.set([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, 255], i * 4);
  }
  return out;
}

describe('quality, as the desktop worker measures it', () => {
  it('matches the worker on a 1×5 image (borders reflect at both ends)', () => {
    const q = measureQuality({ data: rgba([0, 16, 36, 9, 93, 41, 184, 248, 31, 61, 242, 227, 217, 18, 73]), width: 1, height: 5 });
    expect(q.sharpness).toBeCloseTo(17592.96, 9);
    expect(q.brightness).toBeCloseTo(109.8, 9);
  });

  it('matches the worker on a 3×1 image', () => {
    const q = measureQuality({ data: rgba([240, 6, 128, 40, 155, 156, 161, 143, 11]), width: 3, height: 1 });
    expect(q.sharpness).toBeCloseTo(1553.5555555555554, 9);
    expect(q.brightness).toBeCloseTo(114.66666666666667, 9);
  });

  it('a flat image has no sharpness; black and white count as clipped', () => {
    const black = measureQuality({ data: rgba(Array(30).fill(0)), width: 5, height: 2 });
    expect(black).toMatchObject({ sharpness: 0, brightness: 0, clippedDark: 1, clippedBright: 0, width: 5, height: 2 });
    const white = measureQuality({ data: rgba(Array(30).fill(255)), width: 5, height: 2 });
    expect(white).toMatchObject({ sharpness: 0, clippedDark: 0, clippedBright: 1 });
  });

  it('refuses an empty image', () => {
    expect(() => measureQuality({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toThrow();
  });
});
