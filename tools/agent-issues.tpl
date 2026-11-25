You are triaging open GitHub issues of cpriest/SnapLinksPlus, the browser extension whose code is in the current directory
(branch master = the latest release 3.2.1; ignore uncommitted changes). The maintainer is cpriest (Clint Priest). Goal: help him get
the number of open issues to zero, by telling him for every issue whether it can be closed and why, or what should happen with it.
Today is 2026-11-25. You are read-only: never comment on, label, edit or close anything on GitHub.

Background you can rely on:
- v2.x was the legacy XUL Firefox add-on. v3 (2017) is a complete WebExtension rewrite; reports about v2 behavior, Flash, Firefox <57,
  XUL, the "add-on bar", Waterfox Classic etc. are usually outdated. The maintainer said in several issues that v2 is no longer developed.
- 3.2.0/3.2.1 (2026-11-24): Manifest V3 for Firefox (event page) and Chrome/Edge (service worker); Firefox minimum 142.
- CLAUDE.md describes the current architecture, docs/History.md is the changelog, DevNotes.md lists known bugs and ideas,
  CONTEXT-GRAPH.md records decisions. The code is in src/ (content scripts in src/content-scripts/, background in src/background-scripts/,
  options page in src/html/options.html + src/lib/Options.js, preferences with defaults in DefaultPrefs in src/globals.js).

For EACH issue number listed at the end:
1. Read it with its comments: gh issue view <number> --repo cpriest/SnapLinksPlus --comments
2. Check against the current code and docs whether it still applies: grep src/ for the option, behavior or element type it is about,
   look it up in docs/History.md and DevNotes.md, and look at a related PR (gh pr view <n> --repo cpriest/SnapLinksPlus) when one is
   mentioned. Do not guess: claim "fixed" or "already implemented" only with evidence (a changelog line, a PR, a file and what it does).
3. Note duplicates among the open issues (gh search issues --repo cpriest/SnapLinksPlus --state open "<words>").

When you have checked every issue, your final answer must be ONLY a JSON array (no prose, no markdown fences), one object per issue in
the order given:
{
  "number": 123,
  "title": "the issue title",
  "author": "login of the issue author",
  "category": "fixed-or-implemented" | "outdated" | "duplicate" | "stale-needs-info" | "bug-still-relevant" | "feature-request" | "support-question" | "wontfix-candidate",
  "close_recommended": true | false,
  "confidence": "high" | "medium" | "low",
  "reason": "2-3 sentences: why, with dates and the maintainer's own comments where they matter",
  "evidence": ["what you checked: file paths with what they show, History.md lines, PR numbers, search results"],
  "related": [other issue or PR numbers],
  "fix_candidate": null or { "effort": "small" | "medium" | "large", "merge_likelihood": "high" | "medium" | "low", "approach": "1-2 sentences: what a fix or implementation would change in the current code, naming files" },
  "draft_comment": "a short, polite, factual comment that could be posted on the issue (2-4 sentences, no @mentions, no greeting)"
}
fix_candidate: for bugs and feature requests that a contributor could reasonably fix now with a small or medium PR; otherwise null.

Issues to triage: __ISSUES__
