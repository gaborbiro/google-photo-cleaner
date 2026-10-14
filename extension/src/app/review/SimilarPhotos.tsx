// The analysis spot check: pick one of your newest photos and see the photos the AI thinks look
// most like it. A way to judge the fingerprints by eye before duplicates and search build on them.

import { useEffect, useState } from 'react';
import { IndexedDbAnalysisStore } from '../ai/analysisStore';
import { mostSimilar, newestAnalysed, type Fingerprint, type Match } from '../ai/similar';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import type { InventoryItem } from '../scan/model';
import { previewDataUrl } from '../ui/hooks';

const analysisStore = new IndexedDbAnalysisStore();
const inventory = new IndexedDbInventoryStore();
const STARTING_POINTS = 18;
const MATCHES = 12;

interface Loaded {
  items: Map<string, InventoryItem>;
  fingerprints: Fingerprint[];
  starts: InventoryItem[];
}

function Thumb({ account, item, caption, selected, onClick }: { account: string; item: InventoryItem; caption?: string; selected?: boolean; onClick?: () => void }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (item.thumbUrl) void previewDataUrl(account, item.thumbUrl, 256).then((url) => alive && setSrc(url));
    else setSrc(null);
    return () => {
      alive = false;
    };
  }, [account, item.thumbUrl]);
  return (
    <figure className={`thumb${selected ? ' selected' : ''}`} onClick={onClick}>
      {src ? <img src={src} alt="" /> : <div className="muted small">{src === null ? 'no preview' : '…'}</div>}
      <figcaption className="mono small">{caption ?? new Date(item.takenAtMs).toLocaleDateString('en-GB')}</figcaption>
    </figure>
  );
}

export function SimilarPhotos({ account, analysedCount }: { account: string; analysedCount: number }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [target, setTarget] = useState<InventoryItem | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);

  // Loaded when opened, and again every few hundred newly analysed photos.
  const bucket = Math.floor(analysedCount / 500);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const settings = await analysisStore.settings(account);
      const run = await inventory.latestRun(account);
      if (!settings || !run) return;
      const [embeddings, snapshot] = await Promise.all([analysisStore.embeddings(settings.modelKey, account), inventory.snapshot(run.id)]);
      const items = new Map(snapshot.items.map((i) => [i.mediaKey, i]));
      const fingerprints = embeddings.map((e) => ({ mediaKey: e.mediaKey, vector: e.vector }));
      const starts = newestAnalysed(snapshot.items, new Set(fingerprints.map((f) => f.mediaKey)), STARTING_POINTS);
      if (alive) setLoaded({ items, fingerprints, starts });
    })();
    return () => {
      alive = false;
    };
  }, [account, bucket]);

  const pick = (item: InventoryItem) => {
    if (!loaded) return;
    const fingerprint = loaded.fingerprints.find((f) => f.mediaKey === item.mediaKey);
    if (!fingerprint) return;
    setTarget(item);
    setMatches(mostSimilar(fingerprint, loaded.fingerprints, MATCHES));
  };

  if (!loaded) return <p className="muted">The spot check appears once some photos are analysed.</p>;
  return (
    <section className="card">
      <strong>Spot check: photos that look alike</strong>
      <p className="muted small">Pick one of your newest photos; the AI shows the {MATCHES} photos it finds most similar across your library ({loaded.fingerprints.length.toLocaleString('en-GB')} analysed so far).</p>
      <div className="thumbs">
        {loaded.starts.map((item) => (
          <Thumb key={item.mediaKey} account={account} item={item} selected={target?.mediaKey === item.mediaKey} onClick={() => pick(item)} />
        ))}
      </div>
      {target && (
        <>
          <strong>Most similar</strong>
          <div className="thumbs">
            {matches.map((m) => {
              const item = loaded.items.get(m.mediaKey);
              return item ? <Thumb key={m.mediaKey} account={account} item={item} caption={`${(m.similarity * 100).toFixed(1)}% · ${new Date(item.takenAtMs).toLocaleDateString('en-GB')}`} /> : null;
            })}
          </div>
        </>
      )}
    </section>
  );
}
