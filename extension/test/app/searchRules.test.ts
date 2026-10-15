// Search's ranking: the desktop's SweepUseCasesTest scenarios, plus "less like these".

import { describe, expect, it } from 'vitest';
import { rankSearch, searchTarget, type SearchCandidate } from '../../src/app/search/rules';

/** A unit vector at [degrees] in a plane: photos 5° apart are 99.6% similar, 90° apart 0%. */
const at = (degrees: number) => Float32Array.from([Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]);

const photo = (mediaKey: string, degrees: number, opts: Partial<SearchCandidate> = {}): SearchCandidate => ({
  mediaKey, vector: at(degrees), eligible: true, approved: false, ...opts,
});

// "boxes" is at 0°: box1 at 0°, box2 at 5°, a favourite box at 2°, something else at 80°.
const library = [photo('box1', 0), photo('box2', 5), photo('favBox', 2, { eligible: false }), photo('other', 80)];
const keys = (r: { hits: { mediaKey: string }[] }) => r.hits.map((h) => h.mediaKey);

describe('Search ranking', () => {
  it('ranks by similarity to the description; protected photos are never shown, only counted', () => {
    const result = rankSearch(library, { text: at(0), more: [], less: [] }, 10);
    expect(keys(result)).toEqual(['box1', 'box2', 'other']);
    expect(result.hits.map((h) => h.rank)).toEqual([1, 2, 3]);
    expect(result.protectedOrUnknownHidden).toBe(1);
  });

  it('keeps the strongest [limit] matches', () => {
    expect(keys(rankSearch(library, { text: at(0), more: [], less: [] }, 2))).toEqual(['box1', 'box2']);
  });

  it('more like the examples: their average, examples included', () => {
    expect(keys(rankSearch(library, { text: null, more: [at(80)], less: [] }, 1))).toEqual(['other']);
  });

  it('photos already in the trash queue are left out and counted', () => {
    const queued = library.map((p) => (p.mediaKey === 'box1' || p.mediaKey === 'box2' ? { ...p, approved: true } : p));
    const result = rankSearch(queued, { text: at(0), more: [], less: [] }, 10);
    expect(keys(result)).toEqual(['other']);
    expect(result.alreadyApprovedHidden).toBe(2);
  });

  it('less like these: photos nearer an unwanted example than to what is wanted drop out', () => {
    // Wanted: around 0°. Unwanted example at 40°: the photo at 30° is nearer to it and goes; 10° stays.
    const photos = [photo('a', 0), photo('b', 10), photo('c', 30), photo('d', 60)];
    const plain = rankSearch(photos, { text: at(0), more: [], less: [] }, 10);
    expect(keys(plain)).toEqual(['a', 'b', 'c', 'd']);
    const fewer = rankSearch(photos, { text: at(0), more: [], less: [at(40)] }, 10);
    expect(keys(fewer)).toEqual(['a', 'b']);
    expect(fewer.lessLikeHidden).toBe(2);
  });

  it('the target leans away from the unwanted direction', () => {
    const target = searchTarget({ text: at(0), more: [], less: [at(90)] });
    expect(target[1]!).toBeLessThan(0); // pushed away from 90°
    expect(Math.hypot(target[0]!, target[1]!)).toBeCloseTo(1);
  });

  it('needs something to look for', () => {
    expect(() => rankSearch(library, { text: null, more: [], less: [at(10)] }, 10)).toThrow(/Describe what to search for/);
  });
});
