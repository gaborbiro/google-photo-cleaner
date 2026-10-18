// The Duplicates keys: the left hand rests on A S D F with Z below; arrows,
// Space and Enter work the grid. Shortcuts work wherever the focus is, except while typing or with
// Ctrl/Alt/Cmd held. A held arrow keeps moving, as in a file manager (at our own pace); any other
// held key counts once, so holding D or Space never decides or toggles more than intended.

export type GridAction = 'approve' | 'keep' | 'defer' | 'focusAll' | 'undo' | 'left' | 'right' | 'up' | 'down' | 'open' | 'toggle';
export type ViewerAction = 'close' | 'previous' | 'next' | 'toggle';

export interface KeyPress {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** Typing in a text field. */
  inTextField: boolean;
}

/** What a key press does; `ignore` lets the browser have it, `swallow` stops it doing anything. */
export type KeyResult<A> = { kind: 'act'; action: A } | { kind: 'swallow' } | { kind: 'ignore' };

const GRID_KEYS: Record<string, GridAction> = {
  d: 'approve', f: 'keep', k: 'keep', s: 'defer', a: 'focusAll', z: 'undo', u: 'undo',
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'open', ' ': 'toggle',
};

const VIEWER_KEYS: Record<string, ViewerAction> = { Escape: 'close', ArrowLeft: 'previous', ArrowRight: 'next', ' ': 'toggle' };

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/** Whether holding [key] keeps it going (the arrows); any other key acts once however long it's held. */
export function repeatsWhenHeld(key: string): boolean {
  return ARROWS.has(key);
}

/** How long an arrow must be held before it starts repeating: shorter than the keyboard's own (about half a second). */
export const HOLD_DELAY_MS = 300;
/** Then one step this often: slower than the keyboard's repeats, easy to follow. */
export const HELD_STEP_MS = 180;

/** Runs [run] after [ms]; returns how to cancel it. */
export type Schedule = (ms: number, run: () => void) => () => void;

/**
 * Repeats a held arrow at its own pace, ignoring the keyboard's repeats (whose delay belongs to the
 * computer's settings): the first repeat after HOLD_DELAY_MS, then every HELD_STEP_MS, until released.
 */
export class HeldArrow {
  private cancel: (() => void) | null = null;
  private key: string | null = null;

  constructor(private readonly schedule: Schedule) {}

  /** The arrow [key] went down and has acted once; [step] repeats it while it stays down. */
  hold(key: string, step: () => void): void {
    this.release();
    this.key = key;
    const next = (ms: number) => {
      this.cancel = this.schedule(ms, () => {
        step();
        next(HELD_STEP_MS);
      });
    };
    next(HOLD_DELAY_MS);
  }

  /** Another key was pressed, or the window lost focus. */
  release(): void {
    this.cancel?.();
    this.cancel = null;
    this.key = null;
  }

  /**
   * [key] went up: stops the slide only if it is the held arrow. Letting go of the previous key a
   * moment after pressing the next one (quick typing) must not stop the new slide.
   */
  released(key: string): void {
    if (key === this.key) this.release();
  }
}

function usable(press: KeyPress): boolean {
  return !press.inTextField && !press.ctrlKey && !press.altKey && !press.metaKey;
}

export function gridKey(press: KeyPress): KeyResult<GridAction> {
  if (!usable(press)) return { kind: 'ignore' };
  const action = GRID_KEYS[press.key.length === 1 ? press.key.toLowerCase() : press.key];
  if (!action) return { kind: 'ignore' };
  // Space never scrolls the page or presses a button. The keyboard's own repeats act on nothing:
  // a held arrow is repeated by HeldArrow instead.
  if (press.repeat) return { kind: 'swallow' };
  return { kind: 'act', action };
}

export type SearchAction = 'approve' | 'focusAll' | 'toggle' | 'enter' | 'cancel' | 'more' | 'less' | 'undo' | 'left' | 'right' | 'up' | 'down';

const SEARCH_KEYS: Record<string, SearchAction> = {
  d: 'approve', a: 'focusAll', ' ': 'toggle', Enter: 'enter', Escape: 'cancel', m: 'more', l: 'less', z: 'undo', u: 'undo',
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
};

/** Search's keys: as in Duplicates, plus M / L (more / less like the selected photos), Enter and Esc for the trash question. */
export function searchKey(press: KeyPress): KeyResult<SearchAction> {
  if (!usable(press)) return { kind: 'ignore' };
  const action = SEARCH_KEYS[press.key.length === 1 ? press.key.toLowerCase() : press.key];
  if (!action) return { kind: 'ignore' };
  if (press.repeat) return { kind: 'swallow' };
  return { kind: 'act', action };
}

/** The viewer takes every key while open, so nothing behind it acts. */
export function viewerKey(press: KeyPress): KeyResult<ViewerAction> {
  if (!usable(press)) return { kind: 'ignore' };
  const action = VIEWER_KEYS[press.key];
  if (!action || press.repeat) return { kind: 'swallow' };
  return { kind: 'act', action };
}
