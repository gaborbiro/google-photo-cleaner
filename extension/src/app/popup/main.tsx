// The toolbar popup: the front door. Says what to do next, depending on where things stand.

import { createRoot } from 'react-dom/client';
import { accountLabel } from '../shared/jobView';
import { send, useAccount, useReport, useScanJob } from '../ui/hooks';
import { JobCard, ReportSummary } from '../ui/JobCard';

function Popup() {
  const { answer } = useAccount();
  const account = answer?.account ?? null;
  const job = useScanJob(account?.fingerprint ?? null);
  const report = useReport(account?.fingerprint ?? null, job);
  return (
    <main className="popup">
      <h1>Photo Cleaner</h1>
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
          {job !== undefined && <JobCard account={account.fingerprint} job={job} />}
          {report && <ReportSummary report={report} />}
          <div className="row">
            <button onClick={() => void send({ kind: 'app-show-panel' })}>Show panel in Google Photos</button>
            <button onClick={() => void send({ kind: 'app-open-review', account: account.fingerprint })}>Open review tab</button>
          </div>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
