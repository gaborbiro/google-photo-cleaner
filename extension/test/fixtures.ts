// Synthetic raw payloads in the positional layout the vendored parser expects.
// No values come from a real account.

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

export function rawLibraryItem(o: RawItemOptions = {}): unknown[] {
  const ext: Record<string, unknown> = {};
  if (o.favourite !== 'missing-field' && o.favourite !== 'missing-ext') ext['163238866'] = [o.favourite ?? false];
  if (o.videoDurationMs !== undefined) ext['76647426'] = [o.videoDurationMs];
  const flags = o.flags !== undefined ? o.flags : o.notOwned ? [[1, 27]] : [[1, 2]];
  const item: unknown[] = [
    o.mediaKey === undefined ? 'AF1QipMEDIA' : o.mediaKey,
    ['https://photos.fife.usercontent.google.com/pw/THUMB', 4000, 3000],
    o.takenAtMs === undefined ? 1_700_000_000_000 : o.takenAtMs,
    o.dedupKey === undefined ? 'DEDUP' : o.dedupKey,
    3_600_000,
    o.uploadedAtMs ?? 1_700_000_100_000,
    o.actorId === undefined ? null : o.actorId === null ? null : [o.actorId],
    flags,
    null, null, null, null,
    [1],
    o.archived === undefined ? false : o.archived,
    null,
  ];
  if (o.favourite !== 'missing-ext') item.push(ext);
  return item;
}

export function timelinePayload(items: unknown[], token: string | null, lastTs: string | null = '1700000000000'): unknown[] {
  return [items, token, lastTs];
}

export function genericPayload(items: unknown[], token: string | null): unknown[] {
  return [items, token];
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

export function rawAlbum(o: RawAlbumOptions = {}): unknown[] {
  return [
    o.albumKey === undefined ? 'AF1QipALBUM' : o.albumKey,
    ['https://photos.fife.usercontent.google.com/pw/ALBUMTHUMB'],
    null, null, null, null,
    [o.ownerActorId ?? 'ACTOR_ME'],
    {
      '72930366': [
        o.kind ?? 1,
        o.title ?? 'Synthetic album',
        [null, null, null, null, 1_600_000_000_000, 1_500_000_000_000, 1_600_000_000_000, null, null, 1_650_000_000_000],
        o.count === undefined ? 12 : o.count,
        o.shared === undefined ? null : o.shared,
        o.authKey,
      ],
    },
  ];
}

export function albumsPayload(albums: unknown[], token: string | null): unknown[] {
  return [albums, token];
}

export function rawAlbumMember(mediaKey: string, dedupKey: string, actorId = 'ACTOR_ME'): unknown[] {
  return [mediaKey, ['https://photos.fife.usercontent.google.com/pw/M', 10, 10], 1_700_000_000_000, dedupKey, 0, 1_700_000_200_000, [actorId], null, null, null, null, null, null, null, null, {}];
}

export function albumItemsPayload(members: unknown[], token: string | null, count = 2): unknown[] {
  const meta: unknown[] = new Array(22).fill(null);
  meta[0] = 'AF1QipALBUM';
  meta[1] = 'Synthetic album';
  meta[5] = ['ACTOR_OWNER'];
  meta[21] = count;
  return [null, members, token, meta];
}

export function envelope(rpcid: string, payload: unknown): string {
  const line = JSON.stringify([['wrb.fr', rpcid, JSON.stringify(payload), null, null, null, 'generic'], ['di', 42]]);
  return `)]}'\n\n${line.length}\n${line}\n`;
}

export function errorEnvelope(rpcid: string, code: number): string {
  const line = JSON.stringify([['wrb.fr', rpcid, null, null, null, [code], 'generic']]);
  return `)]}'\n\n${line.length}\n${line}\n`;
}
