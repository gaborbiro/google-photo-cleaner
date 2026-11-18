export type ReleaseDecision = { version: string; reason: null } | { version: null; reason: string };
export function releaseVersion(source: string, publishedTags: string[]): ReleaseDecision;
export function prepareRelease(path: string, environment: Record<string, string | undefined>, publishedTags: string[]): ReleaseDecision;
