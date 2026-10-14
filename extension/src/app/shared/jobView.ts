// What the surfaces show for an account's Scan: plain values, worked out here rather than in the UI.
// A Scan is one job for the user in two stages: reading the photo list (the library scan), then
// analysing the new photos (the analysis, which a finished library scan starts by itself). They
// are saved as two jobs, each resumable; here they become one card with one button.

import { SCAN_MAX_AGE_MS } from '../scan/report';
import { count, n } from './format';
import type { AnalysisJob, JobKind, ScanJob } from './job';

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
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

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
        `Checked ${sameDay(finishedAt, nowMs) ? 'today' : day(finishedAt)} ${clock(finishedAt)}`,
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
