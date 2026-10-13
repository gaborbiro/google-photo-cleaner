package dev.photocleaner.repositories.analysis.domain

interface EmbeddingRepository {

    suspend fun save(embeddings: List<StoredEmbedding>)

    /** Embeddings for [mediaKeys] under [modelKeyId]; missing keys are absent from the map. */
    suspend fun find(modelKeyId: String, mediaKeys: Collection<String>): Map<String, StoredEmbedding>

    suspend fun storedKeys(modelKeyId: String): Set<String>

    suspend fun savePhotoInfo(info: List<PhotoInfo>)

    suspend fun photoInfo(mediaKeys: Collection<String>): Map<String, PhotoInfo>
}

interface CalibrationRepository {

    /** Replaces the current calibration pair set; existing labels are discarded. */
    suspend fun replacePairs(pairs: List<CalibrationPair>)

    suspend fun pairs(): List<CalibrationPair>

    suspend fun setLabel(pairId: String, label: PairLabel?, atMs: Long?)
}
