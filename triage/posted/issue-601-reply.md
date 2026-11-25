@eight04 Yes, it could be made optional.

What it's for: "Read and modify browser settings" is Firefox's label for the whole `browserSettings` API, but Snap Links only uses one setting from it, `contextMenuShowEvent`, which decides whether the right-click menu opens when you press the mouse button or when you release it. On Linux and macOS it opens on press, so the menu popped up on top of every right-button lasso (#400). Since 3.2.0, Snap Links switches it to "on release" while the right button is the selection button, and puts it back when you choose another button. It doesn't read or change anything else.

Why everyone gets asked: the permission is listed as required, so Firefox asks every user when updating. On Windows the menu already opens on release, and with the left or middle button as the selection button it isn't needed at all.

Making it optional would mean:

- Firefox no longer asks anyone when updating.
- On Linux and macOS with the right button, the menu shows up after a lasso again until you allow it once, with an "Allow" button on the options page (like the one for bookmarks).
- Nothing changes on Windows, or with the left or middle button.

It's a small change, since the code already skips the setting when the API isn't available. @cpriest, would you like it optional? If so, I'll send a PR.
