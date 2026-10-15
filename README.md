# Photo Cleaner

Finds duplicates and clutter in very large Google Photos libraries and moves what you approve to the
trash. Favourites, photos in albums and archived photos are protected (each can be turned off), and
photos whose status isn't certain are never offered.

**Current state:** nothing is sent to Google yet. Trashing is simulated in both products.

Agents and contributors: read [`AGENTS.md`](AGENTS.md) first. Where things stand: [`docs/roadmap.md`](docs/roadmap.md).

## Two products, one repository

- **Browser extension** (`extension/`): the product. Everything runs in Chrome. It reads the library through
  your photos.google.com tab, an AI model analyses each photo on your graphics card (WebGPU), and all data
  stays in the browser (IndexedDB). It has a toolbar popup, a panel inside Google Photos, and a review tab
  with Scan, Duplicates and Search.
- **Desktop app** (Kotlin, Compose Desktop): the original prototype, with a Python AI worker (`worker/`) and a
  connector extension (`extension/dist`). It shares its tested rules with the browser extension.

## Layout

| Path | What |
|---|---|
| `extension/src/app/` | The browser extension (see `AGENTS.md` for its parts) |
| `extension/src/page`, `extension/src/content`, … | The desktop app's connector extension |
| `features/shared/protection`, `features/shared/duplicates` | Shared rules (Kotlin Multiplatform, compiled for both): protection, duplicate grouping, review queue |
| `app/`, `core/`, `features/*`, `repositories/*`, `services/*` | The desktop app |
| `worker/` | The desktop app's AI worker (Python) |
| `docs/` | Roadmap, decisions, findings |

## Build and test

```
cd extension
npm ci            # once
npm run check     # everything: Kotlin rules and tests, then the extension's typecheck, tests and build
```

`npm run check` is also what CI runs on every push. One-time setup (JDK 22, Node 24, Python 3.12 and the
worker's small test environment) is described in `AGENTS.md`.

## Run the browser extension

1. `cd extension && npm run kotlin && npm run build`
2. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → `extension\dist-app`.
3. Open photos.google.com, signed in, and start a scan from the panel or the toolbar popup.

Checks that need a real Chrome and account (before a release, or after changing those parts):
[`docs/extension-manual-checks.md`](docs/extension-manual-checks.md).

## Run the desktop app

1. Build the connector: `npm run build` in `extension\` (writes `extension\dist`).
2. Set up the AI worker as described in `worker/README.md`.
3. `.\gradlew.bat :app:launch`. It runs from its own copy of the build (`app/build/staged-runs`), so rebuilding
   while it runs cannot crash it.
4. Load `extension\dist` unpacked in Chrome (extension ID `klibpopmmfopimbjeelnndddjpdgcgjf`), paste the
   pairing token from the app into the extension's popup, and open photos.google.com.

## Security and privacy

- Google session tokens stay inside the photos.google.com page; neither product sees cookies or tokens.
- Only numbers about photos are stored (fingerprints, quality, dates), never images. The browser extension
  keeps them in the browser; "Erase Photo Cleaner's data" removes everything it stored.
- The desktop bridge listens on `127.0.0.1` only, accepts only the pinned extension origin and loopback
  `Host` headers, and requires the pairing token in the first message.
- Logs never contain tokens, photo keys, album titles or URLs.
