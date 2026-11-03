import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { usageConfig } from '../scripts/usageConfig.mjs';
let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true }); });
it('never enables reporting merely because a credentials file exists, and refuses configured builds without valid settings', () => {
  dir = mkdtempSync(join(tmpdir(), 'photo-cleaner-usage-'));
  const file = join(dir, 'config.json');
  expect(usageConfig(false, file)).toBeNull();
  expect(() => usageConfig(true, file)).toThrow('needs usage.config.json');
  writeFileSync(file, JSON.stringify({ measurementId: 'G-TEST123', apiSecret: 'test_secret_only' }));
  expect(usageConfig(false, file)).toBeNull();
  expect(usageConfig(true, file)).toMatchObject({ measurementId: 'G-TEST123', debug: false });
  writeFileSync(file, JSON.stringify({ measurementId: 'G-TEST123', apiSecret: 'test_secret_only', debug: true }));
  expect(() => usageConfig(true, file, true, {}, join(dir, 'missing.properties'))).toThrow('Analytics environment settings');
  writeFileSync(file, JSON.stringify({ measurementId: 'bad', apiSecret: 'private-value-should-not-be-printed' }));
  expect(() => usageConfig(true, file)).toThrow('Invalid usage configuration');
});

it('release builds use only production environment settings and force debug off, ignoring any local test file', () => {
  dir = mkdtempSync(join(tmpdir(), 'photo-cleaner-usage-'));
  const file = join(dir, 'config.json');
  const properties = join(dir, 'local.properties');
  writeFileSync(file, JSON.stringify({ measurementId: 'G-LOCALTEST', apiSecret: 'local_test_secret', debug: true }));
  const environment = { PHOTO_CLEANER_GA4_MEASUREMENT_ID: 'G-RELEASE123', PHOTO_CLEANER_GA4_API_SECRET: 'release_test_secret' };
  writeFileSync(properties, 'PHOTO_CLEANER_GA4_MEASUREMENT_ID=G-LOCAL123\nPHOTO_CLEANER_GA4_API_SECRET=local_release_secret\n');
  expect(usageConfig(true, file, true, environment, properties)).toEqual({ measurementId: 'G-RELEASE123', apiSecret: 'release_test_secret', debug: false });
  expect(usageConfig(false, file, true, environment)).toBeNull();
  expect(() => usageConfig(true, file, true, { PHOTO_CLEANER_GA4_MEASUREMENT_ID: 'G-RELEASE123' }, properties)).toThrow('Actions secret');
  expect(() => usageConfig(true, file, true, { ...environment, PHOTO_CLEANER_GA4_API_SECRET: 'bad secret' })).toThrow('Invalid usage configuration');
});

it('release builds fall back to a git-ignored local properties file outside CI', () => {
  dir = mkdtempSync(join(tmpdir(), 'photo-cleaner-usage-'));
  const file = join(dir, 'config.json');
  const properties = join(dir, 'local.properties');
  writeFileSync(properties, [
    '# Local release settings',
    'PHOTO_CLEANER_GA4_MEASUREMENT_ID = G-LOCAL123',
    'PHOTO_CLEANER_GA4_API_SECRET=local_release_secret',
    '',
  ].join('\n'));
  expect(usageConfig(true, file, true, {}, properties)).toEqual({
    measurementId: 'G-LOCAL123', apiSecret: 'local_release_secret', debug: false,
  });
  expect(() => usageConfig(true, file, true, {}, join(dir, 'missing.properties'))).toThrow('Analytics environment settings');
  writeFileSync(properties, 'PHOTO_CLEANER_GA4_MEASUREMENT_ID=G-LOCAL123\n');
  expect(() => usageConfig(true, file, true, {}, properties)).toThrow('both settings');
  writeFileSync(properties, 'not a property\n');
  expect(() => usageConfig(true, file, true, {}, properties)).toThrow('one name=value property per line');
});
