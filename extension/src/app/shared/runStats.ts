// How one run of a library read or an analysis went, in numbers: where its time went, how often
// Google was slow or refused, how many photos it did. The scan and the analysis record into these;
// the background page keeps them in the problem log (problemLog.ts), so that Copy diagnostics can
// show why a run was slow, also after it ended. Counts and times only, never photo data.

/** One listing's requests during a library read ("library", "album contents"…). */
export interface ListingStats {
  /** Requests that came back with a page. */
  pages: number;
  /** Time spent in those requests, including saving the page. */
  requestMs: number;
  slowestMs: number;
  /** Retries, by why. */
  networkRetries: number;
  rateLimits: number;
  refusals: number;
  /** Waiting between requests (pacing) and before retries. */
  waitedMs: number;
}

export interface ScanRunStats {
  stage: 'library read';
  listings: Record<string, ListingStats>;
}

export interface AnalysisRunStats {
  stage: 'analysis';
  /** Photos in the library, and how many already had a fingerprint when the run began. */
  photos: number;
  alreadyAnalysed: number;
  photosDone: number;
  previewsFailed: number;
  /** The level of detail, and the speed the first speed check measured (photos per second). */
  detail: number | null;
  measuredPhotosPerSecond: number | null;
  /** Getting the AI model ready, including a download; whether its files were on this computer already. */
  modelMs: number;
  modelCached: boolean | null;
  speedCheckMs: number;
  /** Reading the library's pages to find the photos to do. */
  pagesMs: number;
  /** Per photo, summed over the run (see ai/speed.ts PhotoTiming). */
  aiMs: number;
  previewMs: number;
  saveMs: number;
  gentleMs: number;
  otherMs: number;
  /** Google limiting preview downloads: how often, and how long it waited. */
  rateLimits: number;
  rateLimitWaitMs: number;
  /** Full speed when the run began and when it was last saved. */
  fullSpeedAtStart: boolean | null;
  fullSpeedNow: boolean | null;
  /** Which graphics card the browser offers ("intel / gen-12lp"); null when unknown. */
  graphics: string | null;
}

export type RunStats = ScanRunStats | AnalysisRunStats;

const emptyListing = (): ListingStats => ({ pages: 0, requestMs: 0, slowestMs: 0, networkRetries: 0, rateLimits: 0, refusals: 0, waitedMs: 0 });

/** What a library read records. */
export class ScanStats {
  readonly stats: ScanRunStats = { stage: 'library read', listings: {} };

  private listing(label: string): ListingStats {
    this.stats.listings[label] ??= emptyListing();
    return this.stats.listings[label];
  }

  page(label: string, ms: number): void {
    const l = this.listing(label);
    l.pages++;
    l.requestMs += ms;
    l.slowestMs = Math.max(l.slowestMs, ms);
  }

  retry(label: string, why: 'network' | 'rate limit' | 'refused'): void {
    const l = this.listing(label);
    if (why === 'network') l.networkRetries++;
    else if (why === 'rate limit') l.rateLimits++;
    else l.refusals++;
  }

  waited(label: string, ms: number): void {
    this.listing(label).waitedMs += ms;
  }
}

/** What an analysis records. */
export class AnalysisStats {
  readonly stats: AnalysisRunStats = {
    stage: 'analysis', photos: 0, alreadyAnalysed: 0, photosDone: 0, previewsFailed: 0, detail: null, measuredPhotosPerSecond: null,
    modelMs: 0, modelCached: null, speedCheckMs: 0, pagesMs: 0, aiMs: 0, previewMs: 0, saveMs: 0, gentleMs: 0, otherMs: 0,
    rateLimits: 0, rateLimitWaitMs: 0, fullSpeedAtStart: null, fullSpeedNow: null, graphics: null,
  };

  begin(photos: number, alreadyAnalysed: number, detail: number, measuredPhotosPerSecond: number): void {
    Object.assign(this.stats, { photos, alreadyAnalysed, detail, measuredPhotosPerSecond });
  }

  photo(t: { ai: number; preview: number; save: number; pace: number; other: number }): void {
    const s = this.stats;
    s.photosDone++;
    s.aiMs += t.ai;
    s.previewMs += t.preview;
    s.saveMs += t.save;
    s.gentleMs += t.pace;
    s.otherMs += t.other;
  }

  previewFailed(): void {
    this.stats.previewsFailed++;
  }

  rateLimited(waitMs: number): void {
    this.stats.rateLimits++;
    this.stats.rateLimitWaitMs += waitMs;
  }

  add(part: 'modelMs' | 'speedCheckMs' | 'pagesMs', ms: number): void {
    this.stats[part] += ms;
  }
}
