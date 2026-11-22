Relates to #309.

> **Builds on #595 (Firefox MV3)**, whose event page changes this needs too, so please merge #595 first. This PR's own changes are the last three commits: 758241d, 3a1dc2d, 2cb19c6.

Chrome removed Manifest V2 in Chrome 139 ([timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline)), and the Chrome Web Store took MV2 items down. So the Chrome build no longer loads in Chrome or Chromium: *"cannot be installed because it uses an unsupported manifest version"* (checked in Chromium 151). Edge 158 still loads it, but copying fails there, because its background page cannot write to the clipboard (*"Document is not focused"*). This moves the Chrome build to Manifest V3.

- **The background is a service worker.** `service-worker.js` loads the polyfill and then the same scripts as Firefox's background, in the same order, with `importScripts()` (plus `DevBuild.js` in a `gulp watch` build). Like Firefox's event page, Chrome stops it when idle. The listener, `DOMReady` and `storage.session` changes from #595 already make the code fit for that.
- **A worker has no DOM.** `globals.js` no longer touches `document` at load time (`docElem` is undefined there), and Prefs load at once.
- **A worker has no clipboard.** Copying opens an offscreen document (`offscreen.html`, the `offscreen` permission), which copies with a textarea, as Chrome's sample does. The document is opened for the copy and closed after it. Copies run one at a time, and a document left open by a stopped worker is reused. That also **fixes copying in Edge**, which fails with the MV2 build.
- **Notification icons are full URLs.** A worker resolves relative paths from its own folder, and Chrome refuses a notification whose icon fails to load.
- `minimum_chrome_version` 116 (`runtime.getContexts`). `chrome_style` is gone (MV2 only). Permissions otherwise unchanged.
- **The Firefox package leaves out the Chrome-only files** (`FireFox.Exclude` in `gulpfile.js`): Firefox never runs them, and an AMO reviewer doesn't have to read them. `web-ext lint` on the Firefox build is unchanged by this PR.

### Changes
- `src/background-scripts/service-worker.js`, `OffscreenClipboard.js`, `src/html/offscreen.html`, `src/lib/Offscreen.js`: new, Chrome only.
- `background.js`: `WriteToClipboard()`, full icon URL, and `storage.session` without the in-memory fallback, now that both builds have it.
- `globals.js`: works without a document.
- `manifest.hbs`, `gulpfile.js`, `eslint/globals.js`, `CLAUDE.md`.

### Testing
- `npm test`: 419 passed (17 more than #595). `npm run lint`: clean.
- New unit tests:
  - `test.ServiceWorker.js` runs the real service worker in a context with no `document` and no `window`: what it imports, Prefs loading, top-level listeners, icon URLs, and the offscreen copy (opens, copies, closes, one at a time, reuses a leftover document, recovers from a failure).
  - `test.Offscreen.js` covers the offscreen page.
  - `test.Build.js` covers what the worker imports and which files each build contains.
- **In real browsers**, the same harness as #595, driven over the DevTools protocol with real input, headless:

| | Chrome build, MV2 (master) | Chrome build, MV3 (this PR) |
|---|---|---|
| Chromium 151, Windows | does not load | open tabs, copy, service worker stopped, activation/context menu, options page: all pass |
| Chrome for Testing 158, Linux | does not load | 11 of 12 scenario groups pass (the upgrade scenario is Firefox only); the 12th: see below |
| Edge 158, Windows | all pass except copy, which fails | open tabs, copy, new window, activation/context menu: all pass |
| Edge 158, Linux | 9 of 12 pass: copy fails (twice), plus the context menu below | 11 of 12 pass: only the context menu below |
| Service worker stopped on its own (30 s idle), then open and copy | n/a | pass; first tab 31 ms after the stop, 7.6 ms warm |

  The one check that fails on Linux fails the same way on `master`: on Linux, Chromium opens the context menu when the right button is *pressed*, before a drag starts, so the menu after a right-drag cannot be suppressed. That is #400, which only Firefox's `browserSettings` can fix. On Windows the check passes in Edge, before and after.

  Speed, Edge on Linux, from mouse release to the first new tab, 20 runs: median 12.1 ms (MV2) vs 13.4 ms (MV3).

  After the last commit (the clipboard code moved to its own file), these pass again: open tabs, copy, service worker stopped, and options page, in Edge and Chromium on Linux and in Firefox on Windows.

### Notes
- **Chrome Web Store:** the listing was removed, and the API cannot create one, so the first MV3 upload is manual. After that, the release workflow in #596 can publish it.
- Chrome's permission prompt is unchanged. `offscreen` shows no warning.
- I tested with the Chrome for Testing build of Chrome 158 and with Edge; not with branded Chrome on a desktop, Brave, Vivaldi or Opera.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
