// The review tab: the workbench. Scan shows the selected account's library scan, its full protection
// report and the analysis; Duplicates reviews the duplicate groups; Search finds photos by
// description or example and sweeps them to the trash queue.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { accountLabel, documentTitle, scanTabTitle, scanView } from '../shared/jobView';
import type { AnalysisJob, ScanJob } from '../shared/job';
import { send, useAccount, useAllJobs, useAnalysisJob, useProtectionChoices, useReport, useScanJob, useSpinningTabIcon, useStartOverWhenErased } from '../ui/hooks';
import { EraseCard, ProtectionCard, ScanCard, StorageProblem } from '../ui/JobCard';
import { DuplicatesReview } from '../duplicates/reviewModel';
import { reviewDeps } from '../duplicates/session';
import { SearchModel } from '../search/searchModel';
import { searchDeps } from '../search/session';
import { Duplicates, useTrashQueue } from './Duplicates';
import { Search } from './Search';

type Tab = 'scan' | 'duplicates' | 'search';
/** The steps, numbered as on the desktop (which has Calibration as its step 2); Search is not a step. */
const TABS: { id: Tab; label: string }[] = [{ id: 'scan', label: '1 · Scan' }, { id: 'duplicates', label: '2 · Duplicates' }, { id: 'search', label: 'Search' }];
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

/** After an erase: the page starts again from nothing and says what happened. */
function afterErase(): void {
  try {
    localStorage.clear();
  } catch {
    // Nothing more to erase here when storage is unavailable.
  }
  location.replace(`${location.pathname}?erased=1`);
}

const ERASED = new URLSearchParams(location.search).has('erased');

function Review() {
  useStartOverWhenErased(afterErase);
  const { answer } = useAccount();
  const jobs = useAllJobs();
  const requested = ERASED ? null : new URLSearchParams(location.search).get('account');
  const live = answer?.account ?? null;
  const selected = requested ?? live?.fingerprint ?? null;
  const emailOf = (fingerprint: string) => (live?.fingerprint === fingerprint ? live.email : null);
  const job = useScanJob(selected);
  const choices = useProtectionChoices(selected);
  const report = useReport(selected, job, choices);
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
  // The Scan tab shows its status, as on the desktop: "1 · Scan (done)"; the browser tab its progress.
  const scan = selected !== null && job !== undefined && analysis !== undefined ? scanView(job, analysis, Date.now()) : null;
  const scanTitle = scan ? scanTabTitle(scan) : null;
  const pageTitle = scan ? documentTitle(scan) : 'Photo Cleaner';
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);
  useSpinningTabIcon(scan?.tabStatus === 'scanning');
  // The duplicate groups are built once the jobs and the protection choices are known, and again
  // when a library scan or the analysis finishes (their finish time changes; pausing and progress
  // don't) or the protection choices change.
  const refreshKey = job === undefined || analysis === undefined || choices === undefined ? null
    : `${job?.finishedAtMs ?? '-'}:${analysis?.finishedAtMs ?? '-'}:${JSON.stringify(choices)}`;
  // The workbenches, once per account; the trash queue runs for both whichever tab is open.
  const duplicates = useMemo(() => (selected === null ? null : new DuplicatesReview(reviewDeps(selected))), [selected]);
  const search = useMemo(() => (selected === null ? null : new SearchModel(searchDeps(selected))), [selected]);
  useTrashQueue(selected, duplicates);
  useEffect(() => {
    if (refreshKey !== null) search?.libraryChanged();
  }, [search, refreshKey]);
  const searchLike = (mediaKeys: string[]) => {
    open('search');
    search?.searchLike(mediaKeys);
  };
  return (
    <main className="review">
      <header className="collapsing page-header">
        <div className="row">
          <h1>Photo Cleaner</h1>
          <button onClick={() => void send({ kind: 'app-open-photos' })}>Open Google Photos</button>
        </div>
        <StorageProblem />
        {ERASED && (
          <section className="card tone-good">
            <strong>Photo Cleaner's data has been erased from this computer.</strong>
            <span>Your photos in Google Photos were not touched. Scan your library again to start over.</span>
          </section>
        )}
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
          {opened.has('duplicates') && duplicates && (
            <Duplicates review={duplicates} active={tab === 'duplicates'} refreshKey={refreshKey} openScan={() => open('scan')} onSearchLike={searchLike} />
          )}
          {opened.has('search') && search && <Search model={search} active={tab === 'search'} openScan={() => open('scan')} />}
          {opened.has('scan') && (
            <div className="scan-tab" hidden={tab !== 'scan'}>
              {job !== undefined && analysis !== undefined && <ScanCard account={selected} scan={job} analysis={analysis} report={report} />}
              {choices !== undefined && <ProtectionCard account={selected} choices={choices} />}
              <EraseCard />
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
