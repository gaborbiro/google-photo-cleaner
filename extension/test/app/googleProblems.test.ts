// What the user is told when Google Photos answers in a way Photo Cleaner can't use.

import { describe, expect, it } from 'vitest';
import { NO_PHOTOS_TAB, previewProblemText, tabProblem } from '../../src/app/shared/googleProblems';
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
});
