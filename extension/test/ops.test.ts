import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewUrl, runOp, type PageEnvironment } from '../src/page/ops';
import { isReadOp, READ_OPS } from '../src/shared/protocol';
import { envelope, rawLibraryItem, timelinePayload } from './fixtures';

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
    const result = await runOp(env(() => envelope('lcxiM', timelinePayload([rawLibraryItem({ favourite: true })], 'n'))), 'listLibraryPage', {});
    expect(result.ok).toBe(true);
    const data = (result as { data: { items: unknown[]; nextPageToken: string; accountFingerprint: string } }).data;
    expect(data.items).toHaveLength(1);
    expect(data.nextPageToken).toBe('n');
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

  it('never sends the account e-mail or session token back', async () => {
    const result = await runOp(env(() => envelope('lcxiM', timelinePayload([rawLibraryItem()], null))), 'listLibraryPage', { includeShape: true });
    const text = JSON.stringify(result);
    expect(text).not.toContain('someone@example.com');
    expect(text).not.toContain('"AT"');
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

describe('read-only guarantee', () => {
  const MUTATING_RPC_IDS = [
    'XwAOJf', 'ycV3Nd', 'LjmOue', 'E1Cajb', 'laUYf', 'OXvT9d', 'QD9nKf', 'Ftfh0',
    'w7TP3c', 'StLnCe', 'Pp2Xxe', 'V8RKJ', 'Es7fke', 'EtUHOe', 'DaSgWe', 'AQNOFd',
  ];

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }

  it('exposes only read operations', () => {
    expect([...READ_OPS].sort()).toEqual(['fetchPreview', 'listAlbumItemsPage', 'listAlbumsPage', 'listArchivePage', 'listFavouritesPage', 'listLibraryPage', 'status']);
    expect(isReadOp('moveItemsToTrash')).toBe(false);
  });

  it('contains no mutating RPC id in sources, vendored code or the built bundle', () => {
    const roots = ['src', 'vendor', 'dist'].filter((dir) => existsSync(dir));
    const offenders = roots.flatMap(files)
      .filter((path) => /\.(ts|js)$/.test(path))
      .flatMap((path) => {
        const text = readFileSync(path, 'utf8');
        return MUTATING_RPC_IDS.filter((id) => text.includes(id)).map((id) => `${path}: ${id}`);
      });
    expect(offenders).toEqual([]);
  });
});
