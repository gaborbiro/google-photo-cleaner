// The extension's version, built in by build.mjs from static-app/manifest.json (vitest.config.mjs
// sets one for the tests). The background page is an offscreen document, which Chrome gives only
// runtime messaging: it can't ask for the manifest.

declare const __PHOTO_CLEANER_VERSION__: string;
declare const __PHOTO_CLEANER_LOCAL_BUILD__: boolean;

export const BUILT_VERSION: string = __PHOTO_CLEANER_VERSION__;
/**
 * Built with `npm run build`, for loading unpacked, not by `npm run package` for the store: it marks
 * itself (red icons, see scripts/localBuild.mjs; "local build" beside its version) so that it can't be mistaken
 * for the store version installed beside it.
 */
export const LOCAL_BUILD: boolean = __PHOTO_CLEANER_LOCAL_BUILD__;
