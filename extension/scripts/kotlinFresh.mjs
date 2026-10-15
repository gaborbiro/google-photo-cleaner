// Guards against testing or building the extension with an old copy of the shared Kotlin rules:
// generated/kotlin is built from the Kotlin sources by `npm run kotlin` and is not in git, so a
// change to those sources (an edit, a pull) must be followed by a rebuild.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
export const GENERATED = resolve(import.meta.dirname, '..', 'generated', 'kotlin', 'PhotoCleaner-features-shared-duplicates.mjs');

/** The Kotlin modules compiled into generated/kotlin (their main sources, not their tests). */
const SOURCES = [
  'features/shared/protection/src',
  'features/shared/duplicates/src',
  'repositories/inventory/domain/src',
  'repositories/review/domain/src',
  'repositories/analysis/domain/src',
];

function newestSource(dir) {
  let newest = { path: null, ms: 0 };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/Test$/.test(entry.name)) continue; // commonTest, jvmTest: not compiled into the extension
      const found = newestSource(path);
      if (found.ms > newest.ms) newest = found;
    } else if (entry.name.endsWith('.kt') || entry.name.endsWith('.kts')) {
      const ms = statSync(path).mtimeMs;
      if (ms > newest.ms) newest = { path, ms };
    }
  }
  return newest;
}

/** Throws with what to do when generated/kotlin is missing or older than a Kotlin source it comes from. */
export function assertKotlinFresh() {
  if (!existsSync(GENERATED)) {
    throw new Error('The shared Kotlin rules are not built for the extension yet: run `npm run kotlin` first.');
  }
  const built = statSync(GENERATED).mtimeMs;
  for (const dir of SOURCES) {
    const { path, ms } = newestSource(join(root, dir));
    if (ms > built) {
      throw new Error(`The shared Kotlin rules changed since they were built for the extension (${path}): run \`npm run kotlin\` first.`);
    }
  }
}
