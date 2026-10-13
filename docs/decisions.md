# Decisions

## Toolchain (checked 2026-10-12)

| Component | Version | Why |
|---|---|---|
| JDK | Corretto 22.0.2 (`JAVA_HOME`) | Already installed; Compose Desktop packaging (jpackage) needs 17+ |
| Gradle wrapper | 9.6.0 | Same as DailyMacros, already cached |
| Kotlin | 2.4.21 | Latest stable; same as DailyMacros |
| Compose Multiplatform | 1.12.1 | Latest stable (1.13 is alpha) |
| Compose Material3 | 1.9.0 | Version CMP 1.12.1 maps to; declared directly because the `compose.*` accessors are deprecated |
| JetBrains lifecycle-viewmodel-compose | 2.11.0 | ViewModel on desktop |
| kotlinx-coroutines | 1.11.0 | Latest stable |
| kotlinx-serialization | 1.11.0 | Latest stable (1.12 is RC) |
| SQLDelight | 2.4.1 | Latest stable |
| Ktor | 3.6.0 | Latest stable; server bound to loopback only |
| Logback | 1.6.5 | Logging backend |
| Node / npm | 24.18 / 11.16 | Extension build only |
| TypeScript | 7.0.2 | Extension typecheck |
| esbuild | 0.28.2 | Extension bundling |
| Vitest | 5.0.4 | Extension tests |
| Chrome | 155 | MV3 extension target (minimum 116 for `world: MAIN` and WebSocket-kept service workers) |
| GPTK | `6db9ab35` (v3.3.0) | Vendored parser + types only; see `extension/vendor/gptk/UPSTREAM.md` |

Python is not on PATH (only the Windows Store stubs). Not needed until the inference milestone.

## Scope

- Local folder, no version control for now.
- Read-only milestone: no photo mutations are reachable from the app or the extension.
- No per-item metadata requests. Protection data (favourites, album membership) must come from bulk listings; if that turns out to be impossible, the affected items are reported as `UNKNOWN`, never `ELIGIBLE`.
- Automatic collections (people, places, things) do not protect a photo. Real albums (own and shared) and favourites do.
- Archived photos are protected (user decision, 2026-10-12): archiving counts as a deliberate keep.
- Library photos not owned by the user (saved from shared albums or partner sharing) are `UNKNOWN` unless their album membership is proven (user decision, 2026-10-12). Saved shared-album photos are in an album by definition; partner-shared saves do not use the user's storage, so excluding them costs nothing.
- Videos are classified and reported separately but are never cleanup candidates in this milestone.

## Live probe findings (2026-10-12)

All checks passed on the user's account (26 requests, no failures or rate limiting):
- Every library item carries the favourite flag; the favourites listing (16 items, one page) agrees with it, and returns library media keys.
- The album list returns own (70) and joined (11) albums, codes 1 and 4 only (no automatic collections); every album reports an item count, matching its contents.
- Album entries never share the library `mediaKey` (0/6) but always share `dedupKey` (6/6), so membership joins on `dedupKey`.
- Library pages are variable-size (493, 225); pagination ends only when no token is returned.
- Previews: ~13 KB JPEG at 256 px, ~0.8 s median RPC latency.

## Windows Smart App Control

Smart App Control (enforcement mode) blocks some unsigned native libraries by version: on 2026-10-13 it refused the DLLs of sqlite-jdbc 3.53.4.0 and 3.51.1.1 but allowed 3.46–3.53.2.1. The app therefore pins sqlite-jdbc 3.53.2.1 (`# @pin` in `libs.versions.toml`, forced in the root build) and loads the DLL from a fixed, content-named file in `%LOCALAPPDATA%\PhotoCleaner\native` instead of a new random temp file per launch (`StableSqliteLibrary`). Re-test before upgrading sqlite-jdbc.

## Connector design

- **Trust boundary:** the photos.google.com page. RPCs run in the page (MAIN world) with the page's own session; only normalized DTOs leave it. The desktop app never receives cookies or tokens; it gets a 16-hex-char SHA-256 fingerprint of the account e-mail so a scan can refuse to mix accounts.
- **Single attempt per request in the extension.** Retries, backoff and pacing are policy and live in Kotlin. GPTK's own pagination helpers are not used because they return partial results after a failure.
- **Strict normalization:** a page with any item lacking `mediaKey`, `dedupKey` or a taken timestamp fails as a whole. Favourite, archived, owned and media type are tri-state; a missing field is `null` (unknown), never `false`.
- **Album membership joins on `dedupKey`.** Album entries carry album-scoped `mediaKey`s (GPTK code and fixtures); the probe verifies this on the live account.
- **Bridge:** Ktor CIO on `127.0.0.1:47613`. Accepts only `Origin: chrome-extension://klibpopmmfopimbjeelnndddjpdgcgjf` (pinned by the manifest `key`) and loopback `Host` headers, then requires the pairing token in the first frame (close code 4401 otherwise). The token is 32 random bytes in `%LOCALAPPDATA%\PhotoCleaner\pairing-token`.
- **Archive is read from Google's archive-only listing as well as the per-item flag** (2026-10-12), mirroring favourites. Either source protects; the report shows where they disagree.
- **Extension reloads:** the service worker re-injects its scripts into Photos tabs that were open before an install/update (`scripting` permission, limited by host permissions to photos.google.com), and retries once after injecting if a tab does not answer. Only the newest page-script instance answers, so requests never run twice. The app warns when the connected extension version differs from `BridgeConfig.EXPECTED_EXTENSION_VERSION`; a unit test keeps that constant and the pinned extension ID in line with the manifest.
- **Logging:** scan starts, resumes, phase failures, retries, stops and completions are logged with run ids, counts and user-facing reasons; connector error messages never quote raw response data.
- **Previews** are fetched by the page script and only from `photos.fife.usercontent.google.com` / `*.googleusercontent.com` over HTTPS, so the bridge cannot be used as a general fetcher.
