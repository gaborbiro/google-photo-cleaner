// Single-attempt batchexecute transport. Retries, backoff and pacing are the
// caller's job (the scan, the analysis, the trash queue); this layer reports exactly what went wrong.
//
// Request encoding follows GPTK src/api/api.ts:43-112 (makeApiRequest) at the
// pinned revision in vendor/gptk/UPSTREAM.md.

import type { OpError } from '../shared/protocol';

export interface SessionTokens {
  at: string;
  fSid: string;
  bl: string;
  path: string;
  account: string;
}

export class OpFailure extends Error {
  constructor(readonly error: OpError) {
    super(error.message);
  }
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
  for (const line of body.split('\n')) {
    if (!line.includes('wrb.fr')) continue;
    let envelope: unknown;
    try {
      envelope = JSON.parse(line);
    } catch {
      throw new OpFailure({ kind: 'PROTOCOL', message: 'Unparseable wrb.fr line' });
    }
    if (!Array.isArray(envelope)) throw new OpFailure({ kind: 'PROTOCOL', message: 'wrb.fr line is not an array' });
    for (const entry of envelope) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || entry[1] !== rpcid) continue;
      const payload = entry[2];
      if (typeof payload === 'string') {
        try {
          return JSON.parse(payload);
        } catch {
          throw new OpFailure({ kind: 'PROTOCOL', message: 'Unparseable RPC payload' });
        }
      }
      const status = entry[5];
      const code = Array.isArray(status) && typeof status[0] === 'number' ? status[0] : undefined;
      if (code !== undefined) {
        throw new OpFailure({ kind: classifyRpcCode(code), message: `RPC ${rpcid} returned error code ${code}`, rpcCode: code });
      }
      throw new OpFailure({ kind: 'PROTOCOL', message: `RPC ${rpcid} returned no payload and no error code` });
    }
  }
  throw new OpFailure({ kind: 'PROTOCOL', message: `No wrb.fr envelope for ${rpcid}` });
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
  return decodeEnvelope(rpcid, await response.text());
}
