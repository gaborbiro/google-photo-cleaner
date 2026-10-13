package dev.photocleaner.features.probe

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.photocleaner.core.design.OutcomeColors
import dev.photocleaner.features.probe.model.ProbeOutcome

@Composable
fun ProbeScreen(viewModel: ProbeViewModel) {
    val state by viewModel.state.collectAsState()
    ProbeContent(state, viewModel::onRunClicked)
}

@Composable
private fun ProbeContent(state: ProbeUiState, onRun: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Read-only probe", style = MaterialTheme.typography.titleLarge)
        Text(
            "Runs a few dozen bulk read requests against your library, favourites and albums, " +
                "and records counts and data shapes only.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onRun, enabled = state.runEnabled) { Text(state.runLabel) }
            state.hint?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            state.runningText?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
        state.checks.forEach { CheckCard(it) }
        state.resultText?.let { SelectionContainer { Text(it, style = MaterialTheme.typography.bodyMedium) } }
    }
}

@Composable
private fun CheckCard(check: ProbeCheckUi) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(check.outcomeLabel, color = outcomeColor(check.outcome), fontWeight = FontWeight.Bold)
                Text(check.title, fontWeight = FontWeight.SemiBold)
            }
            Text(check.summary, style = MaterialTheme.typography.bodyMedium)
            SelectionContainer {
                Column {
                    check.facts.forEach { fact ->
                        Row {
                            Text(fact.label, Modifier.width(360.dp), style = MaterialTheme.typography.bodySmall)
                            Text(fact.value, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun outcomeColor(outcome: ProbeOutcome): Color = when (outcome) {
    ProbeOutcome.PASS -> OutcomeColors.positive
    ProbeOutcome.WARN -> OutcomeColors.caution
    ProbeOutcome.FAIL -> OutcomeColors.negative
    ProbeOutcome.SKIPPED -> OutcomeColors.neutral
}
