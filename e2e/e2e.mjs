#!/usr/bin/env node
// Snap Links Plus real-browser e2e harness (Firefox + WebDriver BiDi). node e2e.mjs --help for usage.
//
//   node e2e.mjs --build <dir> [--upgrade-from <dirA>] [--upgrade-version X] [--scenarios 1,2,3] [--idle-timeout ms]
//                [--headed] [--out results.json] [--fixtures <dir>] [--settle ms] [--perf-runs N] [--keep-profiles]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, reapProcs, readManifest, copyBuildWithVersion, bumpVersion, compareVersions, sleep, log } from './lib.mjs';
import { Session } from './session.mjs';
import { CdpSession } from './chromium.mjs';

const WorkDir = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `Usage: node e2e.mjs --build <dir> [options]
  --build <dir>             unpacked Firefox build to test (manifest.json at its root)
  --upgrade-from <dirA>     scenario 11 installs dirA first, then a copy of --build with a higher version
                            (default: --build itself, i.e. an upgrade to the same build with a bumped version)
  --upgrade-version <v>     version for that copy (default: --build's version if higher than dirA's, else dirA's + 1)
  --scenarios 1,2,3         subset (default all): 1 open-tabs, 2 copy, 3 new-window, 4 bookmarks,
                            5 checkboxes/radios/clickables, 6 activation/escape/context menu, 7 iframe, 8 autoscroll,
                            9 overlay, 10 event-page, 11 upgrade, 12 performance
  --idle-timeout <ms>       sets extensions.background.idle.timeout; scenario 10 then waits for the event page to
                            suspend on its own instead of calling terminateBackground()
  --headed                  visible Firefox window (default headless; headed saves/restores the clipboard text)
  --out <file>              results JSON (default runs/<timestamp>/results.json)
  --fixtures <dir>          fixture pages served over http (default V:\\SnapLinksPlus\\test)
  --settle <ms>             wait after a fixture page loads, for the content scripts (default 500)
  --perf-runs <n>           runs in scenario 12 (default 10)
  --keep-profiles           keep the temporary Firefox profiles for debugging
  --force-suspend           scenario 10: also terminateBackground() a persistent (MV2) background page
  --browser <name>          firefox (default, WebDriver BiDi), edge (CDP; loads MV2 and MV3) or chromium
                            (CDP, Playwright's Chromium; MV3 only). Use the matching build (build/ff or build/chrome).
  --browser-path <exe>      override the browser executable
Scenario 13 (options page) checks #SitesPermission/#BookmarkPermission are hidden and that saving from the page works.
Not applicable in Edge/Chromium: 11 (upgrade). Scenario 4 there stops after the no-permission path (no way to answer
the permission prompt over CDP).`;

// ---- CLI ---------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
	let a = { scenarios: null, headed: false, fixtures: 'V:\\SnapLinksPlus\\test', settle: 500, perfRuns: 10, keepProfiles: false };
	for(let i = 0; i < argv.length; i++) {
		let k = argv[i], v = () => argv[++i];
		switch(k) {
			case '--build':           a.build = path.resolve(v()); break;
			case '--upgrade-from':    a.upgradeFrom = path.resolve(v()); break;
			case '--upgrade-version': a.upgradeVersion = v(); break;
			case '--scenarios':       a.scenarios = v().split(',').map(s => s.trim()).filter(Boolean).map(Number); break;
			case '--idle-timeout':    a.idleTimeout = Number(v()); break;
			case '--headed':          a.headed = true; break;
			case '--out':             a.out = path.resolve(v()); break;
			case '--fixtures':        a.fixtures = path.resolve(v()); break;
			case '--settle':          a.settle = Number(v()); break;
			case '--perf-runs':       a.perfRuns = Number(v()); break;
			case '--keep-profiles':   a.keepProfiles = true; break;
			case '--force-suspend':   a.forceSuspend = true; break;
			case '--browser':         a.browser = v(); break;
			case '--browser-path':    a.browserPath = path.resolve(v()); break;
			case '-h': case '--help': a.help = true; break;
			default: throw new Error(`Unknown argument ${k}`);
		}
	}
	return a;
}

// ---- shared fixture helpers --------------------------------------------------------------------------------------

const WIKT_TEXT = ['cooker', 'fridge', 'oven', 'sink', 'stove', 'washer'];
const WIKT      = WIKT_TEXT.map(w => `https://en.wiktionary.org/wiki/${w}#English`);
// Snap Links copies with the platform's line separator (CRLF on Windows, LF elsewhere); the browser runs on this platform
const EOL       = process.platform === 'win32' ? '\r\n' : '\n';
const FILLERS   = ['http://filler-1.e2e.test/', 'http://filler-2.e2e.test/'];

/** Rects (viewport px) of the 6 wiktionary links on test_links.html, scrolled to the middle of the window */
async function wiktRects(s, ctx) {
	return s.content(ctx, async () => {
		let ul = [...document.querySelectorAll('a')].find(a => a.textContent === 'cooker').closest('ul');
		ul.scrollIntoView({ block: 'center' });
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		return [...ul.querySelectorAll('a')].map(a => {
			let b = a.getBoundingClientRect();
			return { text: a.textContent, href: a.href, l: b.left, t: b.top, r: b.right, b: b.bottom };
		});
	});
}

/** A lasso from left of link i0 to right of link i1 that does not touch the neighbouring links */
function lasso(rects, i0 = 0, i1 = rects.length - 1) {
	let sel = rects.slice(i0, i1 + 1);
	return {
		from: { x: Math.min(...sel.map(r => r.l)) - 20, y: sel[0].t + 2 },
		to:   { x: Math.max(...sel.map(r => r.r)) + 20, y: sel.at(-1).b - 2 },
	};
}

const isAllHttp = o => ['*://*/*', 'http://*/*'].includes(o);

const mainTabs = snap => snap.find(w => w.main).tabs;
const newTabs  = snap => snap.flatMap(w => w.tabs.filter(t => !t.old));
const urls     = tabs => tabs.map(t => t.url);

/** Delay from the page's last mouseup to the first/last TabOpen in the browser window (ms) */
async function tabDelays(s) {
	let up = await s.lastMouseUp(), opens = await s.tabOpenTimes();
	if(up == null || !opens.length)
		return { firstTabMs: null, lastTabMs: null, tabsOpened: opens.length };
	return { firstTabMs: +(opens[0] - up).toFixed(1), lastTabMs: +(opens.at(-1) - up).toFixed(1), tabsOpened: opens.length };
}

const stats = xs => {
	let v = xs.filter(x => typeof x === 'number').sort((a, b) => a - b);
	if(!v.length)
		return null;
	let mean = v.reduce((a, b) => a + b, 0) / v.length;
	let median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
	return { n: v.length, mean: +mean.toFixed(1), median: +median.toFixed(1), min: v[0], max: v.at(-1) };
};

// ---- scenarios ---------------------------------------------------------------------------------------------------

/** 1. Open links in tabs: count, URLs, order, positions per OpenTabs mode, SwitchFocusToNewTab, Shift reverses */
async function sOpenTabs({ s, env, eq, details }) {
	let url = env.base + 'test_links.html';

	let ctx   = await s.prepare(url);
	let rects = await wiktRects(s, ctx);
	eq('fixture: the 6 wiktionary links are found', rects.map(r => r.href), WIKT);
	await s.drag(ctx, lasso(rects));
	let snap = await s.waitNewTabs(6);
	let m    = mainTabs(snap);
	eq('defaults (Naturally, focus): tab strip = fixture + 6 links in order', urls(m), [s.fixtureUrl, ...WIKT]);
	eq('defaults: the last opened tab is selected', urls(m.filter(t => t.selected)), [WIKT[5]]);
	details.defaults = { tabs: m, ...(await tabDelays(s)) };

	let A = WIKT.slice(0, 3), B = WIKT.slice(3);
	let expected = {
		OpenTabsAtEnd:     fx => [fx, ...FILLERS, ...A, ...B],
		OpenTabsToRight:   fx => [fx, ...B, ...A, ...FILLERS],
		OpenTabsNaturally: fx => [fx, ...A, ...B, ...FILLERS],
	};
	details.modes = {};
	for(let mode of Object.keys(expected)) {
		await s.setPrefs({ OpenTabs: mode, SwitchFocusToNewTab: false });
		ctx   = await s.prepare(url, { fillers: FILLERS });
		rects = await wiktRects(s, ctx);
		await s.drag(ctx, lasso(rects, 0, 2));
		let snap1 = await s.waitNewTabs(3);
		await s.drag(ctx, lasso(rects, 3, 5));
		snap = await s.waitNewTabs(6);
		m    = mainTabs(snap);
		eq(`${mode}, 2 drags of 3 links with 2 filler tabs: tab strip`, urls(m), expected[mode](s.fixtureUrl));
		eq(`${mode}, SwitchFocusToNewTab=false: the fixture tab stays selected`, urls(m.filter(t => t.selected)), [s.fixtureUrl]);
		details.modes[mode] = { afterFirstDrag: urls(mainTabs(snap1)), final: urls(m) };
	}

	await s.setPrefs({ OpenTabs: 'OpenTabsNaturally', SwitchFocusToNewTab: true });
	ctx   = await s.prepare(url);
	rects = await wiktRects(s, ctx);
	await s.drag(ctx, { ...lasso(rects), atRelease: ['Shift'] });
	snap = await s.waitNewTabs(6);
	m    = mainTabs(snap);
	eq('Shift held at release: the links open in reverse order', urls(m), [s.fixtureUrl, ...[...WIKT].reverse()]);
	details.shiftReversed = urls(m);
}

/** 2. Copy: Ctrl at release with CopyFormat Urls / Markdown; DefaultAction=2 copies without Ctrl, opens with Ctrl */
async function sCopy({ s, env, eq, details }) {
	let url = env.base + 'test_links.html', sentinel = 'e2e-sentinel';

	let copy = async (label, prefs, dragOpts) => {
		if(prefs)
			await s.setPrefs(prefs);
		let ctx   = await s.prepare(url);
		let rects = await wiktRects(s, ctx);
		await s.writeClipboard(sentinel);
		await s.drag(ctx, { ...lasso(rects), ...dragOpts });
		let clip = await s.waitClipboard(sentinel);
		let snap = await s.waitNewTabs(0, 1000);
		details[label] = { clipboard: clip, newTabs: urls(newTabs(snap)) };
		return { clip, snap };
	};

	let r = await copy('ctrlUrls', null, { atRelease: ['Ctrl'] });
	eq('Ctrl at release, CopyFormat=Urls: clipboard = URLs one per line (CRLF on Windows, LF elsewhere)', r.clip, WIKT.join(EOL));
	eq('Ctrl at release: no tab opens', urls(newTabs(r.snap)), []);

	r = await copy('ctrlMarkdown', { CopyFormat: 'Markdown' }, { atRelease: ['Ctrl'] });
	eq('Ctrl at release, CopyFormat=Markdown: clipboard = [title](url) lines', r.clip, WIKT.map((u, i) => `[${WIKT_TEXT[i]}](${u})`).join(EOL));

	r = await copy('defaultCopy', { CopyFormat: 'TitlesAndUrls', DefaultAction: 2 }, {});
	eq('DefaultAction=2 without Ctrl, CopyFormat=TitlesAndUrls: clipboard = title<TAB>url lines', r.clip, WIKT.map((u, i) => `${WIKT_TEXT[i]}\t${u}`).join(EOL));
	eq('DefaultAction=2 without Ctrl: no tab opens', urls(newTabs(r.snap)), []);

	await s.setPrefs({ DefaultAction: 2 });
	let ctx   = await s.prepare(url);
	let rects = await wiktRects(s, ctx);
	await s.writeClipboard(sentinel);
	await s.drag(ctx, { ...lasso(rects), atRelease: ['Ctrl'] });
	let snap = await s.waitNewTabs(6);
	eq('DefaultAction=2 with Ctrl at release: the links open in tabs instead', urls(mainTabs(snap)), [s.fixtureUrl, ...WIKT]);
	eq('DefaultAction=2 with Ctrl at release: clipboard untouched', await s.readClipboard(), sentinel);
	details.backgroundErrors = await s.backgroundErrors();
}

/** 3. DefaultAction=3: one new window whose tabs are the links in order */
async function sNewWindow({ s, env, eq, check, details }) {
	await s.setPrefs({ DefaultAction: 3 });
	let ctx   = await s.prepare(env.base + 'test_links.html');
	let rects = await wiktRects(s, ctx);
	await s.drag(ctx, lasso(rects));
	let snap = await s.waitNewTabs(6, 15000);
	await sleep(500);
	snap = await s.tabs();
	let wins = snap.filter(w => !w.old);
	eq('one new window', wins.length, 1);
	eq('new window tabs = the 6 links in order', wins[0] ? urls(wins[0].tabs) : null, WIKT);
	eq('the source window is unchanged', urls(mainTabs(snap)), [s.fixtureUrl]);
	check('new window has the first link selected', wins[0]?.tabs[0]?.selected, true, wins[0]?.tabs.filter(t => t.selected).map(t => t.url));
	details.windows = snap;
}

/** 4. DefaultAction=4: without the bookmarks permission the options page opens; with it, a "Snap Links ..." folder */
async function sBookmarks({ s, env, eq, check, details }) {
	let url = env.base + 'test_links.html';
	await s.setPrefs({ DefaultAction: 4 });
	details.permissionBefore = await s.hasPermission('bookmarks');
	eq('bookmarks permission not granted at first', details.permissionBefore, false);

	let ctx   = await s.prepare(url);
	let rects = await wiktRects(s, ctx);
	await s.drag(ctx, lasso(rects));
	let snap = await s.waitNewTabs(1, 5000);
	await sleep(500);
	snap = await s.tabs();
	let opened = urls(newTabs(snap));
	details.withoutPermission = { newTabs: opened };
	let optionsLike = u => u.startsWith('about:addons') || u === s.optionsUrl() || u.startsWith('chrome://extensions/?options=') || u.startsWith('edge://extensions/?options=');
	check('without permission: one new tab with the options page (about:addons, extensions page or the options URL)', opened.length === 1 && optionsLike(opened[0]), `[about:addons | edge://extensions/?options=<id> | ${s.optionsUrl()}]`, opened);
	let f = await s.snapLinksFolders();
	eq('without permission: no bookmark folder', f.folders.length, 0);

	details.granted = await s.grantPermission('bookmarks');
	details.permissionAfter = await s.hasPermission('bookmarks');
	if(s.kind !== 'firefox' && !details.permissionAfter) {
		details.note = 'permissions.request() needs the browser prompt, which CDP cannot answer: the with-permission path was not run';
		return;
	}
	eq('bookmarks permission granted via ExtensionPermissions.add (seen by permissions.contains)', details.permissionAfter, true);

	ctx   = await s.prepare(url);
	rects = await wiktRects(s, ctx);
	await s.drag(ctx, lasso(rects));
	let t0 = Date.now();
	do {
		f = await s.snapLinksFolders();
		if(f.folders.length && f.folders[0].children.length >= 6)
			break;
		await sleep(100);
	} while(Date.now() - t0 < 5000);
	await sleep(300);
	f = await s.snapLinksFolders();
	details.folders = f;
	eq('with permission: exactly one "Snap Links ..." folder', f.folders.length, 1);
	eq('folder bookmarks = the 6 links in order', f.folders[0]?.children.map(c => c.url), WIKT);
	eq('bookmark titles = link texts', f.folders[0]?.children.map(c => c.title), WIKT_TEXT);
	eq('folder is in Other Bookmarks (unfiled)', f.folders[0]?.parentGuid, f.unfiledGuid);
	snap = await s.waitNewTabs(0, 800);
	eq('with permission: no tab opens', urls(newTabs(snap)), []);
}

/** 5. Checkboxes toggle by inverse majority, radio buttons select the first per group, buttons/JS links are clicked */
async function sFormElements({ s, env, eq, details }) {
	let ctx = await s.prepare(env.base + 'test_links.html');

	// Paragraphs after <h2>Checkboxes & Buttons</h2>: 0 checkboxes+buttons, 1 checkboxes+button, 2 buttons, 3 radio group 1, 4 radio group 2
	let geo = async (first, last = first) => s.content(ctx, async ({ first, last }) => {
		let h2 = [...document.querySelectorAll('h2')].find(h => h.textContent.startsWith('Checkboxes'));
		let ps = [];
		for(let el = h2.nextElementSibling; el && el.tagName === 'P'; el = el.nextElementSibling)
			ps.push(el);
		ps[first].scrollIntoView({ block: 'center' });
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		let a = ps[first].getBoundingClientRect(), b = ps[last].getBoundingClientRect();
		let inputs = ps.slice(first, last + 1).flatMap(p => [...p.querySelectorAll('input')]);
		return {
			from:   { x: a.left - 15, y: a.top + 1 },
			to:     { x: a.left + 360, y: b.bottom - 1 },
			inputs: inputs.map(i => ({ type: i.type, name: i.name, value: i.value, checked: i.checked })),
		};
	}, { first, last });
	let inputs = async (first, last = first) => (await geo(first, last)).inputs;

	// Checkboxes: 3 of 4 checked -> all unchecked; then all unchecked -> all checked
	let g      = await geo(0);
	let boxes  = g.inputs.filter(i => i.type === 'checkbox');
	let target = boxes.filter(b => !b.checked).length >= boxes.filter(b => b.checked).length;
	await s.drag(ctx, g);
	await sleep(400);
	let after1 = (await inputs(0)).filter(i => i.type === 'checkbox').map(i => i.checked);
	eq(`checkboxes (${boxes.map(b => +b.checked).join('')} -> majority rule): all become ${target}`, after1, boxes.map(() => target));
	g = await geo(0);
	await s.drag(ctx, g);
	await sleep(400);
	let after2 = (await inputs(0)).filter(i => i.type === 'checkbox').map(i => i.checked);
	eq(`checkboxes second drag: all become ${!target}`, after2, boxes.map(() => !target));
	details.checkboxes = { before: boxes.map(b => b.checked), afterFirst: after1, afterSecond: after2 };

	// Radio buttons: two groups of 3, none checked -> the first of each group
	g = await geo(3, 4);
	await s.drag(ctx, g);
	await sleep(400);
	let radios = (await inputs(3, 4)).filter(i => i.type === 'radio');
	eq('radios: the first of each group is selected', radios.map(r => r.checked), [true, false, false, true, false, false]);
	details.radios = radios;

	// Buttons (no checkboxes around): both are clicked; the page's handler shows "Clicked!" for 3s
	g = await geo(2);
	await s.drag(ctx, g);
	await sleep(500);
	let buttons = (await inputs(2)).map(i => i.value);
	eq('buttons: both clicked (value "Clicked!")', buttons, ['Clicked!', 'Clicked!']);
	details.buttons = buttons;

	// javascript: links in #JS_Click_Events_Tester (onclick attribute, .onclick, addEventListener) are clicked
	let js = await s.content(ctx, async () => {
		let as = [...document.querySelectorAll('#JS_Click_Events_Tester td > a')];
		as[0].scrollIntoView({ block: 'center' });
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		let rs = as.map(a => a.getBoundingClientRect());
		return { from: { x: Math.min(...rs.map(r => r.left)) - 3, y: rs[0].top - 2 }, to: { x: Math.max(...rs.map(r => r.right)) + 3, y: rs.at(-1).bottom + 2 }, n: as.length };
	});
	await s.drag(ctx, js);
	await sleep(500);
	let hl = await s.content(ctx, () => [...document.querySelectorAll('#JS_Click_Events_Tester td > a')].map(a => a.classList.contains('highlighted')));
	eq('javascript: links (3 ways of binding onclick) are all clicked', hl, [true, true, true]);
	let snap = await s.waitNewTabs(0, 500);
	eq('no tabs open for form elements', urls(newTabs(snap)), []);
}

/** 6. Activation: LMB, MMB, a required modifier, Escape cancels, context menu suppressed after a drag */
async function sActivation({ s, env, eq, check, details }) {
	let url = env.base + 'test_links.html';
	let drag = async (prefs, opts, expectTabs) => {
		if(prefs)
			await s.setPrefs(prefs);
		let ctx   = await s.prepare(url);
		let rects = await wiktRects(s, ctx);
		await s.drag(ctx, { ...lasso(rects), ...opts });
		let snap = await s.waitNewTabs(expectTabs, expectTabs ? 8000 : 1200);
		return { ctx, rects, opened: urls(newTabs(snap)) };
	};

	details.contextMenuPref = { afterInstall: await s.pref('ui.context_menus.after_mouseup') };

	let r = await drag({ ActivateMouseButton: 1 }, { button: 0 }, 6);
	eq('ActivateMouseButton=1: left-drag opens the 6 links', r.opened, WIKT);
	details.contextMenuPref.withLMB = await s.pref('ui.context_menus.after_mouseup');
	r = await drag(null, { button: 2 }, 0);
	eq('ActivateMouseButton=1: right-drag does nothing', r.opened, []);

	r = await drag({ ActivateMouseButton: 4 }, { button: 1 }, 6);
	eq('ActivateMouseButton=4: middle-drag opens the 6 links', r.opened, WIKT);

	r = await drag({ ActivateMouseButton: 2, ActivateModifiers: 4 }, {}, 0);
	details.contextMenuPref.withRMB = await s.pref('ui.context_menus.after_mouseup');
	if(s.kind === 'firefox') {
	eq('#400: with the right button active, the context menu opens on release (ui.context_menus.after_mouseup)', details.contextMenuPref.withRMB?.value, true);
	eq(`#400: context menu drag recovery is on only on Linux (here: ${process.platform})`,
		await s.inOptionsPage(() => browser.runtime.sendMessage({ Action: 'GetContextMenuDragRecovery' })), process.platform === 'linux');
	}
	eq('ActivateModifiers=Shift: right-drag without Shift does nothing', r.opened, []);
	r = await drag(null, { hold: ['Shift'] }, 6);
	eq('ActivateModifiers=Shift: right-drag holding Shift opens the links, not reversed', r.opened, WIKT);

	r = await drag({ ActivateModifiers: 0 }, { escape: true }, 0);
	eq('Escape before release cancels: no tab opens', r.opened, []);
	eq('Escape: the lasso is removed from the page', await s.content(r.ctx, () => !!document.querySelector('div.SnapLinksContainer')), false);

	// Context menu. BiDi fires contextmenu at pointerDown; Windows fires it after the button is released, so the
	// harness dispatches that one itself and checks whether the browser tried to show its menu.
	let ctx   = await s.prepare(url);
	let rects = await wiktRects(s, ctx);
	let L     = lasso(rects);
	await s.drag(ctx, { from: L.from, to: { x: L.from.x + 1, y: L.from.y + 1 }, steps: 1 });
	let control = await s.osContextMenu(L.from.x + 1, L.from.y + 1);
	let pageCtl = await s.content(ctx, () => window.__e2eCtx.splice(0));
	check('control: a right-click without a drag shows the context menu', control.menuAttempted === true, true, control);
	await s.drag(ctx, L);
	let afterDrag = await s.osContextMenu(L.to.x, L.to.y);
	let pageDrag  = await s.content(ctx, () => window.__e2eCtx.splice(0));
	check('after a right-drag the context menu is suppressed', afterDrag.menuAttempted === false, false, afterDrag);
	await s.waitNewTabs(6);
	await s.drag(ctx, { from: L.to, to: { x: L.to.x + 1, y: L.to.y + 1 }, steps: 1 });
	let again = await s.osContextMenu(L.to.x + 1, L.to.y + 1);
	check('only that one menu is suppressed: the next right-click shows it', again.menuAttempted === true, true, again);
	details.contextMenu = { control, pageControl: pageCtl, afterDrag, pageAfterDrag: pageDrag, nextRightClick: again };
}

/** 7. A drag inside an iframe acts on the links of the frame */
async function sIframe({ s, env, check, details }) {
	let ctx = await s.prepare(env.base + 'iframe_content.htm');
	let g = await s.content(ctx, async () => {
		let ifr = document.querySelector('iframe');
		ifr.scrollIntoView({ block: 'center' });
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		let fr = ifr.getBoundingClientRect(), ox = fr.left + ifr.clientLeft, oy = fr.top + ifr.clientTop;
		let doc = ifr.contentDocument, win = ifr.contentWindow;
		let p   = doc.querySelector('p'), pr = p.getBoundingClientRect();
		// Lasso in frame coordinates: the first ~2 lines of the first paragraph
		let L = { l: Math.max(2, pr.left - 4), t: pr.top + 2, r: Math.min(pr.right, pr.left + 320), b: pr.top + 30 };
		let hits = [];
		for(let a of doc.querySelectorAll('a[href]:not([href=""])')) {
			let rs = [...a.getClientRects()];
			if(!rs.some(r => r.width > 0 && r.right > L.l && r.left < L.r && r.bottom > L.t && r.top < L.b))
				continue;
			let cs = win.getComputedStyle(a);
			let w  = parseInt(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400);
			hits.push({ href: a.href, score: parseFloat(cs.fontSize) * 100 + w / 10, text: a.textContent });
		}
		let max = Math.max(...hits.map(h => h.score));
		let expected = [...new Set(hits.filter(h => h.score === max && !h.href.startsWith('javascript:')).map(h => h.href))];
		return {
			from: { x: ox + L.l, y: oy + L.t }, to: { x: ox + L.r, y: oy + L.b },
			expected, frameHrefs: [...doc.querySelectorAll('a[href]')].map(a => a.href),
			topHrefs: [...document.querySelectorAll('a[href]')].map(a => a.href), hits,
		};
	});
	await s.drag(ctx, g);
	let snap   = await s.waitNewTabs(g.expected.length);
	await sleep(300);
	snap = await s.tabs();
	let opened = urls(newTabs(snap));
	details.expected = g.expected;
	details.opened   = opened;
	// en.wikipedia.org is HSTS-preloaded: Chromium shows the tabs as https:// (the extension opened http://)
	let n = u => u.replace(/^https:/, 'http:');
	details.httpsUpgradedByBrowser = opened.some(u => u.startsWith('https:') && g.expected.includes(n(u)));
	let o = opened.map(n), frame = g.frameHrefs.map(n);
	check('at least one link opens', opened.length > 0, '>0', opened.length);
	check('the opened links are exactly the frame links inside the lasso', JSON.stringify([...o].sort()) === JSON.stringify([...g.expected].sort()), g.expected, opened);
	check('every opened link belongs to the frame', o.every(u => frame.includes(u)), true, opened.filter(u => !frame.includes(n(u))));
	check('opened in document order', JSON.stringify(o) === JSON.stringify(g.expected), g.expected, opened);
}

/** 8. Autoscroll: holding the lasso at the bottom edge scrolls the page; the label count matches what opens */
async function sAutoscroll({ s, env, eq, check, details }) {
	let ctx = await s.prepare(env.base + 'autoscroll.html');
	let g = await s.content(ctx, async () => {
		scrollTo(0, 0);
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		let a = document.querySelector('a[href$="/row-1"]').getBoundingClientRect();
		return { row1: { l: a.left, t: a.top, r: a.right }, clientHeight: document.documentElement.clientHeight, innerHeight };
	});
	let from = { x: 10, y: g.row1.t + 2 }, to = { x: g.row1.r + 60, y: g.clientHeight - 4 };
	await s.drag(ctx, { from, to, up: false, settleMs: 1500 });
	// Leave the edge zone so the scrolling stops, then read the label: released there, the same links must open
	await s.moveHeld(ctx, { x: to.x, y: g.clientHeight - 80 });
	let mid = await s.content(ctx, () => ({
		scrollY: scrollY,
		label:   document.querySelector('.SL_SelectionLabel')?.textContent ?? null,
	}));
	await s.release(ctx);
	let n    = Number(/(\d+)/.exec(mid.label || '')?.[1] || 0);
	let snap = await s.waitNewTabs(n, 15000);
	await sleep(300);
	snap = await s.tabs();
	let opened = urls(newTabs(snap));
	details.during  = mid;
	details.opened  = opened.length;
	details.geometry = g;
	check('the page scrolled down while the lasso was held at the bottom edge', mid.scrollY > 100, '>100', mid.scrollY);
	check('the label shows a link count', n > 0, '>0', mid.label);
	eq('the number of opened tabs equals the label count', opened.length, n);
	eq('the opened links are rows 1..N in order', opened, Array.from({ length: n }, (_, i) => `https://example.com/row-${i + 1}`));
}

/** 9. During a drag, the lasso, its label and the SVG highlights are in the page DOM, over the links */
async function sOverlay({ s, env, eq, check, details }) {
	let ctx   = await s.prepare(env.base + 'test_links.html');
	let rects = await wiktRects(s, ctx);
	let L     = lasso(rects);
	await s.drag(ctx, { ...L, up: false, settleMs: 250 });
	let dom = await s.content(ctx, () => {
		let box = e => {
			let b = e.getBoundingClientRect();
			return { l: b.left, t: b.top, r: b.right, b: b.bottom };
		};
		let c = document.querySelector('div.SnapLinksContainer');
		let sel = c?.querySelector('.SL_SelectionRect'), label = c?.querySelector('.SL_SelectionLabel');
		return {
			container:      !!c,
			display:        c ? getComputedStyle(c).display : null,
			selection:      sel ? box(sel) : null,
			label:          label?.textContent ?? null,
			labelDisplay:   label ? getComputedStyle(label).display : null,
			highlights:     [...(c?.querySelectorAll('svg.SnapLinksHighlighter rect') || [])].map(box).filter(b => b.r - b.l > 0 && b.b - b.t > 0),
		};
	});
	await s.release(ctx, { escape: true });
	await sleep(200);
	let gone = await s.content(ctx, () => !document.querySelector('div.SnapLinksContainer'));
	let snap = await s.waitNewTabs(0, 800);
	details.dom = dom;
	details.lasso = L;
	check('lasso container is in the DOM and visible during the drag', dom.container && dom.display !== 'none', true, { container: dom.container, display: dom.display });
	let sel = dom.selection;
	check('selection rectangle matches the drag (+-3px)', sel && Math.abs(sel.l - Math.round(L.from.x)) <= 3 && Math.abs(sel.t - Math.round(L.from.y)) <= 3 && Math.abs(sel.r - Math.round(L.to.x)) <= 3 && Math.abs(sel.b - Math.round(L.to.y)) <= 3, L, sel);
	eq('label says "6 Links"', dom.label, '6 Links');
	let covered = rects.map(r => dom.highlights.some(h => h.l <= (r.l + r.r) / 2 && (r.l + r.r) / 2 <= h.r && h.t <= (r.t + r.b) / 2 && (r.t + r.b) / 2 <= h.b));
	eq('every selected link has an SVG highlight over it', covered, rects.map(() => true));
	check('lasso removed after Escape', gone, true, gone);
	eq('Escape: no tab opens', urls(newTabs(snap)), []);
}

/** 10. Event page: suspend the background, then open/copy must still work; delay warm vs suspended */
async function sEventPage({ s, env, eq, check, details, args }) {
	let url = env.base + 'test_links.html';
	details.initial = await s.extInfo();

	let suspend = async () => {
		let r;
		if(args.idleTimeout != null) {
			let t0 = Date.now(), st;
			do {
				st = await s.backgroundState();
				if(st !== 'running')
					break;
				await sleep(250);
			} while(Date.now() - t0 < args.idleTimeout + 15000);
			r = { method: `idle timeout ${args.idleTimeout}ms`, waitedMs: Date.now() - t0, after: st };
		} else {
			r = { method: 'terminateBackground()', ...(await s.terminateBackground()) };
			for(let i = 0; i < 20 && r.after === 'suspending'; i++) {
				await sleep(100);
				r.after = await s.backgroundState();
			}
		}
		return r;
	};

	// Warm
	let ctx   = await s.prepare(url);
	let rects = await wiktRects(s, ctx);
	let warmState = await s.backgroundState();
	await s.drag(ctx, lasso(rects, 0, 2));
	let snap = await s.waitNewTabs(3);
	eq('warm background: 3 links open', urls(newTabs(snap)), WIKT.slice(0, 3));
	details.warm = { stateBefore: warmState, ...(await tabDelays(s)) };

	// A persistent background page (MV2) never suspends. terminateBackground() does stop it, but then the next action
	// message is lost (observed on Firefox 160 with the MV2 build), which says nothing about the extension.
	if(details.initial?.persistentBackground && !args.forceSuspend) {
		ctx   = await s.prepare(url);
		rects = await wiktRects(s, ctx);
		await s.writeClipboard('e2e-sentinel');
		await s.drag(ctx, { ...lasso(rects), atRelease: ['Ctrl'] });
		eq('warm background: Ctrl copy works', await s.waitClipboard('e2e-sentinel'), WIKT.join(EOL));
		details.note = 'persistent background page: suspension does not apply and was not attempted (--force-suspend to try anyway)';
		return;
	}

	// Suspended, open in tabs (suspend after the page loaded: the content script messages the background at startup)
	ctx   = await s.prepare(url);
	rects = await wiktRects(s, ctx);
	let sus = await suspend();
	details.suspendForOpen = sus;
	let suspended = sus.after !== 'running';
	check('the background was suspended before the drag', suspended, 'not running', sus);
	await s.drag(ctx, lasso(rects, 0, 2));
	snap = await s.waitNewTabs(3);
	eq(`after suspend attempt (state ${sus.after}): 3 links open`, urls(newTabs(snap)), WIKT.slice(0, 3));
	details.suspendedOpen = { ...(await tabDelays(s)), stateAfter: await s.backgroundState() };

	// Suspended, copy
	ctx   = await s.prepare(url);
	rects = await wiktRects(s, ctx);
	let sus2 = await suspend();
	details.suspendForCopy = sus2;
	check('the background was suspended before the copy', sus2.after !== 'running', 'not running', sus2);
	await s.writeClipboard('e2e-sentinel');
	await s.drag(ctx, { ...lasso(rects), atRelease: ['Ctrl'] });
	let clip = await s.waitClipboard('e2e-sentinel');
	eq(`after suspend attempt (state ${sus2.after}): Ctrl copy works`, clip, WIKT.join(EOL));
	details.suspendedCopy = { clipboard: clip, stateAfter: await s.backgroundState() };

}

/** 11. Upgrade A -> B (copy of B with a higher version): prefs kept, LastInstalledVersion, permissions, content script */
async function sUpgrade({ env, eq, check, details, args, startSession }) {
	let A  = args.upgradeFrom || args.build;
	let mA = readManifest(A), mB = readManifest(args.build);
	let version = args.upgradeVersion || (compareVersions(mB.version, mA.version) > 0 ? mB.version : bumpVersion(mA.version));
	let B2 = copyBuildWithVersion(args.build, path.join(env.runDir, `upgrade-build-${version}`), version);
	details.from = { dir: A, version: mA.version, mv: mA.mv };
	details.to   = { dir: args.build, copiedTo: B2, version, mv: mB.mv };
	let url = env.base + 'test_links.html';
	let prefs = { OpenTabs: 'OpenTabsToRight', CopyFormat: 'Markdown', ShowNumberOfLinks: false, DefaultAction: 2 };

	let s = await startSession('upgrade');
	details.installA = await s.install(A);
	await s.setPrefs(prefs);
	let before = await s.storage();
	let oldCtx   = await s.prepare(url);
	let oldRects = await wiktRects(s, oldCtx);
	let oldUrl   = s.fixtureUrl;
	details.storageBefore = before;

	details.installB = await s.install(B2);
	await sleep(1000);
	let after = await s.storage();
	details.storageAfter = after;
	details.extInfoAfter = await s.extInfo();
	for(let [k, v] of Object.entries(prefs))
		eq(`pref ${k} kept across the upgrade`, after.sync[k], v);
	eq('LastInstalledVersion updated to the new version (onInstalled ran)', after.local.LastInstalledVersion, version);
	eq('add-on version is the new one', details.extInfoAfter?.version, version);
	// MV2: content script matches are not host permissions, allowedOrigins only holds moz-extension://. MV3: content
	// script matches become (optional) host permissions, so without the grant the content script would not run.
	if(mB.mv >= 3)
		check('MV3: allowedOrigins after the upgrade cover http pages (content script host permission)',
			details.extInfoAfter?.allowedOrigins.some(o => o === '<all_urls>' || isAllHttp(o)), '<all_urls> or *://*/*', details.extInfoAfter?.allowedOrigins);

	// A tab that was open before the upgrade (Firefox re-injects content scripts into open tabs on install)
	await s.writeClipboard('e2e-sentinel');
	await s.drag(oldCtx, lasso(oldRects));
	let clipOld = await s.waitClipboard('e2e-sentinel', 3000);
	details.preUpgradeTab = { url: oldUrl, clipboard: clipOld };
	check('tab opened before the upgrade: a drag still copies (DefaultAction=2, Markdown)', clipOld === WIKT.map((u, i) => `[${WIKT_TEXT[i]}](${u})`).join(EOL), 'markdown lines', clipOld);

	// A tab loaded after the upgrade
	let ctx   = await s.prepare(url);
	let rects = await wiktRects(s, ctx);
	await s.writeClipboard('e2e-sentinel');
	await s.drag(ctx, lasso(rects));
	let clipNew = await s.waitClipboard('e2e-sentinel', 3000);
	details.postUpgradeTab = { clipboard: clipNew };
	eq('tab loaded after the upgrade: a drag copies as Markdown (prefs active in the content script)', clipNew, WIKT.map((u, i) => `[${WIKT_TEXT[i]}](${u})`).join(EOL));
	await s.close();

	// Fresh install of B alone
	let s2 = await startSession('fresh-b');
	details.freshInstallB = await s2.install(args.build);
	let fresh = await s2.storage();
	details.freshStorage = fresh;
	eq('fresh install of B: no stored prefs (defaults)', Object.keys(fresh.sync).filter(k => k !== 'StorageAPI'), []);
	eq('fresh install of B: LastInstalledVersion = its version', fresh.local.LastInstalledVersion, mB.version);
	if(mB.mv >= 3)
		check('MV3 fresh install: allowedOrigins cover http pages (content script host permission)',
			details.freshInstallB.info?.allowedOrigins.some(o => o === '<all_urls>' || isAllHttp(o)), '<all_urls> or *://*/*', details.freshInstallB.info?.allowedOrigins);
	ctx   = await s2.prepare(url);
	rects = await wiktRects(s2, ctx);
	await s2.drag(ctx, lasso(rects));
	let snap = await s2.waitNewTabs(6);
	eq('fresh install of B: a drag opens the 6 links', urls(newTabs(snap)), WIKT);
	await s2.close();
}

/** 12. Performance smoke: pointerUp -> first/last tab over N runs, CPU time of the processes over the runs */
async function sPerf({ s, env, eq, details, args }) {
	let ctx   = await s.prepare(env.base + 'test_links.html');
	let rects = await wiktRects(s, ctx);
	let L     = lasso(rects, 0, 2);
	let runs  = [];
	let cpu0  = await s.procInfo();
	let t0    = Date.now();
	for(let i = 0; i < args.perfRuns; i++) {
		await s.markTabs();
		await s.drag(ctx, L);
		let snap = await s.waitNewTabs(3);
		let ok   = JSON.stringify(urls(newTabs(snap))) === JSON.stringify(WIKT.slice(0, 3));
		runs.push({ ok, ...(await tabDelays(s)) });
		await s.closeNewTabs();
		await sleep(300);
	}
	let wallMs = Date.now() - t0;
	let cpu1   = await s.procInfo();
	let delta  = [];
	for(let p of [cpu1.parent, ...cpu1.children]) {
		let q = [cpu0.parent, ...cpu0.children].find(x => x.pid === p.pid);
		delta.push({ pid: p.pid, type: p.type, origin: p.origin, cpuMs: +(p.cpuMs - (q?.cpuMs || 0)).toFixed(1), new: !q });
	}
	details.runs        = runs;
	details.firstTabMs  = stats(runs.map(r => r.firstTabMs));
	details.lastTabMs   = stats(runs.map(r => r.lastTabMs));
	details.wallMs      = wallMs;
	details.cpuDeltaMs  = delta.sort((a, b) => b.cpuMs - a.cpuMs);
	details.extensionProcessCpuMs = s.kind === 'firefox' ? +delta.filter(d => d.type === 'extension').reduce((a, d) => a + d.cpuMs, 0).toFixed(1) : null;
	details.note = s.kind === 'firefox'
		? 'browser-process CPU includes the harness (BiDi input, chrome-scope polling)'
		: 'Chromium runs extension backgrounds in renderer processes: see cpuDeltaMs per process; browser CPU includes the harness';
	eq(`all ${args.perfRuns} runs opened the 3 links`, runs.filter(r => r.ok).length, args.perfRuns);
}

/** 13. Options page: permission notes hidden by default; a change made on the page is saved */
async function sOptionsPage({ s, eq, check, details }) {
	let ctx = await s.openOptionsTab();
	await sleep(1000);	// Options.js: DOMReady, prefs, permission checks
	let visibility = () => s.content(ctx, () => {
		let vis = id => {
			let e = document.getElementById(id);
			if(!e)
				return 'absent';
			let cs = getComputedStyle(e);
			return e.hidden || cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length ? 'hidden' : 'visible';
		};
		return { SitesPermission: vis('SitesPermission'), BookmarkPermission: vis('BookmarkPermission'), CopyFormat: document.getElementById('CopyFormat')?.value, ShowNumberOfLinks: document.getElementById('ShowNumberOfLinks')?.checked };
	});
	let st = await visibility();
	details.initial = st;
	check('#SitesPermission is hidden (or absent in builds without it)', st.SitesPermission !== 'visible', 'hidden|absent', st.SitesPermission);
	eq('#BookmarkPermission is hidden', st.BookmarkPermission, 'hidden');

	// A real click on the ShowNumberOfLinks checkbox, and a change event on the CopyFormat select
	let box = await s.content(ctx, async () => {
		let cb = document.getElementById('ShowNumberOfLinks');
		cb.scrollIntoView({ block: 'center' });
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		let b = cb.getBoundingClientRect();
		return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
	});
	await s.click(ctx, box.x, box.y);
	await s.content(ctx, () => {
		let sel = document.getElementById('CopyFormat');
		sel.value = 'Markdown';
		sel.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await sleep(1000);	// saves are throttled (250 ms)
	let stored = await s.storage();
	details.stored = stored.sync;
	eq('clicking ShowNumberOfLinks saved it', stored.sync.ShowNumberOfLinks, !st.ShowNumberOfLinks);
	eq('changing CopyFormat saved it', stored.sync.CopyFormat, 'Markdown');
	let after = await visibility();
	details.after = after;
	check('permission notes still hidden after the changes', after.SitesPermission !== 'visible' && after.BookmarkPermission === 'hidden', 'hidden', after);
}

const SCENARIOS = {
	1:  { name: 'open-tabs', fn: sOpenTabs },
	2:  { name: 'copy', fn: sCopy },
	3:  { name: 'new-window', fn: sNewWindow },
	4:  { name: 'bookmarks', fn: sBookmarks },
	5:  { name: 'checkboxes-radios-clickables', fn: sFormElements },
	6:  { name: 'activation-escape-contextmenu', fn: sActivation },
	7:  { name: 'iframe', fn: sIframe },
	8:  { name: 'autoscroll', fn: sAutoscroll },
	9:  { name: 'overlay', fn: sOverlay },
	10: { name: 'event-page', fn: sEventPage },
	11: { name: 'upgrade', fn: sUpgrade, ownSessions: true, browsers: ['firefox'] },
	12: { name: 'performance', fn: sPerf },
	13: { name: 'options-page', fn: sOptionsPage },
};

// ---- runner ------------------------------------------------------------------------------------------------------

async function main() {
	let args = parseArgs(process.argv.slice(2));
	if(args.help || !args.build) {
		console.log(USAGE);
		process.exit(args.help ? 0 : 2);
	}
	let ids    = args.scenarios || Object.keys(SCENARIOS).map(Number);
	let stamp  = new Date().toISOString().replace(/[:.]/g, '-');
	let runDir = path.join(WorkDir, 'runs', stamp);
	fs.mkdirSync(runDir, { recursive: true });
	args.out = args.out || path.join(runDir, 'results.json');
	let manifest = readManifest(args.build);

	let server   = await startFixtureServer(args.fixtures);
	let sessions = new Set(), allPids = [];
	let env      = { base: server.base, runDir };
	let results  = {
		browser: args.browser || 'firefox',
		build: args.build, version: manifest.version, manifestVersion: manifest.mv, upgradeFrom: args.upgradeFrom || null,
		headless: !args.headed, idleTimeout: args.idleTimeout ?? null, startedAt: new Date().toISOString(), runDir, scenarios: [],
	};
	let write = () => fs.writeFileSync(args.out, JSON.stringify(results, null, '\t'));

	let browser = args.browser || 'firefox';
	if(!['firefox', 'edge', 'chromium'].includes(browser))
		throw new Error(`--browser must be firefox, edge or chromium, not ${browser}`);
	let startSession = async name => {
		if(browser !== 'firefox') {
			let s = await CdpSession.start({ runDir, name, server, build: args.build, kind: browser, exe: args.browserPath, headless: !args.headed, keepProfile: args.keepProfiles, settleMs: args.settle });
			sessions.add(s);
			allPids.push(...s.pids);
			results.browserVersion = s.browserVersion;
			return s;
		}
		let s = await Session.start({ runDir, name, server, headless: !args.headed, idleTimeout: args.idleTimeout, keepProfile: args.keepProfiles, settleMs: args.settle });
		sessions.add(s);
		allPids.push(...s.pids);
		results.browserVersion = s.browserVersion;
		return s;
	};
	let shutdown = async () => {
		for(let s of sessions)
			await s.close().catch(() => {});
		await server.close();
	};
	process.on('SIGINT', async () => {
		log('SIGINT: closing Firefox instances');
		await shutdown();
		process.exit(130);
	});

	try {
		for(let id of ids) {
			let sc = SCENARIOS[id];
			if(!sc)
				throw new Error(`No scenario ${id}`);
			let res = { id, name: sc.name, pass: false, checks: [], details: {}, ms: 0 };
			let check = (name, pass, expected, actual) => {
				res.checks.push({ name, pass: !!pass, expected, actual });
				log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : `\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`}`);
				return !!pass;
			};
			let eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), expected, actual);
			if(sc.browsers && !sc.browsers.includes(browser)) {
				res.skipped = `not applicable in ${browser}`;
				res.pass    = null;
				results.scenarios.push(res);
				log(`scenario ${id} ${sc.name}: SKIP (${res.skipped})`);
				write();
				continue;
			}
			log(`scenario ${id} ${sc.name}`);
			let t0 = Date.now(), s;
			try {
				if(sc.ownSessions) {
					await sc.fn({ env, check, eq, details: res.details, args, startSession });
				} else {
					s = await startSession(`s${id}`);
					res.details.install = await s.install(args.build);
					await sc.fn({ s, env, check, eq, details: res.details, args });
				}
			} catch(e) {
				res.error = e.stack || String(e);
				log(`  ERROR ${res.error}`);
			} finally {
				if(s)
					await s.close();
				for(let x of sessions)
					await x.close().catch(() => {});
				res.details.sessions = [...sessions].map(x => ({ name: x.name, timings: x.timings, slow: x.slow || [], leftover: x.leftover || [], profileRemoved: x.profileRemoved ?? null }));
				sessions.clear();
			}
			res.ms   = Date.now() - t0;
			res.pass = !res.error && res.checks.length > 0 && res.checks.every(c => c.pass);
			results.scenarios.push(res);
			log(`scenario ${id} ${sc.name}: ${res.pass ? 'PASS' : 'FAIL'} (${res.checks.filter(c => c.pass).length}/${res.checks.length} checks, ${res.ms} ms)`);
			write();
		}
	} finally {
		await shutdown();
		results.leftoverProcesses = await reapProcs(runDir, allPids);
		results.finishedAt = new Date().toISOString();
		write();
	}
	console.log('\nSummary');
	for(let r of results.scenarios)
		console.log(`  ${String(r.id).padStart(2)} ${r.name.padEnd(32)} ${r.skipped ? 'SKIP' : r.pass ? 'PASS' : 'FAIL'}  ${r.checks.filter(c => c.pass).length}/${r.checks.length}${r.error ? '  ERROR: ' + r.error.split('\n')[0] : ''}`);
	console.log(`Leftover processes: ${results.leftoverProcesses.length ? results.leftoverProcesses.join('\n') : 'none'}`);
	console.log(`Results: ${args.out}`);
	// exit now: an undici WebSocket whose peer is gone can keep the event loop alive for ~10 s
	process.exit(results.scenarios.every(r => r.pass || r.skipped) ? 0 : 1);
}

main().catch(e => {
	console.error(e);
	process.exit(2);
});
