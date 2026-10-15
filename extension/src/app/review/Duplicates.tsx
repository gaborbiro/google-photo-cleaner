// The Duplicates review in the review tab: status lines that scroll away, a pinned action bar,
// one group at a time, the viewer and toasts. All state and texts come from DuplicatesReview.

import { type RefObject, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { gridKey } from '../duplicates/keys';
import { DuplicatesReview, type DuplicatesView, type TileView } from '../duplicates/reviewModel';
import { recoverInterrupted } from '../duplicates/trash';
import { trashQueueDeps, trashQueuePass } from '../duplicates/session';
import type { SearchModel } from '../search/searchModel';
import { Toast, useFocusFeedback, useWorkbenchKeys, Viewer } from '../ui/Workbench';

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

/**
 * Runs the trash queue (simulated, or Google Photos' own with "Trash for real" on) while the review
 * tab is open and reports its counts: for sweeps from Search as well as Duplicates' decisions, so it
 * runs whichever tab is open. Search hears whether trashing is simulated, for its question.
 */
export function useTrashQueue(account: string | null, review: DuplicatesReview | null, search: SearchModel | null): void {
  useEffect(() => {
    if (account === null || review === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pass = async () => {
      try {
        const status = await trashQueuePass(account);
        if (alive) {
          review.setQueueStatus(status);
          search?.setTrashSimulated(status.simulated);
        }
      } catch (error) {
        console.error('Photo Cleaner: the trash queue stopped for now', error);
      }
      if (alive) timer = setTimeout(() => void pass(), TRASH_QUEUE_EVERY_MS);
    };
    void recoverInterrupted(trashQueueDeps(account)).then(pass, (error: unknown) => console.error('Photo Cleaner: could not check interrupted trash requests', error));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [account, review, search]);
}

function Tile({ tile, focusPulse, review }: { tile: TileView; focusPulse: number; review: DuplicatesReview }) {
  const ref = useRef<HTMLElement>(null);
  const image = useRef<HTMLDivElement>(null);
  useFocusFeedback(ref, image, tile.focused, tile.current, focusPulse);
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

/**
 * The Duplicates tab. [refreshKey]: null while the jobs are still loading; the groups are (re)built
 * when it becomes or changes to a value. [onSearchLike]: "Search more like these" with the group's photos.
 */
export function Duplicates({ review, active, refreshKey, openScan, onSearchLike }: {
  review: DuplicatesReview; active: boolean; refreshKey: string | null; openScan: () => void; onSearchLike: (mediaKeys: string[]) => void;
}) {
  // Built when the tab opens, and again when a library scan or analysis finishes.
  useEffect(() => {
    if (refreshKey !== null) review.show();
  }, [review, refreshKey]);
  return <DuplicatesScreen review={review} active={active} openScan={openScan} onSearchLike={onSearchLike} />;
}

/** What the Duplicates tab shows and how it answers keys and clicks. [active]: shown and answering keys. */
export function DuplicatesScreen({ review, active, openScan, onSearchLike }: {
  review: DuplicatesReview; active: boolean; openScan: () => void; onSearchLike: (mediaKeys: string[]) => void;
}) {
  const view = useSyncExternalStore(review.subscribe, review.getView);
  useWorkbenchKeys({
    active,
    viewerOpen: view.viewer !== null,
    gridKey,
    onGrid: {
      approve: () => review.approve(), keep: () => review.keep(), defer: () => review.defer(), focusAll: () => review.focusAll(),
      undo: () => review.undo(), open: () => review.openFocused(), toggle: () => review.toggleFocused(),
      left: (h) => review.focusMove(-1, 0, h), right: (h) => review.focusMove(1, 0, h), up: (h) => review.focusMove(0, -1, h), down: (h) => review.focusMove(0, 1, h),
    },
    onViewer: { close: () => review.viewerClose(), previous: () => review.viewerStep(-1), next: () => review.viewerStep(1), toggle: () => review.viewerToggle() },
  });

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
              <button tabIndex={-1} onClick={() => { const keys = review.groupKeysOrSay(); if (keys) onSearchLike(keys); }}>Search more like these</button>
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
      {view.viewer && (
        <Viewer viewer={view.viewer} onPrevious={() => review.viewerStep(-1)} onNext={() => review.viewerStep(1)} onToggle={() => review.viewerToggle()} onClose={() => review.viewerClose()} />
      )}
      <Toast notice={view.notice} />
    </div>
  );
}
