package dev.photocleaner.features.duplicates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.photocleaner.core.design.CollapsingHeaderLayout
import dev.photocleaner.core.design.NoticeToast
import androidx.compose.foundation.layout.Box
import dev.photocleaner.core.design.color
import dev.photocleaner.core.design.noKeyboardFocus

/**
 * The photo analysis on top, which folds away as the group scrolls; the current group's
 * status, the action buttons and feedback stay pinned above the photos.
 */
@Composable
fun DuplicatesScreen(
    embedding: EmbeddingPanelViewModel,
    review: ReviewViewModel,
    onSearchMoreLike: (Set<String>) -> Unit,
    onOpenScan: () -> Unit,
    /** Library scans completed this session; a scan can finish in the background while this tab is open. */
    libraryScans: Int,
) {
    val scan by embedding.state.collectAsState()
    val state by review.state.collectAsState()
    // Groups are built when the tab opens (so trashing from Search shows here), when a library scan
    // finishes, and after each analysis.
    LaunchedEffect(libraryScans) { review.onShown() }
    LaunchedEffect(scan.finishedScans) { review.onScansFinished(scan.finishedScans) }
    LaunchedEffect(review) { review.searchMoreLike.collect(onSearchMoreLike) }
    ReviewShortcuts(review)

    Box(Modifier.fillMaxSize()) {
        CollapsingHeaderLayout(
            modifier = Modifier.fillMaxSize(),
            header = { ScanSection(scan, state, embedding::onStartOrPauseClicked) },
            pinned = { ReviewBar(state, review, onOpenScan) },
        ) {
            ReviewContent(state, review)
        }
        // Feedback floats over the photos instead of pushing them down.
        NoticeToast(state.notice)
    }
    ReviewViewer(state, review)
}

@Composable
private fun ScanSection(scan: EmbeddingPanelUiState, review: ReviewUiState, onStartOrPause: () -> Unit) {
    Column(Modifier.padding(top = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // "Analyse" is the AI step that finds duplicates; "scan" is reading the library from Google.
        Text(
            "Finds duplicates by analysing every photo with the GPU (EmbeddingGemma 2, detail 280). Previews are fetched " +
                "a few at a time, analysed in memory and discarded; only the numeric fingerprint and quality measurements are kept.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            "Pause and resume at any time; later analyses only cover new photos.",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            "Analysing new photos preserves past decisions. Your decided groups don’t rebuild, except when a new photo matches " +
                "an already-decided moment. Then the group reappears with the previously kept photos plus the newcomer(s). " +
                "Trashed photos stay trashed.",
            style = MaterialTheme.typography.bodyMedium,
        )
        review.ruleText?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(modifier = Modifier.noKeyboardFocus(), onClick = onStartOrPause) { Text(scan.buttonLabel) }
            scan.progressText?.let { Text(it) }
        }
        scan.speedText?.let { Text(it, fontWeight = FontWeight.SemiBold) }
        scan.speedHint?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        scan.notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        review.groupsText?.let { Text(it, fontWeight = FontWeight.SemiBold) }
        review.progressText?.let { Text(it, fontWeight = FontWeight.SemiBold) }
        review.analysisText?.let { Text(it, color = review.analysisTone.color(), fontWeight = FontWeight.SemiBold) }
        review.queueText?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        review.queueWaitingText?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
