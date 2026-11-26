import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { cachedRows, ClutterCache, packScores, SCORES_KEPT, scoresKey } from '../../src/app/dev/clutterCache';

const photo = (mediaKey: string, ...v: number[]) => ({ mediaKey, vector: Float32Array.from(v) });

describe('scoresKey', () => {
  const photos = [photo('a', 0.1, 0.2), photo('b', 0.3, 0.4)];
  const key = scoresKey(['a receipt', 'a beach'], photos);

  it('is the same for the same descriptions and photos', () => {
    expect(scoresKey(['a receipt', 'a beach'], [photo('a', 0.1, 0.2), photo('b', 0.3, 0.4)])).toBe(key);
  });

  it('changes with the descriptions, their order, the photos, their order and any fingerprint', () => {
    const others = [
      scoresKey(['a receipt', 'a beach at night'], photos),
      scoresKey(['a beach', 'a receipt'], photos),
      scoresKey(['a receipta beach'], photos),
      scoresKey(['a receipt', 'a beach'], [photos[0]!]),
      scoresKey(['a receipt', 'a beach'], [...photos, photo('c', 0.5, 0.6)]),
      scoresKey(['a receipt', 'a beach'], [photos[1]!, photos[0]!]),
      scoresKey(['a receipt', 'a beach'], [photo('a', 0.1, 0.2), photo('b', 0.3, 0.41)]),
      scoresKey(['a receipt', 'a beach'], [photo('a', 0.1, 0.2), photo('x', 0.3, 0.4)]),
    ];
    expect(new Set([key, ...others]).size).toBe(others.length + 1);
  });

  it('reads a fingerprint that is a view into a larger buffer by its own numbers only', () => {
    const big = Float32Array.from([9, 0.1, 0.2, 9]);
    expect(scoresKey(['x'], [{ mediaKey: 'a', vector: big.subarray(1, 3) }])).toBe(scoresKey(['x'], [photo('a', 0.1, 0.2)]));
  });
});

describe('packScores and cachedRows', () => {
  it('give back every photo’s row', () => {
    const rows = new Map([['a', Float32Array.from([1, 2, 3])], ['b', Float32Array.from([4, 5, 6])]]);
    const back = cachedRows(packScores('k', rows, Float32Array.from([1]), 0));
    expect([...back.keys()]).toEqual(['a', 'b']);
    expect([...back.get('b')!]).toEqual([4, 5, 6]);
  });

  it('refuse rows of different widths', () => {
    expect(() => packScores('k', new Map([['a', new Float32Array(2)], ['b', new Float32Array(3)]]), new Float32Array(0), 0)).toThrow('different descriptions');
  });

  it('refuse cached numbers that don’t fit their photos', () => {
    expect(() => cachedRows({ key: 'k', photoKeys: ['a', 'b'], width: 2, raw: new Float32Array(3), overlap: new Float32Array(0), savedAtMs: 0 })).toThrow('don’t fit');
  });
});

describe('ClutterCache', () => {
  it('keeps description fingerprints by text, and finds only those kept', async () => {
    const cache = new ClutterCache(new IDBFactory());
    await cache.keepTexts(new Map([['a receipt', Float32Array.from([1, 2])]]));
    const found = await cache.texts(['a receipt', 'a beach']);
    expect([...found.keys()]).toEqual(['a receipt']);
    expect([...found.get('a receipt')!]).toEqual([1, 2]);
  });

  it('keeps scores by key, the newest few only', async () => {
    const cache = new ClutterCache(new IDBFactory());
    const rows = new Map([['a', Float32Array.from([1, 2])]]);
    for (let i = 0; i <= SCORES_KEPT; i++) await cache.keepScores(packScores(`k${i}`, rows, Float32Array.from([1, 0, 0, 1]), 1000 + i));
    expect(await cache.scores('k0')).toBeNull();
    const newest = await cache.scores(`k${SCORES_KEPT}`);
    expect([...cachedRows(newest!).get('a')!]).toEqual([1, 2]);
    expect([...newest!.overlap]).toEqual([1, 0, 0, 1]);
    for (let i = 1; i <= SCORES_KEPT; i++) expect(await cache.scores(`k${i}`)).not.toBeNull();
  });

  it('fails a read where there is no database, for the page to do the work instead', async () => {
    await expect(new ClutterCache(undefined as unknown as IDBFactory).texts(['x'])).rejects.toThrow();
  });
});
