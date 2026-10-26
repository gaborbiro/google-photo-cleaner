import type { PageOp } from '../../shared/protocol';

// Messages from the surfaces (popup, panel, review tab) and the background page to the
// service worker. The service worker starts and stops the background page and talks to
// the Photos tabs; job state itself goes through the job store.

export type AppRequest =
  /** Which Google account a Photos tab is signed in to: the panel's tab [tabId], or else the best Photos tab. */
  | { kind: 'app-account'; tabId?: number }
  /** A job was started or resumed: make sure the background page is running. */
  | { kind: 'app-wake-engine' }
  /** The background page has nothing left to run and may be closed. */
  | { kind: 'app-engine-idle' }
  /**
   * From the background page's guard (engine/guard.ts): an error nobody caught there, as it was
   * thrown (the service worker scrubs it before keeping it). [started]: whether the page had got going.
   */
  | { kind: 'app-engine-error'; started: boolean; message: string; stack: string | null }
  /** The background page stopped responding: close it and start a new one, which carries on from the saved positions. */
  | { kind: 'app-restart-engine' }
  /** Gentle mode: has the keyboard or mouse been used in the last minute? Answers 'active', 'idle' or 'locked'. */
  | { kind: 'app-idle-state' }
  /**
   * One operation in a Photos tab signed in to [account]: a read for a scan or a preview, or a trash
   * request (only from the trash queue, which checks every photo again first).
   */
  | { kind: 'app-run-op'; account: string; op: PageOp; params: Record<string, unknown> }
  /** Open the review tab for [account] on [tab], or bring the open one forward and switch it there. */
  | { kind: 'app-open-review'; account: string | null; tab: ReviewTab }
  /**
   * The best Photos tab, or a new one opened behind the page asking (a popup closes as another tab
   * comes forward, and must stay to open the tab's panel); answers `{ tabId }`. See [photosTabOf].
   */
  | { kind: 'app-open-photos' }
  /** Bring Photos tab [tabId] forward: the popup has just opened its panel (see [panelOptions]). */
  | { kind: 'app-show-panel'; tabId: number }
  /** A Google Photos page has loaded (from its content script): jobs waiting for it may carry on. */
  | { kind: 'app-photos-ready' }
  /** Erase everything Photo Cleaner saved on this computer; answers `{ ok: true }` or `{ error }`. */
  | { kind: 'app-erase-all' };

export type ReviewTab = 'scan' | 'duplicates' | 'search';
export const REVIEW_TABS: readonly ReviewTab[] = ['scan', 'duplicates', 'search'];

/**
 * The review tab's address for [account], opening [tab]: `review.html?account=…#duplicates`. Only the
 * part after # differs for the same account, so Chrome switches an open review tab without reloading it.
 */
export function reviewUrl(page: string, account: string | null, tab: ReviewTab): string {
  return `${page}${account ? `?account=${encodeURIComponent(account)}` : ''}#${tab}`;
}

/** The tab asked for in the review tab's address ("#duplicates"); null when none. */
export function requestedReviewTab(hash: string): ReviewTab | null {
  return REVIEW_TABS.find((t) => `#${t}` === hash) ?? null;
}

export interface AccountAnswer {
  /** null when no signed-in Photos tab answered. */
  account: { fingerprint: string; email: string | null } | null;
  /** Why there's no account, in plain words. */
  problem: string | null;
  /** Whether a Google Photos tab is open; null when unknown (the extension itself did not answer). */
  photosTabOpen: boolean | null;
  /** The Photos tab this answer is about (the popup opens its panel); null when none. */
  tabId: number | null;
}

/**
 * The panel is Chrome's side panel, one for each Google Photos tab, beside the page rather than on
 * it. Its address names its tab (`panel.html?tab=42`): the panel asks about that tab's account.
 */
export function panelOptions(tabId: number): chrome.sidePanel.PanelOptions {
  return { tabId, path: `panel.html?tab=${tabId}`, enabled: true };
}

/** The panel's tab, from its address (see [panelOptions]). */
export function panelTab(search: string): number {
  const tabId = Number(new URLSearchParams(search).get('tab'));
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error(`The panel's address names no tab: "${search}"`);
  return tabId;
}

const EXTENSION_SILENT = 'The extension did not answer. Try again; if it keeps happening, reload the extension.';

/**
 * The background's reply to `app-account` as an answer. A failed request comes back as `{ error }`
 * (and nothing at all if nobody answered): then there's no account, and the error says why.
 */
export function accountAnswer(reply: unknown): AccountAnswer {
  if (typeof reply === 'object' && reply !== null && 'account' in reply && 'problem' in reply) return reply as AccountAnswer;
  const error = typeof reply === 'object' && reply !== null ? (reply as { error?: unknown }).error : undefined;
  return { account: null, problem: typeof error === 'string' ? error : EXTENSION_SILENT, photosTabOpen: null, tabId: null };
}

/** The Photos tab in the background's reply to `app-open-photos`; a failed request (`{ error }`, or no answer) throws, saying why. */
export function photosTabOf(reply: unknown): number {
  if (typeof reply === 'object' && reply !== null && typeof (reply as { tabId?: unknown }).tabId === 'number') return (reply as { tabId: number }).tabId;
  const error = typeof reply === 'object' && reply !== null ? (reply as { error?: unknown }).error : undefined;
  throw new Error(typeof error === 'string' ? error : EXTENSION_SILENT);
}

export function isAppRequest(value: unknown): value is AppRequest {
  return typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string' &&
    (value as { kind: string }).kind.startsWith('app-');
}
