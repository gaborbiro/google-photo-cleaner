// The connector's content script: relay between its service worker and page script.

import { PAGE_CHANNEL } from '../shared/protocol';
import { installRelay } from './relay';

declare global {
  // eslint-disable-next-line no-var
  var __photoCleanerContentInstalled: boolean | undefined;
}

// The manifest injects this into new tabs and the service worker injects it into
// tabs that were open before an install or update; only the first copy registers.
if (!globalThis.__photoCleanerContentInstalled) {
  globalThis.__photoCleanerContentInstalled = true;
  installRelay(PAGE_CHANNEL);
  // Wake the service worker so it connects to the app now rather than at its next alarm.
  chrome.runtime.sendMessage({ kind: 'pc-wake' }).catch(() => {
    // The worker may be restarting; its alarm reconnects soon anyway.
  });
}
