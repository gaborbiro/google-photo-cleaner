package dev.photocleaner.services.connector

import dev.photocleaner.services.connector.domain.Album
import dev.photocleaner.services.connector.domain.AlbumItemsPage
import dev.photocleaner.services.connector.domain.AlbumMember
import dev.photocleaner.services.connector.domain.AlbumsPage
import dev.photocleaner.services.connector.domain.ConnectorException
import dev.photocleaner.services.connector.domain.LibraryItem
import dev.photocleaner.services.connector.domain.LibraryPage
import dev.photocleaner.services.connector.domain.MediaType
import dev.photocleaner.services.connector.domain.PhotosConnector
import dev.photocleaner.services.connector.domain.PhotosSession
import dev.photocleaner.services.connector.domain.PreviewImage
import dev.photocleaner.services.connector.wire.AlbumItemsPageDto
import dev.photocleaner.services.connector.wire.AlbumsPageDto
import dev.photocleaner.services.connector.wire.LibraryItemDto
import dev.photocleaner.services.connector.wire.LibraryPageDto
import dev.photocleaner.services.connector.wire.PreviewDto
import dev.photocleaner.services.connector.wire.StatusDto
import dev.photocleaner.services.connector.wire.wireJson
import java.util.Base64
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class ExtensionPhotosConnector(private val link: ExtensionLink) : PhotosConnector {

    override suspend fun sessionStatus(): PhotosSession {
        val dto = call("status", buildJsonObject { }, StatusDto.serializer())
        if (!dto.signedIn) throw ConnectorException.SessionExpired("Not signed in to Google Photos", null)
        return PhotosSession(dto.accountFingerprint, dto.photosTabCount)
    }

    override suspend fun libraryPage(pageToken: String?, takenAtOrBeforeMs: Long?, includeShape: Boolean): LibraryPage {
        val params = buildJsonObject {
            pageToken?.let { put("pageToken", it) }
            takenAtOrBeforeMs?.let { put("takenAtOrBeforeMs", it) }
            if (includeShape) put("includeShape", true)
        }
        return call("listLibraryPage", params, LibraryPageDto.serializer()).toDomain()
    }

    override suspend fun favouritesPage(pageToken: String?, includeShape: Boolean): LibraryPage {
        val params = buildJsonObject {
            pageToken?.let { put("pageToken", it) }
            if (includeShape) put("includeShape", true)
        }
        return call("listFavouritesPage", params, LibraryPageDto.serializer()).toDomain()
    }

    override suspend fun archivePage(pageToken: String?, includeShape: Boolean): LibraryPage {
        val params = buildJsonObject {
            pageToken?.let { put("pageToken", it) }
            if (includeShape) put("includeShape", true)
        }
        return call("listArchivePage", params, LibraryPageDto.serializer()).toDomain()
    }

    override suspend fun albumsPage(pageToken: String?, includeShape: Boolean): AlbumsPage {
        val params = buildJsonObject {
            pageToken?.let { put("pageToken", it) }
            if (includeShape) put("includeShape", true)
        }
        val dto = call("listAlbumsPage", params, AlbumsPageDto.serializer())
        return AlbumsPage(
            albums = dto.albums.map {
                Album(it.albumKey, it.title, it.ownerActorId, it.reportedItemCount, it.isShared, it.kindCode, it.authKey)
            },
            nextPageToken = dto.nextPageToken,
            accountFingerprint = dto.accountFingerprint,
            shapeSample = dto.shapeSample?.toString(),
        )
    }

    override suspend fun albumItemsPage(albumKey: String, authKey: String?, pageToken: String?, includeShape: Boolean): AlbumItemsPage {
        val params = buildJsonObject {
            put("albumKey", albumKey)
            authKey?.let { put("authKey", it) }
            pageToken?.let { put("pageToken", it) }
            if (includeShape) put("includeShape", true)
        }
        val dto = call("listAlbumItemsPage", params, AlbumItemsPageDto.serializer())
        return AlbumItemsPage(
            albumKey = dto.albumKey,
            items = dto.items.map { AlbumMember(it.mediaKey, it.dedupKey, it.takenAtMs, mediaType(it.mediaType), it.uploaderActorId) },
            nextPageToken = dto.nextPageToken,
            reportedItemCount = dto.reportedItemCount,
            ownerActorId = dto.ownerActorId,
            accountFingerprint = dto.accountFingerprint,
            shapeSample = dto.shapeSample?.toString(),
        )
    }

    override suspend fun preview(thumbUrl: String, sizePx: Int): PreviewImage {
        val params = buildJsonObject {
            put("thumbUrl", thumbUrl)
            put("sizePx", sizePx)
        }
        val dto = call("fetchPreview", params, PreviewDto.serializer())
        val bytes = try {
            Base64.getDecoder().decode(dto.base64)
        } catch (e: IllegalArgumentException) {
            throw ConnectorException.ProtocolMismatch("Preview bytes were not valid base64")
        }
        if (bytes.size != dto.byteLength) throw ConnectorException.ProtocolMismatch("Preview size mismatch")
        return PreviewImage(dto.contentType, bytes)
    }

    private suspend fun <T> call(op: String, params: JsonObject, deserializer: DeserializationStrategy<T>): T {
        val data: JsonElement = link.request(op, params)
        return try {
            wireJson.decodeFromJsonElement(deserializer, data)
        } catch (e: SerializationException) {
            // The exception text can quote the JSON input (keys, URLs), so only its type is kept.
            throw ConnectorException.ProtocolMismatch("Unexpected $op data from the extension (${e.javaClass.simpleName})")
        } catch (e: IllegalArgumentException) {
            throw ConnectorException.ProtocolMismatch("Unexpected $op data from the extension (${e.javaClass.simpleName})")
        }
    }

    private fun LibraryPageDto.toDomain() = LibraryPage(
        items = items.map { it.toDomain() },
        nextPageToken = nextPageToken,
        lastItemTakenAtMs = lastItemTakenAtMs,
        accountFingerprint = accountFingerprint,
        shapeSample = shapeSample?.toString(),
    )

    private fun LibraryItemDto.toDomain() = LibraryItem(
        mediaKey = mediaKey,
        dedupKey = dedupKey,
        takenAtMs = takenAtMs,
        uploadedAtMs = uploadedAtMs,
        mediaType = mediaType(mediaType),
        isFavourite = isFavourite,
        isArchived = isArchived,
        isOwned = isOwned,
        uploaderActorId = uploaderActorId,
        width = width,
        height = height,
        thumbUrl = thumbUrl,
    )

    private fun mediaType(raw: String?): MediaType? = when (raw) {
        null -> null
        "PHOTO" -> MediaType.PHOTO
        "VIDEO" -> MediaType.VIDEO
        else -> throw ConnectorException.ProtocolMismatch("Unknown media type from the extension")
    }
}
