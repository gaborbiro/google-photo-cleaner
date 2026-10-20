// The extension's version, built in by build.mjs from static-app/manifest.json (vitest.config.mjs
// sets one for the tests). The background page is an offscreen document, which Chrome gives only
// runtime messaging: it can't ask for the manifest.

declare const __PHOTO_CLEANER_VERSION__: string;

export const BUILT_VERSION: string = __PHOTO_CLEANER_VERSION__;
