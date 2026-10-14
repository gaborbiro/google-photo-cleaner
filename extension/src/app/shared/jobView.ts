// What the surfaces show for a scan job: plain values, worked out here rather than in the UI.

import { count, n } from './format';
import type { Job } from './job';

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

export function jobView(job: Job | null): JobView {
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
