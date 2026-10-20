// Single-attempt batchexecute transport. Retries, backoff and pacing are the
// caller's job (the scan, the analysis, the trash queue); this layer reports exactly what went wrong.
//
// Request encoding follows GPTK src/api/api.ts:43-112 (makeApiRequest) at the
// pinned revision in vendor/gptk/UPSTREAM.md.

import type { OpError } from '../shared/protocol';
import { scrubbed } from '../shared/scrub';
import { skeleton } from './skeleton';

export interface SessionTokens {
  at: string;
  fSid: string;
  bl: string;
  path: string;
  account: string;
}

/** What else a failure knows, for its diagnostic (see ops.ts): it never leaves the page as it is. */
export interface FailureDetails {
  /** Where in the answer the reading gave up (see AnswerDiagnostic.at). */
  at?: (number | string)[];
  /** The reading's own error, already scrubbed. */
  cause?: string;
  /** What the answer's envelope held, when it didn't fit (see [envelopeSummary]). */
  envelope?: string[];
}

export class OpFailure extends Error {
  constructor(readonly error: OpError, readonly details: FailureDetails = {}) {
    super(error.message);
  }
}

/** The tags the entries of a batchexecute answer start with, as seen in real answers. */
const ENVELOPE_TAGS = ['wrb.fr', 'di', 'af.httprm', 'e', 'er'];
const MAX_ENVELOPE_LINES = 20;

/**
 * What an answer's envelope held, without its values: its size, then one line per entry with its
 * tag, whether it is about [rpcid], and its structure ('wrb.fr Z5xsfc ["id:6","id:6","s:1234",…]').
 */
export function envelopeSummary(rpcid: string, body: string): string[] {
  const lines = body.split('\n');
  const out = [`${lines.length} lines, ${body.length} characters`];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // the )]}' prefix and blank lines
    }
    if (!Array.isArray(parsed)) continue; // the length lines between entries
    for (const entry of parsed) {
      const tag = Array.isArray(entry) && typeof entry[0] === 'string' && ENVELOPE_TAGS.includes(entry[0]) ? entry[0] : 'other';
      const about = Array.isArray(entry) && entry[1] === rpcid ? ` ${rpcid}` : '';
      out.push(`${tag}${about} ${JSON.stringify(skeleton(entry))}`);
    }
  }
  return out.length > MAX_ENVELOPE_LINES ? [...out.slice(0, MAX_ENVELOPE_LINES), `…+${out.length - MAX_ENVELOPE_LINES} more`] : out;
}

interface WizGlobalData {
  SNlM0e?: unknown;
  FdrFJe?: unknown;
  cfb2h?: unknown;
  eptZe?: unknown;
  oPEP7c?: unknown;
}

/** Reads the page's session tokens on every call; they never leave the page. */
export function readSessionTokens(wiz: WizGlobalData | undefined): SessionTokens {
  const at = wiz?.SNlM0e;
  const fSid = wiz?.FdrFJe;
  const bl = wiz?.cfb2h;
  const path = wiz?.eptZe;
  const account = wiz?.oPEP7c;
  if (
    typeof at !== 'string' || at === '' ||
    typeof fSid !== 'string' ||
    typeof bl !== 'string' ||
    typeof path !== 'string' ||
    typeof account !== 'string' || account === ''
  ) {
    throw new OpFailure({ kind: 'SESSION', message: 'Google Photos session data not found on the page (signed out or page not loaded)' });
  }
  return { at, fSid, bl, path, account };
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Maps a batchexecute error code (google.rpc.Code numbering, inferred) to a kind. */
export function classifyRpcCode(code: number): OpError['kind'] {
  switch (code) {
    case 16: // UNAUTHENTICATED
    case 7: // PERMISSION_DENIED
      return 'SESSION';
    case 8: // RESOURCE_EXHAUSTED
      return 'RATE_LIMIT';
    case 4: // DEADLINE_EXCEEDED
    case 13: // INTERNAL
    case 14: // UNAVAILABLE
      return 'TRANSIENT';
    default:
      return 'RPC_ERROR';
  }
}

/**
 * Extracts the payload for `rpcid` from a batchexecute response body.
 * Returns the decoded JSON payload, or throws an OpFailure that says why not.
 */
export function decodeEnvelope(rpcid: string, body: string): unknown {
  if (!body) throw new OpFailure({ kind: 'TRANSIENT', message: 'Empty response body' });
  if (/^\s*<!doctype html|^\s*<html/i.test(body)) {
    throw new OpFailure({ kind: 'SESSION', message: 'Received an HTML page instead of RPC data (likely signed out)' });
  }
  const unfit = (message: string, cause?: unknown) => new OpFailure({ kind: 'PROTOCOL', message }, {
    envelope: envelopeSummary(rpcid, body),
    ...(cause instanceof Error ? { cause: scrubbed(cause.message) } : {}),
  });
  for (const line of body.split('\n')) {
    if (!line.includes('wrb.fr')) continue;
    let envelope: unknown;
    try {
      envelope = JSON.parse(line);
    } catch (error) {
      throw unfit('Unparseable wrb.fr line', error);
    }
    if (!Array.isArray(envelope)) throw unfit('wrb.fr line is not an array');
    for (const entry of envelope) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || entry[1] !== rpcid) continue;
      const payload = entry[2];
      if (typeof payload === 'string') {
        try {
          return JSON.parse(payload);
        } catch (error) {
          throw unfit('Unparseable RPC payload', error);
        }
      }
      const status = entry[5];
      const code = Array.isArray(status) && typeof status[0] === 'number' ? status[0] : undefined;
      if (code !== undefined) {
        throw new OpFailure({ kind: classifyRpcCode(code), message: `RPC ${rpcid} returned error code ${code}`, rpcCode: code }, { envelope: envelopeSummary(rpcid, body) });
      }
      throw unfit(`RPC ${rpcid} returned no payload and no error code`);
    }
  }
  throw unfit(`No wrb.fr envelope for ${rpcid}`);
}

export async function callRpc(
  rpcid: string,
  requestData: unknown,
  tokens: SessionTokens,
  sourcePath: string,
  fetcher: Fetcher,
): Promise<unknown> {
  const wrapped = [[[rpcid, JSON.stringify(requestData), null, 'generic']]];
  const body = `f.req=${encodeURIComponent(JSON.stringify(wrapped))}&at=${encodeURIComponent(tokens.at)}&`;
  const query = new URLSearchParams({
    rpcids: rpcid,
    'source-path': sourcePath,
    'f.sid': tokens.fSid,
    bl: tokens.bl,
    pageId: 'none',
    rt: 'c',
  });
  const url = `https://photos.google.com${tokens.path}data/batchexecute?${query.toString()}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      credentials: 'include',
    });
  } catch {
    throw new OpFailure({ kind: 'TRANSIENT', message: `Network error calling ${rpcid}` });
  }

  if (response.redirected && new URL(response.url).hostname === 'accounts.google.com') {
    throw new OpFailure({ kind: 'SESSION', message: 'Redirected to sign-in', httpStatus: response.status });
  }
  if (!response.ok) {
    const status = response.status;
    const kind: OpError['kind'] =
      status === 401 || status === 403 ? 'SESSION'
        : status === 429 ? 'RATE_LIMIT'
          : status >= 500 ? 'TRANSIENT'
            : 'RPC_ERROR';
    throw new OpFailure({ kind, message: `HTTP ${status} from ${rpcid}`, httpStatus: status });
  }
  return decodeEnvelope(rpcid, await readBody(() => response.text(), rpcid));
}

/**
 * The body of a response whose headers already arrived. The connection can still drop while the body
 * comes in (a network blip, the computer going to sleep): that is a network error like a failed
 * fetch, not a changed answer from Google.
 */
export async function readBody<T>(read: () => Promise<T>, what: string): Promise<T> {
  try {
    return await read();
  } catch {
    throw new OpFailure({ kind: 'TRANSIENT', message: `Connection lost while reading the answer to ${what}` });
  }
}
