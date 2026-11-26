> **Note, November 2026:** This is the 2016 plan for Snap Links 3, kept as it was written; the statuses in the tables are from 2016. Version 3 was released long ago (the release notes list 3.1.0.4 on 2016-11-15); Snap Links 3.2 followed in November 2026. Some links below no longer work: "Release Notes" pointed to the old `v3` branch, which no longer exists, and MDN has removed its Multiprocess Firefox and XUL overlay pages. The release notes for 3.0 and later, including the 3.0 betas, are on the [website](https://cpriest.github.io/SnapLinksPlus/#/History). Open bug reports and requests are in the [issues](https://github.com/cpriest/SnapLinksPlus/issues).

### Version 3
Version 3.0b1 is due to be released very soon, it's being reviewed by Mozilla AMO for inclusion as a beta version.

See [Release Notes](https://github.com/cpriest/SnapLinksPlus/blob/v3/ReleaseNotes.md) for detailed information.

### Background
Snap Links v3 is in the works.  This is due to the change to [Multiprocess Firefox](https://developer.mozilla.org/en-US/Firefox/Multiprocess_Firefox) and that [XUL based](https://developer.mozilla.org/en-US/Add-ons/Overlay_Extensions) add-ons are being deprecated in favor of [WebExtensions](https://developer.mozilla.org/en-US/Add-ons/WebExtensions).

This also means the first release versions will be much less feature-full than the now in maintenance-only development v2 line.

This wiki is setup to track desired features/requests, the plan and status.

### Basic Features
|Feature|Notes|Status|
|-------|-----|------|
|Selection Rectangle|Basic selectable rectangle following mouse.|Completed / Functional|
|  Auto-scrolls|Rectangle will auto-scroll the document left/right/up/down|Completed / Functional|
|Selectable Element Indexer|**New to v3** Indexing of Elements allows for greater performance|In Progress|
|With *Selected*|Do *This* - Similar to v2 it will support open in new tabs, open tabs in new window, etc.  This will possibly be an extension point for community contribution via a defined API.|Planned|


### Requested Features
|Feature|Notes|Status|
|-------|-----|------|
|[#87](https://github.com/cpriest/SnapLinksPlus/issues/87) - Fire .click() Event|Allow for firing .click() event on selected elements|Under Consideration|
