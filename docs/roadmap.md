# Photo Cleaner: road to production

The one place that says where we are. Ask "where are we now?" or "what's next?" in any chat;
Claude reads this file, answers from it, and ticks items as they get done.

Legend: `[x]` done · `[ ]` to do · `[~]` in progress

## Where we're heading (decided 2026-10-13, pending the browser test in step 1)

One browser extension instead of desktop app + extension. Clicking its icon opens the whole app
in a browser tab. The AI runs in the browser on the computer's graphics card (WebGPU), photos and
data never leave the computer, and Google Photos is reached through the user's own signed-in tab.
Works in Chrome, Edge, Brave and other Chromium browsers, on Windows, Mac and ChromeOS. Desktop only.

Not possible: a plain website or phone app. Google's official Photos API can't read a whole
library (since March 2025) and can't trash anything; only code inside photos.google.com can.

## 0. Learn the product by using it (ongoing, in the original chat)

- [x] Desktop prototype: scan, protection rules, duplicate groups, search & sweep, simulated trash
- [~] Sort my own photos with it; polish the flow, keys, wording and layout
- [ ] Write down the UX decisions worth keeping (they carry over to the browser version)

## 1. Prove the browser version can work

- [x] Research: is there a way without an extension? (no, see above)
- [x] Research: do similar extensions survive in the Chrome Web Store? (yes, several are live; see notes)
- [x] Research: can people install it from my own website? (Firefox yes; Chrome/Edge only from stores, see notes)
- [ ] Put the project under git, so two chats can't overwrite each other's work
- [ ] Browser AI test: run the photo model in an extension page with WebGPU
  - [ ] speed on my laptop (photos per second; the desktop app does about 10)
  - [ ] quality: re-score my 180 labelled pairs; compare with the desktop results
  - [ ] if EmbeddingGemma 2 can't run in the browser, try SigLIP 2 (open licence) instead
- [ ] Check the Gemma licence allows a public product to download the model for every user
- [ ] Choose how to build the UI: Kotlin (Compose for web, reusing today's code) or TypeScript
- [ ] Go / no-go decision

## 2. Build the browser version

- [ ] App page inside the extension, opened from the toolbar icon
- [ ] Move the tested Kotlin rules (protection, grouping, trash queue) to Kotlin Multiplatform so they run in the browser
- [ ] Store everything in the browser (IndexedDB or SQLite in browser storage)
- [ ] Screens: Scan library, Duplicates, Search
- [ ] Calibration becomes a developer tool; users get the tuned threshold
- [ ] Real trashing in Google Photos (still simulated today), with undo and safety checks
- [ ] Test on Chrome, Edge and Brave; on Windows and a Mac

## 3. Get ready to publish

- [ ] Name, icon, short description
- [ ] Privacy policy page (the stores require one)
- [ ] Chrome Web Store developer account (one-off $5 fee) and listing
- [ ] Microsoft Edge Add-ons listing
- [ ] Website: landing page with "Add to Chrome", demo, privacy promise
- [ ] Direct download on the website (zip + "Load unpacked" steps for Chrome; signed file for Firefox if we support it)
- [ ] Pricing: free, paid, or free with a paid tier

## 4. Launch

- [ ] 30–60 s demo video (screen recording with captions; Claude can write the script)
- [ ] Posts where people ask for help: r/googlephotos, Product Hunt
- [ ] Collect feedback and fix the first problems

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
