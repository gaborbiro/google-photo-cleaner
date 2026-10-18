import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewUrl, runOp, type PageEnvironment } from '../src/page/ops';
import { runWriteOp } from '../src/page/trashOps';
import { isAllowedOp, isReadOp, READ_OPS, WRITE_OPS } from '../src/shared/protocol';
import { albumItemsPayload, albumKey, dedupKey, envelope, marker, mediaKey, rawAlbumMember, rawLibraryItem, rawTrashItem, timelinePayload } from './fixtures';

const wiz = { SNlM0e: 'AT', FdrFJe: '1', cfb2h: 'bl', eptZe: '/_/PhotosUi/', oPEP7c: 'someone@example.com' };

function env(body: (url: string, init: RequestInit) => string, overrides: Partial<PageEnvironment> = {}): PageEnvironment {
  return {
    wiz: () => wiz,
    sourcePath: () => '/',
    fetcher: async (url, init) => ({
      ok: true,
      status: 200,
      redirected: false,
      url,
      text: async () => body(url, init),
    }) as Response,
    sha256Hex: async () => 'abcdef0123456789abcdef',
    ...overrides,
  };
}

describe('runOp', () => {
  it('lists a library page with an account fingerprint', async () => {
    const result = await runOp(env(() => envelope('lcxiM', timelinePayload([rawLibraryItem({ favourite: true })], marker()))), 'listLibraryPage', {});
    expect(result.ok).toBe(true);
    const data = (result as { data: { items: unknown[]; nextPageToken: string; accountFingerprint: string } }).data;
    expect(data.items).toHaveLength(1);
    expect(data.nextPageToken).toBe(marker());
    expect(data.accountFingerprint).toBe('abcdef0123456789');
  });

  it('includes a content-free shape sample only when asked', async () => {
    const e = env(() => envelope('lcxiM', timelinePayload([rawLibraryItem()], null)));
    const plain = await runOp(e, 'listLibraryPage', {});
    const shaped = await runOp(e, 'listLibraryPage', { includeShape: true });
    expect(JSON.stringify(plain)).not.toContain('shapeSample');
    const shape = JSON.stringify((shaped as { data: { shapeSample: unknown } }).data.shapeSample);
    expect(shape).not.toContain('AF1Qip');
    expect(shape).not.toContain('photos.fife');
  });

  it('lists the archive with the archive-only source code', async () => {
    let body = '';
    const e = env((_url, init) => {
      body = decodeURIComponent(String(init.body));
      return envelope('lcxiM', timelinePayload([rawLibraryItem({ archived: true })], null));
    });
    const result = await runOp(e, 'listArchivePage', {});
    expect(result.ok).toBe(true);
    expect(body).toContain('[null,null,500,null,1,2]');
  });

  it('an album page must be about the album that was asked for', async () => {
    const asked = albumKey('asked');
    const page = (key: string) => envelope('snAcKc', albumItemsPayload([rawAlbumMember(mediaKey('a'), dedupKey('a'))], null, 1, key));
    expect(await runOp(env(() => page(asked)), 'listAlbumItemsPage', { albumKey: asked })).toMatchObject({ ok: true, data: { albumKey: asked } });
    expect(await runOp(env(() => page(albumKey('other'))), 'listAlbumItemsPage', { albumKey: asked })).toMatchObject({ ok: false, error: { kind: 'PROTOCOL' } });
  });

  it('rejects malformed parameters', async () => {
    const result = await runOp(env(() => ''), 'listAlbumItemsPage', {});
    expect(result).toMatchObject({ ok: false, error: { kind: 'BAD_REQUEST' } });
    const bad = await runOp(env(() => ''), 'listLibraryPage', { takenAtOrBeforeMs: 'yesterday' });
    expect(bad).toMatchObject({ ok: false, error: { kind: 'BAD_REQUEST' } });
  });

  it('reports a signed-out page as a session failure', async () => {
    const result = await runOp(env(() => '', { wiz: () => undefined }), 'listLibraryPage', {});
    expect(result).toMatchObject({ ok: false, error: { kind: 'SESSION' } });
  });

  it('a preview whose download breaks off is a network problem, not a changed answer', async () => {
    const preview = (body: () => Promise<ArrayBuffer>) => env(() => '', {
      fetcher: async (url) => ({ ok: true, status: 200, url, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: body }) as Response,
    });
    const params = { thumbUrl: 'https://lh3.googleusercontent.com/ABC', sizePx: 224 };
    expect(await runOp(preview(async () => Uint8Array.of(1, 2, 3).buffer), 'fetchPreview', params))
      .toEqual({ ok: true, data: { contentType: 'image/jpeg', byteLength: 3, base64: 'AQID' } });
    expect(await runOp(preview(async () => { throw new TypeError('network error'); }), 'fetchPreview', params))
      .toMatchObject({ ok: false, error: { kind: 'TRANSIENT' } });
  });

  it('never sends the account e-mail or session token back', async () => {
    const result = await runOp(env(() => envelope('lcxiM', timelinePayload([rawLibraryItem()], null))), 'listLibraryPage', { includeShape: true });
    const text = JSON.stringify(result);
    expect(text).not.toContain('someone@example.com');
    expect(text).not.toContain('"AT"');
  });
});

describe('the trash requests', () => {
  const ACCOUNT = 'abcdef0123456789'; // what the fake page's account hashes to
  /** A page that records what it sent to Google. */
  function recording(reply = envelope('XwAOJf', [null])) {
    const sent: string[] = [];
    const e = env((url, init) => {
      sent.push(`${url} ${decodeURIComponent(String(init.body))}`);
      return reply;
    });
    return { e, sent };
  }

  it('trash and restore send exactly the named photos', async () => {
    const trash = recording();
    expect(await runWriteOp(trash.e, 'moveToTrash', { account: ACCOUNT, dedupKeys: ['d1', 'd2'] })).toEqual({ ok: true, data: { sent: 2, accountFingerprint: ACCOUNT } });
    expect(trash.sent).toHaveLength(1);
    expect(trash.sent[0]).toContain('rpcids=XwAOJf');
    expect(trash.sent[0]).toContain('[null,1,[\\"d1\\",\\"d2\\"],3]');

    const restore = recording();
    await runWriteOp(restore.e, 'restoreFromTrash', { account: ACCOUNT, dedupKeys: ['d1'] });
    expect(restore.sent[0]).toContain('[null,3,[\\"d1\\"],2]');
  });

  it('nothing is sent for another account, or for photos that are not plainly dedup keys', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ account: 'someone-else', dedupKeys: ['d1'] }, 'NO_PHOTOS_TAB'],
      [{ dedupKeys: ['d1'] }, 'BAD_REQUEST'], // no account named
      [{ account: ACCOUNT, dedupKeys: [] }, 'BAD_REQUEST'],
      [{ account: ACCOUNT, dedupKeys: Array.from({ length: 51 }, (_, i) => `d${i}`) }, 'BAD_REQUEST'],
      [{ account: ACCOUNT, dedupKeys: ['d1', 'd1'] }, 'BAD_REQUEST'],
      [{ account: ACCOUNT, dedupKeys: ['d1 d2'] }, 'BAD_REQUEST'],
      [{ account: ACCOUNT, dedupKeys: [42] }, 'BAD_REQUEST'],
      [{ account: ACCOUNT, dedupKeys: 'd1' }, 'BAD_REQUEST'],
    ];
    for (const [params, kind] of cases) {
      const { e, sent } = recording();
      expect(await runWriteOp(e, 'moveToTrash', params), JSON.stringify(params)).toMatchObject({ ok: false, error: { kind } });
      expect(sent, JSON.stringify(params)).toEqual([]);
    }
  });

  it('the trash is read page by page as dedup keys', async () => {
    const page = [[rawTrashItem(dedupKey('dk1'), mediaKey('1')), rawTrashItem(dedupKey('dk2'), mediaKey('2'))], marker()];
    const result = await runOp(env(() => envelope('zy0IHe', page)), 'listTrashPage', {});
    expect(result).toEqual({ ok: true, data: { dedupKeys: [dedupKey('dk1'), dedupKey('dk2')], nextPageToken: marker(), accountFingerprint: ACCOUNT } });
    const malformed = await runOp(env(() => envelope('zy0IHe', [[rawTrashItem(null as never)]])), 'listTrashPage', {});
    expect(malformed).toMatchObject({ ok: false, error: { kind: 'PROTOCOL' } });
  });
});

describe('previewUrl', () => {
  it('sizes Google image URLs', () => {
    expect(previewUrl('https://photos.fife.usercontent.google.com/pw/ABC', 256)).toBe('https://photos.fife.usercontent.google.com/pw/ABC=w256-h256-k-no');
    expect(previewUrl('https://lh3.googleusercontent.com/ABC=w100-h100', 128)).toBe('https://lh3.googleusercontent.com/ABC=w128-h128-k-no');
  });

  it('refuses any other host, scheme or size', () => {
    expect(() => previewUrl('https://evil.example.com/pw/ABC', 256)).toThrow();
    expect(() => previewUrl('https://googleusercontent.com.evil.example/ABC', 256)).toThrow();
    expect(() => previewUrl('http://lh3.googleusercontent.com/ABC', 256)).toThrow();
    expect(() => previewUrl('https://lh3.googleusercontent.com/ABC', 4096)).toThrow();
  });
});

describe('nothing changes Google Photos but the trash request, and only from Photo Cleaner', () => {
  /** Every mutating request GPTK knows; only the trash one (XwAOJf) may appear, and only where allowed below. */
  const MUTATING_RPC_IDS = [
    'XwAOJf', 'ycV3Nd', 'LjmOue', 'E1Cajb', 'laUYf', 'OXvT9d', 'QD9nKf', 'Ftfh0',
    'w7TP3c', 'StLnCe', 'Pp2Xxe', 'V8RKJ', 'Es7fke', 'EtUHOe', 'DaSgWe', 'AQNOFd',
  ];
  /** The trash request's source, and Photo Cleaner's own page script bundle. */
  const TRASH_ALLOWED_IN = ['src/page/trashOps.ts', 'dist-app/page.js'];

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }
  const sourceFiles = () => ['src', 'vendor', 'dist-app'].filter((dir) => existsSync(dir)).flatMap(files)
    .map((path) => path.replace(/\\/g, '/'))
    .filter((path) => /\.(tsx?|m?js)$/.test(path));

  it('the read operations are exactly these, and the only writes are trash and restore', () => {
    expect([...READ_OPS].sort()).toEqual(['fetchPreview', 'listAlbumItemsPage', 'listAlbumsPage', 'listArchivePage', 'listFavouritesPage', 'listLibraryPage', 'listTrashPage', 'status']);
    expect([...WRITE_OPS].sort()).toEqual(['moveToTrash', 'restoreFromTrash']);
    expect(isReadOp('moveToTrash')).toBe(false);
    // Where writes aren't allowed (a relay installed without them, the default), a write is refused like an unknown operation.
    expect(isAllowedOp('moveToTrash', false)).toBe(false);
    expect(isAllowedOp('moveToTrash', true)).toBe(true);
    expect(isAllowedOp('removeItemsFromAlbum', true)).toBe(false);
  });

  it("no mutating request appears anywhere but the trash one, in the trash module and Photo Cleaner's page bundle", () => {
    const offenders = sourceFiles().flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return MUTATING_RPC_IDS.filter((id) => text.includes(id) && !(id === 'XwAOJf' && TRASH_ALLOWED_IN.includes(path))).map((id) => `${path}: ${id}`);
    });
    expect(offenders).toEqual([]);
  });

  it("only Photo Cleaner's own page script includes the trash module, and only its relay allows writes", () => {
    const importers = sourceFiles().filter((path) => path.startsWith('src/') && /from '[./]+\/(page\/)?trashOps'/.test(readFileSync(path, 'utf8')));
    expect(importers).toEqual(['src/app/page/main.ts']);
    const writeRelays = sourceFiles().filter((path) => path.startsWith('src/') && /installRelay\([^)]*true/.test(readFileSync(path, 'utf8')));
    expect(writeRelays).toEqual(['src/app/content/main.ts']);
    expect(readFileSync('src/app/content/main.ts', 'utf8')).toMatch(/installRelay\(APP_PAGE_CHANNEL, true\)/);
  });
});
