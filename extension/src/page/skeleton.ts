// Content-free structure of a raw RPC value, for diagnosing parser mismatches.
// Strings become "s", large or fractional numbers become "n" (timestamps,
// coordinates, sizes); booleans, nulls and small integer codes are kept.

const MAX_DEPTH = 8;
const MAX_ARRAY = 24;

export function skeleton(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return 's';
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) < 1000 ? value : 'n';
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => skeleton(v, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `…+${value.length - MAX_ARRAY}`] : head;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = skeleton(v, depth + 1);
    return out;
  }
  return typeof value;
}
