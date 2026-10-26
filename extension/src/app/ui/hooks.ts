// State the surfaces watch. The saved jobs come straight from the browser database and are
// re-read whenever any surface or the background page saves a change.

import { useCallback, useEffect, useRef, useState } from 'react';
import { emitUsage } from '../shared/usageClient';
import { jobId, type AnalysisJob, type Job, type JobKind, type ScanJob } from '../shared/job';
import { accountAnswer, panelOptions, photosTabOf, type AccountAnswer, type AppRequest } from '../shared/messages';
import { openDatabase, storageProblemText } from '../shared/db';
import { IndexedDbJobStore, onErased, onJobsChanged } from '../shared/store';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { latestReport, reportKey, type ReportView } from '../scan/report';
import { IndexedDbPreferences, type ProtectionChoices } from '../shared/preferences';
import { launchButton, surfaceView, type LaunchButton, type SurfaceView } from '../shared/jobView';
import { IndexedDbReviewStore, type ReviewSummary } from '../duplicates/reviewStore';
import { IndexedDbProblemLog, keepProblemsHere, type ProblemEntry, type RunEntry } from '../shared/problemLog';

export const store = new IndexedDbJobStore();
const inventory = new IndexedDbInventoryStore();
const preferences = new IndexedDbPreferences();
const review = new IndexedDbReviewStore();
const problems = new IndexedDbProblemLog();
keepProblemsHere();

/**
 * The time now, again every [everyMs]: what is shown can change without any saved change (a
 * background page that stopped responding saves nothing).
 */
export function useClock(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** The problem log's problems and run summaries, newest first, kept up to date; undefined while loading. */
export function useProblems(): { problems: ProblemEntry[]; runs: RunEntry[] } | undefined {
  const [entries, setEntries] = useState<{ problems: ProblemEntry[]; runs: RunEntry[] } | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => void Promise.all([problems.recent(Date.now()), problems.recentRuns(Date.now())]).then(
      ([recent, runs]) => alive && setEntries({ problems: recent, runs }),
      (error: unknown) => console.warn('Photo Cleaner: could not read the problem log', error),
    );
    load();
    const stop = onJobsChanged(load); // also hears of new problems (see problemLog.ts)
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return entries;
}

/**
 * The protection report of [account]'s latest scan, by the shared rules: null before any scan,
 * undefined while working it out. Worked out again when a scan ends (not on every page).
 */
export function useReport(account: string | null, job: Job | null | undefined, choices: ProtectionChoices | undefined): ReportView | null | undefined {
  const [report, setReport] = useState<ReportView | null | undefined>(undefined);
  const key = reportKey(account, job, choices);
  useEffect(() => {
    if (key === null || account === null || choices === undefined) return;
    let alive = true;
    latestReport(inventory, account, choices, Date.now()).then(
      (view) => alive && setReport(view),
      (error: unknown) => {
        console.error('Photo Cleaner: could not work out the report', error);
        if (alive) setReport(null);
      },
    );
    return () => {
      alive = false;
    };
    // The key says when to work it out again; account and choices are part of it.
  }, [key]);
  return report;
}

/** The account's protection choices, kept up to date (also when another surface changes them); undefined while loading. */
export function useProtectionChoices(account: string | null): ProtectionChoices | undefined {
  const [choices, setChoices] = useState<ProtectionChoices | undefined>(undefined);
  useEffect(() => {
    if (account === null) return;
    let alive = true;
    const load = () => void preferences.protection(account).then((c) => alive && setChoices(c), (error: unknown) => console.error('Could not read the protection choices', error));
    load();
    const stop = onJobsChanged(load);
    return () => {
      alive = false;
      stop();
    };
  }, [account]);
  return choices;
}

const reloadPage = () => location.reload();

/**
 * When the saved data is erased, this page starts again from nothing ([then], e.g. a page that
 * says so; otherwise a plain reload), so it never shows what is gone.
 */
export function useStartOverWhenErased(then: () => void = reloadPage): void {
  useEffect(() => {
    return onErased(() => {
      forgetPageSettings();
      then();
    });
  }, [then]);
}

/** What the extension's pages remember for convenience (e.g. the review tab's last tab) goes with the erased data. */
function forgetPageSettings(): void {
  try {
    localStorage.clear();
  } catch (error) {
    console.warn('Photo Cleaner: could not clear what this page remembers', error);
  }
}

/** Saves the account's protection choices; every surface hears of it. */
export function setProtectionChoices(account: string, choices: ProtectionChoices): Promise<void> {
  return preferences.setProtection(account, choices);
}

/** For actions started from a click: a failure goes to the log rather than vanishing ([what]: "starting the scan"). */
export function logFailure(what: string): (error: unknown) => void {
  return (error) => console.error(`Photo Cleaner: ${what} failed`, error);
}

export function send(request: AppRequest): Promise<unknown> {
  return chrome.runtime.sendMessage(request);
}

/**
 * Opens the panel of Photos tab [tabId] and brings that tab forward. Chrome opens a side panel only
 * straight from a click, so it is asked here, at once, rather than by the service worker after a message.
 */
export async function showPanel(tabId: number): Promise<void> {
  emitUsage({ name: 'surface_open_requested', params: { source_surface: 'popup', target_surface: 'panel' } });
  try {
    const offered = chrome.sidePanel.setOptions(panelOptions(tabId)); // in case this tab has not been given it yet
    const opened = chrome.sidePanel.open({ tabId });
    await Promise.all([offered, opened, send({ kind: 'app-show-panel', tabId })]);
    emitUsage({ name: 'surface_open_result', params: { source_surface: 'popup', target_surface: 'panel', result: 'accepted' } });
  } catch (error) {
    emitUsage({ name: 'surface_open_result', params: { source_surface: 'popup', target_surface: 'panel', result: 'failed' } });
    console.error('Photo Cleaner: could not open the panel', error);
  }
}

/**
 * Opens Google Photos with its panel: the best Photos tab, or a new one, which the service worker
 * finds or opens; then its panel, as [showPanel] does. A click lets its page open a side panel for a
 * few seconds, so the panel can still open after asking the service worker.
 */
export async function openPhotos(): Promise<void> {
  let tabId: number;
  try {
    tabId = photosTabOf(await send({ kind: 'app-open-photos' }));
  } catch (error) {
    console.error('Photo Cleaner: could not open Google Photos', error);
    return;
  }
  await showPanel(tabId);
}

/** The extension's version, as its manifest says: "0.4.14". */
export function extensionVersion(): string {
  return chrome.runtime.getManifest().version;
}

/**
 * The popup's and the panel's data: which account is signed in (in the panel's [tabId], for the panel),
 * its Scan (undefined while loading), and the one button to the review tab ("Review 1,731 groups" or
 * "Open in tab").
 */
export function useSignedInScan(tabId?: number): {
  view: SurfaceView; scan: ScanJob | null | undefined; analysis: AnalysisJob | null | undefined; report: ReportView | null | undefined; launch: LaunchButton;
} {
  const view = surfaceView(useAccount(tabId).answer);
  const scan = useScanJob(view.account);
  const analysis = useAnalysisJob(view.account);
  const choices = useProtectionChoices(view.account);
  const report = useReport(view.account, scan, choices);
  const launch = launchButton(useReviewSummary(view.account), scan, analysis, choices, Date.now());
  return { view, scan, analysis, report, launch };
}

/** How many duplicate groups [account] has waiting, as last worked out, kept up to date; null when unknown. */
export function useReviewSummary(account: string | null): ReviewSummary | null {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  useEffect(() => {
    if (account === null) return;
    let alive = true;
    const load = () => void review.summary(account).then(
      (s) => alive && setSummary(s),
      (error: unknown) => console.warn('Photo Cleaner: could not read how many groups are waiting', error),
    );
    load();
    const stop = onJobsChanged(load);
    return () => {
      alive = false;
      stop();
    };
  }, [account]);
  return summary;
}

/** The library scan of [account], kept up to date; undefined while loading. */
export function useScanJob(account: string | null): ScanJob | null | undefined {
  return useJob(account, 'library-scan') as ScanJob | null | undefined;
}

/** The AI analysis of [account], kept up to date; undefined while loading. */
export function useAnalysisJob(account: string | null): AnalysisJob | null | undefined {
  return useJob(account, 'analysis') as AnalysisJob | null | undefined;
}

function useJob(account: string | null, kind: JobKind): Job | null | undefined {
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  useEffect(() => {
    if (account === null) {
      setJob(null);
      return;
    }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // If the saved data can't be opened yet (see useStorageProblem), try again shortly.
    const load = () => void store.get(jobId(kind, account)).then(
      (j) => alive && setJob(j),
      (error: unknown) => {
        console.warn('Photo Cleaner: could not read the saved jobs; trying again shortly', error);
        if (alive) retry = setTimeout(load, RETRY_MS);
      },
    );
    load();
    const stop = onJobsChanged(load);
    return () => {
      alive = false;
      clearTimeout(retry);
      stop();
    };
  }, [account, kind]);
  return job;
}

const RETRY_MS = 3_000;

/**
 * Why the saved data can't be opened right now, in plain words (e.g. an older copy of the
 * extension still holds it after an update); null when all is well. Checks again until it works.
 */
export function useStorageProblem(): string | null {
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const probe = () => openDatabase().then(
      (db) => {
        db.close();
        if (alive) setProblem(null);
      },
      (error: unknown) => {
        if (!alive) return;
        setProblem(storageProblemText(error));
        retry = setTimeout(probe, RETRY_MS);
      },
    );
    void probe();
    return () => {
      alive = false;
      clearTimeout(retry);
    };
  }, []);
  return problem;
}

/** All saved jobs (every account), kept up to date. */
export function useAllJobs(): Job[] {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => void store.all().then(
      (all) => alive && setJobs(all),
      (error: unknown) => {
        console.warn('Photo Cleaner: could not read the saved jobs; trying again shortly', error);
        if (alive) retry = setTimeout(load, RETRY_MS);
      },
    );
    load();
    const stop = onJobsChanged(load);
    return () => {
      alive = false;
      clearTimeout(retry);
      stop();
    };
  }, []);
  return jobs;
}

const ACCOUNT_REFRESH_MS = 5_000;

/**
 * Which Google account the Photos tab is signed in to: the panel's own tab [tabId], or for the popup
 * and review tab the most relevant Photos tab. Checked again every few seconds and on focus,
 * so switching accounts in Google Photos shows up by itself. Answers can arrive out of order: one
 * older than the answer shown is dropped (rather than all but the latest: when each check takes
 * about as long as the gap between checks, every answer would be outrun by the next request).
 */
export function useAccount(tabId?: number): { answer: AccountAnswer | undefined; refresh: () => void } {
  const [answer, setAnswer] = useState<AccountAnswer | undefined>(undefined);
  const asked = useRef(0);
  const shown = useRef(0);
  const refresh = useCallback(() => {
    const request = ++asked.current;
    const show = (latest: AccountAnswer) => {
      if (request < shown.current) return;
      shown.current = request;
      setAnswer(latest);
    };
    send({ kind: 'app-account', tabId }).then((reply) => show(accountAnswer(reply)), (error: unknown) => {
      console.warn('Photo Cleaner: the extension did not answer which account is signed in', error);
      show({ account: null, problem: 'The extension is restarting; try again in a moment.', photosTabOpen: null, tabId: null });
    });
  }, [tabId]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, ACCOUNT_REFRESH_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return { answer, refresh };
}

const SPINNER_FRAME_MS = 100;
const SPINNER_PX = 32;

/**
 * While [spinning], the browser tab's icon is a turning ring, so a running Scan shows from any tab
 * (Chrome's own loading spinner only appears while a page loads). Background tabs get timers about
 * once a second, so there it turns in steps. Afterwards the page's own icon is put back: Chrome keeps
 * showing the last icon set, so removing the ring alone would leave its last frame in the tab.
 */
export function useSpinningTabIcon(spinning: boolean): void {
  useEffect(() => {
    if (!spinning) return;
    const canvas = document.createElement('canvas');
    canvas.width = SPINNER_PX;
    canvas.height = SPINNER_PX;
    const context = canvas.getContext('2d');
    if (!context) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) throw new Error('The page has no tab icon to animate (link rel="icon")');
    const ownIcon = link.href;
    let turn = 0;
    const draw = () => {
      context.clearRect(0, 0, SPINNER_PX, SPINNER_PX);
      context.lineWidth = 5;
      context.lineCap = 'round';
      context.strokeStyle = 'rgba(139, 116, 255, 0.25)';
      context.beginPath();
      context.arc(SPINNER_PX / 2, SPINNER_PX / 2, 12, 0, 2 * Math.PI);
      context.stroke();
      context.strokeStyle = '#8b74ff';
      context.beginPath();
      context.arc(SPINNER_PX / 2, SPINNER_PX / 2, 12, turn, turn + 1.5 * Math.PI);
      context.stroke();
      link.href = canvas.toDataURL('image/png');
      turn += Math.PI / 6;
    };
    draw();
    const timer = setInterval(draw, SPINNER_FRAME_MS);
    return () => {
      clearInterval(timer);
      link.href = ownIcon;
    };
  }, [spinning]);
}
