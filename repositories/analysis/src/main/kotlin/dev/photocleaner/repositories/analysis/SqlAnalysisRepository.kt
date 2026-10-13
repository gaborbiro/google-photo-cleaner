package dev.photocleaner.repositories.analysis

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import dev.photocleaner.repositories.analysis.db.AnalysisDatabase
import dev.photocleaner.repositories.analysis.db.AnalysisQueries
import dev.photocleaner.repositories.analysis.domain.CalibrationPair
import dev.photocleaner.repositories.analysis.domain.CalibrationRepository
import dev.photocleaner.repositories.analysis.domain.EmbeddingRepository
import dev.photocleaner.repositories.analysis.domain.PairKind
import dev.photocleaner.repositories.analysis.domain.PairLabel
import dev.photocleaner.repositories.analysis.domain.PhotoInfo
import dev.photocleaner.repositories.analysis.domain.StoredEmbedding
import dev.photocleaner.repositories.analysis.domain.StoredQuality
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Embeddings and calibration labels, in their own database file (separate from scan runs). */
class SqlAnalysisRepository(
    database: AnalysisDatabase,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : EmbeddingRepository, CalibrationRepository {

    private val q: AnalysisQueries = database.analysisQueries

    override suspend fun save(embeddings: List<StoredEmbedding>) {
        withContext(io) {
            q.transaction {
                embeddings.forEach { e ->
                    q.upsertEmbedding(
                        media_key = e.mediaKey,
                        model_key = e.modelKeyId,
                        dedup_key = e.dedupKey,
                        vector = encode(e.vector),
                        sharpness = e.quality.sharpness,
                        brightness = e.quality.brightness,
                        clipped_dark = e.quality.clippedDark,
                        clipped_bright = e.quality.clippedBright,
                        width = e.quality.width.toLong(),
                        height = e.quality.height.toLong(),
                        created_at = e.createdAtMs,
                    )
                }
            }
        }
    }

    override suspend fun find(modelKeyId: String, mediaKeys: Collection<String>): Map<String, StoredEmbedding> = withContext(io) {
        mediaKeys.distinct().chunked(IN_CHUNK).flatMap { chunk ->
            q.selectEmbeddings(modelKeyId, chunk).executeAsList().map { row ->
                StoredEmbedding(
                    mediaKey = row.media_key,
                    dedupKey = row.dedup_key,
                    modelKeyId = row.model_key,
                    vector = decode(row.vector),
                    quality = StoredQuality(row.sharpness, row.brightness, row.clipped_dark, row.clipped_bright, row.width.toInt(), row.height.toInt()),
                    createdAtMs = row.created_at,
                )
            }
        }.associateBy { it.mediaKey }
    }

    override suspend fun storedKeys(modelKeyId: String): Set<String> = withContext(io) {
        q.selectStoredKeys(modelKeyId).executeAsList().toSet()
    }

    override suspend fun savePhotoInfo(info: List<PhotoInfo>) {
        withContext(io) {
            q.transaction {
                info.forEach { q.upsertPhotoInfo(it.mediaKey, it.uploadedAtMs, it.width?.toLong(), it.height?.toLong()) }
            }
        }
    }

    override suspend fun photoInfo(mediaKeys: Collection<String>): Map<String, PhotoInfo> = withContext(io) {
        mediaKeys.distinct().chunked(IN_CHUNK).flatMap { chunk ->
            q.selectPhotoInfo(chunk).executeAsList().map { PhotoInfo(it.media_key, it.uploaded_at, it.width?.toInt(), it.height?.toInt()) }
        }.associateBy { it.mediaKey }
    }

    override suspend fun replacePairs(pairs: List<CalibrationPair>) {
        withContext(io) {
            q.transaction {
                q.deletePairs()
                pairs.forEach { p ->
                    q.insertPair(p.pairId, p.mediaKeyA, p.mediaKeyB, p.kind.name, p.takenGapMs, p.order.toLong(), p.label?.name, p.labelledAtMs)
                }
            }
        }
    }

    override suspend fun pairs(): List<CalibrationPair> = withContext(io) {
        q.selectPairs().executeAsList().map { row ->
            CalibrationPair(
                pairId = row.pair_id,
                mediaKeyA = row.media_key_a,
                mediaKeyB = row.media_key_b,
                kind = PairKind.valueOf(row.kind),
                takenGapMs = row.taken_gap_ms,
                order = row.display_order.toInt(),
                label = row.label?.let(PairLabel::valueOf),
                labelledAtMs = row.labelled_at,
            )
        }
    }

    override suspend fun setLabel(pairId: String, label: PairLabel?, atMs: Long?) {
        withContext(io) { q.updateLabel(label?.name, atMs, pairId) }
    }

    companion object {
        private const val IN_CHUNK = 500

        fun open(file: Path): SqlAnalysisRepository {
            Files.createDirectories(file.parent)
            return SqlAnalysisRepository(AnalysisDatabase(JdbcSqliteDriver("jdbc:sqlite:$file", Properties(), AnalysisDatabase.Schema)))
        }

        fun inMemory(): SqlAnalysisRepository =
            SqlAnalysisRepository(AnalysisDatabase(JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY, Properties(), AnalysisDatabase.Schema)))

        /** Vectors are stored as little-endian float32. */
        internal fun encode(vector: FloatArray): ByteArray =
            ByteBuffer.allocate(vector.size * 4).order(ByteOrder.LITTLE_ENDIAN).apply { asFloatBuffer().put(vector) }.array()

        internal fun decode(bytes: ByteArray): FloatArray {
            check(bytes.size % 4 == 0) { "Corrupt embedding blob" }
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
            return FloatArray(buffer.remaining()).also(buffer::get)
        }
    }
}
