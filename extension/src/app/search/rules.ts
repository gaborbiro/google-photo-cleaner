// How Search ranks the library: the browser twin of the desktop's SearchPhotosUseCase, plus
// "Less like these". A query is a description (its fingerprint from the AI model), example photos
// to find more of, and example photos to find fewer of. Which photos may be shown at all comes from
// the shared protection rules: protected and unknown photos are never shown, only counted.

import { dot } from '../ai/similar';

/** One analysed photo of the library scan, as Search sees it. */
export interface SearchCandidate {
  mediaKey: string;
  vector: Float32Array;
  /** Neither protected nor of unknown status. */
  eligible: boolean;
  /** Already in the trash queue (approved in Duplicates or an earlier sweep). */
  approved: boolean;
}

export interface SearchQuery {
  /** The description's fingerprint; null when searching by examples only. */
  text: Float32Array | null;
  /** "More like these": example photos' fingerprints. */
  more: Float32Array[];
  /** "Less like these". */
  less: Float32Array[];
}

export interface SearchHit {
  mediaKey: string;
  score: number;
  /** 1 for the strongest match. */
  rank: number;
}

export interface SearchRanking {
  hits: SearchHit[];
  /** Among the strongest [limit] matches: protected or unknown photos left out. */
  protectedOrUnknownHidden: number;
  /** Among the strongest [limit] eligible matches: photos already in the trash queue left out. */
  alreadyApprovedHidden: number;
  /** Photos left out because they look more like a "less like these" example than like what is wanted. */
  lessLikeHidden: number;
}

/** How much of the "less like these" direction is taken away from what is wanted. */
export const LESS_WEIGHT = 0.5;

export function normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) throw new Error('Search has nothing to look for: the examples cancel each other out');
  return Float32Array.from(v, (x) => x / norm);
}

function mean(vectors: Float32Array[]): Float32Array {
  const sum = new Float32Array(vectors[0]!.length);
  for (const v of vectors) for (let i = 0; i < v.length; i++) sum[i]! += v[i]!;
  return normalise(sum);
}

/**
 * What is searched for: the description plus the average of the "more" examples, minus a share of
 * the average of the "less" examples (relevance feedback, as search engines do it).
 */
export function searchTarget(query: SearchQuery): Float32Array {
  const wanted = [...(query.text ? [query.text] : []), ...(query.more.length > 0 ? [mean(query.more)] : [])];
  if (wanted.length === 0) throw new Error('Describe what to search for, or select example photos');
  const target = mean(wanted);
  if (query.less.length === 0) return target;
  const away = mean(query.less);
  return normalise(Float32Array.from(target, (x, i) => x - LESS_WEIGHT * away[i]!));
}

/**
 * The strongest [limit] matches that may be shown, strongest first. A photo closer to any "less"
 * example than to everything wanted (the description and each "more" example) is left out too.
 */
export function rankSearch(candidates: SearchCandidate[], query: SearchQuery, limit: number): SearchRanking {
  const target = searchTarget(query);
  const wanted = [...(query.text ? [query.text] : []), ...query.more];
  const scored = candidates.map((c) => ({ c, score: dot(target, c.vector) })).sort((a, b) => b.score - a.score);
  const protectedOrUnknownHidden = scored.slice(0, limit).filter((s) => !s.c.eligible).length;
  let lessLikeHidden = 0;
  const kept = scored.filter((s) => {
    if (!s.c.eligible || query.less.length === 0) return s.c.eligible;
    const nearestLess = Math.max(...query.less.map((v) => dot(v, s.c.vector)));
    const nearestWanted = Math.max(...wanted.map((v) => dot(v, s.c.vector)));
    if (nearestLess > nearestWanted) {
      lessLikeHidden++;
      return false;
    }
    return true;
  });
  const alreadyApprovedHidden = kept.slice(0, limit).filter((s) => s.c.approved).length;
  const hits = kept.filter((s) => !s.c.approved).slice(0, limit).map((s, i) => ({ mediaKey: s.c.mediaKey, score: s.score, rank: i + 1 }));
  return { hits, protectedOrUnknownHidden, alreadyApprovedHidden, lessLikeHidden };
}
