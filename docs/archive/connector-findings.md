# GPTK access-layer map (for a read-only MV3 inventory tool)

All paths are relative to the clone at
`C:\Users\Personal\AppData\Local\Temp\claude\C--Work-DailyMacros\9822b6fc-f31a-40a1-b8d8-d191f9ba305d\scratchpad\upstream\gptk`.
The clone was only read. No npm/pnpm install, build or GPTK code was run. Fixture JSON
(`tests/fixtures/parser/*.json`) was inspected as data using my own script
(`scratchpad\scripts\inspect.js`).

Labels used below:
- **[CODE]**: shown directly by GPTK source.
- **[FIXTURE]**: seen in GPTK's committed, anonymised response fixtures.
- **[ISSUE]**: from GitHub issues or PRs.
- **[INFERENCE]**: my reading. Not verified.
- **[LIVE]**: can only be settled against a live account.

## 0. Pinned version

| Item | Value |
|---|---|
| Repo | https://github.com/xob0t/Google-Photos-Toolkit |
| Default branch | `main` |
| HEAD SHA | `6db9ab355e4797327e4078cf87a2b6994d36cf73` |
| HEAD commit date | 2026-08-20T07:09:14+03:00, "Release 3.3.0 (#141)" |
| Latest release | `v3.3.0`, published 2026-08-20T04:12:30Z. The tag points at the HEAD SHA above. |
| Previous tags | v3.2.0, v3.1.0, v3.0.0, v2.10.0 |
| package.json version | 3.3.0 |

## 1. Architecture

### Runtime / world
- GPTK is a **userscript** (Tampermonkey/Violentmonkey) **[CODE]** `package.json:6-19`:
  - `match *://photos.google.com/*`
  - `run-at: body`
  - `grant: GM_registerMenuCommand, unsafeWindow`
  - `noframes`
- It reads tokens from `unsafeWindow.WIZ_global_data`, which is the page's own global. It sends requests with the page-origin `fetch` and `credentials: 'include'`, so it relies on the signed-in session's cookies. No OAuth is involved.
- To use it in an MV3 extension, the code must run in the **MAIN world**. Otherwise `WIZ_global_data` is not visible and the request is not same-origin. google-photos-deduper does exactly this (see §11):
  - it injects `<script>` tags pointing at web-accessible files;
  - it adds a one-line shim, `window.unsafeWindow = window`.

### Token source **[CODE]** `src/windowGlobalData.ts:3-10`
```ts
rapt:   unsafeWindow.WIZ_global_data.Dbw5Ud,   // only needed for locked folder
account:unsafeWindow.WIZ_global_data.oPEP7c,   // signed-in email (used as localStorage key)
'f.sid':unsafeWindow.WIZ_global_data.FdrFJe,
bl:     unsafeWindow.WIZ_global_data.cfb2h,    // build label, e.g. boq_photosuiserver_...
path:   unsafeWindow.WIZ_global_data.eptZe,    // e.g. "/_/PhotosUi/"
at:     unsafeWindow.WIZ_global_data.SNlM0e,   // XSRF token
```
These values are captured **once, at module load** (it is a `const` object). Nothing refreshes them later.

### Request encoding **[CODE]** `src/api/api.ts:43-112` (`makeApiRequest`)
- Body (form-encoded), line 44-46:
  `f.req=` + `encodeURIComponent(JSON.stringify([[[rpcid, JSON.stringify(requestData), null, 'generic']]]))` + `&at=<at>&`
- Query params, lines 48-57:
  - `rpcids=<rpcid>`
  - `source-path=<window.location.pathname>`
  - `f.sid`
  - `bl`
  - `pageId=none`
  - `rt=c`
  - `rapt` (only if it is a string, which is the locked-folder case)
- URL, line 62: `https://photos.google.com${path}data/batchexecute?...`. This is `/_/PhotosUi/data/batchexecute`, and multi-account `/u/N/` comes in through `eptZe`.
- Headers, line 69-71: only `content-type: application/x-www-form-urlencoded;charset=UTF-8`.
  - Method is `POST` with `credentials: 'include'`.
  - It sends no `x-same-domain`, no `_reqid` and no `hl`.
- Response parsing, line 81-99:
  1. Split the text on `\n`.
  2. Take the **first** line containing `wrb.fr`.
  3. `JSON.parse` it, then `JSON.parse(parsedData[0][2])`.
  4. Exactly one RPC is sent per request. GPTK never batches several rpcids into one call.

### Layering
| File | Role | Imports |
|---|---|---|
| `src/api/api.ts` | **Pure transport plus one method per RPC** | `./parser`, `../windowGlobalData`, `../types` only |
| `src/api/parser.ts` | **Pure positional parsers**, registry keyed by rpcid (`:387-402`) | `../types` only |
| `src/types/index.ts` | Type definitions | none |
| `src/windowGlobalData.ts` | Token capture | `unsafeWindow` global |
| `src/utils/splitArrayIntoChunks.ts` | Helper | none |
| `src/api/api-utils.ts` | Pagination loops, concurrency pool, and the **mutating** bulk ops | imports UI `../ui/logic/log` and `Core` |
| `src/gptk-core.ts` | Orchestration: sources → filters → actions | `log`, `getFromStorage` (localStorage keyed by email) |
| `src/filters.ts` | Client-side filters and the dHash similarity check | `log` |
| `src/index.ts`, `src/globals.ts`, `src/ui/**` | UI. `globals.ts` exposes `gptkApi`, `gptkCore` and `gptkApiUtils` on `unsafeWindow`. | |

The vendorable read-only core is `api.ts` (with the mutating methods deleted), `parser.ts`, `types/index.ts` and a replacement `windowGlobalData.ts`. `api-utils.ts` and `gptk-core.ts` are coupled to UI logging and the `isProcessRunning` flag.

### Dependencies **[CODE]** `package.json:38-51`
- **Zero runtime dependencies.**
- devDependencies only: rollup (+ replace, typescript, banner2 plugins), typescript, eslint, vitest, vite, tslib.
- Package manager is pnpm 10.30.0. The output is an IIFE bundle (`rollup.config.mjs`).

## 2. Every RPC id

**R** = read-only, **M** = MUTATING.

All line numbers are in `src/api/api.ts`. "Page token" means `nextPageId` from the parsed response, which is passed back as the request param.

### Read-only RPCs

| rpcid | Function (line) | Purpose | Request data | Pagination / size |
|---|---|---|---|---|
| `lcxiM` | `getItemsByTakenDate` (114) | Library timeline, ordered by **taken** date, descending | `[pageId, timestamp, pageSize=500, null, 1, sourceCode]`. sourceCode: 1=library (non-archived), 2=archive only, 3=both (the default). | Page token `[1]`, and/or a timestamp cursor (`lastItemTimestamp` `[2]`, minus 1). Page size param is 500; the fixture page has 500 items. |
| `EzkLib` | `getItemsByUploadedDate` (138) | Library ordered by **upload** date (the "recently added" query) | `['', [[4,'ra',0,0]], pageId]` | Page token `[1]`. Fixture page has 100 items; there is no size param. |
| `EzkLib` | `search` (154) | Free-text search | `[query, null, pageId]` | Page token |
| `EzkLib` | `getFavoriteItems` (187) | **Favourites listing** | `['Favorites', [[5,'8',0,9]], pageId]` | Page token |
| `swbisb` | `getRemoteMatchesByHash` (171) | Find library items by file hash | `[hashArray, null, 3, 0]` | none |
| `zy0IHe` | `getTrashItems` (203) | Trash listing | `[pageId]` | Page token. About 500 per page (issue #74 logs). |
| `nMFwOc` | `getLockedFolderItems` (219) | Locked folder | `[pageId]`, and needs `rapt` | Page token at `[0]`, items at `[1]` |
| `F2A0H` | `getSharedLinks` (259) | Shared links | `[pageId, null, 2, null, 3]` | Page token. Fixture has 25 per page. |
| `Z5xsfc` | `getAlbums` (275) | Album list | `[pageId, null, null, null, 1, null, null, pageSize=100, [2], 5]` | Page token `[1]` |
| `snAcKc` | `getAlbumPage` (292) | Album or shared-link contents plus album metadata | `[albumMediaKey, pageId, null, authKey]` | Page token `[2]`. About 300 per page (issue #100 logs). |
| `e9T5je` | `getPartnerSharedMedia` (546) | Partner-sharing items | `[pageId, null, [null, [[[2,1]]], [partnerActorId], [null, gaiaId], 1]]` | Page token `[0]` |
| `EzwWhf` | `getStorageQuota` (451) | Quota | `[]` | none |
| `VrseUb` | `getItemInfo` (621) | Per-item info, **includes isFavorite** | `[mediaKey, null, authKey, null, albumMediaKey]` | 1 item |
| `fDcn4b` | `getItemInfoExt` (640) | Per-item extended info, **includes the list of albums containing the item** | `[mediaKey, 1, authKey, null, 1]`. Comment at :639 says it only works for keys in your library. | 1 item |
| `EWgK9e` | `getBatchMediaInfo` (657) | **Batch** info: fileName, size, description, timestamps, quality/space | `[[[keys.map(k=>[k])], [<36-slot template>]]]`. Response is unwrapped at `[0][1]`. | GPTK sends up to `infoSize=5000` keys per request (`api-utils-default-presets.ts:8`) |
| `yCLA7` | `getDownloadToken` (476) | Starts a zip download job | `[keys.map(k=>[k])]` | none |
| `dnv2s` | `checkDownloadToken` (489) | Polls the download job | `[[dlToken]]` | none |
| `pLFTfd` | `getDownloadUrl` (464) | Download URL | `[mediaKeyArray, null, authKey]` | none |

`yCLA7`, `dnv2s` and `pLFTfd` don't change library data, but they start or poll server-side export jobs.

### MUTATING RPCs

| rpcid | Function (line) | What it changes | Request data | Batched? |
|---|---|---|---|---|
| `XwAOJf` | `moveItemsToTrash` (235) | **Trash** | `[null, 1, dedupKeys, 3]` | operationSize 250 |
| `XwAOJf` | `restoreFromTrash` (247) | **Restore from trash** | `[null, 3, dedupKeys, 2]` | 250 |
| `ycV3Nd` | `removeItemsFromAlbum` (310) | **Remove from album** | `[albumItemMediaKeys]` | 250 |
| `OXvT9d` | `createAlbum` (322) | **Create album** | `[name, null, 2]` | |
| `E1Cajb` | `addItemsToAlbum` (334) | **Add to album** | `[mediaKeys, albumKey]` or `[mediaKeys, null, name]` | 250 |
| `laUYf` | `addItemsToSharedAlbum` (354) | **Add to shared album** | `[albumKey, [2, null, keys.map(k=>[[k]]), null, null, null, [1]]]` | 250 |
| `QD9nKf` | `setAlbumItemOrder` (374) | **Reorder album** | see source | 1 |
| `Ftfh0` | `setFavorite` (399) | **Favourite / unfavourite** | `[dedupKeys.map(k=>[null,k]), [1 or 2]]` | 250 |
| `w7TP3c` | `setArchive` (413) | **Archive / unarchive** | `[keys.map(k=>[null,[1 or 2],[null,k]]), null, 1]` | 250 |
| `StLnCe` | `moveToLockedFolder` (427) | **Move to locked folder** | `[dedupKeys, []]` | 100 |
| `Pp2Xxe` | `removeFromLockedFolder` (439) | **Move out of locked folder** | `[dedupKeys]` | 100 |
| `LjmOue` | `removeItemsFromSharedAlbum` (505) | **Remove from shared album** | `[[albumKey],[mediaKeys],[[...template]]]` | 250 |
| `V8RKJ` | `saveSharedMediaToLibrary` (521) | **Save shared-album items to library** | `[mediaKeys, null, albumKey]` | |
| `Es7fke` | `savePartnerSharedMediaToLibrary` (533) | **Save partner items** | `[keys.map(k=>[k])]` | |
| `EtUHOe` | `setItemGeoData` (564) / `deleteItemGeoData` (584) | **Set or clear location** | see source | |
| `DaSgWe` | `setItemsTimestamp` (597) | **Change date** | `[[dedupKey, tsSec, tzSec], ...]` | 250 |
| `AQNOFd` | `setItemDescription` (609) | **Change description** | `[null, description, dedupKey]` | 1 |

For a read-only vendor copy, delete every row in the MUTATING table. That means removing the 16 rpcids `XwAOJf`, `ycV3Nd`, `OXvT9d`, `E1Cajb`, `laUYf`, `QD9nKf`, `Ftfh0`, `w7TP3c`, `StLnCe`, `Pp2Xxe`, `LjmOue`, `V8RKJ`, `Es7fke`, `EtUHOe`, `DaSgWe` and `AQNOFd`, plus their `api-utils.ts` wrappers and the `actionHandlers` in `gptk-core.ts:31-57`. A good guard is an allow-list of rpcids inside `makeApiRequest`.

Mutations use **dedupKey** for trash, favourite, archive, locked folder, date, geo and description. Album add uses the library **mediaKey**. Album remove uses the **album-scoped mediaKey** (`api-utils.ts:216-225`).

## 3. Library enumeration

The whole library is listed by **`lcxiM`** (taken-date timeline) or **`EzkLib` with `[[4,'ra',0,0]]`** (upload-date order). Both use the same item parser.

**[CODE]** `src/api/parser.ts:36-59`:
```ts
function libraryItemParse(itemData: any): MediaItem {
  return {
    mediaKey: itemData?.[0],
    timestamp: itemData?.[2],             // taken, ms epoch
    timezoneOffset: itemData?.[4],        // ms
    creationTimestamp: itemData?.[5],     // uploaded, ms epoch
    dedupKey: itemData?.[3],
    thumb: itemData?.[1]?.[0],
    resWidth: itemData?.[1]?.[1],
    resHeight: itemData?.[1]?.[2],
    isPartialUpload: itemData[12]?.[0] === 20,
    isArchived: itemData?.[13],
    isFavorite: itemData?.at(-1)?.[163238866]?.[0],
    duration: itemData?.at(-1)?.[76647426]?.[0],         // present => video (ms)
    descriptionShort: itemData?.at(-1)?.[396644657]?.[0],
    isLivePhoto: itemData?.at(-1)?.[146008172] ? true : false,
    livePhotoDuration: itemData?.at(-1)?.[146008172]?.[1],
    isOwned: itemData[7]?.filter((subArray: any[]) => subArray.includes(27)).length === 0,
    geoLocation: { coordinates: itemData?.at(-1)?.[129168200]?.[1]?.[0],
                   name: itemData?.at(-1)?.[129168200]?.[1]?.[4]?.[0]?.[1]?.[0]?.[0] },
  };
}
```
Page wrappers:
- `lcxiM`, `:61-67`: `{items: data[0], nextPageId: data[1], lastItemTimestamp: parseInt(data[2])}`.
- `EzkLib`, `:69-74`: `{items: data[0], nextPageId: data[1]}`.

### Raw item layout **[FIXTURE]**
- `lcxiM` and `EzkLib` items are 16-element arrays. `[15]` is the extension object, which is what `at(-1)` reaches.
- In `lcxiM`, all 500 items carry key `163238866` (all `[false]`), and 28 carry `76647426` (video).
- In `EzkLib`, all 100 items carry `163238866` and `525000002`.
- `[1]` = `[thumbUrl, width, height, …]`
- `[6]` = `[actorId]` (uploader actor; present in `EzkLib` and album items, null in `lcxiM`)
- `[7]` = capability-flag list. `isOwned` is decided by whether `27` is in this list.
- `[13]` = isArchived boolean.

### Field-by-field answers
- **mediaKey / dedupKey:** both are present for every item.
  - dedupKey is usually 27 characters (letters, digits, `-`, `_`), rarely followed by `:` and 11 to 16 more. A user's library (October 2026) also had an item from 2012 whose dedupKey was 18 characters with others among them. The same item had a 17-field row, a 320×240 preview, a caption and video details (`76647426`) without a duration. Photo Cleaner reads any key without spaces, but the shared rules keep items with an unusual key out of the trash (`DedupKeys.kt`).
- **Timestamps:** taken (`[2]`), tz offset (`[4]`) and upload (`[5]`), all in ms.
- **isFavorite:** yes, at `ext[163238866][0]` (see §4).
- **isArchived:** yes, at `[13]`.
- **Video vs photo:** GPTK treats "has `duration`" as video (`filters.ts:119-121`). Live photos are flagged by key `146008172`.
- **Owned vs shared:** `isOwned` is false when flag 27 is present (`parser.ts:53`). PR #133 removed an earlier comment calling this "original uploader" because it "turned out to be untrue". So the exact meaning of flag 27 is **[LIVE]**. The likely meaning is a non-owned item that was saved from a shared album or partner **[INFERENCE]**.
- **Thumbnail / base URL:** `[1][0]` (see §8).
- **Dimensions:** `[1][1]` and `[1][2]`.

Not in the listing: file name, size and full description. Those need the batch RPC `EWgK9e` (§4). The deduper project uses `descriptionShort` as a stand-in for the file name.

### What the listing includes
- **Archived:** `lcxiM` with sourceCode 3 (the default when no archive filter is set) returns library **and** archive (`api.ts:121-124`, `gptk-core.ts:288-293`). For `EzkLib 'ra'` there is no archive switch, so whether it includes archived items is **[LIVE]**.
- **Trash:** not included. Trash is a separate RPC, `zy0IHe`, whose items have no favourite, archived or owned fields (`parser.ts:163-175`).
- **Locked folder:** not included. It is the separate RPC `nMFwOc` and needs `rapt` (`WIZ_global_data.Dbw5Ud`). That value only exists after the user unlocks the folder (`api.ts:57`, **[INFERENCE]** on when it appears).
- **Partner-shared items that were not saved:** listed separately via `e9T5je`. Whether partner items that were auto-saved show up in `lcxiM` is **[LIVE]**.

### Timeline paging loop **[CODE]** `gptk-core.ts:341-353`
With no date filter, GPTK loops `getItemsByTakenDate(lastItemTimestamp-1, source, nextPageId)` until `nextPageId` is empty. It sends **both** the page token and the timestamp cursor.

## 4. Favourites: bulk answer

**Bulk favourite status is available without per-item requests. There are two ways to get it.**

1. **The field in the library listing [CODE + FIXTURE].** Every `lcxiM` and `EzkLib` item carries `ext[163238866] = [bool]` (`parser.ts:48`).
   - In both fixtures the key is present on 100% of items, but every value is `false`. No fixture item is a favourite.
   - So the `true` encoding (probably `[true]`) is **[LIVE]**.
   - google-photos-deduper relies on this field (`isFavorite: item.isFavorite === true`, with an "unfavourited" fallback).
2. **A dedicated favourites listing [CODE].** `getFavoriteItems` calls `EzkLib` with `['Favorites', [[5,'8',0,9]], pageId]` (`api.ts:187-201`). It pages by token and uses the normal library item parser. It is wired as the "favorites" source (`gptk-core.ts:89-92`).
   - Of the two, this is the cleaner bulk route: listing the favourites gives you the set directly.
   - No fixture for this query exists. That it returns *only* favourites, and all of them including archived ones, is **[LIVE]**.

Other routes:
- **Per-item:** `VrseUb` `getItemInfo` returns `isFavorite` from `extObj[163238866][0]` (`parser.ts:317`). The fixture value is a boolean.
- **Batch item-info (`EWgK9e`):** accepts many keys per request. GPTK defaults to **5000** per request (`infoSize`), and issue #100 logs show "Processing 5000 items" chunks succeeding. However, its parser (`parser.ts:222-235`) returns **no favourite field**: only fileName, description, timestamps, size and quality/space. Whether the raw `EWgK9e` response holds a favourite flag in an unparsed slot is **[LIVE]**. In the fixture rows I saw no obvious one.
- **Album items (`snAcKc`):** these do not carry favourite status. `albumItemParse` (`parser.ts:147-161`) has no isFavorite, and the fixture ext object has keys `15|76647426|101428965|525000002` but not `163238866`.
- **Search:** there is no favourites search other than the `EzkLib 'Favorites'` call above.

**How GPTK itself decides favourites [CODE]:**
- `filters.ts:126-136`: `filter.favorite==='true'` keeps `item.isFavorite !== false`, and `'false'` keeps `!== true`.
- So items with `undefined`, such as album, trash or locked items, **pass both filters**. This is a leniency quirk; don't copy it.
- When the source is `favorites`, GPTK uses the `EzkLib 'Favorites'` listing.

## 5. Albums

### Listing: `Z5xsfc` `getAlbums`
- Request (`api.ts:275-290`): `[pageId, null, null, null, 1, null, null, 100, [2], 5]`.
- Pagination: page token `[1]`, looped by `getAllItems` (`api-utils.ts:114-136`).
- In the fixture, page 1 has 57 albums **and** a next-page token, even though pageSize is 100. So treat page size as a hint.
- Parser (`parser.ts:108-121`):
```ts
mediaKey: itemData?.[0],
ownerActorId: itemData?.[6]?.[0],
title: itemData?.at(-1)?.[72930366]?.[1],
thumb: itemData?.[1]?.[0],
itemCount: itemData?.at(-1)?.[72930366]?.[3],
creationTimestamp: ...[72930366]?.[2]?.[4],
modifiedTimestamp: ...[72930366]?.[2]?.[9],
timestampRange: [...[2]?.[5], ...[2]?.[6]],
isShared: itemData?.at(-1)?.[72930366]?.[4] ?? false,
authKey: itemData?.at(-1)?.[72930366]?.[5] ?? undefined,
```

### Does the listing include shared albums?
- **[ISSUE #42]:** with the old params, `getAlbums` "only fetches albums created by user". The reporter changed the request to the current `[..., 1, null, null, pageSize, [2], 5]`, after which shared albums they had uploaded to but **others created** appeared. The maintainer adopted the change in v2.5.4.
- So current params are *reported* to include joined (shared-with-me) albums. GPTK has **no separate shared-albums RPC**.
- **[FIXTURE]:** 57 albums: 53 have `72930366[0]=1` with isShared null, and 4 have `72930366[0]=4`, isShared true, and an authKey. All 57 have the same `[6][0]` owner actor, which is the same as the account's actor in the `snAcKc` fixture. So the fixture contains **only owned albums** (owned-but-shared included), and joined albums are not represented.
- **[INFERENCE]:** `72930366[0]` looks like an album-kind code (1 = regular, 4 = shared). GPTK doesn't parse it.
- Owner vs me: GPTK parses `ownerActorId` but never compares it with the user. It also never gets the user's own actorId from `WIZ_global_data`.
  - One route to "is it mine" is to compare `ownerActorId` with the actor seen on your own uploads, e.g. `EzkLib` item `[6][0]` **[INFERENCE]**.
  - Distinguishing owned-shared from joined is **[LIVE]**.
- The UI hides albums with `itemCount === 0` in multi-selects (`album-selects-update.ts:20`).

### Album members: `snAcKc` `getAlbumPage`
- Request (`api.ts:292-308`): `[albumMediaKey, pageId, null, authKey]`. authKey is optional for your own albums; GPTK never passes it when reading albums.
- Items are at `[1]`, the page token at `[2]` (`parser.ts:197-213`). About 300 per page (issue #100).
- Album metadata is at `[3]`: mediaKey, title, owner actor, start/end timestamps, `itemCount` `[3][21]`, `authKey` `[3][19]`, and members `[3][9]` (actors: actorId, gaiaId, name, profile photo).
- Per-item fields (`parser.ts:147-161`): mediaKey, thumb, width/height, timestamp, tz, creationTimestamp, dedupKey, live photo, duration. There is **no isFavorite, isArchived or isOwned**.
- The same RPC also lists **shared links**, using the `F2A0H` `linkId` in place of an album key (`api-utils.ts:146-148`).

### Album-item mediaKey vs library mediaKey
The **album item's mediaKey is a different, album-scoped id. dedupKey is the join key.**

- **[CODE]** `api-utils.ts:219-221`: "their album-scoped `mediaKey` (from getAlbumPage) is the key the removal RPCs expect — not the library dedupKey".
- **[CODE]** `parser.ts:296`: "extObj can be at position 9 or 15 depending on whether mediaKey comes from getAlbumPage or the library." PR #133 title text: "fix … for cases where `getAlbumPage`-reported `mediaKey` is used".
- **[CODE]** GPTK always joins album items to library items by **dedupKey**: `gptk-core.ts:257` (exclude albums) and `api-utils.ts:356-361` (preserve order).
- **[FIXTURE]** Strong evidence:
  - The album "ny" in `snAcKc` is a regular, **non-shared**, owned album (`72930366[0]=1`).
  - Its item with dedupKey `imBewp6j2BvAnSD_rs2XHwEKZc84` has mediaKey `AF1QipQSxjdsBTb9…`.
  - The same dedupKey in `lcxiM` has mediaKey `AF1Qip6Ar0-4cX-Y…`. The taken timestamps are identical (1761565830104).
  - The album item's `[5]` (1769777938628) differs from the library item's upload time (1761595306919). It may be the time the item was added to the album **[INFERENCE]**.
  - So the difference applies to **regular albums too**, not only shared ones.
  - Caveat: the fixtures are anonymised. Because the dedupKeys still match, consistent remapping of the mediaKeys is unlikely, but this is still **[LIVE]**-confirmable.
- For shared albums, it is **[LIVE]** whether the dedupKey of an item someone else added matches anything in your library. If you saved the item, it likely matches; if not, there is no library counterpart.
- `525000002` in the ext object of album items, and of `VrseUb` for an album-scoped key, holds the album key. PR #133 initially parsed it as "albums" and then removed it: "turned out to be not all albums but one, returned by getAlbumPage". In `EzkLib 'ra'` items, `525000002` holds other `AF1Qip` keys, 1–6 items per key, which may be upload-batch collections **[INFERENCE]**. **Do not use it as album membership.**
- Per-item album membership exists in `fDcn4b` `getItemInfoExt`: `albums: itemData[0][19].map(albumParse)` (`parser.ts:278`). It is one request per item and only works for library keys, so the per-album walk (`Z5xsfc` + `snAcKc`, joined by dedupKey) is the bulk route. GitHub issue #123 asked for exactly this kind of export.

## 6. Automatic collections (people, places, things, search)
- GPTK has **no RPC for people, places, things or other automatic collections**. Issue #104 ("Face / persons albums") is open and unanswered.
- Search results come only from the `EzkLib` free-text query and are never mixed into the album list.
- In `Z5xsfc` output, the only type signal is the unparsed `72930366[0]` (1 or 4 in the fixture). One fixture album is titled "location", but it is type 1 with 1186 items, so it is a user album.
- Whether `Z5xsfc` ever returns automatic collections, and with what type code, is **[LIVE]**. I'd guess it doesn't, since the request's `[2]` / `5` args likely select the user and shared album types **[INFERENCE]**.

## 7. Error handling
- `makeApiRequest` (`api.ts:27-28, 66-111`):
  - Up to **3 attempts**. The delay is `2000*attempt` ms (2 s, then 4 s), which is linear even though the comment says "exponential".
  - Each attempt throws on:
    - HTTP non-2xx,
    - an empty body,
    - no `wrb.fr` line,
    - `parsedData[0][2]` missing, which is what Google's error envelope looks like (**[INFERENCE]**: the payload is null, with an error code in a later slot).
  - After the last attempt it rethrows the last error.
- There is no 429 or `Retry-After` handling and no special session-expiry detection.
  - Tokens are read once at load, so a stale `at` or `f.sid` after long sessions just looks like repeated HTTP errors or a missing payload **[INFERENCE]**.
  - A signed-out page leaves `WIZ_global_data` without these keys, so the values are undefined.
- Concurrency (`api-utils.ts:64-112`): a pool of `maxConcurrent*ApiReq = 3`.
  - Errors in a chunk are **logged and swallowed**.
  - A null or non-array result is "skipping chunk", so a run can report "Task completed" with missing work (issue #100).
- Pagination (`api-utils.ts:114-136`): on a page error it logs and **stops**, returning the partial list.
  - The timeline loop (`gptk-core.ts:345-352`) also ends early on a null page.
  - Either way you get **silent truncation**. For an inventory tool, treat any pagination error as fatal, or as resumable from the last token.
- Known failure modes from issues:
  - Bulk mutations fail with null results at large batch sizes or concurrency (#53, #54, #74, #100). The maintainer's advice is to lower the batch size, because "sometimes GP bugs out".
  - `"undefined" is not valid JSON` came from the old envelope handling (#74, #85, #96, #105, #110). Now fixed with validation.
  - Deduper notes that Google's pagination "occasionally hangs without ever rejecting fetch()", so it adds a 60 s per-page timeout.
  - Deduper also saw **HTTP 504** on large mutation batches.
  - Issue #125 (open): it stalls past about 250k items.
- Thumbnail fetch (`filters.ts:359-391`): 3 retries with backoff of 1 s × attempt and a 10 s timeout. A comment at `:425` says "Expired or missing thumbs cause HTTP 400 errors".

## 8. Thumbnail / preview URLs
- The URL comes from `item[1][0]`.
- In fixtures it is anonymised as `https://photos.fife.usercontent.google.com/pw/ANON_n`.
- A real example, from issue #32: `https://photos.fife.usercontent.google.com/pw/AP1GczO…=w286-h215-no?authuser=0`.
- Video items' ext also contains `https://lh3.googleusercontent.com/...` URLs (`VrseUb` fixture, key `76647426`).
- **Sizing [CODE]:** append the size suffix to the bare base URL. `filters.ts:366` uses `item.thumb + '=h' + imageHeight`. The parser note at `parser.ts:30-34` reads: "Add =w417-h174-k-no?authuser=0 to thumbnail URL to set custom size, remove 'video' watermark, remove auth requirement."
- **Cookies:** GPTK always fetches thumbnails with `credentials: 'include'` and `cache: 'force-cache'` (`filters.ts:368-372`).
  - The "remove auth requirement" claim about `-k-no?authuser=0` is unverified **[LIVE]**.
  - In an extension, an `<img>` on a non-Photos origin may not send the third-party cookies **[LIVE]**.
- **Expiry:** the URLs expire. GPTK's comment says expired thumbs return HTTP 400 (`filters.ts:425`). The lifetime is not stated anywhere **[LIVE]**. Don't persist them as permanent links. Re-fetch from a listing, or store the mediaKey and product URL (`https://photos.google.com[/u/N]/photo/<mediaKey>`, as deduper does).

## 9. Issues and recent changes worth knowing
| Issue | Status | Relevance |
|---|---|---|
| #42 | closed | `getAlbums` missed albums created by others. The params were changed to the current ones (v2.5.4). |
| #53, #54 | closed | Favourite setting (mutation) fails at large batches; the problem is on Google's side. |
| #74, #96, #105, #110, #85 | closed | Envelope or JSON parse errors and rate-limit-like failures. Retry and validation were added. |
| #100, #109 | closed | Adding to albums fails at batch sizes of 1000+. Lowering batch size and concurrency helps. |
| #123 | closed, unanswered | Feature request to export album membership. Not implemented. |
| #104 | open | Request for people albums. Not supported. |
| #125 | open | Stalls beyond about 250k items. |
| #32 | open | RAW+JPG stacks. There is an unknown RPC `wgZjtc` for stack contents that GPTK doesn't use. |
| #146 | open | Request for a "multiple albums" filter. |

Recent commits:
- PR #133 (2026-06) added `authKey` parsing and fixed `VrseUb` for album-scoped keys.
- PR #137 (2026-08) added Remove from Album, plus routing for shared albums.

I found no issue reporting a broken read RPC as of v3.3.0.

## 10. Licence
- File: `LICENSE` (repo root). This is the MIT License, and `package.json:33` also declares `"license": "MIT"`.
- Copyright line, exact: `Copyright (c) 2024 xob0t`.
- When vendoring, keep the full MIT notice with the copied files.

## 11. google-photos-deduper (mtalcott)
- It is a Plasmo Chrome MV3 extension that **vendors GPTK as a git submodule** (`.gitmodules`). The latest push was 2026-10-07.
- `contents/google-photos-inject.ts` injects 3 MAIN-world `<script>` files at `document_idle`:
  1. `unsafewindow-shim.js` (`window.unsafeWindow = window`),
  2. the built GPTK userscript,
  3. a postMessage command handler.
- A bridge content script relays results to the extension and chunks them into 10k-item messages, because of Chrome's 64 MiB message cap.
- It enumerates only through `gptkApi.getItemsByUploadedDate` (`EzkLib 'ra'`) and keeps `isFavorite` from the listing field (normalised to `=== true`) to prefer keeping favourites.
- It does **not** read album membership. Its only mutations are trash and restore, called directly on `gptkApiUtils.api` because `executeWithConcurrency` checks `isProcessRunning`.

## 12. Unknowns that need a live account
1. The encoding of `ext[163238866]` for a favourite in `lcxiM`/`EzkLib` (assumed `[true]`). Also whether it is present on every item type, e.g. partner-saved or shared items.
2. Whether `EzkLib ['Favorites', [[5,'8',0,9]]]` returns exactly the favourites set, including archived and videos, and its page size.
3. Whether `Z5xsfc` with the current params returns joined (shared-with-me) albums. Also how to tell owned-shared from joined: `ownerActorId` compared with your actor, and the meaning of `72930366[0]`.
4. Whether album-item mediaKeys always differ from library mediaKeys, and whether dedupKey always matches for your own items. Also the behaviour for shared-album items contributed by others that you haven't saved.
5. Whether `EzkLib 'ra'` includes archived items, and whether `lcxiM` sourceCode 3 includes items saved from shared albums or partner.
6. Thumbnail URL lifetime and the cookie requirement from an extension page.
7. Server-side rate limits and what an expired-session response looks like (HTTP status vs an error envelope).
8. Whether `EWgK9e` has an unparsed favourite or archive slot (if so, it would be a 5000-per-request route).
