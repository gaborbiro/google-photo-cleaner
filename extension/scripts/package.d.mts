// Types for package.mjs, for its tests.
export function storeManifest(manifest: Record<string, unknown>): Record<string, unknown>;
export function shipped(path: string): boolean;
export function zip(files: [string, Buffer][]): Buffer;
export function storeFiles(dir: string): [string, Buffer][];
