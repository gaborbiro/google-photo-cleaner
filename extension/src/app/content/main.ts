// The app extension's content script on photos.google.com: relays requests to the page
// script, and shows the Photo Cleaner panel on the right, with a small tab to open it.

import { installRelay } from '../../content/relay';
import { APP_PAGE_CHANNEL } from '../shared/constants';
import type { TabRequest } from '../shared/messages';

declare global {
  // eslint-disable-next-line no-var
  var __photoCleanerAppContentInstalled: boolean | undefined;
}

const PANEL_WIDTH_PX = 400;
const PANEL_URL = chrome.runtime.getURL('panel.html');

function install(): void {
  installRelay(APP_PAGE_CHANNEL);

  // The panel is an extension page in a frame: Google's styles and scripts can't reach it.
  const panel = document.createElement('iframe');
  panel.src = PANEL_URL;
  panel.title = 'Photo Cleaner';
  Object.assign(panel.style, {
    position: 'fixed', top: '0', right: '0', width: `${PANEL_WIDTH_PX}px`, height: '100vh',
    border: 'none', borderLeft: '1px solid rgba(128,128,128,0.4)', zIndex: '2147483646',
    boxShadow: '-4px 0 16px rgba(0,0,0,0.25)', display: 'none', colorScheme: 'normal',
  });

  const handle = document.createElement('button');
  handle.textContent = 'Photo Cleaner';
  handle.title = 'Open the Photo Cleaner panel';
  Object.assign(handle.style, {
    position: 'fixed', right: '0', top: '50%', transform: 'translateY(-50%) rotate(180deg)', writingMode: 'vertical-rl',
    zIndex: '2147483647', border: 'none', borderRadius: '0 6px 6px 0', padding: '12px 6px', cursor: 'pointer',
    background: '#5b3fd6', color: '#fff', font: '600 12px system-ui, sans-serif', letterSpacing: '0.04em',
  });

  let open = false;
  const setOpen = (value: boolean) => {
    open = value;
    panel.style.display = open ? 'block' : 'none';
    handle.style.display = open ? 'none' : 'block';
  };
  handle.onclick = () => setOpen(true);

  // The panel's close button posts to this page; only messages from our own frame count.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== panel.contentWindow || event.origin !== new URL(PANEL_URL).origin) return;
    if ((event.data as { kind?: string } | null)?.kind === 'app-close-panel') setOpen(false);
  });

  chrome.runtime.onMessage.addListener((message: TabRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.kind !== 'app-toggle-panel') return false;
    setOpen(message.open ?? !open);
    sendResponse(true);
    return false;
  });

  document.documentElement.append(panel, handle);
}

// The manifest injects this into new tabs and the service worker into tabs that were open
// before an install or update; only the first copy installs.
if (!globalThis.__photoCleanerAppContentInstalled) {
  globalThis.__photoCleanerAppContentInstalled = true;
  install();
}
