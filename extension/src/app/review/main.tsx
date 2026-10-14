// The review tab: the workbench. Shows the selected account's scan and its full protection report;
// Duplicates (M4) and Search (M5) come here.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReportView } from '../scan/report';
import { accountLabel, jobView } from '../shared/jobView';
import type { ScanJob } from '../shared/job';
import { send, useAccount, useAllJobs, useAnalysisJob, useReport, useScanJob } from '../ui/hooks';
import { AnalysisCard, JobCard, StorageProblem } from '../ui/JobCard';
import { SimilarPhotos } from './SimilarPhotos';

function Report({ report }: { report: ReportView }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(report.copyText).then(() => setCopied(true));
  return (
    <section className={`card tone-${report.tone}`}>
      <div className="row">
        <strong>{report.title}</strong>
        <button onClick={copy} title="Counts only, no album names">{copied ? 'Copied' : 'Copy report'}</button>
      </div>
      {report.coverageLines.map((line) => <div key={line} className="mono">{line}</div>)}
      {report.issueLines.map((line) => <div key={line} className="warn">{line}</div>)}
      <div className="tables">
        {report.tables.map((t) => (
          <table key={t.title} className="counts">
            <thead><tr><th colSpan={2}>{t.title}</th></tr></thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.label}><td className={r.indent ? 'indent' : ''}>{r.label}</td><td className="mono num">{r.value}</td></tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}

function Review() {
  const { answer } = useAccount();
  const jobs = useAllJobs();
  const requested = new URLSearchParams(location.search).get('account');
  const live = answer?.account ?? null;
  const selected = requested ?? live?.fingerprint ?? null;
  const emailOf = (fingerprint: string) => (live?.fingerprint === fingerprint ? live.email : null);
  const job = useScanJob(selected);
  const report = useReport(selected, job);
  const analysis = useAnalysisJob(selected);
  const otherScans = jobs.filter((j): j is ScanJob => j.kind === 'library-scan' && j.account !== selected);
  return (
    <main className="review">
      <header className="row">
        <h1>Photo Cleaner · review</h1>
        <button onClick={() => void send({ kind: 'app-open-photos' })}>Google Photos</button>
      </header>
      <StorageProblem />
      {selected === null ? (
        <p className="muted">No account yet: open Google Photos and start a scan from the panel.</p>
      ) : (
        <>
          <h2>{accountLabel(selected, emailOf(selected))}</h2>
          {job !== undefined && <JobCard account={selected} job={job} />}
          {report === undefined && job && <p className="muted">Working out the report…</p>}
          {report && <Report report={report} />}
          {analysis !== undefined && <AnalysisCard account={selected} job={analysis} scanFinished={job?.status === 'finished'} />}
          {analysis && <SimilarPhotos account={selected} analysedCount={analysis.progress.analysed} />}
        </>
      )}
      {otherScans.length > 0 && (
        <>
          <h2>Other accounts on this computer</h2>
          <table>
            <thead><tr><th>Account</th><th>Scan</th></tr></thead>
            <tbody>
              {otherScans.map((j) => (
                <tr key={j.id}>
                  <td className="mono"><a href={`?account=${encodeURIComponent(j.account)}`}>{accountLabel(j.account, emailOf(j.account))}</a></td>
                  <td>{jobView(j).title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
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
