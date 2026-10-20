// What the surfaces show for an account's Scan: plain values, worked out here rather than in the UI.
// A Scan is one job for the user in two stages: reading the photo list (the library scan), then
// analysing the new photos (the analysis, which a finished library scan starts by itself). They
// are saved as two jobs, each resumable; here they become two visible steps with one button.

import { MODEL_DOWNLOAD_BYTES } from '../ai/model';
import { SCAN_MAX_AGE_MS, type ReportView } from '../scan/report';
import { count, n } from './format';
import { googleProblemLine } from './googleProblems';
import type { AnalysisJob, Job, JobKind, ScanJob } from './job';
import type { AccountAnswer, ReviewTab } from './messages';
import type { ReviewSummary } from '../duplicates/reviewStore';
import type { ProtectionChoices } from './preferences';

/**
 * How an account is named on screen: its email when a Photos tab is signed in to it right
 * now, otherwise the start of its fingerprint (the only thing stored).
 */
export function accountLabel(fingerprint: string, email: string | null): string {
  return email ?? `account ${fingerprint.slice(0, 8)}…`;
}

interface ScanSummary {
  /** "Not scanned yet", "Scanning", "Scan paused", "Scan stopped", "Scan complete" or "Scan out of date". */
  title: string;
  /** The status dot beside the title: complete, needs attention (paused, out of date) or stopped; null without one. */
  tone: 'positive' | 'caution' | 'negative' | null;
  /** "Stage 1 of 2 · Reading your photo list: albums"; null when nothing is under way. */
  stage: string | null;
  /** 0–100 for the bar while analysing; null when there is no measure (the photo list's length is unknown up front). */
  percent: number | null;
  /** Reading the photo list: the bar moves without a measure. */
  indeterminate: boolean;
  lines: string[];
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
  /** The Full speed switch throughout both scan stages; null when it isn't shown. */
  fullSpeed: boolean | null;
}

export interface ScanStepView {
  number: 1 | 2;
  title: string;
  description: string;
  state: 'pending' | 'running' | 'paused' | 'failed' | 'complete' | 'stale';
  statusText: string;
  phase: string | null;
  /** "Detail 140", the AI analysis's level of detail: shown quietly beside the protection details' scan times. */
  detailText: string | null;
  /**
   * In the protection details and their copied report: Google's details behind the scan's or the
   * analysis's stop, for a support request ("For support: analysis: preview · PROTOCOL · …").
   */
  supportLines: string[];
  /** On the step itself, while it is stopped: Google's details behind it (the same line), when the protection details can't show them. */
  problemLines: string[];
  /** Whether the step stopped or paused because something went wrong: it then offers Copy diagnostics. */
  diagnostics: boolean;
  lines: string[];
  percent: number | null;
  indeterminate: boolean;
  waiting: string | null;
  notice: string | null;
  timesText: string | null;
  fullSpeed: boolean | null;
  protectionKnown: boolean;
}

export interface ScanView extends ScanSummary {
  steps: [ScanStepView, ScanStepView];
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

const NONE = { tone: null, stage: null, percent: null, indeterminate: false, lines: [], waiting: null, notice: null, timesText: null, fullSpeed: null, protectionKnown: false };

/** The Scan step's tab title with its status, as on the desktop: "1 · Scan (done)". */
export function scanTabTitle(view: ScanView): string {
  return `1 · Scan (${view.tabStatus})`;
}

/** The browser tab's title, so the Scan can be followed from any tab: "42% · Scanning · Photo Cleaner". */
export function documentTitle(view: ScanView): string {
  if (view.tabStatus === 'scanning') return view.percent !== null ? `${view.percent}% · Scanning · Photo Cleaner` : 'Scanning… · Photo Cleaner';
  return view.title === 'Scan paused' ? 'Scan paused · Photo Cleaner' : 'Photo Cleaner';
}

/** Where a Scan is shown: the popup, the panel inside Google Photos, or the review tab. */
export type ScanSurface = 'popup' | 'panel' | 'tab';

/** The account's Scan: what it is doing, how far it is and the one button the user needs next. */
export function scanView(scan: ScanJob | null, analysis: AnalysisJob | null, nowMs: number, surface: ScanSurface): ScanView {
  const summary = scanSummary(scan, analysis, nowMs, surface);
  return { ...summary, steps: scanSteps(scan, analysis, summary, nowMs) };
}

function scanSummary(scan: ScanJob | null, analysis: AnalysisJob | null, nowMs: number, surface: ScanSurface): ScanSummary {
  if (scan === null) return { ...NONE, title: 'Not scanned yet', action: 'start', actionLabel: 'Scan library', target: 'library-scan', tabStatus: 'needed' };
  if (scan.status !== 'finished') return readingView(scan, analysis?.fullSpeed ?? false);
  return analysis === null
    ? { ...NONE, title: 'Photos not analysed yet', stage: 'Stage 2 of 2 · Analysing new photos', action: 'start', actionLabel: 'Analyse photos', target: 'analysis', tabStatus: 'needed', protectionKnown: true, fullSpeed: false }
    : analysingView(scan, analysis, nowMs, surface);
}

/** Stage 1: reading the photo list (the library scan). */
function readingView(scan: ScanJob, fullSpeed: boolean): ScanSummary {
  const p = scan.progress;
  const base = {
    ...NONE,
    fullSpeed,
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
      return { ...base, title: 'Scan paused', tone: 'caution', action: 'resume', actionLabel: 'Resume', tabStatus: 'needed' };
    default:
      return { ...base, title: 'Scan stopped', tone: 'negative', action: 'restart', actionLabel: 'Start a new scan', tabStatus: 'needed' };
  }
}

/** Stage 2: analysing the new photos; once done, the Scan is up to date. */
function analysingView(scan: ScanJob, job: AnalysisJob, nowMs: number, surface: ScanSurface): ScanSummary {
  const p = job.progress;
  if (job.status === 'finished') {
    const finishedAt = scan.finishedAtMs ?? job.updatedAtMs;
    // Only what the last scan saw is known; after a day it no longer proves what is protected.
    const stale = nowMs - finishedAt > SCAN_MAX_AGE_MS;
    return {
      ...NONE,
      protectionKnown: true,
      title: stale ? 'Scan out of date' : 'Scan complete',
      tone: stale ? 'caution' : 'positive',
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
  // The bar fills once for the model download, then again for this run's new photos.
  const percent = p.stage === 'model' ? (p.modelPercent ?? 0) : p.newPhotos ? Math.floor((p.newAnalysed * 100) / p.newPhotos) : null;
  const lines: string[] = [];
  if (p.stage === 'model') lines.push(`Downloading the AI model (once): ${p.modelPercent ?? 0}% of about ${Math.round(MODEL_DOWNLOAD_BYTES / 1e7) * 10} MB`);
  if (p.newPhotos) {
    lines.push(`New photos: ${n(p.newAnalysed)} of ${n(p.newPhotos)} analysed` + (p.failed > 0 ? ` · ${n(p.failed)} could not be fetched (tried again next time)` : ''));
  }
  if (job.status === 'running' && p.photosPerSecond !== null) {
    lines.push(`${p.photosPerSecond.toFixed(1)} photos/s over the last minute` + (p.etaSeconds !== null ? ` · about ${duration(p.etaSeconds)} left` : ''));
  }
  // Where each photo's time goes: only in the review tab, which has room for it.
  if (surface === 'tab' && job.status === 'running' && p.perPhotoMs !== null) {
    const t = p.perPhotoMs;
    const ms = (value: number) => Math.round(value);
    lines.push(`Per photo (ms): AI ${ms(t.ai)} · preview ${ms(t.preview)} · save ${ms(t.save)} · gentle ${ms(t.pace)} · other ${ms(t.other)}`);
  }
  const base = {
    ...NONE,
    protectionKnown: true,
    stage: `Stage 2 of 2 · ${ANALYSIS_PHASES[p.stage ?? 'analysing']}`,
    percent,
    // (The speed check's verdict isn't shown: the live speed and time left say it better.)
    lines,
    notice: p.notice,
    target: 'analysis' as const,
    fullSpeed: job.fullSpeed,
  };
  switch (job.status) {
    case 'running':
      return { ...base, title: 'Scanning', waiting: p.waiting, action: 'pause', actionLabel: 'Pause', tabStatus: 'scanning' };
    case 'paused':
      return { ...base, title: 'Scan paused', tone: 'caution', action: 'resume', actionLabel: 'Resume', tabStatus: 'needed' };
    default:
      return { ...base, title: 'Scan stopped', tone: 'negative', action: 'restart', actionLabel: 'Try again', tabStatus: 'needed' };
  }
}

const ANALYSIS_PHASES = { model: 'Getting the AI model ready (once)', 'speed-check': 'Checking this computer’s speed', analysing: 'Analysing new photos' };
const STEP_STATUS = { pending: 'Not started', running: 'In progress', paused: 'Paused', failed: 'Stopped', complete: 'Complete', stale: 'Needs a refresh' };

/** Keep the completed library report visible while analysis works, and never show old results as a new run's. */
function scanSteps(scan: ScanJob | null, analysis: AnalysisJob | null, summary: ScanSummary, nowMs: number): [ScanStepView, ScanStepView] {
  const libraryReady = scan?.status === 'finished';
  const stale = libraryReady && nowMs - (scan.finishedAtMs ?? scan.updatedAtMs) > SCAN_MAX_AGE_MS;
  const libraryState = stale ? 'stale' : scan?.status === 'finished' ? 'complete' : scan?.status ?? 'pending';
  const analysisReady = libraryReady && analysis !== null;
  const analysisState = analysisReady ? (analysis.status === 'finished' ? 'complete' : analysis.status) : 'pending';
  const library = scan ? readingView(scan, false) : null;
  const detail = analysis?.progress.detail;
  const detailText = detail !== undefined && detail !== null ? `Detail ${detail}` : null;
  const supportLines = [scan?.progress.googleProblem, analysis?.progress.googleProblem]
    .filter((problem) => problem !== undefined && problem !== null)
    .map(googleProblemLine);
  const scanStopped = scan !== null && stoppedByProblem(scan);
  const analysisStopped = analysisReady && stoppedByProblem(analysis);
  return [
    {
      ...NONE,
      number: 1,
      title: 'Read your library',
      description: 'Count your photos and check which ones are protected.',
      state: libraryState,
      statusText: STEP_STATUS[libraryState],
      phase: null,
      detailText,
      supportLines,
      problemLines: scanStopped && !libraryReady ? problemLine(scan) : [],
      diagnostics: scanStopped,
      // Once read, the report supplies the final counts; don't keep the live counters above it.
      lines: libraryReady ? [] : library?.lines ?? [],
      indeterminate: scan?.status === 'running',
      notice: stale ? 'More than a day old: check for new photos before anything can be trashed.' : scan?.progress.notice ?? null,
      timesText: libraryReady ? checkedText(scan.finishedAtMs ?? scan.updatedAtMs, nowMs) : library?.timesText ?? null,
      protectionKnown: libraryReady,
    },
    {
      ...NONE,
      number: 2,
      title: 'Analyse photos',
      description: 'Find similar photos and make your library searchable, on this computer.',
      state: analysisState,
      statusText: analysisReady ? STEP_STATUS[analysisState] : scan ? 'Up next' : 'Not started',
      phase: analysisReady && analysis.status !== 'finished' ? ANALYSIS_PHASES[analysis.progress.stage ?? 'analysing'] : null,
      detailText: null,
      supportLines: [],
      // Its line is in step 1's protection details, which are shown by then.
      problemLines: [],
      diagnostics: analysisStopped,
      lines: analysisReady ? (analysis.status === 'finished' ? [summary.lines[0]] : summary.lines) : [],
      percent: analysisReady ? summary.percent : null,
      waiting: analysisReady ? summary.waiting : 'Starts automatically after step 1.',
      notice: analysisReady ? analysis.progress.notice : null,
      fullSpeed: analysis?.fullSpeed ?? false,
    },
  ];
}

/**
 * Stopped, or paused, because something went wrong: not finished, not running, not waiting only
 * for Google Photos to open again, and with a reason to show (the user's own pause has none).
 */
function stoppedByProblem(job: Job): boolean {
  return job.status === 'failed' || (job.status === 'paused' && job.progress.notice !== null && job.resumeWhenPhotosOpen !== true);
}

/** Google's details behind [job]'s stop, as one line; none when it stopped for another reason. */
function problemLine(job: Job): string[] {
  const problem = job.progress.googleProblem;
  return problem ? [googleProblemLine(problem)] : [];
}

/** In the protection details and their copied report, so a support request says which version ran: "Photo Cleaner 0.4.14". */
export function versionLine(version: string): string {
  return `Photo Cleaner ${version}`;
}

/** What Copy report copies: the protection report, the version, then Google's details behind a stop, if any. */
export function copyReportText(report: ReportView, step: ScanStepView, version: string): string {
  return [report.copyText, versionLine(version), ...step.supportLines].join('\n');
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
  /** The account whose library this is, as shown: "someone@example.com"; null with no account yet. */
  accountName: string | null;
  /** Beside the title, so the user can tell an update has loaded: "v0.4.14". */
  versionLabel: string;
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
  version: string;
}): ReviewPageView {
  const { selected, signedIn, jobs, scan, analysis, choices, nowMs, version } = input;
  const emailOf = (account: string) => (signedIn?.fingerprint === account ? signedIn.email : null);
  const analysisOf = (account: string) => jobs.find((j): j is AnalysisJob => j.kind === 'analysis' && j.account === account) ?? null;
  const shown = selected !== null && scan !== undefined && analysis !== undefined ? scanView(scan, analysis, nowMs, 'tab') : null;
  return {
    accountName: selected === null ? null : accountLabel(selected, emailOf(selected)),
    versionLabel: `v${version}`,
    tabLabels: { scan: shown ? scanTabTitle(shown) : '1 · Scan', duplicates: '2 · Duplicates', search: 'Search' },
    otherAccounts: jobs
      .filter((j): j is ScanJob => j.kind === 'library-scan' && j.account !== selected)
      .map((j) => ({
        account: j.account,
        href: `?account=${encodeURIComponent(j.account)}`,
        label: accountLabel(j.account, emailOf(j.account)),
        scanTitle: scanView(j, analysisOf(j.account), nowMs, 'tab').title,
      })),
    refreshKey: scan === undefined || analysis === undefined || choices === undefined ? null
      : `${scan?.finishedAtMs ?? '-'}:${analysis?.finishedAtMs ?? '-'}:${JSON.stringify(choices)}`,
  };
}

// --- the popup and the panel ---

export interface SurfaceView {
  /**
   * `looking`: still asking which account is signed in (at most a few seconds); `no-photos`: no Google
   * Photos tab is open; `problem`: no account can be told (a tab is asleep, not responding or signed
   * out, or the extension itself did not answer); `account`: signed in to [account]. [problemText]
   * says why there's no account.
   */
  state: 'looking' | 'no-photos' | 'problem' | 'account';
  problemText: string | null;
  account: string | null;
  /** The account signed in to Google Photos, as shown: "someone@example.com". */
  accountName: string | null;
  /**
   * The popup offers Open Google Photos (which brings the Photos tab forward, or opens one): whenever
   * the answer came without an account. Not while looking, which ends within seconds, so the button
   * doesn't flash up each time the popup opens.
   */
  offerPhotos: boolean;
}

export function surfaceView(answer: AccountAnswer | undefined): SurfaceView {
  const none = { problemText: null, account: null, accountName: null };
  if (answer === undefined) return { ...none, state: 'looking', offerPhotos: false };
  if (answer.account) {
    const { fingerprint, email } = answer.account;
    return { state: 'account', problemText: null, account: fingerprint, accountName: accountLabel(fingerprint, email), offerPhotos: false };
  }
  return { ...none, state: answer.photosTabOpen === false ? 'no-photos' : 'problem', problemText: answer.problem, offerPhotos: true };
}

/** The popup's and the panel's one button to the review tab: what it says, and which tab it opens there. */
export interface LaunchButton {
  text: string;
  tab: ReviewTab;
}

/**
 * "Review 1,731 groups", opening Duplicates, while the last count of groups waiting can be trusted.
 * Otherwise "Open in tab", opening Scan: nothing to review yet, or the count may be wrong (a scan or
 * analysis finished since, the scan is out of date so nothing can be offered, or the protection
 * choices changed).
 */
export function launchButton(summary: ReviewSummary | null, scan: ScanJob | null | undefined, analysis: AnalysisJob | null | undefined, choices: ProtectionChoices | undefined, nowMs: number): LaunchButton {
  const toScan: LaunchButton = { text: 'Open in tab', tab: 'scan' };
  if (!summary || summary.groupsToReview === 0 || !scan || scan.finishedAtMs === null || choices === undefined) return toScan;
  if (scan.finishedAtMs > summary.atMs || (analysis?.finishedAtMs ?? 0) > summary.atMs) return toScan;
  if (nowMs - scan.finishedAtMs > SCAN_MAX_AGE_MS) return toScan;
  if (JSON.stringify(choices) !== JSON.stringify(summary.protection)) return toScan;
  return { text: `Review ${count(summary.groupsToReview, 'group', 'groups')}`, tab: 'duplicates' };
}
