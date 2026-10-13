// Turns raw positional RPC payloads into the connector's wire DTOs.
//
// The vendored GPTK parser supplies keys, timestamps and URLs. Tri-state flags
// (favourite, archived, owned, media type) are read here directly so that a
// missing field becomes `null` (unknown) rather than GPTK's `false`/`undefined`.
// Any page with an item that lacks a stable key fails as a whole: a page that
// cannot be fully understood must never count as enumerated.

import parser from '../../vendor/gptk/src/api/parser';
import type { AlbumItemsPage, AlbumsPage, LibraryGenericPage, LibraryTimelinePage } from '../../vendor/gptk/src/types';
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
  albumKey: string | null;
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

function protocol(message: string): OpFailure {
  return new OpFailure({ kind: 'PROTOCOL', message });
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw protocol(`${what} is not an array`);
  return value;
}

/** Item list at `index`; absent means an empty page, anything else non-array is a protocol error. */
function itemList(raw: unknown[], index: number, what: string): unknown[] {
  const value = raw[index];
  if (value === null || value === undefined) return [];
  return asArray(value, what);
}

function tokenOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
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

function requireKey(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw protocol(`Item without ${what}`);
  return value;
}

function requireTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw protocol('Item without a taken timestamp');
  return value;
}

function extensionObject(rawItem: unknown[]): Record<string, unknown> | null {
  const last = rawItem.at(-1);
  return isPlainObject(last) ? last : null;
}

function mediaTypeOf(ext: Record<string, unknown> | null): MediaType | null {
  if (ext === null) return null;
  const duration = ext[DURATION_EXT];
  return Array.isArray(duration) && typeof duration[0] === 'number' ? 'VIDEO' : 'PHOTO';
}

function favouriteOf(ext: Record<string, unknown> | null): boolean | null {
  const field = ext?.[FAVOURITE_EXT];
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

function libraryItem(rawItem: unknown, parsed: { mediaKey?: unknown; dedupKey?: unknown; timestamp?: unknown; creationTimestamp?: unknown; resWidth?: unknown; resHeight?: unknown; thumb?: unknown }): LibraryItemDto {
  const raw = asArray(rawItem, 'Library item');
  const ext = extensionObject(raw);
  return {
    mediaKey: requireKey(parsed.mediaKey, 'mediaKey'),
    dedupKey: requireKey(parsed.dedupKey, 'dedupKey'),
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
  const raw = asArray(payload, 'Library page');
  const rawItems = itemList(raw, 0, 'Library items');
  const parsed = rawItems.length > 0 ? (parser(payload, 'lcxiM') as LibraryTimelinePage | null) : null;
  const parsedItems = parsed?.items ?? [];
  if (parsedItems.length !== rawItems.length) throw protocol('Parser item count differs from raw item count');
  return {
    items: rawItems.map((rawItem, i) => libraryItem(rawItem, parsedItems[i])),
    nextPageToken: tokenOrNull(raw[1]),
    lastItemTakenAtMs: numberOrNull(typeof raw[2] === 'string' ? Number(raw[2]) : raw[2]),
  };
}

/** EzkLib: generic library listing (favourites, upload date). */
export function normalizeGenericPage(payload: unknown): LibraryPageDto {
  const raw = asArray(payload, 'Library page');
  const rawItems = itemList(raw, 0, 'Library items');
  const parsed = rawItems.length > 0 ? (parser(payload, 'EzkLib') as LibraryGenericPage | null) : null;
  const parsedItems = parsed?.items ?? [];
  if (parsedItems.length !== rawItems.length) throw protocol('Parser item count differs from raw item count');
  return {
    items: rawItems.map((rawItem, i) => libraryItem(rawItem, parsedItems[i])),
    nextPageToken: tokenOrNull(raw[1]),
    lastItemTakenAtMs: null,
  };
}

/** Z5xsfc: album list. */
export function normalizeAlbumsPage(payload: unknown): AlbumsPageDto {
  const raw = asArray(payload, 'Albums page');
  const rawAlbums = itemList(raw, 0, 'Albums');
  const parsed = rawAlbums.length > 0 ? (parser(payload, 'Z5xsfc') as AlbumsPage | null) : null;
  const parsedAlbums = parsed?.items ?? [];
  if (parsedAlbums.length !== rawAlbums.length) throw protocol('Parser album count differs from raw album count');
  return {
    albums: rawAlbums.map((rawAlbum, i) => {
      const rawArray = asArray(rawAlbum, 'Album');
      const albumExt = extensionObject(rawArray)?.[ALBUM_EXT];
      const meta = Array.isArray(albumExt) ? albumExt : [];
      const album = parsedAlbums[i];
      return {
        albumKey: requireKey(album.mediaKey, 'album key'),
        title: stringOrNull(meta[1]),
        ownerActorId: stringOrNull(album.ownerActorId),
        reportedItemCount: numberOrNull(meta[3]),
        isShared: booleanOrNull(meta[4]),
        kindCode: numberOrNull(meta[0]),
        authKey: stringOrNull(meta[5]),
      };
    }),
    nextPageToken: tokenOrNull(raw[1]),
  };
}

/** snAcKc: album contents. */
export function normalizeAlbumItemsPage(payload: unknown): AlbumItemsPageDto {
  const raw = asArray(payload, 'Album page');
  const rawItems = itemList(raw, 1, 'Album items');
  const parsed = parser(payload, 'snAcKc') as AlbumItemsPage | null;
  const parsedItems = parsed?.items ?? [];
  if (parsedItems.length !== rawItems.length) throw protocol('Parser item count differs from raw item count');
  return {
    albumKey: stringOrNull(parsed?.mediaKey),
    items: rawItems.map((rawItem, i) => {
      const rawArray = asArray(rawItem, 'Album item');
      const item = parsedItems[i];
      return {
        mediaKey: requireKey(item.mediaKey, 'mediaKey'),
        dedupKey: requireKey(item.dedupKey, 'dedupKey'),
        takenAtMs: requireTimestamp(item.timestamp),
        mediaType: mediaTypeOf(extensionObject(rawArray)),
        uploaderActorId: actorOf(rawArray),
      };
    }),
    nextPageToken: tokenOrNull(raw[2]),
    reportedItemCount: numberOrNull(parsed?.itemCount),
    ownerActorId: stringOrNull(parsed?.owner?.actorId),
  };
}
