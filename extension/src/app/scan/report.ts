// The protection report of an account's latest scan. Classification is done by the shared Kotlin
// rules (features/shared/protection, compiled to JavaScript), so every check agrees on what is
// protected.

import { classifyInventoryJson, defaultMaxAgeMs } from '../../../generated/kotlin/PhotoCleaner-features-shared-duplicates.mjs';
import { count, n } from '../shared/format';
import type { Job } from '../shared/job';
import type { ProtectionChoices } from '../shared/preferences';
import type { IndexedDbInventoryStore } from './inventoryStore';
import type { InventorySnapshot, StoredMediaType } from './model';

export type Eligibility = 'PROTECTED' | 'ELIGIBLE' | 'UNKNOWN';
export type UnknownReason = 'INVENTORY_INCOMPLETE' | 'INVENTORY_STALE' | 'FAVOURITE_FLAG_MISSING' | 'ARCHIVE_FLAG_MISSING' | 'MEDIA_TYPE_UNKNOWN' | 'DEDUP_KEY_UNUSUAL';

interface Agreement { listed: number; flagged: number; flaggedButNotListed: number; listedButNotFlagged: number }

type AlbumIssueKind = 'FAILED' | 'NOT_FINISHED' | 'COUNT_MISMATCH' | 'COUNT_MISSING' | 'UNUSUAL_KEY_NOT_IN_LIBRARY' | 'COUNT_MISMATCH_READ_TWICE';
/** An album as numbers and flags, without its title (for problem reports). */
interface AlbumFacts { reportedCount: number | null; entriesRead: number; reread: 'SAME_ENTRIES' | 'DIFFERENT_ENTRIES' | null; isShared: boolean | null; kindCode: number | null }
interface AlbumIssue { albumTitle: string | null; kind: AlbumIssueKind; detail: string; facts: AlbumFacts }

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
      /** Albums whose entries can't be trusted: any one makes the coverage incomplete. */
      albumIssues: AlbumIssue[];
      /** Albums worth knowing about that don't block trashing. */
      albumWarnings: AlbumIssue[];
      favourites: Agreement;
      archive: Agreement;
    };
    counts: TypeCounts[];
  };
  items: { mediaKey: string; dedupKey: string; mediaType: StoredMediaType | null; eligibility: Eligibility; protectionReasons: string[]; unknownReasons: UnknownReason[] }[];
}

/** How old a scan may be before it no longer proves what is protected (the shared rules' limit: a day). */
export const SCAN_MAX_AGE_MS = defaultMaxAgeMs();

/** Applies the shared protection rules to a snapshot, with the user's protection [choices]. */
export function classify(snapshot: InventorySnapshot, nowMs: number, choices: ProtectionChoices, maxAgeMs: number = defaultMaxAgeMs()): Classification {
  return JSON.parse(classifyInventoryJson(JSON.stringify(snapshot), nowMs, maxAgeMs, JSON.stringify(choices))) as Classification;
}

// --- what the screens show ---

export type Tone = 'good' | 'warn' | 'bad';

export interface ReportView {
  title: string;
  tone: Tone;
  /** Said outside the folded details when it changes what can be done (incomplete protection data); else null. */
  warningText: string | null;
  /** One line for the panel and popup: "17,196 photos · 3,021 protected · …". */
  summary: string;
  /** "Scan started 14 Oct 2026, 18:52, finished 14 Oct 2026, 18:56". */
  timesLine: string;
  coverageLines: string[];
  /** Albums that keep every photo from being trashed. */
  issueLines: string[];
  /** Albums worth knowing about that don't block anything. */
  noteLines: string[];
  tables: { title: string; rows: { label: string; value: string; indent: boolean }[] }[];
  /** Counts only, no album titles: safe to copy and share. */
  copyText: string;
  /**
   * For Copy diagnostics, also without titles: what blocks trashing, each album issue as numbers
   * and flags, and how many photos are unknown for which reasons together.
   */
  diagnosticLines: string[];
}

const time = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const PHASE_LABELS: Record<string, string> = { LIBRARY: 'Library', FAVOURITES: 'Favourite photos', ARCHIVE: 'Archived photos', ALBUM_LIST: 'Album list' };
const REASON_LABELS: Record<UnknownReason, string> = {
  INVENTORY_INCOMPLETE: 'scan incomplete',
  INVENTORY_STALE: 'scan out of date',
  FAVOURITE_FLAG_MISSING: 'favourite flag missing',
  ARCHIVE_FLAG_MISSING: 'archive flag missing',
  MEDIA_TYPE_UNKNOWN: 'media type unknown',
  DEDUP_KEY_UNUSUAL: 'unusual Google ID',
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
      row('Protected', c.protectedTotal),
      row('favourite', c.protectedByFavourite, true),
      row('in an album', c.protectedByAlbum, true),
      row('archived', c.protectedByArchive, true),
      // The reasons overlap: this row shows by how much, so they can add up to more than the total.
      row('both favourite and in an album', c.protectedByFavouriteAndAlbum, true),
      row('Eligible', c.eligible),
      row('Unknown (excluded)', c.unknown),
      ...Object.entries(c.unknownByReason).map(([reason, count]) => row(REASON_LABELS[reason as UnknownReason], count ?? 0, true)),
    ],
  };
}

type Coverage = Classification['report']['coverage'];

/** "a", "a and b", "a, b and c". */
function listed(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "1 album doesn't match…" / "4 albums don't match…". */
function albums(howMany: number, one: string, many: string): string {
  return `${n(howMany)} ${howMany === 1 ? `album ${one}` : `albums ${many}`}`;
}

/** What keeps the scan from proving anything, in plain words: "4 albums don't match Google's count". */
export function blockers(coverage: Coverage): string[] {
  const out: string[] = [];
  if (coverage.runStatus !== 'COMPLETED' || coverage.phases.some((p) => !p.completed)) out.push("the last scan didn't finish");
  const of = (kind: AlbumIssueKind) => coverage.albumIssues.filter((i) => i.kind === kind).length;
  if (of('FAILED') > 0) out.push(albums(of('FAILED'), "couldn't be read", "couldn't be read"));
  if (of('NOT_FINISHED') > 0) out.push(albums(of('NOT_FINISHED'), "wasn't read to the end", "weren't read to the end"));
  if (of('COUNT_MISMATCH') > 0) out.push(albums(of('COUNT_MISMATCH'), "doesn't match Google's count", "don't match Google's count"));
  if (of('COUNT_MISSING') > 0) out.push(albums(of('COUNT_MISSING'), 'had no count from Google', 'had no count from Google'));
  if (of('UNUSUAL_KEY_NOT_IN_LIBRARY') > 0) {
    out.push(albums(of('UNUSUAL_KEY_NOT_IN_LIBRARY'), "has a photo Photo Cleaner can't match to your library", "have photos Photo Cleaner can't match to your library"));
  }
  return out;
}

const REREAD_TEXT = { SAME_ENTRIES: 'read twice, the same entries both times', DIFFERENT_ENTRIES: 'read twice, different entries the second time' };

/** "count mismatch · shared · kind 4 · Google reports 229, 189 read (40 short) · not read a second time". */
function albumFactsLine(i: AlbumIssue, kinds: Record<AlbumIssueKind, string>): string {
  const f = i.facts;
  const short = f.reportedCount !== null && f.reportedCount !== f.entriesRead
    ? ` (${n(Math.abs(f.reportedCount - f.entriesRead))} ${f.reportedCount > f.entriesRead ? 'short' : 'more'})` : '';
  return [
    kinds[i.kind],
    f.isShared === null ? 'shared unknown' : f.isShared ? 'shared' : 'not shared',
    `kind ${f.kindCode ?? '?'}`,
    `Google reports ${f.reportedCount === null ? 'no count' : n(f.reportedCount)}, ${n(f.entriesRead)} read${short}`,
    f.reread === null ? 'not read a second time' : REREAD_TEXT[f.reread],
  ].join(' · ');
}

/** "Photos: 10,573 unknown for scan incomplete + scan out of date": the reasons as they come together. */
function reasonLines(classification: Classification): string[] {
  const groups = new Map<string, { what: string; reasons: string; howMany: number }>();
  for (const item of classification.items) {
    if (item.eligibility !== 'UNKNOWN') continue;
    const what = item.mediaType === 'PHOTO' ? 'Photos' : item.mediaType === 'VIDEO' ? 'Videos' : 'Items of unknown type';
    const reasons = [...item.unknownReasons].sort().map((r) => REASON_LABELS[r]).join(' + ');
    const group = groups.get(`${what}/${reasons}`) ?? { what, reasons, howMany: 0 };
    group.howMany++;
    groups.set(`${what}/${reasons}`, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.what.localeCompare(b.what) || b.howMany - a.howMany)
    .map((g) => `${g.what}: ${n(g.howMany)} unknown for ${g.reasons}`);
}

export function reportView(classification: Classification): ReportView {
  const { coverage, counts } = classification.report;
  const blocking = blockers(coverage);
  const [title, tone]: [string, Tone] = !coverage.isComplete
    ? [`No photo can be trashed: ${listed(blocking)}`, 'bad']
    : coverage.isStale
      ? ['The last scan is more than a day old: no photo can be trashed until you check for new photos', 'warn']
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
  const issueKinds: Record<AlbumIssueKind, string> = {
    FAILED: 'could not be read',
    NOT_FINISHED: 'not finished',
    COUNT_MISMATCH: 'count mismatch',
    COUNT_MISSING: 'no count from Google',
    UNUSUAL_KEY_NOT_IN_LIBRARY: 'unusual Google ID',
    COUNT_MISMATCH_READ_TWICE: 'count mismatch, not blocking',
  };
  const albumLine = (i: AlbumIssue) => `Album “${i.albumTitle ?? 'untitled'}” ${issueKinds[i.kind]}: ${i.detail}`;
  const diagnosticLines = [
    `Blocking trashing: ${blocking.length > 0 ? listed(blocking) : 'nothing'}${coverage.isStale ? '; the scan is also more than a day old' : ''}`,
    ...coverage.albumIssues.map((i, index) => `Album issue ${index + 1} (blocks): ${albumFactsLine(i, issueKinds)}`),
    ...coverage.albumWarnings.map((i, index) => `Album note ${index + 1} (doesn't block): ${albumFactsLine(i, issueKinds)}`),
    ...reasonLines(classification),
  ];
  const issueLines = coverage.albumIssues.map(albumLine);
  const noteLines = coverage.albumWarnings.map(albumLine);
  const tables = counts.filter((c) => c.total > 0).map(table);
  const photos = counts.find((c) => c.mediaType === 'PHOTO');
  const summary = photos
    ? `${n(photos.total)} photos · ${n(photos.protectedTotal)} protected · ${n(photos.eligible)} can be cleaned up · ${n(photos.unknown)} unknown`
    : 'No photos found';
  const copyText = [
    title,
    ...coverageLines,
    ...(issueLines.length > 0 ? [`${issueLines.length} album issue(s)`] : []),
    ...(noteLines.length > 0 ? [`${noteLines.length} album(s) not matching Google's count, the same on a second read`] : []),
    ...tables.flatMap((t) => [t.title, ...t.rows.map((r) => `${r.indent ? '    ' : '  '}${r.label}: ${r.value}`)]),
  ].join('\n');
  return { title, tone, warningText: tone === 'bad' ? title : null, summary, timesLine: coverageLines[0]!, coverageLines, issueLines, noteLines, tables, copyText, diagnosticLines };
}

/**
 * When the protection report must be worked out again: a key that changes when [account]'s scan
 * settles (finishes, pauses or fails) or the choices change. Null while there's nothing to work out
 * (no account, still loading, or a scan running, whose report would change at every page).
 */
export function reportKey(account: string | null, scan: Job | null | undefined, choices: ProtectionChoices | undefined): string | null {
  if (account === null || scan === undefined || choices === undefined || scan?.status === 'running') return null;
  return `${account}:${scan === null ? 'none' : `${scan.status}:${scan.updatedAtMs}`}:${JSON.stringify(choices)}`;
}

/** The report of [account]'s latest scan, classified at [nowMs] with [choices]; null before any scan. */
export async function latestReport(inventory: IndexedDbInventoryStore, account: string, choices: ProtectionChoices, nowMs: number): Promise<ReportView | null> {
  const run = await inventory.latestRun(account);
  return run ? reportView(classify(await inventory.snapshot(run.id), nowMs, choices)) : null;
}
