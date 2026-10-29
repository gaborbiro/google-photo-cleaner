import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const API = 'https://chromewebstore.googleapis.com';
const PUBLISH_TYPES = ['DEFAULT_PUBLISH', 'STAGED_PUBLISH'];

function newer(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** Status → upload → publish. Refuses while another version waits for review; a retry of a submitted version is a no-op. */
export async function submitToChromeWebStore({ publisherId, extensionId, version, assetPath, accessToken, publishType = 'DEFAULT_PUBLISH',
  fetcher = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!/^[\w-]+$/.test(publisherId ?? '') || !/^[a-p]{32}$/.test(extensionId ?? '') || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !accessToken) throw new Error('Publisher ID, extension ID, version and access token are required.');
  if (!PUBLISH_TYPES.includes(publishType)) throw new Error(`Publish type must be one of ${PUBLISH_TYPES.join(', ')}.`);
  if (basename(assetPath) !== `photo-cleaner-${version}.zip`) throw new Error('Release ZIP name does not match its version.');
  const bytes = readFileSync(assetPath);
  if (!bytes.length) throw new Error('Release ZIP is empty.');
  const item = `publishers/${publisherId}/items/${extensionId}`;
  const request = async (method, url, body, contentType) => {
    const response = await fetcher.call(globalThis, url, { method, headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': contentType } : {}) },
      ...(body ? { body } : {}), signal: AbortSignal.timeout(120_000) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Chrome Web Store ${method} failed (HTTP ${response.status})${json.error?.message ? `: ${String(json.error.message).slice(0, 300)}` : ''}. Nothing more was submitted.`);
    return json;
  };
  const status = () => request('GET', `${API}/v2/${item}:fetchStatus`);

  const before = await status();
  if (before.takenDown) throw new Error('The item is taken down; see the developer dashboard.');
  const submitted = before.submittedItemRevisionStatus;
  const submittedVersion = submitted?.distributionChannels?.[0]?.crxVersion;
  if (submittedVersion === version && ['PENDING_REVIEW', 'STAGED'].includes(submitted.state)) return { state: submitted.state, warnings: [], alreadySubmitted: true };
  if (['PENDING_REVIEW', 'STAGED'].includes(submitted?.state)) throw new Error(`Version ${submittedVersion ?? '(unknown)'} is ${submitted.state === 'STAGED' ? 'approved and staged' : 'still in review'}. Publish or cancel it in the developer dashboard first.`);
  for (const channel of before.publishedItemRevisionStatus?.distributionChannels ?? []) {
    if (channel.crxVersion && !newer(version, channel.crxVersion)) throw new Error(`Version ${version} is not newer than the published ${channel.crxVersion}.`);
  }

  let upload = await request('POST', `${API}/upload/v2/${item}:upload`, bytes, 'application/zip');
  for (let attempt = 0; upload.uploadState === 'IN_PROGRESS' && attempt < 30; attempt++) {
    await wait(10_000);
    upload = { uploadState: (await status()).lastAsyncUploadState };
  }
  if (upload.uploadState !== 'SUCCEEDED') throw new Error(`Upload did not succeed (${upload.uploadState ?? 'no state'}); nothing was submitted for review.`);
  if (upload.crxVersion && upload.crxVersion !== version) throw new Error(`The store read version ${upload.crxVersion} from the ZIP, expected ${version}; nothing was submitted for review.`);

  const published = await request('POST', `${API}/v2/${item}:publish`, JSON.stringify({ publishType }), 'application/json');
  return { state: published.state, warnings: (published.warningInfo?.warnings ?? []).map((w) => w.description ?? w.reason), alreadySubmitted: false };
}

/** Marks the commit of release v<version> as sent to the store with store-v<version>. A rerun finds it in place. */
export async function tagStoreSubmission({ repository, version, token, fetcher = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !token) throw new Error('Repository, version and GitHub token are required to tag the submission.');
  const base = `https://api.github.com/repos/${repository}/git`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const request = async (method, url, body, missing = false) => {
    const response = await fetcher.call(globalThis, url, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} failed (HTTP ${response.status}) while tagging the submission.`);
    return response.json();
  };
  const release = await request('GET', `${base}/ref/tags/v${version}`);
  if (release.object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(release.object.sha ?? '')) throw new Error(`Release tag v${version} does not point to a commit.`);
  const tag = `store-v${version}`;
  const existing = await request('GET', `${base}/ref/tags/${tag}`, undefined, true);
  if (existing) {
    if (existing.object?.sha !== release.object.sha) throw new Error(`Tag ${tag} already points to a different commit.`);
    return { tag, commit: release.object.sha, created: false };
  }
  await request('POST', `${base}/refs`, { ref: `refs/tags/${tag}`, sha: release.object.sha });
  return { tag, commit: release.object.sha, created: true };
}

if (import.meta.main) {
  try {
    const version = process.env.RELEASE_VERSION;
    const result = await submitToChromeWebStore({ publisherId: process.env.CWS_PUBLISHER_ID, extensionId: process.env.CWS_EXTENSION_ID, version,
      assetPath: process.env.RELEASE_ASSET_PATH, accessToken: process.env.CWS_ACCESS_TOKEN, publishType: process.env.CWS_PUBLISH_TYPE || undefined });
    for (const warning of result.warnings) console.warn(`Store warning: ${warning}`);
    console.log(result.alreadySubmitted ? `Version ${version} was already submitted (${result.state}); nothing to do.` : `Submitted version ${version} to the Chrome Web Store: ${result.state}.`);
    try {
      const tagged = await tagStoreSubmission({ repository: process.env.GITHUB_REPOSITORY, version, token: process.env.GITHUB_TOKEN });
      console.log(`${tagged.created ? 'Tagged' : 'Already tagged'} ${tagged.commit.slice(0, 7)} as ${tagged.tag}.`);
    } catch (error) { throw new Error(`The submission went through, but tagging it failed: ${error.message} Run the workflow again for this version to add the tag.`); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
