// The panel beside photos.google.com (Chrome's side panel, closed with Chrome's own button): the
// control room for the account signed in to its tab.

import { createRoot } from 'react-dom/client';
import { UsageCard, useUsageSurface } from '../ui/UsageCard';
import { versionLabel } from '../shared/jobView';
import { panelTab } from '../shared/messages';
import { LOCAL_BUILD } from '../shared/version';
import { extensionVersion, send, useSignedInScan, useStartOverWhenErased } from '../ui/hooks';
import { ScanCard, StorageProblem } from '../ui/JobCard';

const TAB_ID = panelTab(location.search);
const VERSION_LABEL = versionLabel(extensionVersion(), LOCAL_BUILD);

function Panel() {
  useUsageSurface('panel', 'panel');
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
      <UsageCard />
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
      <p className="version mono" title="Photo Cleaner's version">{VERSION_LABEL}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);
