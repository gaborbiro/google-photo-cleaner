// The Duplicates review in the review tab: status lines that scroll away, a pinned action bar,
// one group at a time, the viewer and toasts. All state and texts come from DuplicatesReview.

import { type RefObject, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { gridKey } from '../duplicates/keys';
import { DuplicatesReview, type DuplicatesView, type TileView } from '../duplicates/reviewModel';
import { trashQueueStatus } from '../duplicates/session';
import { onJobsChanged } from '../shared/store';
import { ProtectionLine } from '../ui/JobCard';
import { SizeButtons, tileSizeStyle, Toast, useFocusFeedback, usePinnedHeight, useWorkbenchKeys, Viewer } from '../ui/Workbench';
import type { EmbeddingStats } from './embeddingStats';

/** The space between the pinned bar and the group (the gap in .duplicates-body). */
const GAP_PX = 24;

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
 * Reads the background trash queue's status for sweeps from Search as well as Duplicates' decisions.
 */
export function useTrashQueueStatus(account: string | null, review: DuplicatesReview | null): void {
  useEffect(() => {
    if (account === null || review === null) return;
    let alive = true;
    const load = () => {
      void trashQueueStatus(account).then(
        (status) => alive && review.setQueueStatus(status),
        (error: unknown) => console.error('Photo Cleaner: could not read the trash queue', error),
      );
    };
    load();
    const stop = onJobsChanged(load);
    return () => {
      alive = false;
      stop();
    };
  }, [account, review]);
}

function Tile({ tile, focusPulse, review, stats }: { tile: TileView; focusPulse: number; review: DuplicatesReview; stats: EmbeddingStats }) {
  const ref = useRef<HTMLElement>(null);
  const image = useRef<HTMLDivElement>(null);
  useFocusFeedback(ref, image, tile.focused, tile.current, focusPulse);
  return (
    <figure ref={ref} className={`tile tone-${tile.tone}${tile.focused ? ' focused' : ''}`}>
      <div className="tile-image" ref={image} onContextMenu={() => stats.pointAt(tile.mediaKey)} onClick={(e) => review.tileClicked(tile.mediaKey, e.shiftKey, e.ctrlKey || e.metaKey)}>
        {tile.imageUrl ? <img src={tile.imageUrl} alt="" draggable={false} /> : <span className="muted small">{tile.error ?? 'Loading…'}</span>}
        {tile.newBadge && <span className="new-badge">NEW</span>}
        <button className="expand" title="View large (Enter)" aria-label="View large" tabIndex={-1} onClick={(e) => { e.stopPropagation(); review.openViewer(tile.mediaKey); }}>⤢</button>
      </div>
      <figcaption>
        <strong>{tile.label}</strong>
        {tile.similarityText && <span className="mono">{tile.similarityText}</span>}
        {tile.reasons.length > 0 && <span className="reasons">{tile.reasons.map((r) => <span key={r}>{r}</span>)}</span>}
        <span className="muted mono">{tile.caption}</span>
        <a href={tile.link} target="_blank" rel="noreferrer" tabIndex={-1}>Open in Google Photos <span aria-hidden="true">↗</span></a>
      </figcaption>
    </figure>
  );
}

function Status({ view, protectionText, openScan, openSettings }: { view: DuplicatesView; protectionText: string | null; openScan: () => void; openSettings: () => void }) {
  return (
    <section className="collapsing status-lines">
      {view.ruleText && <p>{view.ruleText}</p>}
      <ProtectionLine text={protectionText} openSettings={openSettings} />
      {/* Why nothing can be reviewed yet (in the place of the counts), or why nothing can be trashed yet. */}
      {view.blockedText && (
        <div className="banner tone-caution">
          <strong>⚠ {view.blockedText}</strong>
          <button onClick={openScan}>Open Scan</button>
        </div>
      )}
      {view.groupsText && <strong>{view.groupsText}</strong>}
      {view.notAnalysedText && <span className="warn">{view.notAnalysedText}</span>}
      {view.queueText && <span className="muted">{view.queueText}</span>}
      {view.queueWaitingText && <span className="warn">{view.queueWaitingText}</span>}
    </section>
  );
}

const BUTTONS: { key: string; label: string; act: (r: DuplicatesReview) => void; trash?: boolean }[] = [
  { key: 'D', label: 'Trash selected', act: (r) => r.approve(), trash: true },
  { key: 'Space', label: 'Toggle trash', act: (r) => r.toggleFocused() },
  { key: 'F', label: 'Keep all', act: (r) => r.keep() },
  { key: 'S', label: 'Skip', act: (r) => r.defer() },
  { key: 'A', label: 'Select all photos', act: (r) => r.focusAll() },
  { key: 'Z', label: 'Undo', act: (r) => r.undo() },
];

/**
 * The Duplicates tab. [refreshKey]: null while the jobs are still loading; the groups are (re)built
 * when it becomes or changes to a value. [onSearchLike]: "Search more like these" with the group's photos.
 */
export function Duplicates({ review, stats, active, refreshKey, protectionText, openScan, openSettings, onSearchLike }: {
  review: DuplicatesReview; active: boolean; refreshKey: string | null; protectionText: string | null;
  stats: EmbeddingStats;
  openScan: () => void; openSettings: () => void; onSearchLike: (mediaKeys: string[]) => void;
}) {
  // Built when the tab opens, and again when a library scan or analysis finishes.
  useEffect(() => {
    if (refreshKey !== null) review.show();
  }, [review, refreshKey]);
  return <DuplicatesScreen review={review} stats={stats} active={active} protectionText={protectionText} openScan={openScan} openSettings={openSettings} onSearchLike={onSearchLike} />;
}

/** What the Duplicates tab shows and how it answers keys and clicks. [active]: shown and answering keys. */
export function DuplicatesScreen({ review, stats, active, protectionText, openScan, openSettings, onSearchLike }: {
  review: DuplicatesReview; active: boolean; protectionText: string | null;
  stats: EmbeddingStats;
  openScan: () => void; openSettings: () => void; onSearchLike: (mediaKeys: string[]) => void;
}) {
  const view = useSyncExternalStore(review.subscribe, review.getView);
  useEffect(() => { review.setUsageActive(active); return () => review.setUsageActive(false); }, [review, active]);
  useWorkbenchKeys({
    active,
    viewerOpen: view.viewer !== null,
    gridKey,
    onGrid: {
      approve: () => review.approve(), keep: () => review.keep(), defer: () => review.defer(), focusAll: () => review.focusAll(),
      undo: () => review.undo(), open: () => review.openFocused(), toggle: () => review.toggleFocused(),
      smaller: () => review.resize(-1), larger: () => review.resize(1),
      left: (h, s) => review.focusMove(-1, 0, h, s), right: (h, s) => review.focusMove(1, 0, h, s), up: (h, s) => review.focusMove(0, -1, h, s), down: (h, s) => review.focusMove(0, 1, h, s),
    },
    onViewer: {
      close: () => review.viewerClose(), previous: () => review.viewerStep(-1), next: () => review.viewerStep(1), toggle: () => review.viewerToggle(),
      rotate: () => review.viewerRotate(1),
    },
  });

  const grid = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const card = useRef<HTMLElement>(null);
  useTopRowInView(view.group?.id ?? null, bar, card);
  usePinnedHeight(bar, '--bar-h');
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    // A hidden tab measures 0: keep the last real width.
    const observer = new ResizeObserver(([entry]) => entry!.contentRect.width > 0 && review.gridWidthMeasured(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [review, view.group !== null]);

  return (
    <div className="duplicates" hidden={!active} style={tileSizeStyle(view.tilePx)} onClick={(e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.tile-image, button, a, input, select, textarea')) review.clearOutline();
    }}>
      <Status view={view} protectionText={protectionText} openScan={openScan} openSettings={openSettings} />
      <div className="duplicates-body">
        <section className="pinned-bar" ref={bar}>
          {view.problemText && <div className="banner tone-negative" role="alert"><strong>{view.problemText}</strong></div>}
          {(view.group || view.workingText) && (
            <div className="action-bar">
              {view.group && (
                <div className="selection">
                  <span>{view.group.selectionText}</span>
                  {view.group.warningText && <span className="tone-text-negative">{view.group.warningText}</span>}
                </div>
              )}
              {view.workingText && <span className="working" role="status"><span className="spinner-inline" />{view.workingText}</span>}
            </div>
          )}
          <div className="buttons">
            {BUTTONS.map((b) => (
              <button key={b.key} tabIndex={-1} className={b.trash ? 'danger' : ''} onClick={() => b.act(review)}><kbd>{b.key}</kbd> · {b.label}</button>
            ))}
            <button tabIndex={-1} onClick={() => { const keys = review.groupKeysOrSay(); if (keys) onSearchLike(keys); }}>Search more like these</button>
            <SizeButtons canShrink={view.canShrink} canGrow={view.canGrow} onResize={(d) => review.resize(d)} />
          </div>
        </section>
        {view.loadingText && <p className="working" role="status"><span className="spinner-inline" />{view.loadingText}</p>}
        {view.emptyText && <p className="muted">{view.emptyText}</p>}
        {view.group && (
          <section className="group" ref={card}>
            <div className="tiles" ref={grid}>
              {view.group.tiles.map((t) => <Tile key={t.mediaKey} tile={t} focusPulse={view.group!.focusPulse} review={review} stats={stats} />)}
            </div>
          </section>
        )}
      </div>
      {view.viewer && (
        <Viewer viewer={view.viewer} onContextPhoto={(mediaKey) => stats.pointAt(mediaKey)} onPrevious={() => review.viewerStep(-1)} onNext={() => review.viewerStep(1)} onToggle={() => review.viewerToggle()} onRotate={(d) => review.viewerRotate(d)} onClose={() => review.viewerClose()} />
      )}
      <Toast notice={view.notice} />
    </div>
  );
}
