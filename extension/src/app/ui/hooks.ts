// State the surfaces watch. The saved jobs come straight from the browser database and are
// re-read whenever any surface or the background page saves a change.

import { useCallback, useEffect, useState } from 'react';
import { jobId, type Job } from '../shared/job';
import type { AccountAnswer, AppRequest } from '../shared/messages';
import { IndexedDbJobStore, onJobsChanged } from '../shared/store';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { classify, reportView, type ReportView } from '../scan/report';

export const store = new IndexedDbJobStore();
const inventory = new IndexedDbInventoryStore();

/**
 * The protection report of [account]'s latest scan, by the shared rules: null before any scan,
 * undefined while working it out. Worked out again when a scan ends (not on every page).
 */
export function useReport(account: string | null, job: Job | null | undefined): ReportView | null | undefined {
  const [report, setReport] = useState<ReportView | null | undefined>(undefined);
  const settled = job === undefined ? 'loading' : job === null ? 'none' : job.status === 'running' ? 'running' : `${job.status}:${job.updatedAtMs}`;
  useEffect(() => {
    if (account === null || settled === 'loading' || settled === 'running') return;
    let alive = true;
    void (async () => {
      const run = await inventory.latestRun(account);
      if (!run) return alive && setReport(null);
      const view = reportView(classify(await inventory.snapshot(run.id), Date.now()));
      if (alive) setReport(view);
    })().catch((error: unknown) => {
      console.error('Could not work out the report', error);
      if (alive) setReport(null);
    });
    return () => {
      alive = false;
    };
  }, [account, settled]);
  return report;
}

export function send(request: AppRequest): Promise<unknown> {
  return chrome.runtime.sendMessage(request);
}

/** The library scan of [account], kept up to date; undefined while loading. */
export function useScanJob(account: string | null): Job | null | undefined {
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  useEffect(() => {
    if (account === null) {
      setJob(null);
      return;
    }
    let alive = true;
    const load = () => void store.get(jobId('library-scan', account)).then((j) => alive && setJob(j));
    load();
    const stop = onJobsChanged(load);
    return () => {
      alive = false;
      stop();
    };
  }, [account]);
  return job;
}

/** All saved jobs (every account), kept up to date. */
export function useAllJobs(): Job[] {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void store.all().then((all) => alive && setJobs(all));
    load();
    const stop = onJobsChanged(load);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return jobs;
}

const ACCOUNT_REFRESH_MS = 5_000;

/**
 * Which Google account the Photos tab is signed in to: the panel's own tab, or for the popup
 * and review tab the most relevant Photos tab. Checked again every few seconds and on focus,
 * so switching accounts in Google Photos shows up by itself.
 */
export function useAccount(): { answer: AccountAnswer | undefined; refresh: () => void } {
  const [answer, setAnswer] = useState<AccountAnswer | undefined>(undefined);
  const refresh = useCallback(() => {
    void (send({ kind: 'app-account' }) as Promise<AccountAnswer>).then(setAnswer, () =>
      setAnswer({ account: null, problem: 'The extension is restarting; try again in a moment.', photosTabOpen: false }));
  }, []);
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
