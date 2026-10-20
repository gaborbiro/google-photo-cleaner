// The only requests that change the user's Google Photos: moving photos to the trash and restoring
// them (GPTK src/api/api.ts:235 moveItemsToTrash, :247 restoreFromTrash; both rpcid XwAOJf). Kept
// apart from the read-only dispatcher (ops.ts) so that only Photo Cleaner's own page script
// includes them (the tripwire tests in ops.test.ts check this).
//
// Before anything is sent: the photos are 1 to MAX_TRASH_BATCH distinct, well-formed dedup keys,
// and this tab is signed in to the account they belong to. What happened is checked afterwards by
// reading the trash (listTrashPage), not trusted from Google's reply.

import { MAX_TRASH_BATCH, type OpResult, type WriteOp } from '../shared/protocol';
import { accountFingerprint, badRequest, requiredString, unexpectedFailure, type PageEnvironment } from './ops';
import { callRpc, OpFailure, readSessionTokens } from './rpc';

/** A dedup key as Google writes them (letters, digits and a few separators); anything else never reaches a request. */
const DEDUP_KEY = /^[\w\-:.+/=]{1,512}$/;

/** The photos a trash or restore request names: 1 to MAX_TRASH_BATCH distinct dedup keys. */
function dedupKeys(params: Record<string, unknown>): string[] {
  const value = params['dedupKeys'];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TRASH_BATCH) {
    throw badRequest(`dedupKeys must list 1 to ${MAX_TRASH_BATCH} photos`);
  }
  if (!value.every((k) => typeof k === 'string' && DEDUP_KEY.test(k))) throw badRequest('dedupKeys must hold dedup keys');
  if (new Set(value).size !== value.length) throw badRequest('dedupKeys must not repeat');
  return value as string[];
}

async function dispatchWrite(env: PageEnvironment, op: WriteOp, params: Record<string, unknown>): Promise<object> {
  const keys = dedupKeys(params);
  const tokens = readSessionTokens(env.wiz());
  const account = await accountFingerprint(env, tokens);
  if (requiredString(params, 'account') !== account) {
    throw new OpFailure({ kind: 'NO_PHOTOS_TAB', message: 'This tab is not signed in to the account the photos belong to' });
  }
  const request = op === 'moveToTrash' ? [null, 1, keys, 3] : [null, 3, keys, 2];
  await callRpc('XwAOJf', request, tokens, env.sourcePath(), env.fetcher);
  return { sent: keys.length, accountFingerprint: account };
}

export async function runWriteOp(env: PageEnvironment, op: WriteOp, params: Record<string, unknown>): Promise<OpResult> {
  try {
    return { ok: true, data: await dispatchWrite(env, op, params) };
  } catch (error) {
    if (error instanceof OpFailure) return { ok: false, error: error.error };
    return { ok: false, error: unexpectedFailure(error) };
  }
}
