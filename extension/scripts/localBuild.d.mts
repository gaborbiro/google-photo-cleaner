// Types for localBuild.mjs, for its tests.
export const LOCAL_MARK: string;
export const LOCAL_ICONS_DIR: string;
export function builtManifest(manifest: Record<string, unknown>, release: boolean): Record<string, unknown>;
export function builtPage(html: string, release: boolean): string;
export function isLocal(manifest: Record<string, unknown>): boolean;
