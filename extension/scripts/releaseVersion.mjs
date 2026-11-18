import { appendFileSync, readFileSync } from 'node:fs';

// A release carries the source manifest's version unchanged, so the version tested in a local build
// is the version released and submitted. (Until 2026-11-18 CI stamped 0.5.0 + its run number
// instead, which collided with the local numbers; releases up to v0.5.12 used that scheme.)

const parse = (version) => {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
  const parts = version.split('.').map(Number);
  return parts.some((part) => part > 65535) ? null : parts;
};
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * The version to release, or null with the reason when there is nothing new to release: the manifest
 * version must be higher than every published release, so a release is never replaced and versions
 * never go backwards (for example after a revert).
 */
export function releaseVersion(source, publishedTags) {
  const parts = parse(source);
  if (!parts) throw new Error('Source manifest version must have three numeric components within Chrome limits.');
  const highest = publishedTags.map((tag) => /^v(.+)$/.exec(tag)?.[1]).map(parse).filter(Boolean)
    .reduce((a, b) => (!a || compare(b, a) > 0 ? b : a), null);
  if (highest && compare(parts, highest) <= 0) {
    return { version: null, reason: `The source manifest version ${source} is not higher than the last release v${highest.join('.')}; no release. Raise the version in extension/static-app/manifest.json to release.` };
  }
  return { version: source, reason: null };
}

export function prepareRelease(path, environment, publishedTags) {
  if (environment.GITHUB_REF !== 'refs/heads/master' || !['push', 'workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME)) throw new Error('Releases may only be prepared for a push or manual run on master.');
  if (!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? '')) throw new Error('A complete source commit is required.');
  const { version, reason } = releaseVersion(JSON.parse(readFileSync(path, 'utf8')).version, publishedTags);
  if (version && environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `version=${version}\n`);
  return { version, reason };
}

if (import.meta.main) {
  const tags = readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean);
  const { version, reason } = prepareRelease('static-app/manifest.json', process.env, tags);
  console.log(version ? `Release version: ${version}` : `::warning title=No release::${reason}`);
}
