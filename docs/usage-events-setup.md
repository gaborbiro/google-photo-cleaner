# Set up and verify optional usage reporting

Implemented in extension 0.4.49. Direct collection only: no relay. All developer/CI builds are
silent unless explicitly built with `--usage`. Consent is still required in a configured build.
No GA property or secret has been created by this change; live reporting remains to be verified.

## Configure a test property first

1. Create a separate GA4 property for the extension and a Web data stream. Keep development/test
   traffic separate from production and from the Chrome Web Store listing's analytics.
2. Create its Measurement Protocol API secret. Locally create `extension/usage.config.json` with
   `measurementId` (the `G-…` value), `apiSecret`, and optional `debug: true` for the test property.
   Do not paste the secret into chat or commit the file. It is git-ignored, but is extractable from
   any configured extension bundle. This is the agreed direct-collection tradeoff.
3. Set event/user retention to two months, disable reset on new activity, Google signals and
   advertising integrations. Verify these settings before publishing the updated privacy policy.
4. Run `npm run build -- --usage` from `extension` after incrementing the manifest patch version
   for that rebuild. Reload the extension and your Photos tab. Ordinary `npm run build` or
   `npm run check` produces a silent build even when a config file is present.
5. Release ZIPs are built on GitHub after master pushes; see [automatic releases](github-releases.md).
   `npm run package` uses production environment settings only: `PHOTO_CLEANER_GA4_MEASUREMENT_ID`
   and `PHOTO_CLEANER_GA4_API_SECRET`, supplied from the repository variable/secret. Debug is forced
   off; the local test file is never a release fallback. Packaging itself does not publish anything.

## Verify real collection before release

The sender posts only to `https://www.google-analytics.com/mp/collect`, with omitted credentials and
referrer, a plain-text JSON body and `no-cors`. This avoids asking for another host permission. Its
response is opaque and says nothing about event acceptance. The chosen transport must be checked
in a real packaged extension; no live GA configuration was available during automated tests.

- Before answering the question, inspect the popup, panel/review and worker Network tools: no GA
  requests. Choose No thanks, reopen, and verify that remains true. The setting must work without
  a signed-in Google account or a finished scan.
- Allow reporting. The popup offers the choice before launching another surface. Check
  `usage_enabled`, `surface_view`, panel/review launch requested/accepted/failed, and `surface_ready`
  only once the destination actually renders visibly. Check opening an already-open review tab.
- Keep a page focused for 15 seconds: `surface_engagement` carries measured focused-visible time.
  Engine/GPU time never masquerades as engagement. Use debug mode only in the test property.
- Validate captured **synthetic** payloads with `/debug/mp/collect`, separately from collection.
  The validation endpoint does not populate reports. Confirm actual collection in Realtime,
  DebugView and, after processing, a real Funnel exploration with a fresh test client ID. This is
  necessary because general MP guidance assumes tagging while Chrome documents extension-only MP.
- Run the manual scan, model download, progress, pause/resume, duplicates, Search, approval,
  confirmed trash and undo checks. Distinguish no new work, empty results, blocked protection and
  unknown trash outcomes. Use a small, deliberate selection for real Google Photos changes.
- Turn reporting off while requests/work are pending; verify no new requests. Re-enable and verify
  a new random client ID. Erase stops pending requests and forgets consent/identity; the question
  returns. Local erase cannot erase usage history already sent to Google.
- Verify actual GA reports, not just HTTP calls. Do not publish if the transport or funnel reporting
  fails. No new host permission has been added; investigate the real network response before
  changing permissions or promising this arrangement works everywhere.

## Reports and data quality

Create event-scoped custom dimensions for the fields needed in reports: `schema_version`,
`extension_version`, `setup_state`, `surface`, `source_surface`, `target_surface`, `result`, `feature`,
`reason`, `actor`, `duration_bucket`, `attempt_kind`, `work_kind`, `state`, `milestone`, `decision`,
`search_kind`, `action`, `source`. Register before collecting production data. Do not register
client/session IDs or local receipt keys as custom dimensions.

Use the seven funnels in [usage-events.md](usage-events.md). Filter each step by its event and fixed
parameters (for example `surface_ready` with `surface=panel`, or `review_progress` with
`milestone=10`). Use indirectly followed steps, label the time limits, and distinguish setup_state
new/existing/unknown. The current launch events show observed visibility and API outcomes, rather
than authenticated or exact per-attempt conversion. Visibility can precede an API reply; inspect
those cases during the reporting check rather than silently counting them as launch failures.

Start with event counts, users reaching milestones, events per user, unsupported event/schema values
and sudden changes in traffic. The sender locally caps 120 events per minute, at most eight in-flight
requests and five seconds per request, with no retry queue. It stores the latest 1,024 local milestone
receipts to suppress normal restarts/polls. These protect against bugs, not rogue external clients.
Do not automatically discard fast/partial journeys: existing setup, consent timing, offline loss,
small libraries and real user growth can all explain them.

GA's anomaly detection needs history and does not authenticate senders. Review suspicious traffic
before report exclusions; exclusions in one report do not clean every GA report. A later BigQuery
workflow can inspect raw events if needed, with separate cost/retention decisions. No such workflow
or automation has been provisioned here. If spam requires revoking the submission secret, old
legitimate extension versions using it also stop sending; replacement needs a new build.

## Publish as one coordinated release

Publish `site/privacy.html` before releasing a configured extension. Update the live store listing
and data-use disclosures using `docs/chrome-web-store.md`, including optional usage activity and
the random installation identifier. Core scans and photo data remain on-device. Nothing is sent
before opt-in, and no photo/account/search contents are included. Keep the no-server-operated-by-us
promise and replace the old no-analytics promise. Remote aggregate reports can outlive the two-month
event/user retention window; the policy explains the difference.
