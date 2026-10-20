import { describe, expect, it } from 'vitest';
import {
  normalizeAlbumItemsPage,
  normalizeAlbumsPage,
  normalizeArchivePage,
  normalizeGenericPage,
  normalizeTimelinePage,
  normalizeTrashPage,
} from '../src/page/normalize';
import { OpFailure } from '../src/page/rpc';
import {
  albumItemsPayload,
  albumKey,
  albumsPayload,
  dedupKey,
  genericPayload,
  marker,
  mediaKey,
  rawAlbum,
  rawAlbumMember,
  rawArchiveItem,
  rawLibraryItem,
  rawTrashItem,
  timelinePayload,
} from './fixtures';

function protocolFailure(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OpFailure);
    expect((error as OpFailure).error.kind).toBe('PROTOCOL');
    return;
  }
  throw new Error('expected a PROTOCOL failure');
}

/** Values that are not a next-page marker, though something sits where the marker belongs. */
const NOT_MARKERS: unknown[] = [null, 0, 42, true, ['AKFEYq'], {}, 'short', `${marker()} x`, marker().replace('x', '.')];

describe('library pages', () => {
  it('keeps favourite status tri-state', () => {
    const page = normalizeTimelinePage(timelinePayload([
      rawLibraryItem({ mediaKey: mediaKey('a'), favourite: true }),
      rawLibraryItem({ mediaKey: mediaKey('b'), favourite: false }),
      rawLibraryItem({ mediaKey: mediaKey('c'), favourite: 'missing-field' }),
    ], marker()));
    expect(page.items.map((i) => i.isFavourite)).toEqual([true, false, null]);
  });

  it('reads the media type from the details every row ends with, and refuses a row without them', () => {
    const page = normalizeTimelinePage(timelinePayload([
      rawLibraryItem({ mediaKey: mediaKey('p') }),
      rawLibraryItem({ mediaKey: mediaKey('v'), videoDurationMs: 5000 }),
    ], null));
    expect(page.items.map((i) => i.mediaType)).toEqual(['PHOTO', 'VIDEO']);
    protocolFailure(() => normalizeTimelinePage(timelinePayload([rawLibraryItem({ favourite: 'missing-ext' })], null)));
  });

  it('refuses a row with a field more or less than Google sends', () => {
    const row = rawLibraryItem();
    protocolFailure(() => normalizeTimelinePage(timelinePayload([[...row.slice(0, 3), ...row.slice(4)]], null)));
    protocolFailure(() => normalizeTimelinePage(timelinePayload([[...row.slice(0, 3), null, null, ...row.slice(3)]], null)));
    // One more list before the details is a shape Google does send.
    expect(normalizeTimelinePage(timelinePayload([[...row.slice(0, -1), [1], row.at(-1)]], null)).items).toHaveLength(1);
  });

  it('reads ownership and archive flags without defaulting', () => {
    const page = normalizeTimelinePage(timelinePayload([
      rawLibraryItem({ mediaKey: mediaKey('mine') }),
      rawLibraryItem({ mediaKey: mediaKey('theirs'), notOwned: true }),
      rawLibraryItem({ mediaKey: mediaKey('noflags'), flags: null, archived: null }),
      rawLibraryItem({ mediaKey: mediaKey('archived'), archived: true }),
    ], null));
    expect(page.items.map((i) => i.isOwned)).toEqual([true, false, null, true]);
    expect(page.items.map((i) => i.isArchived)).toEqual([false, false, null, true]);
  });

  it('parses the next-page marker and the timestamp cursor', () => {
    const page = normalizeTimelinePage(timelinePayload([rawLibraryItem()], marker('p2'), '1690000000000'));
    expect(page.nextPageToken).toBe(marker('p2'));
    expect(page.lastItemTakenAtMs).toBe(1_690_000_000_000);
  });

  it('the last page is just [items]; anything else where the marker belongs is refused', () => {
    expect(normalizeTimelinePage(timelinePayload([rawLibraryItem()], null)).nextPageToken).toBeNull();
    for (const value of [...NOT_MARKERS, '']) {
      protocolFailure(() => normalizeTimelinePage([[rawLibraryItem()], value, '1700000000000']));
    }
  });

  it('an empty listing (an empty archive answers []) is a last page with nothing on it', () => {
    expect(normalizeTimelinePage([])).toEqual({ items: [], nextPageToken: null, lastItemTakenAtMs: null });
    expect(normalizeGenericPage([null, null]).items).toEqual([]);
    // A long listing of this kind can end with a page of nothing after the last photos.
    expect(normalizeGenericPage([null, ''])).toEqual({ items: [], nextPageToken: null, lastItemTakenAtMs: null });
  });

  it('a page with no items cannot say more follow', () => {
    protocolFailure(() => normalizeTimelinePage([[], marker(), '1700000000000']));
    protocolFailure(() => normalizeGenericPage([null, marker()]));
  });

  it('fails the whole page when an item has no stable key, or a key of the wrong form', () => {
    for (const bad of [
      { dedupKey: null },
      { mediaKey: '' },
      { takenAtMs: null },
      { mediaKey: 'AF1QipSHORT' },
      { mediaKey: mediaKey('a').replace('AF1Qip', 'AF1Qix') },
      { mediaKey: `${mediaKey('a').slice(0, -1)}.` },
      { dedupKey: 'DEDUP' },
      { dedupKey: `${dedupKey('a')}:` },
      { dedupKey: `${dedupKey('a')}:short` },
      { dedupKey: dedupKey('a b') },
    ] as const) {
      protocolFailure(() => normalizeTimelinePage(timelinePayload([rawLibraryItem(), rawLibraryItem(bad)], null)));
    }
  });

  it('accepts the rarer dedup key with a suffix after ":"', () => {
    const keys = [`${dedupKey('a')}:${'b'.repeat(11)}`, `${dedupKey('c')}:${'d'.repeat(16)}`];
    const page = normalizeTimelinePage(timelinePayload(keys.map((k) => rawLibraryItem({ dedupKey: k })), null));
    expect(page.items.map((i) => i.dedupKey)).toEqual(keys);
  });

  it('rejects a payload that is not a page', () => {
    protocolFailure(() => normalizeTimelinePage({ unexpected: true }));
    protocolFailure(() => normalizeGenericPage(['not-a-list', null]));
  });

  it('exposes the uploader actor from the generic listing, whose last page ends with ""', () => {
    const page = normalizeGenericPage(genericPayload([rawLibraryItem({ actorId: 'ACTOR_ME', favourite: true })], null));
    expect(page.items[0].uploaderActorId).toBe('ACTOR_ME');
    expect(page.items[0].isFavourite).toBe(true);
    expect(page.nextPageToken).toBeNull();
    expect(normalizeGenericPage(genericPayload([rawLibraryItem()], marker())).nextPageToken).toBe(marker());
    for (const value of NOT_MARKERS) protocolFailure(() => normalizeGenericPage([[rawLibraryItem()], value]));
    protocolFailure(() => normalizeGenericPage([[rawLibraryItem()]]));
  });
});

describe('archive pages', () => {
  it('reads the short rows the archive-only listing sends, every one archived', () => {
    const page = normalizeArchivePage(timelinePayload([
      rawArchiveItem(mediaKey('a'), dedupKey('a')),
      rawArchiveItem(mediaKey('b'), dedupKey('b'), true),
    ], null));
    expect(page.items.map((i) => [i.mediaKey, i.dedupKey, i.isArchived])).toEqual([
      [mediaKey('a'), dedupKey('a'), true],
      [mediaKey('b'), dedupKey('b'), true],
    ]);
    expect(page.nextPageToken).toBeNull();
    expect(normalizeArchivePage(timelinePayload([rawArchiveItem()], marker('p2'))).nextPageToken).toBe(marker('p2'));
    expect(normalizeArchivePage([])).toEqual({ items: [], nextPageToken: null, lastItemTakenAtMs: null });
  });

  it('refuses rows of another length, keys of the wrong form, and anything else where the marker belongs', () => {
    const row = rawArchiveItem();
    protocolFailure(() => normalizeArchivePage(timelinePayload([rawLibraryItem()], null)));
    protocolFailure(() => normalizeArchivePage(timelinePayload([[...row.slice(0, -1), null, row.at(-1)]], null)));
    protocolFailure(() => normalizeArchivePage(timelinePayload([[...row.slice(0, -1), null]], null)));
    protocolFailure(() => normalizeArchivePage(timelinePayload([rawArchiveItem(mediaKey('a'), 'DEDUP')], null)));
    for (const value of [...NOT_MARKERS, '']) protocolFailure(() => normalizeArchivePage([[rawArchiveItem()], value, '1700000000000']));
  });

  it('the library listing still refuses the archive’s short rows', () => {
    protocolFailure(() => normalizeTimelinePage(timelinePayload([rawArchiveItem()], null)));
  });
});

describe('the album list', () => {
  it('keeps kind, shared flag and reported count raw', () => {
    const regular = albumKey('regular');
    const shared = albumKey('shared', true);
    const page = normalizeAlbumsPage(albumsPayload([
      rawAlbum({ albumKey: regular }),
      rawAlbum({ albumKey: shared, kind: 4, shared: true, authKey: 'AUTH', ownerActorId: 'ACTOR_OTHER' }),
      rawAlbum({ albumKey: albumKey('empty'), count: 0 }),
    ], marker()));
    expect(page.albums.map((a) => [a.albumKey, a.kindCode, a.isShared, a.reportedItemCount, a.ownerActorId])).toEqual([
      [regular, 1, null, 12, 'ACTOR_ME'],
      [shared, 4, true, 12, 'ACTOR_OTHER'],
      [albumKey('empty'), 1, null, 0, 'ACTOR_ME'],
    ]);
    expect(page.albums[1].authKey).toBe('AUTH');
    expect(page.nextPageToken).toBe(marker());
  });

  it('the last page is just [albums]; anything else where the marker belongs is refused', () => {
    expect(normalizeAlbumsPage(albumsPayload([rawAlbum()], null)).nextPageToken).toBeNull();
    for (const value of [...NOT_MARKERS, '']) protocolFailure(() => normalizeAlbumsPage([[rawAlbum()], value]));
  });

  it('refuses an album without a count, or with one that is not a whole number', () => {
    for (const count of [null, -1, 1.5]) protocolFailure(() => normalizeAlbumsPage(albumsPayload([rawAlbum({ count })], null)));
    protocolFailure(() => normalizeAlbumsPage(albumsPayload([rawAlbum({ count: '12' as never })], null)));
  });

  it('refuses an album without a key, or with a key of the wrong form', () => {
    for (const key of [null, 'AF1QipALBUM', albumKey('a').slice(0, -1), `${albumKey('a')}x`, albumKey('a').replace('A', '#')]) {
      protocolFailure(() => normalizeAlbumsPage(albumsPayload([rawAlbum({ albumKey: key })], null)));
    }
  });

  it('refuses an album row of another length, or without its details', () => {
    const row = rawAlbum();
    protocolFailure(() => normalizeAlbumsPage(albumsPayload([[...row.slice(0, -1), null, row.at(-1)]], null)));
    protocolFailure(() => normalizeAlbumsPage(albumsPayload([[...row.slice(0, -1), null]], null)));
    protocolFailure(() => normalizeAlbumsPage(albumsPayload([[...row.slice(0, -1), { other: [] }]], null)));
  });
});

describe('album contents', () => {
  it('parses album entries with their own key and the shared dedup key', () => {
    const page = normalizeAlbumItemsPage(albumItemsPayload([
      rawAlbumMember(mediaKey('scoped'), dedupKey('DEDUP')),
      rawAlbumMember(mediaKey('short', true), dedupKey('OTHER')),
    ], marker('p2'), 7));
    expect(page.items.map((i) => [i.mediaKey, i.dedupKey])).toEqual([[mediaKey('scoped'), dedupKey('DEDUP')], [mediaKey('short', true), dedupKey('OTHER')]]);
    expect(page.albumKey).toBe(albumKey('ALBUM'));
    expect(page.reportedItemCount).toBe(7);
    expect(page.ownerActorId).toBe('ACTOR_OWNER');
    expect(page.nextPageToken).toBe(marker('p2'));
  });

  it('the last page ends with ""; anything else where the marker belongs is refused', () => {
    const entries = [rawAlbumMember(mediaKey('a'), dedupKey('a'))];
    expect(normalizeAlbumItemsPage(albumItemsPayload(entries, null)).nextPageToken).toBeNull();
    for (const value of NOT_MARKERS) {
      const payload = albumItemsPayload(entries, null);
      payload[2] = value;
      protocolFailure(() => normalizeAlbumItemsPage(payload));
    }
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload(entries, null).slice(0, 2)));
  });

  it('only an empty album sends no list of entries', () => {
    expect(normalizeAlbumItemsPage(albumItemsPayload(null, null, 0)).items).toEqual([]);
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload(null, null, 5)));
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload(null, marker(), 0)));
  });

  it("refuses a page without the album's details, its count, or a proper album key", () => {
    const entries = [rawAlbumMember(mediaKey('a'), dedupKey('a'))];
    const noDetails = albumItemsPayload(entries, null);
    noDetails[3] = null;
    protocolFailure(() => normalizeAlbumItemsPage(noDetails));
    for (const count of [null, -1, 2.5]) protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload(entries, null, count as number)));
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload(entries, null, 1, 'AF1QipALBUM')));
  });

  it('fails an album page with an entry lacking a dedup key, or of another shape', () => {
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload([rawAlbumMember(mediaKey('k'), '')], null)));
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload([rawAlbumMember('k', dedupKey('k'))], null)));
    const entry = rawAlbumMember(mediaKey('k'), dedupKey('k'));
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload([[...entry.slice(0, -1)]], null)));
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload([[...entry.slice(0, -1), null, null, entry.at(-1)]], null)));
    expect(normalizeAlbumItemsPage(albumItemsPayload([[...entry.slice(0, -1), 1, entry.at(-1)]], null)).items).toHaveLength(1);
  });
});

describe('the trash', () => {
  it('reads dedup keys page by page; the last page is just [items]', () => {
    expect(normalizeTrashPage([[rawTrashItem(dedupKey('a'))], marker()])).toEqual({ dedupKeys: [dedupKey('a')], nextPageToken: marker() });
    expect(normalizeTrashPage([[rawTrashItem(dedupKey('a')), rawTrashItem(dedupKey('b'))]])).toEqual({ dedupKeys: [dedupKey('a'), dedupKey('b')], nextPageToken: null });
    expect(normalizeTrashPage([]).dedupKeys).toEqual([]);
  });

  it('refuses anything else where the marker belongs, keys of the wrong form, and rows of another length', () => {
    for (const value of [...NOT_MARKERS, '']) protocolFailure(() => normalizeTrashPage([[rawTrashItem(dedupKey('a'))], value]));
    protocolFailure(() => normalizeTrashPage([[rawTrashItem('dk1')]]));
    protocolFailure(() => normalizeTrashPage([[rawTrashItem(dedupKey('a')).slice(0, 6)]]));
    protocolFailure(() => normalizeTrashPage([[[...rawTrashItem(dedupKey('a')), {}]]]));
  });
});
