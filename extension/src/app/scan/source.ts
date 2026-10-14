// How a scan reads Google Photos: one page of one listing at a time, as the page script's
// read-only operations return them. In the extension the background page asks the service
// worker, which runs the operation in a Photos tab signed in to the scanned account.

import type { AlbumDto, AlbumItemsPageDto, AlbumsPageDto, LibraryPageDto } from '../../page/normalize';
import type { ErrorKind, OpResult, ReadOp } from '../../shared/protocol';
import type { AlbumRecord, EntryRef, InventoryItem } from './model';

/** A failure reported by the page script, by kind (see shared/protocol.ts). */
export class SourceError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly httpStatus: number | null = null,
    readonly rpcCode: number | null = null,
  ) {
    super(message);
  }
}

export interface Page<T> {
  entries: T[];
  nextPageToken: string | null;
  /** The account the page was read from; a scan never mixes accounts. */
  accountFingerprint: string;
}

export interface PhotosSource {
  status(): Promise<{ accountFingerprint: string }>;
  libraryPage(pageToken: string | null): Promise<Page<InventoryItem>>;
  favouritesPage(pageToken: string | null): Promise<Page<EntryRef>>;
  archivePage(pageToken: string | null): Promise<Page<EntryRef>>;
  albumsPage(pageToken: string | null): Promise<Page<AlbumRecord>>;
  albumItemsPage(albumKey: string, authKey: string | null, pageToken: string | null): Promise<Page<EntryRef>>;
}

/** What the analysis needs to know about a library photo, read fresh so its preview link works. */
export interface LibraryPhoto {
  mediaKey: string;
  mediaType: 'PHOTO' | 'VIDEO' | null;
  uploadedAtMs: number | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
}

export interface Preview {
  contentType: string;
  bytes: Uint8Array;
}

/** Google Photos as the analysis reads it: the library again, newest first, and previews. */
export interface AnalysisSource {
  libraryPhotos(pageToken: string | null): Promise<Page<LibraryPhoto>>;
  preview(thumbUrl: string, sizePx: number): Promise<Preview>;
}

export type RunOp = (op: ReadOp, params: Record<string, unknown>) => Promise<OpResult>;

type WithAccount<T> = T & { accountFingerprint: string };

/** A [PhotosSource] over the page script's operations, mapped as the desktop's connector maps them. */
export class OpPhotosSource implements PhotosSource, AnalysisSource {
  constructor(private readonly run: RunOp) {}

  private async call<T>(op: ReadOp, params: Record<string, unknown>): Promise<T> {
    const result = await this.run(op, params);
    if (!result.ok) {
      const e = result.error;
      throw new SourceError(e.kind, e.message, e.httpStatus ?? null, e.rpcCode ?? null);
    }
    return result.data as T;
  }

  async status() {
    return this.call<{ accountFingerprint: string }>('status', {});
  }

  async libraryPage(pageToken: string | null): Promise<Page<InventoryItem>> {
    const dto = await this.call<WithAccount<LibraryPageDto>>('listLibraryPage', pageToken ? { pageToken } : {});
    return {
      entries: dto.items.map((i) => ({
        mediaKey: i.mediaKey,
        dedupKey: i.dedupKey,
        takenAtMs: i.takenAtMs,
        mediaType: i.mediaType,
        isFavourite: i.isFavourite,
        isArchived: i.isArchived,
        isOwned: i.isOwned,
        width: i.width,
        height: i.height,
        thumbUrl: i.thumbUrl,
      })),
      nextPageToken: dto.nextPageToken,
      accountFingerprint: dto.accountFingerprint,
    };
  }

  async libraryPhotos(pageToken: string | null): Promise<Page<LibraryPhoto>> {
    const dto = await this.call<WithAccount<LibraryPageDto>>('listLibraryPage', pageToken ? { pageToken } : {});
    return {
      entries: dto.items.map((i) => ({ mediaKey: i.mediaKey, mediaType: i.mediaType, uploadedAtMs: i.uploadedAtMs, width: i.width, height: i.height, thumbUrl: i.thumbUrl })),
      nextPageToken: dto.nextPageToken,
      accountFingerprint: dto.accountFingerprint,
    };
  }

  async preview(thumbUrl: string, sizePx: number): Promise<Preview> {
    const dto = await this.call<{ contentType: string; base64: string }>('fetchPreview', { thumbUrl, sizePx });
    const binary = atob(dto.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { contentType: dto.contentType, bytes };
  }

  private async refs(op: ReadOp, pageToken: string | null): Promise<Page<EntryRef>> {
    const dto = await this.call<WithAccount<LibraryPageDto>>(op, pageToken ? { pageToken } : {});
    return { entries: dto.items.map((i) => ({ mediaKey: i.mediaKey, dedupKey: i.dedupKey })), nextPageToken: dto.nextPageToken, accountFingerprint: dto.accountFingerprint };
  }

  favouritesPage(pageToken: string | null) {
    return this.refs('listFavouritesPage', pageToken);
  }

  archivePage(pageToken: string | null) {
    return this.refs('listArchivePage', pageToken);
  }

  async albumsPage(pageToken: string | null): Promise<Page<AlbumRecord>> {
    const dto = await this.call<WithAccount<AlbumsPageDto>>('listAlbumsPage', pageToken ? { pageToken } : {});
    return {
      entries: dto.albums.map((a: AlbumDto) => ({
        albumKey: a.albumKey,
        title: a.title,
        ownerActorId: a.ownerActorId,
        isShared: a.isShared,
        kindCode: a.kindCode,
        reportedItemCount: a.reportedItemCount,
        authKey: a.authKey,
      })),
      nextPageToken: dto.nextPageToken,
      accountFingerprint: dto.accountFingerprint,
    };
  }

  async albumItemsPage(albumKey: string, authKey: string | null, pageToken: string | null): Promise<Page<EntryRef>> {
    const params: Record<string, unknown> = { albumKey };
    if (authKey) params['authKey'] = authKey;
    if (pageToken) params['pageToken'] = pageToken;
    const dto = await this.call<WithAccount<AlbumItemsPageDto>>('listAlbumItemsPage', params);
    return { entries: dto.items.map((i) => ({ mediaKey: i.mediaKey, dedupKey: i.dedupKey })), nextPageToken: dto.nextPageToken, accountFingerprint: dto.accountFingerprint };
  }
}
