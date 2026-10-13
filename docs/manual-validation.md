# Manual validation (needs the live account)

Automated tests use synthetic fixtures only. These checks confirm the classification against the real Google Photos account.

## Before you start

- Photo Cleaner is running and shows **Extension connected**.
- photos.google.com is open in the same Chrome profile, signed in to the account being cleaned (only one Photos tab).

## 1. Run the inventory

1. **Inventory** tab → **Start scan**. Leave it running; it pages through the library, favourites, the album list and every album.
2. Try **Pause**, then **Resume scan**. It should continue from where it stopped, not from the start.
3. Optional: close the app mid-scan, start it again, **Resume scan**. Same expectation.
4. When finished, the report should say **Protection coverage complete**. If it says incomplete, the listed album issues explain why; no photo is eligible in that state.

Record: photos enumerated, protected, eligible, unknown (with reasons), videos, and scan duration.

## 2. Check three known photos

Pick these in Google Photos first and note their dates:

| Photo | Expected | How to check |
|---|---|---|
| A favourite (star) that is in no album | Protected, reason *favourite* | It must not appear in the sample; the Photos count of favourites should match the report's *favourite* row (videos are counted in the video table) |
| A photo that is in an album (yours or a joined shared album) but not a favourite | Protected, reason *in an album* | It must not appear in the sample |
| A loose photo: not a favourite, in no album, not archived, uploaded by you | Eligible | See below |

For the eligible check: **Sample** tab → **Load sample** shows 48 evenly spread eligible photos. Click a few previews: each opens in Google Photos, where it should show no star, and the photo's info panel should list no albums.

## 3. Spot-check the sample

For 5–10 sample previews, open them in Google Photos (click the tile) and confirm for each:
- not a favourite
- the info panel lists no albums
- not archived

Any sample photo that fails one of these is a classification bug. Note its date and stop.

## 4. Watch for

- **Unknown, not uploaded by you:** photos saved from shared albums or partner sharing that could not be matched to an album. Expected to be few.
- **Album issues:** any album that "could not be read" or has a "count mismatch" makes coverage incomplete. Note the album and the detail line.
- **Preview throughput** shown under the sample.

## What remains unverified after this

- Restoring trashed items (no mutations exist yet).
- Behaviour with several Google accounts signed in to Chrome (`/u/1/` URLs): sample links open the default account.
- Locked Folder items are not listed by the library RPC and are therefore never candidates; not separately verified.
