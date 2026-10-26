import { describe, expect, it } from 'vitest';
import { gridKey, HELD_STEP_MS, HeldArrow, HOLD_DELAY_MS, repeatsWhenHeld, searchKey, searchViewerKey, viewerKey, type KeyPress } from '../../src/app/duplicates/keys';

const press = (key: string, opts: Partial<KeyPress> = {}): KeyPress => ({ key, repeat: false, ctrlKey: false, altKey: false, metaKey: false, inTextField: false, ...opts });

describe('Duplicates keys', () => {
  it('the left hand decides: D trash, F (or K) keep, S skip, A all, Z (or U) undo', () => {
    expect(['d', 'f', 'k', 's', 'a', 'z', 'u', 'D'].map((k) => gridKey(press(k)))).toEqual(
      ['approve', 'keep', 'keep', 'defer', 'focusAll', 'undo', 'undo', 'approve'].map((action) => ({ kind: 'act', action })),
    );
  });

  it('- and + (or =, + without Shift) make the photos smaller and larger, in Duplicates and Search; Ctrl with them still zooms the page', () => {
    for (const keyMap of [gridKey, searchKey]) {
      expect(['-', '+', '='].map((k) => keyMap(press(k)))).toEqual(['smaller', 'larger', 'larger'].map((action) => ({ kind: 'act', action })));
      expect(keyMap(press('+', { ctrlKey: true }))).toEqual({ kind: 'ignore' });
      expect(keyMap(press('-', { inTextField: true }))).toEqual({ kind: 'ignore' });
    }
  });

  it('arrows, Enter and Space work the grid', () => {
    expect(gridKey(press('ArrowUp'))).toEqual({ kind: 'act', action: 'up' });
    expect(gridKey(press('Enter'))).toEqual({ kind: 'act', action: 'open' });
    expect(gridKey(press(' '))).toEqual({ kind: 'act', action: 'toggle' });
  });

  it("the keyboard's own repeats act on nothing: only the arrows keep going when held, at our pace", () => {
    expect(gridKey(press('ArrowRight', { repeat: true }))).toEqual({ kind: 'swallow' });
    expect(viewerKey(press('ArrowLeft', { repeat: true }))).toEqual({ kind: 'swallow' });
    expect(gridKey(press(' ', { repeat: true }))).toEqual({ kind: 'swallow' });
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].every(repeatsWhenHeld)).toBe(true);
    expect([' ', 'd', 'f', 'Enter', 'Escape'].some(repeatsWhenHeld)).toBe(false);
  });

  it('a held arrow repeats first after 300 ms, then every HELD_STEP_MS, until released', () => {
    // A fake clock: a scheduled step runs when its time comes.
    let now = 0;
    let pending: { at: number; run: () => void } | null = null;
    const held = new HeldArrow((ms, run) => {
      const entry = { at: now + ms, run };
      pending = entry;
      return () => {
        if (pending === entry) pending = null;
      };
    });
    const advanceTo = (t: number) => {
      for (let due = pending; due !== null && due.at <= t; due = pending) {
        now = due.at;
        pending = null;
        due.run();
      }
      now = t;
    };
    let steps = 0;
    held.hold('ArrowLeft', () => steps++);
    advanceTo(HOLD_DELAY_MS - 1);
    expect(steps).toBe(0);
    advanceTo(HOLD_DELAY_MS);
    expect(steps).toBe(1);
    advanceTo(HOLD_DELAY_MS + 3 * HELD_STEP_MS);
    expect(steps).toBe(4);
    // Letting go of another key (the previous one, a moment late) doesn't stop the slide.
    held.released('ArrowRight');
    advanceTo(HOLD_DELAY_MS + 4 * HELD_STEP_MS);
    expect(steps).toBe(5);
    held.released('ArrowLeft');
    advanceTo(10_000);
    expect(steps).toBe(5);
    expect(HOLD_DELAY_MS).toBe(300);
  });

  it('typing and shortcuts with Ctrl, Alt or Cmd are left alone', () => {
    expect(gridKey(press('d', { repeat: true }))).toEqual({ kind: 'swallow' });
    expect(gridKey(press('d', { inTextField: true }))).toEqual({ kind: 'ignore' });
    expect(gridKey(press('z', { ctrlKey: true }))).toEqual({ kind: 'ignore' });
    expect(gridKey(press('q'))).toEqual({ kind: 'ignore' });
  });

  it('Search: D trash, A all, Space toggle, M / L more or less like the selection, Enter / Esc for the question, Z undo', () => {
    expect(['d', 'a', ' ', 'm', 'l', 'Enter', 'Escape', 'z', 'ArrowDown'].map((k) => searchKey(press(k)))).toEqual(
      ['approve', 'focusAll', 'toggle', 'more', 'less', 'enter', 'cancel', 'undo', 'down'].map((action) => ({ kind: 'act', action })),
    );
    expect(searchKey(press('m', { inTextField: true }))).toEqual({ kind: 'ignore' }); // typing a description
    expect(searchKey(press('d', { repeat: true }))).toEqual({ kind: 'swallow' });
  });

  it('the viewer takes every key while open', () => {
    expect(viewerKey(press('Escape'))).toEqual({ kind: 'act', action: 'close' });
    expect(viewerKey(press('ArrowRight'))).toEqual({ kind: 'act', action: 'next' });
    expect(viewerKey(press(' '))).toEqual({ kind: 'act', action: 'toggle' });
    expect(viewerKey(press('r'))).toEqual({ kind: 'act', action: 'rotate' });
    expect(viewerKey(press('R'))).toEqual({ kind: 'act', action: 'rotate' });
    expect(viewerKey(press('r', { repeat: true }))).toEqual({ kind: 'swallow' });
    expect(viewerKey(press('d'))).toEqual({ kind: 'swallow' });
    expect(viewerKey(press('Enter'))).toEqual({ kind: 'swallow' });
  });

  it('H hides Search results once, except while typing or using a browser shortcut; Delete does nothing', () => {
    for (const map of [searchKey, searchViewerKey]) {
      expect(map(press('h'))).toEqual({ kind: 'act', action: 'hide' });
      expect(map(press('H'))).toEqual({ kind: 'act', action: 'hide' });
      expect(map(press('h', { repeat: true }))).toEqual({ kind: 'swallow' });
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'inTextField'] as const) {
        expect(map(press('h', { [modifier]: true }))).toEqual({ kind: 'ignore' });
      }
    }
    expect(searchKey(press('Delete'))).toEqual({ kind: 'ignore' });
    expect(searchKey(press('Backspace'))).toEqual({ kind: 'ignore' });
    expect(gridKey(press('h'))).toEqual({ kind: 'ignore' });
    expect(viewerKey(press('h'))).toEqual({ kind: 'swallow' });
  });
});
