// The toolbar popup: the front door. Says what to do next, depending on where things stand.

import { createRoot } from 'react-dom/client';
import { accountLabel } from '../shared/jobView';
import { send, useAccount, useAnalysisJob, useProtectionChoices, useReport, useScanJob, useStartOverWhenErased } from '../ui/hooks';
import { EraseCard, ScanCard, StorageProblem } from '../ui/JobCard';

function Popup() {
  useStartOverWhenErased();
  const { answer } = useAccount();
  const account = answer?.account ?? null;
  const job = useScanJob(account?.fingerprint ?? null);
  const report = useReport(account?.fingerprint ?? null, job, useProtectionChoices(account?.fingerprint ?? null));
  const analysis = useAnalysisJob(account?.fingerprint ?? null);
  return (
    <main className="popup">
      <h1>Photo Cleaner</h1>
      <StorageProblem />
      {answer === undefined && <p className="muted">Looking for Google Photos…</p>}
      {answer && !answer.photosTabOpen && (
        <>
          <p>Photo Cleaner works inside Google Photos. Open it to scan your library.</p>
          <button className="primary" onClick={() => void send({ kind: 'app-open-photos' })}>Open Google Photos</button>
        </>
      )}
      {answer?.photosTabOpen && !account && <p className="warn">{answer.problem}</p>}
      {account && (
        <>
          <p className="mono">Account: {accountLabel(account.fingerprint, account.email)}</p>
          {job !== undefined && analysis !== undefined && <ScanCard account={account.fingerprint} scan={job} analysis={analysis} report={report} />}
          <div className="row">
            <button onClick={() => void send({ kind: 'app-show-panel' })}>Show panel in Google Photos</button>
            <button onClick={() => void send({ kind: 'app-open-review', account: account.fingerprint })}>Open in tab <span aria-hidden="true">⤢</span></button>
          </div>
        </>
      )}
      <EraseCard />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
