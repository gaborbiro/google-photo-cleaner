package dev.photocleaner.features.duplicates.usecase

import dev.photocleaner.features.shared.duplicates.DuplicateGrouper
import dev.photocleaner.features.shared.duplicates.model.DuplicateGroupsResult
import dev.photocleaner.features.shared.duplicates.model.GroupingSettings
import dev.photocleaner.features.shared.duplicates.model.PhotoAnalysis
import dev.photocleaner.features.shared.embeddings.EmbeddingSettings
import dev.photocleaner.features.shared.protection.usecase.ClassifyInventoryUseCase
import dev.photocleaner.repositories.analysis.domain.EmbeddingRepository
import dev.photocleaner.repositories.inventory.domain.StoredMediaType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Builds duplicate groups from the latest inventory and the stored embeddings, by the shared
 * rules in [DuplicateGrouper] (the browser extension applies the same ones).
 */
class BuildDuplicateGroupsUseCase(
    private val classify: ClassifyInventoryUseCase,
    private val embeddings: EmbeddingRepository,
    private val settings: GroupingSettings = GroupingSettings(),
) {

    suspend fun execute(): DuplicateGroupsResult {
        val classification = classify.execute()
        val keys = classification?.items.orEmpty().filter { it.item.mediaType == StoredMediaType.PHOTO }.map { it.item.mediaKey }
        val stored = if (keys.isEmpty()) emptyMap() else embeddings.find(EmbeddingSettings.modelKey(settings.tokenBudget).id, keys)
        val info = if (keys.isEmpty()) emptyMap() else embeddings.photoInfo(keys)
        val analyses = stored.mapValues { (key, embedding) ->
            val meta = info[key]
            PhotoAnalysis(
                vector = embedding.vector,
                sharpness = embedding.quality.sharpness,
                clipped = embedding.quality.clippedDark + embedding.quality.clippedBright,
                analysedAtMs = embedding.createdAtMs,
                uploadedAtMs = meta?.uploadedAtMs,
                width = meta?.width,
                height = meta?.height,
            )
        }
        return withContext(Dispatchers.Default) { DuplicateGrouper.build(classification, analyses, settings) }
    }
}
