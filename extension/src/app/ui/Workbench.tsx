// What the review tab's workbenches (Duplicates and Search) share: the keyboard (with held arrows
// that slide), the outline's bounce, the large photo viewer and the toast.

import { type RefObject, useEffect, useRef, useState } from 'react';
import { HeldArrow, repeatsWhenHeld, viewerKey, type KeyPress, type KeyResult, type ViewerAction } from '../duplicates/keys';

function pressOf(e: KeyboardEvent): KeyPress {
  const target = e.target as HTMLElement | null;
  const inTextField = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  return { key: e.key, repeat: e.repeat, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, inTextField };
}

/**
 * The keyboard of a workbench while it is [active]: [gridKey] maps a key press to an action, which
 * [onGrid] carries out ([held]: a repeat of a held arrow). While the viewer is open it takes every key.
 */
export function useWorkbenchKeys<A extends string>(options: {
  active: boolean;
  viewerOpen: boolean;
  gridKey: (press: KeyPress) => KeyResult<A>;
  onGrid: Record<A, (held: boolean) => void>;
  onViewer: Record<ViewerAction, () => void>;
}): void {
  const { active, viewerOpen, gridKey } = options;
  // The latest handlers, so the listeners added below never act on an earlier render's.
  const handlers = useRef(options);
  handlers.current = options;
  useEffect(() => {
    if (!active) return;
    const held = new HeldArrow((ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
    /** Acts once now; a held arrow then keeps acting at our pace ([wasHeld] true for those repeats). */
    const act = (key: string, action: (wasHeld: boolean) => void) => {
      action(false);
      if (repeatsWhenHeld(key)) held.hold(key, () => action(true));
      else held.release();
    };
    const onKey = (e: KeyboardEvent) => {
      const press = pressOf(e);
      const result = viewerOpen ? viewerKey(press) : gridKey(press);
      if (result.kind === 'ignore') return;
      e.preventDefault();
      if (result.kind === 'swallow') return;
      if (viewerOpen) return act(press.key, handlers.current.onViewer[result.action as ViewerAction]);
      act(press.key, handlers.current.onGrid[result.action as A]);
    };
    const onKeyUp = (e: KeyboardEvent) => held.released(e.key);
    const onBlur = () => held.release();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      held.release();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [active, viewerOpen, gridKey]);
}

/** The outline's bounce: from slightly larger back to normal size, with a little overshoot. */
const POP: Keyframe[] = [{ transform: 'scale(1.05)' }, { transform: 'scale(1)' }];
const POP_TIMING: KeyframeAnimationOptions = { duration: 350, easing: 'cubic-bezier(0.3, 1.8, 0.5, 1)' };

/**
 * A tile's response to focus: the photo the keys act on ([current]) is scrolled into view (A, which
 * outlines every photo, scrolls nothing), and every focus action bounces the outlined photos.
 */
export function useFocusFeedback(tile: RefObject<HTMLElement | null>, image: RefObject<HTMLElement | null>, focused: boolean, current: boolean, focusPulse: number): void {
  useEffect(() => {
    if (current) tile.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [tile, current, focusPulse]);
  useEffect(() => {
    if (focused) image.current?.animate(POP, POP_TIMING);
  }, [image, focused, focusPulse]);
}

export interface ViewerProps {
  viewer: { imageUrl: string | null; loading: boolean; statusText: string | null; infoText: string; selectionText: string; tone: string; link: string };
  onPrevious: () => void;
  onNext: () => void;
  onToggle: () => void;
  onClose: () => void;
}

/** One photo large, framed in what will happen to it. */
export function Viewer({ viewer, onPrevious, onNext, onToggle, onClose }: ViewerProps) {
  return (
    <div className="viewer" onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className={`viewer-photo tone-${viewer.tone}`}>
        {viewer.imageUrl ? <img src={viewer.imageUrl} alt="" /> : <span className="muted">Loading…</span>}
        {viewer.loading && viewer.imageUrl && <div className="spinner" />}
      </div>
      <div className="viewer-info">
        <span>{viewer.infoText}</span>
        <strong className={`tone-text-${viewer.tone}`}>{viewer.selectionText}</strong>
        {viewer.statusText && <span className="muted">{viewer.statusText}</span>}
      </div>
      <div className="viewer-buttons">
        <button tabIndex={-1} onClick={onPrevious}>← Previous</button>
        <button tabIndex={-1} onClick={onNext}>Next →</button>
        <button tabIndex={-1} className="primary" onClick={onToggle}>Space · Toggle trash</button>
        <a href={viewer.link} target="_blank" rel="noreferrer"><button tabIndex={-1}>Open in Google Photos</button></a>
        <button tabIndex={-1} className="primary" onClick={onClose}>Esc · Close</button>
      </div>
    </div>
  );
}

export interface ToastNotice {
  text: string;
  tone: string;
  sequence: number;
  visibleMs: number;
}

/** Bottom right; stays while the mouse is over it, so a longer message can be finished. */
export function Toast({ notice }: { notice: ToastNotice | null }) {
  const [shown, setShown] = useState<ToastNotice | null>(null);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    setShown(notice);
  }, [notice]);
  useEffect(() => {
    if (!shown || held) return;
    const timer = setTimeout(() => setShown(null), shown.visibleMs);
    return () => clearTimeout(timer);
  }, [shown, held]);
  return shown ? (
    <div key={shown.sequence} className={`toast tone-${shown.tone}`} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
      {shown.text}
    </div>
  ) : null;
}
