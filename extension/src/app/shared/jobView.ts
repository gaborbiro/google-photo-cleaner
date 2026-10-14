// What the surfaces show for a job: plain values, worked out here rather than in the UI.

import type { Job } from './job';

export interface JobView {
  title: string;
  /** "123 of 400 · 31%"; null before any job. */
  progressText: string | null;
  /** 0–100, for the progress bar. */
  percent: number;
  /** The button the user needs next. */
  action: 'start' | 'pause' | 'resume' | 'restart';
  actionLabel: string;
  /** "Started 14:02 · last step 14:03"; null before any job. */
  timesText: string | null;
}

/**
 * How an account is named on screen: its email when a Photos tab is signed in to it right
 * now, otherwise the start of its fingerprint (the only thing stored).
 */
export function accountLabel(fingerprint: string, email: string | null): string {
  return email ?? `account ${fingerprint.slice(0, 8)}…`;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function jobView(job: Job | null): JobView {
  if (job === null) {
    return { title: 'Not scanned yet', progressText: null, percent: 0, action: 'start', actionLabel: 'Scan', timesText: null };
  }
  const percent = Math.floor((job.done * 100) / job.total);
  const progressText = `${job.done.toLocaleString()} of ${job.total.toLocaleString()} · ${percent}%`;
  const times = job.finishedAtMs !== null
    ? `Started ${clock(job.startedAtMs)} · finished ${clock(job.finishedAtMs)}`
    : `Started ${clock(job.startedAtMs)} · last step ${clock(job.updatedAtMs)}`;
  switch (job.status) {
    case 'running':
      return { title: 'Scanning (pretend job)', progressText, percent, action: 'pause', actionLabel: 'Pause', timesText: times };
    case 'paused':
      return { title: 'Paused', progressText, percent, action: 'resume', actionLabel: 'Resume', timesText: times };
    case 'finished':
      return { title: 'Scan finished', progressText, percent, action: 'restart', actionLabel: 'Scan again', timesText: times };
  }
}
