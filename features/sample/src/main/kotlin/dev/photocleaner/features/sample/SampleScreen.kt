package dev.photocleaner.features.sample

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp

@Composable
fun SampleScreen(viewModel: SampleViewModel) {
    val state by viewModel.state.collectAsState()
    SampleContent(state, viewModel::onLoadClicked, viewModel::onPauseClicked, viewModel::onClearClicked)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SampleContent(state: SampleUiState, onLoad: () -> Unit, onPause: () -> Unit, onClear: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Eligible photo sample", style = MaterialTheme.typography.titleLarge)
        Text(
            "A small, evenly spread sample of photos the inventory classed as eligible. Click a preview to open it in Google Photos. " +
                "Nothing is changed; previews are kept in memory only.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onLoad, enabled = state.loadEnabled) { Text(state.loadLabel) }
            OutlinedButton(onClick = onPause, enabled = state.pauseEnabled) { Text("Pause") }
            OutlinedButton(onClick = onClear, enabled = state.clearEnabled) { Text("Clear") }
        }
        state.statusText?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        state.statsText?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        state.failureLines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.tiles.forEach { tile ->
                Column(Modifier.width(150.dp).clickable { uriHandler.openUri(tile.link) }) {
                    Image(tile.image, contentDescription = tile.caption, modifier = Modifier.size(150.dp), contentScale = ContentScale.Crop)
                    Text(tile.caption, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
