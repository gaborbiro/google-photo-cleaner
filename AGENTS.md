# Photo Cleaner: notes for coding agents

Read this before changing anything. It applies to every agent (Codex, Claude Code, …).

## What this is

Photo Cleaner finds duplicates and clutter in very large Google Photos libraries and moves what the user
approves to the trash. It is a Chrome extension (`extension/`) that runs everything in the browser: it
reads the library through the user's photos.google.com tab, analyses photos with an AI model on the
graphics card (WebGPU), and stores everything in IndexedDB. The rules that decide what is protected and
what counts as a duplicate are Kotlin Multiplatform, compiled to JavaScript for the extension. (A Kotlin
desktop app, the original prototype, was removed on 2026-10-18; it is in the git history.)

`docs/roadmap.md` (on the main branch) says where the project stands and what comes next.

## Verify every change

Run this before you call a change done. It must pass, and it is what CI runs (`.github/workflows/build-and-release.yml`):

```
cd extension
npm run check
```

It runs, in order, stopping at the first failure:
1. Gradle: builds the shared Kotlin rules for the extension (`extension/generated/kotlin`), then runs
   their tests.
2. The extension's typecheck, tests (vitest) and build.

One-time setup on a new machine (needs network):
- JDK 22 and Node 24 on the PATH.
- `cd extension && npm ci`

The extension's tests and build refuse to run against an old copy of the shared Kotlin rules. If they
say so, run `npm run kotlin` (or `npm run check`, which does it).

**Extension versions.** Whenever you change and rebuild the extension, increment the patch (third)
component of its version before rebuilding, including `npm run check`, in its source manifest
(`extension/static-app/manifest.json`). Verify that the built manifest has the same new version and
report that version to the user, so they can click Reload in Chrome's extensions
page and confirm the new fixes or improvements are loaded.

## Layout

| Path | What |
|---|---|
| `extension/src/app/` | The extension. `background/` service worker, `engine/` hidden background page (scans and AI), `content/` + `page/` scripts in photos.google.com, `popup/`, `panel/` (Chrome's side panel beside Google Photos), `review/` (the review tab: Scan, Duplicates, Search) |
| `extension/src/app/{scan,ai,duplicates,search,shared}` | The logic: models and stores. Screens only draw what these work out |
| `extension/test/` | The extension's tests (vitest, fake-indexeddb, fakes in `test/app/fakes.ts`) |
| `extension/generated/` | Built from Kotlin by `npm run kotlin`. Git-ignored. Never edit |
| `extension/vendor/gptk/` | Copied verbatim from an MIT project. Never edit (see `UPSTREAM.md`) |
| `extension/src/page/`, `extension/src/content/relay.ts`, `extension/src/shared/` | The page script's operations on Google Photos (`trashOps.ts` holds the only writes), its relay, and their messages |
| `features/shared/protection`, `features/shared/duplicates` | **Shared rules** (Kotlin Multiplatform, JVM and JS): what is protected, duplicate grouping, keeper choice, the review queue, calibration maths. Tests in `features/shared/duplicates/src/commonTest` |
| `repositories/*/domain` | The models the shared rules read (multiplatform) |
| `site/` | The privacy policy page, published by `.github/workflows/pages.yml` |
| `spikes/` | Experiments from phase 1; not part of the product |
| `tools/test-audit/` | Replays recorded faults to check the tests catch them (`docs/test-audit.md`) |

## Rules

**Safety comes first.** The app moves photos to the trash. Nothing may ever be offered for the trash
unless the shared rules call it ELIGIBLE with the user's protection choices. Photos of unknown status
are never trashable. Approved photos go to Google Photos' trash (`duplicates/googleTrash.ts`); there
is no simulated mode. What counts is where each photo is afterwards, read back from the trash. The
only requests that change the user's Google Photos are trash and restore, in
`extension/src/page/trashOps.ts`, which only Photo Cleaner's own page script includes (the tripwire
tests in `extension/test/ops.test.ts` enforce this). Do not add any other (album edits, favourites…)
unless the user explicitly asked for that change. Every write goes through the trash queue; every new
write path needs tests for refusing protected photos.
- Search's sweep and the trash queue check every photo again against a fresh scan and the current
  protection choices just before acting. `extension/test/app/sessions.test.ts` tests this through the
  real wiring (`duplicates/session.ts`, `search/session.ts`); a change to that wiring needs tests there.

**Google's undocumented requests.** Photo Cleaner talks to Google Photos the way Google's own page
does, and Google can change that any day. When an answer doesn't fit (`PROTOCOL`, `BAD_REQUEST`),
stop and show the shared message in `extension/src/app/shared/googleProblems.ts`, saying nothing in
the library was changed; log the details with `logGoogleProblem`. Never count such an answer as one
failed photo, never retry it as if the connection dropped, and never carry on guessing.
- `logGoogleProblem` also keeps the problem in the problem log (`shared/problemLog.ts`, shown by
  Copy diagnostics), with what the page script saw: the request, where the parser gave up
  (`within(...)` paths in `page/normalize.ts`) and the answer's structure (`page/skeleton.ts`),
  never its values. A new reading step in `normalize.ts` should say where it reads (`within`).

**Shared rules live in Kotlin.** Grouping, protection and the review queue are in `features/shared/*`,
tested in `commonTest`, and compiled for the extension. Don't reimplement them in TypeScript.
- If you add a Kotlin module that is compiled to JavaScript, `kotlin-js-store/package-lock.json`
  changes: run `./gradlew kotlinUpgradePackageLock` and commit the lock.
- The extension's trash queue and search ranking are TypeScript for now (see the roadmap).

**The extension's database** (`extension/src/app/shared/db.ts`, version in `shared/constants.ts`):
- Add stores in `upgrade()` only through `create(...)`, which only adds and is safe to run again.
  Never drop or clear users' data in an upgrade. (The two exceptions: the upgrade from version 1
  clears the `jobs` store, which then held only M1's pretend scans; version 7 removes the
  `simulatedTrash` store, which held only pretend trashing, from before there were users.) Data may
  move to a new store when its key must change: copy every record and remove the old store in the same
  upgrade, which is one transaction (see `moveFingerprints` in `db.ts`), and mark the old store
  `movedTo` in the test.
- Raise `DB_VERSION` once per change set, with a comment saying what it adds. In
  `extension/test/app/db.test.ts`, add the new stores to `STORES_BY_VERSION` and the outgoing version
  to the versions upgraded from, so an update from every earlier version stays tested.
- Every store opens the database with `openDatabase(factory, onClosed)`, so it reconnects after an
  upgrade or after the data was erased.

**No logic in screens.** React components only draw. Texts, counts and states come from the models
(`shared/jobView.ts`, `duplicates/reviewModel.ts`, `search/searchModel.ts`), which are tested.

**React effects must not return anything but a cleanup function.** Write `useEffect(() => { … })` with
a block body. For example, newer Chrome returns a Promise from `window.scrollTo`, and an effect that
returned it blanked the whole page.

**Wording.** Photos are "trashed", never "deleted". The app's own data is "erased" ("Erase Photo
Cleaner's data"). Plain words for users, no jargon.

**Privacy.** Only numbers about photos are stored (fingerprints, quality, dates), never images. Never
log photo keys, URLs, album titles, tokens or account details. Never commit secrets.

**Tests.**
- Never delete, skip or weaken a test to make it pass.
- When one fails, find out what it protects first, then fix the code, or the test only if the
  intended behaviour changed (and say so).
- Tests must not depend on the time zone or locale: build dates with `new Date(y, m, d, h)` (local
  time), not `Date.UTC`. The tests run in California time (`vitest.config.mjs`), so a mix-up of UTC
  and local time fails on every machine.
- `extension/test/app/screens.test.tsx` opens each page (popup, panel, review tab and its tabs) in a pretend
  browser with a made-up library, clicks and presses keys as a user would, and fails on any logged
  error. When you add a page, a tab, a button or a key, add it there.
- Some things can only be checked in Chrome by hand: loading the AI model, the real erase, resuming
  after Google Photos reopens, the spinning tab icon, the keyboard feel. Say so when a change touches
  them, naming the parts of `docs/extension-manual-checks.md` to go through.

**Git.**
- Stage only your own changes. Write a fresh commit message for each commit.
- Don't push or open pull requests unless asked.

## Running the extension

1. `cd extension && npm run kotlin && npm run build`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist-app`
   ("Photo Cleaner").
3. Open photos.google.com, signed in.
4. After changes, press ↻ on the extension, then reload the Google Photos tab.

## Agent skills

### Issue tracker

GitHub Issues in gaborbiro/google-photo-cleaner, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
