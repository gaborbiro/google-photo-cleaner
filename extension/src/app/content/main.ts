// The app extension's content script on photos.google.com: relays requests to the page script,
// and says when Google Photos has loaded. The panel is Chrome's side panel, beside the page.

import { installRelay } from '../../content/relay';
import { APP_PAGE_CHANNEL } from '../shared/constants';

declare global {
  // eslint-disable-next-line no-var
  var __photoCleanerAppContentInstalled: boolean | undefined;
}

/** Marked the panel and its button that versions up to 0.4.39 put on Google's page. */
const OWN_ELEMENT = 'data-photo-cleaner';

function install(): void {
  installRelay(APP_PAGE_CHANNEL, true);

  // After an update from a version that drew the panel on the page, Chrome cuts the old copy of this
  // script off but leaves its panel and button behind.
  for (const leftover of document.querySelectorAll(`[${OWN_ELEMENT}]`)) leftover.remove();

  // A scan or analysis that paused because Google Photos was closed or signed out carries on now.
  chrome.runtime.sendMessage({ kind: 'app-photos-ready' }).catch((error: unknown) => console.warn('Photo Cleaner: could not announce this tab', error));
}

// The manifest injects this into new tabs and the service worker into tabs that were open
// before an install or update; within one extension version only the first copy installs.
if (!globalThis.__photoCleanerAppContentInstalled) {
  globalThis.__photoCleanerAppContentInstalled = true;
  install();
}
