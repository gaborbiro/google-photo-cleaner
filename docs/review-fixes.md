# Code review fixes (15 October 2026)

From the whole-codebase review (two axes: Standards, Spec) and a check of ChatGPT's test audit
(`docs/test-audit.md`). Worked through in this order; ticked ([x]) when done and verified with
`npm run check`; [-] dropped or not done on purpose (with the reason); [~] partly done. Items under "Needs a decision" are not started: they change what the product does.

## A. Safety

- [x] **A1 Skipped duplicate groups bypass the "already approved" safeguard.** `ReviewQueues.build`
      returns skipped groups unfiltered: if Search queued the keeper after the group was skipped, the
      group comes back with every other copy pre-selected, and one D trashes them all. Apply the same
      filtering and "already decided" marking as undecided groups; test it.
- [x] **A2 A broken clock can make an old scan look fresh.** `nowMs`/`maxAgeMs` reach Kotlin unchecked
      (NaN becomes 0), and a scan finished "in the future" counts as fresh. Require finite, positive
      values in the exports; treat a scan from the future as out of date.
- [x] **A3 `JsJson` numbers.** `long`/`int` silently cut off fractions and overflow. Require whole numbers
      in range.
- [x] **A4 "Videos are never cleanup candidates" is only enforced by the screens.** The trash queues
      (extension and desktop) and the desktop's sweep approval accept any eligible item. Block videos there.
- [x] **A5 (new, from the test audit) The speed check can fetch every preview in the library.** It now
      reads page after page until 11 previews work; if previews fail everywhere it tries all of them.
      Stop after 25 failures in a row, as the analysis does.
- [x] **A6 Missing trash queue tests:** a photo whose status became unknown is blocked; an unfinished scan
      holds the queue.

## B. Wrong or unclear messages

- [x] **B1 Search says favourites, album and archived photos "never appear"**, which is false once a
      protection is unticked. The text comes from the model and follows the choices.
- [x] **B2 A changed answer to the account check reads as "no Google Photos tab".** The background page
      turns any failed status check into NO_PHOTOS_TAB, so a scan waits for Google Photos to open. Pass on
      the real reason: signed out, or Google changed something (with the shared message and a log line).
- [x] **B3 Preview problems are not logged, and Search hides them.** Log Google-changed preview answers
      (`logGoogleProblem`) in Duplicates and Search; Search tiles and the viewer say why a preview is missing.
- [x] **B4 Raw error texts reach users:** the storage problem banner (`hooks.ts`), the connector popup's
      state names.
- [x] **B5 Erase:** clears the remembered tab in every open page; the warning says photos stay in Google
      Photos' trash for 60 days and that the undo history is erased too.
- [x] **B6 Checklist step 3.3 can't pass** (the queue is sent within 2 s). Rewrite it: sending at once
      is the intended behaviour (D1).

## C. Errors swallowed

- [x] **C1 Undo failures are unhandled** in Duplicates and Search: say so instead.
- [x] **C2 The analysis counts any unexpected error as one failed photo.** Only a preview that can't be
      decoded counts as failed; other errors stop the run with their reason.
- [x] **C3 Bare `catch {}` and unlogged retries:** the background page, the page hooks' load retries,
      the connector's content script, the Scan card's actions (start, pause, resume, full speed,
      protection choices, copy report).
- [x] **C4 A missing album is silently skipped** in the inventory store; it throws elsewhere in the same
      file. Make it consistent.
- [-] **C5 Desktop** (dropped, D6): failures without a key are dropped from the counts (`EmbedPhotosUseCase`); `?: 0`
      hides a broken invariant (`DuplicateGrouper`); a Search preview that fails to decode stays "…"
      forever; RPC-error retries are not logged.

## D. Rule violations

- [x] **D1 Logic in the extension's screens:** account selection and job lookups in `review/main.tsx`, the
      Scan card's action switch, Search's column maths, the popup's choice of message. Move to models.
- [x] **D2 `decisionItems` is a TypeScript copy of a Kotlin rule.** Export the Kotlin one.
- [x] **D3 The database upgrade from version 1 clears data,** against the written rule. It was deliberate
      (version 1 held only pretend scans): say so in AGENTS.md as the one exception.
- [x] **D4 An effect with an expression body** (`hooks.ts`).
- [x] **D5 A fixed 50 ms wait in the page tests**, before a "nothing happened" check. Replace with an
      event that orders it.
- [x] **D6 The account fingerprint's start is logged** (`background/main.ts`). Remove it.
- [x] **D7 The extension asks for the `storage` permission and never uses it.** Remove it.
- [-] **D8 A derived `id` in a domain model** (`AnalysisModels.kt`; desktop only, dropped, D6).

## E. Page script

- [-] **E1 Any script on the Google Photos page can read the page script's answers** (album lists, the
      signed-in email), because they are posted to the whole page. Answer on a channel only Photo Cleaner's
      content script knows. **Not done, on purpose:** anything that can run a script in that page already
      holds the user's Google session and can read the email and every album from Google directly, so a
      private channel would protect nothing, and it would complicate the hand-over between an old and a
      reloaded page script.
- [x] **E2 The relay passes results on without checking their shape.**

## F. Decided features (from D4, D5, D7)

- [x] **F1 The popup says how many groups are ready to review** ("Review 1,731 groups", counted when an
      analysis finishes and after every decision), and the Scan card when the library was last checked
      ("Checked 6 days ago"). The number of new photos since was dropped (D4): the user knows it.
- [x] **F2 Fingerprints stored per account** (D7): a database upgrade moves them to a store keyed by account.
- [x] **F3 The roadmap's M3 wording:** the analysis slows down while the computer is busy, it doesn't pause (D5).

## Decisions (15 October)

- **D1 Approved photos are sent at once** (no holding period); undo is the way back.
- **D2, D6 The desktop app and its connector extension will be deleted:** their findings are dropped
  (C5, the desktop parts of D8, the bridge and connector items).
- **D3 Stored preview addresses and shared-album keys:** more context needed (see the report).
- **D4 Build the decided popup and panel lines:** "Review 1,731 groups", "6 days ago · 312 new photos since".
- **D5 The analysis slows down, it doesn't pause:** correct the roadmap's wording, not the code.
- **D7 Everything is per account:** fingerprints get stored per account, so signing in with another
  Google account just works, even if two accounts ever share a photo key.

## Later (code quality, no behaviour change)

Duplicated code between Duplicates' and Search's models (notices, viewer, previews, focus), the database
opener copied into six stores, the two "fresh classify, then check the scan" re-checks, popup/panel
duplication, the HTTP status mapping written twice, the `(mediaKey, dedupKey)` pair as a type, English
reason texts in the shared rules, connector error classification done three ways, `deletionReasons`
(wording), the token budget 280 set in four places, `ReviewViewModel`'s size, `onnxruntime-web` used
by the build but not listed, the package name.

## The test audit's files

`.audit/` and `audit-vitest-baseline.json` are the audit's scratch files (about 5 MB of logs and
backups): not for git. `docs/test-audit.md`, `docs/test-audit-cases.csv`, `tools/test-audit/` and
`extension/test/app/robustness.test.ts` are its results.
