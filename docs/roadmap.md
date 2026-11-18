# Photo Cleaner: road to production

The one place that says where we are. Ask "where are we now?" or "what's next?" in any chat;
Claude reads this file, answers from it, and ticks items as they get done. Finished work is kept
short under "How we got here"; the details are in the git history.

Legend: `[x]` done · `[ ]` to do · `[~]` in progress

## Where we're heading

One browser extension. The AI runs in the browser on the computer's graphics card (WebGPU), photos
and data never leave the computer, and Google Photos is reached through the user's own signed-in
tab. Works in Chrome, Edge, Brave and other Chromium browsers, on Windows, Mac and ChromeOS. Desktop
only.

Not possible: a plain website or phone app. Google's official Photos API can't read a whole
library (since March 2025) and can't trash anything; only code inside photos.google.com can.

Target audience: people with huge libraries (anyone can review 500 photos by hand), so the first
analysis time is the main UX challenge.

Beyond duplicates (kinds of clutter, failed shots, thinning events…): see
[cleanup-roadmap.md](cleanup-roadmap.md).

### How it's put together

| Surface | Role | What's on it |
|---|---|---|
| Toolbar popup (click the extension icon) | The front door: says what to do next | No Photos tab → "Open Google Photos"; scanning → progress; groups ready → "Review 1,731 groups" (opens the review tab) |
| Chrome's side panel beside photos.google.com | The control room for this Google account | Which account; the Scan card; "Open review" |
| Review tab (own browser tab) | The workbench | Scan, Duplicates, Search & sweep, Settings (protection choices, usage question, diagnostics, erase) |

The work runs in a hidden background page (offscreen document), so closing the panel or a tab never
stops a scan or a trash send; the three surfaces are windows onto the same saved state.

Scan shows two numbered steps: **Read your library** (counts and protection report, ready as soon
as the photo list is read) and **Analyse photos** (AI progress, detail and **Full speed**). One
Scan button runs both in order.

### Design principles

- Techy and in control rather than polished: show what's happening and what's stored, in plain
  words (e.g. "AI files: 290 MB · only needed while scanning; downloaded again next time ·
  [Free up space]", visible, not hidden in settings). The user should feel in charge of the process
  and of their data.
- Native web feel (not a canvas-drawn UI).

## How we got here

- 2026-10-12 – 10-13: desktop prototype (Kotlin, Compose) with scan, protection rules, duplicate
  groups, search & sweep and simulated trash; used on my own library to settle the UX (keys,
  wording, layout).
- 2026-10-13 – 10-14: browser spike, then **go**. Key findings, all on my 180 labelled pairs:
  - Model: EmbeddingGemma 2 (onnx-community, Transformers.js, Apache 2.0, no sign-in). Quality in
    the browser practically the same as the desktop.
  - Detail **140** (desktop used 280): same duplicates and search quality, ~5.7 photos/s on the RTX
    (~1 h for my 17,200 photos), 1.5 photos/s on Intel built-in graphics (~3¼ h). Detail 70 for
    weak machines: 2.7 photos/s on Intel, search loses 2–4%.
  - Weights: **4-bit (q4) by default**, ~290–316 MB: a third of fp16's download, same quality, and
    no need for half-precision support on the graphics card. A library stays on one detail and one
    weight format.
  - The hidden background page is as fast as a tab (6.0 photos/s) and survives closing the panel;
    the AI runtime is packed into the extension (no code from the internet).
- Built as milestones, each usable on its own: M1 foundation (popup, panel, review tab, background
  page) · M2 library scan in the browser (counts identical to the desktop's) · M3 AI analysis
  (download with space check, speed check with time estimate, newest first, resumable, half speed
  while the user is busy, waits for the charger; 5.2 photos/s on the RTX, the hardware's limit) ·
  M4 Duplicates review · M5 Search & sweep · M6 real trashing.
- The desktop app was removed on 2026-10-18 (it is in the git history). Protection, grouping, the
  review queue and calibration maths are shared Kotlin (`features/shared/*`); the trash queue and
  search ranking stay TypeScript, now that the extension is their only user.
- Duplicates = at least the threshold similar AND taken within 2 minutes. Threshold **0.915** at
  both details (dev-calibration.html: at 140, 98.7% precision and 86.0% of duplicates found; at 70,
  no wrong pair and 83.7% found). Chosen like the desktop's: the lowest threshold with at most one
  wrong pair.
- Real trashing (2026-10-15): Google Photos' own trash and restore requests, at most 50 photos each,
  only in Photo Cleaner's page script; what counts is where each photo is afterwards, read back from
  the trash; undo restores. The simulated trash was removed on 2026-10-17. Since 2026-11-04 the
  queue runs from the background page and keeps going after the review tab closes or the browser
  restarts; an incompatible Google answer stops it (2026-11-05).
- Protection choices (favourites, albums, archive; all on by default; unknown status always kept),
  plain error messages with retries for hiccups, one shared "Google changed something" message
  with Copy diagnostics, the erase button (in Settings), and the Settings tab.
- Published: Chrome Web Store (`store-v0.5.3`, 2026-10-29), privacy policy on GitHub Pages
  (2026-10-30), branding-v1 icons, pricing decided (core free for good; optional paid extras maybe
  later, via an outside payment service with a licence check).

## Now: use it

- [~] Sort my own photos with it; polish the flow, keys, wording and layout as I go

## Finish the browser version

### AI and performance

- [ ] Search with the 4-bit model: check it is as good as fp16 was
- [ ] 4-bit speed on built-in (Intel) graphics
- [ ] Weak or unusual graphics: no WebGPU already gets a plain message. Still open: too little
      graphics memory or a card that fails mid-analysis, and whether a CPU-only fallback is worth
      having (probably far too slow for big libraries; measure it)

Provisional minimum: Chrome/Edge/Brave from 2023 or later (WebGPU, Chrome 113+); Windows 10/11,
macOS or ChromeOS (Linux depends on the graphics card); graphics from ~2017 or later (Intel/AMD
built-in, NVIDIA, Apple M1+); 8 GB RAM (16 comfortable); ~450 MB free disk (the 4-bit model is
316 MB; the app asks for 1.3× that free before downloading). Safari would need a separately
packaged app: out of scope.

### Duplicates and Search

- [ ] Decide how to show similarity in the review: the raw % is hard to read on its own (different
      meals score 86%)
- [~] Kinds of clutter: suggested searches (receipts, screenshots, parking…), developer page
      `dev-clutter.html`. Next steps and later milestones in [cleanup-roadmap.md](cleanup-roadmap.md)
- [ ] "Add to album…" for search results (a new album or an existing one). A write request, like
      trashing: one request at a time, every photo confirmed, failures shown; needs the user's
      explicit go-ahead as a new kind of write. Bonus: photos in an album are protected, so it is
      also "keep all of these"
- [x] "Less like these". Ranking: text + average of the "more" examples − a share of the average
      of the "less" examples; a photo closer to any "less" example than to every "more" example
      drops out. The examples show above the results as +/− thumbnails, each removable

### Trashing

- [ ] Work out the "still eligible?" check once per scan and protection setting, not per batch
- [ ] Reading the trash back gets slower as the trash fills up (one page of the listing per ~500
      photos): use Google's reply once we know what it says, and read back only on surprises

### Google's undocumented requests

Rule: when an answer doesn't fit, stop before changing anything and say so plainly; never carry on
and guess (see AGENTS.md).

- [ ] Signed-in check reads values from Google's page; if Google renames them, users are told
      "signed out" when they aren't. Tell the two apart, or word it "signed out, or Google changed
      something"
- [ ] A remote "pause trashing" switch (a setting fetched as data, e.g. Firebase Remote Config;
      extensions may fetch data, not code) to stop trashing for everyone while a fix ships
- [ ] Error reports must include these, so we know within hours (see usage reporting below)

### Data controls

- [ ] Storage line, visible: "AI files: 290 MB · only needed while scanning; downloaded again next
      time · [Free up space]"
- [ ] "Forget this account's library": deletes that account's fingerprints, findings and decisions
- [ ] Warn before uninstalling: Chrome gives extensions no "are you sure?" moment, so say it up
      front, next to the storage line and the erase button: everything (the scan, the analysis, your
      decisions) lives only in this browser, and uninstalling deletes it; a fresh start means
      scanning (minutes) and analysing (about an hour) again. Disabling keeps it. Consider exporting
      decisions (a backup) so they survive a reinstall or a new computer
- [ ] Goodbye page on uninstall (on our website): "Photo Cleaner's data has been erased from this
      computer; your photos in Google Photos were not touched", asks why they left. Its address
      carries nothing that identifies the user
- [ ] Disk full: pause the scan with a clear message and never half-save a decision; a missing model
      is re-downloaded; missing data is reported honestly ("start a new scan"), not a crash. Tools
      like CCleaner can wipe the model cache
- [ ] Reading the library needs a photos.google.com tab (its data feed and access tokens live
      there). Find out whether photos and thumbnails can be fetched without one

### M7 Live Google Photos compatibility monitoring

A scheduled end-to-end check against a dedicated test account, so changes to Google's undocumented
requests are found before users report them. It runs on a dedicated or self-hosted computer with a
real graphics card and a persistent browser profile; a human signs in once, and no Google
credentials are kept in the repository or typed by automation.

- [ ] Seed a small, non-personal library with known cases: free-floating photos, favourites,
      album members, archived photos, combinations of those protections, duplicates and
      near-duplicates, similar photos taken far apart, shared or partner-saved photos, videos and
      enough items to exercise pagination. Include genuine migrated Picasa material if a suitable
      account exists; that legacy state may not be reproducible in a new account
- [ ] Keep the expected aggregate results as a fixture: library, favourite, archive, album,
      protected, eligible and unknown counts. Never put the account, photo keys, URLs, album
      titles or images in test output
- [ ] Daily read-only sentinel: open Google Photos, confirm the expected account without logging
      it, read the library, favourites, archive and albums, fetch a few previews, and compare the
      results with the fixture. A changed answer or count stops the run and raises an alert
- [ ] Write canary, daily or weekly: with exact preconditions, approve one known eligible test
      photo, confirm it by reading Google's trash, restore it, and confirm it is back. Any mismatch
      stops before another write; nothing in the account is personal or irreplaceable
- [ ] Release run: exercise AI analysis, Duplicates, Search, protection, restart/resume and account
      separation against the same account before publishing a build
- [ ] Report only the extension version, stage, outcome and fixed error category. Treat an expired
      Google session as "human sign-in required", not a product failure

### Browsers

- [~] Chrome on Windows and on a MacBook work (2026-10-17); Edge and Brave still to test

## Get ready to publish

Before each release: go through [extension-manual-checks.md](extension-manual-checks.md) in Chrome
(and Edge and Brave once they are supported).

- [ ] Data privacy review (go through the Data privacy chapter below; decide on each open concern)
- [ ] Microsoft Edge Add-ons listing
- [ ] Website: landing page with "Add to Chrome", demo, privacy promise
- [ ] Direct download on the website (zip + "Load unpacked" steps for Chrome; signed file for
      Firefox if we support it)
- [~] Optional usage reporting, direct to GA4 Measurement Protocol (no relay): consent asked after
      the first scan, events kept on the computer until the answer, fixed milestones and failure
      categories only. Live collection verified 2026-10-30. See
      [usage-events.md](usage-events.md) and [usage-events-setup.md](usage-events-setup.md).
  - [ ] Check that events kept before the answer land at their own times
  - [x] Update the store's data-use disclosure and listing with the analytics release
        ([chrome-web-store.md](chrome-web-store.md), Privacy practices; 2026-11-13, with 0.5.12)
  - [ ] Google changed something: where (scan: library / favourites / archive / album list /
        album contents; analysis: library / previews; account check; previews in review), kind,
        Google's request name, the fixed message (e.g. "Parser item count differs"), extension version
  - [ ] Google keeps refusing a request: request name and error code
  - [ ] Previews stopped (25 in a row failed); rate limits (how often, to tune the pacing)
  - [ ] Unexpected errors: "Stopped by an unexpected error", screens that fail to draw, database
        errors (blocked upgrades, full disk)
  - [ ] The AI model failing to start (no WebGPU, no disk space), and speed check results (which
        computers are too slow)
  - [ ] Trash requests that fail or don't take effect
  - Never: photo keys, addresses, album titles, account or email, anything about the photos.
    A random install ID only. Reporting requires opt-in and can be turned off

## Launch

- [ ] 30–60 s demo video (screen recording with captions; Claude can write the script)
- [ ] Posts where people ask for help: r/googlephotos, Product Hunt
- [ ] Collect feedback and fix the first problems

## Data privacy

Kept up to date as we go; reviewed in full before publishing more widely.

### What's stored, and where

- Everything stays on the user's computer, in the browser's private area for the extension
  (inside Chrome's profile folder, under scrambled folder names, e.g.
  `Default\Service Worker\CacheStorage\<hash>\` for the model). No server operated by us, no app
  account and no photo uploads. Optional usage events go directly to Google only after agreement.
- Per photo: an embedding (768 numbers describing the content), quality measurements, when it was
  taken, whether it's protected (favourite, in an album, archived), and the user's decisions.
  Also album titles, the Google account, and the trash queue / undo history.
- The AI model files (~0.3 GB).
- No images (unless the optional thumbnail cache is ever added, see below).

### Already in our favour

- Library data stays on the computer; optional fixed usage events are separate from library data.
- Other extensions and websites can't read our storage; it belongs to the extension alone.
- Uninstalling the extension makes Chrome delete all of it.

### Concerns to resolve (decide in the data privacy review)

- [ ] Embeddings are sensitive although they're "just numbers": they describe what's in each photo,
      can be searched ("passport", "nude", "bank statement") by anyone with access to the computer
      and Chrome profile, and research shows they can be partly reversed into a rough description
      or image. Ideas for later: encrypt the stored data, make it less searchable
- [ ] Metadata together says a lot about someone's life: when photos were taken, album titles,
      favourites, the account, the decision history. Same ideas: encryption, storing less
- [ ] Photo links: the inventory stores each photo's thumbnail address (`thumbUrl`). If
      such addresses open without being signed in, storing them is like storing a key to the photo.
      Check; if they do, don't store them, or only briefly
- [ ] Optional thumbnail cache (for instant reviewing, ~30 KB each, ~500 MB for my library): real
      images, possibly intimate, in a folder the user can't easily find. If ever added: off unless
      the user turns it on, deleted after review, covered by the erase button
- [ ] Model download from Hugging Face shows them the user's IP address and that they use the app.
      Hosting the model on our own site avoids that (cost: hosting ~0.3 GB per new user)
- [ ] The realistic threat is someone else using the same computer, or malware on it; Chrome's
      storage isn't encrypted beyond the disk's own encryption (e.g. BitLocker)
- [ ] Keep all storage inside the extension's own pages. Lesson from the spike (2026-10-14):
      uninstalling both extensions removed all their data, but 1.1 GB of model files cached by the
      earlier test *web page* (localhost:8123) stayed, because it belonged to a website, not the
      extension. Anything the product stores through a normal web page (e.g. our website) survives
      uninstalling and breaks the "deleted on uninstall" promise

### Rules we follow

- [x] The erase button wipes every store we use: database, model cache, settings, and stops the
      background page, so "the same as uninstalling" is true. It says that it doesn't undo anything
      already in Google Photos' trash (kept there 30 days); the undo history is gone
- [x] No usage events or diagnostics contain photo data, keys, addresses, album titles or account
      details (Copy diagnostics and the problem log keep only the structure of Google's answers)
- [x] Optional fixed usage/failure events are off until consent; the privacy policy says so
- [x] Chrome Web Store: privacy policy and data-use disclosure (reads website content on
      photos.google.com, kept on the computer; optional usage statistics as User activity),
      "Limited Use" rules. Usage reporting disclosure added 2026-11-13

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
