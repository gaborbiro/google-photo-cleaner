package dev.photocleaner.features.probe.model

import kotlinx.serialization.Serializable

@Serializable
enum class ProbeOutcome { PASS, WARN, FAIL, SKIPPED }

@Serializable
data class ProbeFact(val label: String, val value: String)

@Serializable
data class ProbeCheck(
    val id: String,
    val title: String,
    val outcome: ProbeOutcome,
    val summary: String,
    val facts: List<ProbeFact>,
    /** Content-free structure of a raw payload (no strings, keys, URLs or large numbers). */
    val shapeSample: String? = null,
)

@Serializable
data class ProbeReport(
    val startedAtMs: Long,
    val finishedAtMs: Long,
    val checks: List<ProbeCheck>,
)

data class ProbeProgress(
    val checks: List<ProbeCheck>,
    val runningTitle: String?,
    val report: ProbeReport?,
)
