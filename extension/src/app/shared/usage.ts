// Optional usage statistics. Only this closed vocabulary may leave the computer.
const surfaces = ['popup', 'panel', 'review', 'scan', 'duplicates', 'search'] as const;
const features = ['scan', 'analysis', 'duplicates', 'search', 'trash', 'engine'] as const;
const reasons = ['unknown', 'user', 'photos_closed', 'signed_out', 'google_changed', 'network', 'rate_limit', 'model', 'storage', 'stale_scan', 'unfinished_scan', 'not_scanned', 'protection', 'gentle', 'launch'] as const;
const durations = ['under_10s', '10s_1m', '1m_5m', '5m_30m', '30m_2h', '2h_8h', '8h_plus', 'unknown'] as const;
const schema = {
  usage_enabled: {},
  surface_view: { surface: surfaces },
  surface_engagement: { surface: surfaces },
  surface_ready: { surface: ['panel', 'review'] },
  surface_open_requested: { source_surface: surfaces, target_surface: ['panel', 'review'] },
  surface_open_result: { source_surface: surfaces, target_surface: ['panel', 'review'], result: ['accepted', 'failed'] },
  scan_requested: { attempt_kind: ['initial', 'refresh'] },
  scan_started: {},
  scan_finished: { duration_bucket: durations },
  analysis_started: { work_kind: ['new_work', 'no_work'] },
  model_load_started: { feature: ['analysis', 'search'] },
  model_ready: { feature: ['analysis', 'search'], duration_bucket: durations },
  analysis_progress: { milestone: ['first', '25', '50', '75'] },
  analysis_finished: { result: ['complete', 'with_skips', 'no_work'], duration_bucket: durations },
  duplicates_ready: { state: ['usable', 'empty', 'blocked'] },
  review_progress: { milestone: ['1', '10', '50'], decision: ['approve', 'keep', 'later'] },
  search_submitted: { search_kind: ['text', 'like', 'examples'] },
  search_results: { search_kind: ['text', 'like', 'examples'], state: ['usable', 'empty', 'blocked'], duration_bucket: durations },
  search_selected: {},
  trash_confirmation: { action: ['shown', 'cancelled'] },
  trash_approved: { source: ['duplicates', 'search'] },
  trash_result: { source: ['duplicates', 'search'], result: ['confirmed', 'failed', 'uncertain', 'blocked', 'cancelled', 'restored'] },
  undo_used: { source: ['duplicates', 'search'] },
  job_paused: { feature: features, reason: reasons, actor: ['user', 'automatic'] },
  job_resumed: { feature: features, actor: ['user', 'automatic'] },
  feature_failed: { feature: features, reason: reasons },
  feature_blocked: { feature: features, reason: reasons },
} as const;

export type UsageEvent = { [N in keyof typeof schema]: { name: N; params: { [P in keyof typeof schema[N]]: typeof schema[N][P] extends readonly string[] ? typeof schema[N][P][number] : never } } }[keyof typeof schema];
export type UsageSurface = typeof surfaces[number];
export type UsageFeature = typeof features[number];
export type UsageReason = typeof reasons[number];
export type UsageAnswer = 'yes' | 'no' | 'unknown';
export interface UsageConfig { measurementId: string; apiSecret: string; debug: boolean }
declare const __PHOTO_CLEANER_USAGE__: UsageConfig | null;
export const USAGE_CONFIG: UsageConfig | null = typeof __PHOTO_CLEANER_USAGE__ === 'undefined' ? null : __PHOTO_CLEANER_USAGE__;
export const USAGE_POLICY = 'https://gaborbiro.github.io/google-photo-cleaner/privacy.html#usage';

/** Rebuilds only exact approved fields; never spreads untrusted payloads into a request. */
export function checkedUsage(value: unknown): UsageEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (Object.keys(event).sort().join(',') !== 'name,params' || typeof event.name !== 'string' || !Object.hasOwn(schema, event.name)) return null;
  const fields = schema[event.name as keyof typeof schema] as Record<string, readonly string[]>;
  if (!event.params || typeof event.params !== 'object' || Array.isArray(event.params)) return null;
  const params = event.params as Record<string, unknown>;
  if (Object.keys(params).sort().join(',') !== Object.keys(fields).sort().join(',')) return null;
  const clean: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(fields)) {
    if (typeof params[key] !== 'string' || !allowed.includes(params[key] as string)) return null;
    clean[key] = params[key] as string;
  }
  return { name: event.name, params: clean } as UsageEvent;
}

export function durationBucket(ms: number): typeof durations[number] {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  return durations[[10_000, 60_000, 300_000, 1_800_000, 7_200_000, 28_800_000].findIndex((edge) => ms < edge)] ?? '8h_plus';
}

export function usageView(answer: UsageAnswer, configured: boolean) {
  return {
    ask: answer === 'unknown',
    enabled: answer === 'yes',
    title: 'Help improve Photo Cleaner?',
    description: 'If you agree, send usage events to Google Analytics about which features you use, how far you get, and whether they work. Never your photos, searches, albums or Google account.',
    setting: 'Send optional usage statistics',
    status: configured ? 'You can change this at any time.' : 'Reporting is not configured in this build; nothing will be sent.',
  };
}
