**Category:** Ideas
**Title:** Tabs that close by themselves, and opening queued links one at a time: which way would you like?

---

@cpriest, before writing any code for these I'd like to know which way you prefer, or whether you'd rather not have them in Snap Links.

### 1. Tabs that close by themselves

Linkclump has a "close tab time" option: each tab it opens closes after a number of seconds. That is handy for download links: every tab starts its download and then goes away, including the "your download starts in 5 seconds" pages of file hosts.

How it could be started in Snap Links:

- **A. Rocker click.** While holding the button that draws the lasso, click the other button: the selected links open as tabs that close after N seconds (a new setting). Nothing that exists today is in the way. This is the one I like best.
- **B. A key at release.** Hold a combination such as Ctrl+Shift while releasing. Single keys are taken: Alt turns off the font-size filter while selecting, Ctrl swaps open and copy, Shift reverses the order.
- **C. Linkclump's action list.** Several triggers, each with its own action and options (also asked for in #33 and #377). The most flexible, and the biggest change.

Whichever it is: the timers would survive the background page being unloaded (Manifest V3), the same way the tab queue already keeps it awake, and a tab you are looking at would not be closed.

### 2. Opening queued links one at a time

#600 asks for the next link to open only once the current tab is closed, and #571 for it to open once the previous tab has finished loading. Both could be one setting with three modes: a fixed delay (as today), after the previous tab has loaded, or after it was closed. The queue would be kept in session storage so it survives the background unloading, and there would need to be a way to cancel what is left, for example a context-menu entry "Cancel 7 queued links".

### My preference

- **Closing tabs automatically: A, the rocker click.** It needs no new key combination to remember, nothing in Snap Links uses that gesture today, and the only new setting is the number of seconds.
- **The queue: a simple toggle**, "open the next link only when the current tab is closed", as #600 asks. The after-loading mode from #571 could join it later as a second option if you want it.

It is your project, though, so I would rather hear what you prefer before writing any code.

### Questions

1. For closing tabs automatically: A, B, C, or none?
2. For the queue: one setting with three modes, a simple on/off for "after closing" only, or none?
3. Anything about either that you would like done differently?
