package dev.photocleaner.features.connection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.photocleaner.core.design.OutcomeColors
import dev.photocleaner.core.design.noKeyboardFocus
import androidx.compose.ui.Modifier
import java.awt.datatransfer.StringSelection
import kotlinx.coroutines.launch

@OptIn(ExperimentalComposeUiApi::class) // ClipEntry(Transferable) is the desktop clipboard entry point
@Composable
fun ConnectionScreen(viewModel: ConnectionViewModel) {
    val state by viewModel.state.collectAsState()
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    fun copy(text: String) {
        scope.launch { clipboard.setClipEntry(ClipEntry(StringSelection(text))) }
    }
    ConnectionContent(
        state = state,
        onCopyToken = { copy(state.token) },
        onCopyPath = { copy(state.extensionPath) },
        onToggleToken = viewModel::onToggleTokenClicked,
        onToggleSetup = viewModel::onToggleSetupClicked,
        onRegenerate = viewModel::onRegenerateClicked,
    )
}

@Composable
private fun ConnectionContent(
    state: ConnectionUiState,
    onCopyToken: () -> Unit,
    onCopyPath: () -> Unit,
    onToggleToken: () -> Unit,
    onToggleSetup: () -> Unit,
    onRegenerate: () -> Unit,
) {
    // Buttons never take keyboard focus, so Space or Enter cannot press "New token" by accident.
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Browser extension", style = MaterialTheme.typography.titleLarge)
        Text(
            state.statusText,
            fontWeight = FontWeight.SemiBold,
            color = when (state.status) {
                ConnectionStatus.CONNECTED -> OutcomeColors.positive
                ConnectionStatus.PENDING -> OutcomeColors.caution
                ConnectionStatus.OUTDATED -> OutcomeColors.caution
                ConnectionStatus.FAILED -> OutcomeColors.negative
            },
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Pairing token", style = MaterialTheme.typography.bodyMedium)
            Text(state.displayedToken, fontFamily = FontFamily.Monospace)
            TextButton(modifier = Modifier.noKeyboardFocus(), onClick = onToggleToken) { Text(state.toggleTokenLabel) }
            OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = onCopyToken) { Text("Copy") }
            OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = onRegenerate) { Text("New token") }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${state.portText} · ${state.extensionIdText}", style = MaterialTheme.typography.bodySmall)
            TextButton(modifier = Modifier.noKeyboardFocus(), onClick = onToggleSetup) { Text(state.setupToggleLabel) }
        }
        if (state.setupSteps.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                state.setupSteps.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                OutlinedButton(modifier = Modifier.noKeyboardFocus(), onClick = onCopyPath) { Text("Copy path") }
            }
        }
    }
}
