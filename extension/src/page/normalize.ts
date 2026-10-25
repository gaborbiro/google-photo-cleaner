// Turns raw positional RPC payloads into the page script's wire DTOs.
//
// The vendored GPTK parser supplies keys, timestamps and URLs. Tri-state flags
// (favourite, archived, owned, media type) are read here directly so that a
// missing field becomes `null` (unknown) rather than GPTK's `false`/`undefined`.
// Any page with an item that lacks a stable key fails as a whole: a page that
// cannot be fully understood must never count as enumerated.
//
// Every value a scan depends on is checked against the shapes seen in real
// answers (a capture of a whole scan, October 2026): its type, length and
// characters, and where each listing says it has ended. Anything else is a
// PROTOCOL failure, never read as "nothing" or "the last page": a listing
// silently cut short would leave photos looking unprotected.

import parser from '../../vendor/gptk/src/api/parser';
import type { AlbumItemsPage, AlbumsPage, LibraryGenericPage, LibraryTimelinePage } from '../../vendor/gptk/src/types';
import { scrubbed } from '../shared/scrub';
import { OpFailure } from './rpc';

export type MediaType = 'PHOTO' | 'VIDEO';

export interface LibraryItemDto {
  mediaKey: string;
  dedupKey: string;
  takenAtMs: number;
  uploadedAtMs: number | null;
  mediaType: MediaType | null;
  isFavourite: boolean | null;
  isArchived: boolean | null;
  isOwned: boolean | null;
  uploaderActorId: string | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
}

export interface LibraryPageDto {
  items: LibraryItemDto[];
  nextPageToken: string | null;
  lastItemTakenAtMs: number | null;
}

export interface AlbumDto {
  albumKey: string;
  title: string | null;
  ownerActorId: string | null;
  reportedItemCount: number | null;
  isShared: boolean | null;
  kindCode: number | null;
  authKey: string | null;
}

export interface AlbumsPageDto {
  albums: AlbumDto[];
  nextPageToken: string | null;
}

export interface AlbumMemberDto {
  mediaKey: string;
  dedupKey: string;
  takenAtMs: number;
  mediaType: MediaType | null;
  uploaderActorId: string | null;
}

export interface AlbumItemsPageDto {
  albumKey: string;
  items: AlbumMemberDto[];
  nextPageToken: string | null;
  reportedItemCount: number | null;
  ownerActorId: string | null;
}

const FAVOURITE_EXT = 163238866;
const DURATION_EXT = 76647426;
const ALBUM_EXT = 72930366;
const NOT_OWNED_FLAG = 27;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A path into an answer: list positions and field numbers from the top. */
type Path = (number | string)[];

function protocol(message: string, at?: Path): OpFailure {
  return new OpFailure({ kind: 'PROTOCOL', message }, at === undefined ? {} : { at });
}

/**
 * [read] of the part of the answer at [path]: a failure inside says it happened there, unless it
 * already says where more exactly.
 */
function within<T>(path: Path, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof OpFailure && error.details.at === undefined) throw new OpFailure(error.error, { ...error.details, at: path });
    throw error;
  }
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw protocol(`${what} is not an array`);
  return value;
}

/** A next-page marker: one long string of letters, digits, - and _ (seen: 140 to 354 characters). */
const MARKER = /^[A-Za-z0-9_-]{64,}$/;
/** A photo's own ID: AF1Qip and 37 or 38 more characters (43 only seen inside albums). */
const MEDIA_KEY = /^AF1Qip[A-Za-z0-9_-]{37,38}$/;
/**
 * The ID every copy of a photo shares: usually 27 characters, rarely followed by ":" and 11 to 16
 * more, but other forms come too (18 characters with others among them, on an item from 2012). Any
 * ID without spaces is read; the shared rules never let an item with an unusual one be trashed, and
 * stop all trashing when an album has one that no library item has.
 */
const DEDUP_KEY = /^\S{1,512}$/;
/** An album's ID: AF1Qip and 38 more characters, or 64 more for newer shared albums. */
const ALBUM_KEY = /^AF1Qip(?:[A-Za-z0-9_-]{38}|[A-Za-z0-9_-]{64})$/;

/**
 * How a listing says it has no more pages, as seen in real answers: the album list, the library
 * and the trash leave the marker out (the answer simply ends before it), album contents and
 * favourites send an empty string.
 */
type ListEnd = 'absent' | 'empty-string';

/**
 * The marker at [index], or null when the listing has ended. A page without items can only be
 * the last one; a page with items and anything but a real marker or the listing's own end is
 * refused.
 */
function nextMarker(raw: unknown[], index: number, end: ListEnd, itemCount: number, what: string): string | null {
  const value = raw[index];
  if (typeof value === 'string' && MARKER.test(value)) {
    if (itemCount === 0) throw protocol(`${what}: a page with no items says more follow`, [index]);
    return value;
  }
  const ended = itemCount === 0
    ? value === undefined || value === null || value === ''
    : end === 'absent' ? index >= raw.length : value === '';
  if (ended) return null;
  throw protocol(`${what}: unexpected next-page marker`, [index]);
}

/** Item list at `index`: an array, or nothing at all (absent or null) for a page without items. */
function itemList(raw: unknown[], index: number, what: string): unknown[] {
  const value = raw[index];
  if (value === null || value === undefined) return [];
  return within([index], () => asArray(value, what));
}

/** GPTK's reading of a payload; it assumes the shapes it knows, so anything it trips over is a protocol failure. */
function parse(payload: unknown, rpcid: string): unknown {
  try {
    return parser(payload, rpcid);
  } catch (error) {
    throw new OpFailure({ kind: 'PROTOCOL', message: `${rpcid} answer could not be read` }, error instanceof Error ? { cause: scrubbed(error.message) } : {});
  }
}

/** The item list at `index`, every row checked by [row] before anything reads it. */
function rows(raw: unknown[], index: number, lengths: number[], what: string, endsWithDetails = true): unknown[][] {
  return itemList(raw, index, `${what}s`).map((value, i) => within([index, i], () => row(value, lengths, what, endsWithDetails)));
}

/** A row of a listing: an array whose length is one of [lengths], ending in its details object unless told otherwise. */
function row(value: unknown, lengths: number[], what: string, endsWithDetails = true): unknown[] {
  const raw = asArray(value, what);
  if (!lengths.includes(raw.length)) throw protocol(`${what} has ${raw.length} fields, expected ${lengths.join(' or ')}`);
  if (endsWithDetails && !isPlainObject(raw.at(-1))) throw protocol(`${what} does not end with its details`);
  return raw;
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw protocol(`${what} is not a count`);
  return value;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function requireKey(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== 'string' || value === '') throw protocol(`Item without ${what}`);
  if (!pattern.test(value)) throw protocol(`Item with an unexpected ${what}`);
  return value;
}

function requireTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw protocol('Item without a taken timestamp');
  return value;
}

/** The details object a [row] ends with. */
function detailsOf(checkedRow: unknown[]): Record<string, unknown> {
  return checkedRow.at(-1) as Record<string, unknown>;
}

/**
 * Videos carry their duration in the details; the rest are photos. Video details without a
 * duration (seen on an item from 2012 with a 320×240 placeholder preview) leave the type unknown.
 */
function mediaTypeOf(ext: Record<string, unknown>): MediaType | null {
  const video = ext[DURATION_EXT];
  if (video === undefined) return 'PHOTO';
  return Array.isArray(video) && typeof video[0] === 'number' ? 'VIDEO' : null;
}

function favouriteOf(ext: Record<string, unknown>): boolean | null {
  const field = ext[FAVOURITE_EXT];
  return Array.isArray(field) ? booleanOrNull(field[0]) : null;
}

function ownedOf(rawItem: unknown[]): boolean | null {
  const flags = rawItem[7];
  if (!Array.isArray(flags)) return null;
  return !flags.some((entry) => Array.isArray(entry) && entry.includes(NOT_OWNED_FLAG));
}

function actorOf(rawItem: unknown[]): string | null {
  const actor = rawItem[6];
  return Array.isArray(actor) ? stringOrNull(actor[0]) : null;
}

/** Library and favourites rows: 16 fields, sometimes 17 (one more list before the details). */
const LIBRARY_ROW_LENGTHS = [16, 17];
/**
 * Archive rows (lcxiM asked for the archive only): 10 fields, the short form album entries have,
 * with no archive flag (seen October 2026, in an archive of 20 photos).
 */
const ARCHIVE_ROW_LENGTHS = [10];
/** Album entry rows: 10 fields, sometimes 11 (one more number before the details). */
const ALBUM_ENTRY_ROW_LENGTHS = [10, 11];
/** Album list rows: 9 fields for regular albums, 12 for newer shared ones. */
const ALBUM_ROW_LENGTHS = [9, 12];
/** Trash rows: 15 fields. */
const TRASH_ROW_LENGTHS = [15];

function libraryItem(raw: unknown[], parsed: { mediaKey?: unknown; dedupKey?: unknown; timestamp?: unknown; creationTimestamp?: unknown; resWidth?: unknown; resHeight?: unknown; thumb?: unknown }): LibraryItemDto {
  const ext = detailsOf(raw);
  return {
    mediaKey: requireKey(parsed.mediaKey, MEDIA_KEY, 'mediaKey'),
    dedupKey: requireKey(parsed.dedupKey, DEDUP_KEY, 'dedupKey'),
    takenAtMs: requireTimestamp(parsed.timestamp),
    uploadedAtMs: numberOrNull(parsed.creationTimestamp),
    mediaType: mediaTypeOf(ext),
    isFavourite: favouriteOf(ext),
    isArchived: booleanOrNull(raw[13]),
    isOwned: ownedOf(raw),
    uploaderActorId: actorOf(raw),
    width: numberOrNull(parsed.resWidth),
    height: numberOrNull(parsed.resHeight),
    thumbUrl: stringOrNull(parsed.thumb),
  };
}

/** lcxiM: library by taken date. */
export function normalizeTimelinePage(payload: unknown): LibraryPageDto {
  return timelinePage(payload, LIBRARY_ROW_LENGTHS, 'Library');
}

/** lcxiM asked for the archive only. Its rows carry no archive flag: being listed here is what archived means. */
export function normalizeArchivePage(payload: unknown): LibraryPageDto {
  const page = timelinePage(payload, ARCHIVE_ROW_LENGTHS, 'Archive');
  return { ...page, items: page.items.map((item) => ({ ...item, isArchived: true })) };
}

function timelinePage(payload: unknown, lengths: number[], what: string): LibraryPageDto {
  const raw = asArray(payload, `${what} page`);
  const rawItems = rows(raw, 0, lengths, `${what} item`);
  const parsed = rawItems.length > 0 ? (parse(payload, 'lcxiM') as LibraryTimelinePage | null) : null;
  const parsedItems = parsed?.items ?? [];
  if (parsedItems.length !== rawItems.length) throw protocol('Parser item count differs from raw item count', [0]);
  return {
    items: rawItems.map((rawItem, i) => within([0, i], () => libraryItem(rawItem, parsedItems[i]))),
    // The last page is just [items]; an empty listing (an empty archive) is [].
    nextPageToken: nextMarker(raw, 1, 'absent', rawItems.length, `${what} page`),
    lastItemTakenAtMs: numberOrNull(typeof raw[2] === 'string' ? Number(raw[2]) : raw[2]),
  };
}

/** EzkLib: generic library listing (favourites, upload date). */
export function normalizeGenericPage(payload: unknown): LibraryPageDto {
  const raw = asArray(payload, 'Library page');
  const rawItems = rows(raw, 0, LIBRARY_ROW_LENGTHS, 'Library item');
  const parsed = rawItems.length > 0 ? (parse(payload, 'EzkLib') as LibraryGenericPage | null) : null;
  const parsedItems = parsed?.items ?? [];
  if (parsedItems.length !== rawItems.length) throw protocol('Parser item count differs from raw item count', [0]);
  return {
    items: rawItems.map((rawItem, i) => within([0, i], () => libraryItem(rawItem, parsedItems[i]))),
    // Its last page ends with "" (seen on favourites, and on 42 pages of "Recently added", the same
    // request, whose markers had the usual form and whose last page was [null, ""], with no items).
    nextPageToken: nextMarker(raw, 1, 'empty-string', rawItems.length, 'Library page'),
    lastItemTakenAtMs: null,
  };
}

/** Z5xsfc: album list. */
export function normalizeAlbumsPage(payload: unknown): AlbumsPageDto {
  const raw = asArray(payload, 'Albums page');
  const rawAlbums = rows(raw, 0, ALBUM_ROW_LENGTHS, 'Album');
  const parsed = rawAlbums.length > 0 ? (parse(payload, 'Z5xsfc') as AlbumsPage | null) : null;
  const parsedAlbums = parsed?.items ?? [];
  if (parsedAlbums.length !== rawAlbums.length) throw protocol('Parser album count differs from raw album count', [0]);
  return {
    albums: rawAlbums.map((rawAlbum, i) => within([0, i], () => {
      const metaPath = [0, i, rawAlbum.length - 1, String(ALBUM_EXT)];
      const meta = within(metaPath, () => asArray(detailsOf(rawAlbum)[ALBUM_EXT], 'Album details'));
      const album = parsedAlbums[i];
      return {
        albumKey: within([0, i, 0], () => requireKey(album.mediaKey, ALBUM_KEY, 'album key')),
        title: stringOrNull(meta[1]),
        ownerActorId: stringOrNull(album.ownerActorId),
        reportedItemCount: within([...metaPath, 3], () => count(meta[3], 'Album item count')),
        isShared: booleanOrNull(meta[4]),
        kindCode: numberOrNull(meta[0]),
        authKey: stringOrNull(meta[5]),
      };
    })),
    // The last page is just [albums].
    nextPageToken: nextMarker(raw, 1, 'absent', rawAlbums.length, 'Albums page'),
  };
}

/** snAcKc: album contents. */
export function normalizeAlbumItemsPage(payload: unknown): AlbumItemsPageDto {
  const raw = asArray(payload, 'Album page');
  const rawItems = rows(raw, 1, ALBUM_ENTRY_ROW_LENGTHS, 'Album item');
  const details = within([3], () => asArray(raw[3], 'Album page details'));
  const itemCount = within([3, 21], () => count(details[21], 'Album page item count'));
  // Only an empty album sends no list of entries.
  if (rawItems.length === 0 && itemCount !== 0) throw protocol('Album page without entries for an album that has some', [1]);
  const parsed = parse(payload, 'snAcKc') as AlbumItemsPage | null;
  const parsedItems = parsed?.items ?? [];
  if (parsedItems.length !== rawItems.length) throw protocol('Parser item count differs from raw item count', [1]);
  return {
    albumKey: within([3, 0], () => requireKey(details[0], ALBUM_KEY, 'album key')),
    items: rawItems.map((rawArray, i) => within([1, i], () => {
      const item = parsedItems[i];
      return {
        mediaKey: requireKey(item.mediaKey, MEDIA_KEY, 'mediaKey'),
        dedupKey: requireKey(item.dedupKey, DEDUP_KEY, 'dedupKey'),
        takenAtMs: requireTimestamp(item.timestamp),
        mediaType: mediaTypeOf(detailsOf(rawArray)),
        uploaderActorId: actorOf(rawArray),
      };
    })),
    // The last page ends with "".
    nextPageToken: nextMarker(raw, 2, 'empty-string', rawItems.length, 'Album page'),
    reportedItemCount: itemCount,
    ownerActorId: stringOrNull(parsed?.owner?.actorId),
  };
}

export interface TrashPageDto {
  /** The dedup keys of the photos in the trash, as the trash and restore requests name them. */
  dedupKeys: string[];
  nextPageToken: string | null;
}

/** zy0IHe: the trash, as GPTK's parser reads it (trashPage: items at 0, next page at 1; trashItemParse: dedup key at 3). */
export function normalizeTrashPage(payload: unknown): TrashPageDto {
  const raw = asArray(payload, 'Trash page');
  // Trash rows have 15 fields and, unlike the others, no details object at the end.
  const items = rows(raw, 0, TRASH_ROW_LENGTHS, 'Trash item', false);
  return {
    dedupKeys: items.map((item, i) => within([0, i, 3], () => requireKey(item[3], DEDUP_KEY, 'dedupKey'))),
    // The last page is just [items] (one real page seen, of a bin with a few photos).
    nextPageToken: nextMarker(raw, 1, 'absent', items.length, 'Trash page'),
  };
}
