# Photo Cleaner: road to production

The one place that says where we are. Ask "where are we now?" or "what's next?" in any chat;
Claude reads this file, answers from it, and ticks items as they get done.

Legend: `[x]` done · `[ ]` to do · `[~]` in progress

## Where we're heading

One browser extension instead of desktop app + extension (decided 2026-10-13, browser test passed
2026-10-14). The AI runs in the browser on the computer's graphics card (WebGPU), photos and data
never leave the computer, and Google Photos is reached through the user's own signed-in tab.
Works in Chrome, Edge, Brave and other Chromium browsers, on Windows, Mac and ChromeOS. Desktop only.

Not possible: a plain website or phone app. Google's official Photos API can't read a whole
library (since March 2025) and can't trash anything; only code inside photos.google.com can.

### How it's put together (decided 2026-10-14)

| Surface | Role | What's on it |
|---|---|---|
| Toolbar popup (click the extension icon) | The front door: says what to do next | No Photos tab → "Open Google Photos"; scanning → progress; groups ready → "Review 1,731 groups" (opens the review tab) |
| Panel inside photos.google.com | The control room for this Google account | Which account; last scan ("6 days ago · 312 new photos since"); one **Scan** button (list the library and check protection, then analyse new photos), Pause, live progress; "Open review" |
| Review tab (own browser tab) | The workbench; replaces the desktop app | Duplicates review, Search & sweep, storage and data controls |

The work runs in a hidden background page (offscreen document), so closing the panel or a tab never
stops a scan or loses anything; the three surfaces are windows onto the same saved state.

### Design principles

- Techy and in control rather than polished: show what's happening and what's stored, in plain
  words (e.g. "AI files: 290 MB · only needed while scanning; downloaded again next time ·
  [Free up space]", visible, not hidden in settings). Cleaning photos with AI is a techy thing to
  want; the user should feel in charge of the process and of their data.
- Native web feel (not a canvas-drawn UI).

## 0. Learn the product by using it (ongoing, in the original chat)

- [x] Desktop prototype: scan, protection rules, duplicate groups, search & sweep, simulated trash
- [~] Sort my own photos with it; polish the flow, keys, wording and layout
- [ ] Write down the UX decisions worth keeping (they carry over to the browser version)

## 1. Prove the browser version can work

- [x] Research: is there a way without an extension? (no, see above)
- [x] Research: do similar extensions survive in the Chrome Web Store? (yes, several are live; see notes)
- [x] Research: can people install it from my own website? (Firefox yes; Chrome/Edge only from stores, see notes)
- [x] Put the project under git, so two chats can't overwrite each other's work (each chat works in its own copy and branch)
- [x] Browser AI test: run the photo model in the browser with WebGPU (branch `claude/browser-ai-spike-06a92b2`, folder `C:\Work\PhotoCleaner-browser-ai`, steps in `spikes/browser-ai/README.md`)
  - [x] a browser-ready version exists: onnx-community/embeddinggemma-2-ONNX (Transformers.js); image parts ~290 MB in 4-bit, ~880 MB in fp16
  - [x] test tools written: export of the labelled photos + test page
  - [x] run the export and the test page
  - [x] quality: re-scored my 180 labelled pairs; practically the same as the desktop (fp16: 178 of 180 pairs decided the same; 4-bit: 177)
  - [x] speed, first measurement: 2.2–2.4 photos/s on the RTX (model only), 0.4–0.6 on Intel built-in graphics; the desktop app does about 8 including downloads
  - [x] speed-ups: the GPU model is the whole cost (image preparation 5–16 ms); several photos per GPU call isn't supported by this model setup; lower detail is the lever: 140 → 5.7 photos/s, 70 → 11 photos/s on the RTX
  - [x] duplicates at lower detail: as good as 280 on my pairs (140: 78 of 86 found, 70: 74, 280: 75; desktop 76; each with 1 wrongly flagged)
  - [x] search quality at lower detail, answer key = my 4 approved sweeps: 140 matches 280 within 1–2 photos ("More like selected" and "meal prep boxes"); 70 loses 2–4%; I couldn't spot a wrong photo in any top 24
  - [x] decision: the browser version uses detail 140 (same quality as the desktop, ~5.7 photos/s on the RTX, ~50 min for my library)
  - [x] built-in (Intel) graphics: 140 → 1.5 photos/s (~3¼ h for my library), 70 → 2.7 photos/s (~1¾ h); accuracy holds (75–76 of 86). Usable, but the first scan must be a background job (see phase 2)
  - [x] inside a test extension (RTX, detail 140): own tab 5.3 photos/s, panel embedded in photos.google.com 5.3, hidden background page (offscreen document) 6.0; all found 78 of 86 with 1 wrongly flagged. Google's page doesn't block the panel; a long scan can live in the background page. The AI runtime must be packed into the extension (no code from the internet); ship only the one runtime file that's used (~25 MB)
  - [x] ~~only if EmbeddingGemma 2 disappoints: try SigLIP 2 instead~~ not needed
  - [x] how far the weights can be trimmed (detail 140, RTX, 2026-10-14): fp16 ~880 MB 5.7 photos/s 78 of 86 · 8-bit ~510 MB 5.0/s 75 · 4-bit + fp16 parts ~255 MB 4.2/s 77 · **4-bit ~290 MB 5.4/s 77**, all with 1 wrongly flagged. Quality barely moves; smaller isn't faster on the RTX (unpacking costs time). Decision: **4-bit (q4) by default**: a third of the download and memory, same quality, and it doesn't need half-precision support in the GPU (fp16 and q4f16 do). A library stays on one version, like the detail level. Still to check in M3: Search with 4-bit, and speed of 4-bit on built-in graphics
- [x] Check the licence allows a public product to download the model for every user: EmbeddingGemma 2 is Apache 2.0, no sign-in needed
- [x] Choose how to build it: the tested Kotlin rules (protection, grouping, trash queue) shared via Kotlin Multiplatform, compiled to JavaScript; the UI in TypeScript for a native web feel
- [x] Where the app shows: popup + panel inside Google Photos + review tab (see "How it's put together")
- [x] Go / no-go decision: **go** (2026-10-14)

## 2. Build the browser version

Target audience: people with huge libraries (anyone can review 500 photos by hand), so the first
analysis time is the main UX challenge. The desktop app keeps working for my own clean-ups until the
extension can do everything it does. UI in React + TypeScript (closest to Compose's model); `extension/`
grows into the product; a new shared Kotlin module holds the tested rules, compiled to JavaScript.

### Milestones (each one usable on its own)

- [x] **M1 Foundation** (2026-10-14, commit `ed88a96` on branch `claude/extension-m1-cd69e7d`, folder `C:\Work\PhotoCleaner-extension`; 47 tests pass; checked in Chrome: panel, popup, review tab, survives closing the panel and a browser restart, accounts kept apart): one extension; popup, panel in Google Photos (shows the signed-in account),
      empty review tab; background page running a pretend job that survives closing the panel.
      Check: close and reopen everything, progress is still there
- [ ] **M2 Library scan in the browser**: the panel's Scan lists library, favourites, archive, albums
      and works out protection, saved per account. Check: counts match the desktop app's report exactly
- [ ] **M3 AI analysis**: model download with space check; capability and speed check with an honest
      time estimate; background analysis, newest first, resumable; stays out of the way (pause while
      the user is busy or on battery, a "full speed" switch). Check: embeddings match the desktop's
- [ ] **M4 Duplicates review**: review tab with groups, keys, toasts, viewer (UX decisions from phase
      0), simulated trash. Check: same groups as the desktop app
- [ ] **M5 Search & sweep**: text search and "More like selected". Check: the meal-prep sweep comes back
- [ ] **M6 Real trashing + data controls**: move to Google Photos' trash with undo and safety checks;
      storage line, "Forget this account", "Delete all my data", goodbye page
- [ ] Then: Chrome, Edge, Brave on Windows and a Mac (need access to a Mac); phase 3

### Capability check and minimum specs (provisional until M3 testing)

- [ ] Before the first analysis (~30 s): usable GPU? (WebGPU, memory, half-precision support), then
      download the model and analyse ~10 sample photos; tell the user plainly ("about 2 photos/s; your
      17,200 photos take about 2½ hours in the background; start reviewing in a few minutes"); pick
      detail 70 and/or the 4-bit model on weak machines; no usable GPU → say so honestly (CPU-only
      fallback probably far too slow for big libraries; measure in M3)
- Provisional minimum: Chrome/Edge/Brave from 2023 or later (WebGPU, Chrome 113+); Windows 10/11, macOS
  or ChromeOS (Linux depends on the graphics card); graphics from ~2017 or later (Intel/AMD built-in,
  NVIDIA, Apple M1+); 8 GB RAM (16 comfortable); ~1.5 GB free disk
- Mac: the same extension package runs in Chrome/Edge/Brave/Arc on macOS (WebGPU over Apple's Metal);
  Safari would need a separately packaged app: out of scope

### Details by area

Structure and storage

- [ ] One extension with the three surfaces: toolbar popup, panel inside photos.google.com, review tab
- [ ] Hidden background page that does the work; the surfaces only show and control it
- [ ] Move the tested Kotlin rules (protection, grouping, trash queue) to Kotlin Multiplatform so they run in the browser
- [ ] Store everything in the browser (IndexedDB or SQLite in browser storage). Only numbers are stored, no images: an embedding (fingerprint, 768 numbers) per photo, ~25–50 MB for 17,000 photos; the model (0.3–0.9 GB) is the big item. Request `unlimitedStorage`: no quota, and Chrome never evicts it when the disk is low
- [ ] Separate data per Google account (storage is per Chrome profile, not per account): label every scan, embedding and decision with the account, show and act on the current one only; never apply one account's protection info to another's photos. Switching accounts back and forth keeps each one's progress
- [ ] Disk space and system clean-ups: check free space before downloading the model; on "disk full" pause the scan with a clear message and never half-save a decision; a missing model is re-downloaded; missing data is reported honestly ("start a new scan"), not a crash. Windows' own clean-up leaves browser data alone, but tools like CCleaner can wipe the model cache
- [ ] Reading the library during a long scan: today it goes through a photos.google.com tab (data feed and access tokens live there). Keep a Photos tab open in the background, or find out whether photos can be fetched without one. Same question for thumbnails in the review tab

Scanning and reviewing

- [ ] One Scan (library + protection, then AI analysis of new photos) instead of today's two steps
- [ ] First analysis as a background job: resumes across sessions, newest photos first, review can start while it runs
- [ ] Pick the detail level from the computer's speed (140 on a good graphics card, 70 on a weak one), fixed per library, each with its own tuned threshold
- [ ] Calibration becomes a developer tool; users get the tuned threshold
- [ ] Review tab: Duplicates and Search & sweep (carry over the UX decisions from phase 0)
- [ ] Real trashing in Google Photos (still simulated today), with undo and safety checks

Data controls (details in the Data privacy chapter)

- [ ] Storage line, visible: "AI files: 290 MB · only needed while scanning; downloaded again next time · [Free up space]"; "Forget this account's library"
- [ ] "Delete all my data · removes everything Photo Cleaner stored on this computer, the same as uninstalling it (the extension stays installed). Photos already in Google Photos' trash stay there."
- [ ] Goodbye page on uninstall (on our website): "all your data has been deleted from this computer", asks why they left

Testing

- [ ] Test on Chrome, Edge and Brave; on Windows and a Mac

## 3. Get ready to publish

- [ ] Name, icon, short description
- [ ] Data privacy review (go through the Data privacy chapter below; decide on each open concern)
- [ ] Privacy policy page (the stores require one)
- [ ] Chrome Web Store developer account (one-off $5 fee) and listing
- [ ] Microsoft Edge Add-ons listing
- [ ] Website: landing page with "Add to Chrome", demo, privacy promise
- [ ] Direct download on the website (zip + "Load unpacked" steps for Chrome; signed file for Firefox if we support it)
- [ ] Pricing: free, paid, or free with a paid tier (one competitor: US$9.99 once)

## 4. Launch

- [ ] 30–60 s demo video (screen recording with captions; Claude can write the script)
- [ ] Posts where people ask for help: r/googlephotos, Product Hunt
- [ ] Collect feedback and fix the first problems

## Data privacy

Kept up to date as we go; reviewed in full before publishing (phase 3).

### What's stored, and where

- Everything stays on the user's computer, in the browser's private area for the extension
  (inside Chrome's profile folder, under scrambled folder names, e.g.
  `Default\Service Worker\CacheStorage\<hash>\` for the model). No server, no account, no upload.
- Per photo: an embedding (768 numbers describing the content), quality measurements, when it was
  taken, whether it's protected (favourite, in an album, archived), and the user's decisions.
  Also album titles, the Google account, and the trash queue / undo history.
- The AI model files (0.3–0.9 GB).
- No images (unless the optional thumbnail cache is ever added, see below).

### Already in our favour

- Nothing leaves the computer: there's no database of ours that could leak.
- Other extensions and websites can't read our storage; it belongs to the extension alone.
- Uninstalling the extension makes Chrome delete all of it.

### Concerns to resolve (decide in the data privacy review)

- [ ] Embeddings are sensitive although they're "just numbers": they describe what's in each photo,
      can be searched ("passport", "nude", "bank statement") by anyone with access to the computer
      and Chrome profile, and research shows they can be partly reversed into a rough description
      or image. Ideas for later: encrypt the stored data, make it less searchable
- [ ] Metadata together says a lot about someone's life: when photos were taken, album titles,
      favourites, the account, the decision history. Same ideas: encryption, storing less
- [ ] Photo links: the desktop inventory stores each photo's thumbnail address (`thumb_url`). If
      such addresses open without being signed in, storing them is like storing a key to the photo.
      Check; if they do, don't store them, or only briefly
- [ ] Optional thumbnail cache (for instant reviewing, ~30 KB each, ~500 MB for my library): real
      images, possibly intimate, in a folder the user can't easily find. If ever added: off unless
      the user turns it on, deleted after review, covered by "Delete all my data"
- [ ] Model download from Hugging Face shows them the user's IP address and that they use the app.
      Hosting the model on our own site avoids that (cost: hosting ~0.3–0.9 GB per new user)
- [ ] The realistic threat is someone else using the same computer, or malware on it; Chrome's
      storage isn't encrypted beyond the disk's own encryption (e.g. BitLocker)
- [ ] Keep all storage inside the extension's own pages. Lesson from the spike (2026-10-14):
      uninstalling both extensions removed all their data, but 1.1 GB of model files cached by the
      earlier test *web page* (localhost:8123) stayed, because it belonged to a website, not the
      extension. Anything the product stores through a normal web page (e.g. our website) survives
      uninstalling and breaks the "deleted on uninstall" promise

### Rules we follow

- [ ] "Delete all my data" wipes every store we use: database, model cache, settings, and stops the
      background page, so "the same as uninstalling" is true. Warn that it doesn't undo anything
      already in Google Photos' trash (kept there 60 days); the undo history is gone
- [ ] "Forget this account's library" deletes that account's embeddings, findings and decisions
- [ ] The goodbye page's address carries nothing that identifies the user
- [ ] No analytics or crash reports containing photo data, keys or addresses (the desktop app already
      strips them from errors)
- [ ] Chrome Web Store: privacy policy + data-use disclosure (reads website content on
      photos.google.com, kept on the computer), "Limited Use" rules

## Notes

### Similar products (checked 2026-10-13)

Several Google Photos duplicate cleaners are live in the Chrome Web Store, so Google does allow
this kind of extension. All are small, which leaves room for a better product:

- TopPics: roughly 200–340 users, 3.8★ from 4 ratings; groups photos in the browser, but its
  auto-select sends photos to their server.
- PicSweep duplicate finder: 13–58 users; works in the browser, protects starred photos.
- Cloud Duplicate Finder, "Delete Google Photos", "Google Photos Delete Tool", "Bulk Delete Google
  Photos" (about 77 users): also listed.
- Google Photos Toolkit: a userscript on GitHub (about 1,000 stars), not in a store.
- One cleaner I tried (2026-10-13) draws its panel inside photos.google.com on the right: nice,
  because closing the tab closes both. But it works by scrolling Google's page through every
  photo (slow and visible), seems to compare pixels rather than use AI, and forgot its findings
  when reopened (its state lives only in the panel). Price: "Pro" US$9.99 once, licence checked locally.
- google-photos-deduper: installed by "Load unpacked" from GitHub, not from the store.

No report found of such an extension being removed. The risk that remains: Google changes the
Photos web app and the extension breaks until it's updated.

### Installing from my own website

- Chrome and Edge (Windows, Mac): extensions can only be installed from their stores. The exceptions
  are company-managed computers and developer mode ("Load unpacked"), which works but is techy.
- Edge can install straight from the Chrome Web Store after a one-time "allow extensions from other
  stores" switch. Brave and Vivaldi install from it directly; Opera needs a small helper add-on.
- Firefox: a Mozilla-signed file can be offered on our own site and installs with one click.
  Firefox support would need checking (WebGPU and extension differences).

### Glossary

- Embedding (also "fingerprint"): the AI's summary of a photo as 768 numbers, coordinates in a
  "meaning space". Similar photos get nearby coordinates; similarity 1.0 = the same spot. Text is
  turned into the same kind of coordinates, which is how Search works.
- Extension page: a web page shipped inside the extension (`chrome-extension://<id>/…`), shown in
  its own tab, in a popup, or embedded in another page.
- Background page (offscreen document): an invisible extension page that keeps working with no tab
  open; stops when the browser closes. Not the same as the background worker (service worker),
  which Chrome stops after ~30 s idle.

### Sources

- https://chromewebstore.google.com/detail/bfldbbnccphgfbkgncakfphgipgdfibg (TopPics)
- https://extscope.org/extension/bfldbbnccphgfbkgncakfphgipgdfibg
- https://chromewebstore.google.com/detail/eafmmihnbimmbpnaaojplmgagkfiebjo (PicSweep)
- https://chromeboard.com/extension/google-photos-duplicate-f-eafmmihnbimmbpnaaojplmgagkfiebjo
- https://chrome.google.com/webstore/detail/cloud-duplicate-finder/nancamaalaciknodndipfgknfmlhlnkp
- https://github.com/xob0t/Google-Photos-Toolkit
- https://github.com/mtalcott/google-photos-deduper
- https://developer.chrome.com/docs/extensions/mv2/hosting-changes
- https://support.google.com/chrome/a/answer/7532015
- https://extensionworkshop.com/documentation/publish/self-distribution/
- https://pureinfotech.com/install-chrome-extension-chromium-edge/
- https://huggingface.co/onnx-community/embeddinggemma-2-ONNX
