// The messages between the page script, the relay and the extension.

import { describe, expect, it } from 'vitest';
import { isOpResult } from '../src/shared/protocol';

describe('page script answers', () => {
  it('only well-formed answers are passed on', () => {
    expect(isOpResult({ ok: true, data: { entries: [] } })).toBe(true);
    expect(isOpResult({ ok: false, error: { kind: 'SESSION', message: 'signed out' } })).toBe(true);

    expect(isOpResult(null)).toBe(false);
    expect(isOpResult('ok')).toBe(false);
    expect(isOpResult({ ok: true })).toBe(false); // no data
    expect(isOpResult({ ok: false })).toBe(false); // no error
    expect(isOpResult({ ok: false, error: { kind: 'DELETED', message: 'x' } })).toBe(false); // not a known kind
    expect(isOpResult({ ok: false, error: { kind: 'SESSION' } })).toBe(false); // no message
    expect(isOpResult({ ok: 'yes', data: 1 })).toBe(false);
  });
});
