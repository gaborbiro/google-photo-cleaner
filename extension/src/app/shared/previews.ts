// A photo's preview, fetched through a Google Photos tab signed in to its account (the service
// worker picks the tab). Used by the workbenches' models, so it lives outside the screens.

import { SourceError } from '../scan/source';
import { runPageOp } from './pageOps';

/** The preview as an image address. Throws a SourceError saying why when it can't be had. */
export async function previewDataUrl(account: string, thumbUrl: string, sizePx: number): Promise<string> {
  const result = await runPageOp(account, 'fetchPreview', { thumbUrl, sizePx });
  if (!result.ok) {
    const { kind, message, httpStatus, rpcCode } = result.error;
    throw new SourceError(kind, message, httpStatus ?? null, rpcCode ?? null);
  }
  const { contentType, base64 } = result.data as { contentType: string; base64: string };
  return `data:${contentType};base64,${base64}`;
}
