// The review tab: the workbench. Scan shows the selected account's library scan, its full protection
// report and the analysis; Duplicates reviews the duplicate groups; Search finds photos by
// description or example and sweeps them to the trash queue.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { documentTitle, reviewAccount, reviewPageView, scanView } from '../shared/jobView';
import { REVIEW_TABS, requestedReviewTab, type ReviewTab } from '../shared/messages';
import { extensionVersion, openPhotos, useAccount, useAllJobs, useAnalysisJob, useProtectionChoices, useReport, useScanJob, useSpinningTabIcon, useStartOverWhenErased } from '../ui/hooks';
import { DiagnosticsCard, EraseCard, ProtectionCard, ScanCard, StorageProblem } from '../ui/JobCard';
import { DuplicatesReview } from '../duplicates/reviewModel';
import { reviewDeps } from '../duplicates/session';
import { SearchModel } from '../search/searchModel';
import { searchDeps } from '../search/session';
import { Duplicates, useTrashQueue } from './Duplicates';
import { Search } from './Search';
import { usePinnedHeight } from '../ui/Workbench';
import { UsageCard, useUsageSurface } from '../ui/UsageCard';

type Tab = ReviewTab;
const TABS = REVIEW_TABS;
const TAB_KEY = 'photo-cleaner.review-tab';

/** The tab last open in this browser; Scan the first time (or when storage is unavailable). */
function rememberedTab(): Tab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.find((t) => t === saved) ?? 'scan';
  } catch (error) {
    console.warn('Photo Cleaner: could not read which tab was open last', error);
    return 'scan';
  }
}

function remember(tab: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch (error) {
    // Only a convenience: the tab simply isn't remembered.
    console.warn('Photo Cleaner: could not remember the open tab', error);
  }
}

/** After an erase: the page starts again from nothing and says what happened. */
function afterErase(): void {
  location.replace(`${location.pathname}?erased=1`);
}

const ERASED = new URLSearchParams(location.search).has('erased');

function Review() {
  useStartOverWhenErased(afterErase);
  const { answer } = useAccount();
  const jobs = useAllJobs();
  const signedIn = answer?.account ?? null;
  const selected = reviewAccount(ERASED ? null : new URLSearchParams(location.search).get('account'), signedIn);
  const job = useScanJob(selected);
  const choices = useProtectionChoices(selected);
  const report = useReport(selected, job, choices);
  const analysis = useAnalysisJob(selected);
  const page = reviewPageView({ selected, signedIn, jobs, scan: job, analysis, choices, nowMs: Date.now(), version: extensionVersion() });
  const [tab, setTab] = useState<Tab>(() => requestedReviewTab(location.hash) ?? rememberedTab());
  useUsageSurface(tab, 'review');
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
  // The popup and the panel ask for a tab in the address ("#duplicates"), as this page opens or while it
  // is open. The request is then taken out of the address, so asking for the same tab again works.
  useEffect(() => {
    const follow = () => {
      const asked = requestedReviewTab(location.hash);
      if (asked === null) return;
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      remember(asked);
      open(asked);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  });
  // Each tab comes back where it was left.
  // (A block, not an expression: newer Chrome returns a Promise from scrollTo, which React would take for a cleanup.)
  useLayoutEffect(() => {
    window.scrollTo({ top: scrollOf.current.get(tab) ?? 0 });
  }, [tab]);
  // The Scan tab shows its status, as on the desktop: "1 · Scan (done)"; the browser tab its progress.
  const scan = selected !== null && job !== undefined && analysis !== undefined ? scanView(job, analysis, Date.now(), 'tab') : null;
  const pageTitle = scan ? documentTitle(scan) : 'Photo Cleaner';
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);
  useSpinningTabIcon(scan?.tabStatus === 'scanning');
  const { refreshKey } = page;
  // The workbenches, once per account; the trash queue runs for both whichever tab is open.
  const duplicates = useMemo(() => (selected === null ? null : new DuplicatesReview(reviewDeps(selected))), [selected]);
  const search = useMemo(() => (selected === null ? null : new SearchModel(searchDeps(selected))), [selected]);
  useTrashQueue(selected, duplicates);
  useEffect(() => {
    if (refreshKey !== null) search?.libraryChanged();
  }, [search, refreshKey]);
  // Both record decisions in the same trash queue: what one decides, the other shows.
  useEffect(() => {
    if (duplicates === null || search === null) return;
    const fromSearch = search.onDecisionsChanged(() => duplicates.decisionsChangedElsewhere());
    const fromDuplicates = duplicates.onDecisionsChanged(() => search.libraryChanged());
    return () => {
      fromSearch();
      fromDuplicates();
    };
  }, [duplicates, search]);
  // The pinned action bars sit right under the tabs, however tall they wrap.
  const tabs = useRef<HTMLElement>(null);
  usePinnedHeight(tabs, '--tabs-h');
  const searchLike = (mediaKeys: string[]) => {
    open('search');
    search?.searchLike(mediaKeys);
  };
  return (
    <main className="review">
      <header className="collapsing page-header">
        <div className="surface-header">
          <div>
            <div className="title-line">
              <h1>Photo Cleaner</h1>
              <span className="version mono muted" title="Photo Cleaner's version">{page.versionLabel}</span>
            </div>
            {page.accountName && <p className="account mono" title="The Google account whose library this is">{page.accountName}</p>}
          </div>
          <button onClick={() => void openPhotos()}>Open Google Photos <span aria-hidden="true">↗</span></button>
        </div>
        <StorageProblem />
        {ERASED && (
          <section className="card tone-good">
            <strong>Photo Cleaner's data has been erased from this computer.</strong>
            <span>Your photos in Google Photos were not touched. Scan your library again to start over.</span>
          </section>
        )}
      </header>
      <nav className="tabs" ref={tabs}>
        {TABS.map((t) => (
          <button key={t} tabIndex={-1} className={t === tab ? 'tab selected' : 'tab'} aria-current={t === tab ? 'page' : undefined} onClick={() => open(t)}>{page.tabLabels[t]}</button>
        ))}
      </nav>
      {selected === null ? (
        <div className="scan-tab">
          <p className="muted">No account yet: open Google Photos and start a scan from the panel.</p>
          {/* Diagnostics and erasing cover every account, so they are here even when none is signed in. */}
          <DiagnosticsCard scan={null} analysis={null} report={null} />
          <EraseCard />
          <UsageCard />
        </div>
      ) : (
        <>
          {opened.has('duplicates') && duplicates && (
            <Duplicates review={duplicates} active={tab === 'duplicates'} refreshKey={refreshKey} openScan={() => open('scan')} onSearchLike={searchLike} />
          )}
          {opened.has('search') && search && <Search model={search} active={tab === 'search'} openScan={() => open('scan')} />}
          {opened.has('scan') && (
            <div className="scan-tab" hidden={tab !== 'scan'}>
              <UsageCard />
              {job !== undefined && analysis !== undefined && <ScanCard account={selected} scan={job} analysis={analysis} report={report} surface="tab" />}
              {choices !== undefined && <ProtectionCard account={selected} choices={choices} />}
              {job !== undefined && analysis !== undefined && <DiagnosticsCard scan={job} analysis={analysis} report={report ?? null} />}
              <EraseCard />
            </div>
          )}
        </>
      )}
      {tab === 'scan' && page.otherAccounts.length > 0 && (
        <section className="card other-accounts">
          <h2>Other accounts on this computer</h2>
          <table>
            <thead><tr><th>Account</th><th>Scan</th></tr></thead>
            <tbody>
              {page.otherAccounts.map((row) => (
                <tr key={row.account}>
                  <td className="mono"><a href={row.href}>{row.label}</a></td>
                  <td>{row.scanTitle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Review />);
