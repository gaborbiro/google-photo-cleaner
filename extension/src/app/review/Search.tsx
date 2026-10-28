// Search & sweep in the review tab: describe photos (or pick examples), select the matches and move
// them to the trash queue. All state and texts come from SearchModel.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { searchKey, searchViewerKey } from '../duplicates/keys';
import { SORTS, type ExampleView, type SearchModel, type SearchTile } from '../search/searchModel';
import { SizeButtons, tileSizeStyle, Toast, useFocusFeedback, usePinnedHeight, useWorkbenchKeys, Viewer } from '../ui/Workbench';


function Tile({ tile, index, focusPulse, model }: { tile: SearchTile; index: number; focusPulse: number; model: SearchModel }) {
  const ref = useRef<HTMLElement>(null);
  const image = useRef<HTMLDivElement>(null);
  useFocusFeedback(ref, image, tile.current, tile.current, focusPulse);
  // The thumbnail (or a sharper one, after the photos were made larger) is fetched once the tile comes near the screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || !tile.imageWanted) return;
    const observer = new IntersectionObserver(([entry]) => entry!.isIntersecting && model.tileVisible(tile.mediaKey), { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [model, tile.mediaKey, tile.imageWanted]);
  return (
    <figure ref={ref} className={`search-tile${tile.selected ? ' selected' : ''}`}>
      <div className="search-tile-image" ref={image} onClick={(e) => model.tileClicked(index, e.shiftKey, e.ctrlKey || e.metaKey)}>
        {tile.imageUrl ? <img src={tile.imageUrl} alt="" draggable={false} /> : <span className="muted small">{tile.error ?? '…'}</span>}
        <button className="expand" title="View large (Enter)" aria-label="View large" tabIndex={-1} onClick={(e) => { e.stopPropagation(); model.openViewer(index); }}>⤢</button>
        <button className="hide-result" title="Hide this result (nothing is trashed)" aria-label="Hide this result" onClick={(e) => { e.stopPropagation(); model.hideResult(tile.mediaKey); }}>×</button>
      </div>
      <figcaption className="small"><a href={tile.link} target="_blank" rel="noreferrer" tabIndex={-1}>{tile.caption}</a></figcaption>
    </figure>
  );
}

function Examples({ label, examples, model }: { label: string; examples: ExampleView[]; model: SearchModel }) {
  if (examples.length === 0) return null;
  return (
    <div className="examples">
      <span className="muted">{label}</span>
      {examples.map((e) => (
        <span key={e.mediaKey} className="example">
          {e.imageUrl ? <img src={e.imageUrl} alt="" /> : <span className="muted small">…</span>}
          <button className="remove" title="No longer an example" aria-label="Remove this example" tabIndex={-1} onClick={() => model.removeExample(e.mediaKey)}>×</button>
        </span>
      ))}
    </div>
  );
}

/** [active]: shown and answering keys; a hidden tab keeps its state but ignores the keyboard. */
export function Search({ model, active, openScan }: { model: SearchModel; active: boolean; openScan: () => void }) {
  const view = useSyncExternalStore(model.subscribe, model.getView);
  const field = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  usePinnedHeight(bar, '--bar-h');

  useWorkbenchKeys({
    active,
    viewerOpen: view.viewer !== null,
    gridKey: searchKey,
    viewerKey: searchViewerKey,
    onGrid: {
      approve: () => model.approve(), selectAll: () => model.selectAll(), enter: () => model.enter(),
      hide: () => model.hideSelected(),
      cancel: () => model.cancel(), more: () => model.addExamples('more'), less: () => model.addExamples('less'), undo: () => model.undo(),
      smaller: () => model.resize(-1), larger: () => model.resize(1),
      left: (h) => model.focusMove(-1, 0, h), right: (h) => model.focusMove(1, 0, h), up: (h) => model.focusMove(0, -1, h), down: (h) => model.focusMove(0, 1, h),
    },
    onViewer: {
      close: () => model.viewerClose(), previous: () => model.viewerStep(-1), next: () => model.viewerStep(1), toggle: () => model.viewerToggle(),
      rotate: () => model.viewerRotate(1),
      hide: () => model.hideSelected(),
    },
  });

  // New results: the keys work the grid, not the search field.
  useEffect(() => {
    if (view.resultsVersion > 0) field.current?.blur();
  }, [view.resultsVersion]);

  // The grid reports how many photos fit in a row, so up and down move by a whole row.
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => model.gridWidthMeasured(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [model, view.tiles.length > 0]);

  // Thumbnails of the examples too.
  useEffect(() => {
    model.loadExampleThumbs();
  }, [model, view.more, view.less]);

  return (
    <div className="search" hidden={!active} style={tileSizeStyle(view.tilePx)}>
      <section className="collapsing search-head">
        <label htmlFor="search-query">Describe the photos</label>
        <p className="muted">{view.introText}</p>
        <form className="row search-form" onSubmit={(e) => { e.preventDefault(); model.searchText(); }}>
          <input
            ref={field}
            id="search-query"
            type="search"
            value={view.query}
            onChange={(e) => model.setQueryText(e.target.value)}
          />
          <button type="submit" className="primary" disabled={view.searching}>Search</button>
          {view.canStartOver && <button type="button" tabIndex={-1} disabled={view.searching} onClick={() => model.startOver()}>Start over</button>}
        </form>
        {view.progressText && <p className="working" role="status"><span className="spinner-inline" />{view.progressText}</p>}
        <Examples label="More like:" examples={view.more} model={model} />
        <Examples label="Less like:" examples={view.less} model={model} />
        {view.hiddenText && <p className="muted small">{view.hiddenText}</p>}
      </section>
      <div className="search-body">
        <section className="pinned-bar" ref={bar} onMouseDown={() => field.current?.blur()}>
          {view.blockedText && (
            <div className="banner tone-caution">
              <strong>⚠ {view.blockedText}</strong>
              <button onClick={openScan}>Open Scan</button>
            </div>
          )}
          {view.resultText && (
            <div className="action-bar">
              <div className="selection">{view.resultText}</div>
              <span className="segmented" role="group" aria-label="Order">
                {SORTS.map((s) => (
                  <button key={s.id} tabIndex={-1} className={s.id === view.sort ? 'selected' : ''} aria-pressed={s.id === view.sort} onClick={() => model.setSort(s.id)}>{s.label}</button>
                ))}
              </span>
            </div>
          )}
          <div className="buttons">
            <button tabIndex={-1} className="danger" onClick={() => model.approve()}><kbd>D</kbd> · Trash selected</button>
            <button tabIndex={-1} disabled={!view.canHideSelected} onClick={() => model.hideSelected()}><kbd>H</kbd> · Hide from results</button>
            <button tabIndex={-1} disabled={view.searching} onClick={() => model.addExamples('more')}><kbd>M</kbd> · More like selected</button>
            <button tabIndex={-1} disabled={view.searching} onClick={() => model.addExamples('less')}><kbd>L</kbd> · Less like selected</button>
            <button tabIndex={-1} onClick={() => model.selectAll()}><kbd>A</kbd> · Select all</button>
            <button tabIndex={-1} onClick={() => model.undo()}><kbd>Z</kbd> · Undo</button>
            <SizeButtons canShrink={view.canShrink} canGrow={view.canGrow} onResize={(d) => model.resize(d)} />
          </div>
          {view.confirmText && (
            <div className={`confirm${view.confirmKind === 'hide' ? ' confirm-hide' : ''}`} role="alertdialog" aria-label={view.confirmTitle}>
              <strong>{view.confirmText}</strong>
              <div className="buttons">
                <button className={view.confirmKind === 'trash' ? 'danger' : 'primary'} onClick={() => model.enter()}><kbd>Enter</kbd> · {view.confirmButtonText}</button>
                <button onClick={() => model.cancel()}><kbd>Esc</kbd> · Cancel</button>
              </div>
            </div>
          )}
        </section>
        <div className="search-grid" ref={grid} onMouseDown={() => field.current?.blur()}>
          {view.tiles.map((t, i) => <Tile key={t.mediaKey} tile={t} index={i} focusPulse={view.focusPulse} model={model} />)}
        </div>
        {view.showMoreVisible && <div className="show-more"><button disabled={view.searching} onClick={() => model.showMore()}>Show more</button></div>}
      </div>
      {view.viewer && (
        <Viewer viewer={view.viewer} onPrevious={() => model.viewerStep(-1)} onNext={() => model.viewerStep(1)} onToggle={() => model.viewerToggle()} onRotate={(d) => model.viewerRotate(d)} onClose={() => model.viewerClose()} />
      )}
      <Toast notice={view.notice} />
    </div>
  );
}
