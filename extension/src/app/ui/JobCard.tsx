// The account's Scan: two visible steps, one action, and each step's own results and settings.

import { useState } from 'react';
import type { AppRequest } from '../shared/messages';
import { scanButton, setAnalysisFullSpeed } from '../shared/actions';
import { ALIVE_EVERY_MS, type AnalysisJob, type ScanJob } from '../shared/job';
import { diagnosticsText } from '../shared/diagnostics';
import { copyReportText, offersDiagnostics, scanView, versionLine, type ScanSurface } from '../shared/jobView';
import type { ReportView } from '../scan/report';
import type { ProtectionChoices } from '../shared/preferences';
import { extensionVersion, logFailure, send, setProtectionChoices, store, useClock, useProblems, useStorageProblem } from './hooks';

/** One Scan in two stages: reading the photo list, then analysing the new photos. */
export function ScanCard({ account, scan, analysis, report, surface }: { account: string; scan: ScanJob | null; analysis: AnalysisJob | null; report: ReportView | null | undefined; surface: ScanSurface }) {
  const view = scanView(scan, analysis, useClock(ALIVE_EVERY_MS), surface);
  const act = () => void scanButton(view, store, send, account, Date.now()).catch(logFailure(view.actionLabel));
  const version = extensionVersion();
  return (
    <section className="card scan-card" aria-live="polite">
      <div className="scan-title">
        <h2>{view.tone && <span className={`dot tone-${view.tone}`} aria-hidden="true" />}{view.title}</h2>
        <button className={view.action === 'pause' ? '' : 'primary'} onClick={act}>{view.actionLabel}</button>
      </div>
      <ol className="scan-steps" aria-label="Scan steps">
        {view.steps.map((step) => (
          <li key={step.number} className={`scan-step is-${step.state}`} aria-current={step.state === 'running' ? 'step' : undefined}>
            <div className="step-heading">
              <span className="step-number" aria-hidden="true">{step.number}</span>
              <h3>{step.title}</h3>
              <span className="step-status">{step.statusText}</span>
            </div>
            <div className="step-body">
              <p className="muted">{step.description}</p>
              {step.phase && <p className="step-phase">{step.phase}</p>}
              {step.indeterminate && <div className="bar indeterminate"><div /></div>}
              {step.percent !== null && <div className="bar"><div style={{ width: `${step.percent}%` }} /></div>}
              {step.lines.length > 0 && <div className="lines">{step.lines.map((line) => <div key={line} className="mono">{line}</div>)}</div>}
              {step.waiting && <p className="muted">{step.waiting}</p>}
              {step.notice && <p className="warn">{step.notice}</p>}
              {step.problemLines.map((line) => <p key={line} className="mono muted support-line">{line}</p>)}
              {offersDiagnostics(step, report) && <Diagnostics scan={scan} analysis={analysis} report={report ?? null} />}
              {step.timesText && <p className="muted mono">{step.timesText}</p>}
              {step.fullSpeed !== null && (
                <label className="setting">
                  <input type="checkbox" checked={step.fullSpeed} onChange={(e) => void setAnalysisFullSpeed(store, account, e.target.checked, Date.now()).catch(logFailure('changing full speed'))} />
                  Full speed <span className="muted">(don't slow down while I use the computer or on battery)</span>
                </label>
              )}
              {/* Protection warnings stay outside the folded report. */}
              {step.protectionKnown && report && <p>{report.summary}</p>}
              {step.protectionKnown && report?.warningText && <p className="warn">{report.warningText}</p>}
              {step.protectionKnown && report && <ProtectionDetails report={report} detailText={step.detailText} versionText={versionLine(version)} supportLines={step.supportLines} copyText={copyReportText(report, step, version)} />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Folded away by default: when the scan ran and how many photos are protected, eligible or unknown. */
function ProtectionDetails({ report, detailText, versionText, supportLines, copyText }: { report: ReportView; detailText: string | null; versionText: string; supportLines: string[]; copyText: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(copyText).then(() => setCopied(true), logFailure('copying the report'));
  return (
    <details className="protection">
      <summary>Protection details</summary>
      <div className="protection-report">
        <div className="report-lines">
          <div className="report-times">
            <p className="mono">{report.timesLine}</p>
            {detailText && <p className="mono report-detail">{detailText}</p>}
          </div>
          {report.issueLines.map((line) => <p key={line} className="warn">{line}</p>)}
          {report.noteLines.map((line) => <p key={line} className="muted">{line}</p>)}
          <p className="mono muted version-line">{versionText}</p>
          {supportLines.map((line) => <p key={line} className="mono muted support-line">{line}</p>)}
        </div>
        <div className="tables">
          {report.tables.map((t) => (
            <table key={t.title} className="counts">
              <caption>{t.title}</caption>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.label} className={r.indent ? 'count-detail' : 'count-total'}><th scope="row">{r.label}</th><td className="num">{r.value}</td></tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <div className="report-actions"><button className="small" onClick={copy} title="Counts only, no album names">{copied ? 'Copied' : 'Copy report'}</button></div>
      </div>
    </details>
  );
}

/**
 * What went wrong lately, for a problem report: one button copies it, and what it copies can be
 * looked at first. Never photos, album names or account details (see diagnostics.ts).
 */
function Diagnostics({ scan, analysis, report }: { scan: ScanJob | null; analysis: AnalysisJob | null; report: ReportView | null }) {
  const log = useProblems();
  const [copied, setCopied] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const text = log === undefined ? null : diagnosticsText({ version: extensionVersion(), nowMs: Date.now(), scan, analysis, problems: log.problems, runs: log.runs, report });
  const copy = () => {
    if (text !== null) void navigator.clipboard.writeText(text).then(() => setCopied(true), logFailure('copying the diagnostics'));
  };
  return (
    <div className="diagnostics">
      <button className="small" disabled={text === null} onClick={copy} title="For a problem report: no photos, album names or account details">{copied ? 'Copied' : 'Copy diagnostics'}</button>
      {text !== null && (
        <details onToggle={(e) => setUnfolded(e.currentTarget.open)}>
          <summary>What it copies</summary>
          {unfolded && <textarea className="mono" readOnly rows={12} aria-label="Diagnostics" value={text} />}
        </details>
      )}
    </div>
  );
}

/** Always in the review tab's Scan tab: Copy diagnostics, also for a problem the Scan card doesn't show. */
export function DiagnosticsCard({ scan, analysis, report }: { scan: ScanJob | null; analysis: AnalysisJob | null; report: ReportView | null }) {
  return (
    <section className="card utility diagnostics-card">
      <p className="muted">Something not working? Copy what went wrong lately into your problem report. It holds no photos, album names or account details.</p>
      <Diagnostics scan={scan} analysis={analysis} report={report} />
    </section>
  );
}

/**
 * Which kinds of photo are never trashed, all ticked unless the user unticks one. Visible rather than
 * tucked away: it decides what Duplicates and Search may offer for the trash.
 */
export function ProtectionCard({ account, choices }: { account: string; choices: ProtectionChoices }) {
  const box = (key: keyof ProtectionChoices, label: string) => (
    <label>
      <input type="checkbox" checked={choices[key]} onChange={(e) => void setProtectionChoices(account, { ...choices, [key]: e.target.checked }).catch(logFailure('saving the protection choices'))} />{label}
    </label>
  );
  return (
    <section className="card protection-card">
      <h2>Never trash photos that are</h2>
      <div className="row protection-boxes">
        {box('favourites', 'favourites')}
        {box('albums', 'in an album')}
        {box('archived', 'archived')}
      </div>
      <p className="muted">
        Photos of unknown status, whose details the scan couldn't read, are always kept. Trashing a photo also removes it from every album it's in.
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
    <section className="card utility erase-card">
      {step === 'button' ? (
        <div><button onClick={() => setStep('confirm')}>Erase Photo Cleaner's data from this computer</button></div>
      ) : (
        <>
          <p className="confirm-text">
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
  return problem ? <section className="banner tone-caution" role="alert"><strong>{problem}</strong></section> : null;
}
