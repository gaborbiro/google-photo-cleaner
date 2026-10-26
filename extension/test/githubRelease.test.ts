import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { publishRelease } from '../scripts/githubRelease.mjs';

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true }); });
function fixture(responses: Array<[number, unknown]>) {
  dir = mkdtempSync(join(tmpdir(), 'photo-cleaner-publish-'));
  const assetPath = join(dir, 'photo-cleaner-0.4.73.zip');
  const bytes = Buffer.from('synthetic archive');
  writeFileSync(assetPath, bytes);
  const fetcher = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected API call');
    return new Response(response[0] === 204 ? null : JSON.stringify(response[1]), { status: response[0] });
  });
  const options = { repository: 'owner/repo', commit: 'a'.repeat(40), version: '0.4.73', assetPath, token: 'synthetic-token', runUrl: 'https://github.com/owner/repo/actions/runs/20', fetcher };
  const asset = { id: 7, name: 'photo-cleaner-0.4.73.zip', state: 'uploaded', size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  const release = { id: 1, target_commitish: options.commit, tag_name: 'v0.4.73', draft: true, assets: [], upload_url: 'https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}', html_url: 'https://github.com/owner/repo/releases/tag/v0.4.73' };
  return { options, asset, release, fetcher };
}

it('publishes only after uploading a verified ZIP, pins the source commit, and lets semantic ordering determine Latest', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, asset, release, fetcher } = fixture(responses);
  responses.push([404, {}], [404, {}], [200, []], [201, release], [201, asset], [200, { ...release, draft: false }]);
  expect(await publishRelease(options)).toBe(release.html_url);
  const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls.map(([, init]) => init.method)).toEqual(['GET', 'GET', 'GET', 'POST', 'POST', 'PATCH']);
  expect(JSON.parse(calls[3][1].body as string)).toMatchObject({ target_commitish: options.commit, tag_name: 'v0.4.73', draft: true });
  expect(calls[4][0]).toBe('https://uploads.github.com/repos/owner/repo/releases/1/assets?name=photo-cleaner-0.4.73.zip');
  expect(JSON.parse(calls[5][1].body as string)).toEqual({ draft: false, make_latest: 'legacy' });
});

it('resumes a matching unpublished draft without creating a second release', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, asset, release, fetcher } = fixture(responses);
  responses.push([404, {}], [404, {}], [200, [{ ...release, assets: [asset] }]], [200, { ...release, draft: false }]);
  await publishRelease(options);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('a failed upload leaves the release unpublished', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, release, fetcher } = fixture(responses);
  responses.push([404, {}], [200, release], [500, {}]);
  await expect(publishRelease(options)).rejects.toThrow('release remains unpublished');
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('does not overwrite a published asset on retry', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, asset, release, fetcher } = fixture(responses);
  responses.push([200, { object: { type: 'commit', sha: options.commit } }], [200, { ...release, draft: false, assets: [asset] }]);
  await expect(publishRelease(options)).resolves.toBe(release.html_url);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('refuses a mismatched tag or release commit and does not forward credentials to an unexpected upload host', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, release, fetcher } = fixture(responses);
  responses.push([200, { object: { type: 'commit', sha: 'b'.repeat(40) } }]);
  await expect(publishRelease(options)).rejects.toThrow('different source commit');
  expect(fetcher).toHaveBeenCalledTimes(1);
  responses.push([404, {}], [200, { ...release, target_commitish: 'b'.repeat(40) }]);
  await expect(publishRelease(options)).rejects.toThrow('different source commit');
  responses.push([404, {}], [200, { ...release, upload_url: 'https://other.example/assets' }]);
  await expect(publishRelease(options)).rejects.toThrow('Unexpected GitHub asset upload host');
});

it('never publishes when GitHub cannot verify the uploaded ZIP', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, asset, release, fetcher } = fixture(responses);
  responses.push([404, {}], [200, release], [201, { ...asset, digest: 'sha256:wrong' }]);
  await expect(publishRelease(options)).rejects.toThrow('could not be verified');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
