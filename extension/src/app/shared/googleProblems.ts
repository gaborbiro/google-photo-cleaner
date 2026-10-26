// What the user reads when Google Photos answers in a way Photo Cleaner can't use. Photo Cleaner
// talks to Google Photos the way Google's own web page does, through requests Google doesn't
// document and can change at any time. When an answer doesn't fit, everything stops before anything
// is changed and says so plainly; the technical details go to the console and the problem log
// (problemLog.ts), which the user can copy into a problem report (Copy diagnostics).

import type { ErrorKind, OpError } from '../../shared/protocol';
import { scrubbed } from '../../shared/scrub';
import { SourceError } from '../scan/source';
import { checkedDiagnostic, recordProblem } from './problemLog';
import { emitUsage } from './usageClient';

/**
 * Google's answer didn't have the shape this version expects (PROTOCOL), or a request no longer fits
 * (BAD_REQUEST, e.g. previews moved to an address it doesn't know): Google Photos changed, or this
 * version has a bug. Waiting won't help; an update will.
 */
export function isIncompatible(kind: ErrorKind): boolean {
  return kind === 'PROTOCOL' || kind === 'BAD_REQUEST';
}

export const INCOMPATIBLE_TEXT =
  "Photo Cleaner no longer understands Google Photos' answers; Google may have changed something. " +
  'It stopped to be safe, and nothing in your library was changed. Check for a Photo Cleaner update, then try again.';

/** Google keeps answering with an error code Photo Cleaner doesn't know. */
export function refusedText(what: string, code: number | null): string {
  return `Google Photos keeps refusing to send your ${what}${code === null ? '' : ` (code ${code})`}. ` +
    'Nothing in your library was changed. Try again later; if it keeps happening, check for a Photo Cleaner update.';
}

export const PREVIEWS_STOPPED_TEXT =
  'Google Photos stopped sending photo previews. Nothing in your library was changed. ' +
  'Resume later; if it keeps happening, check for a Photo Cleaner update.';

/** Under a photo whose preview couldn't be loaded. */
export function previewProblemText(kind: ErrorKind | null): string {
  if (kind === 'NO_PHOTOS_TAB') return 'Preview unavailable: open Google Photos';
  if (kind === 'SESSION') return 'Preview unavailable: Google Photos is signed out';
  if (kind !== null && isIncompatible(kind)) return 'Preview unavailable: Photo Cleaner needs an update';
  return 'Preview unavailable';
}

export const NO_PHOTOS_TAB: OpError = { kind: 'NO_PHOTOS_TAB', message: 'Open photos.google.com, signed in to the account being scanned.' };

/**
 * When no Google Photos tab is signed in to the account, why: of the tabs' failed account checks, the
 * one that tells the user most. A changed answer from Google first (waiting won't help), then a
 * signed-out tab, then any other failure; "open Google Photos" only when no tab answered at all.
 */
export function tabProblem(failures: OpError[]): OpError {
  return failures.find((e) => isIncompatible(e.kind)) ?? failures.find((e) => e.kind === 'SESSION') ?? failures[0] ?? NO_PHOTOS_TAB;
}

/**
 * A preview that couldn't be had, in [where]: logs a changed answer from Google (and anything
 * unexpected), and returns what to show for it.
 */
export function previewProblem(where: string, error: unknown): string {
  if (error instanceof SourceError) {
    if (isIncompatible(error.kind)) logGoogleProblem(`${where}: preview`, error);
    return previewProblemText(error.kind);
  }
  console.warn(`Photo Cleaner: a preview failed (${where})`, error);
  return previewProblemText(null);
}

/**
 * The details behind an INCOMPATIBLE_TEXT or refusedText, for whoever fixes it: saved with the job
 * that stopped, so the user can copy them into a support request. Never photo data.
 */
export interface GoogleProblem {
  /** Which request, e.g. "analysis: preview" or "scan: album list". */
  where: string;
  kind: ErrorKind;
  message: string;
  rpcCode: number | null;
  httpStatus: number | null;
}

/**
 * Logs the details of a changed or refused answer from Google, keeps them in the problem log with
 * what the page script saw of the answer (for Copy diagnostics), and returns the short version for
 * saving with the job.
 */
export function logGoogleProblem(where: string, error: SourceError | OpError): GoogleProblem {
  emitUsage({ name: 'feature_failed', params: { feature: where.startsWith('scan') ? 'scan' : where.startsWith('analysis') ? 'analysis' : where.startsWith('Search') ? 'search' : where.startsWith('Duplicates') ? 'duplicates' : 'trash', reason: isIncompatible(error.kind) ? 'google_changed' : error.kind === 'RATE_LIMIT' ? 'rate_limit' : 'unknown' } });
  const problem: GoogleProblem = {
    where,
    kind: error.kind,
    message: scrubbed(error.message),
    rpcCode: error.rpcCode ?? null,
    httpStatus: error.httpStatus ?? null,
  };
  console.warn(`Photo Cleaner: unexpected answer from Google Photos (${where})`, problem);
  const fromSource = error instanceof SourceError;
  recordProblem({
    ...problem,
    request: fromSource ? error.request : null,
    answer: checkedDiagnostic(error.diagnostic),
    stack: null,
  });
  return problem;
}

/** "For support: analysis: preview · PROTOCOL · Item with an unexpected mediaKey · code 3 · HTTP 400". */
export function googleProblemLine(problem: GoogleProblem): string {
  return ['For support: ' + problem.where, problem.kind, problem.message,
    ...(problem.rpcCode !== null ? [`code ${problem.rpcCode}`] : []),
    ...(problem.httpStatus !== null ? [`HTTP ${problem.httpStatus}`] : []),
  ].join(' · ');
}
