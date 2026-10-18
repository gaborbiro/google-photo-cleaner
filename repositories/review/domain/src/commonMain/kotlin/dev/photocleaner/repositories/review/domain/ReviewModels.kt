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
    /** Every photo the decision covered: the whole group as shown. */
    val members: Set<String>,
    val createdAtMs: Long,
    val undoneAtMs: Long?,
)
