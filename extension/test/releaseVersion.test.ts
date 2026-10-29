import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RELEASE_BASE_VERSION, prepareRelease, releaseVersion } from '../scripts/releaseVersion.mjs';

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true }); dir = ''; });
it('creates increasing Chrome versions for successive runs and stable versions when a run is retried', () => {
  expect(releaseVersion('0.4.53', '20')).toBe('0.4.73');
  expect(releaseVersion('0.4.53', '21')).toBe('0.4.74');
  expect(releaseVersion('0.4.53', '20')).toBe('0.4.73');
  expect(releaseVersion('0.4.54', '21')).toBe('0.4.75');
  expect(releaseVersion('0.4.65535', 1)).toBe('0.5.0');
  expect(releaseVersion('0.65535.65535', 1)).toBe('1.0.0');
  for (const run of ['0', '-1', '1.5', 'abc', '9007199254740992']) expect(() => releaseVersion('0.4.53', run)).toThrow();
  for (const version of ['0.4', '0.4.1.0', '0.04.1', '0.65536.0', 'anything']) expect(() => releaseVersion(version, 1)).toThrow();
  expect(() => releaseVersion('65535.65535.65535', 1)).toThrow('exceeds Chrome');
});

it('stamps only the runner checkout, preserves manifest fields, and refuses PRs/other branches', () => {
  dir = mkdtempSync(join(tmpdir(), 'photo-cleaner-release-'));
  const manifest = join(dir, 'manifest.json'), output = join(dir, 'output');
  const original = { name: 'Photo Cleaner', version: '0.4.53', permissions: ['sidePanel'] };
  writeFileSync(manifest, JSON.stringify(original));
  const environment = { GITHUB_REF: 'refs/heads/master', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_NUMBER: '20', GITHUB_OUTPUT: output };
  for (const override of [{ GITHUB_REF: 'refs/pull/42/merge' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_SHA: 'master' }]) {
    expect(() => prepareRelease(manifest, { ...environment, ...override })).toThrow();
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual(original);
  }
  expect(prepareRelease(manifest, environment)).toBe('0.5.20');
  expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual({ ...original, version: '0.5.20' });
  expect(readFileSync(output, 'utf8')).toBe('version=0.5.20\n');
  writeFileSync(manifest, JSON.stringify({ ...original, version: '0.1.0' }));
  expect(prepareRelease(manifest, { ...environment, GITHUB_RUN_NUMBER: '21' })).toBe('0.5.21');
});

it('starts the renamed workflow above every version the old one released or the source manifest had', () => {
  // build-and-release.yml released up to v0.4.64 (run counter ~20) and the source manifest was 0.4.68
  // when build-and-package.yml took over with a run counter starting at 1.
  for (const used of ['0.4.64', '0.4.68', releaseVersion('0.4.54', 100)]) {
    const [a, b] = [releaseVersion(RELEASE_BASE_VERSION, 1), used].map((v) => v.split('.').map(Number));
    expect(a[0] * 2 ** 32 + a[1] * 2 ** 16 + a[2]).toBeGreaterThan(b[0] * 2 ** 32 + b[1] * 2 ** 16 + b[2]);
  }
});
