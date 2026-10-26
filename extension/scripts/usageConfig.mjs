import { readFileSync } from 'node:fs';

/** Deliberate opt-in per build. Merely leaving a credentials file on disk never enables dev/CI. */
export function usageConfig(enabled, path, production = false, environment = process.env) {
  if (!enabled) return null;
  let config;
  if (production) {
    const measurementId = environment.PHOTO_CLEANER_GA4_MEASUREMENT_ID;
    const apiSecret = environment.PHOTO_CLEANER_GA4_API_SECRET;
    if (!measurementId || !apiSecret) throw new Error('Release builds need the GA4_MEASUREMENT_ID Actions variable and GA4_API_SECRET Actions secret. See docs/github-releases.md.');
    config = { measurementId, apiSecret, debug: false };
  } else {
    try { config = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw new Error('Usage reporting needs usage.config.json. See docs/usage-events-setup.md.'); }
  }
  if (!config || !/^G-[A-Z0-9]+$/.test(config.measurementId) || typeof config.apiSecret !== 'string' ||
    !/^[A-Za-z0-9_-]{8,200}$/.test(config.apiSecret) || (config.debug !== undefined && typeof config.debug !== 'boolean')) {
    throw new Error('Invalid usage configuration: expected measurementId, apiSecret and optional boolean debug.');
  }
  if (production && config.debug === true) throw new Error('Release usage configuration must have debug set to false.');
  return { measurementId: config.measurementId, apiSecret: config.apiSecret, debug: config.debug === true };
}
