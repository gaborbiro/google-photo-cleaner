// The review tab: the workbench. Scan shows the selected account's library scan, its full protection
// report and the analysis; Duplicates reviews the duplicate groups; Search finds photos by
// description or example and sweeps them to the trash queue. Settings, apart at the far end, holds
// what applies to all of them: the protection choices, usage statistics, diagnostics, the version
// and erasing.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { documentTitle, reviewAccount, reviewPageView, scanView } from '../shared/jobView';
import { REVIEW_TABS, WORK_TABS, requestedReviewTab, type ReviewTab } from '../shared/messages';
import { LOCAL_BUILD } from '../shared/version';
import { extensionVersion, openPhotos, useAccount, useAllJobs, useAnalysisJob, useProtectionChoices, useReport, useScanJob, useSpinningTabIcon, useStartOverWhenErased } from '../ui/hooks';
import { ProtectionLine, ScanCard, StorageProblem } from '../ui/JobCard';
import { DuplicatesReview } from '../duplicates/reviewModel';
import { reviewDeps } from '../duplicates/session';
import { SearchModel } from '../search/searchModel';
import { searchDeps } from '../search/session';
import { Duplicates, useTrashQueue } from './Duplicates';
import { Search } from './Search';
import { Settings } from './Settings';
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

/** The Settings tab's gear (Tabler's "settings" icon, MIT). */
function GearIcon() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

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
  const page = reviewPageView({ selected, signedIn, jobs, scan: job, analysis, choices, nowMs: Date.now(), version: extensionVersion(), localBuild: LOCAL_BUILD });
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
  const openSettings = () => open('settings');
  const searchLike = (mediaKeys: string[]) => {
    open('search');
    search?.searchLike(mediaKeys);
  };
  return (
    <main className="review">
      <header className="collapsing page-header">
        <div className="surface-header">
          <div>
            <h1>Photo Cleaner</h1>
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
        {WORK_TABS.map((t) => (
          <button key={t} tabIndex={-1} className={t === tab ? 'tab selected' : 'tab'} aria-current={t === tab ? 'page' : undefined} onClick={() => open(t)}>{page.tabLabels[t]}</button>
        ))}
        <button tabIndex={-1} className={tab === 'settings' ? 'tab settings-tab-button selected' : 'tab settings-tab-button'} aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => open('settings')}>
          <GearIcon />{page.tabLabels.settings}
        </button>
      </nav>
      {opened.has('settings') && (
        <Settings
          account={selected} choices={choices} scan={selected === null ? null : job} analysis={selected === null ? null : analysis} report={report}
          feedback={page.feedback} versionLabel={page.versionLabel} active={tab === 'settings'}
        />
      )}
      {selected === null ? (
        <div className="scan-tab" hidden={tab === 'settings'}>
          <p className="muted">No account yet: open Google Photos and start a scan from the panel.</p>
          <UsageCard place="question" />
        </div>
      ) : (
        <>
          {opened.has('duplicates') && duplicates && (
            <Duplicates review={duplicates} active={tab === 'duplicates'} refreshKey={refreshKey} protectionText={page.protectionText} openScan={() => open('scan')} openSettings={openSettings} onSearchLike={searchLike} />
          )}
          {opened.has('search') && search && <Search model={search} active={tab === 'search'} protectionText={page.protectionText} openScan={() => open('scan')} openSettings={openSettings} />}
          {opened.has('scan') && (
            <div className="scan-tab" hidden={tab !== 'scan'}>
              <UsageCard place="question" />
              {job !== undefined && analysis !== undefined && <ScanCard account={selected} scan={job} analysis={analysis} report={report} surface="tab" />}
              <ProtectionLine text={page.protectionText} openSettings={openSettings} />
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
