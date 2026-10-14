// The scan's state and its one button; the same card in every surface.

import { pauseScan, resumeScan, startScan } from '../shared/actions';
import type { Job } from '../shared/job';
import { jobView } from '../shared/jobView';
import type { ReportView } from '../scan/report';
import { send, store } from './hooks';

export function JobCard({ account, job }: { account: string; job: Job | null }) {
  const view = jobView(job);
  const act = () => {
    const now = Date.now();
    switch (view.action) {
      case 'start':
      case 'restart':
        return void startScan(store, send, account, now);
      case 'pause':
        return void pauseScan(store, account, now);
      case 'resume':
        return void resumeScan(store, send, account, now);
    }
  };
  return (
    <section className="card">
      <div className="row">
        <strong>{view.title}</strong>
        <button className={view.action === 'pause' ? '' : 'primary'} onClick={act}>{view.actionLabel}</button>
      </div>
      {view.lines.map((line) => <div key={line} className="mono">{line}</div>)}
      {view.notice && <div className="warn">{view.notice}</div>}
      {view.timesText && <div className="muted mono">{view.timesText}</div>}
    </section>
  );
}

/** The one-line outcome of the latest scan, coloured by whether it can be trusted. */
export function ReportSummary({ report }: { report: ReportView }) {
  return (
    <section className={`card tone-${report.tone}`}>
      <strong>{report.title}</strong>
      <div className="mono">{report.summary}</div>
    </section>
  );
}
