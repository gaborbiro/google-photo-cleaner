// THIRD_PARTY_NOTICES.txt for the app: the licence of every library whose code is in its bundles.
// The list comes from what esbuild read for each bundle (its metafile), so a new library shows up by
// itself. Some libraries ship prebuilt files with other libraries inside, which esbuild can't see:
// every dependency of a bundled library must be bundled too, or listed in INLINED or NOT_SHIPPED,
// or the build stops.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Libraries whose prebuilt files carry other libraries inside them. */
export const INLINED = {
  // dist/transformers.web.js
  '@huggingface/transformers': ['@huggingface/jinja', '@huggingface/tokenizers'],
};

/** Dependencies of bundled libraries whose code is not in the bundles (checked by hand). */
export const NOT_SHIPPED = {
  // For its Node.js build only; the browser build imports onnxruntime-web.
  '@huggingface/transformers': ['onnxruntime-node', 'sharp'],
  // For its unbundled builds; the WebGPU bundle (dist/ort.webgpu.bundle.min.mjs) has none of them.
  'onnxruntime-web': ['flatbuffers', 'guid-typescript', 'long', 'platform', 'protobufjs'],
};

/** Licence texts for libraries that come without a licence file (see licences/README.md). */
export const LICENCE_TEXTS = {
  'onnxruntime-web': ['licences/onnxruntime.txt'],
  'onnxruntime-common': ['licences/onnxruntime.txt'],
};

/** Licence names for libraries whose package.json doesn't give one as text (checked by hand). */
export const LICENCE_NAMES = {};

const KOTLIN_STDLIB = 'generated/kotlin/kotlin-kotlin-stdlib.mjs';
const OWN_KOTLIN = /^generated\/kotlin\/PhotoCleaner-[^/]+\.mjs$/;
const PACKAGE_DIR = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//;

/**
 * The third-party libraries in bundles that read [inputs] (paths relative to extension/, as in
 * esbuild's metafile), each with the files of its licence text, sorted by name.
 * [packages]: `at(dir)` → { name, version, license, dependencies (names), licenceFiles },
 * `find(name, fromDir)` → the directory of the package [name] as seen from [fromDir].
 */
export function shippedLibraries(inputs, packages, kotlinVersion) {
  const libraries = new Map();
  const packageDirs = new Set();
  for (const input of inputs) {
    if (input.startsWith('src/') || OWN_KOTLIN.test(input)) continue;
    if (input === KOTLIN_STDLIB) {
      libraries.set('Kotlin standard library', {
        name: 'Kotlin standard library', version: kotlinVersion, license: 'Apache-2.0',
        files: ['licences/kotlin-stdlib.txt', 'licences/Apache-2.0.txt'],
      });
    } else if (input.startsWith('vendor/gptk/')) {
      libraries.set('Google Photos Toolkit', { name: 'Google Photos Toolkit', version: null, license: 'MIT', files: ['vendor/gptk/LICENSE'] });
    } else {
      const dir = input.match(PACKAGE_DIR)?.[1];
      if (!dir) throw new Error(`A bundle includes ${input}, which is neither our code nor a library: add it to scripts/notices.mjs`);
      packageDirs.add(dir);
    }
  }

  const bundled = new Map([...packageDirs].map((dir) => [packages.at(dir).name, dir]));
  const shipped = new Map(bundled);
  for (const [name, dir] of bundled) {
    for (const inner of INLINED[name] ?? []) shipped.set(inner, packages.find(inner, dir));
  }
  for (const [name, dir] of shipped) {
    const info = packages.at(dir);
    for (const dependency of info.dependencies) {
      if (shipped.has(dependency) || (NOT_SHIPPED[name] ?? []).includes(dependency)) continue;
      throw new Error(
        `${name} depends on ${dependency}, which is not in the bundles as a file of its own. Check whether ${name}'s ` +
          `files carry its code, then list it in INLINED or NOT_SHIPPED in scripts/notices.mjs`,
      );
    }
    const files = info.licenceFiles.length > 0 ? info.licenceFiles : LICENCE_TEXTS[name];
    if (!files) throw new Error(`${name} has no licence file: add its licence text to licences/ and LICENCE_TEXTS in scripts/notices.mjs`);
    // Older packages give it as an object or a list, which would read "[object Object]" in the notices.
    const license = typeof info.license === 'string' && info.license !== '' ? info.license : LICENCE_NAMES[name];
    if (!license) throw new Error(`${name}'s package.json gives no licence name as text: check its licence and add it to LICENCE_NAMES in scripts/notices.mjs`);
    libraries.set(name, { name, version: info.version, license, files });
  }
  return [...libraries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The notices file for [libraries], with [read] giving a licence file's text. */
export function noticesText(libraries, read) {
  const rule = '='.repeat(80);
  const parts = libraries.map((library) => {
    const title = [library.name, library.version, `(${library.license})`].filter(Boolean).join(' ');
    return `${rule}\n${title}\n${rule}\n\n${library.files.map((file) => read(file).trim()).join('\n\n')}\n`;
  });
  return `Photo Cleaner includes the following third-party software.\n\n${parts.join('\n')}`;
}

/** Packages as installed under [root] (extension/). */
export function installedPackages(root) {
  return {
    at(dir) {
      const json = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
      const licenceFiles = readdirSync(join(root, dir))
        .filter((file) => /^(LICEN[CS]E|NOTICE|COPYING)/i.test(file))
        .sort()
        .map((file) => `${dir}/${file}`);
      return {
        name: json.name,
        version: json.version,
        license: json.license,
        dependencies: Object.keys(json.dependencies ?? {}),
        licenceFiles,
      };
    },
    find(name, fromDir) {
      for (let dir = fromDir; ; dir = dir.slice(0, dir.lastIndexOf('/node_modules/'))) {
        if (existsSync(join(root, dir, 'node_modules', name, 'package.json'))) return `${dir}/node_modules/${name}`;
        if (!dir.includes('/node_modules/')) break;
      }
      if (existsSync(join(root, 'node_modules', name, 'package.json'))) return `node_modules/${name}`;
      throw new Error(`${name} is not installed: run npm ci`);
    },
  };
}

/** The Kotlin version from the version catalogue. */
export function kotlinVersion(catalogue) {
  const version = catalogue.match(/^kotlin\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error('No kotlin version in gradle/libs.versions.toml');
  return version;
}
