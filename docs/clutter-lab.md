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

- **Done**: its Riskiest 24 (the smallest leads, where mistakes bunch up) hold **at most one wrong
  photo, and that one harmless**: a thing mistaken for another thing, never a photo someone keeps
  (a face, a child, a once-only moment). Then the whole category is well above 99% right. Wrong means
  it shouldn't be trashed: clutter under another category's name (a printed letter among Screenshots)
  is still rightly trashed, so it is harmless.
- **Not done**: change one or two things that hold for every library (above), and look again.
- **Can't get there**: the category ships low in the list of suggestions, or is held back until
  better descriptions exist. Say which, and why, in its comment in `AXIS_LIST`.

## Labels

**Label photos…** on the developer page shows a sample one photo at a time and asks one question:
*if Photo Cleaner offered this for the trash, would that be fine, or wrong?* **K** keep (wrong to offer),
**C** clutter (fine to offer) then its kind (the best guess pre-selected: Enter takes it; **o** for clutter
no category fits; **0** kind not given), **U** unsure (counts for nothing), **←** back. The labels are about
the outcome, not how the matcher works, so they stay valid whatever is changed.

The sample (`labelSample` in `clutterLabels.ts`): each clutter category's riskiest 8 and just missed 6, 40
photos that are "neither", and 150 from the whole library (what shows clutter missed altogether), only
photos that may be trashed, shuffled, none labelled already. The labels stay in the browser
(`dev-clutter-labels`).

Every lab result then has `labels`: before and after, per clutter category its offered photos that are
right, harmless (clutter of another kind) or wrong (keep), and the clutter of its kind it misses; and in
all, how many offered photos are wrong, and how much labelled clutter is found. That scores a change
without looking at a single photo.

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
