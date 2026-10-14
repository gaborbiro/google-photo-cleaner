// Service worker of the app extension. Chrome stops it after ~30 s idle, so it holds no
// state: it starts and stops the background page (which does the work), talks to the
// Photos tabs, and opens the app's tabs. Job state lives in the job store.

import type { OpResult, TabCommand } from '../../shared/protocol';
import { IndexedDbJobStore } from '../shared/store';
import { isAppRequest, type AccountAnswer, type AppRequest, type TabRequest } from '../shared/messages';

const PHOTOS_URL = 'https://photos.google.com/';
const store = new IndexedDbJobStore();

async function photosTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: `${PHOTOS_URL}*` });
  return tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

/** Puts the page script and relay into a Photos tab opened before this extension started; both run once. */
async function injectInto(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'], world: 'MAIN' });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function sendToTab<T>(tabId: number, message: TabCommand | TabRequest): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    await injectInto(tabId);
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  }
}

async function accountOf(tab: chrome.tabs.Tab | undefined): Promise<AccountAnswer> {
  const tabs = await photosTabs();
  const target = tab?.url?.startsWith(PHOTOS_URL) ? tab : tabs[0];
  if (target?.id === undefined) return { account: null, problem: 'No Google Photos tab is open.', photosTabOpen: false };
  if (target.discarded) return { account: null, problem: 'The Google Photos tab is asleep; click on it to wake it.', photosTabOpen: true };
  let result: OpResult;
  try {
    result = await sendToTab<OpResult>(target.id, { kind: 'pc-command', op: 'status', params: {} });
  } catch {
    return { account: null, problem: 'The Google Photos tab is not responding; reload it.', photosTabOpen: true };
  }
  if (!result.ok) {
    const problem = result.error.kind === 'SESSION' ? 'Google Photos is signed out in this tab.' : `Google Photos did not answer: ${result.error.message}`;
    return { account: null, problem, photosTabOpen: true };
  }
  const data = result.data as { accountFingerprint: string; accountEmail?: string };
  return { account: { fingerprint: data.accountFingerprint, email: data.accountEmail ?? null }, problem: null, photosTabOpen: true };
}

// --- the background page (offscreen document) ---

const ENGINE_URL = 'engine.html';

async function engineRunning(): Promise<boolean> {
  return chrome.offscreen.hasDocument();
}

async function wakeEngine(): Promise<void> {
  if (await engineRunning()) return;
  try {
    await chrome.offscreen.createDocument({
      url: ENGINE_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs long scans in the background, independent of open tabs.',
    });
  } catch (error) {
    // Two wake-ups can race; a second document is refused, and one is all we need.
    if (!(await engineRunning())) throw error;
  }
}

async function wakeEngineIfWorkLeft(): Promise<void> {
  const jobs = await store.all();
  if (jobs.some((job) => job.status === 'running')) await wakeEngine();
}

async function closeEngineIfIdle(): Promise<void> {
  const jobs = await store.all();
  if (!jobs.some((job) => job.status === 'running') && (await engineRunning())) await chrome.offscreen.closeDocument();
}

// --- tabs ---

async function openPhotos(): Promise<void> {
  const tab = (await photosTabs())[0];
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: PHOTOS_URL });
  }
}

async function openReview(account: string | null): Promise<void> {
  const base = chrome.runtime.getURL('review.html');
  const existing = (await chrome.tabs.query({ url: `${base}*` }))[0];
  const url = account ? `${base}?account=${encodeURIComponent(account)}` : base;
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, url });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function showPanel(): Promise<void> {
  await openPhotos();
  const tab = (await photosTabs())[0];
  if (tab?.id !== undefined) await sendToTab(tab.id, { kind: 'app-toggle-panel', open: true });
}

async function handle(request: AppRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (request.kind) {
    case 'app-account':
      return accountOf(sender.tab);
    case 'app-wake-engine':
      await wakeEngine();
      return true;
    case 'app-engine-idle':
      await closeEngineIfIdle();
      return true;
    case 'app-open-review':
      await openReview(request.account);
      return true;
    case 'app-open-photos':
      await openPhotos();
      return true;
    case 'app-show-panel':
      await showPanel();
      return true;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isAppRequest(message)) return false;
  handle(message, sender).then(sendResponse, (error: unknown) => {
    console.error('Request failed', message.kind, error);
    sendResponse({ error: error instanceof Error ? error.message : String(error) });
  });
  return true; // answered asynchronously
});

// A scan that was running when the browser closed carries on when it starts again.
chrome.runtime.onStartup.addListener(() => void wakeEngineIfWorkLeft());
chrome.runtime.onInstalled.addListener(() => {
  void wakeEngineIfWorkLeft();
  // Photos tabs opened before the install get the page script and panel now.
  void photosTabs().then((tabs) => tabs.forEach((tab) => {
    if (tab.id !== undefined && !tab.discarded) injectInto(tab.id).catch((e) => console.warn('Could not inject into a Photos tab', e));
  }));
});
