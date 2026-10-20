// The page script's channel and window key, the change announcements' channel, and the database.

export const APP_PAGE_CHANNEL = 'photo-cleaner-app';
export const APP_PAGE_OWNER_KEY = '__photoCleanerAppPageId';

/** Set on the background page's window once its code has started (read by engine/guard.ts). */
export const ENGINE_STARTED_KEY = '__photoCleanerEngineStarted';

/** BroadcastChannel on which the background page announces saved changes to all open surfaces. */
export const CHANGES_CHANNEL = 'photo-cleaner-app-changes';

/** The browser database (IndexedDB) for everything the app stores. */
export const DB_NAME = 'photo-cleaner';
/**
 * 2: library scan stores (M2). 3: analysis stores (M3). 4: review decisions and trash queue (M4). 5: preferences.
 * 6: fingerprints per account (moved from `embeddings`, which was keyed by photo key alone); review summaries.
 * 7: the simulated trash's store removed (photos always go to Google Photos' trash).
 * 8: the problem log, for diagnosing failures after they happened.
 */
export const DB_VERSION = 8;
