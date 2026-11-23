# What counts as clutter

The rules for judging one photo: what the clutter suggestions may offer for the trash, and how labels on
the developer page (`dev-clutter.html`, see [clutter-lab.md](clutter-lab.md)) are settled. They are for
**most people's** photos, not one library: the list ships to everyone, so it must not learn one person's
taste. A draft, to be refined as labelling shows where it is unclear.

## The principle

**Offer only what almost anyone would call clutter.** Every user reviews each suggestion and unticks what
they keep, so the list doesn't have to match anyone's taste exactly; it has to stay out of the grey zone.

That makes judging lopsided, on purpose:

- **Kept by me, clutter to most people** (a nice café photo): fine to offer. I untick it; little harm.
- **Clutter to me, kept by most people** (a holiday view, a friend's portrait): must not be offered,
  whatever I'd do with it.

So the list is generous with keepers and strict with clutter, and a label that only says something about
one person's taste counts for nothing (**Unsure**, below).

## Always keep

Whatever else is in the photo:

- **A person as the subject**: a portrait, a selfie, friends, family, someone doing something. People in
  the background (customers in a shop, passers-by in a street) don't make it a keeper.
- **Children** and **pets or animals**.
- **Celebrations and events**: birthdays, weddings, parties, concerts, games, trips out.
- **Travel and places**: views, landscapes, cityscapes, landmarks, a beach, a hotel balcony at sunset.
- **Art, museums and history**: paintings, sculptures, old buildings, a famous café's interior.
- **Things made, hobbies and keepsakes**: something you built or cooked for an occasion, a scanned old
  photo, a child's drawing.
- **A once-only moment**: anything that couldn't be photographed again.

## Always clutter

Photographed for a practical reason, worth nothing once that is done (the original exists, or the moment
has passed). Clutter wherever it is photographed: a receipt in Rome is still a receipt.

- Screenshots of passing information, and photos of screens.
- Receipts, invoices, documents, letters and forms photographed for reference; cards and IDs.
- Tickets and passes, timetables, information signs photographed to read later.
- Where something was left: a parking space or number, a locker, a parked car to find again.
- Labels, barcodes, QR codes, model and serial numbers; meter readings and warning lights.
- Things to fix, to buy, to sell or to show someone; groceries and food to use up; parcels.
- Flat viewings and moving; menus; whiteboards and slides; notes.
- Memes and forwarded images; accidental shots (a pocket, a blur, black).

## Matter of taste

Neither rule settles them, and people differ: some keep every one, some none.

- Meals and drinks, cafés, restaurants and bars.
- Shop windows, markets, shelves; signs, posters and street corners abroad.
- Interiors, furniture or objects someone liked; cars.

The list doesn't offer these through a category that is clutter for almost everyone (groceries to use
up are clutter; a meal out isn't). Learning one person's taste is for later, per person, from what they
untick (milestone 6 in [cleanup-roadmap.md](cleanup-roadmap.md)), never for the shared list.

## When rules meet

- **A person as the subject wins.** A receipt held up to the camera is clutter; a friend holding a
  receipt and laughing is a keeper.
- **Practical purpose and a memory mixed**: taste. A menu at a restaurant you loved, a ticket from a
  first concert.
- **Part of a view**: a street sign in a travel view is the view; a sign photographed to read it is
  clutter.

## Labelling

On the developer page, **Space** (or **K**) keep, **Enter** clutter of the highlighted kind (or a kind's
key; **o** other clutter, **0** kind not given), **U** unsure, also for a matter of taste: "I'd keep (or
trash) this, but many people wouldn't". Unsure counts for nothing in the scores. (Until 2026-11-23 taste had
its own key, **T**; those labels still count as taste, which also counts for nothing.) Clutter labelled
with a kind the rules call taste counts as taste too (`TASTE_KINDS` in `clutterLabels.ts`: Food and drink,
for meals and drinks labelled clutter before these rules; decided 2026-11-22).

Labels are one person's view. When a label conflicts with the rules above, the agent doesn't overrule it
silently: it shows the photo and the rule, and the labeller decides whether it was taste (T) or a slip.

## How the list is judged

- **Precision** (of the photos offered, the share that is clutter): **at least 95%**, on photos labelled at
  random from the whole library (**Label random photos…**).
- **Recall** (of the clutter there is, the share offered): as high as precision allows; 50% first, then 60%.
- **Each category, at its edge**: at most 1 wrong among its riskiest 24 photos, with at least 10 of them
  labelled; otherwise it doesn't ship yet. Before a category ships, its wrong photos are looked at: a face
  or a once-only moment stops it, whatever the numbers.
- **A second library**: before the list ships, someone else labels a few hundred random photos of their
  own, and precision is checked there too.
