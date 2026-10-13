# mtalcott/google-photos-deduper: how duplicate detection works (source review)

Clone: `scratchpad/upstream/deduper` (read only; nothing installed, built or run; submodule `Google-Photos-Toolkit` not fetched).

Legend: **[code]** means the code or repo file shows it directly. **[inference]** means my reading or an outside fact the repo does not confirm. **[issue]** means it comes from a GitHub issue or PR thread.

## 0. Repo facts

| Item | Value |
|---|---|
| HEAD | `af066647eaeb8b15b1a03c5b531aa0079e6461e4`, committed 2026-10-06T21:00:56-07:00 ("Merge pull request #145 ... trash-whole-group") |
| Default branch | `main` |
| Latest release/tag | `v2.2.3` (published 2026-09-13). HEAD is `v2.2.3-11-gaf06664`. |
| Unreleased on main since v2.2.3 | favourites-first keeper (26392ba), star badge (14f0702), trash-whole-group (365e72d), bucket cap at 5000 (251d55e), fetch-position progress (9df8143). **The v2.2.3 zip does not contain these.** |
| Licence | `LICENSE` is the plain **GNU AGPL v3** text. Its only copyright line is the FSF's (`Copyright (C) 2007 Free Software Foundation, Inc.`, LICENSE:4). `package.json` declares `"license": "AGPL-3.0-or-later"` and `"author": "Mack Talcott"`. No source file has a copyright or SPDX header. GitHub reports SPDX `AGPL-3.0`. |
| Stack | Chrome MV3 extension (Plasmo 0.89.4, React 18, MUI 7). `@mediapipe/tasks-vision` ^0.10.18 (lockfile resolves **0.10.34**). It reaches the library through the GPTK submodule (xob0t/Google-Photos-Toolkit), which wraps the undocumented Google Photos web API. |

### History of the detection code [code: git log]
- **2021-04 to 2022-01:** Python plus Mongo. It grouped by **filename/filesize/dimensions** (d02df64) and tried to add duplicates to an album through the Library API.
- **2023-07:** Flask, Celery and a React client. The first ML version used **sentence-transformers `clip-ViT-B-32`** (2abb268). Then **GPU processing was added and then removed as "Too buggy"** (e95eab7, then 3810ae6).
- **2023-08-23 (0ba2bdc):** switched to the **MediaPipe ImageEmbedder `mobilenet_v3_large.tflite`** with `l2_normalize=True`, plus a copy of **sentence-transformers' `community_detection`** ported to torch (the file comment cites UKPLab `util.py#L346`). Thumbnails were `baseUrl=w250-h250` and the default threshold was 0.99. Keeper selection went largest dimensions, then file size, then a fallback to dimensions. Videos were skipped.
  - Legacy file: `git show 5992645^:app/lib/duplicate_image_detector.py`. The model URL is at L28 and `_community_detection` at L136-219.
- **2026-04-07 (5992645, #92):** full rewrite as a standalone Chrome extension (no backend, no OAuth). The detector was ported to TypeScript ("Ports the Python DuplicateImageDetector", `lib/duplicate-detector.ts:2`).
- **#103/#104 (2026-04):** IndexedDB embedding cache, a worker pool and incremental fetch. Full mode was briefly replaced by an adjacent-only O(n) walk and then **restored to true pairwise** in #106 because it missed non-adjacent duplicates.
- **#106 (c7886b0):** added "smart" mode (timestamp bucketing plus union-find) and made it the default.
- **#115:** keeper order became original quality > resolution > upload date. **#121:** videos are included through poster frames, and the smart window is tunable. **#126:** dedupe by `dedupKey`. **251d55e:** bucket cap. **26392ba:** favourites first.

---

## 1. Where detection runs and which model it uses

**Execution location [code]**
- Detection is orchestrated from the **extension app tab** (`tabs/app.tsx`, served as `chrome-extension://…/tabs/app.html`), in `runDuplicateDetection` (app.tsx:423-498). That function calls `smartDetectDuplicates` or `fullDetectDuplicates` (app.tsx:445-464).
- Heavy work runs in **dedicated classic Web Workers** loaded from `scripts/embedder-worker.js`, which is built from `workers/embedder.worker.ts` with esbuild (package.json `build:worker`). It does **not** use an offscreen document, the service worker or a backend.
  - Embedding uses a pool of `max(1, min(navigator.hardwareConcurrency ?? 4, 8))` workers (duplicate-detector.ts:822-825). Dispatch is pull-based in batches of `WORKER_BATCH_SIZE = 20` (:773, :880-892).
  - Grouping uses a separate single worker: `runCommunityDetectionInWorker` (:959-1017) or `runSmartDetectionInWorker` (:491-545).
- Fetching media-item metadata runs in the **photos.google.com tab's MAIN world** (`scripts/google-photos-commands.js`). Messages are relayed through the content-script bridge and the service worker (`contents/google-photos-bridge.ts`, `background/index.ts`).
- Note: the committed `scripts/embedder-worker.js` was last committed in c7886b0 (April 2026) and is older than `workers/embedder.worker.ts` (251d55e). `prebuild` regenerates it, so a fresh build is fine.

**Model [code]**
```ts
// lib/duplicate-detector.ts:63-64
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_large/float32/latest/mobilenet_v3_large.tflite";
```
- This is the MediaPipe Image Embedder MobileNet-V3-Large, float32, on the `latest` path, so **the model is not version-pinned**.
- The model is fetched once per scan on the main thread, but only when some item needs embedding (:803-813). Each worker receives a cloned ArrayBuffer (:847-857).
- The code does no persistent model caching of its own; whether the browser HTTP cache keeps it is not controlled here.
- The WASM runtime comes from the extension bundle: `scripts/vision_wasm_internal.{js,wasm}`, copied from node_modules (package.json `copy:wasm`, duplicate-detector.ts:815-820). The worker preloads it with `importScripts` (embedder.worker.ts:35-43).
- Embedder options (embedder.worker.ts:45-50):
  ```ts
  embedder = await ImageEmbedder.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer: new Uint8Array(modelBuffer) },
    quantize: false,
    l2Normalize: true,
    runningMode: "IMAGE",
  });
  ```
  - **No `delegate` is set.** [inference] MediaPipe Tasks Web defaults to the CPU delegate, which is WASM/XNNPACK, so this runs on **WASM CPU, not WebGL or WebGPU**. The legacy Python app also dropped GPU as "Too buggy" (3810ae6).
- **Preprocessing [code]** (embedder.worker.ts:65-86):
  1. The fetched thumbnail blob goes through `createImageBitmap`.
  2. It is drawn at its native size onto an `OffscreenCanvas`, and `getImageData` is passed to `embedder.embed(imageData)`.
  3. There is no manual resize, crop or normalisation. MediaPipe does the resize internally.
  - Images that fail are silently skipped (`catch {}` at :83-85).
- **Input size:** not stated in the repo. [inference] The MediaPipe model card says the MobileNet-V3 embedder takes 224×224 input. The 200 px-tall thumbnail is therefore resized or stretched by MediaPipe's preprocessing to the model input. Aspect handling is MediaPipe's default, which I did not verify.
- **Embedding dimension:** not stated in code (it is read at runtime as `embeddings[0].length`). The repo has two conflicting hints, so the dimension is **unverified**. I did not download the model to check, because that needs permission.
  - `notes/2026-08-28-smart-detect-bucket-cap.md:18` says "throughput … at dim=1024".
  - `lib/embedding-cache.ts:3` says "~5KB/item". At 4 B/float, 1024 dims gives 4 KB and 1280 dims gives 5 KB.
- No perceptual hashes, TF.js or ONNX are used. Metadata such as filename, size and dimensions is **not** used in similarity (confirmed by the maintainer in #27).

## 2. Image data

- **Size [code]:** `THUMB_HEIGHT = 200` (duplicate-detector.ts:67). The URL is built as `${thumb}=h200`, so the height is 200 and aspect ratio is preserved (lib/photo-url.ts:8-14, used at :740). `thumb` is the bare URL that GPTK returns (google-photos-commands.js:161).
  - The review UI also uses `=h200` (DuplicateGroups.tsx:241).
  - The full-screen viewer uses viewport size × devicePixelRatio as `=w{W}-h{H}` (PhotoViewerModal.tsx:26-30).
  - The legacy Python app used `=w250-h250`.
- **Fetching [code]:** `fetchThumbnails` (duplicate-detector.ts:701-767).
  - It calls `fetch(url, { credentials: "include", signal: AbortSignal.any([AbortSignal.timeout(8000), userSignal]) })` from the extension page. The host permissions include `https://*.googleusercontent.com/*` (package.json manifest).
  - Concurrency is **10** async workers pulling from a queue (:707, :733-764).
  - Timeout is **8 s** per request (:708).
  - It **never retries.** A non-OK response or a network error leaves the blob as `null` and the item is silently dropped from detection (:748-756). There is no counter of dropped items in the result.
  - Progress is reported every 50 items (:724).
- **Caching [code]:**
  - Thumbnails are not cached; they are held in memory as Blobs only for the current scan.
  - **Embeddings are cached in IndexedDB** in DB `gpd-embeddings`, store `embeddings`. The key is `mediaKey`, the value is the raw Float32 `ArrayBuffer`, and `EMBEDDING_CACHE_VERSION = 1` (:75-77). The comment says to bump the version to invalidate the cache when the model changes.
  - Cached keys are loaded with `getAllKeys()`, and their thumbnails are **not downloaded** (:228-237, :713-715). Values are loaded in bulk with `getAll()` (:121-158).
  - New embeddings are written as each worker batch returns, so partial progress survives a cancel or a closed tab (:904-907). Write errors are swallowed (:98-103).
  - **Nothing ever evicts entries.** `lib/embedding-cache.ts` (`EmbeddingCache` with `evictExcept`, DB `gpd-cache`) is **only referenced by tests**. It is dead code in production.
- **Media-item metadata [code]:** `getAllMediaItems` pages through `gptkApi.getItemsByUploadedDate(nextPageId)`, newest upload first (google-photos-commands.js:138-201). It has a 60 s per-page timeout (:110) and projects the fields in :158-174:
  - `mediaKey, dedupKey, thumb, timestamp` (taken), `creationTimestamp` (uploaded), `resWidth, resHeight, duration, isOwned, isOriginalQuality, isFavorite`
  - `fileName` (from `descriptionShort`) and `productUrl`
  - `size` is declared in the type (types.ts:197) but **never populated**.

## 3. Similarity, thresholds and candidate generation

- **Metric [code]:** cosine similarity, computed as a dot product of L2-normalised vectors. A pair matches when `dot >= threshold` (embedder.worker.ts:148-149 for smart mode, :207 and :214/:230 for full mode).
- **Threshold [code]:**
  - Default **0.99** (`DEFAULT_SETTINGS`, types.ts:257-261).
  - The user can tune it with a slider from **0.90 to 1.00, step 0.01** under "More options" (ScanConfig.tsx:139-153).
  - Settings persist in `chrome.storage.local` (app.tsx:650-652).
- **Two candidate strategies** (ScanConfig.tsx:96-111; app.tsx:445-464):
  1. **Smart mode (default)**, in `smartDetectDuplicates` (duplicate-detector.ts:547-695):
     - **Blocking by taken timestamp**, using fixed windows: `key = floor(timestamp / windowMs) * windowMs` (`groupByTimestamp`, :359-379). With `windowMs = 0` it requires an exact match.
     - The window defaults to **1 s** (types.ts:260). The UI choices are **1s / 1m / 1h / 1d / 1w** (ScanConfig.tsx:119-132).
     - Only buckets with ≥2 items are kept. Items with a non-finite `timestamp` are dropped from smart mode entirely (:370).
     - **Embeddings are computed only for items that land in a ≥2 bucket** (:576-586).
     - Inside each bucket it does **all-pairs O(k²)** dot products with union-find (embedder.worker.ts:118-170).
     - **Bucket cap** (`MAX_BUCKET_SIZE = 5000`, :390; on main only, not in v2.2.3): oversized buckets are sorted by timestamp and split into near-equal contiguous chunks. Pairs that straddle a chunk boundary are missed, and the UI shows a notice when `bucketsSplit > 0` (:405-427; DuplicateGroups.tsx:487-493).
     - [inference, follows from floor bucketing] Windows are fixed, not sliding. Two shots 0.3 s apart that straddle a second boundary land in different 1 s buckets and are never compared. Widening the window reduces but does not eliminate this edge effect.
  2. **Full mode**, in `fullDetectDuplicates` (:185-344), then the worker's `workerCommunityDetection` (embedder.worker.ts:188-264):
     - This is a TypeScript port of **sentence-transformers `util.community_detection`**: batched `matMul` of 128 rows against all n (:196, :207), so **O(n²)** with no ANN index.
     - The worker's `topK` **fully sorts each row** (:292-310). The repo's own note calls this "a separate O(n^2 log n) bug" (notes/…bucket-cap.md:167-168).
     - Timestamps are passed in but ignored (`_timestamps`, :191).
     - The commit message for #106 cites roughly 1 h per 50k items for full mode.
     - The exported `communityDetection` in `lib/duplicate-detector.ts:1033-1071` is an adjacent-only walk in timestamp order. It and `withinGroupDuplicates` (:435-485) are **only used by tests**; production uses the worker code.
- **Pre-filters [code]:**
  - `dedupeByDedupKey` keeps the first item per `dedupKey` (:50-61). Items with different mediaKeys but the same dedupKey come from saved shared-album items; trashing works per dedupKey (#137, #126).
  - Items without `thumb` are dropped (:200, :562).
  - **There are no** same-dimension, same-date (other than smart bucketing), filename, size or media-type pre-filters.
  - `isOwned` is fetched but **unused**.
  - `settings.dateRange` is sent with `getAllMediaItems` (app.tsx:711-714), but the page script **ignores it** and reads only `sinceTimestamp` (google-photos-commands.js:104-105).

## 4. Grouping

- **Smart mode [code]:** **union-find with transitive closure** inside each bucket (embedder.worker.ts:135-160). Components of size ≥2 become groups.
  - [inference] Chaining is therefore possible: A~B and B~C puts A, B and C together even when A and C fall below the threshold. Bursts of near-identical shots inside one window can chain into one big group.
  - There is no max group size; the only bound is the bucket cap.
- **Full mode [code]:** the sentence-transformers algorithm.
  - For each item whose top-2 (itself plus one more) reaches the threshold, the candidate community is **every item with sim ≥ threshold to that seed**. This is a star around the seed, not a transitive closure.
  - The window grows with `sortMaxSize` doubling (:220-226).
  - Communities are sorted by size, largest first, and overlap is removed greedily: an item goes to the first (largest) community that contains it, and leftovers below 2 are discarded (:243-260).
  - [inference] There is no chaining, but members are not guaranteed to be pairwise ≥ threshold, because two items can each be close to the seed and not to each other. Items can also be stolen by a larger overlapping community.
- **Output [code]:**
  - Items within a group are sorted by upload date ascending (:320-323, :680-682). Groups are sorted by size descending (:692; full mode sorts in the worker).
  - `similarity` is set to **the threshold, not a measured value** (`similarity: threshold, // Approximate`, :329, :687), even though types.ts:213 documents it as "average pairwise similarity".
  - The UI shows that number as "NN% similar" (DuplicateGroups.tsx:189).

## 5. Keeper ("original") selection [code]

`selectDefaultKeep` (duplicate-detector.ts:23-39) sorts by:
1. **Favourite** (`isFavorite === true`). This is on main only (26392ba) and **not in v2.2.3**.
2. **Storage quality:** `isOriginalQuality` true scores 2, unknown/null scores 1, false scores 0.
3. **Pixel count** `resWidth*resHeight`, larger first (missing values count as 0).
4. **Oldest upload date** (`creationTimestamp` ascending).

Other details:
- When everything ties, the input order wins because the sort is stable. Callers pass items already sorted by upload date.
- **Not used:** file size (never fetched), taken date, filename and owner.
- The UI recomputes the default per group at render time with the same function (app.tsx:547-558; the comment at :546 is stale and omits favourites).
- Legacy history: at first the most recent item was kept, which issue #57 complained about. Then largest dimensions, then file size (Python era). #99 made it oldest upload, and #115 introduced quality > resolution > upload.

## 6. Exclusions and protections

- **Favourites [code]:** only *preferred* as the keeper, and marked with a star badge (DuplicateGroups.tsx:308-316). They are **not excluded**; a favourite that is not the keeper can still be trashed, for example when a group has two favourites or the user changes the selection. Main only.
- **Albums [code/issue]:** no album awareness at all. Issue #149, which asks to move album membership to the survivor, is open and unanswered.
- **Archived / locked / trash / partner-shared [code]:** the code never filters on them. What `getItemsByUploadedDate` returns is decided by GPTK and Google. [inference/unknown] I could not verify this because the submodule was not fetched.
- **Shared / not owned:** `isOwned` is projected but unused. Saved shared-album copies are handled only through the `dedupKey` collapse (#126).
- **Videos [code]:** included since #121. The poster-frame thumbnail is embedded like a photo (:196-200, :559-562).
  - No duration check is made.
  - Groups are labelled "videos", "photos" or "items" (DuplicateGroups.tsx:27-46).
  - [issue #116] A community fork added a filter that requires durations within 1%. Upstream did not adopt it.
- **Live photos / bursts:** no code handles them. [inference] Burst shots taken within the same second are prime smart-mode candidates and could be grouped at threshold 0.99 if they are visually near-identical. Issue #20 (from the old DOM-click era) notes that Google shows a burst-specific delete dialog. The current code trashes through the API by dedupKey, so I don't know how bursts behave now.

## 7. Scale and performance [code unless marked]

- **Media fetch:**
  - Results are chunked into 10k-item messages because Chrome caps a message at 64 MiB; 190k items is about 84 MB (google-photos-commands.js:36-63; fix #148 for issue #147).
  - There is a 150 s silence watchdog (app.tsx:65-70) and a 60 s per-page timeout.
- **Incremental fetch:**
  - On a re-scan it fetches only items with an upload date newer than the last scan's newest `creationTimestamp` and merges them with cached items (app.tsx:675-703, :236-252).
  - [inference from code] Cached items are not revalidated, so items deleted outside the tool stay in the merged set until the results are cleared.
- **Embeddings:** persistent IndexedDB cache with no eviction (see §2). Worker pool of up to 8. Cancelling goes through AbortController plus `worker.terminate()`.
- **Grouping:**
  - Smart mode is bounded by the 5000-item bucket cap. The note measures 6.26e8 MAC/s at dim=1024: a 5k bucket takes about 17-20 s, and a 50k bucket without the cap took about 34 min (notes/…bucket-cap.md:18, :141-158).
  - Full mode is O(n²) or worse; the commit message for #106 cites about 1 h per 50k items.
  - Memory: the flat Float32 array is n×dim, and full mode allocates a 128×n score block per batch (`matMul`).
- **Persistence:**
  - Scan results and selections go to `chrome.storage.local` (app.tsx:608-647); `unlimitedStorage` is granted.
  - Results are invalidated when the account email changes (lib/scan-results.ts).
  - Partial scans **cannot resume** except through the embedding cache.
  - The ScanLogger ring buffer keeps 50 entries (lib/scan-log.ts).

## 8. Review UX and deletion [code]

- **Groups:** shown as rows of 200 px thumbnails with filename, WxH, taken and uploaded dates, and Keep/Trash chips, loaded with infinite scroll (DuplicateGroups.tsx:160-336, :388-407).
  - Every group is selected by default (app.tsx:209-211).
  - Clicking a photo toggles Keep, which allows multi-keep; the last kept item cannot be removed (app.tsx:577-593).
  - "Trash whole group" sets an empty keep set (lib/kept-overrides.ts:28-38). It is main only.
  - A full-screen viewer opens with the Space key.
- **Confirmation:** the dialog asks "Move N duplicates to trash?" and warns when whole groups would be removed (app.tsx:981-1006).
- **Trash:**
  - It calls GPTK `api.moveItemsToTrash(dedupKeys)` in **chunks of 250** to avoid HTTP 504 (google-photos-commands.js:12, :214-263).
  - It uses Google Photos trash (soft delete) and never deletes permanently.
  - **Undo** uses the snackbar's `restoreFromTrash` with the same 250-item chunks (app.tsx:794-812; commands.js:270-314) and optimistically restores the UI snapshot.
- **Known issue [issue]:** #133 (open), "Moving to Trash stuck at 2,500" of about 13.6k.

## 9. Relevant GitHub issues (`gh issue list --state all --limit 60`)

- **#27 (open), missed exact duplicates.**
  - A user measured true duplicates at **0.9858** cosine with MobileNet-V3 at 250 px, which falls below the 0.99 default.
  - Lowering the threshold pulled in non-duplicates.
  - The maintainer said **`clip-ViT-B-32` via sentence-transformers was more accurate but about 3× slower with OOMs**, and that metadata (filename, dimensions) should boost the score. That enhancement was never done.
- **#7 (open):** filter results by resolution, name or size. Not done.
- **#138:** "Not all duplicates found" for re-shared copies at a different resolution. Closed by the user, who found the results unsorted rather than missing.
- **#137:** a group of 3 showed 6 items because of the dedupKey issue, and trashing one trashed all of them. Fixed by #126 in v2.2.2.
- **#105:** stuck at 97% while computing similarity, which led to the worker-pool rewrite (#104).
- **#147:** the fetch stalled around 190k-234k items (64 MiB message cap). Fixed in v2.2.3.
- **#133 (open):** trash stalls at 2,500.
- **#118 (open):** configurable keep rules. One user had 4,926 groups from 101k photos.
- **#116:** community video and duration filter and date-range filter; not merged upstream.
- **#19 (open):** limit scan by date. The setting exists in types but is ignored, as shown in §3.
- **#149 (open):** album membership of duplicates.
- **#57:** default keeper was the newest; fixed later.
- **#20:** burst shots.

## 10. What is reusable for us, and what the licence means

**Licence facts [code]:** AGPL-3.0-or-later. [inference, not legal advice] Copying or adapting its TypeScript or JavaScript into our app makes the derived work AGPL. For a personal tool we never distribute or offer over a network, the AGPL's obligations are essentially not triggered. If we ever share or publish the cleaner, any copied code forces AGPL on the combined work. Ideas, algorithms and parameter values are not copyrightable, so we can reuse them freely.

**Third-party pieces it reuses, so we can get them from the source under permissive terms [inference]:**
- The community-detection algorithm is from **sentence-transformers `util.community_detection`** (Apache-2.0, cited in the legacy Python file at L135). We plan to use Sentence Transformers anyway, so we can call `sentence_transformers.util.community_detection` (and `paraphrase_mining_embeddings`) directly. There is no need to touch the AGPL port.
- The model is MediaPipe's `mobilenet_v3_large.tflite`, and the runtime is `@mediapipe/tasks-vision` (Apache-2.0). Both are independent of this repo.
- GPTK (xob0t/Google-Photos-Toolkit) carries its own licence. I did not check it because the submodule was not cloned. Check it before relying on its API wrappers.

**Ideas worth taking (no code copying needed):**
- Collapse items with the same `dedupKey` before detection, and trash by dedupKey. The trash API works per dedupKey, so a same-dedupKey "duplicate" cannot be removed separately.
- Use time blocking on the taken timestamp, with a tunable window, to make detection near-linear. Cap bucket size and **surface the recall loss** in the UI.
  - Improvement for us: use a sliding window over a timestamp-sorted list, or overlapping buckets, instead of `floor()` windows.
  - Also run a second blocking pass (or ANN) that is not time-based, to catch re-saved or re-dated copies.
- Cache embeddings keyed by mediaKey with a model or cache version, and write them incrementally so cancelled scans keep their progress. Add eviction, which they lack.
- Skip downloading thumbnails whose embeddings are already cached.
- Keeper order of favourite > original quality > pixels > oldest upload, with an explicit warning when a whole group would be deleted.
- Trash in batches of 250 and offer undo through restore-from-trash.

**Pitfalls they hit that we should avoid:**
1. A generic mobile embedder at 200 px misses true duplicates at 0.99, and lower thresholds bring in near-duplicates (#27). We should calibrate the threshold on our own labelled pairs. We should also combine visual similarity with metadata (dimensions, taken time, filename stem, duration for videos) instead of a single cosine cut-off.
2. Reporting the threshold as "similarity" hides the real score. We should store and show the actual pairwise or min-to-keeper similarity.
3. Union-find chaining in smart mode versus star communities in full mode: the two modes can produce different groups for the same data. We should pick one deliberately; for example, require every member to be ≥ t to the keeper, or use complete-linkage.
4. Silent drops of failed thumbnail fetches (no retry, no count) and silently ignored settings (`dateRange`).
5. Videos are matched only on their poster frame, with no duration check.
6. No protection for album membership (#149) or for archived or shared items.

**Note for our planned stack [inference]:** `google/embeddinggemma` models are *text* embedding models. As far as I know there is no image tower, so they cannot embed photos the way MobileNet or CLIP does here. If image similarity is the goal, a vision or multimodal encoder fits the pattern this repo followed (CLIP via sentence-transformers was the maintainer's "more accurate" option). Please verify the exact "embeddinggemma-2" model card before committing to it.
