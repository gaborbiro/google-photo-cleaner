// Types for notices.mjs, for its tests.
export interface PackageInfo { name: string; version: string; license: string; dependencies: string[]; licenceFiles: string[] }
export interface Packages { at(dir: string): PackageInfo; find(name: string, fromDir: string): string }
export interface Library { name: string; version: string | null; license: string; files: string[] }
export const INLINED: Record<string, string[]>;
export const NOT_SHIPPED: Record<string, string[]>;
export const LICENCE_TEXTS: Record<string, string[]>;
export function shippedLibraries(inputs: Iterable<string>, packages: Packages, kotlinVersion: string): Library[];
export function noticesText(libraries: Library[], read: (file: string) => string): string;
export function installedPackages(root: string): Packages;
export function kotlinVersion(catalogue: string): string;
