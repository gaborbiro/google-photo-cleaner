// What the surfaces show for a scan job: plain values, worked out here rather than in the UI.

import { count, n } from './format';
import type { AnalysisJob, ScanJob } from './job';

export interface JobView {
  title: string;
  /** The scan's progress, one line per listing; empty before any scan. */
  lines: string[];
  /** A retry, a reset or why it stopped; null when all is well. */
  notice: string | null;
  /** The button the user needs next. */
  action: 'start' | 'pause' | 'resume' | 'restart';
  actionLabel: string;
  /** "Started 14:02 · last step 14:03"; null before any scan. */
  timesText: string | null;
}

/**
 * How an account is named on screen: its email when a Photos tab is signed in to it right
 * now, otherwise the start of its fingerprint (the only thing stored).
 */
export function accountLabel(fingerprint: string, email: string | null): string {
  return email ?? `account ${fingerprint.slice(0, 8)}…`;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const PHASE_NAMES = { LIBRARY: 'library', FAVOURITES: 'favourites', ARCHIVE: 'archive', ALBUM_LIST: 'album list', ALBUM_MEMBERS: 'album contents' };

export function jobView(job: ScanJob | null): JobView {
  if (job === null) {
    return { title: 'Not scanned yet', lines: [], notice: null, action: 'start', actionLabel: 'Scan library', timesText: null };
  }
  const p = job.progress;
  const lines = [
    `Library: ${count(p.libraryEntries, 'entry', 'entries')}` + (p.libraryReachedMs !== null ? `, reached photos from ${day(p.libraryReachedMs)}` : ''),
    `Favourite photos: ${count(p.favouriteEntries, 'entry', 'entries')}`,
    `Archived photos: ${count(p.archiveEntries, 'entry', 'entries')}`,
    `Albums: ${n(p.albumsRead)} of ${n(p.albumsListed)} read` + (p.albumsFailed > 0 ? `, ${n(p.albumsFailed)} could not be read` : ''),
  ];
  const timesText = job.finishedAtMs !== null
    ? `Started ${clock(job.startedAtMs)} · ended ${clock(job.finishedAtMs)}`
    : `Started ${clock(job.startedAtMs)} · last step ${clock(job.updatedAtMs)}`;
  const base = { lines, notice: p.notice, timesText };
  switch (job.status) {
    case 'running':
      return { ...base, title: p.phase ? `Scanning: ${PHASE_NAMES[p.phase]}` : 'Scanning', action: 'pause', actionLabel: 'Pause' };
    case 'paused':
      return { ...base, title: 'Scan paused', action: 'resume', actionLabel: 'Resume scan' };
    case 'finished':
      return { ...base, title: 'Scan complete', action: 'restart', actionLabel: 'Scan again' };
    case 'failed':
      return { ...base, title: 'Scan failed', action: 'restart', actionLabel: 'Start a new scan' };
  }
}

export interface AnalysisView {
  title: string;
  lines: string[];
  /** The speed check's verdict; shown until the analysis is done. */
  speedCheck: string | null;
  /** Why it is going slower or waiting right now. */
  waiting: string | null;
  notice: string | null;
  /** 0–100 for the progress bar; null before anything is known. */
  percent: number | null;
  action: 'start' | 'pause' | 'resume' | 'restart' | null;
  actionLabel: string | null;
  fullSpeed: boolean;
}

function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * The AI analysis, which follows a finished library scan: what it is doing, how far it is, how
 * fast this computer goes and how long is left.
 */
export function analysisView(job: AnalysisJob | null, scanFinished: boolean): AnalysisView {
  if (job === null) {
    return {
      title: scanFinished ? 'Photos not analysed yet' : 'Analysis follows the library scan',
      lines: [], speedCheck: null, waiting: null, notice: null, percent: null,
      action: scanFinished ? 'start' : null, actionLabel: scanFinished ? 'Analyse photos' : null, fullSpeed: false,
    };
  }
  const p = job.progress;
  // The bar fills once for the model download, then again for the photos.
  const percent = p.stage === 'model' ? (p.modelPercent ?? 0) : p.photos > 0 ? Math.floor((p.analysed * 100) / p.photos) : null;
  const lines: string[] = [];
  if (p.stage === 'model') lines.push(`Downloading the AI model (once): ${p.modelPercent ?? 0}% of about 290 MB`);
  if (p.photos > 0) {
    lines.push(`Analysed ${n(p.analysed)} of ${count(p.photos, 'photo', 'photos')}` + (p.failed > 0 ? ` · ${n(p.failed)} could not be fetched (tried again next time)` : ''));
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
  const titles = { model: 'Preparing the AI model', 'speed-check': 'Checking this computer’s speed', analysing: 'Analysing photos' };
  const common = { lines, speedCheck: job.status === 'finished' ? null : p.speedCheckText, notice: p.notice, percent, fullSpeed: job.fullSpeed };
  switch (job.status) {
    case 'running':
      return { ...common, title: p.stage ? titles[p.stage] : 'Analysing photos', waiting: p.waiting, action: 'pause', actionLabel: 'Pause' };
    case 'paused':
      return { ...common, title: 'Analysis paused', waiting: null, action: 'resume', actionLabel: 'Resume analysis' };
    case 'finished':
      return { ...common, title: 'All photos analysed', waiting: null, action: 'restart', actionLabel: 'Analyse new photos' };
    case 'failed':
      return { ...common, title: 'Analysis stopped', waiting: null, action: 'restart', actionLabel: 'Try again' };
  }
}
