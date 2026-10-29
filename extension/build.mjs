import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { assertKotlinFresh } from './scripts/kotlinFresh.mjs';
import { builtManifest, LOCAL_ICONS_DIR } from './scripts/localBuild.mjs';
import { installedPackages, kotlinVersion, noticesText, shippedLibraries } from './scripts/notices.mjs';
import { usageConfig } from './scripts/usageConfig.mjs';

try {
  assertKotlinFresh();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Builds the Photo Cleaner extension into dist-app/.

// The extension's version, built in: the background page (an offscreen document) can't ask Chrome for its manifest.
const manifest = JSON.parse(readFileSync('static-app/manifest.json', 'utf8'));
const version = manifest.version;
const release = process.argv.includes('--release');
const usage = usageConfig(process.argv.includes('--usage'), 'usage.config.json', release);
const common = { bundle: true, target: 'chrome116', legalComments: 'inline', logLevel: 'info', define: { __PHOTO_CLEANER_VERSION__: JSON.stringify(version), __PHOTO_CLEANER_LOCAL_BUILD__: JSON.stringify(!release), __PHOTO_CLEANER_USAGE__: JSON.stringify(usage) } };
const gptkNotice = '/*! Includes code from Google Photos Toolkit (https://github.com/xob0t/Google-Photos-Toolkit), MIT License, Copyright (c) 2024 xob0t. See THIRD_PARTY_GPTK_LICENSE. */';

{
  const outdir = 'dist-app';
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir);
  // Everything the bundles read, for the third-party notices.
  const inputs = new Set();
  const bundle = async (options) => {
    const { metafile } = await build({ ...common, ...options, metafile: true });
    for (const input of Object.keys(metafile.inputs)) inputs.add(input);
  };
  const react = { jsx: 'automatic', define: { ...common.define, 'process.env.NODE_ENV': '"production"' }, minify: true };
  await bundle({ entryPoints: { page: 'src/app/page/main.ts' }, outdir, format: 'iife', banner: { js: gptkNotice } });
  await bundle({ entryPoints: { content: 'src/app/content/main.ts' }, outdir, format: 'iife' });
  await bundle({ entryPoints: { background: 'src/app/background/main.ts' }, outdir, format: 'esm' });
  // The background page holds the AI model; its runtime is packed in, because extensions may not
  // load code from the internet. The WebGPU backend uses the "asyncify" build of ONNX Runtime.
  await bundle({ entryPoints: { 'engine-guard': 'src/app/engine/guard.ts' }, outdir, format: 'iife' });
  await bundle({ entryPoints: { engine: 'src/app/engine/main.ts' }, outdir, format: 'esm' });
  // Search's AI model for descriptions, loaded by the review tab on its first text search.
  await bundle({ entryPoints: { 'search-ai': 'src/app/search/textModel.ts' }, outdir, format: 'esm' });
  mkdirSync(`${outdir}/ort`);
  for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
    cpSync(`node_modules/onnxruntime-web/dist/${file}`, `${outdir}/ort/${file}`);
    inputs.add(`node_modules/onnxruntime-web/dist/${file}`);
  }
  await bundle({
    ...react,
    entryPoints: {
      popup: 'src/app/popup/main.tsx', panel: 'src/app/panel/main.tsx', review: 'src/app/review/main.tsx',
      // Developer tool, not linked from the app: chrome-extension://<id>/dev-calibration.html
      'dev-calibration': 'src/app/dev/calibration.tsx',
      // Developer tool, not linked from the app: chrome-extension://<id>/dev-clutter.html
      'dev-clutter': 'src/app/dev/clutter.tsx',
    },
    outdir,
    format: 'iife',
  });
  cpSync('static-app', outdir, { recursive: true });
  if (!release) cpSync('local-icons', `${outdir}/${LOCAL_ICONS_DIR}`, { recursive: true });
  writeFileSync(`${outdir}/manifest.json`, JSON.stringify(builtManifest(manifest, release), null, 2) + '\n');
  cpSync('vendor/gptk/LICENSE', `${outdir}/THIRD_PARTY_GPTK_LICENSE`);
  const libraries = shippedLibraries(inputs, installedPackages('.'), kotlinVersion(readFileSync('../gradle/libs.versions.toml', 'utf8')));
  writeFileSync(`${outdir}/THIRD_PARTY_NOTICES.txt`, noticesText(libraries, (file) => readFileSync(file, 'utf8')));
  console.log(`\n  ${outdir}/THIRD_PARTY_NOTICES.txt: ${libraries.map((library) => library.name).join(', ')}\n`);
}
