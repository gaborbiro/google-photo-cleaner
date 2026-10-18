import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LICENCE_NAMES, LICENCE_TEXTS, kotlinVersion, noticesText, shippedLibraries, type PackageInfo, type Packages } from '../scripts/notices.mjs';

/** Pretend node_modules: package directory → its package.json and licence files. */
function packages(installed: Record<string, Partial<PackageInfo> & { name: string }>): Packages {
  return {
    at(dir) {
      const info = installed[dir];
      if (!info) throw new Error(`not installed: ${dir}`);
      return { version: '1.0.0', license: 'MIT', dependencies: [], licenceFiles: [`${dir}/LICENSE`], ...info };
    },
    find(name) {
      const dir = `node_modules/${name}`;
      if (!installed[dir]) throw new Error(`not installed: ${name}`);
      return dir;
    },
  };
}

const names = (libraries: { name: string }[]) => libraries.map((library) => library.name);

describe('the third-party notices', () => {
  it('lists every library the bundles read, once, and not our own code', () => {
    const libraries = shippedLibraries(
      [
        'src/app/review/main.tsx',
        'generated/kotlin/PhotoCleaner-features-shared-duplicates.mjs',
        'generated/kotlin/kotlin-kotlin-stdlib.mjs',
        'vendor/gptk/src/api/parser.ts',
        'node_modules/react/index.js',
        'node_modules/react/cjs/react.production.js',
        'node_modules/react-dom/client.js',
        'node_modules/scheduler/index.js',
      ],
      packages({
        'node_modules/react': { name: 'react', version: '19.3.0' },
        'node_modules/react-dom': { name: 'react-dom', version: '19.3.0', dependencies: ['scheduler'] },
        'node_modules/scheduler': { name: 'scheduler', version: '0.28.0' },
      }),
      '2.4.21',
    );

    expect(libraries).toEqual([
      { name: 'Google Photos Toolkit', version: null, license: 'MIT', files: ['vendor/gptk/LICENSE'] },
      { name: 'Kotlin standard library', version: '2.4.21', license: 'Apache-2.0', files: ['licences/kotlin-stdlib.txt', 'licences/Apache-2.0.txt'] },
      { name: 'react', version: '19.3.0', license: 'MIT', files: ['node_modules/react/LICENSE'] },
      { name: 'react-dom', version: '19.3.0', license: 'MIT', files: ['node_modules/react-dom/LICENSE'] },
      { name: 'scheduler', version: '0.28.0', license: 'MIT', files: ['node_modules/scheduler/LICENSE'] },
    ]);
  });

  it('includes the libraries carried inside a prebuilt file, which esbuild cannot see', () => {
    const libraries = shippedLibraries(
      ['node_modules/@huggingface/transformers/dist/transformers.web.js'],
      packages({
        'node_modules/@huggingface/transformers': {
          name: '@huggingface/transformers', license: 'Apache-2.0',
          dependencies: ['@huggingface/jinja', '@huggingface/tokenizers', 'onnxruntime-node', 'sharp'],
        },
        'node_modules/@huggingface/jinja': { name: '@huggingface/jinja' },
        'node_modules/@huggingface/tokenizers': { name: '@huggingface/tokenizers', license: 'Apache-2.0' },
      }),
      '2.4.21',
    );

    // onnxruntime-node and sharp are for transformers' Node.js build: not shipped, not listed.
    expect(names(libraries)).toEqual(['@huggingface/jinja', '@huggingface/tokenizers', '@huggingface/transformers']);
  });

  it('stops the build for a dependency nobody checked, which may be inside a bundled file', () => {
    const run = () =>
      shippedLibraries(
        ['node_modules/some-lib/dist/index.js'],
        packages({ 'node_modules/some-lib': { name: 'some-lib', dependencies: ['hidden-helper'] }, 'node_modules/hidden-helper': { name: 'hidden-helper' } }),
        '2.4.21',
      );
    expect(run).toThrow(/some-lib depends on hidden-helper/);
  });

  it('stops the build for a library without a licence file or a licence text of ours', () => {
    const run = () => shippedLibraries(['node_modules/unlicensed/index.js'], packages({ 'node_modules/unlicensed': { name: 'unlicensed', licenceFiles: [] } }), '2.4.21');
    expect(run).toThrow(/unlicensed has no licence file/);
  });

  it('stops the build for a library whose package.json gives no licence name as text, unless we name it', () => {
    const run = (license: unknown) =>
      shippedLibraries(['node_modules/old-lib/index.js'], packages({ 'node_modules/old-lib': { name: 'old-lib', license } }), '2.4.21');
    for (const license of [undefined, '', { type: 'BSD-3-Clause' }, [{ type: 'MIT' }]]) {
      expect(() => run(license), JSON.stringify(license)).toThrow(/old-lib's package.json gives no licence name as text/);
    }
    LICENCE_NAMES['old-lib'] = 'BSD-3-Clause';
    try {
      expect(run({ type: 'BSD-3-Clause' })[0].license).toBe('BSD-3-Clause');
    } finally {
      delete LICENCE_NAMES['old-lib'];
    }
  });

  it('uses our licence text for a library that comes without a licence file', () => {
    const libraries = shippedLibraries(
      ['node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs'],
      packages({ 'node_modules/onnxruntime-web': { name: 'onnxruntime-web', licenceFiles: [] } }),
      '2.4.21',
    );
    expect(libraries[0].files).toEqual(['licences/onnxruntime.txt']);
  });

  it('stops the build for a bundled file that is neither our code nor a library', () => {
    expect(() => shippedLibraries(['somewhere/else.js'], packages({}), '2.4.21')).toThrow(/somewhere\/else\.js/);
  });

  it('writes each library with its name, version, licence and full text', () => {
    const text = noticesText(
      [
        { name: 'react', version: '19.3.0', license: 'MIT', files: ['react/LICENSE'] },
        { name: 'Google Photos Toolkit', version: null, license: 'MIT', files: ['gptk/LICENSE'] },
      ],
      (file) => `text of ${file}\n`,
    );
    expect(text).toContain('react 19.3.0 (MIT)\n');
    expect(text).toContain('Google Photos Toolkit (MIT)\n');
    expect(text).toContain('text of react/LICENSE');
    expect(text).toContain('text of gptk/LICENSE');
  });

  it('has every licence text of ours in the repository', () => {
    const extension = resolve(import.meta.dirname, '..');
    for (const file of ['licences/kotlin-stdlib.txt', 'licences/Apache-2.0.txt', ...Object.values(LICENCE_TEXTS).flat()]) {
      expect(existsSync(join(extension, file)), file).toBe(true);
    }
  });

  it('reads the Kotlin version from the version catalogue', () => {
    expect(kotlinVersion('[versions]\nkotlin = "2.4.21"\nkotlinx = "1.0"\n')).toBe('2.4.21');
    expect(() => kotlinVersion('[versions]\n')).toThrow(/No kotlin version/);
  });
});
