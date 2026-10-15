// What the user reads when Google Photos answers in a way Photo Cleaner can't use. Photo Cleaner
// talks to Google Photos the way Google's own web page does, through requests Google doesn't
// document and can change at any time. When an answer doesn't fit, everything stops before anything
// is changed and says so plainly; the technical details go to the log (and later to error reports).

import type { ErrorKind } from '../../shared/protocol';

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

/** The details behind an INCOMPATIBLE_TEXT or refusedText, for whoever fixes it. Never photo data. */
export function logGoogleProblem(where: string, error: { kind: ErrorKind; message: string; rpcCode?: number | null; httpStatus?: number | null }): void {
  console.warn(`Photo Cleaner: unexpected answer from Google Photos (${where})`, {
    kind: error.kind,
    message: error.message,
    rpcCode: error.rpcCode ?? null,
    httpStatus: error.httpStatus ?? null,
  });
}
