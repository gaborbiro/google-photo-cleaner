// Developer tool: suggested searches for clutter, worked out from this library's fingerprints, to judge
// whether they are right and useful before they become part of the product (search/clutter.ts).
// Reads the same data as Search; nothing is trashed from here. Only its own settings (weights, pooling,
// minimum leads, the priority order) are kept, in this browser, to carry on tuning another day.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CATEGORIES, categoryList, categorySamples, clearWeights, countCategories, typedNumber, withMargin, withWeight, countLine, countSections, descriptionNorms, descriptionScores, evenSample, kindTotals, matchCaption, matchPhoto, moveCaption, movePriority, movesLine, photoBreakdown, photoCaption, readTuning, saveTuning, scoreSpread, scoringMoves, tuningLine, weakestMatches, type Breakdown, type CaptionPart, type Category, type LeadOver, type CategoryCount, type CategoryPhoto, type ClutterSettings, type DescriptionNorms, type Priority, type SavedTuning, type ScoredCategory, type Scoring, type Weighting } from '../search/clutter';
import type { LibraryPhoto } from '../search/searchModel';
import { searchDeps } from '../search/session';
import { accountLabel } from '../shared/jobView';
import { useAccount } from '../ui/hooks';

/** Photos scored between pauses, so the page keeps drawing while it works. */
const CHUNK = 500;
/** Photos shown in each of a category's samples (strongest, weakest, just counted, just missed). */
const SAMPLE = 12;
/** How far outside the window a photo's preview starts loading, so scrolling finds it ready. */
const PRELOAD_MARGIN = '600px';
/** How long a tab showing all of a category's finds waits for the page that opened it to answer. */
const HANDOVER_WAIT_MS = 5000;
const ASK = 'clutter-all-ask';
const ANSWER = 'clutter-all-answer';
/** Categories listed in a photo's hover card, best first. */
const BREAKDOWN_ROWS = 6;
/** The hover card's width (as in app.css), to open it on the side where it fits. */
const CARD_WIDTH = 380;
/** Photos in the sample of what evening out moves, and in the photos nothing matches well. */
const MOVED_SAMPLE = 60;
const WEAKEST_SAMPLE = 60;
/** Preview sizes: a tile, and a photo opened large (as the review tab's viewer). */
const THUMB_PX = 160;
const ZOOM_PX = 1024;

const LIST = categoryList(CATEGORIES);
/** Where the page keeps its settings in this browser. */
const SAVED_KEY = 'dev-clutter-tuning';

/** The saved settings, or the starting ones when none are saved or this browser keeps nothing. */
function loadTuning(): { tuning: SavedTuning; notes: string[] } {
  let text: string | null;
  try {
    text = localStorage.getItem(SAVED_KEY);
  } catch (error) {
    return { tuning: readTuning(null, CATEGORIES).tuning, notes: [`This browser keeps no settings for the page (${String(error)}); they start afresh.`] };
  }
  try {
    return readTuning(text, CATEGORIES);
  } catch (error) {
    return { tuning: readTuning(null, CATEGORIES).tuning, notes: [`The saved settings couldn't be read (${error instanceof Error ? error.message : String(error)}); they start afresh.`] };
  }
}

interface Worked {
  photos: Map<string, LibraryPhoto>;
  scored: ScoredCategory[];
  /** Every photo's score for every description, kept so changing the scoring needs no AI work. */
  rows: Map<string, Float32Array>;
  norms: DescriptionNorms;
}

/** One scoring a photo's hover card shows: raw or evened out ([norms]), named when there is more than one. */
interface HoverScoring {
  title: string | null;
  norms: DescriptionNorms | null;
  weighting: Weighting;
}

/** Everything a tab showing a list of photos needs, handed over by the clutter page that opened it. */
interface AllFinds {
  account: string;
  /** What the photos are, e.g. the category's count line. */
  title: string;
  /** The scoring and settings they were counted with. */
  settings: string;
  /** In the order shown, each with its caption and its score for every description. */
  photos: { mediaKey: string; thumbUrl: string | null; caption: CaptionPart[]; row: Float32Array }[];
  scored: ScoredCategory[];
  scorings: HoverScoring[];
  over: LeadOver;
}

interface TitledBreakdown {
  title: string | null;
  breakdown: Breakdown;
}

function BreakdownCard({ breakdowns, side }: { breakdowns: TitledBreakdown[]; side: 'right' | 'left' }) {
  return (
    <div className={`clutter-card ${side}`} role="tooltip">
      {breakdowns.map(({ title, breakdown }) => (
        <div key={title ?? ''} className="clutter-card-scoring">
          {title && <p className="muted">{title}</p>}
          <p className="clutter-card-heading">{breakdown.heading}</p>
          <table>
            <tbody>
              {breakdown.rows.map((r) => (
                <tr key={r.label} className={r.kind}>
                  <td className="mono">{r.score}</td>
                  <td>{r.label}<span className="muted"> · {r.description}{r.weight && ` (weight ${r.weight})`}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {breakdown.more && <p className="muted">{breakdown.more}.</p>}
        </div>
      ))}
      <p className="muted">Green: counterweights.</p>
    </div>
  );
}

/** A preview of [thumbUrl] at [sizePx], through the Google Photos tab. */
type Preview = (thumbUrl: string, sizePx: number) => Promise<string>;

/** One photo in a grid: what it shows under it, and how it scored for the hover card. */
interface Tile {
  mediaKey: string;
  thumbUrl: string | null;
  caption: CaptionPart[];
  breakdowns: () => TitledBreakdown[];
}

/** Photos numbered from 1, so they can be referred to; clicking one opens it large and uncropped. */
function PhotoGrid({ tiles, preview }: { tiles: Tile[]; preview: Preview }) {
  const [zoomed, setZoomed] = useState<number | null>(null);
  return (
    <>
      <div className="search-grid">
        {tiles.map((tile, i) => <Thumb key={tile.mediaKey} number={i + 1} photo={tile} preview={preview} breakdowns={tile.breakdowns} onZoom={() => setZoomed(i)} />)}
      </div>
      {zoomed !== null && <Zoom tiles={tiles} index={zoomed} preview={preview} onMove={setZoomed} onClose={() => setZoomed(null)} />}
    </>
  );
}

/** One photo large and uncropped, as Google Photos gives it; ← and → move through the grid, Esc closes. */
function Zoom({ tiles, index, preview, onMove, onClose }: { tiles: Tile[]; index: number; preview: Preview; onMove: (index: number) => void; onClose: () => void }) {
  const tile = tiles[index]!;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!tile.thumbUrl) {
      setFailed(true);
      return;
    }
    let alive = true;
    preview(tile.thumbUrl, ZOOM_PX).then((u) => alive && setUrl(u), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [tile, preview]);
  const previous = () => onMove(Math.max(0, index - 1));
  const next = () => onMove(Math.min(tiles.length - 1, index + 1));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') previous();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
    };
  });
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div className="viewer-photo">{url ? <img src={url} alt="" /> : <span className="muted">{failed ? 'No preview' : 'Loading…'}</span>}</div>
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
    </div>
  );
}

/** A caption that names no category. */
const plain = (text: string): CaptionPart[] => [{ text, kind: null }];

/** A caption with the categories it names coloured by kind, counterweights green as in the hover card. */
function Caption({ parts }: { parts: CaptionPart[] }) {
  return <>{parts.map((p, i) => (p.kind ? <span key={i} className={`clutter-kind-${p.kind}`}>{p.text}</span> : p.text))}</>;
}

function Thumb({ number, photo, preview, breakdowns, onZoom }: { number: number; photo: { mediaKey: string; thumbUrl: string | null; caption: CaptionPart[] }; preview: Preview; breakdowns: () => TitledBreakdown[]; onZoom: () => void }) {
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
      {card && <BreakdownCard breakdowns={breakdowns()} side={card} />}
    </figure>
  );
}

function CategoryCard({ count, worked, norms, weighting, over, preview, openAll }: { count: CategoryCount; worked: Worked; norms: DescriptionNorms | null; weighting: Weighting; over: LeadOver; preview: Preview; openAll: () => void }) {
  const [open, setOpen] = useState(false);
  const samples = useMemo(() => (open ? categorySamples(count, SAMPLE) : null), [open, count]);
  const tile = (p: CategoryPhoto): Tile => {
    const { thumbUrl, row } = shown(worked, p.mediaKey);
    return { mediaKey: p.mediaKey, thumbUrl, caption: plain(photoCaption(p)), breakdowns: () => [{ title: null, breakdown: photoBreakdown(row, worked.scored, norms, weighting, over, BREAKDOWN_ROWS) }] };
  };
  const grid = (title: string, photos: CategoryPhoto[]) =>
    photos.length > 0 && (
      <>
        <p className="clutter-sample-title">{title}</p>
        <PhotoGrid tiles={photos.map(tile)} preview={preview} />
      </>
    );
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{countLine(count)} <span className="muted small">{count.category.descriptions.join(' · ')}</span></summary>
      {samples && (
        <>
          {grid('Best: the highest scores (Search will show these first)', samples.best)}
          {grid('Riskiest: the smallest leads that still made it (Search will show these last, below “Show all”)', samples.riskiest)}
          {grid('Lowest scores still counted (developer page only, to compare with Riskiest)', samples.lowestScores)}
          {grid('Just missed: close calls with the largest leads, not counted (developer page only)', samples.justMissed)}
          <p className="clutter-sample-title">All {count.trashable.length.toLocaleString()} counted</p>
          <div className="buttons clutter-show-all"><button onClick={openAll}>Open all in a new tab</button></div>
        </>
      )}
    </details>
  );
}

/**
 * A number that may be left empty ([value] undefined): typed as text, so a minus sign or a lone "0." can
 * be typed on the way to a number; only what reads as a number is passed on.
 */
function OptionalNumber({ value, label, placeholder, onChange }: { value: number | undefined; label: string; placeholder: string; onChange: (value: number | undefined) => void }) {
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
 * Every category and description with its weight for the current scoring, clutter in the priority order
 * with its own minimum lead, then the counterweights.
 */
function TuningList({ settings, scoring, priority, onSettings, onPriority }: { settings: ClutterSettings; scoring: Scoring; priority: Priority; onSettings: (change: (s: ClutterSettings) => ClutterSettings) => void; onPriority: (p: Priority) => void }) {
  const byId = new Map(CATEGORIES.map((c) => [c.id, c]));
  const clutterInOrder = priority.map((id) => byId.get(id)!);
  const counterweights = CATEGORIES.filter((c) => c.kind === 'counterweight');
  const units = scoring === 'raw' ? 'e.g. 0.02' : 'e.g. 0.2';
  const row = (c: Category, place: number | null) => (
    <div key={c.id} className="clutter-tuning-category">
      <div className="clutter-tuning-head">
        {place !== null && (
          <span className="clutter-tuning-order">
            <span className="mono">{place + 1}.</span>
            <button aria-label={`Move ${c.label} up`} disabled={place === 0} onClick={() => onPriority(movePriority(priority, c.id, -1))}>↑</button>
            <button aria-label={`Move ${c.label} down`} disabled={place === priority.length - 1} onClick={() => onPriority(movePriority(priority, c.id, 1))}>↓</button>
          </span>
        )}
        <strong className={`clutter-kind-${c.kind}`}>{c.label}</strong>
        <label className="small">weight <OptionalNumber value={settings.categoryWeights[c.id]} label={`${c.label} weight`} placeholder="0" onChange={(w) => onSettings((s) => ({ ...s, categoryWeights: withWeight(s.categoryWeights, c.id, w) }))} /></label>
        {c.kind === 'clutter' && (
          <label className="small">minimum lead <OptionalNumber value={settings.margins[c.id]} label={`${c.label} minimum lead`} placeholder={String(settings.margin)} onChange={(m) => onSettings((s) => ({ ...s, margins: withMargin(s.margins, c.id, m) }))} /></label>
        )}
      </div>
      <div className="clutter-tuning-descriptions">
        {c.descriptions.map((d) => (
          <label key={d} className="small">
            <OptionalNumber value={settings.descriptionWeights[d]} label={`${d} weight`} placeholder="0" onChange={(w) => onSettings((s) => ({ ...s, descriptionWeights: withWeight(s.descriptionWeights, d, w) }))} /> {d}
          </label>
        ))}
      </div>
    </div>
  );
  return (
    <details className="clutter-categories">
      <summary>Categories, weights and priority: {LIST.summary}</summary>
      <p className="muted small">
        A weight is added to a score before photos are compared ({units}, for {scoring === 'raw' ? 'raw scores' : 'evened-out scores'}; each scoring keeps its own). A
        category&apos;s weight is added to all its descriptions. Strengthening a counterweight, or weakening a clutter description, takes photos away from clutter.
        An empty minimum lead uses the shared one.
      </p>
      <div className="buttons">
        <button onClick={() => onSettings(clearWeights)}>Clear weights and minimum leads ({scoring === 'raw' ? 'raw' : 'evened out'})</button>
      </div>
      <h3>Clutter, in the order suggestions are shown · {clutterInOrder.length}</h3>
      {clutterInOrder.map((c, i) => row(c, i))}
      <h3>Counterweights · {counterweights.length}</h3>
      <p className="muted small">{LIST.groups.find((g) => g.kind === 'counterweight')!.note}</p>
      {counterweights.map((c) => row(c, null))}
    </details>
  );
}

function Clutter() {
  const { answer } = useAccount();
  const account = new URLSearchParams(location.search).get('account') ?? answer?.account?.fingerprint ?? null;
  const deps = useMemo(() => (account === null ? null : searchDeps(account)), [account]);
  const [worked, setWorked] = useState<Worked | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [scoring, setScoring] = useState<Scoring>('raw');
  const [loaded] = useState(loadTuning);
  const [over, setOver] = useState<LeadOver>(loaded.tuning.over);
  const [settings, setSettings] = useState<Record<Scoring, ClutterSettings>>(loaded.tuning.settings);
  const [priority, setPriority] = useState<Priority>(loaded.tuning.priority);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [minPhotos, setMinPhotos] = useState(20);
  const setting = (key: 'minScore' | 'margin' | 'pooling') => (value: number) => setSettings((s) => ({ ...s, [scoring]: { ...s[scoring], [key]: value } }));
  const changeSettings = (change: (s: ClutterSettings) => ClutterSettings) => setSettings((s) => ({ ...s, [scoring]: change(s[scoring]) }));
  // Kept in this browser, so tuning can carry on another day.
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, saveTuning({ settings, over, priority }));
      setSaveProblem(null);
    } catch (error) {
      setSaveProblem(`These settings couldn't be kept in this browser (${String(error)}); note them down before closing the page.`);
    }
  }, [settings, over, priority]);

  const workOut = async () => {
    setWorked(null);
    setProblem(null);
    try {
      if (!deps) throw new Error('Open Google Photos first, so the account is known.');
      setProgress('Reading the library…');
      const library = await deps.loadLibrary();
      if (library.blocked) throw new Error(`The library scan can't be used (${library.blocked}): check for new photos on the Scan tab first.`);
      const scored: ScoredCategory[] = [];
      const total = CATEGORIES.reduce((n, c) => n + c.descriptions.length, 0);
      let done = 0;
      for (const category of CATEGORIES) {
        const vectors: Float32Array[] = [];
        for (const description of category.descriptions) {
          vectors.push(await deps.embedQuery(description, (f) => setProgress(`Loading the AI model… ${Math.round(f * 100)}%`)));
          setProgress(`Describing the categories to the AI model: ${++done} of ${total}`);
        }
        scored.push({ category, vectors });
      }
      const photos = [...library.photos.values()];
      const rows = new Map<string, Float32Array>();
      for (let i = 0; i < photos.length; i += CHUNK) {
        for (const p of photos.slice(i, i + CHUNK)) rows.set(p.mediaKey, descriptionScores(p.vector, scored));
        setProgress(`Scoring photos: ${rows.size.toLocaleString()} of ${photos.length.toLocaleString()}`);
        await new Promise((resolve) => setTimeout(resolve));
      }
      setWorked({ photos: library.photos, scored, rows, norms: descriptionNorms([...rows.values()]) });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
    }
  };

  const norms = worked && scoring === 'evened' ? worked.norms : null;
  // Both scorings are matched, so what evening out moves can be compared; the page shows the chosen one.
  const rawMatches = useMemo(() => (worked ? [...worked.rows].map(([key, row]) => matchPhoto(key, row, worked.scored, null, settings.raw)) : null), [worked, settings.raw]);
  const evenedMatches = useMemo(() => (worked ? [...worked.rows].map(([key, row]) => matchPhoto(key, row, worked.scored, worked.norms, settings.evened)) : null), [worked, settings.evened]);
  const matches = scoring === 'raw' ? rawMatches : evenedMatches;
  const moves = useMemo(
    () => (worked && rawMatches && evenedMatches ? scoringMoves(rawMatches, evenedMatches, [...CATEGORIES], worked.photos, settings, over) : null),
    [worked, rawMatches, evenedMatches, settings, over],
  );
  const counts = useMemo(() => (worked && matches ? countCategories(matches, [...CATEGORIES], worked.photos, settings[scoring], over) : null), [worked, matches, settings, scoring, over]);
  const spread = useMemo(() => (matches ? scoreSpread(matches, over) : []), [matches, over]);
  const sections = counts ? countSections(counts, minPhotos, priority) : null;
  const preview: Preview = useCallback((thumbUrl: string, sizePx: number) => deps!.preview(thumbUrl, sizePx), [deps]);

  // Tabs opened to show all of a category's finds ask this page for them, by the id in their address.
  const handovers = useRef(new Map<string, AllFinds>());
  useEffect(() => {
    const answerTab = (e: MessageEvent) => {
      // Not `instanceof Window`: the asking tab's window comes from another realm, so that is always false.
      if (e.origin !== location.origin || e.data?.type !== ASK || e.source === null) return;
      (e.source as Window).postMessage({ type: ANSWER, id: e.data.id, finds: handovers.current.get(e.data.id) ?? null }, location.origin);
    };
    window.addEventListener('message', answerTab);
    return () => {
      window.removeEventListener('message', answerTab);
    };
  }, []);
  const openAll = (count: CategoryCount) => {
    if (!worked || account === null) throw new Error('Finds can only be opened once they are worked out for an account');
    const photos = count.trashable.map((p) => ({ ...shown(worked, p.mediaKey), caption: plain(photoCaption(p)) }));
    hand(account, {
      title: countLine(count),
      settings: `${settingsText(scoring)}, lead over ${over === 'next' ? 'the next category' : 'the other kind'}`,
      photos,
      scored: worked.scored,
      scorings: [{ title: null, norms, weighting: settings[scoring] }],
      over,
    });
  };
  const openMoved = () => {
    if (!worked || !moves || account === null) throw new Error('Moves can only be opened once suggestions are worked out for an account');
    const sample = evenSample(moves.toClutter, MOVED_SAMPLE);
    hand(account, {
      title: `Moved by evening out: ${sample.length} of the ${moves.toClutter.length.toLocaleString()} photos counted as counterweights with raw scores and as clutter evened out`,
      settings: `Raw: ${settingsText('raw')}. Evened out: ${settingsText('evened')}. Lead over ${over === 'next' ? 'the next category' : 'the other kind'}. Spread evenly from the highest evened-out score to the lowest; each caption says where the photo went, raw → evened out, counterweights in green`,
      photos: sample.map((m) => ({ ...shown(worked, m.mediaKey), caption: moveCaption(m, [...CATEGORIES]) })),
      scored: worked.scored,
      scorings: [{ title: 'Raw scores', norms: null, weighting: settings.raw }, { title: 'Evened out', norms: worked.norms, weighting: settings.evened }],
      over,
    });
  };
  const openWeakest = () => {
    if (!worked || !rawMatches || account === null) throw new Error('The weakest matches can only be opened once suggestions are worked out for an account');
    const weakest = weakestMatches(rawMatches, WEAKEST_SAMPLE);
    hand(account, {
      title: `Nothing matches well: the ${weakest.length} photos whose best category scores lowest, with raw scores`,
      settings: 'Raw scores, every analysed photo, protected ones too. Lowest best score first; each caption gives that score and the category and description it came from, counterweights in green. What these photos show is what the list of descriptions may be missing',
      photos: weakest.map((m) => ({ ...shown(worked, m.mediaKey), caption: matchCaption(m, [...CATEGORIES]) })),
      scored: worked.scored,
      scorings: [{ title: null, norms: null, weighting: settings.raw }],
      over,
    });
  };
  const settingsText = (s: Scoring) => tuningLine(s, settings[s]);
  const hand = (forAccount: string, finds: Omit<AllFinds, 'account'>) => {
    const id = crypto.randomUUID();
    handovers.current.set(id, { account: forAccount, ...finds });
    window.open(`dev-clutter.html?all=${id}`, '_blank');
  };

  const number = (value: number, set: (n: number) => void, step: number) => (
    <input type="number" value={value} step={step} min={0} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber >= 0 && set(e.target.valueAsNumber)} />
  );

  return (
    <main className="review calibration">
      <header>
        <h1>Photo Cleaner <span className="muted">/ clutter suggestions (developer tool)</span></h1>
        <p className="account mono">{account ? accountLabel(account, answer?.account?.email ?? null) : 'No account yet'}</p>
        <p className="muted">
          Each analysed photo goes to the one category it looks most like, from {LIST.summary}, and counts only when that category is clearly
          ahead (see Settings). Hover over a photo to see how it scored. Nothing is trashed from here; the settings are kept in this browser. Keep a Google Photos tab open for the previews.
        </p>
      </header>
      <section className="card">
        {loaded.notes.map((note) => <p key={note} className="warn small">{note}</p>)}
        {saveProblem && <p className="warn small">{saveProblem}</p>}
        <TuningList settings={settings[scoring]} scoring={scoring} priority={priority} onSettings={changeSettings} onPriority={setPriority} />
      </section>
      <section className="card">
        <div className="buttons"><button className="primary" disabled={progress !== null} onClick={() => void workOut()}>Work out suggestions</button></div>
        {progress && <p className="working" role="status"><span className="spinner-inline" />{progress}</p>}
        {problem && <p className="warn">{problem}</p>}
      </section>
      {counts && (
        <section className="card">
          <h2>Settings</h2>
          <div className="segmented" role="group" aria-label="Scoring">
            <button className={scoring === 'raw' ? 'selected' : ''} aria-pressed={scoring === 'raw'} onClick={() => setScoring('raw')}>Raw scores</button>
            <button className={scoring === 'evened' ? 'selected' : ''} aria-pressed={scoring === 'evened'} onClick={() => setScoring('evened')}>Evened out</button>
          </div>
          <p className="muted small">
            {scoring === 'raw'
              ? 'Scores as the AI model gives them. Some descriptions score higher than others on every photo, so they win more often.'
              : 'Each score is how far above that description\'s average over the whole library the photo is, counted in its usual spread: 0 is average, 2 is far above it. Each scoring keeps its own settings.'}
          </p>
          <div className="segmented" role="group" aria-label="Lead over">
            <button className={over === 'next' ? 'selected' : ''} aria-pressed={over === 'next'} onClick={() => setOver('next')}>Lead over the next category</button>
            <button className={over === 'otherKind' ? 'selected' : ''} aria-pressed={over === 'otherKind'} onClick={() => setOver('otherKind')}>Lead over the other kind</button>
          </div>
          <p className="muted small">
            {over === 'next'
              ? 'The lead is measured against the next category of either kind, so a photo close between two kinds of clutter (a receipt or a document?) is a close call.'
              : 'Clutter leads over the counterweights, and a counterweight over the clutter, each kind pooled. Two kinds of clutter close together still count: the photo is clutter either way. With the same minimum lead this only adds photos.'}
          </p>
          <div className="row">
            <label>Pooling {number(settings[scoring].pooling, setting('pooling'), scoring === 'raw' ? 0.005 : 0.05)}</label>
          </div>
          <p className="muted small">
            Several categories close together count for more than the best of them: each votes exp(−gap ÷ pooling), 1 when level with the best and near
            nothing three times the pooling behind, and the pooled score is the best + pooling × ln(sum of votes). Two level add pooling × 0.69, three
            pooling × 1.10. 0: only the best counts, as before.
          </p>
          <p className="mono">{counts.photos.toLocaleString()} photos matched</p>
          <p className="mono">{kindTotals(counts)}</p>
          {moves && (
            <div className="row">
              <p className="small">{movesLine(moves)}</p>
              <button disabled={moves.toClutter.length === 0} onClick={openMoved}>Open a sample of what evening out moves</button>
            </div>
          )}
          <div className="row">
            <p className="small">The photos no description fits well show what the list is missing.</p>
            <button onClick={openWeakest}>Open the {WEAKEST_SAMPLE} photos nothing matches well</button>
          </div>
          {spread.map((s) => (
            <p key={s.fraction} className="mono small">{Math.round(s.fraction * 100)}% of photos: best score up to {s.bestScore.toFixed(3)}, lead over {over === 'next' ? 'the next category' : 'the other kind'} up to {s.lead.toFixed(3)}</p>
          ))}
          <div className="row">
            <label>Minimum score {number(settings[scoring].minScore, setting('minScore'), scoring === 'raw' ? 0.005 : 0.1)}</label>
            <label>Minimum lead {number(settings[scoring].margin, setting('margin'), scoring === 'raw' ? 0.002 : 0.05)}</label>
            <label>Photos for a suggestion {number(minPhotos, setMinPhotos, 5)}</label>
          </div>
        </section>
      )}
      {sections && worked && (
        <section className="card">
          <h2>Suggested searches</h2>
          {sections.suggested.length === 0 && <p className="muted">None with these settings.</p>}
          {sections.suggested.map((c) => <CategoryCard key={c.category.id} count={c} worked={worked} norms={norms} weighting={settings[scoring]} over={over} preview={preview} openAll={() => openAll(c)} />)}
          {sections.tooFew && <p className="muted small">{sections.tooFew}</p>}
        </section>
      )}
      {sections && worked && (
        <section className="card">
          <h2>Counterweights (never suggested)</h2>
          <p className="muted small">Where people, children, holidays and ordinary photos went. A clutter photo here is one the suggestions missed; check these hold the photos that should stay.</p>
          {sections.counterweights.map((c) => <CategoryCard key={c.category.id} count={c} worked={worked} norms={norms} weighting={settings[scoring]} over={over} preview={preview} openAll={() => openAll(c)} />)}
        </section>
      )}
    </main>
  );
}

/** A photo as a tab of photos shows it: its preview address and its scores, which must be in the library worked out. */
function shown(worked: Worked, mediaKey: string): { mediaKey: string; thumbUrl: string | null; row: Float32Array } {
  const photo = worked.photos.get(mediaKey);
  const row = worked.rows.get(mediaKey);
  if (!photo || !row) throw new Error('A counted photo is missing from the library it was counted in');
  return { mediaKey, thumbUrl: photo.thumbUrl, row };
}

/** A tab with a list of photos (a category's finds, or what evening out moves), handed over by the clutter page that opened it. */
function AllFindsPage({ id }: { id: string }) {
  const [finds, setFinds] = useState<AllFinds | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      setProblem('This tab has lost the clutter page that opened it. Open it again from there, with "Open all in a new tab".');
      return;
    }
    let answered = false;
    const receive = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== ANSWER || e.data.id !== id) return;
      answered = true;
      if (e.data.finds) setFinds(e.data.finds as AllFinds);
      else setProblem('The clutter page that opened this tab no longer has these finds (it was reloaded or worked them out again). Open them again from there.');
    };
    window.addEventListener('message', receive);
    opener.postMessage({ type: ASK, id }, location.origin);
    const timer = setTimeout(() => {
      if (!answered) setProblem('The clutter page that opened this tab did not answer. Open the finds again from there.');
    }, HANDOVER_WAIT_MS);
    return () => {
      window.removeEventListener('message', receive);
      clearTimeout(timer);
    };
  }, [id]);
  useEffect(() => {
    if (finds) document.title = `${finds.title} · Photo Cleaner`;
  }, [finds]);
  const deps = useMemo(() => (finds ? searchDeps(finds.account) : null), [finds]);
  const tiles = useMemo(
    () =>
      finds
        ? finds.photos.map((p): Tile => ({
            ...p,
            breakdowns: () => finds.scorings.map((s) => ({ title: s.title, breakdown: photoBreakdown(p.row, finds.scored, s.norms, s.weighting, finds.over, BREAKDOWN_ROWS) })),
          }))
        : [],
    [finds],
  );
  const preview: Preview = useCallback((thumbUrl: string, sizePx: number) => deps!.preview(thumbUrl, sizePx), [deps]);
  return (
    <main className="review calibration">
      <header>
        <h1>Photo Cleaner <span className="muted">/ all finds (developer tool)</span></h1>
        {finds && <p>{finds.title}</p>}
        {finds && <p className="muted">{finds.settings}. Best score first; hover over a photo to see how it scored. Keep a Google Photos tab open for the previews.</p>}
      </header>
      {problem && <section className="card"><p className="warn">{problem}</p></section>}
      {!finds && !problem && <section className="card"><p className="working" role="status"><span className="spinner-inline" />Getting the finds from the clutter page…</p></section>}
      {finds && (
        <section className="card">
          <PhotoGrid tiles={tiles} preview={preview} />
        </section>
      )}
    </main>
  );
}

const allFinds = new URLSearchParams(location.search).get('all');
createRoot(document.getElementById('root')!).render(allFinds ? <AllFindsPage id={allFinds} /> : <Clutter />);
