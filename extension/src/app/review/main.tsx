// The review tab: the workbench. Scan shows the selected account's library scan, its full protection
// report and the analysis; Duplicates reviews the duplicate groups (Search comes in M5).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { accountLabel, documentTitle, scanTabTitle, scanView } from '../shared/jobView';
import type { AnalysisJob, ScanJob } from '../shared/job';
import { send, useAccount, useAllJobs, useAnalysisJob, useReport, useScanJob, useSpinningTabIcon } from '../ui/hooks';
import { ScanCard, StorageProblem } from '../ui/JobCard';
import { Duplicates } from './Duplicates';

type Tab = 'scan' | 'duplicates';
/** The steps, numbered as on the desktop (which has Calibration as its step 2). */
const TABS: { id: Tab; label: string }[] = [{ id: 'scan', label: '1 · Scan' }, { id: 'duplicates', label: '2 · Duplicates' }];
const TAB_KEY = 'photo-cleaner.review-tab';

/** The tab last open in this browser; Scan the first time (or when storage is unavailable). */
function rememberedTab(): Tab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? (saved as Tab) : 'scan';
  } catch {
    return 'scan';
  }
}

function remember(tab: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Only a convenience: the tab simply isn't remembered.
  }
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
  const analysisOf = (account: string) => jobs.find((j): j is AnalysisJob => j.kind === 'analysis' && j.account === account) ?? null;
  const [tab, setTab] = useState<Tab>(rememberedTab);
  // A tab, once opened, stays alive while hidden: its groups, selections and place are kept.
  const [opened, setOpened] = useState<ReadonlySet<Tab>>(() => new Set([tab]));
  const scrollOf = useRef(new Map<Tab, number>());
  const open = (next: Tab) => {
    if (next === tab) return;
    scrollOf.current.set(tab, window.scrollY);
    setTab(next);
    setOpened((o) => new Set(o).add(next));
    remember(next);
  };
  // Each tab comes back where it was left.
  // (A block, not an expression: newer Chrome returns a Promise from scrollTo, which React would take for a cleanup.)
  useLayoutEffect(() => {
    window.scrollTo({ top: scrollOf.current.get(tab) ?? 0 });
  }, [tab]);
  // The duplicate groups are built once both jobs are known, and again only when a library scan
  // or the analysis finishes (their finish time changes; pausing and progress don't).
  // The Scan tab shows its status, as on the desktop: "1 · Scan (done)"; the browser tab its progress.
  const scan = selected !== null && job !== undefined && analysis !== undefined ? scanView(job, analysis, Date.now()) : null;
  const scanTitle = scan ? scanTabTitle(scan) : null;
  const pageTitle = scan ? documentTitle(scan) : 'Photo Cleaner';
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);
  useSpinningTabIcon(scan?.tabStatus === 'scanning');
  const refreshKey = job === undefined || analysis === undefined ? null : `${job?.finishedAtMs ?? '-'}:${analysis?.finishedAtMs ?? '-'}`;
  return (
    <main className="review">
      <header className="collapsing page-header">
        <div className="row">
          <h1>Photo Cleaner · review</h1>
          <button onClick={() => void send({ kind: 'app-open-photos' })}>Open Google Photos</button>
        </div>
        <StorageProblem />
        {selected !== null && <h2>Account: {accountLabel(selected, emailOf(selected))}</h2>}
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} tabIndex={-1} className={t.id === tab ? 'tab selected' : 'tab'} onClick={() => open(t.id)}>{(t.id === 'scan' && scanTitle) || t.label}</button>
        ))}
      </nav>
      {selected === null ? (
        <p className="muted">No account yet: open Google Photos and start a scan from the panel.</p>
      ) : (
        <>
          {opened.has('duplicates') && (
            <Duplicates account={selected} active={tab === 'duplicates'} refreshKey={refreshKey} openScan={() => open('scan')} />
          )}
          {opened.has('scan') && (
            <div className="scan-tab" hidden={tab !== 'scan'}>
              {job !== undefined && analysis !== undefined && <ScanCard account={selected} scan={job} analysis={analysis} report={report} />}
            </div>
          )}
        </>
      )}
      {tab === 'scan' && otherScans.length > 0 && (
        <>
          <h2>Other accounts on this computer</h2>
          <table>
            <thead><tr><th>Account</th><th>Scan</th></tr></thead>
            <tbody>
              {otherScans.map((j) => (
                <tr key={j.id}>
                  <td className="mono"><a href={`?account=${encodeURIComponent(j.account)}`}>{accountLabel(j.account, emailOf(j.account))}</a></td>
                  <td>{scanView(j, analysisOf(j.account), Date.now()).title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Review />);
