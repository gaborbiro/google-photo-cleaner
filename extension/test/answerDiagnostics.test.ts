// When Google's answer doesn't fit, the page script says where it gave up and how the answer was
// built, so the parser can be fixed later, without anything the answer held: no photo or album
// keys, titles, addresses, tokens or account details.

import { describe, expect, it } from 'vitest';
import { runOp, type PageEnvironment } from '../src/page/ops';
import { envelopeSummary } from '../src/page/rpc';
import { partAt, skeleton, stringShape } from '../src/page/skeleton';
import type { AnswerDiagnostic, OpResult } from '../src/shared/protocol';
import { albumKey, albumsPayload, envelope, errorEnvelope, marker, rawAlbum } from './fixtures';

const EMAIL = 'someone.private@example.com';
const wiz = { SNlM0e: 'AT_SESSION_TOKEN_abcdefghijklmnop', FdrFJe: '1', cfb2h: 'bl', eptZe: '/_/PhotosUi/', oPEP7c: EMAIL };

function env(body: () => string): PageEnvironment {
  return {
    wiz: () => wiz,
    sourcePath: () => '/',
    fetcher: async (url) => ({ ok: true, status: 200, redirected: false, url, text: async () => body() }) as Response,
    sha256Hex: async () => 'abcdef0123456789abcdef',
  };
}

/** What a realistic album list holds that must never leave the page. */
const TITLE = 'Holiday in Rome with Anna';
const AUTH_KEY = 'AFMv8shareAuthKeyForAnAlbumAbc123def456';
const ACTOR = 'ACTOR_1234567890123456789';
const SECRETS = ['AF1Qip', TITLE, 'Rome', 'Anna', AUTH_KEY, ACTOR, 'photos.fife', 'usercontent', marker(), EMAIL, 'AT_SESSION_TOKEN', 'abcdef0123456789'];

const albums = (count: number) => Array.from({ length: count }, (_, i) =>
  rawAlbum({ albumKey: albumKey(`ALBUM${i}`), title: TITLE, authKey: AUTH_KEY, ownerActorId: ACTOR, shared: true }));

function diagnosticOf(result: OpResult): AnswerDiagnostic {
  expect(result.ok).toBe(false);
  const error = (result as { ok: false; error: { diagnostic?: AnswerDiagnostic } }).error;
  expect(error.diagnostic).toBeDefined();
  return error.diagnostic!;
}

function expectNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
}

describe("a diagnostic of Google's answer", () => {
  it('an album row of a new length: which request, which row, its structure, and nothing it held', async () => {
    const rows = albums(5);
    rows[3] = [...rows[3]!.slice(0, -1), null, rows[3]!.at(-1)]; // one field more than Google sent until now
    const result = await runOp(env(() => envelope('Z5xsfc', albumsPayload(rows, marker()))), 'listAlbumsPage', {});
    const d = diagnosticOf(result);
    expect(result).toMatchObject({ ok: false, error: { kind: 'PROTOCOL', message: 'Album has 10 fields, expected 9 or 12' } });
    expect(d.rpcId).toBe('Z5xsfc');
    expect(d.at).toEqual([0, 3]);
    // The row in full: Google's ID (44 characters), the address of its preview, the new null, the details.
    expect(d.focus).toEqual(['key:44', ['url', 'n', 'n', null, null, null, null, null, null, [1]], null, null, null, null, ['id:25'], [[3], [4]], null, {
      '72930366': [1, 's:25', ['n', 'n', null, null, 'n', ['n', 'n'], ['n', 'n'], null, null, 'n'], 12, true, 'id:39', ['n']],
    }]);
    expect((d.answer as unknown[])[1]).toBe('id:140'); // the next-page marker, by length
    expectNoSecrets(result);
  });

  it('a page that says it ended in a new way: the marker position', async () => {
    const result = await runOp(env(() => envelope('Z5xsfc', [albums(2), null, 0])), 'listAlbumsPage', {});
    const d = diagnosticOf(result);
    expect(result).toMatchObject({ ok: false, error: { message: 'Albums page: unexpected next-page marker' } });
    expect(d.at).toEqual([1]);
    expect(d.focus).toBeNull(); // null is the structure of null
    expect(d.answer).toEqual([[expect.any(Array), expect.any(Array)], null, 0]);
    expectNoSecrets(result);
  });

  it("an album's count in a new place: the exact field", async () => {
    const rows = albums(1);
    ((rows[0]!.at(-1) as Record<string, unknown[]>)['72930366']!)[3] = '12';
    const result = await runOp(env(() => envelope('Z5xsfc', albumsPayload(rows, null))), 'listAlbumsPage', {});
    expect(diagnosticOf(result)).toMatchObject({ at: [0, 0, 8, '72930366', 3], focus: 'id:2' });
    expectNoSecrets(result);
  });

  it('an answer that is not a page at all: its structure', async () => {
    const page = await runOp(env(() => envelope('lcxiM', { not: TITLE })), 'listLibraryPage', {});
    expect(diagnosticOf(page)).toEqual({ rpcId: 'lcxiM', at: null, answer: { k1: 's:25' }, focus: null, envelope: null, cause: null });
    expectNoSecrets(page);
  });

  it("an answer that could not be read: the reading's own error, scrubbed", async () => {
    const line = JSON.stringify([['wrb.fr', 'lcxiM', `{${albumKey('broken')}`, null, null, null, 'generic']]);
    const page = await runOp(env(() => `)]}'\n\n${line.length}\n${line}\n`), 'listLibraryPage', {});
    const d = diagnosticOf(page);
    expect(page).toMatchObject({ ok: false, error: { kind: 'PROTOCOL', message: 'Unparseable RPC payload' } });
    expect(d.cause).toMatch(/JSON/);
    expect(d.envelope?.[1]).toBe('wrb.fr lcxiM ["s:6","id:5","s:45",null,null,null,"id:7"]');
    expectNoSecrets(page);
  });

  it('an envelope without the answer: what it held instead, line by line', async () => {
    const result = await runOp(env(() => envelope('lcxiM', [TITLE])), 'listAlbumsPage', {});
    const d = diagnosticOf(result);
    expect(result).toMatchObject({ ok: false, error: { kind: 'PROTOCOL', message: 'No wrb.fr envelope for Z5xsfc' } });
    expect(d.answer).toBeNull();
    expect(d.envelope).toEqual([expect.stringMatching(/^5 lines, \d+ characters$/), 'wrb.fr ["s:6","id:5","s:29",null,null,null,"id:7"]', 'di ["id:2",42]']);
    expectNoSecrets(result);
  });

  it('an error code: which request, and its envelope', async () => {
    const result = await runOp(env(() => errorEnvelope('Z5xsfc', 3)), 'listAlbumsPage', { pageToken: marker() });
    expect(result).toMatchObject({ ok: false, error: { kind: 'RPC_ERROR', rpcCode: 3, diagnostic: { rpcId: 'Z5xsfc', at: null, answer: null } } });
    expect(diagnosticOf(result).envelope?.[1]).toBe('wrb.fr Z5xsfc ["s:6","id:6",null,null,null,[3],"id:7"]');
    expectNoSecrets(result);
  });

  it('a request that never reached Google has none', async () => {
    expect(await runOp(env(() => ''), 'listAlbumItemsPage', {})).toEqual({ ok: false, error: { kind: 'BAD_REQUEST', message: 'albumKey is required' } });
  });
});

describe('the structure of an answer', () => {
  it('strings by kind and length, small codes and booleans kept, everything else a token', () => {
    expect(stringShape('')).toBe('s:0');
    expect(stringShape('https://lh3.googleusercontent.com/pw/ABC')).toBe('url');
    expect(stringShape(albumKey('a'))).toBe('key:44');
    expect(stringShape('Z5xsfc')).toBe('id:6');
    expect(stringShape(TITLE)).toBe('s:25');
    expect(skeleton([1, 999, 1000, -5, 1.5, true, null, { '72930366': [], name: 1, other: 2 }])).toEqual([1, 999, 'n', -5, 'n', true, null, { '72930366': [], k1: 1, k2: 2 }]);
  });

  it('long lists and deep nesting are cut short', () => {
    expect(skeleton(Array.from({ length: 30 }, () => 1))).toEqual([...Array.from({ length: 24 }, () => 1), '…+6']);
    expect(skeleton([[[[[[[[[1]]]]]]]]])).toEqual([[[[[[[['…']]]]]]]]);
  });

  it('finds the part at a path, and nothing past the end', () => {
    expect(partAt([[0, { '5': 'x' }]], [0, 1, '5'])).toBe('x');
    expect(partAt([[0]], [0, 3, 1])).toBeUndefined();
  });

  it("an envelope's summary keeps its tags and structure, never its payload", () => {
    const lines = envelopeSummary('Z5xsfc', envelope('Z5xsfc', [[TITLE]]));
    expect(lines[0]).toMatch(/^5 lines, \d+ characters$/);
    expect(lines[1]).toMatch(/^wrb\.fr Z5xsfc \["s:6","id:6","s:\d+",null,null,null,"id:7"\]$/);
    expect(lines.join('\n')).not.toContain('Holiday');
  });
});
