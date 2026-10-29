import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

// Fixed epoch: reverting an application's source manifest must not reuse a published version.
// Raised from 0.4.54 when build-and-release.yml became build-and-package.yml (2026-10-29), which
// restarted the run counter; the old workflow's releases and the source manifest were still 0.4.x.
export const RELEASE_BASE_VERSION = '0.5.0';

/** Stable across retries; carries at Chrome's version-component limit. No version-bump commits. */
export function releaseVersion(source, runNumber) {
  if (typeof source !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(source)) throw new Error('Source version must have three numeric components.');
  const parts = source.split('.').map(Number);
  if (parts.some((part) => part > 65535)) throw new Error('Source version exceeds Chrome component limits.');
  if (!/^[1-9]\d*$/.test(String(runNumber)) || !Number.isSafeInteger(Number(runNumber))) throw new Error('A positive workflow run number is required.');
  const radix = 65536n;
  let value = (BigInt(parts[0]) * radix + BigInt(parts[1])) * radix + BigInt(parts[2]) + BigInt(runNumber);
  const patch = value % radix;
  value /= radix;
  const minor = value % radix;
  const major = value / radix;
  if (major > 65535n) throw new Error('Release version exceeds Chrome version limits.');
  return `${major}.${minor}.${patch}`;
}

export function prepareRelease(path, environment) {
  if (environment.GITHUB_REF !== 'refs/heads/master' || !['push', 'workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME)) throw new Error('Releases may only be prepared for a push or manual run on master.');
  if (!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? '')) throw new Error('A complete source commit is required.');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const version = releaseVersion(RELEASE_BASE_VERSION, environment.GITHUB_RUN_NUMBER);
  writeFileSync(path, JSON.stringify({ ...manifest, version }, null, 2) + '\n');
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `version=${version}\n`);
  return version;
}

if (import.meta.main) console.log(`Release version: ${prepareRelease('static-app/manifest.json', process.env)}`);
