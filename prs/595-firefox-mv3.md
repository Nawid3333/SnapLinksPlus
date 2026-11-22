Moves the **Firefox** build to Manifest V3. Users see no difference: same permissions, same add-on id, preferences kept, and the options page looks as before. The Chrome build keeps its Manifest V2 manifest here. #597 moves it to MV3 on top of this PR, so it loads in Chrome again.

Firefox still supports MV2, so nothing forces this today. MV3 is where Firefox and Chrome are going, and it lets one codebase serve both again. Mozilla's [migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/) was the checklist.

### What MV3 changes, and how this handles it
- **The background becomes an event page.** Firefox unloads it after 30 s idle and loads it again for the next event, which clears every variable. Firefox keeps only the listeners added while the script first runs. `runtime.onMessage` was added once Prefs had loaded, so **on a woken page a selection's message reached no action listener and was dropped** (links not opened, nothing copied). The fixes in `background.js`:
  - all listeners at the top level; handlers wait for `DOMReady`, so a waking message runs with the stored Prefs, not the defaults
  - install/update notifications have fixed ids and one top-level `onClicked` listener, so a click after an unload still opens the page
  - a top-level `storage.onChanged` listener wakes the page when a preference changes, so a new activation button applies the #400 context-menu timing at once
  - the `TABS_OPEN_NATURAL` tab stacks live in `storage.session`, so placement continues after an unload
  - while links are queued, an API call every 10 s keeps the page loaded; otherwise a `NewTabDelayMS` over the idle timeout would drop the rest of the queue
- **The extension CSP now also covers content scripts.** `RateReporter` (debug timing) used `new Function()`; it fills its placeholders by name instead. `web-ext lint` warnings go from 3 to 2 (the `eval` one is gone).
- **`browser_style` is gone.** It gave the options page its font and spacing in about:addons. `options.html` now sets those itself; screenshots before and after match.
- **Users can withdraw site access in MV3** (about:addons > Permissions, or per site). Without it, Snap Links does nothing on those sites, so the options page shows *"Snap Links is not allowed to run on all websites… [Allow on all websites]"*, and opens after an install or update that lacks it. An update from the current MV2 version **keeps** site access: Firefox grants origins the old version required (`ExtensionData.migratePermissions()`). That was tested with permanent installs, see below.
- `chrome_style` is dropped from `options_ui` (MV2 only).

### Changes
- `manifest.hbs`: Firefox `manifest_version: 3`. Chrome's manifest is unchanged, byte for byte.
- `background.js`: the event page changes above.
- `globals.js`, `eslint/globals.js`: `ALL_SITES_PERMISSION`.
- `Options.js`, `options.html`: the site access note, and the styles `browser_style` gave.
- `Utility.js`: `RateReporter` without `new Function()`.
- `CLAUDE.md`, `CONTEXT-GRAPH.md`: how the event page works, and what was learned, with references to Firefox's source.

### Testing
- `npm test`: 402 passed (20 new). `npm run lint`: clean. `web-ext lint`: 0 errors.
- New unit tests:
  - `test.Build.js`: the MV3 manifest shape, unchanged permissions, no string evaluation in any built script
  - `test.Background.js`: listeners added before Prefs load; a waking message uses the stored Prefs; tab stacks and notification clicks survive an unload; the keep-awake timer; the site access check
  - `test.Options.js`: the Allow note
  - `test.Utility.js`: `RateReporter` in a context that refuses to evaluate strings

  5 of the 6 event page tests fail against `master`'s `background.js`; the sixth checks that clicks on other notifications are ignored.
- **In real Firefox**, driven over WebDriver BiDi with real mouse and keyboard input, headless, 13 scenario groups. They cover:
  - opening tabs in every placement mode, Shift-reversed order, new window
  - copy formats, bookmarks with and without the permission
  - checkboxes, radios and clickables
  - left/middle button, modifiers, Escape, the suppressed context menu
  - iframes, autoscroll, the overlay
  - the event page suspended between actions
  - the MV2 → MV3 upgrade, timing, the options page

| | MV2 (master) | MV3 (this PR) |
|---|---|---|
| Firefox 160, Windows 11 | 13/13 | 13/13 |
| Firefox 160, Linux (WSL) | 13/13 | 13/13 |
| Event page unloaded after 3 s idle, then open / copy / new window / bookmark | n/a | all pass |
| #400: `ui.context_menus.after_mouseup` set while RMB activates; drag recovery on Linux only | pass | pass (Windows and Linux) |
| Upgrade from 3.1.16 (MV2), temporary installs | n/a | prefs kept, onInstalled ran, works in old and new tabs |
| Upgrade 3.1.16 → 3.1.17, **permanent** installs, Firefox Developer Edition 161 | n/a | prefs kept, `<all_urls>` kept, works at once, no options page |

- Speed, Firefox on Windows, 20 runs each, back to back, from mouse release to the first new tab:

  | | MV2 | MV3 |
  |---|---|---|
  | Median | 4.8 ms | 6.8 ms |
  | Extension process CPU over the 20 runs | 186 ms | 205 ms |

  The ~2 ms is the `storage.session` read and write for the tab stacks. If the event page was unloaded, the first tab takes about 32 ms while Firefox starts the page again. The last of 3 tabs takes 115.5 ms (MV2) vs 117 ms (MV3); that time is mostly `NewTabDelayMS`.

### Notes
- No version bump, and no `History.md` entry: I left both for the release.
- Each time the event page starts, it re-applies the #400 `browserSettings` value, which Firefox writes to its settings file. MV2 did that once per browser start.
- #594 (the duplicated "Copy links as" select) touches other lines of `options.html` and merges cleanly in either order.
- The real-browser harness behind the tables (Node, no dependencies; WebDriver BiDi for Firefox, the DevTools protocol for Edge/Chromium) isn't part of this PR. If it would help, I can send it as a separate PR, as `npm run e2e` with a CI job.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
