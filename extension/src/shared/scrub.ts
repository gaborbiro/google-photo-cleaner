// Cutting what could identify a photo, an album or an account out of a text before it is kept or
// shown: shared by the page script (which sees Google's answers) and the extension's pages.

/** The extension's own address in a stack trace ("chrome-extension://<id>/"), which says nothing about the user. */
const EXTENSION_ORIGIN = /chrome-extension:\/\/[a-z]{32}\//g;

/**
 * [text] with anything that could be an address, an ID (a photo's, an album's, a token) or an email
 * replaced by "…". The messages are mostly fixed texts, but an unexpected error's own could quote anything.
 */
export function scrubbed(text: string): string {
  return text
    .replace(EXTENSION_ORIGIN, '')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '…')
    .replace(/[^\s@]+@[^\s@]+/g, '…')
    .replace(/[A-Za-z0-9_-]{20,}/g, '…');
}
