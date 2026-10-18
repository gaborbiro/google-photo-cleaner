# Photo Cleaner

Finds duplicates and clutter in very large Google Photos libraries and moves what you approve to the
trash. Favourites, photos in albums and archived photos are protected (each can be turned off), and
photos whose status isn't certain are never offered.

Approved photos go to Google Photos' trash, where they stay for 60 days, and undo restores them.

Agents and contributors: read [`AGENTS.md`](AGENTS.md) first. Where things stand: [`docs/roadmap.md`](docs/roadmap.md).

## What it is

A Chrome extension (`extension/`). Everything runs in the browser. It reads the library through your
photos.google.com tab, an AI model analyses each photo on your graphics card (WebGPU), and all data stays
in the browser (IndexedDB). It has a toolbar popup, a panel inside Google Photos, and a review tab with
Scan, Duplicates and Search. The rules that decide what is protected and what counts as a duplicate are
written in Kotlin, tested there, and compiled to JavaScript for the extension.

## Layout

| Path | What |
|---|---|
| `extension/src/app/` | The browser extension (see `AGENTS.md` for its parts) |
| `extension/src/page`, `extension/src/content/relay.ts`, `extension/src/shared` | The page script that talks to Google Photos, and its relay |
| `features/shared/protection`, `features/shared/duplicates`, `repositories/*/domain` | The rules (Kotlin Multiplatform, compiled to JavaScript): protection, duplicate grouping, review queue |
| `site/` | The privacy policy page (GitHub Pages) |
| `docs/` | Roadmap, decisions, findings |

## Build and test

```
cd extension
npm ci            # once
npm run check     # everything: Kotlin rules and tests, then the extension's typecheck, tests and build
```

`npm run check` is also what CI runs on every push. One-time setup (JDK 22 and Node 24) is described in
`AGENTS.md`.

## Run the browser extension

1. `cd extension && npm run kotlin && npm run build`
2. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → `extension\dist-app`.
3. Open photos.google.com, signed in, and start a scan from the panel or the toolbar popup.

Checks that need a real Chrome and account (before a release, or after changing those parts):
[`docs/extension-manual-checks.md`](docs/extension-manual-checks.md).

## Security and privacy

- Google session tokens stay inside the photos.google.com page; the extension never sees cookies or tokens.
- Only numbers about photos are stored (fingerprints, quality, dates), never images, and only in the
  browser; "Erase Photo Cleaner's data" removes everything it stored.
- Logs never contain tokens, photo keys, album titles or URLs.
