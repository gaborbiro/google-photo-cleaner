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
question: *if Photo Cleaner offered this for the trash, would that be fine, or wrong?* Every kind of
clutter is listed beside the photo, in a box between Keep and Unsure. **Space** (or **K**) keep (don't
offer), **Enter** clutter (fine to offer) of the highlighted kind (the best guess first; the arrows move it),
a kind's key for another kind, **o** other clutter (you know its kind and no category fits: a hint that one
is missing), **0** clutter with its kind not given, **U** unsure, also for a matter of taste (counts for
nothing, see [clutter-rules.md](clutter-rules.md)), **Backspace** back. By touch, the same as large buttons. The labels are about
the outcome, not how the matcher works, so they stay valid whatever is changed.

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
  (`id`, `label`, `kind`, `axis`, `verdict`, `descriptions` per category). Checked as the page checks a
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
