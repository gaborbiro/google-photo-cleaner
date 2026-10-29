import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { submitToChromeWebStore, tagStoreSubmission } from '../scripts/chromeWebStore.mjs';

const EXTENSION_ID = 'a'.repeat(32);
const ITEM = `https://chromewebstore.googleapis.com/v2/publishers/publisher-1/items/${EXTENSION_ID}`;
const UPLOAD = `https://chromewebstore.googleapis.com/upload/v2/publishers/publisher-1/items/${EXTENSION_ID}:upload`;
const published = (version: string) => ({ publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: version, deployPercentage: 100 }] } });
const submitted = (state: string, version: string) => ({ ...published('0.4.70'), submittedItemRevisionStatus: { state, distributionChannels: [{ crxVersion: version }] } });

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true }); dir = ''; });
function fixture(responses: Array<[number, unknown]>) {
  dir = mkdtempSync(join(tmpdir(), 'photo-cleaner-cws-'));
  const assetPath = join(dir, 'photo-cleaner-0.4.73.zip');
  writeFileSync(assetPath, Buffer.from('synthetic archive'));
  const fetcher = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected API call');
    return new Response(JSON.stringify(response[1]), { status: response[0] });
  });
  const wait = vi.fn(async () => {});
  const options = { publisherId: 'publisher-1', extensionId: EXTENSION_ID, version: '0.4.73', assetPath, accessToken: 'synthetic-token', fetcher, wait };
  return { options, fetcher, wait, calls: () => fetcher.mock.calls as unknown as Array<[string, RequestInit]> };
}

it('checks the status, uploads the ZIP, then submits it for review', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, calls } = fixture(responses);
  responses.push([200, published('0.4.70')], [200, { uploadState: 'SUCCEEDED', crxVersion: '0.4.73' }],
    [200, { state: 'PENDING_REVIEW', warningInfo: { warnings: [{ reason: 'R', description: 'Synthetic warning' }] } }]);
  expect(await submitToChromeWebStore(options)).toEqual({ state: 'PENDING_REVIEW', warnings: ['Synthetic warning'], alreadySubmitted: false });
  expect(calls().map(([url, init]) => [init.method, url])).toEqual([['GET', `${ITEM}:fetchStatus`], ['POST', UPLOAD], ['POST', `${ITEM}:publish`]]);
  expect((calls()[1][1].headers as Record<string, string>).Authorization).toBe('Bearer synthetic-token');
  expect(JSON.parse(calls()[2][1].body as string)).toEqual({ publishType: 'DEFAULT_PUBLISH' });
});

it('can ask the store to hold the version after approval', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, calls } = fixture(responses);
  responses.push([200, {}], [200, { uploadState: 'SUCCEEDED', crxVersion: '0.4.73' }], [200, { state: 'PENDING_REVIEW' }]);
  await submitToChromeWebStore({ ...options, publishType: 'STAGED_PUBLISH' });
  expect(JSON.parse(calls()[2][1].body as string)).toEqual({ publishType: 'STAGED_PUBLISH' });
});

it('waits for an upload the store is still processing before submitting', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, wait, calls } = fixture(responses);
  responses.push([200, {}], [200, { uploadState: 'IN_PROGRESS' }], [200, { lastAsyncUploadState: 'IN_PROGRESS' }],
    [200, { lastAsyncUploadState: 'SUCCEEDED' }], [200, { state: 'PENDING_REVIEW' }]);
  await submitToChromeWebStore(options);
  expect(wait).toHaveBeenCalledTimes(2);
  expect(calls().at(-1)![0]).toBe(`${ITEM}:publish`);
});

it('never submits for review when the upload fails or carries another version', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, fetcher } = fixture(responses);
  responses.push([200, {}], [200, { uploadState: 'FAILED' }]);
  await expect(submitToChromeWebStore(options)).rejects.toThrow('nothing was submitted for review');
  responses.push([200, {}], [200, { uploadState: 'SUCCEEDED', crxVersion: '0.4.72' }]);
  await expect(submitToChromeWebStore(options)).rejects.toThrow('expected 0.4.73');
  responses.push([200, {}], [400, { error: { message: 'Synthetic store refusal' } }]);
  await expect(submitToChromeWebStore(options)).rejects.toThrow('HTTP 400): Synthetic store refusal');
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it('refuses while another version is in review or staged, and treats a retry of the same version as done', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, fetcher } = fixture(responses);
  responses.push([200, submitted('PENDING_REVIEW', '0.4.72')]);
  await expect(submitToChromeWebStore(options)).rejects.toThrow('Version 0.4.72 is still in review');
  responses.push([200, submitted('STAGED', '0.4.72')]);
  await expect(submitToChromeWebStore(options)).rejects.toThrow('approved and staged');
  responses.push([200, submitted('PENDING_REVIEW', '0.4.73')]);
  await expect(submitToChromeWebStore(options)).resolves.toEqual({ state: 'PENDING_REVIEW', warnings: [], alreadySubmitted: true });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('refuses a version that is not newer than the published one, or a taken-down item', async () => {
  const responses: Array<[number, unknown]> = [];
  const { options, fetcher } = fixture(responses);
  responses.push([200, published('0.4.73')]);
  await expect(submitToChromeWebStore(options)).rejects.toThrow('not newer than the published 0.4.73');
  responses.push([200, published('0.5.0')]);
  await expect(submitToChromeWebStore(options)).rejects.toThrow('not newer');
  responses.push([200, { takenDown: true }]);
  await expect(submitToChromeWebStore(options)).rejects.toThrow('taken down');
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('refuses bad settings or a ZIP named for another version before calling the store', async () => {
  const { options, fetcher } = fixture([]);
  await expect(submitToChromeWebStore({ ...options, accessToken: '' })).rejects.toThrow('access token are required');
  await expect(submitToChromeWebStore({ ...options, extensionId: 'not-an-id' })).rejects.toThrow('extension ID');
  await expect(submitToChromeWebStore({ ...options, version: '0.4.74' })).rejects.toThrow('does not match its version');
  await expect(submitToChromeWebStore({ ...options, publishType: 'NOW' as 'DEFAULT_PUBLISH' })).rejects.toThrow('Publish type');
  expect(fetcher).not.toHaveBeenCalled();
});

function tagFixture(responses: Array<[number, unknown]>) {
  const fetcher = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected API call');
    return new Response(JSON.stringify(response[1]), { status: response[0] });
  });
  return { options: { repository: 'owner/repo', version: '0.4.73', token: 'synthetic-token', fetcher }, fetcher, calls: () => fetcher.mock.calls as unknown as Array<[string, RequestInit]> };
}
const COMMIT = 'c'.repeat(40);
const GIT = 'https://api.github.com/repos/owner/repo/git';

it('tags the commit of the submitted release as store-v<version>', async () => {
  const responses: Array<[number, unknown]> = [[200, { object: { type: 'commit', sha: COMMIT } }], [404, {}], [201, {}]];
  const { options, calls } = tagFixture(responses);
  expect(await tagStoreSubmission(options)).toEqual({ tag: 'store-v0.4.73', commit: COMMIT, created: true });
  expect(calls().map(([url, init]) => [init.method, url])).toEqual([['GET', `${GIT}/ref/tags/v0.4.73`], ['GET', `${GIT}/ref/tags/store-v0.4.73`], ['POST', `${GIT}/refs`]]);
  expect(JSON.parse(calls()[2][1].body as string)).toEqual({ ref: 'refs/tags/store-v0.4.73', sha: COMMIT });
});

it('leaves an existing store tag on the same commit alone and refuses one on another commit', async () => {
  const responses: Array<[number, unknown]> = [[200, { object: { type: 'commit', sha: COMMIT } }], [200, { object: { type: 'commit', sha: COMMIT } }]];
  const { options, fetcher } = tagFixture(responses);
  expect(await tagStoreSubmission(options)).toMatchObject({ created: false });
  responses.push([200, { object: { type: 'commit', sha: COMMIT } }], [200, { object: { type: 'commit', sha: 'd'.repeat(40) } }]);
  await expect(tagStoreSubmission(options)).rejects.toThrow('already points to a different commit');
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('refuses to tag without a release commit or settings', async () => {
  const responses: Array<[number, unknown]> = [[404, {}], [200, { object: { type: 'tag', sha: COMMIT } }]];
  const { options, fetcher } = tagFixture(responses);
  await expect(tagStoreSubmission(options)).rejects.toThrow('HTTP 404');
  await expect(tagStoreSubmission(options)).rejects.toThrow('does not point to a commit');
  await expect(tagStoreSubmission({ ...options, token: '' })).rejects.toThrow('GitHub token are required');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
