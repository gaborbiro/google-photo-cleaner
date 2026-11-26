# The clutter lab folder

The developer page `dev-clutter.html` can watch a folder, so a coding agent can tune the subjects,
settings and forms on its own, against the real library and the real AI model, without anyone clicking.
The folder is `lab/` in the project, git-ignored: it holds contact sheets and scores of the user's photos.

## Changing the list: for every user, not one library

The list ships to every user. Tuning it on one library must not make it fit only that library.

- **Describe kinds of photo, not things seen in this library.** "a cardboard delivery box", not a
  courier's name; "a price tag", not a shop's; no brands, places, people or habits of one user.
- **A change needs a reason that holds for most people's photos**: say it in a comment by the change
  (what went wrong, and why that happens in any library). "Real screenshots of posts left with a room
  rival" holds; "my flat has red rugs" doesn't.
- **Prefer what generalises**: a neutral category for a common kind of photo over a weight or a
  category's own minimum lead tuned to a handful of photos; weights and own minimum leads stay on the
  developer page, not in the shipped list, unless the reason holds everywhere.
- **Keep wins, so be generous with keepers and strict with clutter**: a description that takes photos
  people keep into clutter in one library will do it in others.
- **Check on a second library** before a change is called done (the roadmap's "Try one other library").

## When a category is done

Perfect isn't the goal: the user sees every suggestion before it is trashed, the riskiest a short scroll
away, can take a photo out with one tap, and trashed photos stay in Google Photos' trash for 60 days.

What counts as clutter, and the measures the whole list is held to (precision and recall on random
photos), are in [clutter-rules.md](clutter-rules.md).

- **Done**: at its **edge** (its riskiest 24, the smallest leads, where mistakes bunch up), **at least 10
  photos are labelled and at most one of them is labelled keep**. The page and every lab result say this
  per category (`edge`: pass, fail, or needs labels; **Label edges and misses…** tops each edge up to 10). Then the
  whole category is well above that. Clutter under another category's name (a printed letter among
  Screenshots) is still rightly trashed, so it isn't wrong. Before it ships, its wrong photos are looked
  at: a face, a child or a once-only moment stops it, whatever the numbers.
- **Not done**: change one or two things that hold for every library (above), and look again.
- **Can't get there**: the category ships low in the list of suggestions, or is held back until
  better descriptions exist. Say which, and why, in its comment in `AXIS_LIST`.

## Labels

**Label edges and misses…** on the developer page shows a sample (each category's edge topped up to 10
labelled, a few it just missed, and some photos no category offers) one photo at a time and asks one
question: *if Photo Cleaner offered this for the trash, would that be fine, or wrong?* The answer is on a
key: **Space** (or **K**) keep (don't offer), **Delete** clutter (fine to offer; **Enter** until 2026-11-25, when it also confirmed and so switched a keeper picked with the arrows to Clutter), **U** unsure: people differ,
a matter of taste (saved at once; counts for nothing, see [clutter-rules.md](clutter-rules.md)). Since
2026-11-24, after Keep or Clutter the screen asks what should have decided the photo (`kindChoices`): after
**Keep**, the keep categories (which should have kept it); after **Clutter**, the clutter categories and forms
(which should have offered it); each in the AI's order, its best guess highlighted, then **Other** (o): no
category of that side covers it. **Enter**, or the same key again (Space Space, Delete Delete), saves with the highlighted
kind; a kind's key or a click saves with that kind; the arrows move the highlight; **Backspace** goes back to
the answer. Neutral categories (Food and drink, Vehicles…) are in neither list: they neither keep nor offer, so
a meal is Unsure, a drink with friends Keep → People. Which category offered a keeper needs no label: the
page works it out. For a missed photo the kind says which category should have found it; for a keeper offered
by mistake, which should have kept it (Copy scores: "Keepers offered all the same"). (Labels from before stay
valid: until 2026-11-24 a grid of every subject, neutral ones too, with the answer apart; until 2026-11-23
clutter kinds only, a kind's key answering clutter, and **0** clutter with no kind. Clutter labelled with a
neutral or keep kind is still tallied apart in Copy scores; Food and drink stays taste.) **Backspace** on the
answer goes back a photo (its label stays, its answer ringed ✓, and its kind when that answer's kinds are
shown, until another answer replaces it), **Shift+Delete** clears an answer (the photo unlabelled again), and **→** skips a photo labelled before, its label kept (not a
new one, so a random sample can't lose its hard photos), and **←** goes back a photo, like Backspace. The two arrows do this
only while the answer is asked; once the kinds are shown, they move between kinds. By touch,
the same as large buttons: tap Keep or Clutter, then a kind. The labels are about the outcome, not how the matcher works, so they stay valid whatever is changed.

**Near-duplicates** (2026-11-24, `withDuplicates` in `clutterLabels.ts`): a label covers the photos the
Duplicates review groups with it (its moments, by the shared rules, decided ones too: `duplicateMoments` in
`duplicates/session.ts`). Each time the page counts, a moment's unlabelled photos take the answer and kind of
its labelled ones when they all agree (a moment whose labels differ copies nothing; nor do Accidental shots,
about the shot rather than what it shows, or clutter with no kind: `NOT_COPIED_KINDS`); copies are never kept,
so they follow the label they came from, never overwrite an own label, and are never random. They count in
the scores and the edges, and the samples skip them and ask one photo of each moment (`oneOfEachMoment`). A
photo drawn at random that has a copy keeps it as its own, now random. The page says how many are copied
next to the labels' line.

**Review my random labels…** (2026-11-25) goes through the random labels again in library order, each with its
earlier answer marked, and remembers where it stopped (`reviewQueue`); **Start the review over** keeps every answer
and brings them all back (`reviewStartedOver`). Under Keep, the keep settings (Adventures and events,
Occasions…) are kinds too (`isLabelKind`): what should have kept a photo is sometimes where it was.

**Label these again…** (2026-11-26), beside a list of kinds such as "Clutter · Signs and timetables (40)", goes
through the edge labels (not random) of that kind and verdict again, each with its earlier answer marked
(`kindAgainChoices`): shop fronts had been labelled Signs before they became unsure. The list is A to Z by
kind, with Other: kind missing among them. After the kinds, **Top subject · Clothes and looks** and **Top setting · …**
bring back the edge labels whose best subject or setting (the AI's view) is that one, whatever the answer
(outfits labelled Keep · People; café interiors).

**Label again: unsure or missing a kind…** asks again about photos labelled unsure or taste, and clutter with
no kind that no category offers (`labelAgainQueue`), the old answer ringed; a random photo stays random when
labelled again.

**Simple mode**, a switch at the top of the answers, off by default, for anyone: the answer alone, **Space**
keep, **Delete** clutter, **U** unsure, and the AI's guess at the kind in small type as a hint. Precision,
recall and the edges need no kind. For a friend labelling their own library: ask them to switch to Simple,
and to decide first whether they'd mind the photo being offered for the trash. Kept in the browser
(`dev-clutter-label-mode`).

The sample (`labelSample` in `clutterLabels.ts`): each clutter category's riskiest 8 and just missed 6, 40
photos that are "neither", and 150 from the whole library (what shows clutter missed altogether), only
photos that may be trashed, shuffled, none labelled already. The labels stay in the browser
(`dev-clutter-labels`).

**Label random photos…** draws 100 photos at a time at random from the whole library (only photos that may be
trashed) and marks their labels `random`; a drawn photo labelled before in the sample above keeps its verdict
and is marked random too, so the close calls aren't left out. The mixed sample is for finding mistakes fast;
the random labels alone measure the library: **precision** (of the labelled photos offered, the share that is
clutter) and **recall** (of the labelled clutter, the share offered), shown in the labels line on the page.
Both are for the whole list, not per category (per category: right, another kind, wrong and missed, in Copy
scores and the edge). Results shows them under its totals, random photos first; the Save popups for the
categories and the settings show what the change does to them (before → after), from 2026-11-23.

**Copy scores** copies the scores as text, for someone who labelled their own library to send back (a second
library, without a lab folder): the version, the list's changes from the shipped one and the settings, the
labels line, per category on the random labels and on all of them (right, another kind, wrong, missed), and
the edge. Numbers and the list's own words only, never a photo key or a label (`scoresReport`). Before they
label, apply the list to be tested on their page, so their scores are for that list.

Every lab result then has `labels`: before and after, per clutter category its offered photos that are
right, harmless (clutter of another kind) or wrong (keep), and the clutter of its kind it misses; and in
all, how many offered photos are wrong, and how much labelled clutter is found. That scores a change
without looking at a single photo. `labelParts` has the same for parts of the labels: `random` (the
library's precision and recall), and `a` and `b`, all labels in two fixed halves by photo: tune looking at one
half, and keep a change only if it holds on the other, so the list isn't fitted to a few hundred photos.

## Connecting (the user, once)

1. Load the extension, open the developer page, let it work out the suggestions.
2. **Connect a lab folder…** → pick `<project>/lab` (create it first). Chrome asks to allow editing files.
3. After a reload of the page (or the extension), press **Reconnect the lab folder**: Chrome asks again.

The page looks for `lab/request.json` every 3 seconds while it is open. A code change still needs the
user to reload the extension and the page; a change of the list or settings doesn't.

The AI work is kept across reloads (`dev/clutterCache.ts`, the `dev-clutter-cache` database): each
description's fingerprint by its words, and the photos' scores (with how the descriptions overlap) under a
hash of the descriptions in order, the model and every photo's key and fingerprint, the newest three lists.
A reload after a code change to the screens or the settings alone skips both; a new description is the only
one the AI model describes, and a photo added, removed or analysed again scores the library afresh. Erase
Photo Cleaner's data doesn't clear it (nor the lab folder's database); Chrome's site data for the extension
does.

## A request

Write `lab/request.json`; give each request a new `id` (letters, digits, `.`, `-`, `_`). A request whose
folder `lab/<id>/` already has a `result.json` is done and is not run again.

```json
{
  "id": "r12",
  "list": { "categories": [ … ], "exceptions": [] },
  "scoring": "raw",
  "settings": { "margins": { "products": 0.03 }, "pooling": 0.02 },
  "apply": false,
  "review": ["screenshots", "products"]
}
```

- `list` (optional): the whole list, as `AXIS_LIST` in `extension/src/app/search/clutterAxes.ts`
  (`id`, `label`, `kind`, `axis`, `verdict`, `descriptions` per category, and a form's `check`: since
  2026-11-25 forms are in checks, each a competition of its own, so a photo can be in Screenshots and in
  Accidental shots, and a counterweight such as Not a screenshot holds back its own check only; a form
  without `check` is in the check "Form"). Checked as the page checks a
  list it keeps; refused with the reasons when it can't be used. New descriptions are described to the AI
  model, which takes a while the first time.
- `scoring` (optional): `raw` or `evened`; the settings below are that scoring's.
- `settings` (optional): fields of `AxisSettings` to replace (`subject`, `setting`, `form`, `margins`,
  `categoryWeights`, `descriptionWeights`, `pooling`, `baseline`); a field replaces the whole of it.
- `apply` (optional, default false): keep the change on the page afterwards, as Apply does. Otherwise
  it is only measured against what the page has now.
- `review` (optional): category ids, or `"all"`, to save review files for, with the change.
- `labelSheets` (optional, default false): contact sheets of the labelled photos the change offers though
  they're labelled keep (`label-wrong.png`), and of the labelled clutter it misses, by kind
  (`label-missed-<kind>.png`), with their scores in `labels.txt`.
- `blind` (optional, default 0, at most 500): that many labelled photos, drawn the same way for the same `id`,
  as numbered sheets `blind-01.png`… for the agent to label without seeing the answers. The user's answers
  (verdict, kind, random, and what the list offers it in) are in `blind-answers.json` by number, never a photo
  key. The agent writes its own labels down before it opens that file. The page keeps the photos of its last
  10 draws in the browser (never in `lab/`), so their numbers keep naming the same photos.
- `relabel` (optional): `{ "from": "<a blind request's id>", "labels": [{ "number": 3, "verdict": "unsure",
  "kind": null }, …] }` saves new answers for that draw's photos, by number, as the user's labels (random and
  reviewed kept). Only when the user asks the agent to relabel them. `kind` is a category id of the verdict's side,
  `"other"`, or null; unsure has none. A draw from before the page kept them is drawn again, and used only when all
  its answers match `blind-answers.json`; otherwise, or for a number or kind that doesn't fit, it is refused and
  nothing changes. The scores in its result are from before.
- `zoom` (optional): `{ "from": "<a blind request's id>", "numbers": [90, 7], "size": 512 }` draws those photos of
  that draw (up to 24) at `size` px a side (192 to 1024), four to a sheet, as `zoom-01.png`…: a closer look at
  what the 192 px sheets hide. The agent labels from the sheets, and zooms only on the ones it doubts.
- `exportList` (optional, default false): writes the list in use (`list.json`, as `AXIS_LIST`) and its tuning
  (`tuning.json`, as `STARTING_AXIS_TUNING`), to make what the page has the shipped list. Descriptions and
  numbers only.

## The result, in `lab/<id>/`

- `result.json`: `state` (`done` or `refused`, with `problems`), `notes` (weights dropped), every
  category's photos `before` and `after` (those Search would offer), the totals, and `moves`: the groups
  of photos the change moves (leave a category, join one, move between them), numbered as on their
  contact sheets. Photos are only numbered; no photo keys or addresses are written.
- `<group>.png`: a numbered contact sheet per group (up to 24 photos, 192 px each), `moves.txt`: each moved photo's
  scores after the change.
- `<category>-riskiest.png`, `-lowest-scores.png`, `-just-missed.png` and `<category>.txt`: the review
  files of the categories asked for.

`lab/status.json` says whether the page is working on a request, and the last one it finished.
