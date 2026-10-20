// One library scan of one account.
// Reads the library, favourites, archive, album list and every album's entries, one page at a
// time, saving each page with its resume point; resumes the account's unfinished run if there
// is one.

import type { IndexedDbInventoryStore } from './inventoryStore';
import type { AlbumStatus, ScanPhase, ScanRun } from './model';
import { INCOMPATIBLE_TEXT, logGoogleProblem, refusedText, type GoogleProblem } from '../shared/googleProblems';
import { ScanStats } from '../shared/runStats';
import { SourceError, waitingForPhotosText, waitsForPhotos, type PhotosSource } from './source';

export interface ScanPolicy {
  pacingMs: number;
  maxTransientRetries: number;
  transientBaseDelayMs: number;
  maxRateLimitRetries: number;
  rateLimitBaseDelayMs: number;
  maxRpcRetries: number;
}

export const DEFAULT_POLICY: ScanPolicy = {
  pacingMs: 300,
  maxTransientRetries: 4,
  transientBaseDelayMs: 2_000,
  maxRateLimitRetries: 3,
  rateLimitBaseDelayMs: 30_000,
  maxRpcRetries: 2,
};

export interface ScanProgress {
  phase: ScanPhase | null;
  libraryEntries: number;
  favouriteEntries: number;
  archiveEntries: number;
  albumsListed: number;
  albumsRead: number;
  albumsFailed: number;
  /** While the library is read newest to oldest: the oldest photo date reached so far. */
  libraryReachedMs: number | null;
  /** Something the user should know right now (a retry, a reset); null when all is well. */
  notice: string | null;
  /** When Google's answer stopped it, the details for a support request (absent in jobs saved before this existed). */
  googleProblem?: GoogleProblem | null;
}

export type ScanOutcome =
  | { kind: 'completed' }
  /**
   * Stopped by a problem the user can fix (session, tab, network, rate limit); resumable. When only
   * Google Photos was missing ([untilPhotosOpen]), it continues by itself once it is back.
   */
  | { kind: 'paused'; reason: string; untilPhotosOpen: boolean }
  /** Stopped by something that needs an update of the extension; not resumable. */
  | { kind: 'failed'; reason: string }
  /** The user paused it. */
  | { kind: 'stopped' }
  /** Could not even start (no Photos tab, signed out, other account); [untilPhotosOpen] as for paused. */
  | { kind: 'not-started'; reason: string; untilPhotosOpen: boolean };

export interface ScanDeps {
  account: string;
  source: PhotosSource;
  store: IndexedDbInventoryStore;
  policy?: ScanPolicy;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Where this run's numbers go (see shared/runStats.ts); kept by the background page. */
  stats?: ScanStats;
  /** Asked before every request: true once the user has paused the scan. */
  shouldStop: () => Promise<boolean>;
  onProgress: (progress: ScanProgress) => Promise<void>;
}

/** Stops the scan with a reason; the run becomes PAUSED (resumable) or FAILED. */
class ScanStop extends Error {
  constructor(readonly outcome: 'paused' | 'failed', message: string, readonly cause: unknown = null) {
    super(message);
  }
}

class UserStop extends Error {}

/** An RPC error that kept failing; handled by the phase (reset a saved position, mark an album failed). */
class RpcFailed extends Error {
  constructor(readonly error: SourceError) {
    super(error.message);
  }
}

export async function runScan(deps: ScanDeps): Promise<ScanOutcome> {
  return new ScanSession(deps).execute();
}

class ScanSession {
  private readonly policy: ScanPolicy;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private run!: ScanRun;
  private phase: ScanPhase | null = null;
  private notice: string | null = null;
  private googleProblem: GoogleProblem | null = null;
  private libraryReachedMs: number | null = null;
  private readonly stats: ScanStats;

  constructor(private readonly deps: ScanDeps) {
    this.policy = deps.policy ?? DEFAULT_POLICY;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.stats = deps.stats ?? new ScanStats();
  }

  async execute(): Promise<ScanOutcome> {
    const { store, account } = this.deps;
    let signedIn: string;
    try {
      signedIn = (await this.request('session check', () => this.deps.source.status())).accountFingerprint;
    } catch (e) {
      if (e instanceof ScanStop) return { kind: 'not-started', reason: e.message, untilPhotosOpen: waitsForPhotos(e.cause) };
      if (e instanceof UserStop) return { kind: 'stopped' };
      throw e;
    }
    if (signedIn !== account) {
      return { kind: 'not-started', reason: 'The Google Photos tab is signed in to a different account. Switch it to this account, then scan.', untilPhotosOpen: false };
    }

    const latest = await store.latestRun(account);
    const unfinished = latest && (latest.status === 'RUNNING' || latest.status === 'PAUSED') ? latest : null;
    this.run = unfinished ?? (await store.createRun(account, this.now()));
    await store.updateRunStatus(this.run.id, 'RUNNING', null, null);
    if (unfinished) this.libraryReachedMs = await store.oldestTakenAtMs(this.run.id);

    try {
      await this.emitProgress();
      await this.libraryPhase();
      await this.favouritesPhase();
      await this.archivePhase();
      await this.albumListPhase();
      await this.albumMembersPhase();
      await this.albumRereads();
      this.phase = null;
      this.notice = null;
      await store.updateRunStatus(this.run.id, 'COMPLETED', null, this.now());
      await store.deleteOtherRuns(account, this.run.id);
      await this.emitProgress();
      return { kind: 'completed' };
    } catch (e) {
      if (e instanceof UserStop) {
        await store.updateRunStatus(this.run.id, 'PAUSED', 'Paused', null);
        return { kind: 'stopped' };
      }
      if (e instanceof ScanStop) {
        const failed = e.outcome === 'failed';
        await store.updateRunStatus(this.run.id, failed ? 'FAILED' : 'PAUSED', e.message, failed ? this.now() : null);
        this.notice = e.message;
        await this.emitProgress();
        return e.outcome === 'paused' ? { kind: 'paused', reason: e.message, untilPhotosOpen: waitsForPhotos(e.cause) } : { kind: 'failed', reason: e.message };
      }
      throw e;
    }
  }

  // --- phases ---

  private async libraryPhase(): Promise<void> {
    this.phase = 'LIBRARY';
    await this.pagedPhase('LIBRARY', '', 'library', async (token) => {
      const page = await this.deps.source.libraryPage(token);
      this.verifyAccount(page.accountFingerprint);
      await this.deps.store.savePage(this.run.id, { phase: 'LIBRARY', entries: page.entries }, page.nextPageToken);
      for (const item of page.entries) {
        if (this.libraryReachedMs === null || item.takenAtMs < this.libraryReachedMs) this.libraryReachedMs = item.takenAtMs;
      }
      return page.nextPageToken;
    });
  }

  private async favouritesPhase(): Promise<void> {
    this.phase = 'FAVOURITES';
    await this.pagedPhase('FAVOURITES', '', 'favourites', async (token) => {
      const page = await this.deps.source.favouritesPage(token);
      this.verifyAccount(page.accountFingerprint);
      await this.deps.store.savePage(this.run.id, { phase: 'FAVOURITES', entries: page.entries }, page.nextPageToken);
      return page.nextPageToken;
    });
  }

  private async archivePhase(): Promise<void> {
    this.phase = 'ARCHIVE';
    await this.pagedPhase('ARCHIVE', '', 'archive', async (token) => {
      const page = await this.deps.source.archivePage(token);
      this.verifyAccount(page.accountFingerprint);
      await this.deps.store.savePage(this.run.id, { phase: 'ARCHIVE', entries: page.entries }, page.nextPageToken);
      return page.nextPageToken;
    });
  }

  private async albumListPhase(): Promise<void> {
    this.phase = 'ALBUM_LIST';
    await this.pagedPhase('ALBUM_LIST', '', 'album list', async (token) => {
      const page = await this.deps.source.albumsPage(token);
      this.verifyAccount(page.accountFingerprint);
      await this.deps.store.savePage(this.run.id, { phase: 'ALBUM_LIST', entries: page.entries }, page.nextPageToken);
      return page.nextPageToken;
    });
  }

  private async albumMembersPhase(): Promise<void> {
    this.phase = 'ALBUM_MEMBERS';
    for (const status of await this.deps.store.albums(this.run.id)) {
      if (status.membersComplete && status.failureReason === null) continue;
      if (status.failureReason !== null) await this.deps.store.resetPhase(this.run.id, 'ALBUM_MEMBERS', status.album.albumKey);
      await this.readAlbum(status);
    }
  }

  private async readAlbum(status: AlbumStatus): Promise<void> {
    const album = status.album;
    try {
      await this.pagedPhase('ALBUM_MEMBERS', album.albumKey, 'album contents', async (token) => {
        const page = await this.deps.source.albumItemsPage(album.albumKey, album.authKey, token);
        this.verifyAccount(page.accountFingerprint);
        await this.deps.store.savePage(this.run.id, { phase: 'ALBUM_MEMBERS', albumKey: album.albumKey, entries: page.entries }, page.nextPageToken);
        return page.nextPageToken;
      });
    } catch (e) {
      if (e instanceof RpcFailed) {
        await this.deps.store.markAlbumFailed(this.run.id, album.albumKey, `Google Photos refused to list it (code ${e.error.rpcCode ?? e.error.httpStatus ?? 'unknown'})`);
        await this.emitProgress();
        return;
      }
      // Google reports some inaccessible shared albums as "permission denied", which looks like a
      // lost session. Only a fresh session check can tell the two apart.
      if (e instanceof ScanStop && e.cause instanceof SourceError && e.cause.kind === 'SESSION' && (await this.sessionStillValid())) {
        await this.deps.store.markAlbumFailed(this.run.id, album.albumKey, "This account isn't allowed to open it (for example a shared album you were removed from)");
        await this.emitProgress();
        return;
      }
      throw e;
    }
  }

  /**
   * Reads every fully read album whose entries don't add up to Google's count a second time, and
   * records whether the same entries came back. Google's count can include entries this account
   * can't see; a lost page or a list cut short would hardly repeat identically. The shared rules
   * decide what the outcome means. Albums still to check are found again on resume.
   */
  private async albumRereads(): Promise<void> {
    for (const status of await this.deps.store.albums(this.run.id)) {
      const reported = status.album.reportedItemCount;
      const mismatched = status.membersComplete && status.failureReason === null && reported !== null && reported !== status.membersSeen;
      if (mismatched && status.reread === null) await this.rereadAlbum(status);
    }
  }

  private async rereadAlbum(status: AlbumStatus): Promise<void> {
    const album = status.album;
    // mediaKey -> dedupKey, the first of each, as the first read saved them.
    const entries = new Map<string, string>();
    let token: string | null = null;
    try {
      do {
        const page = await this.request('album contents', () => this.deps.source.albumItemsPage(album.albumKey, album.authKey, token));
        this.verifyAccount(page.accountFingerprint);
        for (const entry of page.entries) if (!entries.has(entry.mediaKey)) entries.set(entry.mediaKey, entry.dedupKey);
        token = page.nextPageToken;
      } while (token !== null);
    } catch (e) {
      // Refused the second time: nothing is recorded, so the mismatch keeps blocking.
      if (e instanceof RpcFailed) return;
      if (e instanceof ScanStop && e.cause instanceof SourceError && e.cause.kind === 'SESSION' && (await this.sessionStillValid())) return;
      throw e;
    }
    const saved = await this.deps.store.albumEntries(this.run.id, album.albumKey);
    const same = saved.length === entries.size && saved.every((s) => entries.get(s.mediaKey) === s.dedupKey);
    await this.deps.store.recordReread(this.run.id, album.albumKey, same ? 'SAME_ENTRIES' : 'DIFFERENT_ENTRIES');
    await this.emitProgress();
  }

  /**
   * Pages through one phase from its saved resume point. A saved page token that Google no
   * longer accepts restarts the phase from the beginning, once.
   */
  private async pagedPhase(phase: ScanPhase, scope: string, label: string, fetchAndSave: (token: string | null) => Promise<string | null>): Promise<void> {
    const cursor = await this.deps.store.cursor(this.run.id, phase, scope);
    if (cursor?.completed) return;
    let token = cursor?.nextPageToken ?? null;
    let usingSavedToken = token !== null;
    for (;;) {
      let next: string | null;
      try {
        next = await this.request(label, () => fetchAndSave(token));
      } catch (e) {
        if (!(e instanceof RpcFailed)) throw e;
        if (!usingSavedToken) {
          if (phase === 'ALBUM_MEMBERS') throw e;
          this.googleProblem = logGoogleProblem(`scan: ${label}`, e.error);
          throw new ScanStop('paused', refusedText(label, e.error.rpcCode ?? e.error.httpStatus), e.error);
        }
        this.notice = `The saved position in the ${label} expired; reading it again from the start.`;
        await this.deps.store.resetPhase(this.run.id, phase, scope);
        token = null;
        usingSavedToken = false;
        continue;
      }
      usingSavedToken = false;
      await this.emitProgress();
      if (next === null) return;
      token = next;
    }
  }

  // --- request policy ---

  private async request<T>(label: string, block: () => Promise<T>): Promise<T> {
    let transientFailures = 0;
    let rateLimits = 0;
    let rpcFailures = 0;
    for (;;) {
      if (await this.deps.shouldStop()) throw new UserStop();
      await this.wait(label, this.policy.pacingMs);
      const start = this.now();
      try {
        const result = await block();
        this.stats.page(label, this.now() - start);
        if (transientFailures > 0 || rateLimits > 0) this.notice = null;
        return result;
      } catch (e) {
        if (!(e instanceof SourceError)) throw e;
        switch (e.kind) {
          case 'TRANSIENT': {
            transientFailures++;
            if (transientFailures > this.policy.maxTransientRetries) {
              throw new ScanStop('paused', `Repeated network problems while reading the ${label}. Resume when the connection is stable.`, e);
            }
            this.notice = `Network problem while reading the ${label}; retrying (${transientFailures}/${this.policy.maxTransientRetries}).`;
            await this.emitProgressIfStarted();
            this.stats.retry(label, 'network');
            await this.wait(label, this.policy.transientBaseDelayMs * 2 ** (transientFailures - 1));
            break;
          }
          case 'RATE_LIMIT': {
            rateLimits++;
            if (rateLimits > this.policy.maxRateLimitRetries) throw new ScanStop('paused', 'Google is limiting requests. Resume the scan later.', e);
            this.notice = `Google is limiting requests; waiting before retrying (${rateLimits}/${this.policy.maxRateLimitRetries}).`;
            await this.emitProgressIfStarted();
            this.stats.retry(label, 'rate limit');
            await this.wait(label, this.policy.rateLimitBaseDelayMs * 2 ** (rateLimits - 1));
            break;
          }
          case 'RPC_ERROR':
            rpcFailures++;
            this.stats.retry(label, 'refused');
            if (rpcFailures > this.policy.maxRpcRetries) throw new RpcFailed(e);
            await this.wait(label, this.policy.transientBaseDelayMs);
            break;
          case 'SESSION':
          case 'NO_PHOTOS_TAB':
            throw new ScanStop('paused', waitingForPhotosText(e), e);
          case 'PROTOCOL':
          case 'BAD_REQUEST':
          case 'PREVIEW_UNAVAILABLE': // a listing never fetches previews
            this.googleProblem = logGoogleProblem(`scan: ${label}`, e);
            throw new ScanStop('failed', INCOMPATIBLE_TEXT, e);
        }
      }
    }
  }

  /** Waits [ms] between or before requests for [label], counted in the run's numbers. */
  private async wait(label: string, ms: number): Promise<void> {
    const start = this.now();
    await this.sleep(ms);
    this.stats.waited(label, this.now() - start);
  }

  private async sessionStillValid(): Promise<boolean> {
    try {
      return (await this.deps.source.status()).accountFingerprint === this.run.accountFingerprint;
    } catch {
      return false;
    }
  }

  private verifyAccount(fingerprint: string): void {
    if (fingerprint !== this.run.accountFingerprint) {
      throw new ScanStop('paused', 'The Google Photos tab is now signed in to a different account. Switch back to the scanned account, then resume.');
    }
  }

  // --- progress ---

  private async emitProgress(): Promise<void> {
    const store = this.deps.store;
    const cursors = await store.cursors(this.run.id);
    const seen = (phase: ScanPhase) => cursors.find((c) => c.phase === phase && c.scope === '')?.entriesSeen ?? 0;
    const albums = await store.albums(this.run.id);
    await this.deps.onProgress({
      phase: this.phase,
      libraryEntries: seen('LIBRARY'),
      favouriteEntries: seen('FAVOURITES'),
      archiveEntries: seen('ARCHIVE'),
      albumsListed: albums.length,
      albumsRead: albums.filter((a) => a.membersComplete && a.failureReason === null).length,
      albumsFailed: albums.filter((a) => a.failureReason !== null).length,
      libraryReachedMs: this.phase === 'LIBRARY' ? this.libraryReachedMs : null,
      notice: this.notice,
      googleProblem: this.googleProblem,
    });
  }

  private async emitProgressIfStarted(): Promise<void> {
    if (this.run !== undefined) await this.emitProgress();
  }
}
