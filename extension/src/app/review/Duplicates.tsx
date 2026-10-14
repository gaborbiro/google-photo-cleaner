// The Duplicates review in the review tab: status lines that scroll away, a pinned action bar,
// one group at a time, the viewer and toasts. All state and texts come from DuplicatesReview.

import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { gridKey, HeldArrow, repeatsWhenHeld, viewerKey, type KeyPress } from '../duplicates/keys';
import { DuplicatesReview, type DuplicatesView, type Notice, type TileView, type ViewerView } from '../duplicates/reviewModel';
import { recoverInterrupted, processTrashQueue } from '../duplicates/trash';
import { reviewDeps, trashQueueDeps } from '../duplicates/session';

const TRASH_QUEUE_EVERY_MS = 2_000;
/** The space between the pinned bar and the group (the gap in .duplicates-body). */
const GAP_PX = 10;

/**
 * When another group comes on while the last one was scrolled down, scrolls up just enough to
 * show its top row under the pinned bar. Never further: collapsed headers stay collapsed, and
 * nothing moves while the top row is already in view.
 */
function useTopRowInView(groupId: string | null, bar: RefObject<HTMLElement | null>, card: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    if (groupId === null || !bar.current || !card.current) return;
    const hiddenBy = bar.current.getBoundingClientRect().bottom + GAP_PX - card.current.getBoundingClientRect().top;
    if (hiddenBy > 0) window.scrollBy({ top: -hiddenBy });
  }, [groupId, bar, card]);
}

function pressOf(e: KeyboardEvent): KeyPress {
  const target = e.target as HTMLElement | null;
  const inTextField = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  return { key: e.key, repeat: e.repeat, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, inTextField };
}

function useKeys(review: DuplicatesReview, viewerOpen: boolean, active: boolean): void {
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
      if (viewerOpen) {
        const result = viewerKey(press);
        if (result.kind === 'ignore') return;
        e.preventDefault();
        if (result.kind === 'swallow') return;
        const viewerActions = {
          close: () => review.viewerClose(), previous: () => review.viewerStep(-1), next: () => review.viewerStep(1), toggle: () => review.viewerToggle(),
        };
        return act(press.key, viewerActions[result.action]);
      }
      const result = gridKey(press);
      if (result.kind === 'ignore') return;
      e.preventDefault();
      if (result.kind === 'swallow') return;
      const actions: Record<typeof result.action, (wasHeld: boolean) => void> = {
        approve: () => review.approve(), keep: () => review.keep(), defer: () => review.defer(), focusAll: () => review.focusAll(),
        undo: () => review.undo(), open: () => review.openFocused(), toggle: () => review.toggleFocused(),
        left: (h) => review.focusMove(-1, 0, h), right: (h) => review.focusMove(1, 0, h), up: (h) => review.focusMove(0, -1, h), down: (h) => review.focusMove(0, 1, h),
      };
      act(press.key, actions[result.action]);
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
  }, [review, viewerOpen, active]);
}

/** Runs the (simulated) trash queue while the tab is open and reports its counts. */
function useTrashQueue(account: string, review: DuplicatesReview): void {
  useEffect(() => {
    const deps = trashQueueDeps(account);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pass = async () => {
      try {
        const status = await processTrashQueue(deps);
        if (alive) review.setQueueStatus(status);
      } catch (error) {
        console.error('The trash queue stopped for now', error);
      }
      if (alive) timer = setTimeout(() => void pass(), TRASH_QUEUE_EVERY_MS);
    };
    void recoverInterrupted(deps).then(pass, (error: unknown) => console.error('Could not check interrupted trash requests', error));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [account, review]);
}

/** The outline's bounce: from slightly larger back to normal size, with a little overshoot. */
const POP: Keyframe[] = [{ transform: 'scale(1.05)' }, { transform: 'scale(1)' }];
const POP_TIMING: KeyframeAnimationOptions = { duration: 350, easing: 'cubic-bezier(0.3, 1.8, 0.5, 1)' };

function Tile({ tile, focusPulse, review }: { tile: TileView; focusPulse: number; review: DuplicatesReview }) {
  const ref = useRef<HTMLElement>(null);
  const image = useRef<HTMLDivElement>(null);
  // Only the photo the keys act on is scrolled to; A (every photo outlined) scrolls nothing.
  useEffect(() => {
    if (tile.current) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [tile.current, focusPulse]);
  // Every focus action bounces the outlined photos, also one that was outlined already.
  useEffect(() => {
    if (tile.focused) image.current?.animate(POP, POP_TIMING);
  }, [tile.focused, focusPulse]);
  return (
    <figure ref={ref} className={`tile tone-${tile.tone}${tile.focused ? ' focused' : ''}`}>
      <div className="tile-image" ref={image} onClick={() => review.tileClicked(tile.mediaKey)}>
        {tile.imageUrl ? <img src={tile.imageUrl} alt="" draggable={false} /> : <span className="muted small">{tile.error ?? 'Loading…'}</span>}
        {tile.newBadge && <span className="new-badge">NEW</span>}
        <button className="expand" title="View large (Enter)" tabIndex={-1} onClick={(e) => { e.stopPropagation(); review.openViewer(tile.mediaKey); }}>⤢</button>
      </div>
      <figcaption>
        <strong className={`tone-text-${tile.tone}`}>{tile.label}</strong>
        {tile.similarityText && <div className="small">{tile.similarityText}</div>}
        {tile.reasons.map((r) => <div key={r} className="small">· {r}</div>)}
        <div className="small muted">{tile.caption}</div>
        <a className="small" href={tile.link} target="_blank" rel="noreferrer" tabIndex={-1}>Open in Google Photos</a>
      </figcaption>
    </figure>
  );
}

function Viewer({ viewer, review }: { viewer: ViewerView; review: DuplicatesReview }) {
  return (
    <div className="viewer" onContextMenu={(e) => { e.preventDefault(); review.viewerClose(); }}>
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
        <button tabIndex={-1} onClick={() => review.viewerStep(-1)}>← Previous</button>
        <button tabIndex={-1} onClick={() => review.viewerStep(1)}>Next →</button>
        <button tabIndex={-1} className="primary" onClick={() => review.viewerToggle()}>Space · Toggle trash</button>
        <a href={viewer.link} target="_blank" rel="noreferrer"><button tabIndex={-1}>Open in Google Photos</button></a>
        <button tabIndex={-1} className="primary" onClick={() => review.viewerClose()}>Esc · Close</button>
      </div>
    </div>
  );
}

/** Stays while the mouse is over it, so a longer message can be finished. */
function Toast({ notice }: { notice: Notice | null }) {
  const [shown, setShown] = useState<Notice | null>(null);
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

function Status({ view }: { view: DuplicatesView }) {
  return (
    <section className="collapsing status-lines">
      {view.ruleText && <p className="small">{view.ruleText}</p>}
      {view.groupsText && <strong>{view.groupsText}</strong>}
      {view.progressText && <strong>{view.progressText}</strong>}
      {view.missingText && <strong className="tone-text-caution">{view.missingText}</strong>}
      {view.queueText && <span className="small">{view.queueText}</span>}
      {view.queueWaitingText && <span className="small warn">{view.queueWaitingText}</span>}
    </section>
  );
}

const BUTTONS: { label: string; act: (r: DuplicatesReview) => void; primary?: boolean }[] = [
  { label: 'D · Trash selected', act: (r) => r.approve(), primary: true },
  { label: 'F · Keep all', act: (r) => r.keep() },
  { label: 'S · Skip', act: (r) => r.defer() },
  { label: 'A · Focus all', act: (r) => r.focusAll() },
  { label: 'Space · Toggle trash', act: (r) => r.toggleFocused() },
  { label: 'Z · Undo', act: (r) => r.undo() },
];

/** The Duplicates tab for [account], wired to its saved data. */
/** [refreshKey]: null while the jobs are still loading; the groups are (re)built when it becomes or changes to a value. */
export function Duplicates({ account, active, refreshKey, openScan }: { account: string; active: boolean; refreshKey: string | null; openScan: () => void }) {
  const review = useMemo(() => new DuplicatesReview(reviewDeps(account)), [account]);
  // Built when the tab opens, and again when a library scan or analysis finishes.
  useEffect(() => {
    if (refreshKey !== null) review.show();
  }, [review, refreshKey]);
  useTrashQueue(account, review);
  return <DuplicatesScreen review={review} active={active} openScan={openScan} />;
}

/** What the Duplicates tab shows and how it answers keys and clicks. */
/** [active]: shown and answering keys; a hidden tab keeps its state but ignores the keyboard. */
export function DuplicatesScreen({ review, active, openScan }: { review: DuplicatesReview; active: boolean; openScan: () => void }) {
  const view = useSyncExternalStore(review.subscribe, review.getView);
  useKeys(review, view.viewer !== null, active);

  const grid = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const card = useRef<HTMLElement>(null);
  useTopRowInView(view.group?.id ?? null, bar, card);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    // A hidden tab measures 0: keep the last real width.
    const observer = new ResizeObserver(([entry]) => entry!.contentRect.width > 0 && review.gridWidthMeasured(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [review, view.group !== null]);

  return (
    <div className="duplicates" hidden={!active}>
      <Status view={view} />
      <div className="duplicates-body">
        <section className="pinned-bar" ref={bar}>
          {view.blockedText && (
            <div className="banner tone-caution">
              <strong>⚠ {view.blockedText}</strong>
              <button onClick={openScan}>Open Scan</button>
            </div>
          )}
          {view.problemText && <div className="banner tone-negative"><strong>{view.problemText}</strong></div>}
          <div className="action-bar">
            <div className="buttons">
              {BUTTONS.map((b) => <button key={b.label} tabIndex={-1} className={b.primary ? 'primary' : ''} onClick={() => b.act(review)}>{b.label}</button>)}
            </div>
            {view.workingText && <span className="working"><span className="spinner-inline" />{view.workingText}</span>}
            {view.group && (
              <div className="selection">
                {view.group.warningText && <strong className="tone-text-negative">{view.group.warningText}</strong>}
                <strong>{view.group.selectionText}</strong>
              </div>
            )}
          </div>
        </section>
        {view.loadingText && <p className="working"><span className="spinner-inline" />{view.loadingText}</p>}
        {view.emptyText && <p className="muted">{view.emptyText}</p>}
        {view.group && (
          <section className="card group-card" ref={card}>
            <div className="tiles" ref={grid}>
              {view.group.tiles.map((t) => <Tile key={t.mediaKey} tile={t} focusPulse={view.group!.focusPulse} review={review} />)}
            </div>
          </section>
        )}
      </div>
      {view.viewer && <Viewer viewer={view.viewer} review={review} />}
      <Toast notice={view.notice} />
    </div>
  );
}
