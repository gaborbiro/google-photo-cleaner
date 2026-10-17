// Makes the zip to upload to the Chrome Web Store from dist-app (`npm run package` builds it first):
// release/photo-cleaner-<version>.zip. What differs from the unpacked extension:
//  - no "key" in the manifest: it pins the unpacked extension's ID, and the store refuses packages
//    that have one (the store gives the extension its own ID);
//  - no developer pages (dev-*, e.g. dev-calibration.html).

import { crc32, deflateRawSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** The manifest as the store gets it. */
export function storeManifest(manifest) {
  const { key, ...rest } = manifest;
  return rest;
}

/** Whether a file of dist-app ([path] relative to it, with forward slashes) goes into the store package. */
export function shipped(path) {
  return !path.split('/').pop().startsWith('dev-');
}

/** A zip of [files] (path with forward slashes → contents), compressed, with fixed dates so the same files give the same zip. */
export function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  const dosDate = (1 << 5) | 1; // 1980-01-01, the earliest a zip can say
  for (const [path, data] of files) {
    const name = Buffer.from(path, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    header.writeUInt16LE(0x0800, 6); // names are UTF-8
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** The store package's files from the built extension in [dir], in a fixed order. */
export function storeFiles(dir) {
  const paths = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter(shipped)
    .sort();
  return paths.map((path) => {
    if (path !== 'manifest.json') return [path, readFileSync(join(dir, path))];
    const manifest = JSON.parse(readFileSync(join(dir, path), 'utf8'));
    return [path, Buffer.from(JSON.stringify(storeManifest(manifest), null, 2) + '\n', 'utf8')];
  });
}

if (import.meta.main) {
  const extension = resolve(import.meta.dirname, '..');
  const dist = join(extension, 'dist-app');
  const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  const files = storeFiles(dist);
  const out = join(extension, 'release', `photo-cleaner-${version}.zip`);
  mkdirSync(join(extension, 'release'), { recursive: true });
  writeFileSync(out, zip(files));
  console.log(`${relative(extension, out)}: ${files.length} files, version ${version}`);
}
