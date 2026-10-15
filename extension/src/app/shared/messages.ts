import type { PageOp } from '../../shared/protocol';

// Messages from the surfaces (popup, panel, review tab) and the background page to the
// service worker. The service worker starts and stops the background page and talks to
// the Photos tabs; job state itself goes through the job store.

export type AppRequest =
  /** Which Google account a Photos tab is signed in to: the sender's tab (panel) or the best Photos tab. */
  | { kind: 'app-account'; account?: string }
  /** A job was started or resumed: make sure the background page is running. */
  | { kind: 'app-wake-engine' }
  /** The background page has nothing left to run and may be closed. */
  | { kind: 'app-engine-idle' }
  /** Gentle mode: has the keyboard or mouse been used in the last minute? Answers 'active', 'idle' or 'locked'. */
  | { kind: 'app-idle-state' }
  /**
   * One operation in a Photos tab signed in to [account]: a read for a scan or a preview, or a trash
   * request (only from the trash queue, which checks every photo again first).
   */
  | { kind: 'app-run-op'; account: string; op: PageOp; params: Record<string, unknown> }
  | { kind: 'app-open-review'; account: string | null }
  | { kind: 'app-open-photos' }
  | { kind: 'app-show-panel' }
  /** A Google Photos page has loaded (from its content script): jobs waiting for it may carry on. */
  | { kind: 'app-photos-ready' }
  /** Erase everything Photo Cleaner saved on this computer; answers `{ ok: true }` or `{ error }`. */
  | { kind: 'app-erase-all' };

export interface AccountAnswer {
  /** null when no signed-in Photos tab answered. */
  account: { fingerprint: string; email: string | null } | null;
  /** Why there's no account, in plain words. */
  problem: string | null;
  photosTabOpen: boolean;
}

/** Service worker -> Photos tab content script. */
export type TabRequest = { kind: 'app-toggle-panel'; open?: boolean };

export function isAppRequest(value: unknown): value is AppRequest {
  return typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string' &&
    (value as { kind: string }).kind.startsWith('app-');
}
