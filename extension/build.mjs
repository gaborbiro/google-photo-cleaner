import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

if (!existsSync('generated/protection/PhotoCleaner-features-shared-protection.mjs')) {
  console.error('The shared Kotlin protection rules are not built yet: run `npm run kotlin` first.');
  process.exit(1);
}

// Two extensions from one project:
//  dist/      the connector the desktop app talks to (unchanged while the desktop app is in use)
//  dist-app/  the new Photo Cleaner extension (everything runs in the browser)

const common = { bundle: true, target: 'chrome116', legalComments: 'inline', logLevel: 'info' };
const gptkNotice = '/*! Includes code from Google Photos Toolkit (https://github.com/xob0t/Google-Photos-Toolkit), MIT License, Copyright (c) 2024 xob0t. See THIRD_PARTY_GPTK_LICENSE. */';

function fresh(outdir) {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir);
}

// --- the connector ---
{
  const outdir = 'dist';
  fresh(outdir);
  await build({ ...common, entryPoints: { page: 'src/page/main.ts' }, outdir, format: 'iife', banner: { js: gptkNotice } });
  await build({ ...common, entryPoints: { content: 'src/content/main.ts' }, outdir, format: 'iife' });
  await build({ ...common, entryPoints: { popup: 'src/popup/main.ts' }, outdir, format: 'iife' });
  await build({ ...common, entryPoints: { background: 'src/background/main.ts' }, outdir, format: 'esm' });
  cpSync('static', outdir, { recursive: true });
  cpSync('vendor/gptk/LICENSE', `${outdir}/THIRD_PARTY_GPTK_LICENSE`);
}

// --- the app ---
{
  const outdir = 'dist-app';
  fresh(outdir);
  const react = { jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, minify: true };
  await build({ ...common, entryPoints: { page: 'src/app/page/main.ts' }, outdir, format: 'iife', banner: { js: gptkNotice } });
  await build({ ...common, entryPoints: { content: 'src/app/content/main.ts' }, outdir, format: 'iife' });
  await build({ ...common, entryPoints: { background: 'src/app/background/main.ts' }, outdir, format: 'esm' });
  // The background page holds the AI model; its runtime is packed in, because extensions may not
  // load code from the internet. The WebGPU backend uses the "asyncify" build of ONNX Runtime.
  await build({ ...common, entryPoints: { engine: 'src/app/engine/main.ts' }, outdir, format: 'esm' });
  mkdirSync(`${outdir}/ort`);
  for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
    cpSync(`node_modules/onnxruntime-web/dist/${file}`, `${outdir}/ort/${file}`);
  }
  await build({
    ...common,
    ...react,
    entryPoints: { popup: 'src/app/popup/main.tsx', panel: 'src/app/panel/main.tsx', review: 'src/app/review/main.tsx' },
    outdir,
    format: 'iife',
  });
  cpSync('static-app', outdir, { recursive: true });
  cpSync('vendor/gptk/LICENSE', `${outdir}/THIRD_PARTY_GPTK_LICENSE`);
}
