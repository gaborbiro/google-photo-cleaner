# Photo Cleaner: notes for coding agents

Read this before changing anything. It applies to every agent (Codex, Claude Code, …).

## What this is

Photo Cleaner finds duplicates and clutter in very large Google Photos libraries and moves what the user
approves to the trash. There are two products in this repository:

- **The browser extension** (`extension/`, the product): a Chrome extension that runs everything in the
  browser. It reads the library through the user's photos.google.com tab, analyses photos with an AI model
  on the graphics card (WebGPU), and stores everything in IndexedDB.
- **The desktop app** (Kotlin, Compose Desktop): the original prototype. It is still used, and it shares
  its tested rules with the extension.

`docs/roadmap.md` (on the main branch) says where the project stands and what comes next.

## Verify every change

Run this before you call a change done. It must pass, and it is what CI runs (`.github/workflows/test.yml`):

```
cd extension
npm run check
```

It runs, in order, stopping at the first failure:
1. Gradle: builds the shared Kotlin rules for the extension (`extension/generated/kotlin`), then runs
   every Kotlin test (desktop and shared).
2. The extension's typecheck, tests (vitest) and build.

One-time setup on a new machine (needs network):
- JDK 22, Node 24, Python 3.12 on the PATH.
- `cd extension && npm ci`
- The Python worker's test environment. The Kotlin tests start the worker with its fake model, which
  only needs a few small libraries:
  ```
  cd worker
  python -m venv .venv
  .venv/Scripts/python -m pip install numpy pillow opencv-python-headless pytest   # Windows
  .venv/bin/python -m pip install numpy pillow opencv-python-headless pytest       # Linux, macOS
  ```
  Worker tests: `.venv/Scripts/python -m pytest -q` from `worker/`.

The extension's tests and build refuse to run against an old copy of the shared Kotlin rules. If they
say so, run `npm run kotlin` (or `npm run check`, which does it).

## Layout

| Path | What |
|---|---|
| `extension/src/app/` | The extension. `background/` service worker, `engine/` hidden background page (scans and AI), `content/` + `page/` scripts in photos.google.com, `popup/`, `panel/` (inside Google Photos), `review/` (the review tab: Scan, Duplicates, Search) |
| `extension/src/app/{scan,ai,duplicates,search,shared}` | The logic: models and stores. Screens only draw what these work out |
| `extension/test/` | The extension's tests (vitest, fake-indexeddb, fakes in `test/app/fakes.ts`) |
| `extension/generated/` | Built from Kotlin by `npm run kotlin`. Git-ignored. Never edit |
| `extension/vendor/gptk/` | Copied verbatim from an MIT project. Never edit (see `UPSTREAM.md`) |
| `features/shared/protection`, `features/shared/duplicates` | **Shared rules** (Kotlin Multiplatform, JVM and JS): what is protected, duplicate grouping, keeper choice, the review queue, calibration maths |
| `repositories/*/domain` | Models and interfaces only (multiplatform where the shared rules need them) |
| `app/`, `core/`, `features/*`, `repositories/*`, `services/*` | The desktop app |
| `worker/` | The desktop app's Python AI worker |
| `spikes/` | Experiments from phase 1; not part of the products |

## Rules

**Safety comes first.** The app moves photos to the trash. Nothing may ever be offered for the trash
unless the shared rules call it ELIGIBLE with the user's protection choices. Photos of unknown status
are never trashable. Trashing is still **simulated** (`SimulatedTrash`). Do not add any request that
changes the user's Google Photos (trash, album edits, favourites…) unless the user explicitly asked for
that change. Every new write path needs tests for refusing protected photos.
- Search's sweep and the trash queue check every photo again against a fresh scan and the current
  protection choices just before acting. `extension/test/app/sessions.test.ts` tests this through the
  real wiring (`duplicates/session.ts`, `search/session.ts`); a change to that wiring needs tests there.

**Google's undocumented requests.** Photo Cleaner talks to Google Photos the way Google's own page
does, and Google can change that any day. When an answer doesn't fit (`PROTOCOL`, `BAD_REQUEST`),
stop and show the shared message in `extension/src/app/shared/googleProblems.ts`, saying nothing in
the library was changed; log the details with `logGoogleProblem`. Never count such an answer as one
failed photo, never retry it as if the connection dropped, and never carry on guessing.

**Shared rules live in Kotlin.** Grouping, protection and the review queue are in `features/shared/*`,
tested in `commonTest`, and compiled for the extension. Don't reimplement them in TypeScript.
- If you add a Kotlin module that is compiled to JavaScript, `kotlin-js-store/package-lock.json`
  changes: run `./gradlew kotlinUpgradePackageLock` and commit the lock.
- The extension's trash queue and search ranking are TypeScript for now (see the roadmap).

**The extension's database** (`extension/src/app/shared/db.ts`, version in `shared/constants.ts`):
- Add stores in `upgrade()` only through `create(...)`, which only adds and is safe to run again.
  Never drop or clear users' data in an upgrade.
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
   ("Photo Cleaner (preview)").
3. Open photos.google.com, signed in.
4. After changes, press ↻ on the extension, then reload the Google Photos tab.
