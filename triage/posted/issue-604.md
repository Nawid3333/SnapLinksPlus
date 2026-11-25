**Title:** Issue triage for 3.2.1: 17 issues that look closable, duplicate groups, notes on the open PRs, and two questions

---

@cpriest, to help get the tracker down after 3.2.0/3.2.1, I went through all 68 open issues and both open pull requests and checked each against the current code (master = 3.2.1). The first pass was done by AI agents that read every issue and the code it refers to; every close suggestion was then fact-checked by a second model and, where they disagreed, by hand. Anything still in doubt is not on the close list. You know the history better than I do, so treat this as a list of suggestions.

### Issues that look closable

| Issue | Why |
|---|---|
| #54 Disable by domain | The per-site disable list shipped in 3.2.0 (#584). |
| #322 Eliminate duplicate links | Duplicate detection shipped in 3.2.0 (#583). Its "already visited" part is #475. |
| #328 Default action: copy or open | The default action setting is there since 3.1.8 (#303); 3.2.0 added more actions. |
| #495 Lasso partly broken in 3.1.12 | The scroll-down bug fixed in 3.2.0 (#585), same as the closed #516/#566. |
| #392 Copy doesn't work on http sites | Copying moved to the background page in 3.1.14 (#518), so the page's insecure context no longer matters. Worth a retest by the reporter. |
| #432 Selection triggered on a short right click | The context-menu timing fix in 3.2.0 (#577/#400); a click without movement never starts a lasso. Worth a retest. |
| #243 Contending with the context menu | Same as above; the original report was on Waterfox 56. Worth a retest. |
| #388 Waterfox 2020-10 | Waterfox Classic is Gecko 68; Snap Links now needs Firefox 142+. |
| #145 Drag after right-clicking Flash | Needs Flash to reproduce, which no browser has had since 2021. |
| #55 Time delay / on-off button | You wrote "Closing this, if it is still desired then I will re-open" in 2019; it stayed open. |
| #537 Checkboxes in Prowlarr | Same cause as #602 (the label hit test at ElementIndexer.js:362); #602 has the analysis. |
| #453 Links to files | Same as the older #151. |
| #337 Only works on page one of phpMyAdmin | You asked for a URL in 2021; no reply. |
| #411 Not working to open links from a website | You could not reproduce it in 2022; no reply. |
| #445 Copy opens tabs instead | No details since 2023-02. |
| #470 Suddenly opening duplicates | Intermittent; your 2024 comment: "tough to fix without a testable use case". |
| #329 Draw a curved line to select | You said in 2021 you weren't up for it; it would be a redesign of the selection. |

And one of yours: **#38** (delay on right-click). Your idea from 2014, doing the heavy work only once the drag starts, is how the code works now (the index is built on the first move, ElementIndexer.js:172), so it may be done.

### Duplicate groups (could each become one issue)

- #602, #537, #552: checkboxes and radio buttons not picked up (label hit test, `pointer-events: none`); PR #598 fixes #552
- #422, #459: Snap Links fails when sync storage is off (Firefox pref, Tor Browser)
- #43, #207: links in image maps
- #185, #232: selecting across iframes
- #249, #301: choosing which kinds of elements to select (#301 is your design ticket)
- #571, #600, #599: how queued tabs open (after loading, after closing, the shared queue optional)
- #33, #377: different actions for different activation keys
- #46, #351, #70: choosing the action from a menu after selecting

### The open pull requests

- **#598** (pointer-events: none): looks correct and minimal, with tests, and applies cleanly to 3.2.1. Its CI has not run yet: a first-time contributor's workflow runs wait for your "Approve and run". A fix for #602 would change the same line, so #598 first would be easiest.
- **#574** (README, Linkclump comparison): the changes you requested on 2026-11-16 have not come, the features it lists as "planned" shipped in 3.2.0, and its workaround paragraph is about #400, which is fixed.
- **#603** (mine, draft): color choices for the selection, with two questions for you in its description.

### Question 1: line endings and linting the whole repository

The repository is LF (`.editorconfig` says so, and ESLint's `linebreak-style` checks it), but there is no `.gitattributes`. On Windows, Git's default `core.autocrlf=true` then checks every file out with CRLF, and `npm run lint` reports 3,674 `linebreak-style` errors on a fresh clone. Nine files are also stored with CRLF (the `.idea/*.xml` files).

The usual fix for JavaScript projects is a `.gitattributes` with `* text=auto eol=lf` (plus `binary` for the images), and a one-time `git add --renormalize .`, which changes only those nine `.idea` files. Every checkout then has LF on every platform.

Related: `npm run lint` checks only `src/`, but an editor's ESLint plugin checks every file it opens with `eslint.config.js`, which is written for `src/`. Outside `src/` that gives 158 problems: Node files (`eslint.config.js`, `eslint/`, `.webext-run.cjs`, `scripts/run-browser.mjs`) checked with browser settings, Jest's globals unknown in `tests/`, about 17 small style slips in the tests, and `build/` (including the vendored `browser-polyfill.js`) not ignored.

Would you like one PR for both: the `.gitattributes`, and an `eslint.config.js` that ignores the build output, uses Node settings for the config and scripts and Jest's for the tests, with the test slips fixed, so that `eslint .` is clean everywhere (and `npm run lint` could check the whole repository)? I could also drop the unused callback parameters such as `(data) =>` that editors flag, which your config allows, or leave those as they are. And since that config gets rewritten anyway, it could become an ES module (`eslint.config.mjs`); I saw the switched-off `"xxtype": "module"` in `package.json`, so tell me if you would like more of the tooling (gulpfile, Jest config) moved to ESM, or none of it. The extension scripts themselves would stay as they are, since content scripts cannot be modules without a bundler.

### Question 2: releases

For 3.2.0 and 3.2.1 the release workflow's store jobs were skipped (`PUBLISH_TO_AMO` and the others are not set), and 3.2.0 reached AMO by hand; 3.2.1 is not on AMO yet. If you would like the workflow to publish to AMO, I can make the AMO job safe to re-run (a version AMO already has counts as done) and retry it automatically after a GitHub outage. If you prefer publishing by hand, there is nothing to do.

### What I would like to send next (tell me if you'd rather not)

Small PRs, each with tests: the #422 sync-storage fallback; the #602 checkbox fix (after #598); the scroll handler that rebuilds the index and throws after every selection (`ElementPositionsChanged` reaches `Search()` after the lasso container is removed), found while reviewing; and removing the last `web-ext lint` warning (`innerHTML` in `CreateElement`).

The full table of all 68 issues, with the reasoning for each, is available if it helps.
