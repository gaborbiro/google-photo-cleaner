# Publishing to the Chrome Web Store

Everything the store's forms ask for, ready to paste, and the steps for each release.
Dashboard: https://chrome.google.com/webstore/devconsole

## Each release

1. Push or merge to master. After checks pass, GitHub assigns a version and publishes the packaged
   ZIP in [Releases](https://github.com/gaborbiro/google-photo-cleaner/releases). One-time repository
   configuration is in [automatic releases](github-releases.md).
2. Download `photo-cleaner-<version>.zip` and go through `docs/extension-manual-checks.md` in Chrome.
3. The package excludes the manifest's `key` (the store assigns its own ID) and developer pages
   (`dev-*`). There is no normal laptop release-build step.
4. Submit it: Actions → **Submit to Chrome Web Store** → Run workflow (on master), with the version
   you checked (see [Submitting from GitHub](#submitting-from-github)). Or by hand: Dashboard → the
   item → Package → Upload new package → Submit for review.

The store's extension ID differs from the unpacked one (pinned by `key`). If something ever needs
the two to match, replace `key` with the public key from the dashboard (Package → View public key).

## First time only

- Developer account: register at the dashboard with the Google account that will own the listing,
  pay the one-off US$5 fee, and verify the contact email. Consider a separate account rather than
  your personal one: it is shown to users as the publisher.
- GitHub Pages for the privacy policy: repository Settings → Pages → Source: **GitHub Actions**.
  Then the `Publish website` workflow publishes `site/` on each push to master:
  https://gaborbiro.github.io/google-photo-cleaner/privacy.html

## Submitting from GitHub

The `Submit to Chrome Web Store` workflow (`.github/workflows/submit-to-chrome-web-store.yml`) only runs when
started by hand. It downloads the GitHub Release ZIP of the version you give (the one you checked;
wait until its Build and Package run has published it), uploads it with the
[Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) (V2) and submits it for
review. It changes nothing else on the listing. It refuses, before
uploading, while another version is still in review or approved but not yet published, and when
the version is not newer than the published one. Running it again for a version already in review
does nothing. "Wait for me to publish it in the dashboard" asks the store to hold the version
after approval until you press Publish.

After a successful submission it tags the release's commit `store-v<version>`, next to the
`v<version>` tag every build gets. The tag means "sent to the store": Google approves later, and a
rejected version keeps its tag. If tagging fails after the submission went through, run the workflow
again for the same version; it skips the submission and adds the tag.

```
git tag -l 'store-*'                     # every version sent to the store
git describe --tags --match 'store-*'    # the last one before this commit
git log store-v0.4.80..master            # what changed since
```

It signs in to Google without a stored key: GitHub proves to Google that the job runs from this
repository's master branch (Workload Identity Federation), and gets a short-lived token for a
service account that the store lets manage the listing.

One-time setup (done on 2026-10-29, in Google Cloud project `photo-cleaner-cws-13383`). Step 2 needs
the Google account that owns the listing (it needs 2-step verification); the Cloud project can be on
any of your accounts.

1. In a Google Cloud project (any; a new one is fine), run in Cloud Shell, with your project ID.
   In a project created a minute ago, the pool command can fail with PERMISSION_DENIED while the new
   project's rights settle: wait a minute and run it again.

   ```
   PROJECT=your-project-id
   REPO=gaborbiro/google-photo-cleaner
   gcloud services enable chromewebstore.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com --project=$PROJECT
   gcloud iam service-accounts create photo-cleaner-publisher --project=$PROJECT
   gcloud iam workload-identity-pools create github --location=global --project=$PROJECT
   gcloud iam workload-identity-pools providers create-oidc photo-cleaner --project=$PROJECT \
     --location=global --workload-identity-pool=github \
     --issuer-uri=https://token.actions.githubusercontent.com \
     --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
     --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/master'"
   NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
   gcloud iam service-accounts add-iam-policy-binding photo-cleaner-publisher@$PROJECT.iam.gserviceaccount.com \
     --project=$PROJECT --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
   echo "projects/$NUMBER/locations/global/workloadIdentityPools/github/providers/photo-cleaner"
   ```

2. Developer Dashboard → Publisher → **Settings**: add
   `photo-cleaner-publisher@<project>.iam.gserviceaccount.com` as the service account (the store
   allows one).
3. GitHub → Settings → Secrets and variables → Actions → **Variables** (none of these is secret):

   | Name | Value |
   |---|---|
   | `CWS_WORKLOAD_IDENTITY_PROVIDER` | The `projects/…/providers/photo-cleaner` line printed above |
   | `CWS_SERVICE_ACCOUNT` | `photo-cleaner-publisher@<project>.iam.gserviceaccount.com` |
   | `CWS_PUBLISHER_ID` | Developer Dashboard → Publisher → Settings (also in the dashboard's address: `…/devconsole/<publisher ID>`) |
   | `CWS_EXTENSION_ID` | The store's ID of the item (32 letters a–p, in its dashboard and store URL) |

4. Optional: Settings → Environments → `chrome-web-store` (the first run creates it) → Required
   reviewers, so each run waits for a click of approval.

If you change the listing's visibility in the dashboard, publish once by hand there before the
workflow works again (a store rule).

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
> • No account or collection server. Optional usage statistics only if you agree. Everything Photo Cleaner learns about your library stays in
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
>   for 30 days, and Photo Cleaner can bring them back.
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

**Before the analytics release:** update the live listing and disclosures together with the privacy
policy. Disclose optional **User activity** and the random installation identifier (check the current
dashboard's identifier category), transferred directly to Google Analytics after consent. No photo,
account or search contents are transferred. Verify event/user retention is two months with reset
disabled and advertising features off. See [usage reporting setup](usage-events-setup.md). These
repository notes do not change the live store answers or publish the policy.

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
> Approved photos go to Google Photos' trash, where they stay for 30 days; Undo (Z) brings them back.
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
