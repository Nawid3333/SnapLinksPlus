# Session notes: Manifest V3 migration (2026-11-22)

This branch holds notes, nothing that ships. **Latest: [HANDOFF-2026-11-25.md](HANDOFF-2026-11-25.md)** (open PRs #603, #607-#609, posts #601, #604-#606, next steps). It has no history in common with `master`, so it can never end up in a pull request. Read this first when working on these PRs again.

## The pull requests (opened 2026-11-22 to cpriest/SnapLinksPlus)

| PR | Branch on this fork | What | Merge order |
|---|---|---|---|
| [#594](https://github.com/cpriest/SnapLinksPlus/pull/594) | `fix/options-duplicate-copy-format` | Removes the second "Copy links as" select that #589 brought in (two `id="CopyFormat"`, the second never saved), plus a unique-id test | any time |
| [#595](https://github.com/cpriest/SnapLinksPlus/pull/595) | `feat/manifest-v3-migration` | Firefox to MV3: event page fixes, CSP, options page styles, site access note | before #597 |
| [#596](https://github.com/cpriest/SnapLinksPlus/pull/596) | `ci/release-workflows` | CI (pinned actions, Node 22+24, Windows unit tests, web-ext lint, artifacts); release workflow (GitHub Release, AMO listed, Chrome Web Store, Edge Add-ons); `docs/Releasing.md` | any time |
| [#597](https://github.com/cpriest/SnapLinksPlus/pull/597) | `feat/chrome-mv3` | Chrome to MV3: service worker, offscreen clipboard; Chrome-only files left out of the Firefox build | after #595 (stacked on it: its own commits are the last three) |

All four had green CI and were mergeable when opened. The PR texts as posted are in `prs/`.

**If the maintainer asks for changes:** clone this fork, check out the PR's branch, commit, push to the fork (the PR updates itself). If #595 changes, rebase `feat/chrome-mv3` onto it and force-push that branch. If #594 is merged first, #595 and #597 still merge cleanly (they touch other lines of `options.html`). Run `npm test` and `npx eslint src/ --rule "linebreak-style: off"`: on a Windows checkout with `core.autocrlf=true` every line fails the linebreak rule, CI on Linux does not.

**Delete the branches** on this fork once their PR is merged or closed. `bookmark-links` and `smarter-duplicate-links` are from earlier work (#589, #583), not from this session.

## What was found (details in the PRs and in CONTEXT-GRAPH.md on the PR branches)

- **Firefox MV3 event page:** Firefox keeps only the listeners added while the background script first runs; only those wake a suspended page. On `master`, `runtime.onMessage` was added after Prefs loaded, so in MV3 the first selection after an idle unload was dropped. Any extension API call resets the 30 s idle timer (`extensions.background.idle.timeout`).
- **MV2 → MV3 update keeps site access:** verified with permanent installs in Firefox Developer Edition 161 (`upgrade-permanent.mjs`). Temporary installs (about:debugging) always get host access, so they cannot show this. Firefox's source looked like it would not grant it (`Extension.sys.mjs`, `ADDON_INSTALL` only), but `ExtensionData.migratePermissions()` does.
- **`browser_style` is gone in MV3:** the options page lost its font and spacing; `options.html` sets them now (flex column, `font: caption`, no margins).
- **Edge copy is broken on `master`** (MV2 background page: "Document is not focused"); the MV3 offscreen document fixes it.
- **Chrome/Edge on Linux** open the context menu on mouse press, so the menu after a right-drag cannot be suppressed there (#400; only Firefox's `browserSettings` can fix it). Same on `master`.
- Speed (first tab after mouse release, median of 20): Firefox 4.8 ms (MV2) vs 6.8 ms (MV3); Edge on Linux 12.1 vs 13.4 ms. A suspended Firefox event page / stopped Chrome worker adds about 25-30 ms to the first action.

## Test results at the time the PRs were opened

| | `master` (MV2) | PR builds (MV3) |
|---|---|---|
| Firefox 160, Windows | 13/13 scenario groups | 13/13 (#595 alone, and with #597) |
| Firefox 160, Linux (WSL) | 13/13 | 13/13 |
| Edge 158, Windows | all but copy | #597: open, copy, new window, activation pass (partial run, see below) |
| Edge 158 / Chrome for Testing 158, Linux | Edge: copy fails + Linux context menu; Chrome: does not load | 11/12, only the Linux context menu |
| Chromium 151 | does not load (MV2 removed) | passes |

Not tested: macOS, branded desktop Chrome, Brave/Vivaldi/Opera, the release workflow end to end (needs a tag and store keys).

## Running the real-browser tests again (`e2e/`)

Node only, no npm packages. Firefox is driven over WebDriver BiDi (`session.mjs`), Edge/Chromium over the DevTools protocol (`chromium.mjs`). 13 scenarios: tabs in every placement mode, copy formats, new window, bookmarks, checkboxes/radios/clickables, activation buttons/modifiers/Escape/context menu, iframes, autoscroll, overlay, event page suspension, MV2 → MV3 upgrade, speed, options page.

```
node e2e/e2e.mjs --help
node e2e/e2e.mjs --build <build/ff> --upgrade-from <a master build/ff> [--scenarios 1,2] [--idle-timeout 3000]
```

Scripts here contain `<WORKDIR>`: replace it with your working directory (builds, harness and downloads were all under one directory).

**Edge/Chromium only in WSL, never on the Windows desktop.** Edge on Windows plays a sound for an extension's notification from its own process (Snap Links shows "Installed" in every fresh test profile). It is not a Windows notification, and neither `--mute-audio` nor `--disable-features=NativeNotifications,SystemNotifications` stops it. In WSL, `chromium.mjs` gives the browser no audio server (WSLg would forward PulseAudio to the Windows speakers) and ALSA's null device; on Windows it refuses to start Edge/Chromium unless `E2E_ALLOW_SOUND=1`. Firefox is silent on Windows (`alerts.useSystemBackend=false`).

- WSL Ubuntu has Firefox at `/opt/firefox` and Node. `get-linux-chromiums.sh` downloads Chrome for Testing and Edge for Linux into `~/snaplinks-e2e-browsers` (no sudo); `run-linux-chromium.sh` runs the harness with them; `batch-linux.example.sh` is the last full batch.
- `get-devedition.sh` + `upgrade-permanent.mjs`: the real (permanent) MV2 → MV3 update test.
- `shots.mjs`: screenshots of the options page in about:addons.
- `audio-check/`: proves a run is silent. `watch.ps1` logs every Windows audio session that starts playing, with its peak level (Core Audio, `AudioWatch.cs`); `play-quiet.ps1` is an inaudible -60 dB control tone that it must detect (peak about 0.001). `<WORKDIR-MARKER>` is a string that appears in the test browsers' command lines (their profile directory).

Calling WSL from Git Bash rewrites `/mnt/c/...` arguments into Windows paths: start WSL runs from PowerShell, or set `MSYS_NO_PATHCONV=1`.

## Offered to the maintainer, not done

- The e2e harness as its own PR (`npm run e2e` plus a CI job), if he wants it (offered in #595).
- `History.md` and the version bump were left for the release.
