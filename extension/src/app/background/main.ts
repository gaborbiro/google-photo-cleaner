// Service worker of the app extension. Chrome stops it after ~30 s idle, so it holds no
// state: it starts and stops the background page (which does the work), talks to the
// Photos tabs, and opens the app's tabs. Job state lives in the job store.

import type { OpError, OpResult, PageOp, TabCommand } from '../../shared/protocol';
import { UsageSender } from '../shared/usageSender';
import { IndexedDbUsageStore } from '../shared/usageStore';
import type { UsageState } from '../shared/usageStore';
import { UsageLaunches } from '../shared/usageLaunches';
import { USAGE_CONFIG } from '../shared/usage';
import { bindUsageEmitter, emitUsage } from '../shared/usageClient';
import { pauseRunningJobs, resumeWaitingForPhotos } from '../shared/actions';
import { CHANGES_CHANNEL } from '../shared/constants';
import { eraseAllData } from '../shared/erase';
import { plainMessage } from '../shared/errors';
import { INCOMPATIBLE_TEXT, isIncompatible, logGoogleProblem, tabProblem } from '../shared/googleProblems';
import { ENGINE_FAILED_TEXT } from '../shared/job';
import { keepProblemsHere, problemsSaved, recordUnexpectedReport } from '../shared/problemLog';
import { IndexedDbJobStore } from '../shared/store';
import { isAppRequest, panelOptions, reviewUrl, type AccountAnswer, type AppRequest, type ReviewTab } from '../shared/messages';

const PHOTOS_URL = 'https://photos.google.com/';
const store = new IndexedDbJobStore();
const usageStore = new IndexedDbUsageStore();
const usage = new UsageSender(usageStore, USAGE_CONFIG);
const usageLaunches = new UsageLaunches((input) => { void usage.record(input); }, (surface) => {
  if (USAGE_CONFIG) void chrome.runtime.sendMessage({ kind: 'usage-probe', surface }).catch(() => {});
});
let usageContext: UsageState | null = null;
if (USAGE_CONFIG) void usageStore.get().then((state) => { usageContext = state; }).catch(() => {});
bindUsageEmitter((event, receipt) => {
  if (!USAGE_CONFIG || usageContext?.answer !== 'yes') return;
  usageLaunches.record({ event, receipt, epoch: usageContext.epoch, atMs: Date.now() });
});
keepProblemsHere();

async function photosTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: `${PHOTOS_URL}*` });
  return tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

/** Puts the page script and relay into a Photos tab opened before this extension started; both run once. */
async function injectInto(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'], world: 'MAIN' });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function sendToTab<T>(tabId: number, message: TabCommand): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    // Expected for a tab opened before the extension started: nothing listens there until injected.
    await injectInto(tabId);
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  }
}

/** How long a Photos tab has to say which account it is signed in to, so the popup and panel never wait on a frozen tab. */
const ACCOUNT_CHECK_MS = 5_000;

/** [work]'s result, or a failure once [ms] have passed without one. */
function timeLimit<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * The account [tab] is signed in to. [answered] tells a tab that answered but couldn't say (signed out,
 * Google changed something) from one that is asleep or didn't answer in time.
 */
async function askAccount(tab: chrome.tabs.Tab): Promise<{ answer: AccountAnswer; answered: boolean }> {
  const tabId = tab.id ?? null;
  if (tab.discarded) return { answer: { account: null, problem: 'The Google Photos tab is asleep; click on it to wake it.', photosTabOpen: true, tabId }, answered: false };
  let result: OpResult;
  try {
    if (tabId === null) throw new Error('the tab has no id');
    result = await timeLimit(sendToTab<OpResult>(tabId, { kind: 'pc-command', op: 'status', params: {} }), ACCOUNT_CHECK_MS);
  } catch (error) {
    console.warn('Photo Cleaner: a Google Photos tab did not answer the account check', error);
    return { answer: { account: null, problem: 'The Google Photos tab is not responding; reload it.', photosTabOpen: true, tabId }, answered: false };
  }
  if (!result.ok) return { answer: { account: null, problem: accountProblem(result.error), photosTabOpen: true, tabId }, answered: true };
  const data = result.data as { accountFingerprint: string; accountEmail?: string };
  return { answer: { account: { fingerprint: data.accountFingerprint, email: data.accountEmail ?? null }, problem: null, photosTabOpen: true, tabId }, answered: true };
}

/**
 * Which account is signed in: in [tab] when it is a Photos tab (the panel's), else in the first open Photos tab
 * that can say (active first, then most recently used). Every tab is asked at once, so one that doesn't
 * answer costs the time limit once. Without an account, why: a tab that answered gives the reason
 * (signed out…), before one that is asleep or not responding.
 */
async function accountOf(tab: chrome.tabs.Tab | undefined): Promise<AccountAnswer> {
  const tabs = tab?.url?.startsWith(PHOTOS_URL) ? [tab] : await photosTabs();
  if (tabs.length === 0) return { account: null, problem: 'No Google Photos tab is open.', photosTabOpen: false, tabId: null };
  const asked = tabs.map(askAccount);
  let reason: { answer: AccountAnswer; answered: boolean } | null = null;
  for (const pending of asked) {
    const found = await pending;
    if (found.answer.account) return found.answer;
    if (reason === null || (found.answered && !reason.answered)) reason = found;
  }
  if (reason === null) throw new Error('No Photos tab was asked which account is signed in');
  return reason.answer;
}

function accountProblem(error: OpError): string {
  if (error.kind === 'SESSION') return 'Google Photos is signed out in this tab.';
  logGoogleProblem('account check', error);
  if (isIncompatible(error.kind)) return INCOMPATIBLE_TEXT;
  return 'Google Photos is not answering right now. Reload the Google Photos tab, or try again in a minute.';
}

// --- running a scan's requests in the right account's tab ---

/** Which account each Photos tab was last seen signed in to; rebuilt as needed (this worker restarts often). */
const tabAccounts = new Map<number, string>();
const RELOAD_TIMEOUT_MS = 30_000;

/** Chrome puts background tabs to sleep (Memory Saver); a sleeping tab runs no scripts until reloaded. */
async function wake(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.discarded || tab.id === undefined) return;
  const tabId = tab.id;
  const loaded = new Promise<void>((resolve) => {
    const timer = setTimeout(done, RELOAD_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id: number, info: chrome.tabs.OnUpdatedInfo) {
      if (id === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
  await chrome.tabs.reload(tabId);
  await loaded;
}

/** The account [tab] is signed in to; its failed account check; or null when the tab did not answer at all. */
async function statusOf(tab: chrome.tabs.Tab): Promise<{ fingerprint: string } | { failure: OpError } | null> {
  if (tab.id === undefined) return null;
  try {
    await wake(tab);
    const status = await sendToTab<OpResult>(tab.id, { kind: 'pc-command', op: 'status', params: {} });
    if (!status.ok) {
      tabAccounts.delete(tab.id);
      return { failure: status.error };
    }
    const fingerprint = (status.data as { accountFingerprint: string }).accountFingerprint;
    tabAccounts.set(tab.id, fingerprint);
    return { fingerprint };
  } catch (error) {
    console.warn('Photo Cleaner: a Google Photos tab did not answer', error);
    tabAccounts.delete(tab.id);
    return null;
  }
}

/**
 * A Photos tab signed in to [account]: the one used last time if it still is, otherwise the first that is.
 * Without one, why (see [tabProblem]): a scan then says Google changed something, or that it is signed
 * out, rather than asking for a Google Photos tab that is already open.
 */
async function tabFor(account: string): Promise<{ tabId: number } | { failure: OpError }> {
  const tabs = await photosTabs();
  const known = tabs.find((t) => t.id !== undefined && tabAccounts.get(t.id) === account);
  const failures: OpError[] = [];
  for (const tab of known ? [known, ...tabs.filter((t) => t !== known)] : tabs) {
    const answer = await statusOf(tab);
    if (answer && 'fingerprint' in answer && answer.fingerprint === account) return { tabId: tab.id! };
    if (answer && 'failure' in answer) failures.push(answer.failure);
  }
  return { failure: tabProblem(failures) };
}

async function runOp(account: string, op: PageOp, params: Record<string, unknown>): Promise<OpResult> {
  const found = await tabFor(account);
  if ('failure' in found) return { ok: false, error: found.failure };
  const { tabId } = found;
  const result = await sendToTab<OpResult>(tabId, { kind: 'pc-command', op, params });
  // A tab that went to sleep or lost its session mid-scan: one more try after waking it.
  if (!result.ok && (result.error.kind === 'NO_PHOTOS_TAB' || result.error.kind === 'TRANSIENT')) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.discarded) {
      await wake(tab);
      return sendToTab<OpResult>(tabId, { kind: 'pc-command', op, params });
    }
  }
  return result;
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

/**
 * An error nobody caught in the background page (from engine/guard.ts) goes to the problem log. If
 * the page never got going, its jobs would wait for it forever: they pause, saying so, and the page
 * is closed, so that Resume starts a new one.
 */
async function engineError(started: boolean, message: string, stack: string | null): Promise<void> {
  emitUsage({ name: 'feature_failed', params: { feature: 'engine', reason: 'unknown' } });
  console.error(`Photo Cleaner: ${started ? 'an error in the background page' : 'the background page could not start'}`, message);
  recordUnexpectedReport(started ? 'background page: error' : 'background page: could not start', message, stack);
  if (!started) {
    await pauseRunningJobs(store, ENGINE_FAILED_TEXT, Date.now());
    if (await engineRunning()) await chrome.offscreen.closeDocument();
  }
  await problemsSaved();
}

/** The background page stopped responding (the user pressed Restart): a new one carries on from the saved positions. */
async function restartEngine(): Promise<void> {
  console.warn('Photo Cleaner: restarting the background page, which stopped responding');
  if (await engineRunning()) await chrome.offscreen.closeDocument();
  await wakeEngine();
}

async function closeEngineIfIdle(): Promise<void> {
  const jobs = await store.all();
  if (!jobs.some((job) => job.status === 'running') && (await engineRunning())) await chrome.offscreen.closeDocument();
}

/** A Photos tab signed in to [account] answered: jobs that paused for want of one carry on. */
async function carryOn(account: string): Promise<void> {
  if (await resumeWaitingForPhotos(store, account, Date.now())) {
    console.info('Photo Cleaner: Google Photos is back for a waiting account; carrying on');
    await wakeEngine();
  }
}

const READY_ATTEMPTS = 3;
const READY_RETRY_MS = 2_000;

/**
 * A Photos page has just loaded. Google's page may not be able to say which account it is signed in
 * to straight away, so it is asked a few times, briefly, before giving up (the panel asks again later).
 */
async function photosReady(tab: chrome.tabs.Tab | undefined): Promise<void> {
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt++) {
    const answer = await accountOf(tab);
    if (answer.account) return carryOn(answer.account.fingerprint);
    console.info(`Photo Cleaner: a Photos page loaded but its account is not known yet (${answer.problem}); attempt ${attempt} of ${READY_ATTEMPTS}`);
    if (attempt < READY_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, READY_RETRY_MS));
  }
}

/**
 * Erases everything saved, as uninstalling would: the background page stops first (so nothing is
 * written meanwhile), then the data goes, then every open Photo Cleaner page reloads empty.
 */
async function eraseAll(): Promise<{ ok: true }> {
  usageLaunches.clear();
  usageContext = null;
  usage.stop();
  if (await engineRunning()) await chrome.offscreen.closeDocument();
  tabAccounts.clear();
  await eraseAllData();
  const channel = new BroadcastChannel(CHANGES_CHANNEL);
  channel.postMessage({ kind: 'erased' });
  channel.close();
  console.info('Photo Cleaner: all saved data erased');
  return { ok: true };
}

// --- tabs ---

/** Brings [tab] forward in its window, and the window to the front. */
async function bringForward(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) throw new Error('The tab to bring forward has no id');
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

/**
 * The best Photos tab, or a new one, not brought forward: the page that asked opens its panel and
 * then asks for it to come forward (`app-show-panel`), as a popup closes once another tab does.
 */
async function photosTab(): Promise<{ tabId: number }> {
  const tab = (await photosTabs())[0] ?? (await chrome.tabs.create({ url: PHOTOS_URL, active: false }));
  if (tab.id === undefined) throw new Error('The Google Photos tab has no id');
  return { tabId: tab.id };
}

/**
 * The panel is offered on Google Photos tabs only: Chrome hides it on a tab that leaves Google Photos
 * and shows it again on coming back. Without the "tabs" permission, Chrome gives no address for other
 * sites' tabs. A tab still on its way to Google Photos (just opened, nothing loaded yet) says where it
 * is going only as its pending address, and keeps the panel the popup has just opened in it. Options
 * already set are left alone, so a panel in use is not reloaded.
 */
async function offerPanel(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const wanted = (tab.pendingUrl ?? tab.url)?.startsWith(PHOTOS_URL) ? panelOptions(tab.id) : { tabId: tab.id, enabled: false };
  const current = await chrome.sidePanel.getOptions({ tabId: tab.id });
  if (current.enabled === wanted.enabled && (!wanted.enabled || current.path === wanted.path)) return;
  await chrome.sidePanel.setOptions(wanted);
}

/**
 * Opens the review tab on [tab], or brings the open one forward. For the account it already shows, only
 * the part after # changes: Chrome then switches its tab without a reload, keeping selections and place.
 */
async function openReview(account: string | null, tab: ReviewTab): Promise<void> {
  const base = chrome.runtime.getURL('review.html');
  const existing = (await chrome.tabs.query({ url: `${base}*` }))[0];
  const url = reviewUrl(base, account, tab);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, url });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function handle(request: AppRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (request.kind) {
    case 'app-usage-event': {
      const path = sender.url?.split('?')[0].split('#')[0];
      const trusted = ['popup.html', 'panel.html', 'review.html', 'engine.html'].some((page) => path === chrome.runtime.getURL(page));
      if (!trusted || !request.input || typeof request.input !== 'object') return false;
      usageLaunches.record(request.input);
      await usage.settled();
      return true;
    }
    case 'app-usage-consent': {
      const path = sender.url?.split('?')[0].split('#')[0];
      if (!['popup.html', 'panel.html', 'review.html'].some((page) => path === chrome.runtime.getURL(page)) ||
        (request.answer !== 'yes' && request.answer !== 'no')) return false;
      usageContext = null;
      usageLaunches.clear();
      usage.stop();
      const setupState = await store.all().then((jobs) => jobs.length > 0 ? 'existing' as const : 'new' as const, () => 'unknown' as const);
      const state = await usage.consent(request.answer, setupState);
      usageContext = state;
      const channel = new BroadcastChannel(CHANGES_CHANNEL);
      channel.postMessage({ kind: 'usage-changed' });
      channel.close();
      if (state.answer === 'yes') void usage.record({ event: { name: 'usage_enabled', params: {} }, epoch: state.epoch, atMs: Date.now() });
      return { ok: true };
    }
    case 'app-account': {
      // The panel and popup ask this as they open: a good moment to carry on, too.
      const answer = await accountOf(request.tabId === undefined ? undefined : await chrome.tabs.get(request.tabId));
      if (answer.account) await carryOn(answer.account.fingerprint);
      return answer;
    }
    case 'app-photos-ready':
      await photosReady(sender.tab);
      return true;
    case 'app-erase-all':
      return eraseAll();
    case 'app-wake-engine':
      await wakeEngine();
      return true;
    case 'app-engine-idle':
      await closeEngineIfIdle();
      return true;
    case 'app-engine-error':
      await engineError(request.started, request.message, request.stack);
      return true;
    case 'app-restart-engine':
      await restartEngine();
      return true;
    case 'app-run-op':
      return runOp(request.account, request.op, request.params);
    case 'app-idle-state':
      return chrome.idle.queryState(60);
    case 'app-open-review': {
      const source = sender.url?.startsWith(chrome.runtime.getURL('panel.html')) ? 'panel' : 'popup';
      emitUsage({ name: 'surface_open_requested', params: { source_surface: source, target_surface: 'review' } });
      try {
        await openReview(request.account, request.tab);
        emitUsage({ name: 'surface_open_result', params: { source_surface: source, target_surface: 'review', result: 'accepted' } });
        return true;
      } catch (error) {
        emitUsage({ name: 'surface_open_result', params: { source_surface: source, target_surface: 'review', result: 'failed' } });
        throw error;
      }
    }
    case 'app-open-photos':
      return photosTab();
    case 'app-show-panel':
      await bringForward(await chrome.tabs.get(request.tabId));
      return true;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isAppRequest(message)) return false;
  handle(message, sender).then(sendResponse, (error: unknown) => {
    console.error('Photo Cleaner: a request to the extension failed', message.kind, error);
    sendResponse({ error: plainMessage(error, 'Something went wrong inside the extension. Try again; if it keeps happening, reload the extension.') });
  });
  return true; // answered asynchronously
});

// A scan that was running when the browser closed carries on when it starts again.
chrome.runtime.onStartup.addListener(() => void wakeEngineIfWorkLeft());
chrome.runtime.onInstalled.addListener(() => {
  void wakeEngineIfWorkLeft();
  // Photos tabs opened before the install get the panel, and the page script once awake.
  void photosTabs().then((tabs) => tabs.forEach((tab) => {
    offerPanel(tab).catch((e) => console.warn('Could not offer the panel in a Photos tab', e));
    if (tab.id !== undefined && !tab.discarded) injectInto(tab.id).catch((e) => console.warn('Could not inject into a Photos tab', e));
  }));
});
// Each page that starts loading: Google Photos gets the panel, any other page has it taken away.
chrome.tabs.onUpdated.addListener((_, info, tab) => {
  if (info.status === 'loading') offerPanel(tab).catch((e) => console.warn('Could not offer or remove the panel in a tab', e));
});
