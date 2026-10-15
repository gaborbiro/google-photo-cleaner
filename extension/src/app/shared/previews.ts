// A photo's preview, fetched through a Google Photos tab signed in to its account (the service
// worker picks the tab). Used by the workbenches' models, so it lives outside the screens.

import type { OpResult } from '../../shared/protocol';
import { SourceError } from '../scan/source';
import type { AppRequest } from './messages';

/** The preview as an image address. Throws a SourceError saying why when it can't be had. */
export async function previewDataUrl(account: string, thumbUrl: string, sizePx: number): Promise<string> {
  const request: AppRequest = { kind: 'app-run-op', account, op: 'fetchPreview', params: { thumbUrl, sizePx } };
  const result = (await chrome.runtime.sendMessage(request)) as OpResult;
  if (!result.ok) {
    const { kind, message, httpStatus, rpcCode } = result.error;
    throw new SourceError(kind, message, httpStatus ?? null, rpcCode ?? null);
  }
  const { contentType, base64 } = result.data as { contentType: string; base64: string };
  return `data:${contentType};base64,${base64}`;
}
