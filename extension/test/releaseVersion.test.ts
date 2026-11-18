import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareRelease, releaseVersion } from '../scripts/releaseVersion.mjs';

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true }); dir = ''; });

it('releases the source manifest version itself, the one a local build shows', () => {
  expect(releaseVersion('0.5.18', ['v0.5.12', 'v0.5.11', 'v0.4.64'])).toEqual({ version: '0.5.18', reason: null });
  expect(releaseVersion('0.5.18', [])).toEqual({ version: '0.5.18', reason: null });
  expect(releaseVersion('1.0.0', ['v0.65535.65535'])).toEqual({ version: '1.0.0', reason: null });
});

it('releases nothing unless the version is higher than every published release', () => {
  for (const published of [['v0.5.18'], ['v0.5.19', 'v0.5.12'], ['v0.6.0'], ['v1.0.0']]) {
    const decision = releaseVersion('0.5.18', published);
    expect(decision.version).toBeNull();
    expect(decision.reason).toContain('0.5.18');
  }
  // Numeric, not text, ordering: 0.5.18 is higher than 0.5.9.
  expect(releaseVersion('0.5.18', ['v0.5.9']).version).toBe('0.5.18');
  // Tags that are not releases of a version (store tags, odd names) are ignored.
  expect(releaseVersion('0.5.18', ['store-v0.6.0', 'v0.7', 'nightly']).version).toBe('0.5.18');
});

it('refuses manifest versions Chrome would not accept', () => {
  for (const version of ['0.4', '0.4.1.0', '0.04.1', '0.65536.0', 'anything', undefined]) expect(() => releaseVersion(version as string, [])).toThrow();
});

it('only prepares a release for master, never changes the manifest, and writes the version only when releasing', () => {
  dir = mkdtempSync(join(tmpdir(), 'photo-cleaner-release-'));
  const manifest = join(dir, 'manifest.json'), output = join(dir, 'output');
  const original = JSON.stringify({ name: 'Photo Cleaner', version: '0.5.18', permissions: ['sidePanel'] });
  writeFileSync(manifest, original);
  const environment = { GITHUB_REF: 'refs/heads/master', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'a'.repeat(40), GITHUB_OUTPUT: output };
  for (const override of [{ GITHUB_REF: 'refs/pull/42/merge' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_SHA: 'master' }]) {
    expect(() => prepareRelease(manifest, { ...environment, ...override }, [])).toThrow();
  }
  expect(prepareRelease(manifest, environment, ['v0.5.18']).version).toBeNull();
  expect(existsSync(output)).toBe(false);
  expect(prepareRelease(manifest, environment, ['v0.5.12'])).toEqual({ version: '0.5.18', reason: null });
  expect(readFileSync(output, 'utf8')).toBe('version=0.5.18\n');
  expect(readFileSync(manifest, 'utf8')).toBe(original);
});
