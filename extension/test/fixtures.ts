// Synthetic raw payloads in the positional layout of Google's real answers (rows, lengths, where
// each listing ends), as captured from a whole scan in October 2026. No values come from a real
// account: IDs and markers are made from labels, padded to the real lengths.

/** A photo's own ID, as Google writes it: AF1Qip and 38 more characters (37 with [short]). */
export function mediaKey(label: string, short = false): string {
  return `AF1Qip${label.padEnd(short ? 37 : 38, 'x')}`;
}

/** The ID every copy of a photo shares: 27 characters (rarely with ":" and more after it). */
export function dedupKey(label: string): string {
  return label.padEnd(27, 'x');
}

/** An album's ID: AF1Qip and 38 more characters, or 64 for a newer shared album. */
export function albumKey(label: string, shared = false): string {
  return `AF1Qip${label.padEnd(shared ? 64 : 38, 'x')}`;
}

/** A next-page marker: a long string of letters, digits, - and _. */
export function marker(label = 'next'): string {
  return `AKFEYq${label}`.padEnd(140, 'x');
}

export interface RawItemOptions {
  mediaKey?: string | null;
  dedupKey?: string | null;
  takenAtMs?: number | null;
  uploadedAtMs?: number;
  favourite?: boolean | 'missing-field' | 'missing-ext';
  archived?: boolean | null;
  notOwned?: boolean;
  flags?: unknown;
  actorId?: string | null;
  videoDurationMs?: number;
}

/** A library (or favourites) row: 16 fields, the last one its details object. */
export function rawLibraryItem(o: RawItemOptions = {}): unknown[] {
  const ext: Record<string, unknown> = {};
  if (o.favourite !== 'missing-field' && o.favourite !== 'missing-ext') ext['163238866'] = [o.favourite ?? false];
  if (o.videoDurationMs !== undefined) ext['76647426'] = [o.videoDurationMs];
  const flags = o.flags !== undefined ? o.flags : o.notOwned ? [[1, 27]] : [[1, 2]];
  const item: unknown[] = [
    o.mediaKey === undefined ? mediaKey('MEDIA') : o.mediaKey,
    ['https://photos.fife.usercontent.google.com/pw/THUMB', 4000, 3000],
    o.takenAtMs === undefined ? 1_700_000_000_000 : o.takenAtMs,
    o.dedupKey === undefined ? dedupKey('DEDUP') : o.dedupKey,
    3_600_000,
    o.uploadedAtMs ?? 1_700_000_100_000,
    o.actorId === undefined ? null : o.actorId === null ? null : [o.actorId],
    flags,
    1,
    null, null, null, null,
    o.archived === undefined ? false : o.archived,
    1,
  ];
  if (o.favourite !== 'missing-ext') item.push(ext);
  return item;
}

/**
 * An archive row (lcxiM asked for the archive only): 10 fields, without the archive flag, shaped
 * as in a real answer (October 2026). The image details sometimes end with one more list.
 */
export function rawArchiveItem(key = mediaKey('archived'), dedup = dedupKey('ARCHIVED'), imageExtra = false): unknown[] {
  const image: unknown[] = ['https://photos.fife.usercontent.google.com/pw/A', 4000, 3000, null, null, null, null, null, [null, null, 3]];
  if (imageExtra) image.push([1_700_000_050_000]);
  return [
    key, image, 1_700_000_000_000, dedup, 3_600_000, 1_700_000_100_000, null,
    [[1], [2], [3], [4], [8], [21], [14], [15], [17], [18], [19], [22], [28, false, true], [29, false, true], [35, false, true]],
    2,
    { '15': 1_700_000_200_000, '129168200': [[]], '163238866': [false] },
  ];
}

/** A library page: [items, marker, last item's time] — or just [items] on the last page. */
export function timelinePayload(items: unknown[], token: string | null, lastTs = '1700000000000'): unknown[] {
  return token === null ? [items] : [items, token, lastTs];
}

/** A favourites page: [items, marker, …], with "" as the marker on the last page. */
export function genericPayload(items: unknown[], token: string | null): unknown[] {
  return [items, token ?? '', null, null, [1], 0, null, [], null, false];
}

export interface RawAlbumOptions {
  albumKey?: string | null;
  kind?: number;
  title?: string;
  count?: number | null;
  shared?: boolean | null;
  authKey?: string;
  ownerActorId?: string;
}

/** An album list row: 9 fields for a regular album, 12 for a newer shared one (kind 4). */
export function rawAlbum(o: RawAlbumOptions = {}): unknown[] {
  const kind = o.kind ?? 1;
  const details = {
    '72930366': [
      kind,
      o.title ?? 'Synthetic album',
      [1_500_000_000_000, 1_600_000_000_000, null, null, 1_600_000_000_000, [1_500_000_000_000, 3_600_000], [1_600_000_000_000, 3_600_000], null, null, 1_650_000_000_000],
      o.count === undefined ? 12 : o.count,
      o.shared === undefined ? null : o.shared,
      o.authKey ?? null,
      [19_990],
    ],
  };
  const head = [
    o.albumKey === undefined ? albumKey('ALBUM', kind === 4) : o.albumKey,
    ['https://photos.fife.usercontent.google.com/pw/ALBUMTHUMB', 4000, 3000, null, null, null, null, null, null, [1]],
    null, null, null, null,
    [o.ownerActorId ?? 'ACTOR_ME'],
    [[3], [4]],
  ];
  return kind === 4 ? [...head, null, null, [null, null, null, null, null, [null, 10]], details] : [...head, details];
}

/** An album list page: [albums, marker] — or just [albums] on the last page. */
export function albumsPayload(albums: unknown[], token: string | null): unknown[] {
  return token === null ? [albums] : [albums, token];
}

/** An album entry: 10 fields, the last one its details object. */
export function rawAlbumMember(key: string, dedup: string, actorId = 'ACTOR_ME'): unknown[] {
  return [key, ['https://photos.fife.usercontent.google.com/pw/M', 10, 10, null, null, null, null, null, null, [1]], 1_700_000_000_000, dedup, 0, 1_700_000_200_000, [actorId], [[3]], 1, {}];
}

/** An album page: [null, entries, marker or "" on the last page, album details, null, 0]. */
export function albumItemsPayload(members: unknown[] | null, token: string | null, count = 2, key = albumKey('ALBUM')): unknown[] {
  const meta: unknown[] = new Array(42).fill(null);
  meta[0] = key;
  meta[1] = 'Synthetic album';
  meta[5] = ['ACTOR_OWNER'];
  meta[21] = count;
  return [null, members, token ?? '', meta, null, 0];
}

/** A trash row: 15 fields, the dedup key at [3], with no details object at the end. */
export function rawTrashItem(dedup: string, key = mediaKey('trashed')): unknown[] {
  return [key, ['https://photos.fife.usercontent.google.com/pw/T', 10, 10], 1_700_000_000_000, dedup, 3_600_000, 1_700_000_100_000, null, null, 1, null, null, null, null, null, 1_700_000_300_000];
}

export function envelope(rpcid: string, payload: unknown): string {
  const line = JSON.stringify([['wrb.fr', rpcid, JSON.stringify(payload), null, null, null, 'generic'], ['di', 42]]);
  return `)]}'\n\n${line.length}\n${line}\n`;
}

export function errorEnvelope(rpcid: string, code: number): string {
  const line = JSON.stringify([['wrb.fr', rpcid, null, null, null, [code], 'generic']]);
  return `)]}'\n\n${line.length}\n${line}\n`;
}
