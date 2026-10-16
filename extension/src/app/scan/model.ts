// The library as a scan records it: the same shapes as the desktop app's inventory
// (repositories/inventory/domain), so a snapshot can be classified by the shared Kotlin rules.

export type RunStatus = 'RUNNING' | 'PAUSED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
export type ScanPhase = 'LIBRARY' | 'FAVOURITES' | 'ARCHIVE' | 'ALBUM_LIST' | 'ALBUM_MEMBERS';
export type StoredMediaType = 'PHOTO' | 'VIDEO';

export interface ScanRun {
  id: number;
  accountFingerprint: string;
  startedAtMs: number;
  finishedAtMs: number | null;
  status: RunStatus;
  statusReason: string | null;
}

/** Resume point of one phase; [scope] is the album key for album members, empty otherwise. */
export interface PhaseCursor {
  phase: ScanPhase;
  scope: string;
  nextPageToken: string | null;
  pagesDone: number;
  entriesSeen: number;
  duplicateEntries: number;
  completed: boolean;
}

export interface InventoryItem {
  mediaKey: string;
  dedupKey: string;
  takenAtMs: number;
  mediaType: StoredMediaType | null;
  isFavourite: boolean | null;
  isArchived: boolean | null;
  isOwned: boolean | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
}

/** A favourite, archived or album entry: only which item it is. */
export interface EntryRef {
  mediaKey: string;
  dedupKey: string;
}

export interface AlbumRecord {
  albumKey: string;
  title: string | null;
  ownerActorId: string | null;
  isShared: boolean | null;
  kindCode: number | null;
  reportedItemCount: number | null;
  authKey: string | null;
}

/** How a second read of an album's entries compared with the first. */
export type AlbumReread = 'SAME_ENTRIES' | 'DIFFERENT_ENTRIES';

export interface AlbumStatus {
  album: AlbumRecord;
  membersSeen: number;
  membersComplete: boolean;
  failureReason: string | null;
  /** The outcome of reading the album again after its entries didn't add up to Google's count; null if it wasn't. */
  reread: AlbumReread | null;
}

/** Everything recorded in one run: the input of the protection rules. */
export interface InventorySnapshot {
  run: ScanRun;
  cursors: PhaseCursor[];
  items: InventoryItem[];
  favouriteDedupKeys: string[];
  archivedDedupKeys: string[];
  albums: AlbumStatus[];
  /** dedupKey -> keys of the albums it appears in. */
  albumMembership: Record<string, string[]>;
}
