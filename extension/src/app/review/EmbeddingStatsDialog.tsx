import { useEffect, useSyncExternalStore } from 'react';
import type { EmbeddingStats } from './embeddingStats';

/** The complete, locally stored AI fingerprint for the photo chosen from Chrome's context menu. */
export function EmbeddingStatsDialog({ stats }: { stats: EmbeddingStats }) {
  const view = useSyncExternalStore(stats.subscribe, stats.getView);
  useEffect(() => {
    if (!view.open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stats.close();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [stats, view.open]);
  if (!view.open) return null;
  return (
    <div className="stats-backdrop" role="dialog" aria-modal="true" aria-labelledby="stats-title" onMouseDown={(event) => { if (event.target === event.currentTarget) stats.close(); }}>
      <section className="stats-dialog">
        <header>
          <div>
            <h2 id="stats-title">Stats for nerds</h2>
            <p className="muted">The AI fingerprint stored on this computer. It is never sent anywhere.</p>
          </div>
          <button aria-label="Close Stats for nerds" onClick={() => stats.close()}>×</button>
        </header>
        {view.loading && <p className="working" role="status"><span className="spinner-inline" />Reading the embedding…</p>}
        {view.problem && <p className="banner tone-negative" role="alert">{view.problem}</p>}
        {view.vectorText && (
          <>
            <dl className="stats-grid">
              <dt>Model</dt><dd className="mono">{view.modelKey}</dd>
              <dt>Dimensions</dt><dd className="mono">{view.dimensions}</dd>
              <dt>Analysed</dt><dd className="mono">{view.analysedAt}</dd>
              <dt>Analysis preview</dt><dd className="mono">{view.previewSize}</dd>
              <dt>Sharpness</dt><dd className="mono">{view.sharpness}</dd>
              <dt>Brightness</dt><dd className="mono">{view.brightness}</dd>
              <dt>Clipped dark</dt><dd className="mono">{view.clippedDark}</dd>
              <dt>Clipped bright</dt><dd className="mono">{view.clippedBright}</dd>
            </dl>
            <label htmlFor="embedding-vector">Full embedding vector</label>
            <textarea id="embedding-vector" className="embedding-vector mono" readOnly spellCheck={false} value={view.vectorText} />
          </>
        )}
      </section>
    </div>
  );
}
