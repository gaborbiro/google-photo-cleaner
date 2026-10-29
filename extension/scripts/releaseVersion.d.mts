export const RELEASE_BASE_VERSION: string;
export function releaseVersion(source: string, runNumber: string | number): string;
export function prepareRelease(path: string, environment: Record<string, string | undefined>): string;
