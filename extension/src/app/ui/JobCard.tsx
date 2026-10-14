// The scan's and the analysis's state with their buttons; the same cards in every surface.

import { pause, resume, setAnalysisFullSpeed, startAnalysis, startScan } from '../shared/actions';
import type { AnalysisJob, ScanJob } from '../shared/job';
import { analysisView, jobView } from '../shared/jobView';
import type { ReportView } from '../scan/report';
import { send, store, useStorageProblem } from './hooks';

export function JobCard({ account, job }: { account: string; job: ScanJob | null }) {
  const view = jobView(job);
  const act = () => {
    const now = Date.now();
    switch (view.action) {
      case 'start':
      case 'restart':
        return void startScan(store, send, account, now);
      case 'pause':
        return void pause(store, 'library-scan', account, now);
      case 'resume':
        return void resume(store, send, 'library-scan', account, now);
    }
  };
  return (
    <section className="card">
      <div className="row">
        <strong>1 · {view.title}</strong>
        <button className={view.action === 'pause' ? '' : 'primary'} onClick={act}>{view.actionLabel}</button>
      </div>
      {view.lines.map((line) => <div key={line} className="mono">{line}</div>)}
      {view.notice && <div className="warn">{view.notice}</div>}
      {view.timesText && <div className="muted mono">{view.timesText}</div>}
    </section>
  );
}

export function AnalysisCard({ account, job, scanFinished }: { account: string; job: AnalysisJob | null; scanFinished: boolean }) {
  const view = analysisView(job, scanFinished);
  const act = () => {
    const now = Date.now();
    switch (view.action) {
      case 'start':
      case 'restart':
        return void startAnalysis(store, send, account, now);
      case 'pause':
        return void pause(store, 'analysis', account, now);
      case 'resume':
        return void resume(store, send, 'analysis', account, now);
    }
  };
  return (
    <section className="card">
      <div className="row">
        <strong>2 · {view.title}</strong>
        {view.actionLabel && <button className={view.action === 'pause' ? '' : 'primary'} onClick={act}>{view.actionLabel}</button>}
      </div>
      {view.percent !== null && <div className="bar"><div style={{ width: `${view.percent}%` }} /></div>}
      {view.lines.map((line) => <div key={line} className="mono">{line}</div>)}
      {view.speedCheck && <div>{view.speedCheck}</div>}
      {view.waiting && <div className="muted">{view.waiting}</div>}
      {view.notice && <div className="warn">{view.notice}</div>}
      {job && (
        <label className="muted small">
          <input type="checkbox" checked={view.fullSpeed} onChange={(e) => void setAnalysisFullSpeed(store, account, e.target.checked, Date.now())} />{' '}
          Full speed (don't slow down while I use the computer or on battery)
        </label>
      )}
    </section>
  );
}

/** Shown above everything when the saved data can't be opened; disappears once it can. */
export function StorageProblem() {
  const problem = useStorageProblem();
  return problem ? <section className="card tone-warn"><strong>{problem}</strong></section> : null;
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
