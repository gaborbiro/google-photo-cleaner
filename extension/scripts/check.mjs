// Everything that must pass before a change is done (`npm run check`), in the order that works:
// 1. Gradle: build the shared Kotlin rules for the extension, run every Kotlin test (the desktop
//    app's and the shared rules'), 2. the extension: typecheck, tests, build.
// Stops at the first failure. The same command runs in CI (.github/workflows/check.yml).

import { spawnSync } from 'node:child_process';
import { utimesSync } from 'node:fs';
import { resolve } from 'node:path';
import { GENERATED } from './kotlinFresh.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const extension = resolve(import.meta.dirname, '..');
const windows = process.platform === 'win32';

function run(label, command, args, cwd) {
  console.log(`\n=== ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: windows });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

const gradlew = resolve(root, windows ? 'gradlew.bat' : 'gradlew');
run('Kotlin: shared rules for the extension, and every Kotlin test', windows ? `"${gradlew}"` : gradlew, [
  ':features:shared:duplicates:exportToExtension',
  'test',
  ':features:shared:duplicates:jvmTest',
  '--console=plain',
], root);
// Gradle may skip an unchanged copy; the rules are current either way.
const now = new Date();
utimesSync(GENERATED, now, now);

run('Extension: typecheck', 'npm', ['run', 'typecheck'], extension);
run('Extension: tests', 'npm', ['test'], extension);
run('Extension: build', 'npm', ['run', 'build'], extension);
console.log('\n✓ All checks passed');
