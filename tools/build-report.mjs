// Builds REPORT.md from the agent verdicts (parsed-all.json), the DeepSeek check and the final calls below.
import fs from 'node:fs';

const verdicts = JSON.parse(fs.readFileSync('parsed-all.json', 'utf8')).filter(x => !x.recommendation);
const issues   = Object.fromEntries(JSON.parse(fs.readFileSync('issues.json', 'utf8')).map(i => [i.number, i]));

// Final calls after the DeepSeek check and the code checks: [decision, kind, why]
const Final = {
	54:  ['close', 'implemented', 'The per-site disable list shipped in 3.2.0 (#584).'],
	322: ['close', 'implemented', 'Duplicate detection shipped in 3.2.0 (#583); the visited-links part is #475.'],
	328: ['close', 'implemented', 'Default action Open/Copy since 3.1.8 (#303); more actions in 3.2.0.'],
	495: ['close', 'fixed', 'Autoscroll down fixed in 3.2.0 (#585), the same bug as the closed #516/#566.'],
	392: ['close', 'fixed (retest)', 'Copying moved to the background page in 3.1.14 (#518), so an http page no longer blocks it.'],
	432: ['close', 'fixed (retest)', 'Context menu timing fixed in 3.2.0 (#577/#400); a click without movement never starts a lasso (Activation_Min).'],
	243: ['close', 'fixed (retest)', 'The same context-menu problem, fixed in 3.2.0 (#577/#400); first reported on Waterfox 56.'],
	388: ['close', 'outdated', 'Waterfox Classic (Gecko 68); Snap Links now needs Firefox 142+.'],
	145: ['close', 'outdated', 'Needs Flash content to reproduce; Flash is gone from every browser since 2021.'],
	55:  ['close', 'outdated', 'The maintainer wrote "Closing this" in 2019 but never closed it; per-site disable (3.2.0) covers the rest.'],
	537: ['close', 'duplicate of #602', 'The same label hit-test bug at ElementIndexer.js:362; #602 has the analysis and the fix.'],
	453: ['close', 'duplicate of #151', 'The same file:// links problem as the older #151.'],
	337: ['close', 'stale', 'The maintainer asked for a URL in 2021; no reply since.'],
	411: ['close', 'stale', 'The maintainer could not reproduce it (2022); no reply since.'],
	445: ['close', 'stale', 'No details and no reply since 2023-02.'],
	470: ['close', 'stale', 'Maintainer: "tough to fix without a testable use case" (2024-03); intermittent.'],
	329: ['close', 'not planned', 'The maintainer said in 2021 he is not up for it; freeform selection would be a redesign.'],
	38:  ['close?', 'maintainer\'s call', 'His own 2014 idea (do the heavy work only once the drag starts) is how the code works now: the index is built on the first move.'],
	46:  ['keep', 'feature', 'DeepSeek: the 3.2.0 actions are not context-menu entries; most of the wishlist is still open (overlaps #351).'],
	309: ['keep', 'tracker', 'Chrome builds are back, the Chrome Web Store listing is not; keep until it is.'],
	184: ['keep', 'needs a check', 'Not shown to be unfixable; the maintainer marked it for a release in 2017.'],
	421: ['keep', 'bug?', 'Middle-click paste after a middle-button drag: plausible, untested.'],
	447: ['keep', 'needs a check', 'A concrete archive.org URL was given and can be tested.'],
	459: ['keep', 'related to #422', 'Tor Browser: retest once the #422 storage fix is in.'],
	484: ['keep', 'needs a check', 'The claim that Firefox ties the two behaviors together is unproven.'],
};

const Clusters = [
	['#602, #537, #552 (and PR #598)', 'checkboxes and radio buttons not picked up: the label hit test and pointer-events: none, both at ElementIndexer.js:362'],
	['#422, #459', 'Snap Links fails when sync storage is off (a Firefox pref, Tor Browser)'],
	['#43, #207', 'links in image maps (<map>/<area>)'],
	['#185, #232', 'selecting across iframes'],
	['#249, #301', 'choosing which kinds of elements to select (#301 is the maintainer\'s design ticket)'],
	['#571, #600, #599', 'how queued tabs open: after loading, after closing, the shared queue made optional'],
	['#33, #377', 'different actions for different activation keys'],
	['#46, #351, #70', 'choosing the action from a menu after selecting'],
	['#151, #453', 'file:// links'],
	['#322 (rest), #475', 'skipping links already visited'],
	['#531, #484, #325', 'the opener tab (return to the parent on close, SameSite logouts)'],
	['#282, #526, #535, #482', 'the font size/weight filter picks the wrong links'],
];

const v     = Object.fromEntries(verdicts.map(x => [x.number, x]));
const esc   = s => s.replace(/\|/g, '/').replace(/</g, '&lt;');
const link  = n => `[#${n}](https://github.com/cpriest/SnapLinksPlus/issues/${n})`;
const call  = n => Final[n] ? `${Final[n][0]}: ${Final[n][1]}`
	: ({ 'bug-still-relevant': 'keep: bug', 'feature-request': 'keep: feature' })[v[n].category] || `keep: ${v[n].category}`;
const why   = n => Final[n] ? Final[n][2] : v[n].reason.split(/(?<=\.)\s/)[0];
const row   = n => `| ${link(n)} | ${esc(issues[n].title)} | ${issues[n].author.login} | ${issues[n].createdAt.slice(0, 4)} | ${call(n)} | ${esc(why(n))} |`;
const head  = '| Issue | Title | By | Opened | Call | Why |\n|---|---|---|---|---|---|';
const nums  = Object.keys(issues).map(Number).sort((a, b) => a - b);
const close = nums.filter(n => Final[n]?.[0] === 'close');
const kept  = nums.filter(n => Final[n] && !Final[n][0].startsWith('close'));
const count = cat => nums.filter(n => !Final[n] && v[n].category === cat).length;
const order = { high: 0, medium: 1, low: 2, small: 0, large: 2 };
const fixes = verdicts.filter(x => x.fix_candidate && Final[x.number]?.[0] !== 'close')
	.sort((p, q) => order[p.fix_candidate.merge_likelihood] - order[q.fix_candidate.merge_likelihood] || order[p.fix_candidate.effort] - order[q.fix_candidate.effort]);

const md = `# Snap Links Plus: triage of every open issue and pull request

As of 2026-11-25 (release 3.2.1): **68 open issues, 2 open pull requests.**

How this was made: five read-only Claude Code agents on \`glm-5.3-flash\` (through Ollama) read every issue with its comments and checked it against the current code, CLAUDE.md, History.md and DevNotes.md. A one-shot GLM pass gave an independent first opinion. \`deepseek-v4.1-flash\` fact-checked every close recommendation (15 agreed, 3 disagreed, 7 unsure), and the disputed code claims were checked by hand. Where they disagreed, the issue stays open below.

## Summary

| | Issues |
|---|---|
| Can be closed (implemented, fixed, outdated, duplicate, stale, not planned) | ${close.length} |
| The maintainer's call (his own issue, probably done) | 1 (#38) |
| Kept open after the cross-check, need a look first | ${kept.length} |
| Bugs still present | ${count('bug-still-relevant')} |
| Feature requests | ${count('feature-request')} |
| Other (wontfix candidates, support, needs info) still open | ${nums.length - close.length - 1 - kept.length - count("bug-still-relevant") - count("feature-request")} |

## Pull requests

| PR | Recommendation | Why |
|---|---|---|
| [#598](https://github.com/cpriest/SnapLinksPlus/pull/598) Fix lasso missing elements with pointer-events: none | **merge** | Correct and minimal: only a hit on an ancestor of a \`pointer-events: none\` element escapes the obscured check; two focused tests; applies cleanly to 3.2.1. Fixes #552. The #602 fix changes the same line (ElementIndexer.js:362), so #598 should go first. |
| [#574](https://github.com/cpriest/SnapLinksPlus/pull/574) README: Linkclump comparison | **close** (or wait for the author) | The changes requested on 2026-11-16 never came. Every row it marks "Planned" shipped in 3.2.0 (new window, one window each, bookmarks), and its Linkclump-as-workaround paragraph is about #400, which 3.2.0 fixed. |

## The maintainer's own issues

- ${link(38)} Right-clicking can cause a delay (2014): **probably done.** His idea, doing the heavy work only once the drag starts, is how the code works now: mousedown only creates the objects, the page index is built on the first mouse move (ElementIndexer.js:172). Very large pages can still stutter at that first move.
- ${link(301)} Add elements to target to UI (2019): **open feature**, not built. Users ask for the same thing in #249.
- ${link(351)} "Ask me" contextual menu (2021): **open feature**, not built. Overlaps #46 and #70.

## Issues that can be closed

${head}
${close.map(row).join('\n')}

"(retest)": the fix is in the code, the reporter should confirm it on 3.2.1.

## Kept open after the cross-check

${head}
${kept.map(row).join('\n')}

## Duplicate clusters (each could become one issue)

${Clusters.map(([n, what]) => `- ${n}: ${esc(what)}`).join('\n')}

## Fixes a contributor could make now, likeliest to be merged first

| Issue | Merge chance / effort | What the fix would change |
|---|---|---|
${fixes.slice(0, 16).map(x => `| ${link(x.number)} ${esc(issues[x.number].title)} | ${x.fix_candidate.merge_likelihood} / ${x.fix_candidate.effort} | ${esc(x.fix_candidate.approach)} |`).join('\n')}

## All 68 issues

${head}
${nums.map(row).join('\n')}
`;

fs.writeFileSync('REPORT.md', md);
console.log(`REPORT.md: ${md.length} chars; close ${close.length}: ${close.join(' ')}`);
