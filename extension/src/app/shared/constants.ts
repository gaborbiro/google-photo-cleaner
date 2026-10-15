// Names that keep the app extension apart from the desktop app's connector when both are
// installed: each has its own page-script channel and window keys.

export const APP_PAGE_CHANNEL = 'photo-cleaner-app';
export const APP_PAGE_OWNER_KEY = '__photoCleanerAppPageId';

/** BroadcastChannel on which the background page announces saved changes to all open surfaces. */
export const CHANGES_CHANNEL = 'photo-cleaner-app-changes';

/** The browser database (IndexedDB) for everything the app stores. */
export const DB_NAME = 'photo-cleaner';
/** 2: library scan stores (M2). 3: analysis stores (M3). 4: review decisions and trash queue (M4). 5: preferences. */
export const DB_VERSION = 5;
