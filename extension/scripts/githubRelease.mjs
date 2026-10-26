import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Draft → upload → publish. Retry resumes a draft, never replaces a published ZIP. */
export async function publishRelease({ repository, commit, version, assetPath, token, runUrl, fetcher = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(commit ?? '') || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !token) throw new Error('Release repository, commit, version and GitHub token are required.');
  const assetName = `photo-cleaner-${version}.zip`;
  if (basename(assetPath) !== assetName) throw new Error('Release asset name does not match its version.');
  const bytes = readFileSync(assetPath);
  if (!bytes.length) throw new Error('Release ZIP is empty.');
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tag = `v${version}`;
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const request = async (method, url, body, missing = false) => {
    const response = await fetcher.call(globalThis, url, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} failed (HTTP ${response.status}); no release success assumed.`);
    return response.status === 204 ? null : response.json();
  };
  const ref = await request('GET', `${base}/git/ref/tags/${tag}`, undefined, true);
  if (ref && (ref.object?.type !== 'commit' || ref.object.sha !== commit)) throw new Error('Release tag already points to a different source commit.');
  let release = await request('GET', `${base}/releases/tags/${tag}`, undefined, true);
  if (!release) {
    const recent = await request('GET', `${base}/releases?per_page=100`);
    release = recent.find((item) => item.tag_name === tag);
  }
  if (release && release.target_commitish !== commit) throw new Error('Existing release belongs to a different source commit.');
  if (!release) release = await request('POST', `${base}/releases`, {
    tag_name: tag, target_commitish: commit, name: `Photo Cleaner ${version}`, draft: true, prerelease: false,
    body: `Automatic build of ${commit}.\n\n[Checks and build](${runUrl})\n\nDownload ${assetName} below. Chrome Web Store submission remains a separate step.\n\nZIP ${digest}`,
  });
  const asset = release.assets?.find((item) => item.name === assetName);
  const matches = asset?.state === 'uploaded' && asset.size === bytes.length && (!asset.digest || asset.digest === digest);
  if (!release.draft) {
    if (!matches) throw new Error('Published release is missing the expected ZIP or has different contents; refusing to overwrite it.');
    return release.html_url;
  }
  if (!matches) {
    // Remove failed/starter uploads only on our matching, unpublished draft.
    if (asset) await request('DELETE', `${base}/releases/assets/${asset.id}`);
    const upload = new URL(release.upload_url.split('{')[0]);
    if (upload.origin !== 'https://uploads.github.com') throw new Error('Unexpected GitHub asset upload host.');
    upload.searchParams.set('name', assetName);
    const response = await fetcher.call(globalThis, upload.href, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: bytes, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`ZIP upload failed (HTTP ${response.status}); release remains unpublished.`);
    const uploaded = await response.json();
    if (uploaded.state !== 'uploaded' || uploaded.size !== bytes.length || (uploaded.digest && uploaded.digest !== digest)) throw new Error('ZIP upload could not be verified; release remains unpublished.');
  }
  // Let semantic version ordering pick Latest when parallel builds finish out of order.
  return (await request('PATCH', `${base}/releases/${release.id}`, { draft: false, make_latest: 'legacy' })).html_url;
}

if (import.meta.main) {
  try {
    console.log(`Published release: ${await publishRelease({ repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA,
      version: process.env.RELEASE_VERSION, assetPath: process.env.RELEASE_ASSET_PATH, token: process.env.GITHUB_TOKEN,
      runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` })}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
