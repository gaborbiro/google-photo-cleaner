export function submitToChromeWebStore(options: { publisherId: string; extensionId: string; version: string; assetPath: string; accessToken: string;
  publishType?: 'DEFAULT_PUBLISH' | 'STAGED_PUBLISH'; fetcher?: typeof fetch; wait?: (ms: number) => Promise<void> }): Promise<{ state: string; warnings: string[]; alreadySubmitted: boolean }>;
export function tagStoreSubmission(options: { repository: string; version: string; token: string; fetcher?: typeof fetch }): Promise<{ tag: string; commit: string; created: boolean }>;
