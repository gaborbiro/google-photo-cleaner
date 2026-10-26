export function publishRelease(options: { repository: string; commit: string; version: string; assetPath: string; token: string; runUrl: string; fetcher?: typeof fetch }): Promise<string>;
