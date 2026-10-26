# Usage events: plan

Status: planned 2026-10-24, not built. Decided: users are asked once, nothing is sent until they say
yes; the first version sends the funnel and the failures that most likely cause drop-off. This
replaces the Firebase item in `roadmap.md` section 3 (same idea: Google Analytics through the
Measurement Protocol), and covers part of its error list.

## What the user sees

- **The question**, once, as a small card at the top of the panel and of the review tab's Scan tab,
  until answered. It never blocks a scan.

  > **Help make Photo Cleaner better?**
  > Send anonymous counts: how far scans and reviews get, and what went wrong. Never your photos,
  > their names, dates or places, your albums or your account. [What is sent](privacy page anchor)
  > [Yes, send counts] [No thanks]

- **A setting** on the review tab's Scan tab, beside the protection choices: "Send anonymous usage
  counts" (on/off). It shows the same "What is sent" link.
- **Erase Photo Cleaner's data** also erases the answer and the install ID, so the question comes back.
- Nobody is counted before they say yes, so the funnel starts at "said yes". The Chrome Web Store's
  install count is the step before it. Those who say yes may not be typical users. Keep that in mind
  when reading the numbers.

## What is sent

Every event goes to one Google Analytics 4 property with:
- `client_id`: a random install ID (`crypto.randomUUID()`), made when the user says yes;
- `session_id`, plus `engagement_time_msec: 1`, so Google Analytics counts active users and sessions;
- `version`: the extension version.

Parameters are only fixed words or **ranges**, never exact numbers, keys, titles, addresses or
messages that contain values. The event types are a closed TypeScript union, so nothing else can be
sent.

### Funnel

| Event | When | Parameters |
|---|---|---|
| `panel_opened` | the panel opens | — |
| `scan_started` | Scan pressed | — |
| `scan_finished` | a scan completes | `library` (range: <1k, 1k–10k, 10k–50k, 50k–100k, 100k+), `minutes` (range) |
| `model_loaded` | the AI model is ready | `seconds` (range) |
| `speed_checked` | first-run speed check | `photos_per_second` (range) |
| `analysis_finished` | an analysis completes | `photos` (range), `hours` (range) |
| `review_opened` | the review tab opens | — |
| `duplicates_opened` | the Duplicates tab opens | `groups` (range, including 0) |
| `first_decision` | the first group decided in a review tab | `decision` (trash / keep / later) |
| `search_used` | the first search in a review tab | `kind` (text / like / examples) |
| `trash_finished` | a trash queue empties | `source` (duplicates / search), `trashed`, `failed`, `uncertain` (ranges) |
| `data_erased` | just before an erase, if the user said yes | — |

### Failures

| Event | Raised from | Parameters |
|---|---|---|
| `model_failed` | `ai/analysis.ts` `loadModel` | `reason` (no_webgpu / no_disk_space / download / other) |
| `google_changed` | `logGoogleProblem` | `where` (account / scan / analysis / previews / trash), `request` (Google's request name), `kind` (protocol / bad_request) |
| `stopped_unexpectedly` | catch in `engine/main.ts` | `job` (scan / analysis) |
| `engine_failed` | engine error in `background/main.ts` | — |

Not sent: the problem log's details (parser paths, answer structure), the account fingerprint,
anything from `ScanProgress` beyond the ranges above.

## How it is built

**One sender, in the service worker.** The panel, popup, review tab and engine send a new
`app-usage-event` request (the existing `AppRequest` pattern in `shared/messages.ts`). The service
worker looks up the answer and, only if it is yes, posts to
`https://www.google-analytics.com/mp/collect`. A failed send is dropped and never retried. Usage
counts aren't worth a queue.
- To verify in Chrome: the post works without a new host permission. A new host permission would
  show users a new warning on update. If CORS refuses it, send as a simple `text/plain`
  `no-cors` request; the reply isn't needed.

**Where the answer lives.** A new IndexedDB store `usage` (DB_VERSION 9), not per account:
`{ answer: 'yes' | 'no', installId?, answeredAt }`. Added through `create(...)` in `db.ts`, so
`erase` removes it with everything else. A model in `shared/usage.ts` gives the screens the card's
and the setting's texts and states (no logic in screens).

**The measurement ID and API secret** come from a git-ignored `extension/usage.config.json`, read by
`build.mjs` into a define (`__PHOTO_CLEANER_USAGE__`). Without the file the build sends nothing,
so dev builds and CI never pollute the data. `npm run package` refuses to make a release zip
without it. `vitest.config.mjs` defines it as empty. The API secret ends up in the published code,
as with every client-side Measurement Protocol use. Anyone could send fake events with it, and
that's an accepted risk.

**Tests**
- `usage` model and sender: nothing is sent before an answer or after "no"; "yes" sends with the
  install ID; erase forgets both; ranges have the right edges; a send failure is dropped and logs no
  error.
- Tripwire (beside `ops.test.ts`): the only external `fetch` in `src/app` is the usage sender, to the
  Google Analytics host only; no event type has a free-text string parameter.
- `screens.test.tsx`: the card in the panel and review tab, both buttons, the setting, and the card
  coming back after erase; `fetch` stubbed.
- `db.test.ts`: `usage` in `STORES_BY_VERSION` for 9, upgrade from 8.

**Manual checks** (add to `docs/extension-manual-checks.md`): with a real config, events arrive in
Google Analytics' DebugView (use the `/debug/mp/collect` endpoint to validate payloads), nothing is
sent after "No", and nothing after an erase until asked again.

## Wording to change in the same release

The privacy page must be published (Pages workflow) before the store update goes live.
- `site/privacy.html`: lines 29 and 62 ("no analytics, no crash reports") become a section
  "Anonymous usage counts, if you agree": the table above in plain words, the anchor the card links to,
  and that Google Analytics receives them.
- `docs/chrome-web-store.md`: the listing line "No account, no server, no analytics" becomes "No
  account. Your photos never leave your computer. Anonymous usage counts only if you agree". Update the
  Privacy tab answers (lines 114–117) too: probably "User activity", collected only with consent.
- `README.md` (78–84) and `AGENTS.md` (Privacy rule): allow the usage events, within the closed list.

## Your part (Google Analytics)

1. In Google Analytics, create a property "Photo Cleaner extension". Keep it separate from the store
   listing's property. Add a Web data stream, which gives the measurement ID `G-…`.
2. Data stream → Measurement Protocol API secrets → Create. Put both in
   `extension/usage.config.json` yourself, as `{ "measurementId": "G-…", "apiSecret": "…" }`.
3. Admin → Custom definitions: register the parameters above (`library`, `reason`, `where`, …) as
   event-scoped custom dimensions, or they won't appear in Explore.
4. Admin → Data collection: leave Google signals off.
5. After release: Explore → Funnel exploration, with the steps in the funnel table above.
