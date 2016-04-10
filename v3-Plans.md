### Version 3 in the works
Snap Links v3 is in the works though progress is going slowly.  This is due to the change to [Multiorocess Firefox]( and that [XUL based](https://developer.mozilla.org/en-US/Add-ons/Overlay_Extensions) add-ons are being deprecated in favor of [WebExtensions](https://developer.mozilla.org/en-US/Add-ons/WebExtensions).

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
