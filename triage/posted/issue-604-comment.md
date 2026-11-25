A few updates on this:

- #422 turned out to be outdated, so it belongs on the close list: Firefox no longer has `webextensions.storage.sync.enabled` (I checked Firefox 161, only `.kinto` and `.serverURL` are left), and Snap Links needs Firefox 142 or newer. So I'm not sending that fallback. #459 (Tor Browser) still needs a retest by its reporter.
- The PRs I mentioned are open: #607 (the error when scrolling after a selection), #608 (the last `web-ext lint` warning) and #609 (#602's checkboxes; it changes the same line as #598, so whichever goes second needs a small rebase). #603 (colors) has two questions for you in its description.

I'd also like to help with the bigger items, but a lot of them are design decisions that are yours to make. If there are issues you'd like me to take on, feel free to assign me or tell me how you'd like them solved. I'm thinking especially of your own #301 (elements to target, with the sectioned preferences you planned) and #351 (the "ask me" menu). Small, clear bugs I'll keep fixing and sending as PRs for you to review.
