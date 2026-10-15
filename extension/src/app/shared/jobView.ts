// What the surfaces show for an account's Scan: plain values, worked out here rather than in the UI.
// A Scan is one job for the user in two stages: reading the photo list (the library scan), then
// analysing the new photos (the analysis, which a finished library scan starts by itself). They
// are saved as two jobs, each resumable; here they become one card with one button.

import { SCAN_MAX_AGE_MS } from '../scan/report';
import { count, n } from './format';
import type { AnalysisJob, Job, JobKind, ScanJob } from './job';
import type { AccountAnswer } from './messages';
import type { ReviewSummary } from '../duplicates/reviewStore';
import type { ProtectionChoices } from './preferences';

/**
 * How an account is named on screen: its email when a Photos tab is signed in to it right
 * now, otherwise the start of its fingerprint (the only thing stored).
 */
export function accountLabel(fingerprint: string, email: string | null): string {
  return email ?? `account ${fingerprint.slice(0, 8)}…`;
}

export interface ScanView {
  /** "Not scanned yet", "Scanning", "Scan paused", "Scan stopped", "Scan complete" or "Scan out of date". */
  title: string;
  /** "Stage 1 of 2 · Reading your photo list: albums"; null when nothing is under way. */
  stage: string | null;
  /** 0–100 for the bar while analysing; null when there is no measure (the photo list's length is unknown up front). */
  percent: number | null;
  /** Reading the photo list: the bar moves without a measure. */
  indeterminate: boolean;
  lines: string[];
  /** The speed check's verdict; shown until the analysis is done. */
  speedCheck: string | null;
  /** Why it is going slower or waiting right now. */
  waiting: string | null;
  /** A retry, a reset or why it stopped; null when all is well. */
  notice: string | null;
  /** "Started 14:02 · last step 14:03" while reading the photo list. */
  timesText: string | null;
  action: 'start' | 'pause' | 'resume' | 'restart';
  actionLabel: string;
  /** Which of the two saved jobs the button acts on. */
  target: JobKind;
  /** Whether the protection details belong to this Scan: once its photo list is read (not a previous scan's while reading). */
  protectionKnown: boolean;
  /** For the tab, as on the desktop: "scanning", "needed", "out of date" or "done". */
  tabStatus: 'scanning' | 'needed' | 'out of date' | 'done';
  /** The Full speed switch, while analysing; null when it isn't shown. */
  fullSpeed: boolean | null;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/** Calendar days from [a] to [b] in local time: 0 the same day, 1 the day before… */
function daysBetween(a: number, b: number): number {
  const midnight = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  return Math.round((midnight(b) - midnight(a)) / 86_400_000);
}

/** "Checked today 21:40", "Checked yesterday 18:52", "Checked 6 days ago", then the date. */
export function checkedText(finishedAt: number, nowMs: number): string {
  const days = daysBetween(finishedAt, nowMs);
  if (days <= 0) return `Checked today ${clock(finishedAt)}`;
  if (days === 1) return `Checked yesterday ${clock(finishedAt)}`;
  if (days < 30) return `Checked ${days} days ago`;
  return `Checked ${day(finishedAt)}`;
}

function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

const NONE = { stage: null, percent: null, indeterminate: false, lines: [], speedCheck: null, waiting: null, notice: null, timesText: null, fullSpeed: null, protectionKnown: false };

/** The Scan step's tab title with its status, as on the desktop: "1 · Scan (done)". */
export function scanTabTitle(view: ScanView): string {
  return `1 · Scan (${view.tabStatus})`;
}

/** The browser tab's title, so the Scan can be followed from any tab: "42% · Scanning · Photo Cleaner". */
export function documentTitle(view: ScanView): string {
  if (view.tabStatus === 'scanning') return view.percent !== null ? `${view.percent}% · Scanning · Photo Cleaner` : 'Scanning… · Photo Cleaner';
  return view.title === 'Scan paused' ? 'Scan paused · Photo Cleaner' : 'Photo Cleaner';
}

/** The account's Scan: what it is doing, how far it is and the one button the user needs next. */
export function scanView(scan: ScanJob | null, analysis: AnalysisJob | null, nowMs: number): ScanView {
  if (scan === null) return { ...NONE, title: 'Not scanned yet', action: 'start', actionLabel: 'Scan library', target: 'library-scan', tabStatus: 'needed' };
  if (scan.status !== 'finished') return readingView(scan);
  return analysis === null
    ? { ...NONE, title: 'Photos not analysed yet', stage: 'Stage 2 of 2 · Analysing new photos', action: 'start', actionLabel: 'Analyse photos', target: 'analysis', tabStatus: 'needed', protectionKnown: true }
    : analysingView(scan, analysis, nowMs);
}

/** Stage 1: reading the photo list (the library scan). */
function readingView(scan: ScanJob): ScanView {
  const p = scan.progress;
  const base = {
    ...NONE,
    stage: 'Stage 1 of 2 · Reading your photo list',
    lines: [
      `Library: ${count(p.libraryEntries, 'entry', 'entries')}` + (p.libraryReachedMs !== null ? `, reached photos from ${day(p.libraryReachedMs)}` : ''),
      `Favourite photos: ${count(p.favouriteEntries, 'entry', 'entries')}`,
      `Archived photos: ${count(p.archiveEntries, 'entry', 'entries')}`,
      `Albums: ${n(p.albumsRead)} of ${n(p.albumsListed)} read` + (p.albumsFailed > 0 ? `, ${n(p.albumsFailed)} could not be read` : ''),
    ],
    notice: p.notice,
    timesText: `Started ${clock(scan.startedAtMs)} · last step ${clock(scan.updatedAtMs)}`,
    target: 'library-scan' as const,
  };
  switch (scan.status) {
    case 'running':
      return { ...base, title: 'Scanning', indeterminate: true, action: 'pause', actionLabel: 'Pause', tabStatus: 'scanning' };
    case 'paused':
      return { ...base, title: 'Scan paused', action: 'resume', actionLabel: 'Resume', tabStatus: 'needed' };
    default:
      return { ...base, title: 'Scan stopped', action: 'restart', actionLabel: 'Start a new scan', tabStatus: 'needed' };
  }
}

/** Stage 2: analysing the new photos; once done, the Scan is up to date. */
function analysingView(scan: ScanJob, job: AnalysisJob, nowMs: number): ScanView {
  const p = job.progress;
  if (job.status === 'finished') {
    const finishedAt = scan.finishedAtMs ?? job.updatedAtMs;
    // Only what the last scan saw is known; after a day it no longer proves what is protected.
    const stale = nowMs - finishedAt > SCAN_MAX_AGE_MS;
    return {
      ...NONE,
      protectionKnown: true,
      title: stale ? 'Scan out of date' : 'Scan complete',
      lines: [
        count(p.photos, 'photo', 'photos') +
          (p.failed > 0 ? ` · ${n(p.failed)} could not be read (tried again next time)` : stale ? '' : ' · ready to review'),
        checkedText(finishedAt, nowMs),
      ],
      notice: stale ? 'More than a day old: check for new photos before anything can be trashed.' : null,
      // A repeat Scan only re-reads the list of photos (minutes) and analyses the new ones; nothing is analysed twice.
      action: 'restart',
      actionLabel: 'Check for new photos',
      target: 'library-scan',
      tabStatus: stale ? 'out of date' : 'done',
    };
  }
  const stages = { model: 'Getting the AI model ready (once)', 'speed-check': 'Checking this computer’s speed', analysing: 'Analysing new photos' };
  // The bar fills once for the model download, then again for this run's new photos.
  const percent = p.stage === 'model' ? (p.modelPercent ?? 0) : p.newPhotos ? Math.floor((p.newAnalysed * 100) / p.newPhotos) : null;
  const lines: string[] = [];
  if (p.stage === 'model') lines.push(`Downloading the AI model (once): ${p.modelPercent ?? 0}% of about 290 MB`);
  if (p.newPhotos) {
    lines.push(`New photos: ${n(p.newAnalysed)} of ${n(p.newPhotos)} analysed` + (p.failed > 0 ? ` · ${n(p.failed)} could not be fetched (tried again next time)` : ''));
  }
  if (job.status === 'running' && p.photosPerSecond !== null) {
    lines.push(`${p.photosPerSecond.toFixed(1)} photos/s over the last minute` + (p.etaSeconds !== null ? ` · about ${duration(p.etaSeconds)} left` : ''));
  }
  if (job.status === 'running' && p.perPhotoMs !== null) {
    const t = p.perPhotoMs;
    const ms = (value: number) => Math.round(value);
    lines.push(`Per photo (ms): AI ${ms(t.ai)} · preview ${ms(t.preview)} · save ${ms(t.save)} · gentle ${ms(t.pace)} · other ${ms(t.other)}`);
  }
  if (p.detail !== null) lines.push(`Detail ${p.detail}`);
  const base = {
    ...NONE,
    protectionKnown: true,
    stage: `Stage 2 of 2 · ${stages[p.stage ?? 'analysing']}`,
    percent,
    lines,
    speedCheck: p.speedCheckText,
    notice: p.notice,
    target: 'analysis' as const,
    fullSpeed: job.fullSpeed,
  };
  switch (job.status) {
    case 'running':
      return { ...base, title: 'Scanning', waiting: p.waiting, action: 'pause', actionLabel: 'Pause', tabStatus: 'scanning' };
    case 'paused':
      return { ...base, title: 'Scan paused', action: 'resume', actionLabel: 'Resume', tabStatus: 'needed' };
    default:
      return { ...base, title: 'Scan stopped', action: 'restart', actionLabel: 'Try again', tabStatus: 'needed' };
  }
}

// --- the review tab's page ---

/** The account the review tab shows: the one in its address (a link from another account's row), else the one signed in. */
export function reviewAccount(requested: string | null, signedIn: { fingerprint: string } | null): string | null {
  return requested ?? signedIn?.fingerprint ?? null;
}

export interface OtherAccountRow {
  account: string;
  href: string;
  label: string;
  scanTitle: string;
}

export interface ReviewPageView {
  /** "Account: someone@example.com"; null with no account yet. */
  accountText: string | null;
  /**
   * The tabs' labels, numbered as on the desktop (which has Calibration as its step 2); Search is not a
   * step. The Scan tab's carries its status: "1 · Scan (done)".
   */
  tabLabels: { scan: string; duplicates: string; search: string };
  /** Other accounts scanned on this computer, each a link to its own review. */
  otherAccounts: OtherAccountRow[];
  /**
   * Changes when the duplicate groups must be built again: when a library scan or the analysis
   * finishes (their finish time changes; pausing and progress don't) or the protection choices
   * change. Null while the jobs and the choices are still loading.
   */
  refreshKey: string | null;
}

export function reviewPageView(input: {
  selected: string | null;
  signedIn: { fingerprint: string; email: string | null } | null;
  jobs: Job[];
  scan: ScanJob | null | undefined;
  analysis: AnalysisJob | null | undefined;
  choices: ProtectionChoices | undefined;
  nowMs: number;
}): ReviewPageView {
  const { selected, signedIn, jobs, scan, analysis, choices, nowMs } = input;
  const emailOf = (account: string) => (signedIn?.fingerprint === account ? signedIn.email : null);
  const analysisOf = (account: string) => jobs.find((j): j is AnalysisJob => j.kind === 'analysis' && j.account === account) ?? null;
  const shown = selected !== null && scan !== undefined && analysis !== undefined ? scanView(scan, analysis, nowMs) : null;
  return {
    accountText: selected === null ? null : `Account: ${accountLabel(selected, emailOf(selected))}`,
    tabLabels: { scan: shown ? scanTabTitle(shown) : '1 · Scan', duplicates: '2 · Duplicates', search: 'Search' },
    otherAccounts: jobs
      .filter((j): j is ScanJob => j.kind === 'library-scan' && j.account !== selected)
      .map((j) => ({
        account: j.account,
        href: `?account=${encodeURIComponent(j.account)}`,
        label: accountLabel(j.account, emailOf(j.account)),
        scanTitle: scanView(j, analysisOf(j.account), nowMs).title,
      })),
    refreshKey: scan === undefined || analysis === undefined || choices === undefined ? null
      : `${scan?.finishedAtMs ?? '-'}:${analysis?.finishedAtMs ?? '-'}:${JSON.stringify(choices)}`,
  };
}

// --- the popup and the panel ---

export interface SurfaceView {
  /**
   * `looking`: still asking which account is signed in; `no-photos`: no Google Photos tab is open;
   * `problem`: a tab is open but can't say; `account`: signed in to [account]. [problemText] says why
   * there's no account.
   */
  state: 'looking' | 'no-photos' | 'problem' | 'account';
  problemText: string | null;
  account: string | null;
  /** "Account: someone@example.com". */
  accountText: string | null;
}

export function surfaceView(answer: AccountAnswer | undefined): SurfaceView {
  const none = { problemText: null, account: null, accountText: null };
  if (answer === undefined) return { ...none, state: 'looking' };
  if (answer.account) {
    const { fingerprint, email } = answer.account;
    return { state: 'account', problemText: null, account: fingerprint, accountText: `Account: ${accountLabel(fingerprint, email)}` };
  }
  return { ...none, state: answer.photosTabOpen ? 'problem' : 'no-photos', problemText: answer.problem };
}

/**
 * The popup's "Review 1,731 groups" (it opens the review tab), from the last count of groups waiting.
 * Null when there's nothing to review, or the count may be wrong: a scan or analysis finished since, the
 * scan is out of date (nothing can be offered), or the protection choices changed.
 */
export function reviewButtonText(summary: ReviewSummary | null, scan: ScanJob | null | undefined, analysis: AnalysisJob | null | undefined, choices: ProtectionChoices | undefined, nowMs: number): string | null {
  if (!summary || summary.groupsToReview === 0 || !scan || scan.finishedAtMs === null || choices === undefined) return null;
  if (scan.finishedAtMs > summary.atMs || (analysis?.finishedAtMs ?? 0) > summary.atMs) return null;
  if (nowMs - scan.finishedAtMs > SCAN_MAX_AGE_MS) return null;
  if (JSON.stringify(choices) !== JSON.stringify(summary.protection)) return null;
  return `Review ${count(summary.groupsToReview, 'group', 'groups')}`;
}
