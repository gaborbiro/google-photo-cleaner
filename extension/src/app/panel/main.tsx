// The panel inside photos.google.com: the control room for the account signed in to this tab.

import { createRoot } from 'react-dom/client';
import { send, useSignedInScan, useStartOverWhenErased } from '../ui/hooks';
import { ScanCard, StorageProblem } from '../ui/JobCard';

function Panel() {
  useStartOverWhenErased();
  const { view, scan, analysis, report } = useSignedInScan();
  return (
    <main>
      <header className="row">
        <h1>Photo Cleaner</h1>
        <button className="ghost" title="Close the panel (a scan keeps running)" onClick={() => window.parent.postMessage({ kind: 'app-close-panel' }, 'https://photos.google.com')}>✕</button>
      </header>
      <StorageProblem />
      {view.state === 'looking' && <p className="muted">Checking which account is signed in…</p>}
      {view.problemText && <p className="warn">{view.problemText}</p>}
      {view.account && (
        <>
          <p className="mono">{view.accountText}</p>
          {scan !== undefined && analysis !== undefined && <ScanCard account={view.account} scan={scan} analysis={analysis} report={report} />}
        </>
      )}
      <p className="muted small">
        Reads the list of your photos, favourites, archive and every album (read-only) and works out which photos are protected; then the AI analyses the new photos on this computer's graphics card. Photos never leave your computer.
        It runs in the extension's background, so closing this panel doesn't stop it; pausing keeps its progress.
      </p>
      {view.account && (
        <button onClick={() => void send({ kind: 'app-open-review', account: view.account })}>Open in tab <span aria-hidden="true">⤢</span></button>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);
