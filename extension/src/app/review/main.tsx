// The review tab: the workbench. In M1 it shows every account's saved scan; Duplicates (M4)
// and Search (M5) come here.

import { createRoot } from 'react-dom/client';
import { accountLabel, jobView } from '../shared/jobView';
import { send, useAccount, useAllJobs } from '../ui/hooks';
import { JobCard } from '../ui/JobCard';

function Review() {
  const { answer } = useAccount();
  const jobs = useAllJobs();
  const requested = new URLSearchParams(location.search).get('account');
  const live = answer?.account ?? null;
  const selected = requested ?? live?.fingerprint ?? null;
  const emailOf = (fingerprint: string) => (live?.fingerprint === fingerprint ? live.email : null);
  const selectedJob = jobs.find((job) => job.account === selected) ?? null;
  return (
    <main className="review">
      <header className="row">
        <h1>Photo Cleaner · review</h1>
        <button onClick={() => void send({ kind: 'app-open-photos' })}>Google Photos</button>
      </header>
      {selected === null ? (
        <p className="muted">No account yet: open Google Photos and start a scan from the panel.</p>
      ) : (
        <>
          <h2>{accountLabel(selected, emailOf(selected))}</h2>
          <JobCard account={selected} job={selectedJob} />
        </>
      )}
      <h2>Saved on this computer</h2>
      {jobs.length === 0 ? (
        <p className="muted">Nothing saved yet.</p>
      ) : (
        <table>
          <thead><tr><th>Account</th><th>Scan</th><th>Progress</th><th>Times</th></tr></thead>
          <tbody>
            {jobs.map((job) => {
              const view = jobView(job);
              return (
                <tr key={job.id}>
                  <td className="mono">{accountLabel(job.account, emailOf(job.account))}</td>
                  <td>{view.title}</td>
                  <td className="mono">{view.progressText}</td>
                  <td className="mono muted">{view.timesText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <section className="placeholder">
        <h2>Duplicates</h2>
        <p className="muted">Coming in M4.</p>
        <h2>Search</h2>
        <p className="muted">Coming in M5.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Review />);
