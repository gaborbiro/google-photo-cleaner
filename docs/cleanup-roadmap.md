# Beyond duplicates: clean-up roadmap

How Photo Cleaner grows from finding duplicates to clearing the rest of an old library's clutter.
Started 2026-10-19 (extension 0.4.13). The main `docs/roadmap.md` points here.

Legend: `[x]` done · `[ ]` to do · `[~]` in progress

## Why

Duplicates only find copies. Most of an old library's clutter is something else:

- the same **kind** of photo repeated over years (receipts, screenshots, parking spots, whiteboards)
- **failed shots** (pocket shots, black frames, heavy blur)
- **too many near-identical shots** of one moment (14 of the same sunset, 30 of the candles)
- **subjects one person photographs a lot** that nobody else would (meal-prep boxes, car parts)
- **big videos** nobody watches

The AI model already describes every photo (its fingerprint), and the scan already knows dates,
quality, favourites and albums. Each milestone below turns some of that into suggestions the user
reviews in the screens they already know: Search & sweep, or Duplicates.

### What the AI model can and can't do

EmbeddingGemma 2 puts photos and text in the same "meaning space". It can:

- compare a photo with a description ("a receipt") — how Search works
- compare photos with each other — how Duplicates and "More like these" work
- group the whole library into themes nobody had to name
- learn a direction from examples — "Less like these" does a simple version

It can't write captions, reliably read the text in a photo, recognise particular people, or explain
itself. That would need a second, generative model (see Later).

## Rules for every milestone

- **Safety first, as everywhere** (`AGENTS.md`): a suggestion only proposes; the user approves every
  photo. Everything goes through the protection rules and the trash queue, with the fresh check
  before acting.
- Counts include only photos that may be trashed: never protected or unknown ones, and none already
  in the trash queue. The number on a suggestion is exactly the number of photos it opens with.
- Kinds of photo people keep (people, children, celebrations, pets, holidays) are never suggested
  for the trash, only for thinning (milestone 3).
- Size is not clutter: a big group of similar photos may be memories (2,000 birthday photos).
- **Experiment first**: each milestone starts on a developer page (`dev-*.html`, not shipped), judged
  on my library and one other, before it goes into the product.
- Grouping and protection rules live in the shared Kotlin (`features/shared/*`); ranking and search
  arithmetic may stay TypeScript, like Search.

## Milestones at a glance

| # | Milestone | What the user gets | Where it shows | State |
|---|---|---|---|---|
| 1 | Kinds of clutter | "Receipts · 340", "Parking spots · 480" | Search: suggestion chips | `[~]` developer page built |
| 2 | Failed shots | "Accidental shots · 210" | Search: a suggestion like 1 | `[ ]` |
| 3 | Thinning events | "Keep the best 2 of these 14" | Duplicates: "Similar shots" | `[ ]` |
| 4 | Recurring subjects | "1,200 photos like these" | Search: suggestions, or a library map | `[ ]` |
| 5 | Big videos | "Videos over 1 minute · 3.2 GB" | Search or its own list | `[ ]` to check first |
| 6 | Learning from decisions | "Photos you'd probably trash" | Search: a ranking | later |

Order: 1 → 2 (small, reuses 1) → 3 → 4. 5 can slot in anywhere once checked. 6 needs real usage first.

---

## 1. Kinds of clutter `[~]`

A shipped list of kinds of clutter, counted in the user's library, offered as suggested searches.

### How it works (built)

- `extension/src/app/search/clutter.ts`: the categories and the counting; tests in
  `extension/test/app/clutter.test.ts`.
- 16 **clutter** categories (screenshots, photos of screens, receipts, documents, whiteboards, notes,
  parking, signs, menus, tickets, products, barcodes and QR codes, meter readings, things to fix or
  sell, memes, accidental shots), each described in several ways.
- 8 **counterweights** (people, children, celebrations, pets, nature, travel, ordinary scenes,
  old photos and keepsakes): never shown, they only compete, taking photos away from clutter.
- Each photo goes to its **one best category** (a category scores as its best description) and counts
  only when that score is at least the **minimum score** and at least the **minimum lead** above the
  next category. Counts never overlap; a family photo in a car park goes to "people", not "parking".
- **Raw or evened-out scores**, switchable on the developer page. Some descriptions score higher than
  others on every photo, so raw scores favour them. Evened out, a photo scores as how far above a
  description's average over the whole library it is, counted in that description's usual spread
  (standard deviation): 0 is average, 2 is far above it. Each scoring keeps its own settings.
- **Lead over the next category or over the other kind**, switchable on the developer page. Over the
  other kind, clutter's lead is measured against the best counterweight (and a counterweight's against
  the best clutter), so a photo close between two kinds of clutter (a receipt or a document?) still
  counts: it is clutter either way. The other kind never scores above the next category, so with the
  same minimum lead this only adds photos.
- Totals per kind (clutter, counterweights, close calls) and **what evening out moves**: the photos
  counted as counterweights with raw scores and as clutter evened out, each scoring with its own
  settings, with a sample of 60 in a new tab captioned with both categories.
- **The photos nothing matches well**: the 60 lowest best raw scores, in a new tab, to find what the
  list of descriptions is missing. Photos in every grid are numbered and open large and uncropped;
  captions name the description each photo scored as.
- Developer page `dev-clutter.html` (`extension/src/app/dev/clutter.tsx`): counts per category with
  adjustable settings; per category, 12 photos each: strongest, weakest still counted, **just counted**
  (smallest leads that made it) and **just missed** (close calls with the largest leads), each captioned
  with its score and lead; **Open all in a new tab** shows every counted photo; protected, queued and
  close-call counts; "Counterweights" shows where their photos went. A collapsible list shows every
  category and its descriptions; hovering over a photo shows how it scored: its best categories, each
  with the description it scored as, and its lead over the runner-up.

### Findings so far

- 2026-10-19, first test on my library: a good start. *(Add notes: which categories are right, which
  are noise, what clutter is missed, which settings looked best.)*
- A selfie in a supermarket went to Products (0.732, "a supermarket aisle") ahead of People (0.649,
  "a selfie"). A photo's fingerprint is the whole picture, and shelves fill most of it. Descriptions of
  places (an aisle, a car park) pull in people photos taken there; descriptions of objects (a price tag,
  a receipt) are safer.
- 2026-10-20, raw against evened-out scores, both with the lead over the next category and settings
  leaving 12% close calls (raw minimum lead 0.0042, evened 0.117): raw counts 3,990 as clutter and
  10,219 as counterweights; evened out 5,311 and 8,883. Evening out moves about 1,300 photos from
  counterweights to clutter: it boosts rare, distinctive descriptions (price tags at 5–6 spreads) and
  dilutes common ones (a selfie in a supermarket: Products 5.4 against People 1.7). Its top matches look
  as good or better (Celebrations: 29 of the top 36 right, against 20 raw). Whether the moved photos are
  clutter decides it: "Open a sample of what evening out moves" on the developer page shows 60 of them.
- 2026-10-20, the first 16 of a sample of what evening out moves into clutter (minimum leads 0.02 raw,
  0.2 evened out): 4 right (screenshots, memes), 10 wrong, 2 unclear. Most wrong ones were travel photos
  (selfies on trains and planes, views from windows, a meal on a plane) going to Tickets and passes: Travel
  and nature only described scenery, so "a boarding pass" and "a train ticket" were the nearest
  descriptions to being on the move. Travel and nature got descriptions of trains, planes, airports and hotel
  rooms; Tickets now describes the ticket itself. Evening out stays for now, to see whether what is usual
  for a user can be of use; raw scores are the default. Raw scores miss memes and forwarded images that
  evening out catches: their descriptions may need work.
- Travel and nature split in two: Nature (scenery) and Travel (landmarks, trains, planes, airports, hotel
  rooms). "A city view" moved to Ordinary scenes: a room with the city through its window went to
  Travel and nature, raw, on "a city view" alone.
- 2026-10-20, the whole sample of what evening out moves: most moved photos are ones to keep, and the new
  category is often far off (a selfie to dashboard warning lights, a street to parking, a dining room to
  things to sell). The exceptions are spot on: memes, forwarded images, screenshots, pictures not taken
  by the user. Evening out answers "what is surprising about this photo, for this library", per
  description, which is right for kinds of image unlike camera photos (memes, screenshots, maybe codes
  and documents) and wrong for subjects (parking, products, furniture). Decided: raw scores; evening out
  stays on the developer page as a measuring stick (the photos it moves into Memes are roughly the memes
  raw scores miss).
- Raw scores miss memes because a fingerprint is mostly what a picture shows (a meme of a couple goes to
  People), so Memes got descriptions of what memes look like (a cartoon image with a caption, text
  written over a picture...). An ice cream in hand matched nothing (best: "a city view", 0.651): Ordinary
  scenes got food (an ice cream cone, a dessert, street food, a snack). Incidental words ("held in a
  hand", "on a table") match every photo with a hand or a table, so they were taken out.
- If evening out is ever tried for memes or screenshots, the cases where it would fail: memes are common
  (heavy WhatsApp or Telegram users, older relatives receiving greeting images, teenagers), where it
  stops helping; and kept pictures that are not camera photos (own drawings and digital art,
  invitations, cards, collages, photos with stickers or text added, unusual photography), which it
  would flag. Safeguards: it may only add photos to those categories when very sure, never decide;
  switch it off when raw scores already find many memes; a minimum library size; counterweights for
  personal pictures that are not camera photos; judge it on a library unlike mine.
- Decided: no counterweights that mix people and places ("a selfie in a shop"); the list shouldn't try to
  cover every case. Later, the user protects what the suggestions get wrong with their own tool: e.g.
  search "selfies", put them in an album (protected), dissolve it later. Album edits are a new write,
  which `AGENTS.md` allows only when asked for, so that is its own change.

### Judge and tune (developer page)

- [ ] Go through every suggestion at a few settings; check its weakest counted photos (where mistakes
      show)
- [ ] Check "Counterweights": people and holiday photos there, not in clutter; note clutter found there
- [ ] Compare the lead over the next category with the lead over the other kind: are the photos it
      adds real clutter? Keep the better one, and drop the switch
- [ ] Several counterweights close behind one clutter category (People, Children and Celebrations all
      just under Products): count how often it happens before deciding whether it needs a rule
- [ ] Compare raw and evened-out scores: does evening out move photos like the supermarket selfie to
      People without losing real clutter? Keep the better one, and drop the switch
- [ ] Refine the list: reword or split noisy categories, drop useless ones (descriptions of places
      first), add missing kinds and counterweights where needed
- [ ] Choose the default minimum score and lead (the lowest setting where the weakest counted photos
      are still right); per-category settings only if one setting can't serve all
- [ ] If judging by eye isn't enough: a labelling mode to measure precision per category, as
      `dev-calibration.html` does for duplicates
- [ ] Try one other library
- [ ] Note how long describing the categories and matching take on a big library

### In the product

- [ ] Work suggestions out at the end of the Scan's "Analyse photos" step (the background page has the
      AI model loaded), and again after each new scan
- [ ] Save about 20 per account: a new store, so `DB_VERSION` up once and `test/app/db.test.ts`
      updated. Or, with no database change, work them out when Search opens if that's fast enough
- [ ] Chips in Search: "Parking spots · 480"; a chip opens exactly those photos, best match first;
      More / Less like these as usual
- [ ] Search marks where a suggestion's photos end (Search only ranks today; it has no cut-off)
- [ ] Texts from the model (`search/searchModel.ts`); `test/app/screens.test.tsx` covers chips;
      manual checks in `docs/extension-manual-checks.md`

Done when: suggestions on two libraries I'd act on, then chips in Search after every scan.

## 2. Failed shots `[ ]`

Pocket shots, black frames, heavy blur, floors and ceilings.

- The scan already stores quality numbers per photo (`ai/quality.ts`: sharpness, brightness, share of
  very dark and very bright pixels); today only the duplicate keeper choice uses them.
- [ ] On the developer page: a suggestion combining the numbers (very dark, very blurry) with
      milestone 1's "Accidental shots" category. The AI alone confuses moody or night photos; the
      numbers alone flag artistic blur. Together they should agree on real failures
- [ ] Counterweights still win: a dark photo of people isn't a failed shot
- [ ] In the product: one more suggestion chip, same mechanism as 1

## 3. Thinning events `[ ]`

Not about kinds of photo, so people are fine here: only the extra copies of one moment go.

- [ ] Split the timeline into **events**: a new event starts after a gap of a few hours with no photos
- [ ] Within an event, find **runs**: consecutive photos that are very alike, but below the duplicate
      threshold (start around 0.85 and tune)
- [ ] Suggest keeping the best 1–2 of each run (the existing keeper choice: sharpness, exposure) and
      trashing the rest. The user picks; nothing pre-selected
- [ ] Rules in Kotlin (`features/shared/duplicates`), next to duplicate grouping, tested in `commonTest`
- [ ] Developer page first: events and runs, with what would be kept and trashed
- [ ] In the product: "Similar shots" in Duplicates, which reviews the same way

## 4. Recurring subjects `[ ]`

What this user photographs a lot. The most uncertain milestone: do groups found by the AI make sense
to people?

- [ ] Group all fingerprints into about 100–200 groups (k-means on a sample of a few thousand photos,
      then every photo to its nearest group); measure the time
- [ ] Score each group for how likely it is clutter:
  - few favourites or album photos (the user's own keep signals, the strongest sign)
  - spread over many months: recurring, not one event
  - very alike photos
  - close to milestone 1's clutter descriptions rather than people, children or celebrations
  - many poor-quality photos (milestone 2's numbers)
- [ ] Name a group from the description list or a larger list of everyday phrases when one fits;
      otherwise "1,200 photos like these" with 4 thumbnails
- [ ] A group opens Search with its 5 most typical photos as "More like these"
- [ ] Shown as "things you photograph often", never labelled clutter; groups of people, children or
      celebrations never offered for the trash (thinning at most)
- [ ] Possibly a "library map": every group with counts, as an overview of what's in the library

## 5. Big videos `[ ]`

Probably the biggest storage win per item reviewed, and needs no AI.

- [ ] Check first: does the scan's answer from Google include a video's file size or length? (The scan
      records the media type, not size)
- [ ] If yes: suggestions like "Videos over 1 minute · 3.2 GB" and "Very short videos (likely
      accidental) · 140"
- [ ] Videos aren't analysed by the AI today; review would need a thumbnail and a link to play it in
      Google Photos

## 6. Learning from the user's decisions `later`

The one that would feel like the app knows you, and the riskiest for memories.

- Train a small model in the browser on the user's own decisions: what they trashed counts as
  "doesn't keep", favourites and album photos as "keeps". Rank everything else by "you'd probably
  trash this".
- Could feed on quick keep/trash swipes through a suggestion, getting better as you go.
- Needs enough decisions first, so only after milestones 1–4 have real users.
- Ranking for review only, never "select all".

## Later, not planned

- A second, **generative AI model** (captions, reading the text in a photo): 1–3 GB and seconds per
  photo, so only for small shortlists, e.g. explaining a suggestion. Not worth it now.

## How we learn

There is no telemetry, by choice. Evidence comes from my own library, one or two other libraries, and
early testers ("which suggestions did you use, how many photos did you sweep"). If counts from users
are ever wanted, they would be opt-in, and the privacy policy would say so.

## Also open from the same conversation

- [x] Popup: every state without an account except "no tab" (tab not responding, signed out, tab
  asleep) was a line of text with no button; "Looking for Google Photos…" was seen staying up once.
  Done (0.4.25): the account check has a time limit of 5 s and asks every open Photos tab, not only the
  first; the popup shows **Open Google Photos** with the reason in every state without an account, and
  a failure inside the extension says why instead of reading as "no account". "Looking…" itself has no
  button: it now ends within seconds, and a button there would flash up each time the popup opens.
