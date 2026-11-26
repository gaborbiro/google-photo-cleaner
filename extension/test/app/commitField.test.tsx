// @vitest-environment jsdom
// The developer page's CommitField: a value the page regroups by (a form's check) counts only when committed,
// so typing doesn't move the field away at the first letter (2026-11-25).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CommitField } from '../../src/app/dev/clutterUi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function shown(onCommit: (text: string) => void): HTMLInputElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<CommitField value="Form" label="Screenshots's check" onCommit={onCommit} />));
  return host.querySelector('input')!;
}

/** Types [text] into [input] as React sees typing: its value set natively, then an input event. */
function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const key = (input: HTMLInputElement, k: string) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

describe('a field that counts only when committed', () => {
  it('commits on Enter or on leaving the field, not while typing; Escape puts it back', () => {
    const commits: string[] = [];
    const input = shown((text) => commits.push(text));
    type(input, 'S');
    type(input, 'Screenshots');
    expect(commits).toEqual([]);
    expect(input.value).toBe('Screenshots');
    key(input, 'Enter');
    expect(commits).toEqual(['Screenshots']);
    // Leaving the field commits too.
    type(input, 'Poor quality');
    act(() => void input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(commits).toEqual(['Screenshots', 'Poor quality']);
    // Escape: back to the value the page has, nothing committed.
    type(input, 'Oops');
    key(input, 'Escape');
    expect(input.value).toBe('Form');
    expect(commits).toEqual(['Screenshots', 'Poor quality']);
  });

  it('commits nothing when the text didn’t change', () => {
    const commits: string[] = [];
    const input = shown((text) => commits.push(text));
    key(input, 'Enter');
    act(() => void input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(commits).toEqual([]);
  });
});
