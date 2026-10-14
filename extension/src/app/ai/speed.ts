// How fast the analysis is going right now, and where each photo's time goes. Averages over
// the last minute, so ticking Full speed or a busy graphics card shows up within a minute
// instead of being diluted by everything since the start.

export const SPEED_WINDOW_MS = 60_000;

/** Where one photo's time went, in milliseconds. */
export interface PhotoTiming {
  /** Between photos: stop checks, saving progress, reading the next library page. */
  other: number;
  /** Held back by gentle mode. */
  pace: number;
  /** Waiting for its preview to arrive from Google (prefetching should hide this). */
  preview: number;
  /** The AI model on the graphics card. */
  ai: number;
  /** Quality measurement and saving. */
  save: number;
}

export interface RecentSpeed {
  photosPerSecond: number;
  /** Average per photo over the same window. */
  perPhoto: PhotoTiming;
}

export class SpeedMeter {
  private readonly done: { atMs: number; timing: PhotoTiming }[] = [];

  constructor(private readonly startedAtMs: number) {}

  record(atMs: number, timing: PhotoTiming): void {
    this.done.push({ atMs, timing });
    this.forget(atMs);
  }

  /** Over the last minute (or since the start, if shorter); null before the first photo. */
  recent(nowMs: number): RecentSpeed | null {
    this.forget(nowMs);
    const count = this.done.length;
    const spanMs = nowMs - Math.max(this.startedAtMs, nowMs - SPEED_WINDOW_MS);
    if (count === 0 || spanMs <= 0) return null;
    const average = (part: keyof PhotoTiming) => this.done.reduce((total, d) => total + d.timing[part], 0) / count;
    return {
      photosPerSecond: (count * 1000) / spanMs,
      perPhoto: { other: average('other'), pace: average('pace'), preview: average('preview'), ai: average('ai'), save: average('save') },
    };
  }

  private forget(nowMs: number): void {
    while (this.done.length > 0 && this.done[0]!.atMs <= nowMs - SPEED_WINDOW_MS) this.done.shift();
  }
}
