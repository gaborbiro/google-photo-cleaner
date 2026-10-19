// Developer tool: suggested searches for clutter, worked out from this library's fingerprints, to judge
// whether they are right and useful before they become part of the product (search/clutter.ts).
// Reads the same data as Search; nothing is saved and nothing is trashed from here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CATEGORIES, countCategories, countLine, matchPhoto, scoreSpread, suggestions, type CategoryCount, type CategoryPhoto, type PhotoMatch, type ScoredCategory } from '../search/clutter';
import type { LibraryPhoto } from '../search/searchModel';
import { searchDeps } from '../search/session';
import { accountLabel } from '../shared/jobView';
import { useAccount } from '../ui/hooks';

/** Photos matched between pauses, so the page keeps drawing while it works. */
const CHUNK = 500;
/** Photos shown from each end of a category: the strongest matches and the weakest still counted. */
const SAMPLE = 12;

interface Worked {
  matches: PhotoMatch[];
  photos: Map<string, LibraryPhoto>;
}

function Thumb({ photo, preview }: { photo: CategoryPhoto & { thumbUrl: string | null }; preview: (thumbUrl: string) => Promise<string> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!photo.thumbUrl) {
      setFailed(true);
      return;
    }
    let alive = true;
    preview(photo.thumbUrl).then((u) => alive && setUrl(u), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [photo.thumbUrl, preview]);
  return (
    <figure className="search-tile">
      <div className="search-tile-image">{url ? <img src={url} alt="" draggable={false} /> : <span className="muted small">{failed ? 'No preview' : '…'}</span>}</div>
      <figcaption className="small"><a href={`https://photos.google.com/photo/${photo.mediaKey}`} target="_blank" rel="noreferrer">{photo.score.toFixed(3)}</a></figcaption>
    </figure>
  );
}

function CategoryCard({ count, photos, preview }: { count: CategoryCount; photos: Map<string, LibraryPhoto>; preview: (thumbUrl: string) => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const withThumb = (p: CategoryPhoto) => ({ ...p, thumbUrl: photos.get(p.mediaKey)?.thumbUrl ?? null });
  const strongest = count.trashable.slice(0, SAMPLE);
  const weakest = count.trashable.length > SAMPLE * 2 ? count.trashable.slice(-SAMPLE) : count.trashable.slice(SAMPLE);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{countLine(count)} <span className="muted small">{count.category.descriptions.join(' · ')}</span></summary>
      {open && (
        <>
          <p className="muted small">Strongest matches</p>
          <div className="search-grid">{strongest.map((p) => <Thumb key={p.mediaKey} photo={withThumb(p)} preview={preview} />)}</div>
          {weakest.length > 0 && <p className="muted small">Weakest still counted</p>}
          <div className="search-grid">{weakest.map((p) => <Thumb key={p.mediaKey} photo={withThumb(p)} preview={preview} />)}</div>
        </>
      )}
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
  const [minScore, setMinScore] = useState(0);
  const [margin, setMargin] = useState(0.02);
  const [minPhotos, setMinPhotos] = useState(20);

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
      const matches: PhotoMatch[] = [];
      for (let i = 0; i < photos.length; i += CHUNK) {
        for (const p of photos.slice(i, i + CHUNK)) matches.push(matchPhoto(p.mediaKey, p.vector, scored));
        setProgress(`Matching photos: ${matches.length.toLocaleString()} of ${photos.length.toLocaleString()}`);
        await new Promise((resolve) => setTimeout(resolve));
      }
      setWorked({ matches, photos: library.photos });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
    }
  };

  const counts = useMemo(() => (worked ? countCategories(worked.matches, [...CATEGORIES], worked.photos, { minScore, margin }) : null), [worked, minScore, margin]);
  const spread = useMemo(() => (worked ? scoreSpread(worked.matches) : []), [worked]);
  const shown = counts ? suggestions(counts, minPhotos) : [];
  const smallClutter = counts ? counts.categories.filter((c) => c.category.kind === 'clutter' && !shown.includes(c)) : [];
  const keep = counts ? counts.categories.filter((c) => c.category.kind === 'keep') : [];
  const preview = useCallback((thumbUrl: string) => deps!.preview(thumbUrl, 160), [deps]);

  const number = (value: number, set: (n: number) => void, step: number) => (
    <input type="number" value={value} step={step} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && set(e.target.valueAsNumber)} />
  );

  return (
    <main className="review calibration">
      <header>
        <h1>Photo Cleaner <span className="muted">/ clutter suggestions (developer tool)</span></h1>
        <p className="account mono">{account ? accountLabel(account, answer?.account?.email ?? null) : 'No account yet'}</p>
        <p className="muted">
          Each analysed photo goes to the one category it looks most like, from {CATEGORIES.filter((c) => c.kind === 'clutter').length} kinds of clutter and{' '}
          {CATEGORIES.filter((c) => c.kind === 'keep').length} kinds of photo people keep, and counts only when that category is clearly ahead of the next.
          Nothing is saved or trashed from here. Keep a Google Photos tab open for the previews.
        </p>
      </header>
      <section className="card">
        <div className="buttons"><button className="primary" disabled={progress !== null} onClick={() => void workOut()}>Work out suggestions</button></div>
        {progress && <p className="working" role="status"><span className="spinner-inline" />{progress}</p>}
        {problem && <p className="warn">{problem}</p>}
      </section>
      {counts && (
        <section className="card">
          <h2>Settings</h2>
          <p className="mono">{counts.photos.toLocaleString()} photos matched</p>
          {spread.map((s) => (
            <p key={s.fraction} className="mono small">{Math.round(s.fraction * 100)}% of photos: best score up to {s.bestScore.toFixed(3)}, lead over the next category up to {s.lead.toFixed(3)}</p>
          ))}
          <div className="row">
            <label>Minimum score {number(minScore, setMinScore, 0.005)}</label>
            <label>Minimum lead {number(margin, setMargin, 0.002)}</label>
            <label>Photos for a suggestion {number(minPhotos, setMinPhotos, 5)}</label>
          </div>
        </section>
      )}
      {counts && worked && (
        <section className="card">
          <h2>Suggested searches</h2>
          {shown.length === 0 && <p className="muted">None with these settings.</p>}
          {shown.map((c) => <CategoryCard key={c.category.id} count={c} photos={worked.photos} preview={preview} />)}
          {smallClutter.length > 0 && <p className="muted small">Too few to suggest: {smallClutter.map(countLine).join(' · ')}</p>}
        </section>
      )}
      {counts && worked && (
        <section className="card">
          <h2>Kept apart (never suggested)</h2>
          <p className="muted small">Where people, children, holidays and ordinary photos went. A clutter photo here is one the suggestions missed; check these hold the photos that should stay.</p>
          {keep.map((c) => <CategoryCard key={c.category.id} count={c} photos={worked.photos} preview={preview} />)}
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Clutter />);
