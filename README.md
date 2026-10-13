# Photo Cleaner

Personal Google Photos cleaner. Only loose photos (not a favourite, not in any real album) will ever be cleanup candidates.
**Current state: read-only.** Nothing in the app or the extension can change your Google Photos library.

## Parts

| Path | What |
|---|---|
| `app/` | Compose Desktop shell and composition root |
| `core/design`, `core/storage` | Theme tokens; per-user data folder (`%LOCALAPPDATA%\PhotoCleaner`) |
| `services/connector/domain` | `PhotosConnector` / `BridgeController` interfaces and models |
| `services/connector` | Loopback Ktor bridge (`127.0.0.1:47613`), pairing token, extension client |
| `repositories/inventory` (+ `domain`) | SQLDelight scan store: runs, per-phase resume cursors, items, favourites, albums, album entries |
| `features/shared/protection` | Eligibility rules, coverage evidence, inventory report |
| `features/scan` | Resumable inventory scan (retries, backoff, pause/resume) and report screen |
| `features/sample` | Bounded preview sample of eligible photos |
| `features/connection` | Pairing and connection status screen |
| `features/probe` | Read-only probe of the live account |
| `extension/` | Chrome MV3 connector; vendors the GPTK parser (see `extension/vendor/gptk/UPSTREAM.md`) |
| `docs/` | Decisions, upstream findings |

## Build and test (Windows, PowerShell)

```powershell
cd C:\Work\PhotoCleaner
.\gradlew.bat test                 # Kotlin tests
cd extension
npm install
npm run typecheck
npm test                           # extension tests (includes the read-only guarantee)
npm run build                      # writes extension\dist
```

## Run the probe

1. Build the extension (`npm run build` in `extension\`).
2. Start the app: `.\gradlew.bat :app:launch` from `C:\Work\PhotoCleaner`. It runs from its own copy of the build (`app/build/staged-runs`), so rebuilding while it runs cannot crash it.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `C:\Work\PhotoCleaner\extension\dist`.
   The extension ID must be `klibpopmmfopimbjeelnndddjpdgcgjf`; the app only accepts that ID.
4. In the app, click **Copy** next to the pairing token. Click the extension's toolbar icon, paste the token, and click **Save and connect**.
5. Open (or reload) `https://photos.google.com` in the same Chrome profile, signed in to the account to inspect.
6. In the app, click **Run probe**. The report is saved under `%LOCALAPPDATA%\PhotoCleaner\probe\`.

The report contains counts and content-free data shapes only: no photo keys, album titles, URLs or account details.

## Run the inventory and sample

1. **Inventory** tab → **Start scan**. Pause and resume at any time, including across app restarts. Progress and results live in `%LOCALAPPDATA%\PhotoCleaner\inventory.db`.
2. When the report says **Protection coverage complete**, open the **Sample** tab → **Load sample** to see 48 eligible photos; click one to open it in Google Photos.
3. Follow `docs/manual-validation.md` to check the classification against known photos.

Eligibility rules: a photo is **protected** if it is a favourite (flag or favourites listing), in any real album (own or joined, matched by `dedupKey`), or archived. It is **eligible** only when the whole inventory finished cleanly within the last 24 hours, every album was read and matched Google's item count, and the photo explicitly is not a favourite, not archived and uploaded by you. Everything else is **unknown** and excluded. Videos are reported separately and never eligible in this milestone.

## Security notes

- The bridge listens on `127.0.0.1` only, accepts only the pinned extension origin and loopback `Host` headers, and requires the pairing token in the first message.
- Google session tokens stay inside the photos.google.com page; the desktop app never sees cookies or tokens.
- Logs (`%LOCALAPPDATA%\PhotoCleaner\logs`) never contain tokens, photo keys, titles or URLs.
