package dev.photocleaner.services.connector.wire

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// Mirrors extension/src/shared/protocol.ts and extension/src/page/normalize.ts.

internal val wireJson = Json {
    ignoreUnknownKeys = false
    explicitNulls = false
    encodeDefaults = true
}

@Serializable
internal data class HelloMessage(val t: String, val token: String, val extensionVersion: String)

@Serializable
internal data class WelcomeMessage(val appVersion: String, val t: String = "welcome")

@Serializable
internal data class CommandMessage(val id: String, val op: String, val params: JsonObject, val t: String = "cmd")

@Serializable
internal data class ResultMessage(val t: String, val id: String, val result: OpResultDto)

@Serializable
internal data class OpResultDto(val ok: Boolean, val data: JsonElement? = null, val error: OpErrorDto? = null)

@Serializable
internal data class OpErrorDto(val kind: String, val message: String, val httpStatus: Int? = null, val rpcCode: Int? = null)

@Serializable
internal data class StatusDto(val signedIn: Boolean, val accountFingerprint: String, val photosTabCount: Int)

@Serializable
internal data class LibraryItemDto(
    val mediaKey: String,
    val dedupKey: String,
    val takenAtMs: Long,
    val uploadedAtMs: Long?,
    val mediaType: String?,
    val isFavourite: Boolean?,
    val isArchived: Boolean?,
    val isOwned: Boolean?,
    val uploaderActorId: String?,
    val width: Int?,
    val height: Int?,
    val thumbUrl: String?,
)

@Serializable
internal data class LibraryPageDto(
    val items: List<LibraryItemDto>,
    val nextPageToken: String?,
    val lastItemTakenAtMs: Long?,
    val accountFingerprint: String,
    val shapeSample: JsonElement? = null,
)

@Serializable
internal data class AlbumDto(
    val albumKey: String,
    val title: String?,
    val ownerActorId: String?,
    val reportedItemCount: Int?,
    val isShared: Boolean?,
    val kindCode: Int?,
    val authKey: String?,
)

@Serializable
internal data class AlbumsPageDto(
    val albums: List<AlbumDto>,
    val nextPageToken: String?,
    val accountFingerprint: String,
    val shapeSample: JsonElement? = null,
)

@Serializable
internal data class AlbumMemberDto(
    val mediaKey: String,
    val dedupKey: String,
    val takenAtMs: Long,
    val mediaType: String?,
    val uploaderActorId: String?,
)

@Serializable
internal data class AlbumItemsPageDto(
    val albumKey: String?,
    val items: List<AlbumMemberDto>,
    val nextPageToken: String?,
    val reportedItemCount: Int?,
    val ownerActorId: String?,
    val accountFingerprint: String,
    val shapeSample: JsonElement? = null,
)

@Serializable
internal data class PreviewDto(val contentType: String, val byteLength: Int, val base64: String)
