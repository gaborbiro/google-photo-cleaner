// One operation in a Google Photos tab signed in to [account]: the service worker picks the tab and
// the page script runs it there. Used by the models (previews, the real trash), not the screens.

import type { OpResult, PageOp } from '../../shared/protocol';
import type { AppRequest } from './messages';

export async function runPageOp(account: string, op: PageOp, params: Record<string, unknown>): Promise<OpResult> {
  const request: AppRequest = { kind: 'app-run-op', account, op, params };
  return (await chrome.runtime.sendMessage(request)) as OpResult;
}
