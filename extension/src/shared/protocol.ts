// Messages exchanged between the layers of the extension.
// The read operations change nothing in Google Photos. The only operations that do are the two
// in WRITE_OPS (move to the trash, restore from it); they are accepted only where a page script and
// relay are installed with writes allowed (Photo Cleaner's own).

export const READ_OPS = [
  'status',
  'listLibraryPage',
  'listFavouritesPage',
  'listArchivePage',
  'listAlbumsPage',
  'listAlbumItemsPage',
  'fetchPreview',
  'listTrashPage',
] as const;

export type ReadOp = (typeof READ_OPS)[number];

export function isReadOp(value: unknown): value is ReadOp {
  return typeof value === 'string' && (READ_OPS as readonly string[]).includes(value);
}

/** The only operations that change the user's Google Photos. Params: `{ account, dedupKeys }`. */
export const WRITE_OPS = ['moveToTrash', 'restoreFromTrash'] as const;

export type WriteOp = (typeof WRITE_OPS)[number];

export function isWriteOp(value: unknown): value is WriteOp {
  return typeof value === 'string' && (WRITE_OPS as readonly string[]).includes(value);
}

export type PageOp = ReadOp | WriteOp;

/** At most this many photos in one trash or restore request. */
export const MAX_TRASH_BATCH = 50;

/** Whether [op] may run where writes are [writesAllowed]. */
export function isAllowedOp(op: unknown, writesAllowed: boolean): op is PageOp {
  return isReadOp(op) || (writesAllowed && isWriteOp(op));
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

/** Page script <-> content script, over window.postMessage, on a channel of the extension's own. */
export interface PageRequest {
  channel: string;
  dir: 'request';
  id: string;
  op: PageOp;
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
  op: PageOp;
  params: Record<string, unknown>;
}
