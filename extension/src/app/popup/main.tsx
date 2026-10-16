// The toolbar popup: the front door. Says what to do next, depending on where things stand.

import { createRoot } from 'react-dom/client';
import { send, useSignedInScan, useStartOverWhenErased } from '../ui/hooks';
import { EraseCard, ScanCard, StorageProblem } from '../ui/JobCard';

function Popup() {
  useStartOverWhenErased();
  const { view, scan, analysis, report, reviewText } = useSignedInScan();
  return (
    <main className="popup">
      <header>
        <h1>Photo Cleaner</h1>
        {view.accountName && <p className="account mono" title="The Google account signed in to Google Photos">{view.accountName}</p>}
      </header>
      <StorageProblem />
      {view.state === 'looking' && <p className="muted">Looking for Google Photos…</p>}
      {view.state === 'no-photos' && (
        <>
          <p>Photo Cleaner works inside Google Photos. Open it to scan your library.</p>
          <button className="primary" onClick={() => void send({ kind: 'app-open-photos' })}>Open Google Photos</button>
        </>
      )}
      {view.state === 'problem' && <p className="warn">{view.problemText}</p>}
      {view.account && (
        <>
          {scan !== undefined && analysis !== undefined && <ScanCard account={view.account} scan={scan} analysis={analysis} report={report} />}
          <div className="launch">
            {reviewText && <button className="primary" onClick={() => void send({ kind: 'app-open-review', account: view.account })}>{reviewText}</button>}
            <button onClick={() => void send({ kind: 'app-show-panel' })}>Show panel in Google Photos</button>
            <button onClick={() => void send({ kind: 'app-open-review', account: view.account })}>Open in tab <span aria-hidden="true">↗</span></button>
          </div>
        </>
      )}
      <EraseCard />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
