// What the user is told when Google Photos answers in a way Photo Cleaner can't use.

import { describe, expect, it, vi } from 'vitest';
import { PlainError, plainMessage } from '../../src/app/shared/errors';
import { googleProblemLine, logGoogleProblem, NO_PHOTOS_TAB, previewProblemText, tabProblem } from '../../src/app/shared/googleProblems';
import type { OpError } from '../../src/shared/protocol';

const failure = (kind: OpError['kind']): OpError => ({ kind, message: kind });

describe('Google Photos problems', () => {
  it('without a tab signed in to the account, the most telling reason wins', () => {
    expect(tabProblem([])).toBe(NO_PHOTOS_TAB); // no tab answered at all
    expect(tabProblem([failure('TRANSIENT')]).kind).toBe('TRANSIENT');
    expect(tabProblem([failure('TRANSIENT'), failure('SESSION')]).kind).toBe('SESSION');
    // A changed answer from Google: waiting for a tab or a sign-in would never help.
    expect(tabProblem([failure('SESSION'), failure('PROTOCOL')]).kind).toBe('PROTOCOL');
    expect(tabProblem([failure('BAD_REQUEST'), failure('SESSION')]).kind).toBe('BAD_REQUEST');
  });

  it('a missing preview says why', () => {
    expect(previewProblemText('NO_PHOTOS_TAB')).toBe('Preview unavailable: open Google Photos');
    expect(previewProblemText('SESSION')).toBe('Preview unavailable: Google Photos is signed out');
    expect(previewProblemText('PROTOCOL')).toBe('Preview unavailable: Photo Cleaner needs an update');
    expect(previewProblemText('PREVIEW_UNAVAILABLE')).toBe('Preview unavailable');
    expect(previewProblemText(null)).toBe('Preview unavailable');
  });

  it("Google's details are logged and kept for a support request, without addresses or IDs", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const problem = logGoogleProblem('analysis: preview', {
      kind: 'PROTOCOL',
      message: 'Cannot read AF1QipNabcdefghijklmnopqrstuvwxyz0123456789ABCDE at https://lh3.googleusercontent.com/pw/ABC=w224',
      httpStatus: 400,
    });
    expect(problem).toEqual({ where: 'analysis: preview', kind: 'PROTOCOL', message: 'Cannot read … at …', rpcCode: null, httpStatus: 400 });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/AF1Qip|googleusercontent/);
    expect(logGoogleProblem('account check', { kind: 'PROTOCOL', message: 'Signed in as someone.private@example.com' }).message).toBe('Signed in as …');
    warn.mockRestore();
    // The fixed messages stay readable.
    expect(googleProblemLine({ where: 'scan: library', kind: 'PROTOCOL', message: 'Parser item count differs from raw item count', rpcCode: null, httpStatus: null }))
      .toBe('For support: scan: library · PROTOCOL · Parser item count differs from raw item count');
    expect(googleProblemLine({ where: 'analysis: library', kind: 'RPC_ERROR', message: 'RPC lcxiM returned error code 3', rpcCode: 3, httpStatus: null }))
      .toBe('For support: analysis: library · RPC_ERROR · RPC lcxiM returned error code 3 · code 3');
  });

  it('only messages written for the user are shown as they are; anything else gets the plain fallback', () => {
    expect(plainMessage(new PlainError('Free up some space, then resume.'), 'fallback')).toBe('Free up some space, then resume.');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(plainMessage(new DOMException('QuotaExceededError'), 'Something went wrong.')).toBe('Something went wrong.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
