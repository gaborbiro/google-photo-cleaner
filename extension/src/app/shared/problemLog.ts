// What went wrong lately, kept for diagnosing it afterwards: a changed or refused answer from Google,
// or an error nobody foresaw. The background page, where scans run, closes as soon as it has nothing
// to do, and its console with it; this log stays in the browser database (until erased), so the
// user can copy it into a problem report ("Copy diagnostics"). Each entry says where it happened and
// how Google's answer was built, never what it held: no photo or album keys, titles, addresses,
// tokens or account details. Beside the problems it keeps a summary of each recent library read and
// analysis (runStats.ts), so a slow run can be told apart from a fast one afterwards.

import type { AnswerDiagnostic, ErrorKind } from '../../shared/protocol';
import { scrubbed } from '../../shared/scrub';
import { CHANGES_CHANNEL } from './constants';
import { committed, openDatabase, request, STORES } from './db';
import type { RunStats } from './runStats';
import { BUILT_VERSION } from './version';

/** At most this many problems are kept, the newest. */
export const MAX_PROBLEMS = 50;
/** At most this many run summaries are kept, the newest. */
export const MAX_RUNS = 20;
/** Entries older than this are dropped. */
export const PROBLEM_MAX_AGE_MS = 30 * 86_400_000;

/** Which page script operation a problem came from. */
export interface RequestDetails {
  /** E.g. "listAlbumsPage". */
  op: string;
  /** The names of what was sent with it, never the values: "pageToken" says it was a later page. */
  sent: string[];
}

export interface Problem {
  /** Which step: "scan: album list", "analysis: preview", "account check", "analysis: stopped unexpectedly"… */
  where: string;
  /** How it failed; UNEXPECTED for an error in Photo Cleaner itself. */
  kind: ErrorKind | 'UNEXPECTED';
  /** Scrubbed. */
  message: string;
  rpcCode: number | null;
  httpStatus: number | null;
  request: RequestDetails | null;
  /** What the page script saw of Google's answer, checked again here (see [checkedDiagnostic]). */
  answer: AnswerDiagnostic | null;
  /** For an unexpected error: where in Photo Cleaner's code, scrubbed. */
  stack: string | null;
}

export interface ProblemEntry extends Problem {
  id?: number;
  /** Absent in entries saved before run summaries existed. */
  type?: 'problem';
  atMs: number;
  /** The extension's version that met it. */
  version: string;
}

/** How a run ended; "running" while it goes, or when the background page closed before it could say. */
export type RunOutcome = 'running' | 'completed' | 'paused' | 'stopped' | 'failed' | 'not-started' | 'stopped unexpectedly';

/** One library read's or analysis's numbers, saved while it runs and when it ends. */
export interface RunEntry {
  id?: number;
  type: 'run';
  /** The same run's summary is saved over again: its job and when this run of it began. */
  runKey: string;
  version: string;
  startedAtMs: number;
  /** When it was last saved. */
  atMs: number;
  outcome: RunOutcome;
  stats: RunStats;
}

type Entry = ProblemEntry | RunEntry;
const isRun = (e: Entry): e is RunEntry => e.type === 'run';

export interface ProblemSink {
  add(entry: ProblemEntry): Promise<void>;
}

export class IndexedDbProblemLog implements ProblemSink {
  private db: Promise<IDBDatabase> | null = null;
  private changes: BroadcastChannel | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private database(): Promise<IDBDatabase> {
    this.db ??= openDatabase(this.factory, () => (this.db = null)).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  /** Saves [entry], and drops what is too old or beyond the newest [MAX_PROBLEMS]. */
  async add(entry: ProblemEntry): Promise<void> {
    await this.write(entry.atMs, (entries) => entries.add({ ...entry, type: 'problem' }));
  }

  /** Saves [run]'s summary, over the one saved before for the same run; drops what is too old or beyond the newest [MAX_RUNS]. */
  async saveRun(run: RunEntry): Promise<void> {
    await this.write(run.atMs, async (entries) => {
      const before = (await request(entries.getAll() as IDBRequest<Entry[]>)).find((e) => isRun(e) && e.runKey === run.runKey);
      entries.put(before ? { ...run, id: before.id } : run);
    });
  }

  /** One change in one transaction, then the trimming: per kind, the newest kept, none older than 30 days. */
  private async write(nowMs: number, change: (entries: IDBObjectStore) => unknown): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(STORES.problems, 'readwrite');
    const entries = tx.objectStore(STORES.problems);
    await change(entries);
    const all = await request(entries.getAll() as IDBRequest<Entry[]>);
    const trim = (kept: Entry[], max: number) => kept.sort((a, b) => b.id! - a.id!).forEach((e, i) => {
      if (i >= max || e.atMs < nowMs - PROBLEM_MAX_AGE_MS) entries.delete(e.id!);
    });
    trim(all.filter((e) => !isRun(e)), MAX_PROBLEMS);
    trim(all.filter(isRun), MAX_RUNS);
    await committed(tx);
    this.changes ??= new BroadcastChannel(CHANGES_CHANNEL);
    this.changes.postMessage({ kind: 'problems-changed' });
  }

  private async all(nowMs: number): Promise<Entry[]> {
    const db = await this.database();
    const all = await request(db.transaction(STORES.problems, 'readonly').objectStore(STORES.problems).getAll() as IDBRequest<Entry[]>);
    return all.filter((e) => e.atMs >= nowMs - PROBLEM_MAX_AGE_MS).sort((a, b) => b.id! - a.id!);
  }

  /** The problems kept, newest first, without what has grown too old by [nowMs]. */
  async recent(nowMs: number): Promise<ProblemEntry[]> {
    return (await this.all(nowMs)).filter((e): e is ProblemEntry => !isRun(e));
  }

  /** The run summaries kept, the latest-started first. */
  async recentRuns(nowMs: number): Promise<RunEntry[]> {
    return (await this.all(nowMs)).filter(isRun).sort((a, b) => b.startedAtMs - a.startedAtMs);
  }
}

// --- recording, from anywhere in a page ---

let sink: { log: ProblemSink; version: string } | null = null;
const saving = new Set<Promise<void>>();

/**
 * Every page of the extension that can meet a problem keeps them in [log], once, as it starts;
 * [version] is the extension's. Without it (in tests of other things) problems only go to the console.
 */
export function keepProblems(log: ProblemSink, version: string): void {
  sink = { log, version };
}

/**
 * This page of the extension keeps its problems in the browser database (see [keepProblems]). Uses
 * no extension API, so it works in the background page (an offscreen document) too.
 */
export function keepProblemsHere(): void {
  keepProblems(new IndexedDbProblemLog(), BUILT_VERSION);
}

/** Saves [problem] in the background; [problemsSaved] waits for it. */
export function recordProblem(problem: Problem, nowMs = Date.now()): void {
  if (sink === null) return;
  const saved = sink.log.add({ ...problem, atMs: nowMs, version: sink.version })
    .catch((error: unknown) => console.warn('Photo Cleaner: a problem could not be saved for diagnostics', error))
    .finally(() => saving.delete(saved));
  saving.add(saved);
}

/** Resolves once every problem recorded so far is saved (or failed to be): before the background page asks to be closed. */
export async function problemsSaved(): Promise<void> {
  await Promise.all([...saving]);
}

const MAX_STACK_LINES = 8;

/** An error in Photo Cleaner itself, in [where]: its message and where in the code, both scrubbed. */
export function recordUnexpected(where: string, error: unknown, nowMs = Date.now()): void {
  recordUnexpectedReport(where, error instanceof Error ? `${error.name}: ${error.message}` : 'Not an Error', error instanceof Error ? error.stack ?? null : null, nowMs);
}

/**
 * An error in Photo Cleaner itself, as another page reported it ([message], and [stack] as Chrome
 * writes it, starting with the message line): both scrubbed before they are kept.
 */
export function recordUnexpectedReport(where: string, message: string, stack: string | null, nowMs = Date.now()): void {
  const frames = stack === null ? [] : stack.split('\n').slice(1, 1 + MAX_STACK_LINES).map((l) => l.trim()).filter((l) => l !== '');
  recordProblem({
    where,
    kind: 'UNEXPECTED',
    message: scrubbed(message),
    rpcCode: null,
    httpStatus: null,
    request: null,
    answer: null,
    stack: frames.length > 0 ? scrubbed(frames.join('\n')) : null,
  }, nowMs);
}

// --- what a page script reports, checked again before it is kept ---

/** The tokens a structure is made of (see page/skeleton.ts). */
const SHAPE_TOKEN = /^(?:s:\d{1,7}|id:\d{1,7}|key:\d{1,7}|url|n|…|…\+\d{1,7})$/;
const SHAPE_KEY = /^(?:\d{1,12}|k\d{1,4})$/;
const RPC_ID = /^[A-Za-z0-9]{4,12}$/;
const MAX_DEPTH = 14;
const MAX_ITEMS = 65;
const MAX_PATH = 16;
const MAX_ENVELOPE_LINES = 25;
/** A structure longer than this, written out, is left out. */
const MAX_SHAPE_CHARACTERS = 30_000;
const MAX_CAUSE_CHARACTERS = 300;

/**
 * [value] as a structure: only the tokens a page script writes, small whole numbers, booleans and
 * nulls, in lists and in objects keyed by field numbers. Anything else becomes "?", so a mistake in
 * the page script (or a page that isn't Photo Cleaner's) can't put a value into the log.
 */
export function checkedShape(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) < 1000 ? value : '?';
  if (typeof value === 'string') return SHAPE_TOKEN.test(value) ? value : '?';
  if (typeof value !== 'object' || depth >= MAX_DEPTH) return '?';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => checkedShape(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
    if (SHAPE_KEY.test(k)) out[k] = checkedShape(v, depth + 1);
  }
  return out;
}

function boundedShape(value: unknown): unknown {
  const shape = checkedShape(value);
  return JSON.stringify(shape).length > MAX_SHAPE_CHARACTERS ? 'too large to keep' : shape;
}

function checkedPath(value: unknown): (number | string)[] | null {
  if (!Array.isArray(value) || value.length > MAX_PATH) return null;
  const steps = value.filter((s) => (typeof s === 'number' && Number.isInteger(s) && s >= 0) || (typeof s === 'string' && /^\d{1,12}$/.test(s)));
  return steps.length === value.length ? (steps as (number | string)[]) : null;
}

/**
 * An envelope line (see page/rpc.ts envelopeSummary), rebuilt from its parts so only structure is
 * kept: its tag, whether it is about [rpcId], and the structure of the entry.
 */
function checkedEnvelopeLine(line: unknown, rpcId: string): string {
  if (typeof line !== 'string') return '?';
  if (/^\d{1,9} lines, \d{1,12} characters$/.test(line) || /^…\+\d{1,7} more$/.test(line)) return line;
  const tag = /^(wrb\.fr|di|af\.httprm|e|er|other) /.exec(line)?.[1];
  if (tag === undefined) return '?';
  const about = line.startsWith(`${tag} ${rpcId} `) ? ` ${rpcId}` : '';
  let shape: unknown;
  try {
    shape = JSON.parse(line.slice(`${tag}${about} `.length));
  } catch {
    return `${tag}${about} ?`;
  }
  return `${tag}${about} ${JSON.stringify(checkedShape(shape))}`;
}

/** What a page script reported about an answer, kept only as far as it is structure. */
export function checkedDiagnostic(value: unknown): AnswerDiagnostic | null {
  if (typeof value !== 'object' || value === null) return null;
  const d = value as Record<string, unknown>;
  const rpcId = d['rpcId'];
  if (typeof rpcId !== 'string' || !RPC_ID.test(rpcId)) return null;
  const envelope = d['envelope'];
  const cause = d['cause'];
  return {
    rpcId,
    at: checkedPath(d['at']),
    answer: d['answer'] === null || d['answer'] === undefined ? null : boundedShape(d['answer']),
    focus: d['focus'] === null || d['focus'] === undefined ? null : boundedShape(d['focus']),
    envelope: Array.isArray(envelope) ? envelope.slice(0, MAX_ENVELOPE_LINES).map((line) => checkedEnvelopeLine(line, rpcId)) : null,
    cause: typeof cause === 'string' ? scrubbed(cause).slice(0, MAX_CAUSE_CHARACTERS) : null,
  };
}

/** The names a request may be sent with; any other name is shown as "other". */
const PARAM_NAMES = new Set(['pageToken', 'takenAtOrBeforeMs', 'albumKey', 'authKey', 'thumbUrl', 'sizePx', 'includeShape', 'account', 'dedupKeys']);

/** Which operation, and the names (never the values) of what it was sent with. */
export function requestDetails(op: string, params: Record<string, unknown>): RequestDetails {
  return { op, sent: Object.keys(params).map((name) => (PARAM_NAMES.has(name) ? name : 'other')) };
}
