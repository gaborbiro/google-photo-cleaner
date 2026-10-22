# Publishing to the Chrome Web Store

Everything the store's forms ask for, ready to paste, and the steps for each release.
Dashboard: https://chrome.google.com/webstore/devconsole

## Each release

1. Raise `version` in `extension/static-app/manifest.json` (the store refuses a version it already has).
2. Go through `docs/extension-manual-checks.md` in Chrome.
3. `cd extension && npm run check && npm run package` → `extension/release/photo-cleaner-<version>.zip`.
   The package is `dist-app` without the manifest's `key` (the store refuses it and gives the
   extension its own ID) and without the developer pages (`dev-*`).
4. Dashboard → the item → Package → Upload new package → Submit for review.

The store's extension ID differs from the unpacked one (pinned by `key`). If something ever needs
the two to match, replace `key` with the public key from the dashboard (Package → View public key).

## First time only

- Developer account: register at the dashboard with the Google account that will own the listing,
  pay the one-off US$5 fee, and verify the contact email. Consider a separate account rather than
  your personal one: it is shown to users as the publisher.
- GitHub Pages for the privacy policy: repository Settings → Pages → Source: **GitHub Actions**.
  Then the `Website` workflow publishes `site/` on each push to master:
  https://gaborbiro.github.io/google-photo-cleaner/privacy.html

## Store listing tab

**Name** (from the manifest): Photo Cleaner

**Summary** (from the manifest, max 132 characters):
Find and trash duplicate photos in Google Photos with on-device AI. Free and private: your photos never leave your computer.

**Description:**

> Photo Cleaner finds duplicates and clutter in large Google Photos libraries, and moves the photos you
> approve to Google Photos' trash.
>
> Free to use
> • Finding and trashing duplicates and searching your library will always be free.
> • If paid extras come later, they'll be optional additions. Nothing you can do today will be taken away.
>
> Private by design
> • The AI runs on your own computer's graphics card. Your photos are never uploaded anywhere.
> • No account, no server, no analytics. Everything Photo Cleaner learns about your library stays in
>   your browser, and uninstalling removes it.
>
> Duplicates
> • Groups near-identical shots taken moments apart (bursts, retakes, edits) and suggests the best one
>   to keep, by sharpness and quality.
> • Go through one group at a time with the keyboard, and undo any choice.
>
> Search and sweep
> • Describe what you want gone ("screenshots", "receipts", "blurry photos of the floor") and Photo
>   Cleaner finds them across your whole library.
> • Refine with "more like these" and "less like these", then trash the selection in one go.
>
> Safe
> • Favourites, archived photos and photos in albums are protected and never offered for the trash
>   (each can be switched off).
> • Every photo is checked again just before it is trashed. Trashed photos stay in Google Photos' trash
>   for 60 days, and Photo Cleaner can bring them back.
>
> What you need
> • Chrome on a Windows or Mac desktop or laptop, with a graphics card from about 2017 or later.
> • About 450 MB of free disk space: the AI model (about 320 MB, downloaded once from Hugging Face)
>   and the analysis of your photos.
> • The first analysis takes a while for a big library (about an hour for 17,000 photos on a good
>   graphics card). It runs in the background, and you can start reviewing straight away.
>
> Problems or ideas? Open an issue at github.com/gaborbiro/google-photo-cleaner/issues, or write to
> nomadworkz@gmail.com.
>
> Photo Cleaner works through your signed-in photos.google.com tab. It is not made by Google or
> affiliated with Google. Google Photos is a trademark of Google LLC.

**Category:** Productivity → Tools (there is no Photos category).

**Language:** English.

**Graphics** (in `docs/design/branding-v1/`):

| Field | File | Notes |
|---|---|---|
| Store icon, 128×128 | `icon-128.png` | |
| Small promo tile, 440×280 | `store-thumbnail-440x280.png` | |
| Screenshots, 1280×800 (1 to 5) | `extension/release/store-screenshot-1.png` (published 2026-10-18) | Not in git: `release/` is ignored, as it shows real photos. A Duplicates group (coffee and cake, no people), the browser bar cropped off, the account's email replaced with the contact address nomadworkz@gmail.com, sides filled with the page's background. To redo when the app is finished; more ideas: a Search with results, the panel in Google Photos during a scan, the popup. Screenshots go public: no people, no place names, no email |
| Marquee, 1400×560 | (optional) | Only used if the store features the extension |

**Additional fields:** Homepage URL: https://github.com/gaborbiro/google-photo-cleaner ·
Support URL: https://github.com/gaborbiro/google-photo-cleaner/issues

## Privacy practices tab

**Single purpose:**
Find duplicate and unwanted photos in the user's Google Photos library and move the ones the user approves to Google Photos' trash.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `unlimitedStorage` | Keeps the AI model's files (about 320 MB) and the per-photo analysis (tens of MB for libraries with tens of thousands of photos) on the computer, so they are not evicted and downloaded or analysed again. |
| `offscreen` | Runs the library scan and the AI analysis in a hidden extension page, so a scan of a large library (often over an hour) keeps going when the user closes the panel or the review tab. |
| `scripting` | After installing or updating, adds Photo Cleaner's script to photos.google.com tabs that were already open, so the user does not have to reload them. |
| `idle` | Slows the analysis down while the user is using the computer and runs at full speed when they are away, so the AI does not make the computer sluggish. |
| `sidePanel` | Shows Photo Cleaner's panel (the account, the scan's progress, the way to the review) in Chrome's side panel beside Google Photos, only on photos.google.com tabs. |
| Host: `https://photos.google.com/*` | Photo Cleaner works inside the user's signed-in Google Photos tab: it reads the photo list, favourites, archive and albums there, and trashes or restores the photos the user approves. |

The AI model is downloaded from Hugging Face without a host permission: Hugging Face lets any page
fetch model files (CORS), so the extension needs no access to its sites.

**Remote code:** No, I am not using remote code. (The AI runtime, ONNX Runtime Web, is packed into the
extension under `ort/`; the model download is weights, which are data.)

**Data usage**, what to tick: **Website content** (the photo list and previews read from
photos.google.com). It is used only on the computer and never sent to us. Tick the three
certifications (no selling or transferring data, no unrelated uses, no creditworthiness or lending).

**Privacy policy URL:** https://gaborbiro.github.io/google-photo-cleaner/privacy.html

## Distribution tab

Visibility: Public. Regions: all. Free of charge (the store no longer handles payments; see "Pricing"
in the roadmap).

## Note for the reviewers (Package → test instructions)

> Photo Cleaner needs a Google account with some photos in Google Photos. Open photos.google.com, then
> click the extension's icon and press "Scan" (or "Open panel in Google Photos" for the side panel). Stage 1 lists the library;
> stage 2 downloads the AI model (about 320 MB from Hugging Face) and analyses the photos on the
> graphics card (WebGPU). "Open review" opens the Duplicates and Search tabs.
>
> Approved photos go to Google Photos' trash, where they stay for 60 days; Undo (Z) brings them back.
> Looking through the groups and the search results changes nothing in the library.
>
> The bundled Transformers.js library contains a fallback address on cdn.jsdelivr.net for ONNX Runtime.
> It is never used: the extension sets the runtime's path to its own packed copy (`ort/`), and its
> content security policy only allows scripts from the extension itself.

## Expect

Host permissions on photos.google.com plus "Website content" usually mean an in-depth review: days
rather than hours, sometimes a couple of weeks for a first submission. A rejection email names the
policy; the usual ones are a permission without a clear justification, or a mismatch between the
data-use answers and the privacy policy. Fix, then resubmit.
