// Working out the duplicate threshold for the browser's fingerprints from the labels given in the
// desktop app's Calibration tab (a developer tool: see dev-calibration.html).

import type { AnalysisSettings } from '../ai/analysisStore';
import { modelKey, type Detail } from '../ai/model';
import { dot } from '../ai/similar';
import { calibrationReport, type CalibrationReport, type PairLabel } from './rules';

/**
 * The library's settings switched to analysing at [detail], to calibrate that detail: the next
 * analysis fingerprints every photo not yet done at it, and this page then scores with them.
 * Fingerprints are kept per detail, so switching back needs no new analysis. The speed check's
 * measurement stays as it was.
 */
export function atDetail(settings: AnalysisSettings, detail: Detail, nowMs: number): AnalysisSettings {
  return { ...settings, detail, modelKey: modelKey(detail), chosenAtMs: nowMs };
}

export interface LabelledPair {
  a: string;
  b: string;
  label: PairLabel;
}

const LABELS: readonly PairLabel[] = ['SAME', 'NEAR_DUPLICATE', 'DIFFERENT'];

/** The exported labels file (scripts/export-calibration-labels.py); anything else is refused. */
export function parseLabels(text: string): LabelledPair[] {
  const raw = JSON.parse(text) as { pairs?: unknown };
  if (!Array.isArray(raw.pairs)) throw new Error('Not a labels file: "pairs" is missing.');
  return raw.pairs.map((p: unknown, index) => {
    const { a, b, label } = (p ?? {}) as Record<string, unknown>;
    if (typeof a !== 'string' || typeof b !== 'string' || !LABELS.includes(label as PairLabel)) {
      throw new Error(`Pair ${index + 1} is not a labelled pair of photos.`);
    }
    return { a, b, label: label as PairLabel };
  });
}

export interface CalibrationResult {
  report: CalibrationReport;
  /** Pairs with a photo not analysed by the extension (e.g. trashed since). */
  missing: number;
}

/** Scores every labelled pair with the extension's fingerprints, then asks the shared rules for the report. */
export function calibrate(pairs: LabelledPair[], fingerprints: Map<string, Float32Array>, detail: number): CalibrationResult {
  const labelled: { label: PairLabel; score: number }[] = [];
  let missing = 0;
  for (const pair of pairs) {
    const a = fingerprints.get(pair.a);
    const b = fingerprints.get(pair.b);
    if (!a || !b) {
      missing++;
      continue;
    }
    labelled.push({ label: pair.label, score: dot(a, b) });
  }
  return { report: calibrationReport(labelled, detail), missing };
}

const percent = (value: number | null) => (value === null ? '–' : `${(value * 100).toFixed(1)}%`);
const score = (value: number | null) => (value === null ? '–' : value.toFixed(4));

export interface CalibrationView {
  lines: string[];
  /** Thresholds from 0.85 up: the useful part of the grid. */
  rows: { threshold: string; flagged: string; wrong: string; precision: string; recall: string; sameRecall: string; recommended: boolean }[];
}

/** What the calibration page shows. */
export function calibrationView({ report, missing }: CalibrationResult): CalibrationView {
  const at = (t: number | null) => report.rows.find((r) => r.threshold === t) ?? null;
  const recommended = at(report.recommendedThreshold);
  const desktop = at(0.925);
  return {
    lines: [
      `Detail ${report.tokenBudget}: ${report.labelled} labelled pairs scored (${report.duplicates} duplicates, ${report.different} different)` +
        (missing > 0 ? `, ${missing} skipped (a photo not analysed)` : ''),
      `Lowest same: ${score(report.lowestSame)} · lowest near-duplicate: ${score(report.lowestNearDuplicate)} · highest different: ${score(report.highestDifferent)}`,
      recommended
        ? `Recommended threshold: ${recommended.threshold.toFixed(3)} (finds ${percent(recommended.recall)} of duplicates, none wrongly)`
        : 'No recommendation: no pair is labelled different.',
      desktop ? `At the desktop's 0.925: finds ${percent(desktop.recall)} of duplicates, ${desktop.falsePositives} wrongly` : '',
    ].filter((line) => line !== ''),
    rows: report.rows.filter((r) => r.threshold >= 0.85).map((r) => ({
      threshold: r.threshold.toFixed(3),
      flagged: String(r.flagged),
      wrong: String(r.falsePositives),
      precision: percent(r.precision),
      recall: percent(r.recall),
      sameRecall: percent(r.sameRecall),
      recommended: r.threshold === report.recommendedThreshold,
    })),
  };
}
