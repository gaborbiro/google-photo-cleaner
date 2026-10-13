# Milestone 1: read-only access and protection proof

Date: 2026-10-12. Scope as in `claude-code-photo-cleaner-brief.md`: no mutations, no inference, no review UI.

## What works

- **Connector:** Chrome MV3 extension (v0.2.0) running GPTK's vendored parser (pinned `6db9ab35`, MIT) in the photos.google.com page. Seven read-only operations; no mutating RPC exists in source, vendored code or bundle (tested). Survives extension reloads without a tab reload.
- **Bridge:** Ktor on `127.0.0.1:47613`; pinned extension origin, loopback `Host` check, pairing token. Session cookies and tokens never leave the browser; tokens are never logged.
- **Inventory:** resumable scan of library (incl. archive), favourites listing, archive listing, album list (own and joined) and every album's entries, persisted per page in SQLite with resume cursors. Bounded retries with backoff; rate limits, lost sessions and disconnects pause the run; unreadable responses fail it.
- **Rules:** protected = favourite (flag or listing) ∪ in any real album (matched by `dedupKey`) ∪ archived (flag or listing). Eligible only with a complete, < 24 h old inventory, every album read and matching Google's count, and the photo explicitly not favourite, not archived, uploaded by the user. Everything else is unknown and excluded, with reasons.
- **Report and sample:** coverage evidence, per-type counts (each protected item counted once), source-agreement checks, and a 48-photo evenly spread preview sample with links to Google Photos.

## Results on the live account (run 2, 146 s)

| | Photos | Videos |
|---|---|---|
| Enumerated | 17,170 | 1,819 |
| Protected (union) | 2,088 | 69 |
| · favourite | 15 | 0 |
| · in an album | 2,074 | 69 |
| · archived | 0 | 0 |
| · favourite and album | 1 | 0 |
| Eligible | **14,996** | 1,744 (out of scope) |
| Unknown | 86 | 6 |

Coverage evidence: library 42 pages / 18,989 entries / 0 duplicates; favourites 15 listed = 15 flagged; archive 0 listed = 0 flagged; 81 albums (70 own, 11 joined), all read, all counts matching. Unknowns are all "not uploaded by you, no album match". 1,432 photos in the library were uploaded by others; 1,346 of those are protected by album membership.

Request behaviour: ~0.8 s median RPC latency, no rate limiting seen over ~50 sequential requests per scan. Preview throughput in the probe: 2.2 previews/s sequentially with 250 ms pacing, ~13 KB per 256 px JPEG.

## What was tested

Automated (synthetic fixtures, no account): 54 Kotlin + 33 TypeScript tests.
- Multi-page inventories; overlapping favourite/album membership counted once; album-scoped keys joined by `dedupKey`.
- Missing favourite/archive/owner/type fields → unknown; archive listing protecting items whose flag is false.
- Inaccessible shared album (error, or permission-denied with a valid session) and count mismatches → zero eligible.
- Transient failures retried; persistent rate limiting pauses; lost session pauses and a fresh instance resumes from the saved page without duplicates; user pause/resume; expired saved page token restarts the phase; account switch mid-scan refused; unreadable response fails the run; stale inventory → zero eligible.
- Randomised invariant (300 scenarios against ground truth): incomplete protection data never yields eligibility; complete coverage yields exactly the truly loose photos; protected items are never eligible.
- Bridge auth (origin, host, token, regeneration), token never logged, report contains no keys/titles/URLs, read-only guarantee of the extension.

Live (user's account): probe (9/9 checks passed), two full scans with identical results, sample spot-check by the user (all sampled photos were genuine candidates).

## Upstream and access limitations

- The access layer is an undocumented Google RPC interface (`batchexecute`). It can change without notice; the strict parser turns any shape change into a failed scan rather than wrong data.
- No per-item size data in the library listing; storage per photo needs the batch info RPC (`EWgK9e`, ≤ 5,000 keys per request), not yet probed.
- GPTK's own error handling returns partial results after failures; it is deliberately not used.
- Album entries never share the library `mediaKey`; protection depends on `dedupKey` matching, verified live for own uploads and through the identical counts of two scans, not for every saved-from-share case (those are the 86 unknowns).
- Locked Folder items are not listed and therefore never candidates. Partner-shared photos without album membership fall into unknown.

## Is protection coverage sufficient to proceed?

**Yes, for photos uploaded by the user.** Every protection source was read to completion in bulk, the two independent favourite sources and the two archive sources agree, all 81 albums (including joined ones) were read with matching counts, and the user's spot-check of eligible photos found no protected photo. Eligibility is withheld automatically whenever any of this stops being true.

## Not verified yet

- Live pause/resume across an app restart (covered by fixture tests; the one live interruption was discarded rather than resumed).
- Behaviour with several Google accounts signed in to Chrome; sample links open the default account.
- Restoration semantics of trashed items (no mutations exist yet).

## Proposed next milestone (from the brief)

Local inference evaluation (Python worker, EmbeddingGemma 2 image/text embeddings on the RTX 5060; Python must first be put on PATH) and the keyboard review interface (D approve, K keep, S defer, U undo; snapshot approvals; background queue) with **simulated** trash operations only.
