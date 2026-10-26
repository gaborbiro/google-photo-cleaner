# Extension analytics: findings

Researched 2026-10-26 against primary sources. This is research, not an implementation or a legal
determination. The proposed delivery plan is [usage-events.md](usage-events.md).

User decision after this research: no relay; use direct extension-to-GA collection and accept an
extractable submission secret. The general credential guidance below remains a verified fact,
not an implementation blocker. The plan supersedes the initial relay recommendation.

## Repository facts at exploration time (before implementation)

- `docs/usage-events.md` already contained an unimplemented plan dated 2026-10-24, including opt-in.
- `site/privacy.html` currently promises no analytics, no server, and no information received by the
  makers. Analytics/recipient statements must change before telemetry is released; direct collection
  does not require a server operated by the makers.
- `extension/static-app/manifest.json` is Manifest V3, version 0.4.47, with only Google Photos host
  permission. `extension/package.json` has no analytics dependency.
- `extension/src/app/shared/constants.ts` currently has database version 8. Version 9 remains the next
  version today; recheck at implementation time rather than treating the old plan as authoritative.
- Root `AGENTS.md` was read. Its supplied external include,
  `C:/Work/Tools/.Codex/AGENTS.md`, was unavailable in this checkout.

## Verified platform facts

### GA4 collection and credentials

Chrome's extension guide recommends GA4 **Measurement Protocol** HTTP requests because Manifest V3
forbids remotely hosted executable code. It specifies a **Web data stream**, a measurement ID, and a
random persistent client ID. This supports using a small bundled sender rather than embedding the
normal website analytics script. Its example is a guide, not a reason to copy every storage choice
into this app. [Chrome extension GA4 guide](https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4)

The current GA4 sending guide explicitly says not to expose `api_secret` in client code: possession
allows third parties to pollute the property's reports. This is stronger guidance than the old plan's
accepted public-secret risk. It also documents at most 25 events per request, 25 parameters per event,
40-character event/parameter names, and a request body below 130 kB. Events can be backdated at most
72 hours; older timestamps are clamped under relaxed validation or rejected under strict validation.
[GA4 sending guide](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events)

**Initial recommendation, superseded by user decision:** a minimal HTTPS relay could hold the GA
secret outside the extension. The chosen direct sender instead accepts exposure of the secret.
Keep consent, the closed schema, sender bounds and no-op development configuration. Those client
checks do not constrain a rogue sender that bypasses the extension.

### A reporting limitation to prove before building

The general Measurement Protocol overview says it supplements automatic collection and expects tagging
for most features. Geographic/device enrichment normally joins prior tagged activity. This conflicts
with the practical MP-only extension recipe above. Do not promise normal website acquisition,
engagement, geographic or device reports for an extension-only stream.
[Measurement Protocol overview](https://developers.google.com/analytics/devguides/collection/protocol/ga4)

**Recommendation:** first prove a synthetic extension-only journey with a fresh random client ID in a
test property: event arrival, distinct users, a multi-session funnel and custom dimensions. A successful
HTTP call alone does not prove reporting. Record which reports actually work. Do not inject a website
tag into Google Photos to resolve this documentation gap.

### Sessions, engagement and advertising

The reference defines `session_id` as a positive numeric identifier and `engagement_time_msec` as user
engagement elapsed since the preceding event. Both help accurate Realtime/session reporting. A constant
`1` is not measured engagement, and hours of background GPU work are not user engagement. HTTP `2xx`
only acknowledges receipt; invalid or unprocessed payloads may still receive it. The protocol offers
explicit `ad_user_data: DENIED` and `ad_personalization: DENIED`. An EU collection endpoint exists,
but choosing it alone is not a guarantee of EU-only storage or legal compliance.
[Measurement Protocol reference](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference)

**Recommendation:** distinguish a user session from a scan/analysis operation. Use operation-duration
buckets for long background jobs. Either measure real visible active time across surfaces or leave
engagement KPIs out of the initial promise; settle the actual payload in the reporting spike. Keep
advertising features and Google signals off; no Google account-derived identifiers.

### Validation and delivery

`/debug/mp/collect` validates shape and returns validation messages. Its events do **not** enter
reports, and it does not validate the secret. Use strict development validation, separately from
real property verification. [Validation guide](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events)

For live verification, send to `/mp/collect`, inspect Realtime, and use `debug_mode` plus positive
engagement time for test events in DebugView. The verification guide also expects a previously tagged
client ID, reinforcing the need to test the extension-only case explicitly.
[Implementation verification](https://developers.google.com/analytics/devguides/collection/protocol/ga4/verify-implementation?client_type=gtag)

**Recommendation:** best-effort, no-retry delivery is acceptable for a first release, but event loss
can look like abandonment. Do not describe it as a precise audit trail. Never stall scanning or trashing
on telemetry. Prevent duplicate emission across engine restarts, reopened screens and repeated renders;
record accepted domain transitions rather than only button clicks.

Chrome documents host permissions for privileged cross-origin extension requests; ordinary cross-origin
rules apply without them. Host additions that trigger warnings can disable an installed extension until
accepted. Direct GA collection's CORS/permission arrangement needs an installed-extension update test.
[Network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests),
[permission warning guidelines](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings)

**Recommendation:** replace the old speculative `no-cors` fallback with a verified direct transport
contract. Use ordinary HTTPS/CORS if verified, or a narrowly scoped host permission if required. Do not
guess that permission changes always or never show an update warning.

### Funnels and custom definitions

GA4 Funnel exploration supports up to **10 steps**. Closed funnels require step one; open funnels can
start later. Missing an intermediate step excludes subsequent steps. Only the first sequence per user
in the date range is counted, so this is not an attempt-by-attempt success report. Indirect sequencing
allows intervening events; direct sequencing does not. Each step can have a time limit.
[Funnel exploration](https://support.google.com/analytics/answer/9327974?hl=en-NA)

**Recommendation:** replace the old twelve-event “funnel” with separate activation, duplicates and
search funnels. Optional first-run calibration and erase are not mandatory steps. Start with indirect
ordering and a documented multi-day completion window because analysis can run for hours and users
return later. Treat no-results, cancellation, technical failures and no subsequent observed action as
different outcomes. A funnel shows where observed progression stops, not why a user left.

Custom parameter reporting requires appropriate custom definitions. GA4 Standard permits 50
event-scoped custom dimensions; setup/reporting can take 24–48 hours. Google discourages unique user,
session and timestamp custom dimensions because high cardinality degrades reports.
[Custom dimensions and metrics](https://support.google.com/analytics/answer/14240153?hl=en)

**Recommendation:** register bounded words/buckets such as feature, surface, outcome, error category
and extension version before launch. Keep unique operation IDs local for deduplication; do not register
installation/run IDs as custom dimensions.

Retention controls affect explorations/funnel reports, unlike standard aggregate reports. GA4 Standard
offers 2 or 14 months for user/event retention. Reset-on-new-activity extends identifier retention.
[Retention](https://support.google.com/analytics/answer/7667196?hl=en)

**Recommendation:** choose retention explicitly, initially 2 months with reset disabled if sufficient
for weekly funnel reviews. Longer historical analysis is a product/privacy decision.

## Privacy and release conditions

Chrome requires transparent disclosure and informed consent, and prominent disclosure of changed data
practices after installation. The policy change belongs in the actual UI as well as the policy page.
[Disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)

Chrome's FAQ includes persistent identifiers and server/HTTP logs in what a privacy policy should
explain. Dashboard disclosures, policy and actual behavior must match. Necessary operational analytics
may measure disclosed features, but this is not permission to send arbitrary data.
[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

Limited Use also covers scraped content and data derived, anonymized or aggregated from it. Third-party
transfer must fit the disclosed single purpose; anonymization does not remove the restriction.
[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

**Recommendation:** preserve prior opt-in decision; no event, identifier or retrospective backlog before
yes. Avoid “anonymous” for a persistent per-install event history: say optional usage statistics and
explain the random browser identifier. Never transmit photo IDs/URLs, Google account hashes, queries,
album names, photo dates, image-derived embeddings, raw errors or diagnostic logs. Review even coarse
library/result buckets as derived library data; omit them unless needed and disclosed. Revocation must
stop new sends and discard pending data. Erasing local storage does not erase data already held by GA.

GA4 has an authenticated Admin API for deletion by `clientId`; an erasure feature would require a
separate server-side implementation and credentials, not the MP secret.
[GA4 user deletion](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties/submitUserDeletion)

Current UK ICO guidance includes a statistical exception with conditions, not a blanket analytics
exemption: only service improvement, restricted third-party use, clear information and an easy free
objection; ongoing individual tracking can fall outside it. Therefore do not assert all analytics always
requires consent, or that GA automatically qualifies for an exception. The existing affirmative opt-in
design is the prudent product default; deployment jurisdictions still need assessment.
[ICO exceptions guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)

## Outlier detection with direct collection

GA4 anomaly detection flags metric/segment deviations, not malicious provenance. It uses historical
training periods: two weeks for hourly anomalies, 90 days for daily, 32 weeks for weekly. New properties
therefore need simple explicit thresholds and manual inspection first.
[Anomaly detection](https://support.google.com/analytics/answer/9517187?hl=en-40)

GA4 collection filters currently cover developer, internal and web-hostname traffic. They apply
forward only; excluded data is permanently unprocessed. Report filters instead hide data for a
particular report. Neither promises arbitrary historical fraud cleanup or authenticates MP clients.
[Data filters](https://support.google.com/analytics/answer/13296761?hl=en)

BigQuery export provides raw events for custom analysis, including sequence/rate checks and reviewed
datasets. It introduces export/storage/query administration, potential costs and retention decisions;
it is not needed to send directly and is not added to the first release by this investigation.
[BigQuery export](https://support.google.com/analytics/answer/9358801?hl=en)

Google documents revoking MP API secrets to combat spam. This also prevents genuine clients using
that secret from sending; replacing a bundled secret needs a new build and does not keep it secret.
[MP troubleshooting](https://developers.google.com/analytics/devguides/collection/protocol/ga4/troubleshooting?client_type=gtag)

**Inference and proposed checks:** extreme volumes per client, repetitive milestones, unsupported
schema values and implausible timing can identify suspicious traffic. Unique-client milestone counts
reduce one client's influence compared with raw event totals, but invented client IDs bypass that.
Do not automatically exclude missing predecessors: consent mid-operation, existing setup, direct
opens, background jobs and lost events legitimately produce partial journeys. Plausible fabricated
journeys can be indistinguishable from real ones; no copyable client field or bundled signing key
proves authenticity. Reporting checks mitigate obvious pollution, not determined forgery.

## Open decisions

1. Which initial outlier thresholds and review procedure are useful without discarding real growth?
2. Does the extension-only test property produce usable funnels and distinct user counts without tagging?
3. Is cross-session installation identity needed, or would session-only identity answer enough questions?
4. What retention and historical deletion process will be promised?
5. Which coarse library-derived metrics are necessary for the first questions, rather than merely useful?
6. What observation window separates waiting/resuming from actionable drop-off for large libraries?

No property was created, no private analytics account was inspected and no product code was changed.
