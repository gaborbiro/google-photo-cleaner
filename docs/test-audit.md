# Test effectiveness audit — 15 October 2026

This audit asks whether the tests reject broken production behavior, rather than
only whether they pass. It covers the browser extension, shared rules, desktop
app and Python worker. The experiments in `spikes/` are outside the product test
suite. No live Google account, Google write operation or real AI model was used.

## Method and evidence

Each experiment changed owned production source, ran the relevant tests and
restored the original source bytes in a `finally` block. Test source, vendored
code and generated Kotlin JavaScript were never fault-injection targets.
Compilation errors, discovery errors and runs that executed no tests do not
prove that a test detects a fault. JVM assertions were forced to run again;
Gradle's up-to-date and build-cache results were not counted as executions.

The [per-test ledger](test-audit-cases.csv) records a fault and the observed
failure for each test case, including parameterized cases. The smaller
[replay manifest](../tools/test-audit/faults.json) retains the corresponding source
edits. These are deliberate examples of regressions, not an exhaustive mutation
score or a guarantee that every assertion or branch is effective.

| Suite | Passing cases | Cases with an observed fault detection |
|---|---:|---:|
| Extension | 235 | 235 |
| Kotlin, desktop and shared | 160 | 160 |
| Python worker | 13 | 13 |
| **Total** | **408** | **408** |

The starting suites contained 386 cases. The changes add 22 cases and strengthen
existing fixtures and assertions. The replay manifest contains 158 selected
faults that collectively demonstrate all 408 cases. The final verification is
`npm run check`, a fresh JVM test run with caching of test execution disabled,
and the worker's `pytest` suite; all pass.

## Bugs fixed

- **Approved photo identity could change before processing.** Both trash queues
  rechecked eligibility by media key, then sent the deduplication key saved at
  approval. They now block an approval if the latest scan associates that media
  key with a different deduplication key. The extension's shared-rule export
  includes that identity for the check.
- **The extension's speed check could strand small libraries.** It demanded two
  usable previews from the first page. A one-photo library or a first page of
  videos could never finish. It now searches subsequent pages for its bounded
  sample, accepts one usable photo and retains metadata gathered while sampling.
- **Malformed text embeddings were reported as successful.** The worker now
  checks that its model returns one nonempty vector per requested text. Invalid
  dimensions or counts produce an `INTERNAL` error, and later requests still work.

Each bug was reproduced with a failing regression test before its fix.

## Tests strengthened

- The redirect test now supplies a valid RPC response at a redirected sign-in
  URL; rejecting unrelated HTML can no longer hide a missing redirect check.
- RPC construction checks cover method, credentials, form encoding, token,
  payload and required query parameters.
- The read-only tripwire scans the product bundle and React source, as well as
  the older bridge sources and vendored parser.
- Randomized safety and non-chaining tests must actually produce groups; empty
  results can no longer make their universal assertions pass vacuously.
- A rescan fixture pins the existing protected keeper and requires exactly the
  newcomer to be selected, instead of accepting an empty selection.
- The version-1 analysis migration fixture contains an actual embedding and
  verifies its vector and metadata after upgrading.
- Protection defaults are checked against literal expected choices. Connection
  tests isolate origin checks from host checks, compare the rejection code with
  the extension's code, and bound waits for failed handshakes and recovery.
- Local-date formatting includes an instant close to midnight, distinguishing
  the configured zone from UTC. Detail selection checks the exact four-hour
  boundary. Gentle-mode analysis uses enough photos to reach the paced loop.
- Desktop grouping tests exercise both unfinished and stale inventory, and a
  stopped preview sample must give the actual session-recovery instruction.
- New service-boundary tests observe actual trash calls and simulated state for
  changed protection, unknown evidence, stale or unfinished scans, identity
  changes, and undo during an in-flight send. Additional cases check transaction
  aborts, speed-window expiry and recovery after malformed worker input.

## Replaying a recorded fault

Use an idle checkout with the prerequisites from `AGENTS.md` installed. Run the
normal checks first. The replay tool intentionally edits production source for
one test run, so do not run the app, another build or another audit concurrently.

```powershell
python tools/test-audit/run.py --list
python tools/test-audit/run.py --fault EXT-001
```

The tool requires a passing baseline, refuses edits when the recorded source no
longer matches, preserves a backup and logs in a temporary directory, restores
the source, and checks the named test failures. A compiler or setup failure is
not accepted as success. Re-run `cd extension; npm run check` afterwards to
verify the restored checkout and refresh compiled outputs. Replay IDs are
listed in the ledger; choose any listed ID rather than assuming an ordering.

## Practical limits

These checks use fake libraries, IndexedDB, temporary SQLite databases, the fake
Python embedder and simulated trash. They do not validate real GPU inference,
Chrome extension lifecycle behavior or Google's current undocumented responses.
For the changed scan and trash paths, also go through sections **2. Scan**,
**3. Protection choices**, **4. Duplicates**, and **7. Updates and interruptions**
of [the browser manual checks](extension-manual-checks.md).

Raw exploratory runs include surviving and equivalent mutations. They should
not be interpreted as missing coverage merely because a redundant guard can be
removed without changing behavior. The committed ledger retains observed
assertion failures for the tested fault examples.
