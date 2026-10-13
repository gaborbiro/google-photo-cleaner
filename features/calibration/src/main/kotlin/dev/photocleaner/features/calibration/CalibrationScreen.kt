package dev.photocleaner.features.calibration

import dev.photocleaner.core.design.noKeyboardFocus
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.photocleaner.core.design.KeyShortcuts
import dev.photocleaner.repositories.analysis.domain.PairLabel

@Composable
fun CalibrationScreen(viewModel: CalibrationViewModel) {
    val state by viewModel.state.collectAsState()
    // Window-wide, like the other tabs; the buttons under each pair show the keys.
    KeyShortcuts { key ->
        when (key) {
            Key.One, Key.NumPad1 -> viewModel.onLabel(PairLabel.SAME)
            Key.Two, Key.NumPad2 -> viewModel.onLabel(PairLabel.NEAR_DUPLICATE)
            Key.Three, Key.NumPad3 -> viewModel.onLabel(PairLabel.DIFFERENT)
            Key.Backspace -> viewModel.onUndo()
            else -> return@KeyShortcuts false
        }
        true
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Duplicate calibration", style = MaterialTheme.typography.titleLarge)
        Text(
            "Label a few pairs of your photos so the similarity threshold for duplicates is set from your own library. " +
                "Scores are hidden while you label.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            "Detail is how finely the AI model looks at each photo: it cuts the photo into small patches (image tokens) " +
                "and reads up to this many. More detail tells similar photos apart better but is slower. Each table below shows, " +
                "for one detail level, how your labelled pairs would be sorted at each similarity threshold.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.prepareVisible) Button(modifier = Modifier.noKeyboardFocus(), onClick = { viewModel.onPrepareClicked(fresh = false) }) { Text(state.prepareLabel) }
            if (state.restartVisible) OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = { viewModel.onPrepareClicked(fresh = true) }) { Text(state.restartLabel) }
            state.counterText?.let { Text(it, fontWeight = FontWeight.SemiBold) }
        }
        state.prepText?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        state.current?.let { PairCard(it, viewModel::onLabel, viewModel::onUndo, state.undoEnabled) }
        state.reports.forEach { ReportCard(it) }
    }
}

@Composable
private fun PairCard(pair: PairUi, onLabel: (PairLabel) -> Unit, onUndo: () -> Unit, undoEnabled: Boolean) {
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(pair.gapText, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PhotoPane(pair.imageA, pair.errorA, pair.captionA)
                PhotoPane(pair.imageB, pair.errorB, pair.captionB)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(modifier = Modifier.noKeyboardFocus(), onClick = { onLabel(PairLabel.SAME) }) { Text("1 · Same photo") }
                Button(modifier = Modifier.noKeyboardFocus(), onClick = { onLabel(PairLabel.NEAR_DUPLICATE) }) { Text("2 · Near-duplicate") }
                Button(modifier = Modifier.noKeyboardFocus(), onClick = { onLabel(PairLabel.DIFFERENT) }) { Text("3 · Different") }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = onUndo, enabled = undoEnabled) { Text("⌫ Undo") }
            }
        }
    }
}

@Composable
private fun PhotoPane(image: androidx.compose.ui.graphics.ImageBitmap?, error: String?, caption: String) {
    Column(Modifier.width(420.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.size(420.dp).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            when {
                image != null -> Image(image, contentDescription = caption, modifier = Modifier.size(420.dp), contentScale = ContentScale.Fit)
                error != null -> Text(error)
                else -> Text("Loading…")
            }
        }
        Text(caption, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ReportCard(report: ReportUi) {
    // Selectable through the window-wide selection area; a nested one here froze the window.
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(report.title, fontWeight = FontWeight.Bold)
            report.summaryLines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
            Row { listOf("Threshold", "Flagged", "Precision", "Recall", "Same-photo recall").forEach { Text(it, Modifier.width(130.dp), fontWeight = FontWeight.SemiBold) } }
            report.rows.forEach { row ->
                Row {
                    listOf(row.threshold, row.flagged, row.precision, row.recall, row.sameRecall).forEach {
                        Text(it, Modifier.width(130.dp), fontWeight = row.fontWeight, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
