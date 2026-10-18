// The panel inside photos.google.com: the control room for the account signed in to this tab.

import { createRoot } from 'react-dom/client';
import { send, useSignedInScan, useStartOverWhenErased } from '../ui/hooks';
import { ScanCard, StorageProblem } from '../ui/JobCard';

function Panel() {
  useStartOverWhenErased();
  const { view, scan, analysis, report, launch } = useSignedInScan();
  return (
    <main className="panel">
      <header className="surface-header">
        <div>
          <h1>Photo Cleaner</h1>
          {view.accountName && <p className="account mono" title="The Google account signed in to Google Photos">{view.accountName}</p>}
        </div>
        <button className="ghost" title="Close the panel (a scan keeps running)" aria-label="Close the panel" onClick={() => window.parent.postMessage({ kind: 'app-close-panel' }, 'https://photos.google.com')}>×</button>
      </header>
      <StorageProblem />
      {view.state === 'looking' && <p className="muted">Checking which account is signed in…</p>}
      {view.problemText && <p className="warn">{view.problemText}</p>}
      {view.account && scan !== undefined && analysis !== undefined && <ScanCard account={view.account} scan={scan} analysis={analysis} report={report} surface="panel" />}
      <div className="explanation">
        <p>
          <strong>Photos never leave your computer.</strong> It runs in the extension's background, so closing this panel doesn't stop it; pausing keeps its progress.
        </p>
      </div>
      {view.account && (
        <div className="launch">
          <button onClick={() => void send({ kind: 'app-open-review', account: view.account, tab: launch.tab })}>{launch.text} <span aria-hidden="true">↗</span></button>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);
