// The protection report of an account's latest scan. Classification is done by the shared Kotlin
// rules (features/shared/protection, compiled to JavaScript), so the browser and the desktop app
// can't disagree on what is protected. The wording follows the desktop's Scan library tab.

import { classifyInventoryJson, defaultMaxAgeMs } from '../../../generated/protection/PhotoCleaner-features-shared-protection.mjs';
import { count, n } from '../shared/format';
import type { InventorySnapshot } from './model';

export type Eligibility = 'PROTECTED' | 'ELIGIBLE' | 'UNKNOWN';
export type UnknownReason = 'INVENTORY_INCOMPLETE' | 'INVENTORY_STALE' | 'FAVOURITE_FLAG_MISSING' | 'ARCHIVE_FLAG_MISSING' | 'NOT_OWNED' | 'MEDIA_TYPE_UNKNOWN';

interface Agreement { listed: number; flagged: number; flaggedButNotListed: number; listedButNotFlagged: number }

export interface TypeCounts {
  mediaType: 'PHOTO' | 'VIDEO' | null;
  total: number;
  protectedTotal: number;
  protectedByFavourite: number;
  protectedByAlbum: number;
  protectedByArchive: number;
  protectedByFavouriteAndAlbum: number;
  eligible: number;
  unknown: number;
  unknownByReason: Partial<Record<UnknownReason, number>>;
}

export interface Classification {
  report: {
    accountFingerprint: string;
    coverage: {
      isComplete: boolean;
      isStale: boolean;
      runStatus: string;
      runStatusReason: string | null;
      startedAtMs: number;
      finishedAtMs: number | null;
      phases: { name: string; completed: boolean; pages: number; entries: number; duplicates: number }[];
      albumsListed: number;
      albumsFullyRead: number;
      albumIssues: { albumTitle: string | null; kind: 'FAILED' | 'NOT_FINISHED' | 'COUNT_MISMATCH' | 'COUNT_MISSING'; detail: string }[];
      favourites: Agreement;
      archive: Agreement;
    };
    counts: TypeCounts[];
  };
  items: { mediaKey: string; eligibility: Eligibility; protectionReasons: string[]; unknownReasons: UnknownReason[] }[];
}

/** Applies the shared protection rules to a snapshot. */
export function classify(snapshot: InventorySnapshot, nowMs: number, maxAgeMs: number = defaultMaxAgeMs()): Classification {
  return JSON.parse(classifyInventoryJson(JSON.stringify(snapshot), nowMs, maxAgeMs)) as Classification;
}

// --- what the screens show ---

export type Tone = 'good' | 'warn' | 'bad';

export interface ReportView {
  title: string;
  tone: Tone;
  /** One line for the panel and popup: "17,196 photos · 3,021 protected · …". */
  summary: string;
  coverageLines: string[];
  issueLines: string[];
  tables: { title: string; rows: { label: string; value: string; indent: boolean }[] }[];
  /** Counts only, no album titles: for comparing with the desktop app. */
  copyText: string;
}

const time = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const PHASE_LABELS: Record<string, string> = { LIBRARY: 'Library', FAVOURITES: 'Favourite photos', ARCHIVE: 'Archived photos', ALBUM_LIST: 'Album list' };
const REASON_LABELS: Record<UnknownReason, string> = {
  INVENTORY_INCOMPLETE: 'scan incomplete',
  INVENTORY_STALE: 'scan out of date',
  FAVOURITE_FLAG_MISSING: 'favourite flag missing',
  ARCHIVE_FLAG_MISSING: 'archive flag missing',
  NOT_OWNED: 'not uploaded by you, no album match',
  MEDIA_TYPE_UNKNOWN: 'media type unknown',
};

function agreementLine(name: string, a: Agreement): string {
  return `${name}: ${n(a.listed)} in Google's listing, ${n(a.flagged)} flagged on library items` +
    (a.flaggedButNotListed === 0 && a.listedButNotFlagged === 0
      ? ', sources agree'
      : ` (${n(a.flaggedButNotListed)} flagged but not listed, ${n(a.listedButNotFlagged)} listed but not flagged; both are protected)`);
}

function table(c: TypeCounts) {
  const title = c.mediaType === 'PHOTO' ? 'Photos' : c.mediaType === 'VIDEO' ? 'Videos (outside clean-up scope)' : 'Items of unknown type';
  const row = (label: string, value: number, indent = false) => ({ label, value: n(value), indent });
  return {
    title,
    rows: [
      row('Enumerated', c.total),
      row('Protected (each counted once)', c.protectedTotal),
      row('favourite', c.protectedByFavourite, true),
      row('in an album', c.protectedByAlbum, true),
      row('archived', c.protectedByArchive, true),
      row('favourite and in an album', c.protectedByFavouriteAndAlbum, true),
      row('Eligible', c.eligible),
      row('Unknown (excluded)', c.unknown),
      ...Object.entries(c.unknownByReason).map(([reason, count]) => row(REASON_LABELS[reason as UnknownReason], count ?? 0, true)),
    ],
  };
}

export function reportView(classification: Classification): ReportView {
  const { coverage, counts } = classification.report;
  const [title, tone]: [string, Tone] = !coverage.isComplete
    ? ['Protection coverage incomplete: no photo can be trashed', 'bad']
    : coverage.isStale
      ? ['The last scan is more than a day old: no photo can be trashed until you scan again', 'warn']
      : ['Protection coverage complete', 'good'];
  const coverageLines = [
    `Scan started ${time(coverage.startedAtMs)}` + (coverage.finishedAtMs !== null ? `, finished ${time(coverage.finishedAtMs)}` : ', not finished'),
    ...(coverage.runStatusReason ? [`Last stop: ${coverage.runStatusReason}`] : []),
    ...coverage.phases.map((p) =>
      `${PHASE_LABELS[p.name] ?? p.name}: ${count(p.entries, 'entry', 'entries')} in ${count(p.pages, 'page', 'pages')}` +
      (p.duplicates > 0 ? `, ${n(p.duplicates)} repeated` : '') +
      (p.completed ? ', read to the end' : ', not finished')),
    `Albums: ${n(coverage.albumsFullyRead)} of ${n(coverage.albumsListed)} fully read and matching Google's counts`,
    agreementLine('Favourites', coverage.favourites),
    agreementLine('Archive', coverage.archive),
  ];
  const issueKinds = { FAILED: 'could not be read', NOT_FINISHED: 'not finished', COUNT_MISMATCH: 'count mismatch', COUNT_MISSING: 'no count from Google' };
  const issueLines = coverage.albumIssues.map((i) => `Album “${i.albumTitle ?? 'untitled'}” ${issueKinds[i.kind]}: ${i.detail}`);
  const tables = counts.filter((c) => c.total > 0).map(table);
  const photos = counts.find((c) => c.mediaType === 'PHOTO');
  const summary = photos
    ? `${n(photos.total)} photos · ${n(photos.protectedTotal)} protected · ${n(photos.eligible)} can be cleaned up · ${n(photos.unknown)} unknown`
    : 'No photos found';
  const copyText = [
    title,
    ...coverageLines,
    ...(issueLines.length > 0 ? [`${issueLines.length} album issue(s)`] : []),
    ...tables.flatMap((t) => [t.title, ...t.rows.map((r) => `${r.indent ? '    ' : '  '}${r.label}: ${r.value}`)]),
  ].join('\n');
  return { title, tone, summary, coverageLines, issueLines, tables, copyText };
}
