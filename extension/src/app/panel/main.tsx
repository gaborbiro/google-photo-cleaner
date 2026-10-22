// The panel beside photos.google.com (Chrome's side panel, closed with Chrome's own button): the
// control room for the account signed in to its tab.

import { createRoot } from 'react-dom/client';
import { panelTab } from '../shared/messages';
import { send, useSignedInScan, useStartOverWhenErased } from '../ui/hooks';
import { ScanCard, StorageProblem } from '../ui/JobCard';

const TAB_ID = panelTab(location.search);

function Panel() {
  useStartOverWhenErased();
  const { view, scan, analysis, report, launch } = useSignedInScan(TAB_ID);
  return (
    <main className="panel">
      <header className="surface-header">
        <div>
          <h1>Photo Cleaner</h1>
          {view.accountName && <p className="account mono" title="The Google account signed in to Google Photos">{view.accountName}</p>}
        </div>
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
