import { describe, expect, it } from 'vitest';
import { callRpc, decodeEnvelope, OpFailure, readSessionTokens, type Fetcher } from '../src/page/rpc';
import { envelope, errorEnvelope } from './fixtures';

const tokens = { at: 'AT_TOKEN', fSid: '123', bl: 'boq', path: '/_/PhotosUi/', account: 'someone@example.com' };

function kindOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpFailure) return error.error.kind;
    throw error;
  }
  return 'NO_ERROR';
}

async function kindOfAsync(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OpFailure) return error.error.kind;
    throw error;
  }
  return 'NO_ERROR';
}

function respond(status: number, body: string, extra: Partial<Response> = {}): Fetcher {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    url: 'https://photos.google.com/_/PhotosUi/data/batchexecute',
    text: async () => body,
    ...extra,
  }) as Response;
}

describe('decodeEnvelope', () => {
  it('returns the payload for the requested rpc', () => {
    expect(decodeEnvelope('lcxiM', envelope('lcxiM', [[1, 2], 'tok']))).toEqual([[1, 2], 'tok']);
  });

  it('maps error codes to failure kinds', () => {
    expect(kindOf(() => decodeEnvelope('lcxiM', errorEnvelope('lcxiM', 16)))).toBe('SESSION');
    expect(kindOf(() => decodeEnvelope('lcxiM', errorEnvelope('lcxiM', 8)))).toBe('RATE_LIMIT');
    expect(kindOf(() => decodeEnvelope('lcxiM', errorEnvelope('lcxiM', 14)))).toBe('TRANSIENT');
    expect(kindOf(() => decodeEnvelope('lcxiM', errorEnvelope('lcxiM', 3)))).toBe('RPC_ERROR');
  });

  it('treats an HTML page as a lost session', () => {
    expect(kindOf(() => decodeEnvelope('lcxiM', '<!DOCTYPE html><html>sign in</html>'))).toBe('SESSION');
  });

  it('reports a missing envelope or one for another rpc as a protocol failure', () => {
    expect(kindOf(() => decodeEnvelope('lcxiM', ")]}'\n\n[]"))).toBe('PROTOCOL');
    expect(kindOf(() => decodeEnvelope('lcxiM', envelope('Z5xsfc', [])))).toBe('PROTOCOL');
  });

  it('reports an empty body as transient', () => {
    expect(kindOf(() => decodeEnvelope('lcxiM', ''))).toBe('TRANSIENT');
  });
});

describe('callRpc', () => {
  it('classifies HTTP failures', async () => {
    expect(await kindOfAsync(callRpc('lcxiM', [], tokens, '/', respond(429, '')))).toBe('RATE_LIMIT');
    expect(await kindOfAsync(callRpc('lcxiM', [], tokens, '/', respond(503, '')))).toBe('TRANSIENT');
    expect(await kindOfAsync(callRpc('lcxiM', [], tokens, '/', respond(401, '')))).toBe('SESSION');
    expect(await kindOfAsync(callRpc('lcxiM', [], tokens, '/', respond(400, '')))).toBe('RPC_ERROR');
  });

  it('treats a redirect to sign-in as a lost session', async () => {
    // Valid RPC data prevents the HTML-body fallback from masking a broken redirect check.
    const fetcher = respond(200, envelope('lcxiM', [null, null]), { redirected: true, url: 'https://accounts.google.com/ServiceLogin' });
    expect(await kindOfAsync(callRpc('lcxiM', [], tokens, '/', fetcher))).toBe('SESSION');
  });

  it('treats a network error as transient', async () => {
    const fetcher: Fetcher = async () => { throw new TypeError('Failed to fetch'); };
    expect(await kindOfAsync(callRpc('lcxiM', [], tokens, '/', fetcher))).toBe('TRANSIENT');
  });

  it('posts to the batchexecute endpoint of the signed-in path', async () => {
    let seenUrl = '';
    let seenRequest: RequestInit = {};
    const fetcher: Fetcher = async (url, init) => {
      seenUrl = url;
      seenRequest = init;
      return respond(200, envelope('lcxiM', [null, null]))(url, {});
    };
    await callRpc('lcxiM', [null], tokens, '/photos', fetcher);
    expect(seenUrl.startsWith('https://photos.google.com/_/PhotosUi/data/batchexecute?rpcids=lcxiM')).toBe(true);
    expect(seenRequest).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(seenRequest.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' });
    const form = new URLSearchParams(String(seenRequest.body));
    expect(form.get('at')).toBe('AT_TOKEN');
    expect(JSON.parse(form.get('f.req')!)).toEqual([[['lcxiM', '[null]', null, 'generic']]]);
    const query = new URL(seenUrl).searchParams;
    expect(query.get('source-path')).toBe('/photos');
    expect(query.get('f.sid')).toBe('123');
    expect(query.get('bl')).toBe('boq');
  });
});

describe('readSessionTokens', () => {
  it('reports missing page data as a session problem', () => {
    expect(kindOf(() => readSessionTokens(undefined))).toBe('SESSION');
    expect(kindOf(() => readSessionTokens({ SNlM0e: '', FdrFJe: '1', cfb2h: 'b', eptZe: '/', oPEP7c: 'x' }))).toBe('SESSION');
  });
});
