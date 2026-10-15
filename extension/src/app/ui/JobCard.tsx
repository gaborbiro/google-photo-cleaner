// The account's Scan with its one button and, folded away at the bottom, what the scan found out
// about protection; the same card in every surface.

import { useState } from 'react';
import type { AppRequest } from '../shared/messages';
import { scanButton, setAnalysisFullSpeed } from '../shared/actions';
import type { AnalysisJob, ScanJob } from '../shared/job';
import { scanView } from '../shared/jobView';
import type { ReportView } from '../scan/report';
import type { ProtectionChoices } from '../shared/preferences';
import { logFailure, send, setProtectionChoices, store, useStorageProblem } from './hooks';

/** One Scan in two stages: reading the photo list, then analysing the new photos. */
export function ScanCard({ account, scan, analysis, report }: { account: string; scan: ScanJob | null; analysis: AnalysisJob | null; report: ReportView | null | undefined }) {
  const view = scanView(scan, analysis, Date.now());
  const act = () => void scanButton(view, store, send, account, Date.now()).catch(logFailure(view.actionLabel));
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
          <input type="checkbox" checked={view.fullSpeed} onChange={(e) => void setAnalysisFullSpeed(store, account, e.target.checked, Date.now()).catch(logFailure('changing full speed'))} />{' '}
          Full speed (don't slow down while I use the computer or on battery)
        </label>
      )}
      {/* Incomplete protection data changes what can be done: said outside the folded part (an old scan says so above). */}
      {view.protectionKnown && report?.warningText && <div className="warn">{report.warningText}</div>}
      {view.protectionKnown && report && <ProtectionDetails report={report} />}
    </section>
  );
}

/** Folded away by default: when the scan ran and how many photos are protected, eligible or unknown. */
function ProtectionDetails({ report }: { report: ReportView }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(report.copyText).then(() => setCopied(true), logFailure('copying the report'));
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

/**
 * Which kinds of photo are never trashed, all ticked unless the user unticks one. Visible rather than
 * tucked away: it decides what Duplicates and Search may offer for the trash.
 */
export function ProtectionCard({ account, choices }: { account: string; choices: ProtectionChoices }) {
  const box = (key: keyof ProtectionChoices, label: string) => (
    <label>
      <input type="checkbox" checked={choices[key]} onChange={(e) => void setProtectionChoices(account, { ...choices, [key]: e.target.checked }).catch(logFailure('saving the protection choices'))} /> {label}
    </label>
  );
  return (
    <section className="card protection-card">
      <strong>Never trash photos that are</strong>
      <div className="row protection-boxes">
        {box('favourites', 'favourites')}
        {box('albums', 'in an album')}
        {box('archived', 'archived')}
      </div>
      <p className="muted small">
        Photos of unknown status, such as ones saved from someone else's share, are always kept. Trashing a photo also removes it from every album it's in.
      </p>
    </section>
  );
}

/**
 * Erases everything Photo Cleaner saved on this computer, in two clicks: the explanation (and that
 * photos in Google Photos are not touched) appears after the first. When it is done, every open
 * Photo Cleaner page reloads empty.
 */
export function EraseCard() {
  const [step, setStep] = useState<'button' | 'confirm' | 'erasing'>('button');
  const [problem, setProblem] = useState<string | null>(null);
  const erase = async () => {
    setStep('erasing');
    setProblem(null);
    const answer = (await send({ kind: 'app-erase-all' } satisfies AppRequest)) as { ok?: true; error?: string } | undefined;
    if (!answer?.ok) {
      setProblem(answer?.error ?? 'The data could not be erased.');
      setStep('confirm');
    }
  };
  return (
    <section className="card erase-card">
      {step === 'button' ? (
        <div><button onClick={() => setStep('confirm')}>Erase Photo Cleaner's data from this computer</button></div>
      ) : (
        <>
          <p>
            Removes the library scan, the AI fingerprints and your review progress (which groups you've already gone through), as uninstalling would.{' '}
            <strong>Your photos in Google Photos are not touched</strong>: photos you already trashed stay in Google Photos' trash (kept there for 60 days), and Photo Cleaner can no longer undo them.
          </p>
          {problem && <div className="warn">{problem}</div>}
          <div className="row erase-buttons">
            <button className="danger" disabled={step === 'erasing'} onClick={() => void erase()}>{step === 'erasing' ? 'Erasing…' : 'Confirm to erase'}</button>
            <button disabled={step === 'erasing'} onClick={() => setStep('button')}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}

/** Shown above everything when the saved data can't be opened; disappears once it can. */
export function StorageProblem() {
  const problem = useStorageProblem();
  return problem ? <section className="card tone-warn"><strong>{problem}</strong></section> : null;
}
