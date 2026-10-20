// What Copy diagnostics copies: for whoever fixes a problem, what the Scan was doing and what went
// wrong lately (the problem log), as plain text for a problem report. Only counts, steps and the
// structure of Google's answers: never photos, album names or account details.

import type { ReportView } from '../scan/report';
import { n } from './format';
import type { AnalysisJob, ScanJob } from './job';
import { MAX_PROBLEMS, MAX_RUNS, PROBLEM_MAX_AGE_MS, type ProblemEntry, type RunEntry } from './problemLog';
import type { AnalysisRunStats, ListingStats, ScanRunStats } from './runStats';

export interface DiagnosticsInput {
  version: string;
  nowMs: number;
  /** The Scan's two jobs for the account shown; null when there is none. */
  scan: ScanJob | null;
  analysis: AnalysisJob | null;
  /** The problem log, newest first. */
  problems: ProblemEntry[];
  /** The recent runs' summaries, the latest-started first. */
  runs: RunEntry[];
  /** The protection report of the account's latest scan; null without one (or while it is worked out). */
  report: ReportView | null;
}

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "[0][12]["72930366"]": a path into an answer, as code would write it. */
export function pathText(path: (number | string)[]): string {
  return path.map((step) => (typeof step === 'number' ? `[${step}]` : `["${step}"]`)).join('') || '(the whole answer)';
}

function scanLines(scan: ScanJob | null): string[] {
  if (scan === null) return ['Step 1, read your library: not started'];
  const p = scan.progress;
  const counts = `library ${n(p.libraryEntries)} · favourites ${n(p.favouriteEntries)} · archive ${n(p.archiveEntries)} · albums ${n(p.albumsRead)} of ${n(p.albumsListed)} read, ${n(p.albumsFailed)} could not be read`;
  return [
    `Step 1, read your library: ${scan.status}${p.phase ? ` at ${p.phase}` : ''}${scan.resumeWhenPhotosOpen ? ', waiting for Google Photos' : ''} · ${counts}`,
    ...(p.notice ? [`  ${p.notice}`] : []),
  ];
}

function analysisLines(analysis: AnalysisJob | null): string[] {
  if (analysis === null) return ['Step 2, analyse photos: not started'];
  const p = analysis.progress;
  const counts = `${n(p.analysed)} of ${n(p.photos)} photos analysed · this run ${n(p.newAnalysed)} of ${p.newPhotos === null ? '?' : n(p.newPhotos)} · ${n(p.failed)} could not be fetched`;
  return [
    `Step 2, analyse photos: ${analysis.status}${p.stage ? ` at ${p.stage}` : ''}${analysis.resumeWhenPhotosOpen ? ', waiting for Google Photos' : ''} · ${counts} · detail ${p.detail ?? '?'}${analysis.fullSpeed ? ' · full speed' : ''}`,
    ...(p.notice ? [`  ${p.notice}`] : []),
  ];
}

function problemLines(problem: ProblemEntry, number: number): string[] {
  const codes = [problem.rpcCode !== null ? `code ${problem.rpcCode}` : null, problem.httpStatus !== null ? `HTTP ${problem.httpStatus}` : null].filter((c) => c !== null);
  const lines = [
    `${number}. ${when(problem.atMs)} · version ${problem.version} · ${problem.where}`,
    `   ${problem.kind} · ${problem.message}${codes.length > 0 ? ` · ${codes.join(' · ')}` : ''}`,
  ];
  const a = problem.answer;
  if (problem.request !== null || a !== null) {
    const op = problem.request ? problem.request.op : 'request';
    const sent = problem.request ? ` · sent with ${problem.request.sent.length > 0 ? problem.request.sent.join(', ') : 'nothing'}` : '';
    lines.push(`   Request: ${op}${a ? ` (${a.rpcId})` : ''}${sent}`);
  }
  if (a !== null) {
    if (a.at !== null) lines.push(`   Gave up at: ${pathText(a.at)}`);
    if (a.cause !== null) lines.push(`   Reading failed with: ${a.cause}`);
    if (a.focus !== null) lines.push(`   That part: ${JSON.stringify(a.focus)}`);
    if (a.answer !== null) lines.push(`   Answer: ${JSON.stringify(a.answer)}`);
    if (a.envelope !== null) lines.push('   Envelope:', ...a.envelope.map((line) => `     ${line}`));
  }
  if (problem.stack !== null) lines.push('   In the code:', ...problem.stack.split('\n').map((line) => `     ${line}`));
  return lines;
}

/** "2 h 38 min", "4 min 2 s", "8.1 s", "0 s". */
export function spanText(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${Number(seconds.toFixed(1))} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${Math.round(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function listingLine(label: string, l: ListingStats): string {
  const retries = [
    l.networkRetries > 0 ? `${n(l.networkRetries)} network ${l.networkRetries === 1 ? 'retry' : 'retries'}` : null,
    l.rateLimits > 0 ? `${n(l.rateLimits)} rate ${l.rateLimits === 1 ? 'limit' : 'limits'}` : null,
    l.refusals > 0 ? `${n(l.refusals)} ${l.refusals === 1 ? 'refusal' : 'refusals'}` : null,
  ].filter((r) => r !== null);
  return `   ${label}: ${n(l.pages)} ${l.pages === 1 ? 'page' : 'pages'}, ${spanText(l.requestMs)} in requests (slowest ${spanText(l.slowestMs)}), waited ${spanText(l.waitedMs)}` +
    (retries.length > 0 ? ` · ${retries.join(' · ')}` : '');
}

function scanRunLines(s: ScanRunStats): string[] {
  const listings = Object.entries(s.listings);
  return listings.length === 0 ? ['   No requests yet'] : listings.map(([label, l]) => listingLine(label, l));
}

const onOff = (value: boolean | null) => (value === null ? '?' : value ? 'on' : 'off');

function analysisRunLines(s: AnalysisRunStats, spanMs: number): string[] {
  const rate = spanMs > 0 ? (s.photosDone * 1000) / spanMs : 0;
  return [
    `   ${n(s.photosDone)} photos done of ${n(s.photos)} (${n(s.alreadyAnalysed)} analysed before this run) · ${n(s.previewsFailed)} previews failed · ${rate.toFixed(1)} photos/s over the run`,
    `   Time: AI ${spanText(s.aiMs)} · waiting for previews ${spanText(s.previewMs)} · saving ${spanText(s.saveMs)} · held back by gentle mode ${spanText(s.gentleMs)} · other ${spanText(s.otherMs)}` +
      ` · reading the library ${spanText(s.pagesMs)} · AI model ${spanText(s.modelMs)} (${s.modelCached === null ? 'files ?' : s.modelCached ? 'already on this computer' : 'downloaded'}) · speed check ${spanText(s.speedCheckMs)}`,
    ...(s.rateLimits > 0 ? [`   Google limited previews ${n(s.rateLimits)} ${s.rateLimits === 1 ? 'time' : 'times'}, ${spanText(s.rateLimitWaitMs)} waited`] : []),
    `   Detail ${s.detail ?? '?'}${s.measuredPhotosPerSecond === null ? '' : ` (speed check measured ${s.measuredPhotosPerSecond.toFixed(1)} photos/s)`} · full speed ${onOff(s.fullSpeedNow)} (${onOff(s.fullSpeedAtStart)} at start) · graphics: ${s.graphics ?? 'unknown'}`,
  ];
}

function runLines(run: RunEntry, number: number): string[] {
  const spanMs = run.atMs - run.startedAtMs;
  return [
    `${number}. ${run.stats.stage} · ${when(run.startedAtMs)} to ${when(run.atMs)} (${spanText(spanMs)}) · ${run.outcome} · version ${run.version}`,
    ...(run.stats.stage === 'library read' ? scanRunLines(run.stats) : analysisRunLines(run.stats, spanMs)),
  ];
}

/** The text Copy diagnostics copies. */
export function diagnosticsText(input: DiagnosticsInput): string {
  const days = Math.round(PROBLEM_MAX_AGE_MS / 86_400_000);
  return [
    `Photo Cleaner ${input.version} · diagnostics copied ${when(input.nowMs)}`,
    'Without photos, album names or account details. Answers from Google are described by their structure only: "key:44" is an ID of 44 characters, "s:12" a text of 12, "n" a large number.',
    '',
    'Scan',
    ...scanLines(input.scan),
    ...analysisLines(input.analysis),
    '',
    'Protection',
    ...(input.report === null ? ['No protection report (no finished scan, or still being worked out).'] : [...input.report.copyText.split('\n'), ...input.report.diagnosticLines]),
    '',
    input.problems.length === 0
      ? `Problems: none in the last ${days} days.`
      : `Problems, newest first (${input.problems.length}; the last ${MAX_PROBLEMS} of ${days} days are kept):`,
    ...input.problems.flatMap((problem, i) => problemLines(problem, i + 1)),
    '',
    input.runs.length === 0
      ? `Runs: none in the last ${days} days.`
      : `Recent runs, the latest first (${input.runs.length}; the last ${MAX_RUNS} of ${days} days are kept):`,
    ...input.runs.flatMap((run, i) => runLines(run, i + 1)),
  ].join('\n');
}
