// Developer tool: suggested searches for clutter, worked out from this library's fingerprints, to judge
// whether they are right and useful before they become part of the product (search/clutter.ts).
// Reads the same data as Search; nothing is saved and nothing is trashed from here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CATEGORIES, categoryList, categorySamples, countCategories, countLine, countSections, descriptionNorms, descriptionScores, matchPhoto, photoBreakdown, photoCaption, scoreSpread, STARTING_SETTINGS, type Breakdown, type LeadOver, type CategoryCount, type CategoryPhoto, type ClutterSettings, type DescriptionNorms, type ScoredCategory, type Scoring } from '../search/clutter';
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

const LIST = categoryList(CATEGORIES);

interface Worked {
  photos: Map<string, LibraryPhoto>;
  scored: ScoredCategory[];
  /** Every photo's score for every description, kept so changing the scoring needs no AI work. */
  rows: Map<string, Float32Array>;
  norms: DescriptionNorms;
}

/** Everything a tab showing all of one category's finds needs, handed over by the page that opened it. */
interface AllFinds {
  account: string;
  /** The category's count line, as on the page that opened it. */
  title: string;
  /** The scoring and settings the finds were counted with. */
  settings: string;
  /** Best score first, each with its score for every description. */
  photos: (CategoryPhoto & { thumbUrl: string | null; row: Float32Array })[];
  scored: ScoredCategory[];
  norms: DescriptionNorms | null;
  over: LeadOver;
}

function BreakdownCard({ breakdown, side }: { breakdown: Breakdown; side: 'right' | 'left' }) {
  return (
    <div className={`clutter-card ${side}`} role="tooltip">
      <p className="clutter-card-heading">{breakdown.heading}</p>
      <table>
        <tbody>
          {breakdown.rows.map((r) => (
            <tr key={r.label} className={r.kind}>
              <td className="mono">{r.score}</td>
              <td>{r.label}<span className="muted"> · {r.description}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{breakdown.more ? `${breakdown.more}. ` : ''}Green: counterweights.</p>
    </div>
  );
}

function Thumb({ photo, preview, breakdown }: { photo: CategoryPhoto & { thumbUrl: string | null }; preview: (thumbUrl: string) => Promise<string>; breakdown: () => Breakdown }) {
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
    preview(photo.thumbUrl).then((u) => alive && setUrl(u), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [near, photo.thumbUrl, preview]);
  const open = (e: { currentTarget: HTMLElement }) => setCard(e.currentTarget.getBoundingClientRect().right + CARD_WIDTH + 16 > window.innerWidth ? 'left' : 'right');
  return (
    <figure ref={figure} className="search-tile clutter-tile" onMouseEnter={open} onMouseLeave={() => setCard(null)} onFocus={open} onBlur={() => setCard(null)}>
      <div className="search-tile-image">{url ? <img src={url} alt="" draggable={false} /> : <span className="muted small">{failed ? 'No preview' : '…'}</span>}</div>
      <figcaption className="small"><a href={`https://photos.google.com/photo/${photo.mediaKey}`} target="_blank" rel="noreferrer">{photoCaption(photo)}</a></figcaption>
      {card && <BreakdownCard breakdown={breakdown()} side={card} />}
    </figure>
  );
}

function CategoryCard({ count, worked, norms, over, preview, openAll }: { count: CategoryCount; worked: Worked; norms: DescriptionNorms | null; over: LeadOver; preview: (thumbUrl: string) => Promise<string>; openAll: () => void }) {
  const [open, setOpen] = useState(false);
  const samples = useMemo(() => (open ? categorySamples(count, SAMPLE) : null), [open, count]);
  const thumb = (p: CategoryPhoto) => {
    const photo = worked.photos.get(p.mediaKey);
    const row = worked.rows.get(p.mediaKey);
    if (!photo || !row) throw new Error('A counted photo is missing from the library it was counted in');
    return <Thumb key={p.mediaKey} photo={{ ...p, thumbUrl: photo.thumbUrl }} preview={preview} breakdown={() => photoBreakdown(row, worked.scored, norms, over, BREAKDOWN_ROWS)} />;
  };
  const grid = (title: string, photos: CategoryPhoto[]) =>
    photos.length > 0 && (
      <>
        <p className="clutter-sample-title">{title}</p>
        <div className="search-grid">{photos.map(thumb)}</div>
      </>
    );
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{countLine(count)} <span className="muted small">{count.category.descriptions.join(' · ')}</span></summary>
      {samples && (
        <>
          {grid('Strongest matches', samples.strongest)}
          {grid('Weakest still counted (lowest scores)', samples.weakest)}
          {grid('Just counted: the smallest leads that still made it', samples.justCounted)}
          {grid('Just missed: close calls with the largest leads, not counted', samples.justMissed)}
          <p className="clutter-sample-title">All {count.trashable.length.toLocaleString()} counted</p>
          <div className="buttons clutter-show-all"><button onClick={openAll}>Open all in a new tab</button></div>
        </>
      )}
    </details>
  );
}

function CategoryList() {
  return (
    <details className="clutter-categories">
      <summary>Categories: {LIST.summary}</summary>
      {LIST.groups.map((g) => (
        <div key={g.kind}>
          <h3>{g.title} · {g.count}</h3>
          <p className="muted small">{g.note}</p>
          <dl className="clutter-list">
            {g.categories.map((c) => (
              <div key={c.id}>
                <dt>{c.label}</dt>
                <dd>{c.descriptions.join(' · ')}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
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
  const [over, setOver] = useState<LeadOver>('next');
  const [settings, setSettings] = useState<Record<Scoring, ClutterSettings>>(STARTING_SETTINGS);
  const [minPhotos, setMinPhotos] = useState(20);
  const setting = (key: keyof ClutterSettings) => (value: number) => setSettings((s) => ({ ...s, [scoring]: { ...s[scoring], [key]: value } }));

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
  const matches = useMemo(() => (worked ? [...worked.rows].map(([key, row]) => matchPhoto(key, row, worked.scored, norms)) : null), [worked, norms]);
  const counts = useMemo(() => (worked && matches ? countCategories(matches, [...CATEGORIES], worked.photos, settings[scoring], over) : null), [worked, matches, settings, scoring, over]);
  const spread = useMemo(() => (matches ? scoreSpread(matches, over) : []), [matches, over]);
  const sections = counts ? countSections(counts, minPhotos) : null;
  const preview = useCallback((thumbUrl: string) => deps!.preview(thumbUrl, 160), [deps]);

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
    const photos = count.trashable.map((p) => {
      const photo = worked.photos.get(p.mediaKey);
      const row = worked.rows.get(p.mediaKey);
      if (!photo || !row) throw new Error('A counted photo is missing from the library it was counted in');
      return { ...p, thumbUrl: photo.thumbUrl, row };
    });
    const { minScore, margin } = settings[scoring];
    const id = crypto.randomUUID();
    handovers.current.set(id, {
      account,
      title: countLine(count),
      settings: `${scoring === 'raw' ? 'Raw scores' : 'Evened out'}, minimum score ${minScore}, minimum lead ${margin} over ${over === 'next' ? 'the next category' : 'the other kind'}`,
      photos,
      scored: worked.scored,
      norms,
      over,
    });
    window.open(`dev-clutter.html?all=${id}`, '_blank');
  };

  const number = (value: number, set: (n: number) => void, step: number) => (
    <input type="number" value={value} step={step} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && set(e.target.valueAsNumber)} />
  );

  return (
    <main className="review calibration">
      <header>
        <h1>Photo Cleaner <span className="muted">/ clutter suggestions (developer tool)</span></h1>
        <p className="account mono">{account ? accountLabel(account, answer?.account?.email ?? null) : 'No account yet'}</p>
        <p className="muted">
          Each analysed photo goes to the one category it looks most like, from {LIST.summary}, and counts only when that category is clearly
          ahead (see Settings). Hover over a photo to see how it scored. Nothing is saved or trashed from here. Keep a Google Photos tab open for the previews.
        </p>
      </header>
      <section className="card">
        <CategoryList />
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
              : 'Clutter leads over the best counterweight, and a counterweight over the best clutter. Two kinds of clutter close together still count: the photo is clutter either way. With the same minimum lead this only adds photos.'}
          </p>
          <p className="mono">{counts.photos.toLocaleString()} photos matched</p>
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
          {sections.suggested.map((c) => <CategoryCard key={c.category.id} count={c} worked={worked} norms={norms} over={over} preview={preview} openAll={() => openAll(c)} />)}
          {sections.tooFew && <p className="muted small">{sections.tooFew}</p>}
        </section>
      )}
      {sections && worked && (
        <section className="card">
          <h2>Counterweights (never suggested)</h2>
          <p className="muted small">Where people, children, holidays and ordinary photos went. A clutter photo here is one the suggestions missed; check these hold the photos that should stay.</p>
          {sections.counterweights.map((c) => <CategoryCard key={c.category.id} count={c} worked={worked} norms={norms} over={over} preview={preview} openAll={() => openAll(c)} />)}
        </section>
      )}
    </main>
  );
}

/** A tab with every photo counted for one category, handed over by the clutter page that opened it. */
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
  const preview = useCallback((thumbUrl: string) => deps!.preview(thumbUrl, 160), [deps]);
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
          <div className="search-grid">
            {finds.photos.map((p) => (
              <Thumb key={p.mediaKey} photo={p} preview={preview} breakdown={() => photoBreakdown(p.row, finds.scored, finds.norms, finds.over, BREAKDOWN_ROWS)} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

const allFinds = new URLSearchParams(location.search).get('all');
createRoot(document.getElementById('root')!).render(allFinds ? <AllFindsPage id={allFinds} /> : <Clutter />);
