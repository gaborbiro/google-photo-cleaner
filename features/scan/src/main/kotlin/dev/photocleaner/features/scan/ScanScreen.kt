package dev.photocleaner.features.scan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.photocleaner.core.design.color

@Composable
fun ScanScreen(viewModel: ScanViewModel) {
    val state by viewModel.state.collectAsState()
    ScanContent(state, viewModel::onPrimaryClicked, viewModel::onDiscardClicked)
}

@Composable
private fun ScanContent(state: ScanUiState, onPrimary: () -> Unit, onDiscard: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Scan library", style = MaterialTheme.typography.titleLarge)
        Text(
            "Reads your whole library, including favourites and every album (read-only), then works out which photos are protected, " +
                "eligible or unknown. Pausing keeps progress; you can resume later, even after restarting the app.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            "Start here, and scan again before each clean-up session: it picks up newly added photos and album changes. " +
                "Photos can only be trashed while the last scan is less than a day old, so a photo you have since added " +
                "to an album or marked as a favourite is never trashed by mistake.",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onPrimary, enabled = state.primaryEnabled) { Text(state.primaryLabel) }
            if (state.discardVisible) OutlinedButton(onClick = onDiscard) { Text("Discard and start over") }
            Text(state.statusTitle, color = state.statusTone.color(), fontWeight = FontWeight.SemiBold)
        }
        state.progressLines.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
        state.speedText?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold) }
        state.speedHint?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        state.notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        state.report?.let { ReportCard(it) }
    }
}

@Composable
private fun ReportCard(report: ReportUi) {
    // Selectable through the window-wide selection area; a nested one here could freeze the window.
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(report.coverageTitle, color = report.coverageTone.color(), fontWeight = FontWeight.Bold)
            report.coverageLines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
            report.issueLines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
            Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                report.tables.forEach { table ->
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(table.title, fontWeight = FontWeight.SemiBold)
                        table.rows.forEach { row ->
                            Row {
                                Text(
                                    row.label,
                                    Modifier.width(240.dp).padding(start = row.startPaddingDp.dp),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(row.value, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }
}
