// The panel inside photos.google.com: the control room for the account signed in to this tab.

import { createRoot } from 'react-dom/client';
import { accountLabel } from '../shared/jobView';
import { send, useAccount, useReport, useScanJob } from '../ui/hooks';
import { JobCard, ReportSummary } from '../ui/JobCard';

function Panel() {
  const { answer } = useAccount();
  const account = answer?.account ?? null;
  const job = useScanJob(account?.fingerprint ?? null);
  const report = useReport(account?.fingerprint ?? null, job);
  return (
    <main>
      <header className="row">
        <h1>Photo Cleaner</h1>
        <button className="ghost" title="Close the panel (a scan keeps running)" onClick={() => window.parent.postMessage({ kind: 'app-close-panel' }, 'https://photos.google.com')}>✕</button>
      </header>
      {answer === undefined && <p className="muted">Checking which account is signed in…</p>}
      {answer && !account && <p className="warn">{answer.problem}</p>}
      {account && (
        <>
          <p className="mono">Account: {accountLabel(account.fingerprint, account.email)}</p>
          {job !== undefined && <JobCard account={account.fingerprint} job={job} />}
          {report && <ReportSummary report={report} />}
          <button onClick={() => void send({ kind: 'app-open-review', account: account.fingerprint })}>Open review tab</button>
        </>
      )}
      <p className="muted small">
        Reads your library, favourites, archive and every album (read-only) and works out which photos are protected.
        It runs in the extension's background, so closing this panel doesn't stop it; pausing keeps its progress.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);
