// What both kinds of clutter page share (the single list, clutter.tsx, and subject and setting,
// clutterAxes.tsx): photo grids, a photo opened large, the hover card, number fields, collapsible parts,
// and the popup that shows what a change does before it is made.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hoverCardTop, stayButton, stayTitle, typedNumber, type Breakdown, type CaptionPart, type CategoryKind, type ChangeSummary } from '../search/clutter';
import type { TextPart } from '../search/clutterAxes';

/** Photos scored between pauses, so the page keeps drawing while it works. */
export const CHUNK = 500;

/**
 * A pause between chunks that lets the page draw. Not setTimeout: Chrome holds a hidden tab's timers
 * back to one a second, then one a minute, which stalled scoring whenever the tab was in the background.
 * A message to itself isn't held back.
 */
export function pause(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}
/** Photos shown in each of a category's samples (strongest, weakest, just counted, just missed). */
export const SAMPLE = 24;
/** How far outside the window a photo's preview starts loading, so scrolling finds it ready. */
export const PRELOAD_MARGIN = '600px';
/** How long a tab showing all of a category's finds waits for the page that opened it to answer. */
export const HANDOVER_WAIT_MS = 5000;
export const ASK = 'clutter-all-ask';
export const ANSWER = 'clutter-all-answer';
export const APPLY = 'clutter-apply-buff';
export const APPLIED = 'clutter-buff-applied';
/** How long a tab waits for the clutter page to confirm a buff was added to its settings. */
export const APPLY_WAIT_MS = 5000;
/** Categories listed in a photo's hover card, best first. */
export const BREAKDOWN_ROWS = 6;
/** The hover card's width (as in app.css), to open it on the side where it fits. */
export const CARD_WIDTH = 380;
/** Preview sizes: a tile, and a photo opened large (as the review tab's viewer). */
export const THUMB_PX = 160;
export const ZOOM_PX = 1024;


export interface TitledBreakdown {
  title: string | null;
  /** A subject's, setting's or form's title, shown plain under a part's bold one ("Now", "With the buff"). */
  side?: boolean;
  breakdown: Breakdown;
  /** [title] in pieces, its category names apart, to set them apart; without it, [title] as it is. */
  titleParts?: TextPart[];
  /** Part of the section above it: no divider between them (a comparison's "Now" and "With the edits" lines). */
  joined?: boolean;
  /** Parts shown folded under [Fold.summary] (what a change left as it was). */
  fold?: Fold;
}

export interface Fold {
  summary: string;
  /** [summary] in pieces, as [TitledBreakdown.titleParts]. */
  summaryParts?: TextPart[];
  parts: TitledBreakdown[];
}

/** The gap kept between a hover card and the window's edges. */
const CARD_MARGIN = 8;

export function BreakdownCard({ breakdowns, side }: { breakdowns: TitledBreakdown[]; side: 'right' | 'left' }) {
  const card = useRef<HTMLDivElement>(null);
  // Before it shows: lifted so a photo low in the window opens its card upwards, not past the window's bottom.
  useLayoutEffect(() => {
    const element = card.current;
    const photo = element?.parentElement;
    if (!element || !photo) return;
    element.style.top = `${hoverCardTop(photo.getBoundingClientRect().top, element.offsetHeight, window.innerHeight, CARD_MARGIN)}px`;
  });
  return (
    <div ref={card} className={`clutter-card ${side}`} role="tooltip">
      <Breakdowns breakdowns={breakdowns} />
    </div>
  );
}

/** A line in pieces, its category names set apart as in the rows. */
function Parts({ parts }: { parts: TextPart[] }) {
  return <>{parts.map((p, i) => (p.kind !== null ? <span key={i} className={`clutter-name ${p.kind}`}>{p.text}</span> : p.term ? <span key={i} className="clutter-term">{p.text}</span> : p.text))}</>;
}

/** How a photo scored, side by side: in a hover card, or beside a photo opened large. */
function Breakdowns({ breakdowns, legend = true }: { breakdowns: TitledBreakdown[]; legend?: boolean }) {
  return (
    <>
      {breakdowns.map(({ title, titleParts, side, breakdown, fold, joined }, i) => (
        <div key={`${i} ${title ?? ''}`} className={joined ? 'clutter-card-scoring clutter-card-joined' : 'clutter-card-scoring'}>
          {fold && (
            <details className="clutter-card-fold">
              <summary className="clutter-card-title clutter-card-side">{fold.summaryParts ? <Parts parts={fold.summaryParts} /> : fold.summary}</summary>
              <Breakdowns breakdowns={fold.parts} legend={false} />
            </details>
          )}
          {title && <p className={side ? 'clutter-card-title clutter-card-side' : 'clutter-card-title'}>{titleParts ? <Parts parts={titleParts} /> : title}</p>}
          {breakdown.heading && <p className="clutter-card-heading">{breakdown.heading}</p>}
          {breakdown.rows.length > 0 && (
            <table>
              <tbody>
                {breakdown.rows.map((r) => (
                  <tr key={`${r.label} ${r.description}`} className={r.kind}>
                    <td className="mono">{r.score}</td>
                    <td><span className={`clutter-name ${r.kind}`}>{r.label}</span><span className="muted"> · </span><span className="muted clutter-term">{r.description}</span><span className="muted">{r.weight && ` (weight ${r.weight})`}{r.vote && ` · vote ${r.vote}`}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {breakdown.more && <p className="muted">{breakdown.more}.</p>}
        </div>
      ))}
      {legend && (
        <p className="small clutter-card-legend">
          <span className="clutter-kind-clutter">Red: clutter</span>; <span className="clutter-kind-counterweight">green: counterweights, or what keeps a photo</span>; <span className="clutter-kind-neutral">grey: neither</span>.
        </p>
      )}
    </>
  );
}

/** A preview of [thumbUrl] at [sizePx], through the Google Photos tab. */
export type Preview = (thumbUrl: string, sizePx: number) => Promise<string>;

/** One photo in a grid: what it shows under it, and how it scored for the hover card. */
export interface Tile {
  mediaKey: string;
  thumbUrl: string | null;
  caption: CaptionPart[];
  breakdowns: () => TitledBreakdown[];
  /** Every description's score, shown beside the photo opened large; without it, [breakdowns]. */
  everything?: () => TitledBreakdown[];
  /**
   * In a tab of a clutter category's finds: the buffs that could take the photo out, as buttons (null
   * when the buffs applied there already did).
   */
  buff?: { options: () => BuffOption[] | null };
  /** In a buff's popup, under a photo the change takes out: the weight of the clutter description it scored as there, to strengthen and keep it. */
  nudge?: Nudge;
}

/** A buff's button under a photo opened large: what it says, and what choosing it does (null: it can't be chosen). */
export interface BuffOption {
  key: string;
  label: string;
  onChoose: (() => void) | null;
}

/** One description's weight under a photo, typed, or raised just enough to keep the photo where it was. */
export interface Nudge {
  description: string;
  /** The category the photo is leaving, which Stay keeps it in. */
  category: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** The smallest raise that keeps the photo in its category with the change as it stands, or null when more than [max] is needed. */
  raise: number | null;
  /** The largest raise offered, for the scoring shown. */
  max: number;
  onRaise: () => void;
}

/** Photos numbered from 1, so they can be referred to; clicking one opens it large and uncropped. */
export function PhotoGrid({ tiles, preview }: { tiles: Tile[]; preview: Preview }) {
  // The photo opened large, by its key: the grid can change under it (a buff applied takes photos out),
  // and then the photo stays open where it now is, or closes once it is gone.
  const [zoomed, setZoomed] = useState<string | null>(null);
  const index = zoomed === null ? -1 : tiles.findIndex((t) => t.mediaKey === zoomed);
  return (
    <>
      <div className="search-grid">
        {tiles.map((tile, i) => <Thumb key={tile.mediaKey} number={i + 1} photo={tile} preview={preview} breakdowns={tile.breakdowns} nudge={tile.nudge} onZoom={() => setZoomed(tile.mediaKey)} />)}
      </div>
      {index >= 0 && <Zoom tiles={tiles} index={index} preview={preview} onMove={(i) => setZoomed(tiles[i]!.mediaKey)} onClose={() => setZoomed(null)} />}
    </>
  );
}

/** The overlays open (a photo opened large, a buff's effect), last opened last: only the top one answers keys. */
const overlays: symbol[] = [];

/**
 * [onKey] for the keys pressed while this overlay is the top one, so Esc closes only it: a buff's
 * effect over a photo opened large closes first, and the photo stays open behind it.
 */
export function useOverlayKeys(onKey: (e: KeyboardEvent) => void) {
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    const me = Symbol('overlay');
    overlays.push(me);
    // While a key's handlers run, the overlay it closes is still listed, so the one below doesn't answer it too.
    const key = (e: KeyboardEvent) => {
      if (overlays[overlays.length - 1] === me) handler.current(e);
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      overlays.splice(overlays.indexOf(me), 1);
    };
  }, []);
}

/**
 * Holds the page behind still while a full-screen overlay is open: the wheel and the arrow keys would scroll it
 * (and show its scrollbar) through the overlay.
 */
export function usePageScrollLocked() {
  useEffect(() => {
    const page = document.documentElement;
    const was = page.style.overflow;
    page.style.overflow = 'hidden';
    return () => {
      page.style.overflow = was;
    };
  }, []);
}

/** The buff buttons under a photo opened large, the smallest buff first. The photo stays open behind the buff's effect. */
function BuffButtons({ tile }: { tile: Tile }) {
  const buff = tile.buff;
  const options = useMemo(() => (buff ? buff.options() : null), [buff]);
  if (!buff) return null;
  if (options === null) return <p className="muted small">No longer counted in this category, with the buffs applied from this tab.</p>;
  return (
    <div className="viewer-buttons clutter-buffs">
      <span className="muted small">Leave this photo out by strengthening what would keep it, just enough (its effect on every photo is shown first):</span>
      {options.map((o) => (
        <button key={o.key} disabled={o.onChoose === null} onClick={() => o.onChoose?.()}>{o.label}</button>
      ))}
    </div>
  );
}

/** One photo large and uncropped, as Google Photos gives it; ← and → move through the grid, Esc closes. */
export function Zoom({ tiles, index, preview, onMove, onClose }: { tiles: Tile[]; index: number; preview: Preview; onMove: (index: number) => void; onClose: () => void }) {
  const tile = tiles[index]!;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Loaded again only for another photo: the page redraws its grids (the lab looks for requests every few
  // seconds), and a photo loaded again for each new copy of its tile flickered.
  const thumbUrl = tile.thumbUrl;
  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!thumbUrl) {
      setFailed(true);
      return;
    }
    let alive = true;
    preview(thumbUrl, ZOOM_PX).then((u) => alive && setUrl(u), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [thumbUrl, preview]);
  const previous = () => onMove(Math.max(0, index - 1));
  const next = () => onMove(Math.min(tiles.length - 1, index + 1));
  useOverlayKeys((e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowLeft') previous();
    else if (e.key === 'ArrowRight') next();
  });
  const scores = useMemo(() => (tile.everything ?? tile.breakdowns)(), [tile]);
  return (
    <div className="viewer clutter-viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div className="clutter-viewer-body">
        <div className="viewer-photo">{url ? <img src={url} alt="" /> : <span className="muted">{failed ? 'No preview' : 'Loading…'}</span>}</div>
        <div className="clutter-viewer-scores small">
          <Breakdowns breakdowns={scores} />
        </div>
      </div>
      <div className="viewer-info">
        <span className="mono">#{index + 1} of {tiles.length}</span>
        <strong><Caption parts={tile.caption} /></strong>
      </div>
      <div className="viewer-buttons">
        <button disabled={index === 0} onClick={previous}>← Previous</button>
        <button disabled={index === tiles.length - 1} onClick={next}>Next →</button>
        <a href={`https://photos.google.com/photo/${tile.mediaKey}`} target="_blank" rel="noreferrer"><button tabIndex={-1}>Open in Google Photos <span aria-hidden="true">↗</span></button></a>
        <button onClick={onClose}><kbd>Esc</kbd> · Close</button>
      </div>
      <BuffButtons key={tile.mediaKey} tile={tile} />
    </div>
  );
}

/** A caption that names no category. */
export const plain = (text: string): CaptionPart[] => [{ text, kind: null }];

/** A caption with the categories it names coloured by kind, counterweights green as in the hover card. */
export function Caption({ parts }: { parts: CaptionPart[] }) {
  return (
    <>
      {parts.map((p, i) => {
        const text = p.kind ? <span key={i} className={`clutter-kind-${p.kind}`}>{p.text}</span> : p.term ? <span key={i} className="clutter-term">{p.text}</span> : p.text;
        return p.strong ? <strong key={i}>{text}</strong> : text;
      })}
    </>
  );
}

export function Thumb({ number, photo, preview, breakdowns, nudge, onZoom }: { number: number; photo: { mediaKey: string; thumbUrl: string | null; caption: CaptionPart[] }; preview: Preview; breakdowns: () => TitledBreakdown[]; nudge?: Nudge; onZoom: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [card, setCard] = useState<'right' | 'left' | null>(null);
  const [near, setNear] = useState(false);
  const figure = useRef<HTMLElement>(null);
  // A preview loads only once its photo is close to the window, so a long list doesn't ask for them all at once.
  useEffect(() => {
    const element = figure.current;
    if (!element) return;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        watch.disconnect();
      }
    }, { rootMargin: PRELOAD_MARGIN });
    watch.observe(element);
    return () => {
      watch.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!near) return;
    if (!photo.thumbUrl) {
      setFailed(true);
      return;
    }
    let alive = true;
    preview(photo.thumbUrl, THUMB_PX).then((u) => alive && setUrl(u), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [near, photo.thumbUrl, preview]);
  const open = (e: { currentTarget: HTMLElement }) => setCard(e.currentTarget.getBoundingClientRect().right + CARD_WIDTH + 16 > window.innerWidth ? 'left' : 'right');
  return (
    <figure ref={figure} className="search-tile clutter-tile" onMouseEnter={open} onMouseLeave={() => setCard(null)} onFocus={open} onBlur={() => setCard(null)}>
      <div className="search-tile-image" title="View large" onClick={onZoom}>
        {url ? <img src={url} alt="" draggable={false} /> : <span className="muted small">{failed ? 'No preview' : '…'}</span>}
        <button className="expand" title="View large" aria-label="View large" onClick={(e) => { e.stopPropagation(); onZoom(); }}>⤢</button>
      </div>
      <figcaption className="small"><span className="clutter-number">#{number}</span> <a href={`https://photos.google.com/photo/${photo.mediaKey}`} target="_blank" rel="noreferrer"><Caption parts={photo.caption} /></a></figcaption>
      {nudge && (
        <div className="clutter-nudge small">
          <span className="muted" title={`The weight of “${nudge.description}”, the description it scored as where it was counted`}>weight</span>
          <OptionalNumber value={nudge.value} label={`${nudge.description} weight`} placeholder="0" onChange={nudge.onChange} />
          <button title={stayTitle(nudge.raise, nudge.description, nudge.category, nudge.max)} disabled={nudge.raise === null} onClick={nudge.onRaise}>{stayButton(nudge.raise)}</button>
        </div>
      )}
      {card && <BreakdownCard breakdowns={breakdowns()} side={card} />}
    </figure>
  );
}

/**
 * A number that may be left empty ([value] undefined): typed as text, so a minus sign or a lone "0." can
 * be typed on the way to a number; only what reads as a number is passed on.
 */
export function OptionalNumber({ value, label, placeholder, onChange }: { value: number | undefined; label: string; placeholder: string; onChange: (value: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  // Changed from outside (cleared, another scoring): show it, unless the text already says it ("0.010" stays as typed).
  useEffect(() => {
    setText((t) => (typedNumber(t) === value ? t : value === undefined ? '' : String(value)));
  }, [value]);
  return (
    <input
      className="clutter-weight mono"
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const typed = typedNumber(e.target.value);
        if (typed !== null) onChange(typed);
      }}
    />
  );
}

/**
 * One category in the editor, closed to begin with so the list fits on a screen; a category added in
 * the editor (with no descriptions yet) starts open, to fill in. It stays as the user left it while
 * edited, as long as the category is there. Closed, [closedNote] (its descriptions) follows the heading;
 * open, the fields inside show them.
 */
export function Collapsible({ heading, kind, startOpen, closedNote, children }: { heading: string; kind: CategoryKind | 'neutral'; startOpen: boolean; closedNote?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <details className="clutter-tuning-category clutter-edit-category" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={`clutter-kind-${kind}`}>
        {heading}
        {!open && closedNote && <span className="clutter-closed-note">{closedNote}</span>}
      </summary>
      {children}
    </details>
  );
}

/** A field and button to add something by name, emptied once added. */
export function AddField({ label, placeholder, onAdd, children }: { label: string; placeholder: string; onAdd: (text: string) => void; children?: React.ReactNode }) {
  const [text, setText] = useState('');
  const add = () => {
    onAdd(text);
    setText('');
  };
  return (
    <div className="clutter-add">
      <input type="text" aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
      {children}
      <button onClick={add}>{label}</button>
    </div>
  );
}

/**
 * A text field whose value counts only when it is committed: on Enter or on leaving the field, and only when
 * it changed; Escape puts it back. For a value the page regroups by, such as a form's check, which would move
 * the field away at the first letter typed (2026-11-25).
 */
export function CommitField({ value, label, list, className, onCommit }: { value: string; label: string; list?: string; className?: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      type="text"
      aria-label={label}
      list={list}
      className={className}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
}

/**
 * What a buff would do: every photo it takes out of the suggestions, each with the clutter description it
 * scored as there to strengthen and keep it, and every photo that brings in, by suggestion, and where
 * each goes; nothing changes until Apply.
 */
export function ChangePopup({ title, summary, scores = null, note, applyLabel, cancelLabel, chosen, grids, preview, problem, onApply, onCancel }: {
  title: string;
  summary: ChangeSummary;
  /** What it does to precision and recall on the labels ("Random photos: precision 94.9% → 97.5% · …"); null without labels. */
  scores?: string | null;
  note: string;
  applyLabel: string;
  cancelLabel: string;
  /** For a buff: the photo it was chosen under, and what becomes of it. */
  chosen?: { tiles: Tile[]; line: string };
  grids: { key: string; title: string; open: boolean; tiles: Tile[] }[];
  preview: Preview;
  problem: string | null;
  onApply: () => void;
  onCancel: () => void;
}) {
  // Esc cancels, unless a photo is opened large from here: that closes first.
  useOverlayKeys((e) => {
    if (e.key === 'Escape') onCancel();
  });
  return (
    <div className="clutter-popup" role="dialog" aria-modal="true" aria-label={title}>
      <div className="clutter-popup-box card">
        <h2>{title}</h2>
        <p>{summary.what}</p>
        <p className="clutter-popup-count">
          <strong>{summary.leave}</strong>
          {summary.leaveFrom && <span className="clutter-popup-where"> ({summary.leaveFrom})</span>}
        </p>
        {summary.join && (
          <p className="clutter-popup-count">
            <strong>{summary.join}</strong>
            {summary.joinTo && <span className="clutter-popup-where"> ({summary.joinTo})</span>}
          </p>
        )}
        {summary.move && <p className="clutter-popup-details small">{summary.move}</p>}
        {scores && <p className="clutter-popup-scores">On your labels: {scores}</p>}
        {chosen && (
          <div className="clutter-chosen">
            <PhotoGrid tiles={chosen.tiles} preview={preview} />
            <p className="small">{chosen.line}</p>
          </div>
        )}
        <p className="muted small">{note}</p>
        {problem && <p className="warn">{problem}</p>}
        <div className="buttons">
          <button className="primary" onClick={onApply}>{applyLabel}</button>
          <button onClick={onCancel}><kbd>Esc</kbd> · {cancelLabel}</button>
        </div>
        {/* Keyed by what the group is, not its title, whose count changes as weights do: a group closed stays closed. */}
        {grids.map((grid) => (
          <details key={grid.key} className="clutter-popup-photos" open={grid.open}>
            <summary className="clutter-popup-group">{grid.title}</summary>
            <PhotoGrid tiles={grid.tiles} preview={preview} />
          </details>
        ))}
      </div>
    </div>
  );
}

