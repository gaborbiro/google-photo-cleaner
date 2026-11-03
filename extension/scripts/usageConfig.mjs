import { readFileSync } from 'node:fs';

const MEASUREMENT_ID = 'PHOTO_CLEANER_GA4_MEASUREMENT_ID';
const API_SECRET = 'PHOTO_CLEANER_GA4_API_SECRET';

function readLocalProperties(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Could not read ${path}.`);
  }
  const properties = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/);
    if (!match || properties[match[1]] !== undefined) {
      throw new Error(`Invalid ${path}: expected one name=value property per line.`);
    }
    properties[match[1]] = match[2];
  }
  return properties;
}

/** Deliberate opt-in per build. Merely leaving a credentials file on disk never enables dev/CI. */
export function usageConfig(enabled, path, production = false, environment = process.env, localPropertiesPath = 'local.properties') {
  if (!enabled) return null;
  let config;
  if (production) {
    let measurementId = environment[MEASUREMENT_ID];
    let apiSecret = environment[API_SECRET];
    if (measurementId || apiSecret) {
      if (!measurementId || !apiSecret) throw new Error('Release builds need both the GA4_MEASUREMENT_ID Actions setting and GA4_API_SECRET Actions secret. See docs/github-releases.md.');
    } else {
      const properties = readLocalProperties(localPropertiesPath);
      measurementId = properties?.[MEASUREMENT_ID];
      apiSecret = properties?.[API_SECRET];
      if (!measurementId || !apiSecret) throw new Error(`Release builds need the Analytics environment settings or both settings in ${localPropertiesPath}. See docs/usage-events-setup.md.`);
    }
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
