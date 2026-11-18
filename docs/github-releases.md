# Automatic GitHub release ZIPs

The `Build and Package` workflow checks pushes to master and every pull request (a push to another
branch is checked only through its pull request). A successful push to **master**
that raises the extension's version also builds the configured extension and publishes a GitHub
Release with `photo-cleaner-<version>.zip`. Merging a PR into master produces a push and follows the
same path. A master push that doesn't raise the version (documentation, for example) is checked but
releases nothing, with a "No release" warning on the run. Failed checks/builds/uploads do not publish a release.

This is a GitHub Release, not an automatic Chrome Web Store submission. The ZIP in
[Releases](https://github.com/gaborbiro/google-photo-cleaner/releases) is handy for giving someone a
build. To send master to the store, start the `Submit to Chrome Web Store` workflow, which picks
this release by master's version (see
[Submitting from GitHub](chrome-web-store.md#submitting-from-github)), or upload the ZIP in the store dashboard.
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
   debug builds. CI production builds use the two environment settings and force `debug: false`.
   Local packaging can instead read the same names from git-ignored `extension/local.properties`
   (copy `local.properties.example`); environment settings take precedence and a partial environment
   configuration is refused. Production builds never fall back to the test file.
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

A release has exactly the version in `extension/static-app/manifest.json`, the same number a local
build shows in the panel and Settings ("v0.5.18 · local build"). So the version you tested locally is
the version you submit to the store. Every local rebuild raises the patch number (AGENTS.md), so a
merge to master normally carries a new, higher version.

Before checks and packaging, the workflow lists the published (non-draft) releases. It releases only
when the manifest version is higher than all of them, comparing numerically. Otherwise it warns and
releases nothing: a published release is never replaced, and a revert can't make versions go backwards.
Gaps between release numbers (the local rebuilds in between) are expected.

Until 2026-11-18 CI ignored the manifest and released `0.5.0` plus the workflow's run number, so
`v0.5.5`–`v0.5.12` don't match the local builds that showed the same numbers. Before 2026-10-29 the
workflow was `build-and-release.yml`, releasing up to `v0.4.64`.

Nothing commits back to master, so there is no release-commit loop. Re-running a run whose publish
step failed resumes its unpublished draft (drafts don't count as published).

The publisher pins the release to the checked commit, uploads the ZIP to an unpublished draft,
verifies its size and hash when supplied by GitHub, then publishes it. Re-running can resume the
matching draft and does not overwrite a published asset. A conflicting tag/commit or published ZIP
causes a clear failure. GitHub's semantic-version Latest selection is used so out-of-order build
completion does not simply mark the last finishing job as the intended newest version.

There is no cancellation/concurrency group that could discard intermediate master pushes. Each
successful run has its own artifact and version. Temporary Actions artifacts expire after seven days;
the published release assets remain available until explicitly removed.

## Local verification

`cd extension && npm run full` still checks the source without enabling Analytics, even if the local
test file exists. Automated tests exercise choosing the release version, PR/branch refusal, environment-only
production configuration, draft upload/publish ordering, failed uploads and safe retries. They make no
GitHub release requests. A real hosted Actions run remains the acceptance check for repository
permissions, uploaded artifacts and the release download.

Official references: [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions),
[repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[release API](https://docs.github.com/en/rest/releases/releases),
[Chrome version limits](https://developer.chrome.com/docs/extensions/reference/manifest/version).
