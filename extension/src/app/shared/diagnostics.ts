// What Copy diagnostics copies: for whoever fixes a problem, what the Scan was doing and what went
// wrong lately (the problem log), as plain text for a problem report. Only counts, steps and the
// structure of Google's answers: never photos, album names or account details.

import { n } from './format';
import type { AnalysisJob, ScanJob } from './job';
import { MAX_PROBLEMS, PROBLEM_MAX_AGE_MS, type ProblemEntry } from './problemLog';

export interface DiagnosticsInput {
  version: string;
  nowMs: number;
  /** The Scan's two jobs for the account shown; null when there is none. */
  scan: ScanJob | null;
  analysis: AnalysisJob | null;
  /** The problem log, newest first. */
  problems: ProblemEntry[];
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
    input.problems.length === 0
      ? `Problems: none in the last ${days} days.`
      : `Problems, newest first (${input.problems.length}; the last ${MAX_PROBLEMS} of ${days} days are kept):`,
    ...input.problems.flatMap((problem, i) => problemLines(problem, i + 1)),
  ].join('\n');
}
