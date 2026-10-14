// Which AI model the extension uses, and how. Chosen by the browser AI test (docs/roadmap.md):
// EmbeddingGemma 2 in 4-bit, detail 140 on a capable graphics card, 70 on a slow one.

export const MODEL_ID = 'onnx-community/embeddinggemma-2-ONNX';
/** Pinned so stored fingerprints stay comparable; change deliberately and re-analyse. */
export const MODEL_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
export const MODEL_DTYPE = 'q4';
/** Download size of the 4-bit text model and vision encoder, for the space check and progress. */
export const MODEL_DOWNLOAD_BYTES = 283_000_000;
/** Longest side of the previews that are analysed (as the desktop app). */
export const PREVIEW_SIZE_PX = 512;

export type Detail = 140 | 70;
export const PREFERRED_DETAIL: Detail = 140;
export const FALLBACK_DETAIL: Detail = 70;

/**
 * Detail 140 unless the whole first analysis would take longer than this on this computer;
 * then 70, about twice as fast and almost as good (browser AI test).
 */
export const MAX_FIRST_ANALYSIS_HOURS_AT_PREFERRED = 4;

/** Photos analysed for the speed check before choosing the detail. */
export const SPEED_CHECK_PHOTOS = 10;

/** Identifies how a fingerprint was made; fingerprints are only ever compared with the same key. */
export function modelKey(detail: Detail): string {
  return `${MODEL_ID}@${MODEL_REVISION.slice(0, 12)}/${MODEL_DTYPE}/t${detail}/p${PREVIEW_SIZE_PX}`;
}

/** The detail to analyse a library at, from the measured speed at the preferred detail. */
export function chooseDetail(photosPerSecondAtPreferred: number, photosToAnalyse: number): Detail {
  if (photosPerSecondAtPreferred <= 0) return FALLBACK_DETAIL;
  const hours = photosToAnalyse / photosPerSecondAtPreferred / 3600;
  return hours > MAX_FIRST_ANALYSIS_HOURS_AT_PREFERRED ? FALLBACK_DETAIL : PREFERRED_DETAIL;
}
