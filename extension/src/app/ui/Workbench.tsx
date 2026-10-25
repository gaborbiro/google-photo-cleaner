// What the review tab's workbenches (Duplicates and Search) share: the keyboard (with held arrows
// that slide), the outline's bounce, the large photo viewer and the toast.

import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react';
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

/** The outline's bounce: the photo lifts 3 px and settles back. */
const LIFT: Keyframe[] = [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }];
const LIFT_TIMING: KeyframeAnimationOptions = { duration: 200, easing: 'ease-out' };

/** Whether the system asks for less motion. */
function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * A tile's response to focus: the photo the keys act on ([current]) is scrolled into view (A, which
 * outlines every photo, scrolls nothing), and every focus action bounces the outlined photos.
 */
export function useFocusFeedback(tile: RefObject<HTMLElement | null>, image: RefObject<HTMLElement | null>, focused: boolean, current: boolean, focusPulse: number): void {
  useEffect(() => {
    if (current) tile.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [tile, current, focusPulse]);
  useEffect(() => {
    if (focused && !reducedMotion()) image.current?.animate(LIFT, LIFT_TIMING);
  }, [image, focused, focusPulse]);
}

/**
 * Keeps the CSS variable [name] at [element]'s height, for what is pinned below it (the tabs wrap
 * at narrow widths and zoom). A hidden element measures 0 and leaves the variable as it was.
 */
export function usePinnedHeight(element: RefObject<HTMLElement | null>, name: string): void {
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const height = el.getBoundingClientRect().height;
      if (height > 0) document.documentElement.style.setProperty(name, `${height}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [element, name]);
}

/** The photos' size for the stylesheet (`--tile-px`), on the workbench that holds them. */
export function tileSizeStyle(tilePx: number): CSSProperties {
  return { '--tile-px': `${tilePx}px` } as CSSProperties;
}

/** − and +: the photos one size smaller or larger (the - and + keys do the same). */
export function SizeButtons({ canShrink, canGrow, onResize }: { canShrink: boolean; canGrow: boolean; onResize: (delta: 1 | -1) => void }) {
  return (
    <span className="segmented size-buttons" role="group" aria-label="Photo size">
      <button tabIndex={-1} disabled={!canShrink} title="Smaller photos (-)" aria-label="Smaller photos" onClick={() => onResize(-1)}>−</button>
      <button tabIndex={-1} disabled={!canGrow} title="Larger photos (+)" aria-label="Larger photos" onClick={() => onResize(1)}>+</button>
    </span>
  );
}

export interface ViewerProps {
  viewer: {
    imageUrl: string | null; loading: boolean; statusText: string | null; infoText: string; selectionText: string; tone: string; link: string;
    rotationDeg: number; sideways: boolean; rotationText: string | null;
  };
  onPrevious: () => void;
  onNext: () => void;
  onToggle: () => void;
  onRotate: (delta: 1 | -1) => void;
  onClose: () => void;
}

/** One photo large, framed in what will happen to it; turned for viewing when asked (nothing is saved). */
export function Viewer({ viewer, onPrevious, onNext, onToggle, onRotate, onClose }: ViewerProps) {
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Photo" onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className={`viewer-photo tone-${viewer.tone}`}>
        {viewer.imageUrl
          ? <img src={viewer.imageUrl} alt="" className={viewer.sideways ? 'sideways' : ''} style={{ transform: `rotate(${viewer.rotationDeg}deg)` }} />
          : <span className="muted">Loading…</span>}
        {viewer.loading && viewer.imageUrl && <div className="spinner" />}
      </div>
      <div className="viewer-info">
        <span className="mono">{viewer.infoText}</span>
        <strong className={`tone-text-${viewer.tone}`}>{viewer.selectionText}</strong>
        {viewer.statusText && <span className="muted">{viewer.statusText}</span>}
        {viewer.rotationText && <span className="muted">{viewer.rotationText}</span>}
      </div>
      <div className="viewer-buttons">
        <button tabIndex={-1} onClick={onPrevious}>← Previous</button>
        <button tabIndex={-1} onClick={onNext}>Next →</button>
        <button tabIndex={-1} onClick={onToggle}><kbd>Space</kbd> · Toggle trash</button>
        <button tabIndex={-1} title="Turn anticlockwise, for viewing only" onClick={() => onRotate(-1)}>↺ Rotate left</button>
        <button tabIndex={-1} title="Turn clockwise, for viewing only" onClick={() => onRotate(1)}><kbd>R</kbd> · Rotate right</button>
        <a href={viewer.link} target="_blank" rel="noreferrer"><button tabIndex={-1}>Open in Google Photos <span aria-hidden="true">↗</span></button></a>
        <button tabIndex={-1} onClick={onClose}><kbd>Esc</kbd> · Close</button>
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
    <div key={shown.sequence} className={`toast tone-${shown.tone}`} role="status" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
      {shown.text}
    </div>
  ) : null;
}
