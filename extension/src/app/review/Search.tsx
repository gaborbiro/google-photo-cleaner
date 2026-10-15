// Search & sweep in the review tab: describe photos (or pick examples), select the matches and move
// them to the trash queue. All state and texts come from SearchModel.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { searchKey } from '../duplicates/keys';
import { SORTS, type ExampleView, type SearchModel, type SearchTile } from '../search/searchModel';
import { Toast, useFocusFeedback, useWorkbenchKeys, Viewer } from '../ui/Workbench';


function Tile({ tile, index, focusPulse, model }: { tile: SearchTile; index: number; focusPulse: number; model: SearchModel }) {
  const ref = useRef<HTMLElement>(null);
  const image = useRef<HTMLDivElement>(null);
  useFocusFeedback(ref, image, tile.focused, tile.current, focusPulse);
  // The thumbnail is fetched once the tile comes near the screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || tile.imageUrl) return;
    const observer = new IntersectionObserver(([entry]) => entry!.isIntersecting && model.tileVisible(tile.mediaKey), { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [model, tile.mediaKey, tile.imageUrl]);
  return (
    <figure ref={ref} className={`search-tile${tile.selected ? ' selected' : ''}${tile.focused ? ' focused' : ''}`}>
      <div className="search-tile-image" ref={image} onClick={(e) => model.tileClicked(index, e.shiftKey)}>
        {tile.imageUrl ? <img src={tile.imageUrl} alt="" draggable={false} /> : <span className="muted small">{tile.error ?? '…'}</span>}
        <button className="expand" title="View large (Enter)" tabIndex={-1} onClick={(e) => { e.stopPropagation(); model.openViewer(index); }}>⤢</button>
      </div>
      <figcaption className="small"><a href={tile.link} target="_blank" rel="noreferrer" tabIndex={-1}>{tile.caption}</a></figcaption>
    </figure>
  );
}

function Examples({ label, examples, model }: { label: string; examples: ExampleView[]; model: SearchModel }) {
  if (examples.length === 0) return null;
  return (
    <div className="examples">
      <span className="small muted">{label}</span>
      {examples.map((e) => (
        <span key={e.mediaKey} className="example">
          {e.imageUrl ? <img src={e.imageUrl} alt="" /> : <span className="muted small">…</span>}
          <button className="remove" title="No longer an example" tabIndex={-1} onClick={() => model.removeExample(e.mediaKey)}>×</button>
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

  useWorkbenchKeys({
    active,
    viewerOpen: view.viewer !== null,
    gridKey: searchKey,
    onGrid: {
      approve: () => model.approve(), focusAll: () => model.focusAll(), toggle: () => model.toggleFocused(), enter: () => model.enter(),
      cancel: () => model.cancel(), more: () => model.addExamples('more'), less: () => model.addExamples('less'), undo: () => model.undo(),
      left: (h) => model.focusMove(-1, 0, h), right: (h) => model.focusMove(1, 0, h), up: (h) => model.focusMove(0, -1, h), down: (h) => model.focusMove(0, 1, h),
    },
    onViewer: { close: () => model.viewerClose(), previous: () => model.viewerStep(-1), next: () => model.viewerStep(1), toggle: () => model.viewerToggle() },
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
    <div className="search" hidden={!active}>
      <section className="collapsing search-head">
        <p className="small">{view.introText}</p>
        <form className="row search-form" onSubmit={(e) => { e.preventDefault(); model.searchText(); }}>
          <input
            ref={field}
            type="search"
            placeholder="Describe the photos"
            value={view.query}
            onChange={(e) => model.setQueryText(e.target.value)}
            aria-label="Describe the photos"
          />
          <button type="submit" className="primary" disabled={view.searching}>Search</button>
          <button type="button" tabIndex={-1} disabled={view.searching} onClick={() => model.addExamples('more')}>M · More like selected</button>
          <button type="button" tabIndex={-1} disabled={view.searching} onClick={() => model.addExamples('less')}>L · Less like selected</button>
          {view.canStartOver && <button type="button" tabIndex={-1} disabled={view.searching} onClick={() => model.startOver()}>Start over</button>}
        </form>
        {view.progressText && <p className="working"><span className="spinner-inline" />{view.progressText}</p>}
        <Examples label="More like:" examples={view.more} model={model} />
        <Examples label="Less like:" examples={view.less} model={model} />
        {view.hiddenText && <p className="small muted">{view.hiddenText}</p>}
      </section>
      <div className="search-body">
        <section className="pinned-bar" onMouseDown={() => field.current?.blur()}>
          {view.blockedText && (
            <div className="banner tone-caution">
              <strong>⚠ {view.blockedText}</strong>
              <button onClick={openScan}>Open Scan</button>
            </div>
          )}
          <div className="action-bar">
            <div className="buttons">
              <button tabIndex={-1} className="primary" onClick={() => model.approve()}>D · Trash selected</button>
              <button tabIndex={-1} onClick={() => model.focusAll()}>A · Focus all</button>
              <button tabIndex={-1} onClick={() => model.toggleFocused()}>Space · Toggle trash</button>
              <button tabIndex={-1} onClick={() => model.undo()}>Z · Undo</button>
            </div>
            {view.resultText && (
              <div className="selection row">
                <strong>{view.resultText}</strong>
                <span className="segmented">
                  {SORTS.map((s) => (
                    <button key={s.id} tabIndex={-1} className={s.id === view.sort ? 'selected' : ''} onClick={() => model.setSort(s.id)}>{s.label}</button>
                  ))}
                </span>
              </div>
            )}
          </div>
          {view.confirmText && (
            <div className="banner tone-negative">
              <strong className="tone-text-negative">{view.confirmText}</strong>
              <span className="row">
                <button className="primary" onClick={() => model.enter()}>Enter · Move to trash</button>
                <button onClick={() => model.cancel()}>Esc · Cancel</button>
              </span>
            </div>
          )}
        </section>
        <div className="search-grid" ref={grid} onMouseDown={() => field.current?.blur()}>
          {view.tiles.map((t, i) => <Tile key={t.mediaKey} tile={t} index={i} focusPulse={view.focusPulse} model={model} />)}
        </div>
        {view.showMoreVisible && <div className="show-more"><button disabled={view.searching} onClick={() => model.showMore()}>Show more</button></div>}
      </div>
      {view.viewer && (
        <Viewer viewer={view.viewer} onPrevious={() => model.viewerStep(-1)} onNext={() => model.viewerStep(1)} onToggle={() => model.viewerToggle()} onClose={() => model.viewerClose()} />
      )}
      <Toast notice={view.notice} />
    </div>
  );
}
