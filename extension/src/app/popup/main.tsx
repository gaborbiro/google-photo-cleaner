// The toolbar popup: the front door. Says what to do next, depending on where things stand.

import { createRoot } from 'react-dom/client';
import { UsageCard, useUsageSurface } from '../ui/UsageCard';
import { openPhotos, send, showPanel, useSignedInScan, useStartOverWhenErased } from '../ui/hooks';
import { ScanCard, StorageProblem } from '../ui/JobCard';

function Popup() {
  useUsageSurface('popup');
  useStartOverWhenErased();
  const { view, scan, analysis, report, launch } = useSignedInScan();
  const { panelTab } = view;
  return (
    <main className="popup">
      <header>
        <h1>Photo Cleaner</h1>
        {view.accountName && <p className="account mono" title="The Google account signed in to Google Photos">{view.accountName}</p>}
      </header>
      <StorageProblem />
      {view.state !== 'looking' && <UsageCard />}
      {view.state === 'looking' && <p className="muted">Looking for Google Photos…</p>}
      {view.state === 'no-photos' && <p>Photo Cleaner works inside Google Photos. Open it to scan your library.</p>}
      {view.state === 'problem' && <p className="warn">{view.problemText}</p>}
      {view.offerPhotos && <button className="primary" onClick={() => void openPhotos()}>Open Google Photos</button>}
      {view.account && (
        <>
          {scan !== undefined && analysis !== undefined && <ScanCard account={view.account} scan={scan} analysis={analysis} report={report} surface="popup" />}
          <div className="launch">
            <button className="primary" onClick={() => void send({ kind: 'app-open-review', account: view.account, tab: launch.tab })}>{launch.text} <span aria-hidden="true">↗</span></button>
            {panelTab !== null && <button onClick={() => void showPanel(panelTab)}>Open panel in Google Photos <span aria-hidden="true">↗</span></button>}
          </div>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
