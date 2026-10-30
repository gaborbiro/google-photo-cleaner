import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtManifest, builtPage, isLocal, LOCAL_ICONS_DIR } from '../scripts/localBuild.mjs';

const extension = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(extension, 'static-app', 'manifest.json'), 'utf8'));
const pages = readdirSync(join(extension, 'static-app')).filter((file) => file.endsWith('.html'))
  .map((file) => ({ file, html: readFileSync(join(extension, 'static-app', file), 'utf8') }));

/** The files a page's tab icons name. */
function tabIcons(html: string): string[] {
  return [...html.matchAll(/<link rel="icon"[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);
}

describe('a local build', () => {
  it('names itself in Chrome\'s extensions page and its toolbar button\'s tooltip, within the length Chrome allows', () => {
    const local = builtManifest(manifest, false) as typeof manifest;
    expect(local.name).toBe(`${manifest.name} (local build)`);
    expect(local.name.length).toBeLessThanOrEqual(75);
    expect(local.action.default_title).toBe('Photo Cleaner (local build)');
    expect(local.action.default_popup).toBe(manifest.action.default_popup);
    expect(local.version).toBe(manifest.version);
    expect(isLocal(local)).toBe(true);
  });

  it('has its own icons, one for each of the store version\'s, each one in local-icons/', () => {
    const local = builtManifest(manifest, false) as typeof manifest;
    for (const key of ['icons', 'default_icon'] as const) {
      const [store, own] = key === 'icons' ? [manifest.icons, local.icons] : [manifest.action.default_icon, local.action.default_icon];
      expect(Object.keys(own)).toEqual(Object.keys(store));
      for (const [size, file] of Object.entries(own) as [string, string][]) {
        expect(file).toBe(`${LOCAL_ICONS_DIR}/${store[size]}`);
        // build.mjs copies local-icons/ to dist-app/<LOCAL_ICONS_DIR>/.
        expect(existsSync(join(extension, 'local-icons', store[size])), file).toBe(true);
      }
    }
  });

  it('shows its own icon on its tabs, each one in local-icons/', () => {
    expect(tabIcons(pages.find((page) => page.file === 'review.html')!.html)).toEqual(['icon32.png']);
    for (const { file, html } of pages) {
      const local = builtPage(html, false);
      expect(tabIcons(local), file).toEqual(tabIcons(html).map((icon) => `${LOCAL_ICONS_DIR}/${icon}`));
      for (const icon of tabIcons(html)) expect(existsSync(join(extension, 'local-icons', icon)), `${file}: ${icon}`).toBe(true);
      // Only the icons change.
      expect(local.replaceAll(`href="${LOCAL_ICONS_DIR}/`, 'href="'), file).toBe(html);
    }
  });

  it('is not what the release build gets: that keeps the manifest and the pages as they are', () => {
    expect(builtManifest(manifest, true)).toEqual(manifest);
    expect(isLocal(manifest)).toBe(false);
    for (const { html } of pages) expect(builtPage(html, true)).toBe(html);
  });

  it('refuses a name longer than Chrome allows', () => {
    expect(() => builtManifest({ ...manifest, name: 'x'.repeat(70) }, false)).toThrow('longer than Chrome allows');
  });
});
