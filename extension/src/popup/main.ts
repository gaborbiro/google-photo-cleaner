import { DEFAULT_PORT } from '../shared/protocol';

const STATE_TEXT: Record<string, string> = {
  unpaired: 'Not paired: paste the token from the app',
  connecting: 'Connecting to the app…',
  connected: 'Connected to the app',
  'token-rejected': 'The app rejected this token: copy it again from the app',
  'app-unreachable': 'App not reachable: is Photo Cleaner running?',
};

const tokenInput = document.getElementById('token') as HTMLInputElement;
const portInput = document.getElementById('port') as HTMLInputElement;
const stateLabel = document.getElementById('state') as HTMLDivElement;
const tabsLabel = document.getElementById('tabs') as HTMLDivElement;

async function refresh(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ kind: 'pc-get-state' })) as { state: string; photosTabCount: number };
  stateLabel.textContent = STATE_TEXT[response.state] ?? response.state;
  tabsLabel.textContent = response.photosTabCount === 0
    ? 'No photos.google.com tab open'
    : `${response.photosTabCount} photos.google.com tab(s) open`;
}

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get(['port', 'token']);
  portInput.value = String(typeof stored['port'] === 'number' ? stored['port'] : DEFAULT_PORT);
  tokenInput.value = typeof stored['token'] === 'string' ? stored['token'] : '';
  await refresh();
  setInterval(() => void refresh(), 1_000);
}

document.getElementById('save')?.addEventListener('click', () => {
  const port = Number(portInput.value);
  const token = tokenInput.value.trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    stateLabel.textContent = 'Port must be between 1024 and 65535';
    return;
  }
  void chrome.storage.local.set({ port, token }).then(async () => {
    await chrome.runtime.sendMessage({ kind: 'pc-config-changed' });
    await refresh();
  });
});

void init();
