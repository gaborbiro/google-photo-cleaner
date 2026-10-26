# Usage events and funnels

Status: code implemented 2026-10-26 in 0.4.49; live GA configuration/report verification and policy/store
publication remain. Ordinary builds send nothing. See [setup and release checks](usage-events-setup.md).
This develops the 2026-10-24 draft. The design below records the proposed reporting contract; the
exact implemented event names/fields are allowlisted in `extension/src/app/shared/usage.ts`.
The decision to ask first and send nothing until agreement is retained. User decision: send
directly to GA4 with no relay; accept the extractable submission secret and use reporting checks
to investigate suspicious traffic, without claiming event authenticity. See
[analytics-findings.md](analytics-findings.md) for verified external requirements and citations.

## What we want to learn

1. Do people get from the toolbar popup into the side panel or review tab, and does it actually load?
   Then, do they reach a working scan or get stuck opening Google Photos or starting the engine?
2. Does the first analysis get through model loading and make progress? How long until completion?
3. Do people open Duplicates, see usable groups, make one decision, and continue reviewing?
4. Do people try Search, get results, select photos and confirm a sweep?
5. After approval, are photos actually confirmed in Google Photos' trash?
6. Which stages are paused, blocked or failing, and does the user return and recover?

Measure consenting installations, not identifiable people or Google accounts. There is no historical
usage to recover. Separate existing setups from new setups at opt-in. Chrome Web Store installs
remain a separate acquisition report; they cannot be joined to consenting installations to give an
accurate install-to-cleanup conversion rate.

## Findings from the project

All source paths below are relative to `extension/src/app/`.

| Area | Existing implementation and implication |
|---|---|
| Entry points | `popup/main.tsx`, `panel/main.tsx`, `review/main.tsx`. People can enter through any surface. `ui/hooks.ts` opens the side panel; `background/main.ts` opens or focuses the review tab. A successful Chrome API call does not prove the destination rendered. Record fixed surface names, never URLs. |
| Start/pause/resume | `shared/actions.ts` saves jobs and wakes the engine. Distinguish a scan requested from work actually starting. |
| Library read | `scan/session.ts` distinguishes completed, paused, failed, stopped and not-started outcomes and knows the listing phase. |
| AI analysis | `ai/analysis.ts` has model loading, a first-run speed check, resumable progress and a no-new-work shortcut. Model loading is not mandatory on every scan. |
| Background lifecycle | `engine/main.ts` owns runs; `background/main.ts` starts the engine, resumes jobs and handles erase. Closing the panel does not stop a scan. |
| Duplicates | `duplicates/reviewModel.ts` and `duplicates/session.ts` build groups and save decisions. Shared Kotlin rules own grouping/protection. They can offer groups from partial analysis. |
| Search | `search/searchModel.ts` owns search, selection and confirmation; `search/session.ts` loads the text model and rechecks eligibility before a sweep. Text search has a separate model-loading failure point. |
| Trash and undo | `duplicates/trash.ts`, `googleTrash.ts`, `reviewStore.ts`. Both features share the queue. It runs while a review tab is open (`review/Duplicates.tsx`), whichever inner tab is selected. Approval is not confirmed trashing. |
| Local diagnostics | `shared/runStats.ts`, `problemLog.ts`, `googleProblems.ts` already record timings and structured failures. Do not upload these records wholesale. |
| Storage | IndexedDB version 8; existing upgrade/erase and integration tests can be extended. |
| Analytics | The initial exploration found no sender or consent state. These are now implemented; live GA reporting still requires configuration and verification. |

## Reports to build

Use separate ordered funnels with indirectly followed steps, allowing unrelated events in between.
Configure an explicit time limit on each transition and label it in the report. GA4 supports at most
ten steps per funnel. The old draft's twelve-row event list should not become one funnel.

| Report | Steps | Initial window |
|---|---|---|
| Opening the side panel | Popup visible → panel open requested → Chrome accepted the launch → panel visible and rendered | Up to 1 minute between steps; known API failures shown separately |
| Opening the review tab | Popup/panel visible → review open requested → Chrome accepted the launch → review visible and rendered | Up to 1 minute between steps; new and reused tabs both covered |
| Starting a scan | Scan requested → scan actually started → library read completed | Up to 24 hours between steps |
| AI analysis | Analysis started with new work → model ready → first progress → analysis completed | Up to 7 days between steps |
| Duplicates | Duplicates visible → usable groups shown → first saved decision → 10 saved decisions | Up to 7 days between steps |
| Search | Search visible → search submitted → usable results shown → photos selected → sweep confirmed and queued | Up to 24 hours between steps |
| Trashing | Approval saved with at least one queued photo → at least one photo confirmed in trash | Up to 7 days; split by Duplicates/Search |

These windows are starting hypotheses, not permanent-abandonment definitions. Exclude no-work runs
from the model-loading funnel and report them as successful shortcuts. Explicitly label zero groups,
zero search results and blocked states; they are not usable-results opportunities. Keeping photos
is a valid review outcome. Do not require full analysis completion before counting useful review.

For launch funnels, the source and requested destination are fixed parameters, not a requirement to
visit the panel before the review tab. Record destination readiness independently of having a signed-in
Photos account: a rendered "Open Google Photos" or account-problem state still proves the UI opened.
Use a local attempt token and acknowledgement to distinguish accepted launches from destinations
that rendered, including an existing review tab brought forward without reloading. Do not send that
token, Chrome tab IDs, URLs or account details to GA. Direct/manual opens count as surface views even
without a matching launch request. A missing acknowledgement means unconfirmed opening, not a known
Chrome failure; late acknowledgements must not produce duplicate success events.

Alongside funnels, show feature adoption, analysis depth (first photo, 25%, 50%, 75%, complete),
review depth (1, 10, 50 decisions), time between stages and returns within 1/7/28 days. Separate user
pause, waiting for Google Photos, rate limiting, gentle-mode waiting and failure. Missing later
events can also mean offline use, withdrawn consent or lost telemetry. Do not infer an `abandoned`
event from closing a panel/tab.

GA4 funnels count users, not each attempt. Events can come from different scans or Google accounts
on one installation; the first qualifying sequence can hide later attempts. Label these as
installation journeys. Exact per-attempt or multi-account reporting is deferred; it needs deliberate
correlation and possibly BigQuery, not an account fingerprint sent as a custom dimension.

## Proposed event contract

Freeze names and definitions after the reporting spike. Ordinary parameters must be fixed enums,
fixed milestone labels or coarse ranges; only protocol identity/session/timestamp fields are exempt.

| Event | Trigger and distinguishing parameters |
|---|---|
| `usage_enabled` | After agreement is saved; `setup_state` = new/existing/unknown from current local setup, not install age. No replay of past activity. |
| `surface_open_requested` | User invokes opening the panel/review tab; fixed `source_surface`, `target_surface` = panel/review. Record intent before the launch outcome, without delaying the launch. |
| `surface_open_result` | Chrome launch APIs complete or reject; `source_surface`, `target_surface`, `result` = accepted/failed, fixed `reason` on failure. Accepted does not mean visible or rendered. |
| `surface_ready` | Destination confirms first usable render while visible; `surface`, `entry_kind` = requested/direct, fixed `connection_state`. Once per local launch attempt, including reused review tabs; independent of account/scan readiness. |
| `surface_view` | Popup/panel/review Scan/Duplicates/Search actually becomes visible; `surface`, fixed `connection_state`. No hidden mounts or rerender counts. |
| `scan_requested` | Start/restart request successfully saved; `entry_surface`, `attempt_kind` = initial/refresh. |
| `scan_started` / `scan_finished` | Engine begins/completes library read; `duration_bucket` on completion. Resume is distinct. |
| `analysis_started` | Engine starts analysis; `work_kind` = new_work/no_work. |
| `model_load_started` / `model_ready` | Actual model load begins/succeeds; `feature` = analysis/search, `duration_bucket` on ready. Cached files still need initialization. |
| `analysis_progress` | New work reaches first photo, 25%, 50%, 75%; fixed `milestone`. Never one event per photo. |
| `analysis_finished` | Completed outcome; `work_kind`, `duration_bucket`, `result` = complete/with_skips/no_work. Completion does not claim every photo succeeded. |
| `duplicates_ready` | Active view builds its queue; `state` = usable/empty/blocked, fixed `blocked_reason`. |
| `review_progress` | Saved actions in this local review visit reach 1/10/50; `milestone`, `decision` = approve/keep/later. |
| `search_submitted` / `search_results` | Accepted search action/latest result; `search_kind` = text/like/examples; result `state` = usable/empty/blocked and `duration_bucket`. No query text or example identifiers. |
| `search_selected` | First nonempty selection for this accepted search. No per-photo events. |
| `trash_confirmation` | Search's existing confirmation opens/is cancelled; `action` = shown/cancelled. No new confirmation added to Duplicates for analytics. |
| `trash_approved` | Approval transaction actually queues photos; `source` = duplicates/search. A sweep recheck that queues nothing is a blocked outcome instead. |
| `trash_result` | Newly committed outcome; `source`, `result` = confirmed/failed/uncertain/blocked/cancelled/restored. Aggregate by decision/outcome, not photo or queue poll. |
| `job_paused` / `job_resumed` | Saved transition; `job_stage`, fixed `reason`, `actor` = user/automatic. Separately label bounded rate-limit/gentle-mode waiting transitions. |
| `feature_blocked` / `feature_failed` | Cannot proceed; fixed `feature`, `stage`, `reason`, optionally a fixed Google operation enum. Never raw errors or stacks. |
| `undo_used` | Undo successfully saved; original decision's `source`. Restoration is a separate outcome. |

Common fields: `schema_version`, `extension_version`, consenting-install random `client_id`, and a
centrally managed `session_id` where appropriate. Include `setup_state` on journey-entry events.
Use shared range helpers, for example duration `<10s`, `10–59s`, `1–4m`, `5–29m`, `30–119m`,
`2–7h`, `8h+`, `unknown`. Do not fabricate engagement time with a constant 1 ms. Measure foreground
active time if the spike proves necessary; background analysis duration is not user engagement.

Review depth means saved interactions in a visit, including later and subsequent undo; it is not
net photos cleared or distinct groups permanently decided. Keep that definition beside the report.

## Consent and privacy

Put the same nonblocking consent question in the toolbar popup as well as the panel and review Scan
tab, plus a setting available even without a connected Google account. This extends the earlier
panel/review-only proposal: consent there alone would miss first launch failures. The popup must
still let people open the panel or review without answering. Persist unknown/yes/no globally.
No analytics ID, event history or request before yes. Remember refusal. Agreement during work
observes future transitions only. After opt-in, observe the popup's current visibility without
backdating its original open or replaying earlier launch attempts. People whose popup never loads,
who decline, or who fail to open a destination before consenting remain unmeasured.

Suggested wording: “Help improve Photo Cleaner? If you agree, send usage events to Google Analytics
about which features you use, how far you get, and whether they work. Never your photos, searches,
albums or Google account. You can turn this off at any time. [What is sent] [Allow] [No thanks]”.

Say optional usage analytics rather than truly anonymous data: a persistent random ID links events,
and network services receive connection information such as IP addresses. Never send photo/group
keys, URLs (review URLs contain account fingerprints), dates taken, album titles, account hashes,
search text, examples, embeddings, GPU names, raw exceptions or diagnostic records.

Switching off stops new sends, clears unsent data and resets identity/session. Erase also resets the
answer. Do not send `data_erased` while erasing data. Serialize consent/erase/sends to reject stale
producers and abort pending requests where possible. Local erase cannot recall already transmitted
GA data; document retention and any remote-erasure process before release.

Leave library-derived sizes/result counts out of the initial payload pending a privacy/Limited Use
review; bucketed data is not automatically nonsensitive. Operational actions and milestones are the
first scope. Confirm Chrome store disclosure categories against the actual payload and applicable
consent requirements. The existing opt-in decision is retained regardless of possible legal exceptions.

## Technical approach

Decided: bundled TypeScript contract → one consent-aware service-worker sender → GA4 Measurement
Protocol directly. No relay or collection server operated by us. The measurement ID and submission
secret are bundled in a production build and therefore extractable; this is an explicitly accepted
report-integrity tradeoff, despite the general GA guidance to keep the secret private. The Chrome
extension tutorial demonstrates direct collection. Neither an obscure event name nor a signature
made with another bundled key proves an event came from a genuine installation.

- Add `shared/usage.ts` for consent/view/range logic and storage beside existing stores. Extend
  `shared/messages.ts` with `app-usage-event`; validate sender provenance and exact payload fields
  at runtime. TypeScript types alone do not enforce what a message contains.
- Add a `usage` store via `create(...)` in `shared/db.ts`, using `openDatabase(factory, onClosed)`.
  Raise DB_VERSION once (currently 8 → 9; recheck when implementing) and preserve all upgrade paths.
  Store consent, identity/session and bounded local milestone receipts, not per-photo analytics.
- Instrument action/session/model boundaries. Views notify a shared visibility helper; business
  decisions, counts and states remain in models. Leave shared Kotlin rules and Photos writes unchanged.
- Instrument the existing panel launch in `ui/hooks.ts` and review launch in `background/main.ts`,
  with destination readiness acknowledgements from panel/review. Preserve the synchronous
  user-gesture path for `chrome.sidePanel.open`: never await consent reads, analytics or network
  calls before opening it. Catch/report launch errors with a fixed category, never the raw message.
- Deduplicate locally across page/worker restarts with operation/milestone keys. Never transmit
  account-based job IDs or decision/group/photo IDs. Use the existing decision relationship locally
  to preserve Duplicates/Search provenance through queue reconciliation and undo.
- The sender validates schema, bounds event frequency and fixes the GA destination locally. These
  protect against our bugs and malformed internal messages; a rogue sender can bypass all of them.
  Do not send IP/user-agent overrides; inspect received metadata during the reporting spike.
- Verify direct GA collection and CORS with a packaged extension. Review any required host permission
  and update-warning implications. Do not assume a successful opaque `no-cors` request proves
  ingestion; validate payloads and inspect the real reports separately.
- Analytics never blocks or throws into scanning, decisions, trash/restore or erase. Use short,
  bounded attempts and no persistent delivery queue initially. No indefinite retry or exact-once
  promise. Local milestone deduplication prevents normal restart inflation; some events will be lost.
- Production credentials come from a git-ignored config supplied by the owner: never commit them,
  while explicitly acknowledging they are public in the shipped bundle. Dev/tests default to no-op
  or a separate test property. Packaging checks the intended environment. Preserve AI model downloads;
  the tripwire should enforce telemetry's sender/destination/schema, not ban every external fetch.

## Suspicious events and report integrity

Use a dedicated property/stream and report only known event names and supported schema versions.
Record extension version and use the existing random client ID. Prefer unique-installation counts
and milestone reach over raw event totals so one noisy client has less influence. An attacker can
still invent many client IDs and copy all those fields; none of them is authentication.

Start with a data-quality report and explicit review thresholds for sudden volume spikes, excessive
events per installation, repeated supposedly once-per-run milestones, unsupported parameter values
and suspiciously regular timing. Investigate questionable sequences against legitimate direct opens,
existing setup, pause/resume, consent mid-operation, offline loss and partial analysis. A missing
predecessor or an unusual fast completion is a signal to inspect, not proof of fraud. Real user growth
can also be an outlier. Retain raw and reviewed views and document any exclusions.

GA4's built-in anomaly detection finds statistical deviations, not forged senders, and needs history
(currently two weeks for hourly detection, 90 days for daily detection). Use manual/explicit threshold
checks from launch. GA4 collection filters are specific mechanisms, not a programmable per-client
fraud detector, and they do not clean historical data. Report/Exploration filters only affect that
analysis. Do not promise to remove arbitrary suspect installations from every GA report.

If actual per-client sequence/rate inspection and reproducible cleaned funnels become necessary,
add a separately agreed BigQuery export/query workflow, with retention/cost/privacy choices. That
would process analytics after collection, not relay events, and cannot authenticate plausible fake
journeys either. It is not required infrastructure for the first release. Avoid new high-cardinality
IDs solely for speculative anti-abuse work; use existing analytics identity in raw exports if enabled.

Keep a response procedure: identify affected versions/time ranges, compare raw versus reviewed
results, and revoke a spammed submission secret if necessary. Revocation also stops legitimate old
versions using that secret; replacement requires an extension update and is extractable again.
Do not rotate every release by default or claim rotation permanently blocks an attacker.

## Work packages, in order

1. **Prove direct reporting.** Create a test GA4 property/web stream and send a small synthetic
   ordered journey directly from an unpacked extension. Verify the packaged build's network path. Validate through
   `/debug/mp/collect`, then separately send collection events with debug mode and verify Realtime,
   DebugView and, after processing, an actual Funnel exploration. Test ordering/session continuity,
   background completion and restart. This gates broader instrumentation because official extension
   and general MP reporting guidance differ; see the findings.
2. **Consent and sender foundation.** Store/model, card/setting, runtime validation, direct sender and dev
   configuration, plus popup/panel/review launch events and destination acknowledgements. Test
   withdrawal/erase races and user-gesture preservation before emitting other product events.
3. **Scan and analysis.** Requested/started/completed milestones, model loading, progress, failures,
   pause/resume/wait categories. Check no-work and resumed runs separately.
4. **Review, Search and outcomes.** Readiness/depth/selection/confirmation, approval provenance and
   transition-based trash/undo events. Check empty/blocked states, partial analysis and close/reopen.
5. **Reports and release.** Register needed low-cardinality custom dimensions before release. Build
   the seven funnels and adoption/depth tables; break down by extension version, surface, setup state
   and failure stage/reason. Choose GA retention and disable advertising features. Record report
   denominators, windows, first collection date and sampling/consent/delivery limitations. Add the
   data-quality report and secret-revocation procedure; test known outlier scenarios with synthetic
   traffic only in the test property, including benign unusual use and plausible undetectable fakes.

The owner supplies access/configuration for GA and publishes store disclosures. Creating
a GA property alone does not instrument the extension. No account or live listing
has been changed during this exploration. Start with package 1, then the consent/sender foundation.

## Verification and release gates

- Test consent defaults/refusal, identity reset, unexpected payload rejection, ranges, error
  isolation, event order, simultaneous surfaces, worker restart, deduplication and erase/withdrawal.
- Extend `extension/test/app/db.test.ts` for the store/upgrades from every earlier version. Cover
  producer wiring in scan/analysis/model/background tests and `sessions.test.ts` when its wiring
  changes. Preserve protection rechecks and tests refusing protected/unknown photos.
- Extend `screens.test.tsx` for the consent card/buttons/toggle and persistence/erase. Hidden tabs,
  rerenders and repeated queue polls must not inflate counts. Use synthetic data and a fake sender.
- Cover popup consent before launch, panel/review launch rejection, accepted-but-no-render,
  account-problem rendering, direct opens, existing-tab reuse, late acknowledgements and popup
  closure during launch. Check the real Chrome user-gesture requirement for opening the side panel.
- Extend manual checks sections 1 (opening), 2 (scan/model), 4 (Duplicates), 5 (Search), 5b (real
  trash), 6 (erase), 7 (interruptions), 8 (Google changes), 9 (privacy), including opt-out network
  silence and real GA reporting. No production events during CI.
- For implementation releases: increment the source manifest patch version before rebuilding;
  run `cd extension && npm run check`, verify the built version matches and report the version.
- Publish the revised privacy policy before analytics goes live. Update `site/privacy.html`, the
  live store listing/disclosures, `docs/chrome-web-store.md`, relevant README/roadmap privacy claims
  and the narrowly scoped privacy allowance in AGENTS.md. Replace the no-analytics promise; the
  no-server-operated-by-us statement can remain accurate with direct collection. Explain that
  optional usage events go directly to Google and the makers can view the resulting analytics.

Implementation: source and tests added, DB upgraded 8 → 9, manifest 0.4.49. Reporting is explicitly
enabled per configured build. No Analytics property, report, remote resource, live policy or live store
listing has been created or changed. The setup checklist is a release gate, not a claim of live success.
