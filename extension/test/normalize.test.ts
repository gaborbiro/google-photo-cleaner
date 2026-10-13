import { describe, expect, it } from 'vitest';
import {
  normalizeAlbumItemsPage,
  normalizeAlbumsPage,
  normalizeGenericPage,
  normalizeTimelinePage,
} from '../src/page/normalize';
import { OpFailure } from '../src/page/rpc';
import {
  albumItemsPayload,
  albumsPayload,
  genericPayload,
  rawAlbum,
  rawAlbumMember,
  rawLibraryItem,
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

describe('library pages', () => {
  it('keeps favourite status tri-state', () => {
    const page = normalizeTimelinePage(timelinePayload([
      rawLibraryItem({ mediaKey: 'a', favourite: true }),
      rawLibraryItem({ mediaKey: 'b', favourite: false }),
      rawLibraryItem({ mediaKey: 'c', favourite: 'missing-field' }),
      rawLibraryItem({ mediaKey: 'd', favourite: 'missing-ext' }),
    ], 'next'));
    expect(page.items.map((i) => i.isFavourite)).toEqual([true, false, null, null]);
  });

  it('treats a missing extension object as unknown media type', () => {
    const page = normalizeTimelinePage(timelinePayload([
      rawLibraryItem({ mediaKey: 'p' }),
      rawLibraryItem({ mediaKey: 'v', videoDurationMs: 5000 }),
      rawLibraryItem({ mediaKey: 'u', favourite: 'missing-ext' }),
    ], null));
    expect(page.items.map((i) => i.mediaType)).toEqual(['PHOTO', 'VIDEO', null]);
  });

  it('reads ownership and archive flags without defaulting', () => {
    const page = normalizeTimelinePage(timelinePayload([
      rawLibraryItem({ mediaKey: 'mine' }),
      rawLibraryItem({ mediaKey: 'theirs', notOwned: true }),
      rawLibraryItem({ mediaKey: 'noflags', flags: null, archived: null }),
      rawLibraryItem({ mediaKey: 'archived', archived: true }),
    ], null));
    expect(page.items.map((i) => i.isOwned)).toEqual([true, false, null, true]);
    expect(page.items.map((i) => i.isArchived)).toEqual([false, false, null, true]);
  });

  it('parses page token and timestamp cursor', () => {
    const page = normalizeTimelinePage(timelinePayload([rawLibraryItem()], 'tok', '1690000000000'));
    expect(page.nextPageToken).toBe('tok');
    expect(page.lastItemTakenAtMs).toBe(1_690_000_000_000);
  });

  it('treats an empty token as the last page', () => {
    expect(normalizeTimelinePage(timelinePayload([rawLibraryItem()], '')).nextPageToken).toBeNull();
  });

  it('accepts an empty page', () => {
    const page = normalizeGenericPage([null, null]);
    expect(page.items).toEqual([]);
    expect(page.nextPageToken).toBeNull();
  });

  it('fails the whole page when an item has no stable key', () => {
    protocolFailure(() => normalizeTimelinePage(timelinePayload([rawLibraryItem(), rawLibraryItem({ dedupKey: null })], null)));
    protocolFailure(() => normalizeTimelinePage(timelinePayload([rawLibraryItem({ mediaKey: '' })], null)));
    protocolFailure(() => normalizeTimelinePage(timelinePayload([rawLibraryItem({ takenAtMs: null })], null)));
  });

  it('rejects a payload that is not a page', () => {
    protocolFailure(() => normalizeTimelinePage({ unexpected: true }));
    protocolFailure(() => normalizeGenericPage(['not-a-list', null]));
  });

  it('exposes the uploader actor from the generic listing', () => {
    const page = normalizeGenericPage(genericPayload([rawLibraryItem({ actorId: 'ACTOR_ME', favourite: true })], null));
    expect(page.items[0].uploaderActorId).toBe('ACTOR_ME');
    expect(page.items[0].isFavourite).toBe(true);
  });
});

describe('albums', () => {
  it('keeps kind, shared flag and reported count raw', () => {
    const page = normalizeAlbumsPage(albumsPayload([
      rawAlbum({ albumKey: 'regular' }),
      rawAlbum({ albumKey: 'shared', kind: 4, shared: true, authKey: 'AUTH', ownerActorId: 'ACTOR_OTHER' }),
      rawAlbum({ albumKey: 'nocount', count: null }),
    ], 'more'));
    expect(page.albums.map((a) => [a.albumKey, a.kindCode, a.isShared, a.reportedItemCount, a.ownerActorId])).toEqual([
      ['regular', 1, null, 12, 'ACTOR_ME'],
      ['shared', 4, true, 12, 'ACTOR_OTHER'],
      ['nocount', 1, null, null, 'ACTOR_ME'],
    ]);
    expect(page.albums[1].authKey).toBe('AUTH');
    expect(page.nextPageToken).toBe('more');
  });

  it('fails when an album has no key', () => {
    protocolFailure(() => normalizeAlbumsPage(albumsPayload([rawAlbum({ albumKey: null })], null)));
  });

  it('parses album members with their own key and the shared dedup key', () => {
    const page = normalizeAlbumItemsPage(albumItemsPayload([rawAlbumMember('albumScopedKey', 'DEDUP')], 'p2', 7));
    expect(page.items[0]).toMatchObject({ mediaKey: 'albumScopedKey', dedupKey: 'DEDUP' });
    expect(page.reportedItemCount).toBe(7);
    expect(page.ownerActorId).toBe('ACTOR_OWNER');
    expect(page.nextPageToken).toBe('p2');
  });

  it('fails an album page with a member lacking a dedup key', () => {
    protocolFailure(() => normalizeAlbumItemsPage(albumItemsPayload([rawAlbumMember('k', '')], null)));
  });
});
