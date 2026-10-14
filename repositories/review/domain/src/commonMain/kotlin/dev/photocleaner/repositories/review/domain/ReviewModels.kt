package dev.photocleaner.repositories.review.domain

enum class DecisionKind {
    /** The selected photos go to the trash queue. */
    APPROVED,

    /** Keep every photo of the group. */
    KEPT,

    /** Decide later; the group goes to the end of the queue. */
    DEFERRED,
}

data class DecisionItem(val mediaKey: String, val dedupKey: String)

data class Decision(
    val id: Long,
    val groupId: String,
    val kind: DecisionKind,
    /** Exactly the photos selected when approving (empty for other kinds). */
    val items: List<DecisionItem>,
    /**
     * Every photo the decision covered: the whole group as shown. Empty for decisions recorded
     * before this was stored, until [ReviewRepository.addDecisionMembers] fills it in.
     */
    val members: Set<String>,
    val createdAtMs: Long,
    val undoneAtMs: Long?,
)

enum class TrashJobState {
    /** Waiting to be sent. */
    QUEUED,

    /** Sent; no result recorded yet. If the app stops now the outcome is uncertain. */
    SENDING,

    /** The app stopped while SENDING; must be reconciled before any retry. */
    UNCERTAIN,

    /** Confirmed in the trash. */
    COMPLETED,

    /** The trash request failed; see the error. */
    FAILED,

    /** Revalidation found the photo no longer eligible; never sent. */
    BLOCKED,

    /** Undone before it was sent. */
    CANCELLED,

    /** Undone after it was trashed: waiting to be restored. */
    RESTORE_REQUESTED,

    /** Confirmed restored from the trash. */
    RESTORED,
}

data class TrashJob(
    val id: Long,
    val decisionId: Long,
    val mediaKey: String,
    val dedupKey: String,
    val state: TrashJobState,
    val attempts: Int,
    val lastError: String?,
    val updatedAtMs: Long,
)
