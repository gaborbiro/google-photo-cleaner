// State the surfaces watch. The saved jobs come straight from the browser database and are
// re-read whenever any surface or the background page saves a change.

import { useCallback, useEffect, useState } from 'react';
import type { OpResult } from '../../shared/protocol';
import { jobId, type AnalysisJob, type Job, type JobKind, type ScanJob } from '../shared/job';
import type { AccountAnswer, AppRequest } from '../shared/messages';
import { openDatabase } from '../shared/db';
import { IndexedDbJobStore, onErased, onJobsChanged } from '../shared/store';
import { IndexedDbInventoryStore } from '../scan/inventoryStore';
import { SourceError } from '../scan/source';
import { classify, reportView, type ReportView } from '../scan/report';
import { IndexedDbPreferences, type ProtectionChoices } from '../shared/preferences';

export const store = new IndexedDbJobStore();
const inventory = new IndexedDbInventoryStore();
const preferences = new IndexedDbPreferences();

/**
 * The protection report of [account]'s latest scan, by the shared rules: null before any scan,
 * undefined while working it out. Worked out again when a scan ends (not on every page).
 */
export function useReport(account: string | null, job: Job | null | undefined, choices: ProtectionChoices | undefined): ReportView | null | undefined {
  const [report, setReport] = useState<ReportView | null | undefined>(undefined);
  const settled = job === undefined ? 'loading' : job === null ? 'none' : job.status === 'running' ? 'running' : `${job.status}:${job.updatedAtMs}`;
  const chosen = choices === undefined ? null : JSON.stringify(choices);
  useEffect(() => {
    if (account === null || chosen === null || settled === 'loading' || settled === 'running') return;
    let alive = true;
    void (async () => {
      const run = await inventory.latestRun(account);
      if (!run) return alive && setReport(null);
      const view = reportView(classify(await inventory.snapshot(run.id), Date.now(), JSON.parse(chosen) as ProtectionChoices));
      if (alive) setReport(view);
    })().catch((error: unknown) => {
      console.error('Could not work out the report', error);
      if (alive) setReport(null);
    });
    return () => {
      alive = false;
    };
  }, [account, settled, chosen]);
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
  useEffect(() => onErased(then), [then]);
}

/** Saves the account's protection choices; every surface hears of it. */
export function setProtectionChoices(account: string, choices: ProtectionChoices): Promise<void> {
  return preferences.setProtection(account, choices);
}

export function send(request: AppRequest): Promise<unknown> {
  return chrome.runtime.sendMessage(request);
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
      () => {
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
        setProblem(error instanceof Error ? error.message : String(error));
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

/** Fetches a photo's preview through the account's Photos tab, as an image address; null when unavailable. */
/** Throws a SourceError saying why when the preview can't be had. */
export async function previewDataUrl(account: string, thumbUrl: string, sizePx: number): Promise<string> {
  const result = (await send({ kind: 'app-run-op', account, op: 'fetchPreview', params: { thumbUrl, sizePx } })) as OpResult;
  if (!result.ok) {
    const { kind, message, httpStatus, rpcCode } = result.error;
    throw new SourceError(kind, message, httpStatus ?? null, rpcCode ?? null);
  }
  const { contentType, base64 } = result.data as { contentType: string; base64: string };
  return `data:${contentType};base64,${base64}`;
}

/** All saved jobs (every account), kept up to date. */
export function useAllJobs(): Job[] {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => void store.all().then(
      (all) => alive && setJobs(all),
      () => {
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
