// The structure of a raw answer from Google without its values, for finding out why an answer
// didn't fit. Strings become their kind and length: "key:44" (a Google ID, starting AF1Qip),
// "id:27" (only letters, digits, - and _), "url" (an address) or "s:12" (anything else, such as a
// title); "s:0" is the empty string. Whole numbers under 1000 (codes, small counts), booleans and
// nulls are kept; other numbers (timestamps, sizes, coordinates) become "n". Object keys are kept
// when they are field numbers, as in Google's answers, and numbered "k1", "k2"… otherwise. Long
// lists end with "…+N" (N more), and nesting deeper than the limit becomes "…".

export interface ShapeLimits {
  depth: number;
  items: number;
}

/** For a whole answer. */
export const ANSWER_LIMITS: ShapeLimits = { depth: 8, items: 24 };
/** For the one part of an answer where the reading gave up. */
export const FOCUS_LIMITS: ShapeLimits = { depth: 12, items: 64 };

const GOOGLE_ID = /^AF1Qip[A-Za-z0-9_-]+$/;
const ID_LIKE = /^[A-Za-z0-9_-]+$/;
const ADDRESS = /^[a-z][a-z0-9+.-]*:\/\//i;
const FIELD_NUMBER = /^\d{1,12}$/;

export function stringShape(value: string): string {
  if (value === '') return 's:0';
  if (ADDRESS.test(value)) return 'url';
  if (GOOGLE_ID.test(value)) return `key:${value.length}`;
  if (ID_LIKE.test(value)) return `id:${value.length}`;
  return `s:${value.length}`;
}

export function skeleton(value: unknown, limits: ShapeLimits = ANSWER_LIMITS, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return stringShape(value);
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) < 1000 ? value : 'n';
  if (typeof value !== 'object') return typeof value;
  if (depth >= limits.depth) return '…';
  if (Array.isArray(value)) {
    const head = value.slice(0, limits.items).map((v) => skeleton(v, limits, depth + 1));
    return value.length > limits.items ? [...head, `…+${value.length - limits.items}`] : head;
  }
  const out: Record<string, unknown> = {};
  let other = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[FIELD_NUMBER.test(k) ? k : `k${++other}`] = skeleton(v, limits, depth + 1);
  return out;
}

/** The part of [value] at [path] (list positions and field names from the top); undefined when there is none. */
export function partAt(value: unknown, path: (number | string)[]): unknown {
  let part = value;
  for (const step of path) {
    if (typeof part !== 'object' || part === null) return undefined;
    part = (part as Record<string | number, unknown>)[step];
  }
  return part;
}
