import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const outdir = 'dist';
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir);

const common = { bundle: true, target: 'chrome116', legalComments: 'inline', logLevel: 'info' };

const gptkNotice = '/*! Includes code from Google Photos Toolkit (https://github.com/xob0t/Google-Photos-Toolkit), MIT License, Copyright (c) 2024 xob0t. See THIRD_PARTY_GPTK_LICENSE. */';
await build({ ...common, entryPoints: { page: 'src/page/main.ts' }, outdir, format: 'iife', banner: { js: gptkNotice } });
await build({ ...common, entryPoints: { content: 'src/content/main.ts' }, outdir, format: 'iife' });
await build({ ...common, entryPoints: { popup: 'src/popup/main.ts' }, outdir, format: 'iife' });
await build({ ...common, entryPoints: { background: 'src/background/main.ts' }, outdir, format: 'esm' });

cpSync('static', outdir, { recursive: true });
cpSync('vendor/gptk/LICENSE', `${outdir}/THIRD_PARTY_GPTK_LICENSE`);
