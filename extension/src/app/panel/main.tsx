// The panel inside photos.google.com: the control room for the account signed in to this tab.

import { createRoot } from 'react-dom/client';
import { accountLabel } from '../shared/jobView';
import { send, useAccount, useScanJob } from '../ui/hooks';
import { JobCard } from '../ui/JobCard';

function Panel() {
  const { answer } = useAccount();
  const account = answer?.account ?? null;
  const job = useScanJob(account?.fingerprint ?? null);
  return (
    <main>
      <header className="row">
        <h1>Photo Cleaner</h1>
        <button className="ghost" title="Close the panel (the scan keeps running)" onClick={() => window.parent.postMessage({ kind: 'app-close-panel' }, 'https://photos.google.com')}>✕</button>
      </header>
      {answer === undefined && <p className="muted">Checking which account is signed in…</p>}
      {answer && !account && <p className="warn">{answer.problem}</p>}
      {account && (
        <>
          <p className="mono">Account: {accountLabel(account.fingerprint, account.email)}</p>
          {job !== undefined && <JobCard account={account.fingerprint} job={job} />}
          <button onClick={() => void send({ kind: 'app-open-review', account: account.fingerprint })}>Open review tab</button>
        </>
      )}
      <p className="muted small">
        Preview (M1): the scan is a pretend job that counts to 400. It runs in the extension's background page, so closing
        this panel or the tab doesn't stop it, and it carries on after a browser restart.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);
