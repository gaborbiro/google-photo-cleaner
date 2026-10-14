// Builds the shared Kotlin rules (protection and duplicates) for JavaScript and copies them into
// generated/kotlin (`npm run kotlin`). Run it after changing features/shared/* or a domain module they use.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const windows = process.platform === 'win32';
const gradlew = resolve(root, windows ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(windows ? `"${gradlew}"` : gradlew, [':features:shared:duplicates:exportToExtension', '--console=plain'], { cwd: root, stdio: 'inherit', shell: windows });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
