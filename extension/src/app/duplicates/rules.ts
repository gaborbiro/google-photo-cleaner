// The duplicate rules: grouping, keeper choice, the review queue and the calibration report come
// from the shared Kotlin module (features/shared/duplicates, compiled to JavaScript), so the
// browser and the desktop app group photos the same way. This file only types their answers.

import { calibrationReportJson, decisionItemsJson, defaultMaxAgeMs, reviewQueueJson } from '../../../generated/kotlin/PhotoCleaner-features-shared-duplicates.mjs';
import { DUPLICATE_THRESHOLD, type Detail } from '../ai/model';
import type { Eligibility } from '../scan/report';
import type { InventorySnapshot } from '../scan/model';
import type { ProtectionChoices } from '../shared/preferences';

export type Role = 'KEEPER' | 'PROPOSED' | 'REFERENCE';
export type ProtectionReason = 'FAVOURITE' | 'IN_ALBUM' | 'ARCHIVED';
/** Why no photo can be proposed yet. */
export type Blocked = 'NOT_SCANNED' | 'SCAN_UNFINISHED' | 'SCAN_STALE';
export type DecisionKind = 'APPROVED' | 'KEPT' | 'DEFERRED';

export interface GroupMember {
  mediaKey: string;
  dedupKey: string;
  takenAtMs: number;
  thumbUrl: string | null;
  role: Role;
  /** To the keeper; 1 for the keeper itself. */
  similarity: number;
  /** Why it is the keeper, or why it is proposed or kept ("Blurrier than the keeper", …). */
  reasons: string[];
  /** Part of an earlier decision on this moment: never proposed again. */
  previouslyReviewed: boolean;
  /** May be selected for the trash (eligible, including an eligible keeper). */
  selectable: boolean;
  eligibility: Eligibility;
  protectionReasons: ProtectionReason[];
  /** The original's size in pixels; null when unknown. */
  pixels: number | null;
}

export interface DuplicateGroup {
  /** Stable for the same set of photos. */
  id: string;
  /** The newest photo's capture time. */
  takenAtMs: number;
  /** Pre-selected for the trash when the group first shows. */
  defaultSelection: string[];
  /** The keeper first, then the others by similarity to it. */
  members: GroupMember[];
}

export interface ReviewQueue {
  blocked: Blocked | null;
  /** Undecided groups (newest moment first), then skipped ones. */
  pending: DuplicateGroup[];
  deferredIds: string[];
  totalGroups: number;
  decidedGroups: number;
  analysedAtMs: number | null;
  photosAnalysed: number;
  photosNotAnalysed: number;
  settings: { threshold: number; windowMs: number };
}

export interface GroupingSettings {
  threshold: number;
  windowMs: number;
  maxGroupSize: number;
  tokenBudget: number;
}

/** The desktop's rules, with the threshold for the detail this library was analysed at. */
export function groupingSettings(detail: Detail): GroupingSettings {
  return { threshold: DUPLICATE_THRESHOLD[detail], windowMs: 120_000, maxGroupSize: 12, tokenBudget: detail };
}

/** What the analysis found for one photo; its fingerprint goes alongside, in the same order. */
export interface AnalysedPhoto {
  mediaKey: string;
  sharpness: number;
  /** Share of clipped pixels, dark plus bright. */
  clipped: number;
  analysedAtMs: number;
  uploadedAtMs: number | null;
  width: number | null;
  height: number | null;
}

/** A decision that hasn't been undone. */
export interface ActiveDecision {
  id: number;
  groupId: string;
  kind: DecisionKind;
  /** Exactly the photos approved for the trash (APPROVED only). */
  items: { mediaKey: string; dedupKey: string }[];
  /** Every photo the decision covered. */
  members: string[];
  createdAtMs: number;
}

/** The groups still to review. [decisions] are the active ones, newest first. */
export function reviewQueue(
  snapshot: InventorySnapshot | null,
  nowMs: number,
  photos: AnalysedPhoto[],
  vectors: Float32Array[],
  decisions: ActiveDecision[],
  settings: GroupingSettings,
  choices: ProtectionChoices,
): ReviewQueue {
  const json = reviewQueueJson(
    snapshot === null ? null : JSON.stringify(snapshot),
    nowMs,
    defaultMaxAgeMs(),
    JSON.stringify(photos),
    vectors,
    JSON.stringify(decisions),
    JSON.stringify(settings),
    JSON.stringify(choices),
  );
  return JSON.parse(json) as ReviewQueue;
}

/**
 * What a decision records for the trash, by the shared rules: exactly the selected photos when
 * approving, which must be ones the rules marked selectable; nothing for keep and skip. A selection
 * the rules refuse throws.
 */
export function decisionItems(group: DuplicateGroup, kind: DecisionKind, selected: Set<string>): { mediaKey: string; dedupKey: string }[] {
  const members = group.members.map(({ mediaKey, dedupKey, selectable }) => ({ mediaKey, dedupKey, selectable }));
  return JSON.parse(decisionItemsJson(JSON.stringify(members), kind, JSON.stringify([...selected]))) as { mediaKey: string; dedupKey: string }[];
}

export type PairLabel = 'SAME' | 'NEAR_DUPLICATE' | 'DIFFERENT';

export interface ThresholdRow {
  threshold: number;
  flagged: number;
  truePositives: number;
  falsePositives: number;
  precision: number | null;
  recall: number | null;
  sameRecall: number | null;
}

export interface CalibrationReport {
  tokenBudget: number;
  labelled: number;
  duplicates: number;
  different: number;
  lowestSame: number | null;
  lowestNearDuplicate: number | null;
  highestDifferent: number | null;
  /** Lowest grid threshold with no DIFFERENT pair at or above it. */
  recommendedThreshold: number | null;
  rows: ThresholdRow[];
}

/** How well each threshold separates labelled pairs scored at one detail. */
export function calibrationReport(labelled: { label: PairLabel; score: number }[], detail: number): CalibrationReport {
  return JSON.parse(calibrationReportJson(JSON.stringify(labelled), detail)) as CalibrationReport;
}
