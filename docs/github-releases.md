# Automatic GitHub release ZIPs

The `Build and Package` workflow checks every push and pull request. Every successful push to **master** also
builds the configured extension and publishes a GitHub Release with `photo-cleaner-<version>.zip`.
Merging a PR into master produces a push and follows the same path. There is no path filter, so
documentation-only pushes also get a release. Failed checks/builds/uploads do not publish a release.

This is a GitHub Release, not an automatic Chrome Web Store submission. Download the ZIP from
[Releases](https://github.com/gaborbiro/google-photo-cleaner/releases), perform the relevant Chrome
checks, then submit it with the hand-started `Submit to Chrome Web Store` workflow (see
[Submitting from GitHub](chrome-web-store.md#submitting-from-github)) or in the store dashboard.
No laptop packaging is needed for this normal flow.

## One-time repository-owner setup

1. Create the production GA4 property and Web stream separately from `Photo Cleaner Extension — Test`.
   Create its Measurement Protocol secret. Follow `usage-events-setup.md` for retention, advertising
   settings, custom definitions and manual reporting checks. “Test” names an Analytics property;
   it is not an extension release channel. Normal releases have Analytics debug mode off.
2. In GitHub repository **Settings → Secrets and variables → Actions**, add:

   | Kind | Name | Value |
   |---|---|---|
   | Repository variable or secret | `GA4_MEASUREMENT_ID` | Production Web stream's `G-…` ID |
   | Repository secret | `GA4_API_SECRET` | Production Measurement Protocol API secret |

   Either location works for the Measurement ID; if both exist, the variable takes precedence.
   The local `extension/usage.config.json` stays git-ignored and is used only for explicit local
   debug builds. CI production builds use the two environment settings exclusively and force
   `debug: false`. They refuse missing/invalid settings rather than falling back to the test file.
   The secret is encrypted by GitHub in repository settings, but remains extractable from the
   public extension ZIP, as agreed for direct Analytics collection.
3. Allow GitHub Actions in repository settings. The workflow requests `contents: read` for the
   build/check job and `contents: write` only for the dependent publish job. It uses GitHub's
   built-in `GITHUB_TOKEN`; no personal token or Chrome Web Store credentials are required.
   Any organization policy that forbids the requested write permission must be resolved by its owner.
4. Publish the analytics privacy policy and update the live store disclosures before distributing
   a configured extension to users. The existing Pages workflow publishes policy changes separately.
5. Put this workflow and its supporting source changes on master. The first master push runs it;
   the repository owner can also use **Actions → Build and Package → Run workflow**, selecting master, to verify it.

The current local GitHub CLI login was confirmed to have only READ access to this repository.
It cannot add these repository settings or activate the remote changes. Preparing local code does
not enable the workflow on GitHub. The first real run and asset download must be checked after
the changes are pushed and the settings are supplied.

## Versioning and retries

The source manifest version remains useful for local development. GitHub stamps a separate version
into its own checkout **before checks and packaging**. The number is the fixed release epoch
`0.4.54` plus `GITHUB_RUN_NUMBER`, carrying components at Chrome's limit of 65,535. For example,
workflow run 20 produces `0.4.74`. Runs on other branches/PRs can create gaps in release numbers;
that is intentional. Reverting the source manifest cannot cause a release version to go backwards.

Nothing commits back to master, so there is no release-commit loop. Keep this workflow's run counter
and fixed epoch; do not reset or reduce them. Raise the epoch deliberately if migrating to a different
workflow with a new run counter. Run-number retries use the same version and source commit.

The publisher pins the release to the checked commit, uploads the ZIP to an unpublished draft,
verifies its size and hash when supplied by GitHub, then publishes it. Re-running can resume the
matching draft and does not overwrite a published asset. A conflicting tag/commit or published ZIP
causes a clear failure. GitHub's semantic-version Latest selection is used so out-of-order build
completion does not simply mark the last finishing job as the intended newest version.

There is no cancellation/concurrency group that could discard intermediate master pushes. Each
successful run has its own artifact and version. Temporary Actions artifacts expire after seven days;
the published release assets remain available until explicitly removed.

## Local verification

`cd extension && npm run check` still checks the source without enabling Analytics, even if the local
test file exists. Automated tests exercise version carry/rollbacks, PR/branch refusal, environment-only
production configuration, draft upload/publish ordering, failed uploads and safe retries. They make no
GitHub release requests. A real hosted Actions run remains the acceptance check for repository
permissions, uploaded artifacts and the release download.

Official references: [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions),
[repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[release API](https://docs.github.com/en/rest/releases/releases),
[Chrome version limits](https://developer.chrome.com/docs/extensions/reference/manifest/version).
