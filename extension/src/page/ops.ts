// Read-only operation dispatcher. Request shapes follow GPTK src/api/api.ts at the pinned revision
// (line numbers in comments). No mutating RPC is reachable from here: the trash operations live in
// trashOps.ts, which only Photo Cleaner's own page script includes.

import type { AnswerDiagnostic, OpError, OpResult, ReadOp } from '../shared/protocol';
import { scrubbed } from '../shared/scrub';
import {
  normalizeAlbumItemsPage,
  normalizeAlbumsPage,
  normalizeArchivePage,
  normalizeGenericPage,
  normalizeTimelinePage,
  normalizeTrashPage,
} from './normalize';
import { callRpc, OpFailure, readBody, readSessionTokens, type Fetcher, type SessionTokens } from './rpc';
import { ANSWER_LIMITS, FOCUS_LIMITS, partAt, skeleton } from './skeleton';

export interface PageEnvironment {
  wiz: () => Parameters<typeof readSessionTokens>[0];
  sourcePath: () => string;
  fetcher: Fetcher;
  sha256Hex: (text: string) => Promise<string>;
}

/** Library timeline page size, as GPTK uses (api.ts:118). */
const TIMELINE_PAGE_SIZE = 500;
/** lcxiM source codes (api.ts:122-124): 2 = archive only, 3 = library and archive together. */
const TIMELINE_SOURCE_ARCHIVE = 2;
const TIMELINE_SOURCE_ALL = 3;

const PREVIEW_HOSTS = ['photos.fife.usercontent.google.com'];
const PREVIEW_HOST_SUFFIXES = ['.googleusercontent.com'];
const MIN_PREVIEW_PX = 32;
const MAX_PREVIEW_PX = 1024;

export function badRequest(message: string): OpFailure {
  return new OpFailure({ kind: 'BAD_REQUEST', message });
}

function optionalString(params: Record<string, unknown>, name: string): string | null {
  const value = params[name];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value === '') throw badRequest(`${name} must be a non-empty string`);
  return value;
}

export function requiredString(params: Record<string, unknown>, name: string): string {
  const value = optionalString(params, name);
  if (value === null) throw badRequest(`${name} is required`);
  return value;
}

function optionalInteger(params: Record<string, unknown>, name: string): number | null {
  const value = params[name];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw badRequest(`${name} must be an integer`);
  return value;
}

export async function accountFingerprint(env: PageEnvironment, tokens: SessionTokens): Promise<string> {
  return (await env.sha256Hex(tokens.account.trim().toLowerCase())).slice(0, 16);
}

function withShape(params: Record<string, unknown>, payload: unknown, dto: object): object {
  return params['includeShape'] === true ? { ...dto, shapeSample: skeleton(payload) } : dto;
}

export function previewUrl(thumbUrl: string, sizePx: number): string {
  let url: URL;
  try {
    url = new URL(thumbUrl);
  } catch {
    throw badRequest('Preview URL is not a URL');
  }
  const host = url.hostname;
  const allowed = url.protocol === 'https:' &&
    (PREVIEW_HOSTS.includes(host) || PREVIEW_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)));
  if (!allowed) throw badRequest('Preview URL host is not an allowed Google Photos image host');
  if (sizePx < MIN_PREVIEW_PX || sizePx > MAX_PREVIEW_PX) throw badRequest('Preview size out of range');
  const base = url.pathname.includes('=') ? url.pathname.slice(0, url.pathname.lastIndexOf('=')) : url.pathname;
  return `${url.origin}${base}=w${sizePx}-h${sizePx}-k-no`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function fetchPreview(env: PageEnvironment, params: Record<string, unknown>): Promise<object> {
  const url = previewUrl(requiredString(params, 'thumbUrl'), optionalInteger(params, 'sizePx') ?? 256);
  let response: Response;
  try {
    response = await env.fetcher(url, { method: 'GET', credentials: 'include' });
  } catch {
    throw new OpFailure({ kind: 'TRANSIENT', message: 'Network error fetching preview' });
  }
  if (!response.ok) {
    const status = response.status;
    const kind = status === 429 ? 'RATE_LIMIT' : status >= 500 ? 'TRANSIENT' : 'PREVIEW_UNAVAILABLE';
    throw new OpFailure({ kind, message: `HTTP ${status} fetching preview`, httpStatus: status });
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new OpFailure({ kind: 'PREVIEW_UNAVAILABLE', message: 'Preview response is not an image' });
  }
  const bytes = new Uint8Array(await readBody(() => response.arrayBuffer(), 'a preview'));
  return { contentType, byteLength: bytes.length, base64: toBase64(bytes) };
}

/**
 * A failed request to Google ([rpcId]) with its diagnostic: the answer's structure and where the
 * reading gave up, made here because only the page script sees the answer. Never its values.
 */
function diagnosed(error: unknown, rpcId: string, payload: unknown): OpFailure {
  const failure = error instanceof OpFailure ? error
    : new OpFailure({ kind: 'PROTOCOL', message: `${rpcId} answer could not be read` }, error instanceof Error ? { cause: scrubbed(error.message) } : {});
  const { at, cause, envelope } = failure.details;
  const diagnostic: AnswerDiagnostic = {
    rpcId,
    at: at ?? null,
    answer: payload === undefined ? null : skeleton(payload, ANSWER_LIMITS),
    focus: payload === undefined || at === undefined ? null : skeleton(partAt(payload, at), FOCUS_LIMITS),
    envelope: envelope ?? null,
    cause: cause ?? null,
  };
  return new OpFailure({ ...failure.error, diagnostic }, failure.details);
}

async function dispatch(env: PageEnvironment, op: ReadOp, params: Record<string, unknown>): Promise<object> {
  if (op === 'fetchPreview') return fetchPreview(env, params);

  const tokens = readSessionTokens(env.wiz());
  const account = await accountFingerprint(env, tokens);
  /** Asks Google, and reads its answer with [normalize]; a failure of either says what was seen. */
  const read = async <T extends object>(rpcId: string, data: unknown, normalize: (payload: unknown) => T): Promise<object> => {
    let payload: unknown;
    try {
      payload = await callRpc(rpcId, data, tokens, env.sourcePath(), env.fetcher);
    } catch (error) {
      throw diagnosed(error, rpcId, undefined);
    }
    let page: T;
    try {
      page = normalize(payload);
    } catch (error) {
      throw diagnosed(error, rpcId, payload);
    }
    return { ...withShape(params, payload, page), accountFingerprint: account };
  };

  switch (op) {
    case 'status':
      return { signedIn: true, accountFingerprint: account };

    case 'listLibraryPage': {
      // api.ts:114-136 getItemsByTakenDate
      const pageToken = optionalString(params, 'pageToken');
      const takenAtOrBeforeMs = optionalInteger(params, 'takenAtOrBeforeMs');
      return read('lcxiM', [pageToken, takenAtOrBeforeMs, TIMELINE_PAGE_SIZE, null, 1, TIMELINE_SOURCE_ALL], normalizeTimelinePage);
    }

    case 'listArchivePage': {
      // api.ts:114-136 getItemsByTakenDate with source 'archive'
      const pageToken = optionalString(params, 'pageToken');
      return read('lcxiM', [pageToken, null, TIMELINE_PAGE_SIZE, null, 1, TIMELINE_SOURCE_ARCHIVE], normalizeArchivePage);
    }

    case 'listFavouritesPage':
      // api.ts:187-201 getFavoriteItems
      return read('EzkLib', ['Favorites', [[5, '8', 0, 9]], optionalString(params, 'pageToken')], normalizeGenericPage);

    case 'listAlbumsPage':
      // api.ts:275-290 getAlbums
      return read('Z5xsfc', [optionalString(params, 'pageToken'), null, null, null, 1, null, null, 100, [2], 5], normalizeAlbumsPage);

    case 'listAlbumItemsPage': {
      // api.ts:292-308 getAlbumPage
      const albumKey = requiredString(params, 'albumKey');
      return read('snAcKc', [albumKey, optionalString(params, 'pageToken'), null, optionalString(params, 'authKey')], (payload) => {
        const page = normalizeAlbumItemsPage(payload);
        if (page.albumKey !== albumKey) throw new OpFailure({ kind: 'PROTOCOL', message: 'Album page is for a different album' }, { at: [3, 0] });
        return page;
      });
    }

    case 'listTrashPage':
      // api.ts getTrashItems
      return read('zy0IHe', [optionalString(params, 'pageToken')], normalizeTrashPage);
  }
}

export async function runOp(env: PageEnvironment, op: ReadOp, params: Record<string, unknown>): Promise<OpResult> {
  try {
    return { ok: true, data: await dispatch(env, op, params) };
  } catch (error) {
    if (error instanceof OpFailure) return { ok: false, error: error.error };
    return { ok: false, error: unexpectedFailure(error) };
  }
}

/** A failure nobody foresaw in the page script (a bug): scrubbed, since its message could quote anything. */
export function unexpectedFailure(error: unknown): OpError {
  return { kind: 'PROTOCOL', message: error instanceof Error ? scrubbed(error.message) : 'Unknown failure' };
}
