// Messages exchanged between the layers of the extension and the desktop app.
// Everything here is read-only by construction: there is no operation that
// changes anything in Google Photos.

export const READ_OPS = [
  'status',
  'listLibraryPage',
  'listFavouritesPage',
  'listArchivePage',
  'listAlbumsPage',
  'listAlbumItemsPage',
  'fetchPreview',
] as const;

export type ReadOp = (typeof READ_OPS)[number];

export function isReadOp(value: unknown): value is ReadOp {
  return typeof value === 'string' && (READ_OPS as readonly string[]).includes(value);
}

export const ERROR_KINDS = [
  'NO_PHOTOS_TAB',
  'SESSION',
  'RATE_LIMIT',
  'TRANSIENT',
  'RPC_ERROR',
  'PROTOCOL',
  'PREVIEW_UNAVAILABLE',
  'BAD_REQUEST',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface OpError {
  kind: ErrorKind;
  message: string;
  httpStatus?: number;
  rpcCode?: number;
}

export type OpResult = { ok: true; data: unknown } | { ok: false; error: OpError };

/** Whether [value] has the shape of an [OpResult] (its data is checked where it is read). */
export function isOpResult(value: unknown): value is OpResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as { ok?: unknown; data?: unknown; error?: { kind?: unknown; message?: unknown } };
  if (r.ok === true) return 'data' in r;
  return r.ok === false && typeof r.error === 'object' && r.error !== null &&
    (ERROR_KINDS as readonly unknown[]).includes(r.error.kind) && typeof r.error.message === 'string';
}

/**
 * Page script <-> content script, over window.postMessage. Each extension that installs
 * a page script uses its own channel, so two of them in one page never answer each other.
 */
export const PAGE_CHANNEL = 'photo-cleaner-connector';

export interface PageRequest {
  channel: string;
  dir: 'request';
  id: string;
  op: ReadOp;
  params: Record<string, unknown>;
}

export interface PageResponse {
  channel: string;
  dir: 'response';
  id: string;
  result: OpResult;
}

/** Service worker <-> content script, over chrome.runtime messaging. */
export interface TabCommand {
  kind: 'pc-command';
  op: ReadOp;
  params: Record<string, unknown>;
}

/** Desktop app <-> service worker, over the loopback WebSocket. */
export type AppToExtension =
  | { t: 'welcome'; appVersion: string }
  | { t: 'cmd'; id: string; op: string; params: Record<string, unknown> };

export type ExtensionToApp =
  | { t: 'hello'; token: string; extensionVersion: string }
  | { t: 'result'; id: string; result: OpResult }
  | { t: 'keepalive' };

export const DEFAULT_PORT = 47613;
