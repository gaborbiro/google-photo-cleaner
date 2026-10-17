import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { shipped, storeFiles, storeManifest, zip } from '../scripts/package.mjs';

/** Reads back every file of a zip through its central directory, as an unzipper would. */
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const packedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataStart = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    files.set(name, inflateRawSync(archive.subarray(dataStart, dataStart + packedSize)));
    at += 46 + nameLength;
  }
  return files;
}

describe('the Chrome Web Store package', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('leaves out the manifest key, which the store refuses, and keeps everything else', () => {
    const manifest = { manifest_version: 3, name: 'Photo Cleaner', version: '1.2.3', key: 'MIIB…', permissions: ['idle'] };
    expect(storeManifest(manifest)).toEqual({ manifest_version: 3, name: 'Photo Cleaner', version: '1.2.3', permissions: ['idle'] });
  });

  it('leaves out the developer pages', () => {
    expect(shipped('dev-calibration.html')).toBe(false);
    expect(shipped('dev-calibration.js')).toBe(false);
    expect(shipped('review.html')).toBe(true);
    expect(shipped('ort/ort-wasm-simd-threaded.asyncify.wasm')).toBe(true);
  });

  it('zips the built extension so that it unzips to the same files', () => {
    dir = mkdtempSync(join(tmpdir(), 'photo-cleaner-package-'));
    mkdirSync(join(dir, 'ort'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'Photo Cleaner', version: '1.2.3', key: 'MIIB…' }));
    writeFileSync(join(dir, 'review.js'), 'console.log("review");'.repeat(100));
    writeFileSync(join(dir, 'ort', 'runtime.wasm'), Buffer.from([0, 97, 115, 109, 255, 0, 1]));
    writeFileSync(join(dir, 'dev-calibration.html'), '<p>developer tool</p>');

    const files = unzip(zip(storeFiles(dir)));

    expect([...files.keys()]).toEqual(['manifest.json', 'ort/runtime.wasm', 'review.js']);
    expect(JSON.parse(files.get('manifest.json')!.toString('utf8'))).toEqual({ name: 'Photo Cleaner', version: '1.2.3' });
    expect(files.get('review.js')!.toString('utf8')).toBe('console.log("review");'.repeat(100));
    expect([...files.get('ort/runtime.wasm')!]).toEqual([0, 97, 115, 109, 255, 0, 1]);
  });

  it('gives the same zip for the same files', () => {
    const files: [string, Buffer][] = [['a.txt', Buffer.from('one')], ['b/c.txt', Buffer.from('two')]];
    expect(zip(files).equals(zip(files))).toBe(true);
  });

  it('has the PNG icons the store needs, each one in the extension', () => {
    const staticApp = resolve(import.meta.dirname, '..', 'static-app');
    const manifest = JSON.parse(readFileSync(join(staticApp, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.icons)).toEqual(['16', '32', '48', '128']);
    for (const file of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)] as string[]) {
      expect(file).toMatch(/\.png$/);
      expect(existsSync(join(staticApp, file)), file).toBe(true);
    }
  });
});
