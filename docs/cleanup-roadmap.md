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
  for the trash, only for thinning (milestone 3). What counts as clutter, photo by photo, and the
  measures a list is held to: [clutter-rules.md](clutter-rules.md).
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
- 15 **clutter** categories (screen photos: screenshots and photos of screens as one since 2026-11-18; receipts, documents, whiteboards, notes,
  parking, signs, menus, tickets, products, barcodes and QR codes, meter readings, things to fix or
  sell, memes, accidental shots), each described in several ways.
- 9 **counterweights** (people, children, celebrations, pets, nature, travel, adventures and sights (since 2026-11-18: outdoor, water and sky adventures, landmarks, ruins), ordinary scenes,
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
- 2026-11-13, going through the categories one by one on my library (about 17,000 photos), raw scores,
  minimum score 0.
- **Products and shopping**: very good. With the lead over the next category at 0.02, the counted photos
  are right, and so are almost all of "just missed": on hover their runners-up are other clutter
  categories, the case the lead over the other kind counts. Two close calls were rightly left out
  (a drink, Ordinary scenes close behind; a gym ball in its packaging, "a sports game"). 0.018 adds
  about 100 photos, still right. Switched to the **lead over the other kind**:
  - 0.02: 840 photos (about 200 more), still right; most of "just missed" could go too.
  - 0.01: 917, about 5 wrong (selfies in or in front of a shop). The rest are products on shelves or in
    baskets and other objects (things packed for a move): none worth keeping.
  - 0.008: 934, only 17 more: few photos are nearly tied between clutter and a counterweight. Checked
    all of them: 16 I'd keep, mostly with a face in them. Rightly left out: my nephew with a screwdriver
    and bottles of Fanta and Coke, two photos of people in IKEA.
  - Faces lose too easily: People may need to be a stronger counterweight, or a face check that
    doesn't depend on describing the scene. This pulls against the decision above (no counterweights
    mixing people and places); to decide after going through all categories.
- **Screenshots**: the model spots screens remarkably well, even the back of a phone or a screen turned
  away, and that is the problem: a photo with a phone in it counts. "Strongest" is right; "just
  missed" is mostly right to leave out (faces, a view from a plane window that looks like a map, a
  photo of my skin), though about half of a sample of 10 were real screenshots. "Just counted" and
  "weakest still counted" catch people holding phones (a man sunbathing with a phone, its screen not
  visible), matched by "a screenshot of a phone screen".
  - Lead over the other kind at 0.02: 314 photos, right except 3 at the end (people with a phone in
    hand). At 0.01: 353, with about 14 wrong at the end (a credit card, faces, driving a boat past its
    digital display, a gym selfie with People close behind). 0.01 is too loose here.
  - A real screenshot can score high for People too: a screenshot of someone's Instagram selfie (with
    Instagram's buttons) scored 0.691 as a screenshot and 0.679 as People. A stronger People counterweight
    would lose it.
  - Rethink: phone screenshots are already in Google Photos' own Screenshots folder, so Photo Cleaner
    needn't suggest them (discussed in an earlier conversation, not recorded). Where it can add something:
    photos of screens (a monitor, a smartwatch) and screenshots that aren't from this phone (from a
    desktop, forwarded).
- **Things to fix or sell**: useful but mixed; kept in the list. At minimum lead 0.01, about 390 photos;
  at 0.02, about 290 and a bit better.
  - Right: broken things, furniture for sale, evidence of damage (a rental flat): I take a lot of
    evidence photos and don't want to keep them.
  - Wrong, or memories: a friend washing a shoe in a bidet ("a leaking pipe"); photos of a van I wrecked,
    taken as evidence for the police (broken, but a record to keep); many museum pieces and old buildings.
    A museum warship's engine went in on "a leaking pipe" (0.647), 0.018 ahead of Old photos and
    keepsakes ("an old printed photo", 0.629), then Labels and codes ("an appliance model plate"),
    Meters, Travel ("inside a train"), Ordinary scenes. The category treats old, worn or broken as
    clutter, but people photograph ruins, history and beauty in imperfection on purpose.
  - Rightly left out ("just missed"): a run-down staircase in a converted factory with light art (a
    rave), a castle ruin (Nature close behind), a run-down flat I viewed to buy (Ordinary scenes, "a
    room in a house"), me in medieval armour (People, "a portrait of a person").
  - Many IKEA photos: check the overlap with Products and shopping, which may suit things for sale
    better (though that one is more about buying than selling).
  - Judging it took care: I'd want to look at every photo before trashing. The question for this
    category is whether it's consistent enough to be useful.
- **Signs and timetables**: needs a tighter lead, 0.03 or 0.04.
  - 0.02: 258 photos. The strongest are right and the first ~108 are good, but quality drops over the
    last ~30. "Weakest still counted" and "just counted" are poor: only 2 or 3 of 10 are photos of a
    sign (a no-laptops sign in a café). The rest are city life (people getting on a bus), a friend
    reading a newspaper, a protest with placards, a carved old door, a cannabis shop's neon signs,
    labelled museum pieces, a forwarded screenshot of police outside 10 Downing Street, and me next to a
    poisonous snakes sign in Australia (a memory).
  - The Sistine Chapel (angels holding banners with text) counted on Signs at 0.647, with Memes, Notes and
    Documents behind it and Ordinary scenes at 0.623. A near-identical photo of it was "just missed",
    because "art in a museum" scored 0.629 there: two almost identical photos, opposite results.
  - Rightly left out: people photos, shop windows, an ordinary building, a digital sign saying "Doge"
    (Pets and animals).
  - 0.03: 206 photos. "Just counted" is all right, "weakest still counted" a bit better, and the snake
    photo appears once. 0.04: 155, and the snake photo is still there.
- **Photos of screens**: clean, one of the best so far.
  - 0.02: 220 photos, every one with a screen in it (monitors, a smartwatch, people working on laptops,
    TV shows I photographed). Unlike Screenshots, no photos that just have a phone in someone's hand and
    no selfies: its descriptions ("a photo of a computer screen", "a photo of a TV screen") are narrower.
  - 0.01: 273, still good, but too many people photos towards the end.
  - Photos to keep (children or family by a computer), with what scored close behind:
    - #3: Children ("a child playing") 0.670 behind 0.715; lead 0.045.
    - #74: Children 0.646 behind 0.686; lead 0.040.
    - #87: People ("friends together") 0.625 and Children 0.623 behind 0.682; lead 0.058.
    - #115: Ordinary scenes and Children both 0.657 behind 0.678; lead 0.020.
    - #145: a girl in glasses: People 0.642 and Children 0.641 behind 0.672; lead 0.031.
    - #166: Ordinary scenes 0.638, People ("a family photo") 0.626 and Children 0.623 behind 0.669;
      lead 0.030.
    - #184: a selfie: People 0.614 behind 0.662; lead 0.048.
  - Photos to trash that also show people (actors on a TV, a video call), with People behind:
    - #199: People 0.614 (fifth); lead 0.029.
    - #205: People 0.617; lead 0.033.
    - #217: People ("a couple together") 0.620; lead 0.023.
    - #63: People 0.638; lead 0.043.
  - Their leads overlap (0.020–0.058 for the ones to keep, 0.023–0.043 for the ones to trash), so no
    minimum lead separates them. What differs: in the ones to keep, Children scores high or several
    people counterweights (People, Children, Celebrations) cluster just behind; in the ones to trash,
    People comes alone and lower (#184, a selfie at 0.614, is the exception).
- **Accidental shots** (2026-11-18): the strongest are right, the weakest still counted are bad.
  - Wrong, weakest still counted:
    - A dear memory, a diver underwater, on "a finger covering the camera lens" (0.638). Nature
      ("a lake") 0.610, People ("a selfie") 0.606 and Pets ("an animal in nature") 0.600 all close
      behind.
    - Two photos of an art exhibition on "a photo of the floor": 0.637 with Ordinary scenes, People and
      Travel at 0.608–0.614; 0.642 with People 0.618 and Children 0.615.
  - "Just counted" is mostly all right; two wrong:
    - A church interior panorama, "a photo of the floor" 0.665: Travel ("a famous landmark") 0.645,
      People and Ordinary scenes ("art in a museum") 0.636, Old photos 0.626.
    - A palace's painted ceiling, "a photo of a ceiling" 0.688: Ordinary scenes ("art in a museum")
      0.666, People 0.647, Travel 0.627, Old photos 0.622.
  - Rightly left out ("just missed"): a slab on a wooden floor (0.710, Ordinary scenes 0.690); a hotel
    lobby with people (0.664, People 0.645, Travel 0.640, Ordinary scenes 0.637); a cloister corridor
    (0.665, Old photos 0.646, Travel 0.639, Ordinary scenes 0.638).
  - "A photo of the floor" and "a photo of a ceiling" match architecture and interiors.
- Across categories so far:
  - Narrow descriptions that fit this model give cleaner sets, even if smaller (Photos of screens and
    Products against Signs, Things to fix or sell and Screenshots). Consider rewriting the noisy ones
    narrower.
  - Not every category has to be good: put the reliable ones first in Search and the looser ones
    lower. Users learn which ones suit how they take photos.
  - **People, children, friends and family must weigh much more as counterweights**, especially when
    several of them cluster just behind the top clutter category. Seen in Products, Screenshots and
    Photos of screens. A problem to tackle.

### Judge and tune (developer page)

- [ ] Go through every suggestion at a few settings; check its weakest counted photos (where mistakes
      show)
- [ ] Check "Counterweights": people and holiday photos there, not in clutter; note clutter found there
- [ ] Compare the lead over the next category with the lead over the other kind: are the photos it
      adds real clutter? Keep the better one, and drop the switch
- [x] Several counterweights close behind one clutter category (People, Children and Celebrations all
      just under Products): it happens in most wrong photos (Products, Screenshots, Photos of screens,
      Accidental shots). Decided 2026-11-18: pool them, below
- [x] **Pooling** (decided 2026-11-18; built in 0.5.21): the lead is pooled clutter minus pooled counterweights, each
      kind pooled as `best + T × ln(Σ exp((score − best) / T))`. Each category's vote is
      `exp(−gap/T)`: 1 when level with the best, 0.37 at T behind, near 0 at 3T behind. A lone category
      adds nothing, 2 tied add T·ln 2, and 3 tied add T·ln 3. A slider for T, starting at 0.02. Worked
      by hand from the hover cards at T = 0.02: all 5 wrong Accidental shots are left out, and 3 of the 7
      wrong Photos of screens. 2 of 4 TV photos to trash are lost, the safe direction
- [x] **Counterweights only** (decided 2026-11-18; built in 0.5.22): with clutter pooled too, Screenshots
      at default settings (319 photos) let in six selfies and people with phones at the bottom (#310–#318,
      leads 0.020–0.028). Each matched four or five kinds of clutter around 0.60–0.61, which pooled
      lifted clutter by up to 0.03; against its best clutter alone, every one led by 0.004 or less, or
      trailed. A photo vaguely like many kinds of clutter is one nothing describes well, not sure clutter.
      Now the lead is the best clutter minus the counterweights pooled (and, over the next category, the
      higher of the best other clutter and the other counterweights pooled)
- [x] **Pool the best 3 of each kind** (decided 2026-11-18, built in 0.5.25): clutter is pooled again,
      like counterweights, its best 3 only. Several kinds of clutter close together (a receipt, a
      document, a form) count as evidence of clutter, as several counterweights do of a keeper. Cost,
      worked out from the hover cards: of the six selfies and people with phones counted as Screenshots
      at 0.5.21 (#310–#318), about four come back at minimum lead 0.02 (#311 lead ≈ 0.025, #314 ≈ 0.034,
      #317 ≈ 0.026, #318 0.021); #310 (≈ 0.018) and #316 (≈ 0.019) stay out. Estimates: the cards showed
      only the top counterweights. Those four are for buffs or Screenshots' own minimum lead to handle
- [x] Pool only the best 3 counterweights (decided 2026-11-18, built in 0.5.24): at most pooling × ln 3
      (0.022 at 0.02) above the best. Before, pooling counted every counterweight, so a photo nothing describes well still got a pool: eight
      counterweights all near 0.61 add up to 0.02 × ln 8 ≈ 0.04. A desk with a model spaceship and a
      monitor (Photos of screens 0.655, five kinds of clutter next, every counterweight below 0.611)
      was left out on counterweights pooled to 0.635 (2026-11-18). Since 0.5.23 the hover card lists
      every counterweight in the pool with its vote. Alternatives considered: pool only those close to
      the clutter score, or leave it (leaving out is the safe direction)
- [x] **Buff a counterweight from a photo** (built in 0.5.22; in 0.5.23 moved to the tab "Open all in
      a new tab" opens, for a clutter category, where the whole category is judged; applied buffs go
      back to the clutter page's weights): under a counted clutter photo opened large, one button per
      counterweight: the smallest weight on its closest description that leaves
      this photo out of its category (up to +0.2). A buff applies to every photo, so it isn't made
      casually: the button opens a popup listing every trashable photo it would take out of the
      suggestions, where each goes (another category, or not counted with its lead before and after),
      with the hover card now and with the buff. Apply or cancel (Esc). Since 0.5.31 the popup can balance the buff with clutter weights, shown live (0.5.34: under each photo leaving a suggestion, the clutter description it scored as there, with its weight; 0.5.36: a Keep button raising it by the smallest amount that keeps the photo; earlier, a panel of whole categories): the photos that leave and the photos that join, by suggestion, and whether the photo itself is still out; Apply sends every change. Prefer counterweights to weakening
      clutter, which would reach everywhere. In the product, the same could come from asking why a
      photo was un-ticked ("Which fits this photo better?", top counterweights and "None of these",
      which points to a missing counterweight), weighed against every photo kept ticked (milestone 6)
- [x] **Weights** (decided 2026-11-18; built in 0.5.21, kept in the browser): a weight per category and per description, about −0.05 to
      +0.05, added to its scores before comparing (a category's weight to all its descriptions).
      Strengthening a counterweight or weakening a clutter description takes photos away from clutter.
      Set by hand on the developer page; later learned (milestone 6). The hover card shows each step:
      score, weight, pooled score, lead. Example: "a child playing" at +0.03 leaves out #74 (a boy at a
      computer), with lead 0.012 instead of 0.035
- [x] **A minimum lead per category** (built in 0.5.21), defaulting to the shared one: Signs needs 0.03–0.04, Products is
      fine at 0.01
- [x] **Edit the categories on the developer page** (decided 2026-11-20, built in 0.5.44): Edit in "Categories and
      weights" opens an editor (rename, add or remove categories, switch clutter and counterweight; add, reword,
      move or remove descriptions). Save describes what is new to the AI model, scores every photo again and
      shows what the edits do (photos that leave, join or move between suggestions), to apply or go back to.
      The edited list is kept in this browser (`clutterEdits.ts`); the panel lists the changes from the shipped
      list, with Copy changes (to make them permanent in `clutter.ts`) and Reset to the shipped list. A reworded
      description keeps its weight
- [~] **Subject and setting** (decided 2026-11-20, built in 0.5.54; `clutterAxes.ts`, page mode "Subject and
      setting", next to "One list" until 0.5.63): one fingerprint mixes what a photo is of with where it is (a selfie in a
      supermarket matches People and Products). Each category is a subject or a setting, with a verdict
      (clutter, keep or neutral); each photo gets its best subject and best setting, each against its own
      axis only, and counts only when clearly ahead (a minimum score and lead per axis, and per category).
      The pair decides: an exception for the exact pair (both count) first, then keep wins, then clutter
      (subject first). Since 0.5.58 it takes strong evidence to call a photo clutter and any credible sign
      of a keeper stops it: a keep category is heard when within the minimum lead of its side's best, and
      clutter counts only when first and clearly ahead of everything that isn't clutter (a party photo had
      gone to clutter on Food 0.686 just ahead of People 0.684). "Clear/unclear" is "counts/too close".
      Since 0.5.61 a third side, **form**: Screenshots against Not a screenshot ("a person holding a
      phone"…), decided on its own by the AI alone (a desktop screenshot can be any shape, so no size
      test). It doesn't touch keep or clutter, keepers don't stop it, and a clutter form is a suggestion of
      its own: a screenshot of a receipt is in Screenshots and in Receipts. ("A phone screenshot" as a
      setting had made a friend holding a phone at a bar clutter.) Photos of screens stay a subject. Each mode keeps its own list and settings.
      The page has the same editor (with axis, verdict and exceptions), Save popup, Open all with buffs (a
      keep subject or setting strengthened just enough to leave a photo out) and Stay (renamed from Keep:
      raise the description a leaving photo matched, just enough to stay in its category), and a
      subject × setting table of every pair with its count and outcome, each openable. Starting list: the
      single list split, mixed categories divided (Shops, Car parks, Museums and historic places, Home,
      Streets and buildings as settings). To judge on my library: selfies in shops, children at computers,
      museum pieces, ruins
- [x] **Subject and setting only** (decided 2026-11-21, 0.5.63): it did better than the single list, which is
      removed (in the git history before 0.5.63), with its page mode. What subject and setting lacked from it
      came over, each scoring with its own settings:
      - **Raw or evened-out scores**, switchable. Evened out was turned down for the single list in
        2026-10 (it moved keepers into clutter); with a keeper heard near the top it is worth another look:
        a short, vague description like "tools" scored about 0.64 on every photo and won wherever nothing
        fitted (London skylines as Things to fix or sell).
      - **Pooling where overlapping descriptions share a vote**: on each side, the descriptions of one
        verdict close behind its best add to it, each vote shrunk by how much the description rises and
        falls with one above it across the library (the correlation of evened-out scores, each photo's own
        average taken off). "A city view", "a landscape" and "a sky adventure" count about once, "a famous
        landmark" on its own. Only the best three votes count, and the lead is measured between pools. Off
        by default.
      - **A floor**: clutter counts only when it scores at least so far above a baseline description, "a
        photo", which is close to every photo. Off by default.
- [x] **The list reviewed for coverage** (2026-11-21, 0.5.64; `AXIS_LIST` in `clutterAxes.ts`): 32 subjects, 14
      settings, a baseline. Clutter is specific objects photographed for a practical reason; keep is what must
      never be suggested; neutral is everything else common (vehicles, plants, clothes, health, everyday
      objects…), so clutter never wins only because nothing else fits (London skylines went to Things to fix
      on "tools"). Keep wins, so places where clutter is usually photographed (airports, cafés, cars, offices)
      are neutral settings. Wording that worked was kept; Signs and Things to fix were narrowed; new clutter:
      Cards and IDs, Parcels and deliveries, care labels. Screenshots became a setting, with no form side
- [ ] **Keep the minimum score**, today 0 (off): it guards against photos nothing describes well, where
      two poor matches can still be far apart. Choose it while tuning
- [x] ~~A priority order of the clutter categories, re-orderable on the developer page~~ (built in 0.5.21,
      removed in 0.5.30): the order was meant for users, learned from what they trash (milestone 6),
      not set by hand. The developer page lists suggestions by size, largest first. Museum pieces,
      churches and old machinery should still rank lower, not be hidden: by what users keep
- [x] Accidental shots: remove "a photo of the floor" and "a photo of a ceiling" (they match
      architecture and interiors; decided 2026-11-18). Milestone 2's quality numbers are the better
      signal
- [x] The developer page's samples closer to Search's (built in 0.5.21): **Best** (as Search shows it), **Riskiest**
      (the smallest leads, not repeating Best; most wrong photos so far had small leads, and pooling
      folds close counterweights into the lead), and, for the developer page only, **Lowest scores**
      (to compare with Riskiest until lead alone proves enough) and **Just missed**
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
      More / Less like these as usual. As imagined on 2026-11-13: "627 photos of products and shopping ·
      about 127 MB · View now". Clicking it shows them in the Search tab itself. It runs the suggestion with
      the same categories, minimum score, minimum lead and scoring, not a text search for the category's
      name, so it shows exactly what "Open all in a new tab" shows on the developer page. The size needs
      each photo's file size: check whether the scan stores it
- [ ] Search marks where a suggestion's photos end (Search only ranks today; it has no cut-off)
- [ ] A suggestion's photos (decided 2026-11-18): all ticked for the trash; the user un-ticks what to
      keep. The 10 best on top and the 10 riskiest at the bottom, with **Show all** between them, so the
      riskiest are seen without leading with them. A sort menu (Best, Riskiest, Newest, Oldest…) that
      remembers the last choice, Best by default. Every photo is still checked against the protection
      rules before it's trashed, as Search's sweep does now
- [ ] Suggestions largest first for now; ordered by what the user trashes later (milestone 6)
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
- Ranking for review only, never "select all". *(Replaced on 2026-11-18 for milestone 1's suggestions:
  their photos come all ticked, with the riskiest shown; see milestone 1.)*
- Decided 2026-11-18, for milestone 1's suggestions:
  - It learns the weights that the developer page sets by hand (milestone 1), and the order of the suggestions.
  - Order: a suggestion the user trashes more from moves up (the share of shown photos trashed,
    starting from the shipped order so one bad look doesn't bury a category).
  - Weights: an un-ticked photo means "keep". Its clutter description weakens and the counterweights
    behind it strengthen. A small model fitted to the decisions, not ad-hoc nudges.
  - **Stricter only**, or loosening capped: it learns only from photos it showed, so it knows what to
    leave out. Making suggestions looser (a clutter description stronger, a counterweight weaker)
    would add photos nobody has judged.
  - The learned weights are valuable: kept per Google account and **backed up to Chrome's synced
    storage** (`chrome.storage.sync`; a few kilobytes of numbers, no new permission; it follows the
    Chrome profile, not the Google account). "Erase Photo Cleaner's data" warns about weights not yet
    backed up and offers to back them up first.

## Later, not planned

- A second, **generative AI model** (captions, reading the text in a photo): 1–3 GB and seconds per
  photo, so only for small shortlists, e.g. explaining a suggestion. Not worth it now.

## How we learn

Evidence comes from my own library, other test libraries and early testers. Optional usage reporting
was implemented in 0.4.49, off until agreement and silent in ordinary developer builds. Live GA setup,
report checks and disclosure publication remain before release; see `usage-events-setup.md`.

## Also open from the same conversation

- [x] Popup: every state without an account except "no tab" (tab not responding, signed out, tab
  asleep) was a line of text with no button; "Looking for Google Photos…" was seen staying up once.
  Done (0.4.25): the account check has a time limit of 5 s and asks every open Photos tab, not only the
  first; the popup shows **Open Google Photos** with the reason in every state without an account, and
  a failure inside the extension says why instead of reading as "no account". "Looking…" itself has no
  button: it now ends within seconds, and a button there would flash up each time the popup opens.
