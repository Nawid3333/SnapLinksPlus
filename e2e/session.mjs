// One Firefox instance driven over WebDriver BiDi, with chrome-scope helpers for tabs, windows, clipboard,
// bookmarks, permissions and the extension's background state.
//
// Functions passed to chrome()/content() are stringified and run in Firefox: they must be self-contained.

import path from 'node:path';
import { Bidi, launchFirefox, createProfile, profilePrefs, removeDir, reapProcs, sleep, log, readManifest } from './lib.mjs';

export const KEY = { Ctrl: String.fromCharCode(0xE009), Shift: String.fromCharCode(0xE008), Alt: String.fromCharCode(0xE00A), Escape: String.fromCharCode(0xE00C) };	// WebDriver key codes

export class Session {
	static async start({ runDir, name, server, headless = true, idleTimeout, keepProfile = false, settleMs = 500 }) {
		let s = Object.assign(new Session(), { kind: 'firefox', runDir, name, server, headless, keepProfile, settleMs, seq: 0 });
		s.profileDir = path.join(runDir, `${name}-profile`);
		createProfile(s.profileDir, profilePrefs({ proxyPort: server.port, idleTimeout }));
		let t0 = Date.now();
		s.timings = {};
		s.ff   = await launchFirefox({ profileDir: s.profileDir, headless, logFile: path.join(runDir, `${name}-firefox.log`) });
		s.pids = [s.ff.pid];
		s.timings.launchMs = Date.now() - t0;
		try {
			s.bidi = await Bidi.connect(s.ff.wsUrl + '/session');
			let r = await s.bidi.send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
			s.browserPid     = r.capabilities['moz:processID'];
			s.browserVersion = r.capabilities.browserVersion;
			s.pids.push(s.browserPid);
			s.timings.sessionMs = Date.now() - t0;
			let tree = await s.bidi.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
			s.chromeCtx = tree.contexts.find(c => /^chrome:\/\/browser\/content\/browser\.x?html/.test(c.url))?.context;
			if(!s.chromeCtx)
				throw new Error('No browser.xhtml chrome context: ' + JSON.stringify(tree));
			await s.chrome(installChromeHelpers);
			if(!headless)
				s.savedClipboard = await s.readClipboard();
		} catch(e) {
			await s.close();
			throw e;
		}
		return s;
	}

	async close() {
		if(this.closed)
			return;
		this.closed = true;
		try {
			if(!this.headless && this.savedClipboard != null)
				await this.writeClipboard(this.savedClipboard);
		} catch(e) { log('could not restore the clipboard:', e.message); }
		let t0 = Date.now();
		if(this.bidi) {
			await this.bidi.send('browser.close', {}, 10000).catch(() => {});
			this.bidi.close();
		}
		if(this.ff) {
			let exited = await this.ff.waitExit(10000);
			await this.ff.kill();
			// The launcher can be gone while the browser process is still shutting down (or hung): wait, then kill it
			this.leftover = await reapProcs(this.profileDir, this.pids);
			this.timings.closeMs = Date.now() - t0;
			this.timings.exitedGracefully = exited;
			if(this.leftover.length)
				log(`  WARNING: processes of ${this.name} still listed after close:\n    ${this.leftover.join('\n    ')}`);
		}
		if(process.env.E2E_DEBUG || this.timings.closeMs > 10000)
			log('  session', this.name, JSON.stringify(this.timings));
		if(!this.keepProfile && this.profileDir)
			this.profileRemoved = await removeDir(this.profileDir);
	}

	/** Runs fn(args) in the browser window's chrome scope, returns its JSON-able result */
	async chrome(fn, args = null, timeout = 60000) {
		return this.evalIn(this.chromeCtx, fn, args, timeout);
	}

	/** Runs fn(args) in a content (page or extension page) context */
	async content(ctx, fn, args = null, timeout = 60000) {
		return this.evalIn(ctx, fn, args, timeout);
	}

	async evalIn(ctx, fn, args, timeout) {
		let expression = `Promise.resolve((${fn.toString()})(${JSON.stringify(args)})).then(v => JSON.stringify(v === undefined ? null : v))`;
		let r = await this.bidi.send('script.evaluate', { expression, target: { context: ctx }, awaitPromise: true }, timeout);
		if(r.type === 'exception')
			throw new Error(`evaluate failed in ${ctx === this.chromeCtx ? 'chrome' : 'content'}: ${r.exceptionDetails?.text}\n${fn.toString().slice(0, 300)}`);
		return JSON.parse(r.result.value);
	}

	// ---- extension ---------------------------------------------------------------------------------------------

	/** Temporarily installs a build dir; waits for its background to come up and onInstalled to record the version */
	async install(dir) {
		let manifest = readManifest(dir);
		let t0 = Date.now();
		let r = await this.bidi.send('webExtension.install', { extensionData: { type: 'path', path: dir } });
		this.extId    = r.extension;
		this.manifest = manifest;
		let info = await this.extInfo();
		this.uuid = info.uuid;
		let stored;
		for(let i = 0; i < 50; i++) {
			stored = await this.storage();
			if(stored.local.LastInstalledVersion === manifest.version)
				break;
			await sleep(100);
		}
		return { id: this.extId, ms: Date.now() - t0, version: manifest.version, mv: manifest.mv, lastInstalledVersion: stored.local.LastInstalledVersion ?? null, info: await this.extInfo() };
	}

	async uninstall() {
		await this.bidi.send('webExtension.uninstall', { extension: this.extId });
	}

	/** Policy, background and permission state of the extension, from chrome scope */
	async extInfo() {
		return this.chrome(async ({ id }) => {
			let p = WebExtensionPolicy.getByID(id);
			if(!p)
				return null;
			let ext = p.extension;
			let { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
			let { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
			let addon = await AddonManager.getAddonByID(id);
			let stored = await ExtensionPermissions.get(id);
			return {
				uuid:                 p.mozExtensionHostname,
				mv:                   p.manifestVersion,
				version:              addon?.version,
				temporary:            addon?.temporarilyInstalled,
				backgroundState:      ext?.backgroundState ?? null,
				persistentBackground: ext?.persistentBackground ?? null,
				allowedOrigins:       p.allowedOrigins.patterns.map(x => x.pattern),
				apiPermissions:       ext ? [...ext.permissions] : [],
				storedOptional:       stored,
			};
		}, { id: this.extId });
	}

	optionsUrl() {
		return `moz-extension://${this.uuid}/${this.manifest.optionsPage}`;
	}

	/** Runs fn(args) in a background tab showing the options page (has the extension's browser.* APIs) */
	async inOptionsPage(fn, args = null) {
		let t0 = Date.now();
		let { context } = await this.bidi.send('browsingContext.create', { type: 'tab', background: true });
		try {
			let t1 = Date.now();
			await this.bidi.send('browsingContext.navigate', { context, url: this.optionsUrl(), wait: 'complete' });
			let t2 = Date.now();
			let v = await this.content(context, fn, args);
			let t3 = Date.now();
			if(t3 - t0 > 2000 || process.env.E2E_DEBUG)
				log(`  (slow options page: create ${t1 - t0} ms, navigate ${t2 - t1} ms, evaluate ${t3 - t2} ms)`);
			(this.slow ||= []).push(...(t3 - t0 > 2000 ? [{ what: 'options page', create: t1 - t0, navigate: t2 - t1, evaluate: t3 - t2 }] : []));
			return v;
		} finally {
			await this.bidi.send('browsingContext.close', { context }).catch(() => {});
			await this.chrome(() => { window.__e2e.tabOpens = []; });
		}
	}

	async storage() {
		return this.inOptionsPage(async () => ({
			sync:  await browser.storage.sync.get(),
			local: await browser.storage.local.get(),
		}));
	}

	/** Writes prefs into the store the extension reads (StorageAPI in storage.local, sync by default) */
	async setPrefs(prefs) {
		let r = await this.inOptionsPage(async prefs => {
			let api = (await browser.storage.local.get('StorageAPI')).StorageAPI === 'local' ? 'local' : 'sync';
			await browser.storage[api].set(prefs);
			return { api, now: await browser.storage[api].get(Object.keys(prefs)) };
		}, prefs);
		await sleep(250);	// storage.onChanged reaches the content scripts and the background
		return r;
	}

	async hasPermission(perm) {
		return this.inOptionsPage(async perm => browser.permissions.contains({ permissions: [perm] }), perm);
	}

	async grantPermission(perm) {
		return this.chrome(async ({ id, perm }) => {
			let { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
			let ext = WebExtensionPolicy.getByID(id).extension;
			await ExtensionPermissions.add(id, { permissions: [perm], origins: [] }, ext);
			return ExtensionPermissions.get(id);
		}, { id: this.extId, perm });
	}

	async backgroundState() {
		return this.chrome(({ id }) => WebExtensionPolicy.getByID(id)?.extension?.backgroundState ?? null, { id: this.extId });
	}

	/** Asks Firefox to suspend the background (event page); returns states before/after */
	async terminateBackground() {
		return this.chrome(async ({ id }) => {
			let ext = WebExtensionPolicy.getByID(id).extension;
			let before = ext.backgroundState, error = null;
			try {
				await ext.terminateBackground({ ignoreDevToolsAttached: true, disableResetIdleForTest: true });
			} catch(e) {
				error = String(e);
			}
			return { before, after: ext.backgroundState, persistentBackground: ext.persistentBackground, error };
		}, { id: this.extId });
	}

	// ---- tabs and windows --------------------------------------------------------------------------------------

	/**
	 * Closes every other window and tab and shows url in one fresh tab (unique ?e2e=N so it can be found from chrome);
	 * fillers are opened as background tabs to its right. Returns the BiDi context of the fixture tab.
	 */
	async prepare(url, { fillers = [], settleMs = this.settleMs } = {}) {
		let u = new URL(url);
		u.searchParams.set('e2e', String(++this.seq));
		await this.chrome(() => {
			for(let w of [...Services.wm.getEnumerator('navigator:browser')])
				if(w !== window)
					w.close();
			window.focus();
		});
		let { context } = await this.bidi.send('browsingContext.create', { type: 'tab' });
		await this.bidi.send('browsingContext.navigate', { context, url: u.href, wait: 'complete' });
		await this.chrome(async ({ url, fillers }) => {
			let keep = gBrowser.tabs.find(t => t.linkedBrowser.currentURI.spec === url);
			if(!keep)
				throw new Error('fixture tab not found: ' + url);
			gBrowser.selectedTab = keep;
			for(let t of [...gBrowser.tabs])
				if(t !== keep)
					gBrowser.removeTab(t, { skipPermitUnload: true, animate: false });
			for(let f of fillers)
				gBrowser.addTab(f, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), inBackground: true, skipAnimation: true });
			gBrowser.selectedTab = keep;
			for(let i = 0; i < 100 && gBrowser.tabs.some(t => t.linkedBrowser.currentURI.spec === 'about:blank'); i++)
				await new Promise(r => setTimeout(r, 50));
		}, { url: u.href, fillers });
		await this.bidi.send('browsingContext.activate', { context });
		this.fixtureUrl = u.href;
		this.ctx = context;
		await this.recordMouseUps(context);
		await this.markTabs();
		await sleep(settleMs);	// content scripts: document_end + Prefs.Ready
		return context;
	}

	/** Remembers the current tabs and windows as "old" and clears the TabOpen log */
	async markTabs() {
		await this.chrome(() => {
			for(let w of Services.wm.getEnumerator('navigator:browser')) {
				w.__e2eOld = true;
				for(let t of w.gBrowser.tabs)
					t.__e2eOld = true;
			}
			window.__e2e.tabOpens = [];
		});
	}

	/** All browser windows and their tabs, in tab-strip order */
	async tabs() {
		return this.chrome(() => [...Services.wm.getEnumerator('navigator:browser')].map(w => ({
			main:    w === window,
			old:     !!w.__e2eOld,
			focused: Services.focus.activeWindow === w,
			tabs:    w.gBrowser.tabs.map((t, i) => ({
				i, url: t.linkedBrowser.currentURI.spec, selected: t.selected, old: !!t.__e2eOld,
			})),
		})));
	}

	/** Waits until n tabs that were not there at markTabs() exist (in any window) and have left about:blank */
	async waitNewTabs(n, timeout = 10000) {
		let t0 = Date.now(), snap;
		for(;;) {
			snap = await this.tabs();
			let fresh = snap.flatMap(w => w.tabs.filter(t => !t.old));
			if(n > 0 && fresh.length >= n && fresh.every(t => t.url !== 'about:blank'))
				break;
			if(Date.now() - t0 > timeout)
				break;
			await sleep(n > 0 ? 50 : 200);
		}
		return snap;
	}

	/** Closes the tabs opened since markTabs() and other windows, re-selects the fixture tab */
	async closeNewTabs() {
		await this.chrome(({ url }) => {
			for(let w of [...Services.wm.getEnumerator('navigator:browser')])
				if(w !== window)
					w.close();
			let keep = gBrowser.tabs.find(t => t.linkedBrowser.currentURI.spec === url);
			if(keep)
				gBrowser.selectedTab = keep;
			for(let t of [...gBrowser.tabs])
				if(!t.__e2eOld)
					gBrowser.removeTab(t, { skipPermitUnload: true, animate: false });
			window.__e2e.tabOpens = [];
		}, { url: this.fixtureUrl });
		await this.bidi.send('browsingContext.activate', { context: this.ctx });
	}

	// ---- input -------------------------------------------------------------------------------------------------

	/**
	 * A lasso drag with real (trusted) input: move to from, press button, move to each point of via+to in steps,
	 * pause, optionally press Escape, press atRelease keys, release (unless up=false). hold keys are held throughout.
	 */
	async drag(ctx, { from, to, via = [], button = 2, steps = 8, stepMs = 40, hold = [], atRelease = [], escape = false, settleMs = 150, up = true }) {
		let P = [], K = [];
		let tick = (p, k) => {
			P.push(p || { type: 'pause', duration: 0 });
			K.push(k || { type: 'pause', duration: 0 });
		};
		let r = v => Math.round(v);
		for(let k of hold)
			tick(null, { type: 'keyDown', value: KEY[k] });
		tick({ type: 'pointerMove', x: r(from.x), y: r(from.y), origin: 'viewport' });
		tick({ type: 'pointerDown', button });
		let prev = from;
		for(let pt of [...via, to]) {
			for(let i = 1; i <= steps; i++)
				tick({ type: 'pointerMove', x: r(prev.x + (pt.x - prev.x) * i / steps), y: r(prev.y + (pt.y - prev.y) * i / steps), origin: 'viewport', duration: stepMs });
			prev = pt;
		}
		tick({ type: 'pause', duration: settleMs });
		if(escape) {
			tick(null, { type: 'keyDown', value: KEY.Escape });
			tick(null, { type: 'keyUp', value: KEY.Escape });
		}
		for(let k of atRelease)
			tick(null, { type: 'keyDown', value: KEY[k] });
		if(up) {
			tick({ type: 'pointerUp', button });
			for(let k of [...atRelease, ...hold])
				tick(null, { type: 'keyUp', value: KEY[k] });
		}
		await this.bidi.send('input.performActions', {
			context: ctx,
			actions: [
				{ type: 'key', id: 'kbd', actions: K },
				{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: P },
			],
		}, 30000);
		if(up)
			await this.bidi.send('input.releaseActions', { context: ctx });
	}

	/** A real left click at viewport coordinates */
	async click(ctx, x, y) {
		await this.bidi.send('input.performActions', {
			context: ctx,
			actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
				{ type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport' },
				{ type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
			] }],
		}, 30000);
		await this.bidi.send('input.releaseActions', { context: ctx });
	}

	/** Opens the options page in a new active tab, returns its context */
	async openOptionsTab() {
		let { context } = await this.bidi.send('browsingContext.create', { type: 'tab' });
		await this.bidi.send('browsingContext.navigate', { context, url: this.optionsUrl(), wait: 'complete' });
		return context;
	}

	/** Not collected for Firefox (BiDi log events do not cover extension background pages) */
	async backgroundErrors() {
		return null;
	}

	/** Finishes a drag started with up=false */
	/** Moves the pointer while the button of a drag started with up=false is still held */
	async moveHeld(ctx, to, { steps = 4, stepMs = 40, settleMs = 300 } = {}) {
		let P = [];
		for(let i = 1; i <= steps; i++)
			P.push({ type: 'pointerMove', x: Math.round(to.x), y: Math.round(to.y), origin: 'viewport', duration: stepMs });
		P.push({ type: 'pause', duration: settleMs });
		await this.bidi.send('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: P }] }, 30000);
	}

	async release(ctx, { button = 2, escape = false } = {}) {
		let P = [], K = [];
		if(escape) {
			K.push({ type: 'keyDown', value: KEY.Escape }, { type: 'keyUp', value: KEY.Escape });
			P.push({ type: 'pause', duration: 0 }, { type: 'pause', duration: 0 });
		}
		P.push({ type: 'pointerUp', button });
		K.push({ type: 'pause', duration: 0 });
		await this.bidi.send('input.performActions', {
			context: ctx,
			actions: [
				{ type: 'key', id: 'kbd', actions: K },
				{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: P },
			],
		}, 30000);
		await this.bidi.send('input.releaseActions', { context: ctx });
	}

	/** Page-world log of mouseup times (epoch ms, sub-ms) and contextmenu events that reached the bubble phase */
	async recordMouseUps(ctx) {
		await this.content(ctx, () => {
			window.__e2eUps  = [];
			window.__e2eCtx  = [];
			window.addEventListener('mouseup', () => window.__e2eUps.push(performance.timeOrigin + performance.now()), true);
			window.addEventListener('contextmenu', e => window.__e2eCtx.push({ phase: 'bubble', prevented: e.defaultPrevented }), false);
		});
	}

	async lastMouseUp(ctx = this.ctx) {
		return this.content(ctx, () => window.__e2eUps.at(-1) ?? null);
	}

	async tabOpenTimes() {
		return this.chrome(() => window.__e2e.tabOpens);
	}

	/**
	 * Dispatches a trusted contextmenu event at a content point, the way Windows does after the right button is
	 * released (BiDi itself fires contextmenu at pointerDown, before the drag). Returns whether the browser tried
	 * to show its context menu (popupshowing reached the parent; the harness blocks the popup itself).
	 */
	async osContextMenu(x, y) {
		return this.chrome(async ({ x, y }) => {
			let before = window.__e2e.menuShowing.length;
			let b = gBrowser.selectedBrowser.getBoundingClientRect();
			window.synthesizeMouseEvent('contextmenu', b.left + x, b.top + y, { button: 2, buttons: 0, clickCount: 1, modifiers: 0, inputSource: MouseEvent.MOZ_SOURCE_MOUSE }, { isDOMEventSynthesized: false, isWidgetEventSynthesized: false, isAsyncEnabled: false });
			await new Promise(r => setTimeout(r, 400));
			return { menuAttempted: window.__e2e.menuShowing.length > before, menuEvents: window.__e2e.menuShowing.slice(before) };
		}, { x, y });
	}

	async menuAttempts() {
		return this.chrome(() => window.__e2e.menuShowing.length);
	}

	// ---- clipboard, bookmarks, processes -----------------------------------------------------------------------

	async readClipboard() {
		return this.chrome(() => {
			let trans = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
			trans.init(null);
			trans.addDataFlavor('text/plain');
			try {
				Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard, window.browsingContext.currentWindowContext);
			} catch(e) {
				Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard);
			}
			let out = {};
			try {
				trans.getTransferData('text/plain', out);
			} catch(e) {
				return null;
			}
			return out.value?.QueryInterface(Ci.nsISupportsString).data ?? null;
		});
	}

	async writeClipboard(text) {
		return this.chrome(({ text }) => {
			Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(text);
		}, { text });
	}

	/** Waits until the clipboard differs from sentinel */
	async waitClipboard(sentinel, timeout = 5000) {
		let t0 = Date.now(), v;
		do {
			v = await this.readClipboard();
			if(v !== sentinel)
				return v;
			await sleep(100);
		} while(Date.now() - t0 < timeout);
		return v;
	}

	/** Bookmark folders titled "Snap Links ..." with their bookmarks in order */
	async snapLinksFolders() {
		return this.chrome(async () => {
			let { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
			let tree = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.rootGuid);
			let out = [];
			let walk = (n, parent) => {
				if(n.type === 'text/x-moz-place-container' && /^Snap Links /.test(n.title || ''))
					out.push({ title: n.title, parentGuid: parent?.guid, parentRoot: parent?.root || parent?.title, children: (n.children || []).map(c => ({ title: c.title, url: c.uri })) });
				for(let c of n.children || [])
					walk(c, n);
			};
			walk(tree, null);
			return { unfiledGuid: PlacesUtils.bookmarks.unfiledGuid, folders: out };
		});
	}

	/** CPU time (ms) per process: parent and children, with types (extension, web, ...) */
	async procInfo() {
		return this.chrome(async () => {
			let info = await ChromeUtils.requestProcInfo();
			return {
				parent:   { pid: info.pid, type: 'browser', cpuMs: info.cpuTime / 1e6 },
				children: info.children.map(c => ({ pid: c.pid, type: c.type, origin: c.origin, cpuMs: c.cpuTime / 1e6 })),
			};
		});
	}

	async pref(name) {
		return this.chrome(({ name }) => {
			let t = Services.prefs.getPrefType(name);
			if(t === Services.prefs.PREF_BOOL)
				return { value: Services.prefs.getBoolPref(name), user: Services.prefs.prefHasUserValue(name) };
			if(t === Services.prefs.PREF_INT)
				return { value: Services.prefs.getIntPref(name), user: Services.prefs.prefHasUserValue(name) };
			if(t === Services.prefs.PREF_STRING)
				return { value: Services.prefs.getStringPref(name), user: Services.prefs.prefHasUserValue(name) };
			return { value: null };
		}, { name });
	}
}

/** Runs once per browser window: TabOpen timestamps and a guard that keeps the content context menu from opening */
function installChromeHelpers() {
	window.__e2e = { tabOpens: [], menuShowing: [] };
	gBrowser.tabContainer.addEventListener('TabOpen', () => window.__e2e.tabOpens.push(performance.timeOrigin + performance.now()));
	let menu = document.getElementById('contentAreaContextMenu');
	menu.addEventListener('popupshowing', e => {
		if(e.target !== menu)
			return;
		window.__e2e.menuShowing.push(performance.timeOrigin + performance.now());
		e.preventDefault();
		e.stopImmediatePropagation();
	}, true);
	return true;
}
