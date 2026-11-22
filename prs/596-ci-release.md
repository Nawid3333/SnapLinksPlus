Two workflow changes and a guide. Nothing in the extension changes.

### CI (`nodejs.yml`)
The file, the workflow name and the `build` job keep their names, so the check stays "build (22.x)" if branch protection requires it.
- Actions are pinned to the commit of a release (tag in the comment). Dependabot now also proposes updates for them (`github-actions` ecosystem, monthly).
- `permissions: contents: read`. A newer push to a pull request cancels its older run; other runs always finish.
- Node 22 and 24.
- `web-ext lint` on the Firefox build, the checks AMO runs on upload. Errors fail the run; the two existing `innerHTML` warnings are only listed.
- Both packaged builds are kept as artifacts for 30 days. A pull request can then be tried without building it, via about:debugging > Load Temporary Add-on.
- A Windows job runs the unit tests (lint is skipped there: the Windows checkout has CRLF line endings).

### Release (`release.yml`)
Runs on a pushed tag `vX.Y.Z`, or by hand for an existing tag:
1. Checks that the tag matches `package.json` and is on `master`. Then lint, tests, both builds, `web-ext lint`, and packages.
2. Creates a GitHub Release with `snaplinks-vX.Y.Z-firefox.zip` and `-chrome.zip`, and notes generated from merged pull requests.
3. Submits the Firefox build to AMO on the listed channel (`web-ext sign --channel listed --approval-timeout 0`), with the same API key as `gulp publish`.
4. Chrome Web Store (API V2) and Edge Add-ons (API v1.1) jobs. They skip with a notice while the Chrome build is Manifest V2, because both stores refuse it.

Each store job runs only when its repository variable is `true` (`AMO_PUBLISH`, `CWS_PUBLISH`, `EDGE_PUBLISH`). So nothing goes to a store until you set it up, and forks never try. The jobs are independent: a failed one can be re-run alone and leaves the others and the GitHub Release alone. Store credentials are secrets of a `release` environment that only `v*` tags may use, so a pull request's workflow cannot read them. `gulp publish` keeps working as before.

`docs/Releasing.md` explains how to cut a release, and how to set up the environment and each store's credentials, step by step. `docs/Contributing.md` links to it.

### Testing
- CI ran on my fork for this branch: green, on Node 22 and 24 and on Windows ([run](https://github.com/Nawid3333/SnapLinksPlus/actions/runs/45041515317)).
- `gulp package` checked locally: it produces the zips the release job picks up.
- Both workflows pass `actionlint` (with shellcheck) and `zizmor`: no findings. Its pedantic mode only notes the deliberately unnamed `build` job.
- The release workflow has not run end to end. That needs a tag and store credentials, so the first real release is its first run. The store API calls follow the documentation linked in the workflow ([Chrome Web Store API V2](https://developer.chrome.com/docs/webstore/using-api), [Edge Add-ons API](https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api)). A fork with no store variables set runs only the build and GitHub Release jobs, a safe way to try it first.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
