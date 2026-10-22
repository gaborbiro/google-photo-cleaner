# Browser extension: checks by hand

`npm run check` tests the rules, the stores and that every page draws. These are the things only a
real Chrome with a real Google Photos account can show. Go through the parts a change touches;
go through all of it before a release.

Each step says what you should see. Anything else is a bug: note what you did and what you saw,
and copy the console (right-click the page → Inspect → Console).

## Before you start

- Build: `cd extension && npm run kotlin && npm run build`.
- `chrome://extensions` → Developer mode → **Load unpacked** → `extension\dist-app`. If it is
  already loaded, press ↻ on it, then reload every Google Photos tab.
- photos.google.com open in one tab, signed in. A library of a few hundred photos is quick; the
  real library (about 19,000) is the speed and stamina test.

## 1. Opening it

1. The panel is Chrome's side panel. In Google Photos, open the popup and click **Open panel in
   Google Photos**: the panel opens beside the page and Google Photos narrows to make room (nothing
   covers it). Nothing of Photo Cleaner's is drawn on Google's page itself. Chrome's toolbar shows its
   side panel button, which closes the panel; so does the × in the panel's Chrome header. Drag the
   panel's edge: it gets wider and narrower, and stays readable.
2. With the panel open, switch to a tab of another site: the panel hides. Switch back: it is there
   again, as it was. In the Photos tab, go to another site and back: the panel is offered only on
   Google Photos (Chrome's side panel menu lists Photo Cleaner there, not elsewhere).
3. Updating from 0.4.39 or older: reload the extension (↻) without reloading the Photos tab. The old
   purple **Photo Cleaner** button and panel disappear from the page, and **Open panel in Google
   Photos** opens the side panel in that tab.
4. Two Photos tabs signed in to different accounts, each with its panel open: each panel shows its own
   tab's account.
5. Toolbar icon → popup: the account's email, the Scan card, then two buttons: **Open in tab ↗**
   (or **Review N groups ↗** once groups are waiting) and **Open panel in Google Photos ↗**. Texts
   are comfortably readable (not tiny).
6. **Open in tab**: the review tab opens on **1 · Scan**, with the heading "Photo Cleaner", the
   account's email, and the tabs **1 · Scan**, **2 · Duplicates**, **Search**.
7. With groups waiting, the popup's and the panel's button says **Review N groups** and opens
   **2 · Duplicates**. With the review tab already open on another tab, and a few photos selected in
   Duplicates: the button brings that tab forward and switches it to Duplicates without reloading
   (the selection and the place in the list are still there).
8. Close the Photos tab, open the popup: it says Photo Cleaner works inside Google Photos and offers
   **Open Google Photos**, which opens it (without the panel). With Photos open in a background tab,
   or in another window, **Open panel in Google Photos** brings that tab forward with its panel open.
   Clicking it twice: still one panel.
9. Reload the extension (↻) with a Photos tab open, without reloading that tab, then open the popup:
   within a few seconds it shows the account; "Looking for Google Photos…" never stays longer than
   about 5 s. Without an account it says why and offers **Open Google Photos**.
10. Two Photos tabs, the one used last put to sleep (`chrome://discards` → Discard) and the other
   awake, with some other tab active: the popup shows the awake tab's account. With every Photos tab asleep, it says the tab is asleep and
   **Open Google Photos** wakes it.

## 2. Scan

1. Before starting, the popup, panel and Scan tab show two numbered sections: **Read your library**
   and **Analyse photos**. **Full speed** is in the second section and can already be chosen.
   **Scan library** starts step 1: it counts entries and says how far back it has got, while step 2
   says **Up next**. The review tab's browser tab shows a spinning ring as its icon.
2. **Pause**, then **Resume**: it carries on where it stopped, not from the start. Both buttons
   stay at the top of the Scan card. Step 2 says **Paused** until resumed, then **In progress**.
3. Close the Google Photos tab while it scans: it pauses, saying Google Photos was closed. Open
   photos.google.com again (same account): it carries on by itself within a few seconds.
4. Switch the Photos tab to another Google account: the scan pauses and says it's a different
   account. Switch back and resume.
5. Step 1 says **Complete** and its **Protection details** can be opened immediately, while step 2
   runs automatically. The first time, the AI model downloads (a bar), then the speed check, then
   "Analysing new photos", immediately followed by detail (140 or 70), then progress, photos per
   second and time left, all in step 2.
   **Full speed** keeps the earlier choice and changes the pace. Check the two sections in the
   narrow popup and panel as well as the review tab; their labels and counts stay readable.
6. When it's done: "1 · Scan (done)", "Scan complete", the tab icon goes back to the normal one,
   and both steps say **Complete**. **Protection details** stays under step 1, with space above
   **Copy report**; detail and **Full speed** stay under step 2. Open the report: its heading is
   larger than its body text, with a separate background, border and footer. Check it in light
   and dark mode and at the panel's narrow width; fold it again to get back to the short summary.
7. **Check for new photos**: it reads the photo list again but only analyses photos that are new;
   with none new it finishes quickly.
   With the analysis paused and the photo list more than a day old (pause it, then set the
   computer's clock a day ahead, or wait), the button says **Check for new photos** instead of
   Resume, and step 1 says the analysis carries on afterwards. Press it: step 1 reads the list
   again, then step 2 carries on without redoing photos already analysed.
8. Note the speed (photos per second) and how long the full library took.
9. Copy diagnostics (review tab, Scan tab, the card above Erase): under **Recent runs** there is one
   entry for the library read (pages and time per listing) and one for the analysis (photos done,
   where the time went, detail, full speed, the graphics card). The times roughly match what you
   noted above. An analysis still running shows "running" and is updated every 5 minutes.
10. With an album that doesn't match Google's count (or can't be read), the warning names it ("No
   photo can be trashed: 1 album doesn't match Google's count"), step 1 offers Copy diagnostics,
   and its Protection section has an "Album issue" line with the numbers but no album name.

## 3. Protection choices

From here on, approving moves photos to Google Photos' trash: use photos you don't mind losing.

1. On the Scan tab, untick **favourites**. The panel and popup show the change without a reload;
   Protection details count favourites as eligible.
2. Tick it again. Duplicates and Search no longer offer favourites.
3. With favourites unticked, approve a favourite for the trash: the trash queue line counts it in the
   trash within a few seconds, since approved photos are sent at once. **Z** brings it
   back. (A photo re-protected while still queued is blocked; that is tested automatically, because
   by hand there is no time to tick the box before it is sent.)

## 4. Duplicates

1. The first group shows with its first photo focused, without pressing anything. Previews load;
   a missing preview says why underneath.
2. Arrows move the focus. Holding an arrow, after a short wait, slides along the row or column and
   stops at the end without bouncing. Tapping an arrow at an edge bounces the photo once. Down on
   the bottom row stays in its column.
3. **A** focuses the whole group (every photo bounces); **A** again unfocuses. **Space** toggles
   trash on the focused photo; clicking a photo toggles it without a bounce.
4. **D** trashes the selection, **F** keeps all, **S** skips. **Z** undoes, with a
   spinner while it works.
5. In a long group scrolled down, the next long group brings its top row into view without opening
   the folded toolbars.
6. Switch to Scan and back: the groups are still there, not rebuilt.
7. **Enter** opens the large viewer; arrows go through the group; **Esc** closes it.

## 5. Search

1. Type a description (e.g. "food", "receipt") → **Search**. The first time, the description
   model downloads (a bar). Results appear best match first; protected photos never appear.
2. Select a few → **M** (more like these): they show as + examples and the results change.
   **L** (less like these) shows − examples and drops look-alikes. Removing an example works.
   **Start over** clears everything.
3. **D** asks to confirm; **Enter** moves them to the trash queue, **Esc** cancels.
   **Z** undoes it.
4. From Duplicates, **Search more like these** opens Search with that group as examples.

## 5b. Real trashing (Google Photos changes: start small)

Use photos you don't mind losing, a few at first. Everything trashed stays in Google Photos' trash
for 60 days.

1. Approve a group of 2–3 photos. Within a few seconds the queue line counts them in the trash, and
   Google Photos' **Trash** shows them (reload it). Nothing else is there that you didn't approve.
2. **Z**: the line counts them restored, and they are back in Google Photos (reload), in their albums
   as before, not in the trash.
3. Search: select 2 photos, **D**: the question says they go to Google Photos' trash; **Enter**: they
   appear in Google Photos' trash.
4. Approve a group, then close the Google Photos tab at once: the queue line says it is waiting for
   Google Photos; reopen it: the photos are trashed, once (not twice, nothing else).
5. Approve groups quickly (D, D, D…): the line's queued count rises, then drains to "in trash".
6. A photo saved from someone else (partner sharing, or from a shared album you've left), in no
   album: it is offered like your own. Trash it: it appears in Google Photos' trash; **Z** brings it
   back to the library. The person who shared it still has their copy (ask them, or check that the
   shared album or partner's library still shows it).

## 6. Erase Photo Cleaner's data

1. Popup → **Erase Photo Cleaner's data from this computer**: the explanation appears with
   **Confirm to erase** and **Cancel**. Cancel: nothing happens.
2. With the review tab and a panel open, confirm: "Erasing…", then every open page starts over;
   the review tab says the data has been erased from this computer. Nothing changes in Google Photos.
3. The Scan says "Not scanned yet", the protection choices are back to all ticked, and the AI
   model downloads again on the next analysis.

## 7. Updates and interruptions

1. Reload the extension (↻) in the middle of a scan, then reload the Photos tab: the scan can be
   resumed and carries on. (Known: it may say "Stopped by an unexpected error…"; see the error
   review on the roadmap.)
2. Leave the Photos tab in the background long enough for Chrome's Memory Saver to put it to sleep
   during a scan: the scan wakes it (reloads it) and carries on.
3. A database update with an old page still open: load a build with a newer database version while
   an old review tab is open. A message says to reload Google Photos tabs and close other Photo
   Cleaner tabs; after that it carries on by itself.
4. The background page dying mid-scan: `chrome://extensions` → Photo Cleaner → Inspect views
   `engine.html`, and in its console type `close()`. Within about 90 s the Scan card says "Scan not
   responding" with **Restart** and Copy diagnostics; Restart carries on from where it was, and
   Copy diagnostics lists "scan: background page not responding".
5. The background page failing to start (pretended): while a scan runs, type in that console
   `__photoCleanerEngineStarted = false; setTimeout(() => { throw new Error('test') })`. The scan
   pauses with "Photo Cleaner's background work couldn't start…", the background page closes, and
   Copy diagnostics lists "background page: could not start" with "Error: test". Resume carries on.

## 8. When Google Photos changes

These can't be triggered on purpose. If they ever appear, the message should say that Photo
Cleaner no longer understands Google Photos' answers, that nothing in your library was changed,
and to check for an update.

1. The stopped step shows a "For support: …" line and a **Copy diagnostics** button, in the popup,
   the panel and the review tab, also when the scan stopped before the library was read (for
   example while reading albums).
2. Copy diagnostics, then paste it somewhere: it starts with the extension's version, says where
   the scan stopped, and lists the problem with its request (e.g. `listAlbumsPage (Z5xsfc)`),
   "Gave up at: …" and the structure of Google's answer. Keep it for the fix.
3. Close Chrome, open it again, and open the review tab: the same problem is still under
   **Copy diagnostics** (the card above Erase is always there).
4. "What it copies" unfolds to show the same text.

## 9. Privacy

1. Look through the console of the review tab, the panel's Photos tab and the service worker
   (`chrome://extensions` → Photo Cleaner → service worker): no photo keys, photo addresses
   (`googleusercontent.com/…`), album titles or tokens.
2. DevTools → Network on the review tab: requests go only to Google Photos (through its tab) and,
   for the AI models, Hugging Face.
3. Copy diagnostics (review tab, Scan) and read what it copied: no photo or album keys
   (`AF1Qip…`), addresses, album titles, tokens, your email or the account's fingerprint.
