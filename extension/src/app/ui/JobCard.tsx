// The account's Scan with its one button and, folded away at the bottom, what the scan found out
// about protection; the same card in every surface.

import { useState } from 'react';
import { pause, resume, setAnalysisFullSpeed, startAnalysis, startScan } from '../shared/actions';
import type { AnalysisJob, ScanJob } from '../shared/job';
import { scanView } from '../shared/jobView';
import type { ReportView } from '../scan/report';
import { send, store, useStorageProblem } from './hooks';

/** One Scan in two stages: reading the photo list, then analysing the new photos. */
export function ScanCard({ account, scan, analysis, report }: { account: string; scan: ScanJob | null; analysis: AnalysisJob | null; report: ReportView | null | undefined }) {
  const view = scanView(scan, analysis, Date.now());
  const act = () => {
    const now = Date.now();
    switch (view.action) {
      case 'start':
      case 'restart':
        return void (view.target === 'library-scan' ? startScan(store, send, account, now) : startAnalysis(store, send, account, now));
      case 'pause':
        return void pause(store, view.target, account, now);
      case 'resume':
        return void resume(store, send, view.target, account, now);
    }
  };
  return (
    <section className="card">
      <div className="row">
        <strong>{view.title}</strong>
        <button className={view.action === 'pause' ? '' : 'primary'} onClick={act}>{view.actionLabel}</button>
      </div>
      {view.indeterminate && <div className="bar indeterminate"><div /></div>}
      {view.percent !== null && <div className="bar"><div style={{ width: `${view.percent}%` }} /></div>}
      {view.stage && <div>{view.stage}</div>}
      {view.lines.map((line) => <div key={line} className="mono">{line}</div>)}
      {view.speedCheck && <div>{view.speedCheck}</div>}
      {view.waiting && <div className="muted">{view.waiting}</div>}
      {view.notice && <div className="warn">{view.notice}</div>}
      {view.timesText && <div className="muted mono">{view.timesText}</div>}
      {view.fullSpeed !== null && (
        <label className="muted small">
          <input type="checkbox" checked={view.fullSpeed} onChange={(e) => void setAnalysisFullSpeed(store, account, e.target.checked, Date.now())} />{' '}
          Full speed (don't slow down while I use the computer or on battery)
        </label>
      )}
      {/* Incomplete protection data changes what can be done: said outside the folded part (an old scan says so above). */}
      {view.protectionKnown && report && report.tone === 'bad' && <div className="warn">{report.title}</div>}
      {view.protectionKnown && report && <ProtectionDetails report={report} />}
    </section>
  );
}

/** Folded away by default: when the scan ran and how many photos are protected, eligible or unknown. */
function ProtectionDetails({ report }: { report: ReportView }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(report.copyText).then(() => setCopied(true));
  return (
    <details className="protection">
      <summary className="muted">Protection details</summary>
      <div className="mono">{report.timesLine}</div>
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
      <div><button className="small" onClick={copy} title="Counts only, no album names">{copied ? 'Copied' : 'Copy report'}</button></div>
    </details>
  );
}

/** Shown above everything when the saved data can't be opened; disappears once it can. */
export function StorageProblem() {
  const problem = useStorageProblem();
  return problem ? <section className="card tone-warn"><strong>{problem}</strong></section> : null;
}
