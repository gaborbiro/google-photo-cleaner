package dev.photocleaner.features.scan.usecase

import dev.photocleaner.repositories.inventory.domain.AlbumMemberEntry
import dev.photocleaner.repositories.inventory.domain.AlbumRecord
import dev.photocleaner.repositories.inventory.domain.ArchiveEntry
import dev.photocleaner.repositories.inventory.domain.FavouriteEntry
import dev.photocleaner.repositories.inventory.domain.InventoryItem
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import dev.photocleaner.services.connector.domain.Album
import dev.photocleaner.services.connector.domain.AlbumMember
import dev.photocleaner.services.connector.domain.LibraryItem
import dev.photocleaner.services.connector.domain.MediaType

internal fun LibraryItem.toInventoryItem() = InventoryItem(
    mediaKey = mediaKey,
    dedupKey = dedupKey,
    takenAtMs = takenAtMs,
    mediaType = when (mediaType) {
        MediaType.PHOTO -> StoredMediaType.PHOTO
        MediaType.VIDEO -> StoredMediaType.VIDEO
        null -> null
    },
    isFavourite = isFavourite,
    isArchived = isArchived,
    isOwned = isOwned,
    width = width,
    height = height,
    thumbUrl = thumbUrl,
)

internal fun LibraryItem.toFavouriteEntry() = FavouriteEntry(mediaKey, dedupKey)

internal fun LibraryItem.toArchiveEntry() = ArchiveEntry(mediaKey, dedupKey)

internal fun Album.toRecord() = AlbumRecord(albumKey, title, ownerActorId, isShared, kindCode, reportedItemCount, authKey)

internal fun AlbumMember.toEntry() = AlbumMemberEntry(mediaKey, dedupKey)
