// Chromium-family driver (Microsoft Edge, Playwright's Chromium) over the Chrome DevTools Protocol, with the same
// interface as Session in session.mjs so the scenarios run unchanged where they apply.
//
// Extension APIs (chrome.tabs/windows/storage/permissions/bookmarks) are called from a "control tab": the extension's
// options page, pinned at the left of the main window and filtered out of every tab list. This works the same for an
// MV2 background page and an MV3 service worker (which may be stopped at any time and must not be kept alive by us).

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, sleep, log, readManifest, reapProcs, removeDir, killTree } from './lib.mjs';

/** Default executables */
export function chromiumExe(kind) {
	// Linux (WSL): Microsoft Edge for Linux / Chrome for Testing, unpacked where E2E_EDGE / E2E_CHROMIUM point
	if(process.platform !== 'win32') {
		let exe = kind === 'edge' ? process.env.E2E_EDGE : process.env.E2E_CHROMIUM;
		if(!exe || !fs.existsSync(exe))
			throw new Error(`Set ${kind === 'edge' ? 'E2E_EDGE' : 'E2E_CHROMIUM'} to the ${kind} executable (got: ${exe})`);
		return exe;
	}
	if(kind === 'edge')
		return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
	let root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
	let dirs = fs.existsSync(root) ? fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
	for(let d of dirs) {
		let exe = path.join(root, d, 'chrome-win64', 'chrome.exe');
		if(fs.existsSync(exe))
			return exe;
	}
	throw new Error(`No Playwright Chromium under ${root}`);
}

/** Minimal CDP client (flat sessions) over Node's built-in WebSocket */
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.nextId = 1;
		this.pending = new Map();
		this.handlers = new Set();
		ws.addEventListener('message', ev => {
			let msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
			if(msg.id != null && this.pending.has(msg.id)) {
				let p = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message} ${msg.error.data || ''}`)) : p.resolve(msg.result);
			} else if(msg.method) {
				for(let h of [...this.handlers])
					h(msg);
			}
		});
		ws.addEventListener('close', () => {
			for(let [, p] of this.pending)
				p.reject(new Error('CDP connection closed'));
			this.pending.clear();
		});
	}

	static async connect(url) {
		let ws = new WebSocket(url);
		await new Promise((resolve, reject) => {
			ws.addEventListener('open', resolve, { once: true });
			ws.addEventListener('error', e => reject(new Error(`WebSocket error connecting to ${url}: ${e.message || e.type}`)), { once: true });
		});
		return new Cdp(ws);
	}

	send(method, params = {}, sessionId = undefined, timeout = 60000) {
		let id = this.nextId++;
		return new Promise((resolve, reject) => {
			let timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method}: timed out after ${timeout}ms`));
			}, timeout);
			this.pending.set(id, {
				method,
				resolve: v => { clearTimeout(timer); resolve(v); },
				reject:  e => { clearTimeout(timer); reject(e); },
			});
			this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
		});
	}

	close() {
		try {
			this.ws.close();
		} catch(e) { /* ignore */ }
	}
}

const MOD  = { Alt: 1, Ctrl: 2, Shift: 8 };
const KEYS = {
	Alt:    { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 },
	Ctrl:   { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 },
	Shift:  { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 },
	Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
};
const BUTTON = { 0: ['left', 1], 1: ['middle', 4], 2: ['right', 2] };

// Text the copy scenarios put on the clipboard: if the system clipboard holds any of it at the end, it was us
const OUR_CLIPBOARD = /^(e2e-sentinel|https:\/\/en\.wiktionary\.org|\[cooker\]|cooker\t)/;

export class CdpSession {
	static async start({ runDir, name, server, build, kind = 'edge', exe, headless = true, keepProfile = false, settleMs = 500 }) {
		let s = Object.assign(new CdpSession(), { kind: 'chromium', browserKind: kind, runDir, name, server, headless, keepProfile, settleMs, seq: 0, timings: {}, pids: [], targetTab: new Map() });
		s.exe        = exe || chromiumExe(kind);
		s.profileDir = path.join(runDir, `${name}-profile`);
		s.build      = build;
		s.manifest   = readManifest(build);
		fs.mkdirSync(s.profileDir, { recursive: true });
		// Edge keeps running after its last window closes ("continue running background apps"): off in this profile
		fs.writeFileSync(path.join(s.profileDir, 'Local State'), JSON.stringify({ background_mode: { enabled: false } }));
		s.savedSystemClipboard = readSystemClipboard();
		let t0 = Date.now();
		await s.launch();
		s.timings.launchMs = Date.now() - t0;
		try {
			s.cdp = await Cdp.connect(s.wsUrl);
			let v = await s.cdp.send('Browser.getVersion');
			s.browserVersion = `${kind} ${v.product}`;
			await s.cdp.send('Target.setDiscoverTargets', { discover: true });
			// The extension: its background page (MV2) or service worker (MV3). The browser runs built-in extensions
			// too: an MV3 worker is matched by its script path, an MV2 page by its title (the extension's name).
			let swPath = s.manifest.background?.service_worker ? '/' + s.manifest.background.service_worker.replace(/^\//, '') : null;
			let ours   = t => t.url.startsWith('chrome-extension://') && (swPath
				? t.type === 'service_worker' && new URL(t.url).pathname === swPath
				: t.type === 'background_page' && t.title === s.manifest.raw.name);
			for(let i = 0; i < 150 && !s.extId; i++) {
				let { targetInfos } = await s.cdp.send('Target.getTargets');
				let bg = targetInfos.find(ours);
				if(bg) {
					s.extId  = new URL(bg.url).host;
					s.bgType = bg.type;
					s.bgUrl  = bg.url;
				} else {
					s.otherExtensions = targetInfos.filter(t => t.url.startsWith('chrome-extension://')).map(t => ({ type: t.type, url: t.url, title: t.title }));
					await sleep(100);
				}
			}
			if(!s.extId)
				throw new Error(`${kind}: the extension did not start (no matching background_page/service_worker target). MV2 builds only load in Edge; Chromium 139+ refuses MV2. Extension targets seen: ${JSON.stringify(s.otherExtensions)}`);
			s.uuid = s.extId;
			s.timings.extensionFoundMs = Date.now() - t0;
			await s.openControlTab();
			s.timings.controlTabMs = Date.now() - t0;
			await s.watchBackgroundPage();
			s.timings.sessionMs = Date.now() - t0;
		} catch(e) {
			await s.close();
			throw e;
		}
		return s;
	}

	/**
	 * Sound from a test browser must never reach the speakers.  Edge on Windows plays a sound for an extension's
	 * notification (Snap Links shows one when it is installed, in every fresh profile) from its own process, not as a
	 * Windows notification, and neither --mute-audio nor --disable-features=NativeNotifications,SystemNotifications stops
	 * it (measured with the Windows audio session peak meter).  So Edge/Chromium run on Linux (WSL): there the browser
	 * gets no audio server (WSLg forwards PulseAudio to the Windows speakers) and ALSA's default device is the null device.
	 * On Windows they run only when E2E_ALLOW_SOUND=1 says that is wanted.
	 *
	 * @return {object} The environment for the browser process
	 */
	silentEnv() {
		if(process.platform === 'win32') {
			if(process.env.E2E_ALLOW_SOUND !== '1')
				throw new Error('Edge/Chromium tests make sound on Windows (Edge plays a notification sound no flag can stop). Run them in WSL/Linux, where the browser has no audio device, or set E2E_ALLOW_SOUND=1.');
			return process.env;
		}
		let runtime = path.join(this.runDir, `${this.name}-runtime`),
			alsa    = path.join(this.runDir, `${this.name}-asound.conf`);
		fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
		fs.writeFileSync(alsa, 'pcm.!default { type null }\n');
		return {
			...process.env,
			PULSE_SERVER:     'unix:/nonexistent/snaplinks-e2e-no-audio',	// No PulseAudio, so nothing reaches WSLg's server
			XDG_RUNTIME_DIR:  runtime,										// Not WSLg's runtime dir with its pulse/native socket
			ALSA_CONFIG_PATH: alsa,											// ALSA's default output is the null device
		};
	}

	async launch() {
		let env  = this.silentEnv();
		let port = await freePort();
		let args = [
			...(this.headless ? ['--headless=new'] : []),
			`--user-data-dir=${this.profileDir}`, `--remote-debugging-port=${port}`,
			`--load-extension=${this.build}`, `--disable-extensions-except=${this.build}`,
			'--no-first-run', '--no-default-browser-check', '--disable-default-apps', '--disable-sync',
			'--disable-background-networking', '--disable-component-update', '--no-pings', '--password-store=basic',
			// Links stay as written (Chromium/Edge would otherwise try https:// first for http:// links)
			'--mute-audio',
			'--disable-features=NativeNotifications,SystemNotifications,HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,AutomaticHttps,msAutomaticHttps',
			// The control tab is a background tab: keep its timers and the renderer at full speed
			'--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
			`--proxy-server=http://127.0.0.1:${this.server.port}`, '--window-size=1280,1000', 'about:blank',
		];
		this.proc = spawn(this.exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
		this.pids.push(this.proc.pid);
		let out = fs.createWriteStream(path.join(this.runDir, `${this.name}-${this.browserKind}.log`));
		this.exited = new Promise(r => this.proc.on('exit', r));
		this.wsUrl = await new Promise((resolve, reject) => {
			let buf = '';
			let timer = setTimeout(() => reject(new Error(`${this.browserKind} did not open DevTools within 60s:\n${buf.slice(-2000)}`)), 60000);
			let onData = d => {
				out.write(d);
				buf += d.toString();
				let m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
				if(m) {
					clearTimeout(timer);
					resolve(m[1]);
				}
			};
			this.proc.stdout.on('data', onData);
			this.proc.stderr.on('data', onData);
			this.proc.on('exit', code => {
				clearTimeout(timer);
				reject(new Error(`${this.browserKind} exited early (code ${code}):\n${buf.slice(-2000)}`));
			});
		});
		this.logStream = out;
	}

	async close() {
		if(this.closed)
			return;
		this.closed = true;
		let t0 = Date.now();
		if(this.cdp) {
			this.timings.browserClose = await this.cdp.send('Browser.close', {}, undefined, 10000).then(() => 'ok', e => e.message);
			this.cdp.close();
		}
		if(this.proc) {
			// Edge keeps running after Browser.close (background mode), so it gets 3 s before its process tree is killed
			let exited = await Promise.race([this.exited.then(() => true), sleep(3000).then(() => false)]);
			if(!exited) {
				try {
					killTree(this.proc.pid);
				} catch(e) { /* gone */ }
			}
			this.leftover = await reapProcs(this.profileDir, this.pids, { graceMs: 2000 });
			this.timings.closeMs = Date.now() - t0;
			this.timings.exitedGracefully = exited;
			if(this.leftover.length)
				log(`  WARNING: processes of ${this.name} still listed after close:\n    ${this.leftover.join('\n    ')}`);
		}
		this.logStream?.end();
		// If our test text ended up on the system clipboard, put the user's text back
		let now = readSystemClipboard();
		if(now != null && OUR_CLIPBOARD.test(now) && this.savedSystemClipboard != null && !OUR_CLIPBOARD.test(this.savedSystemClipboard)) {
			writeSystemClipboard(this.savedSystemClipboard);
			this.restoredSystemClipboard = true;
			log('  the system clipboard held test text: restored the previous text');
		}
		if(process.env.E2E_DEBUG || this.timings.closeMs > 10000)
			log('  session', this.name, JSON.stringify(this.timings));
		if(!this.keepProfile)
			this.profileRemoved = await removeDir(this.profileDir);
	}

	// ---- evaluation ---------------------------------------------------------------------------------------------

	async evalIn(sessionId, fn, args, timeout = 60000) {
		let expression = `Promise.resolve((${fn.toString()})(${JSON.stringify(args)})).then(v => JSON.stringify(v === undefined ? null : v))`;
		let r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId, timeout);
		if(r.exceptionDetails)
			throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${fn.toString().slice(0, 300)}`);
		return JSON.parse(r.result.value);
	}

	content(ctx, fn, args = null, timeout) {
		return this.evalIn(ctx, fn, args, timeout);
	}

	/** Runs fn(args) in the control tab (an extension page): globalThis.B is browser (polyfill) or chrome */
	ext(fn, args = null, timeout) {
		let wrapped = `async (args) => { const B = globalThis.browser || chrome; return (${fn.toString()})(args, B); }`;
		return this.evalIn(this.controlSession, { toString: () => wrapped }, args, timeout);
	}

	async attach(targetId) {
		let { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
		await this.cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
		return sessionId;
	}

	async findTarget(pred, timeout = 10000) {
		let t0 = Date.now();
		for(;;) {
			let { targetInfos } = await this.cdp.send('Target.getTargets');
			let t = targetInfos.find(pred);
			if(t || Date.now() - t0 > timeout)
				return t;
			await sleep(100);
		}
	}

	/**
	 * MV2 only: stays attached to the persistent background page and collects its uncaught errors and console errors
	 * (an MV3 service worker is not watched: an attached DevTools session would keep it from stopping).
	 */
	async watchBackgroundPage() {
		this.bgErrors = [];
		if(this.bgType !== 'background_page')
			return;
		let bg = await this.findTarget(t => t.type === 'background_page' && t.url.startsWith(`chrome-extension://${this.extId}/`), 2000);
		if(!bg)
			return;
		let sid = await this.attach(bg.targetId);
		this.cdp.handlers.add(msg => {
			if(msg.sessionId !== sid)
				return;
			if(msg.method === 'Runtime.exceptionThrown')
				this.bgErrors.push({ t: Date.now(), type: 'exception', text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text });
			else if(msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
				this.bgErrors.push({ t: Date.now(), type: 'console.' + msg.params.type, text: msg.params.args.map(a => a.value ?? a.description ?? '').join(' ') });
		});
	}

	/** Errors seen in the background page since the last call */
	async backgroundErrors() {
		return (this.bgErrors || []).splice(0);
	}

	async openControlTab() {
		// Chromium refuses to navigate a DevTools-created tab to a chrome-extension:// page (chrome-error), so the
		// extension's own background (page or service worker) opens it; then we detach, so an MV3 worker can stop
		// Retried: in Chromium the worker target is sometimes reached in a state without the tabs API (seen in session
		// start only; the worker itself has it, checked separately)
		for(let attempt = 1; ; attempt++) {
			let bg = await this.findTarget(t => t.type === this.bgType && t.url.startsWith(`chrome-extension://${this.extId}/`), 10000);
			if(!bg)
				throw new Error('background target gone before the control tab could be opened');
			let bgSession = await this.attach(bg.targetId);
			try {
				await this.evalIn(bgSession, async url => {
					let B = globalThis.browser || chrome;
					await B.tabs.create({ url, active: false, pinned: true });
				}, this.optionsUrl());
				break;
			} catch(e) {
				log(`  control tab attempt ${attempt} via ${bg.type} ${bg.url} failed: ${e.message.split('\n')[0]}`);
				if(attempt >= 4)
					throw e;
				await sleep(1500);
			} finally {
				await this.cdp.send('Target.detachFromTarget', { sessionId: bgSession }).catch(() => {});
			}
		}
		let target = await this.findTarget(t => t.type === 'page' && t.url === this.optionsUrl(), 10000);
		if(!target)
			throw new Error('control tab (options page) did not open');
		this.controlTargetId = target.targetId;
		this.controlSession  = await this.attach(target.targetId);
		let state;
		for(let i = 0; i < 100; i++) {
			state = await this.evalIn(this.controlSession, () => ({ href: location.href, text: document.body?.innerText?.slice(0, 300), ready: document.readyState, tabs: typeof (globalThis.browser || globalThis.chrome)?.tabs, chromeTabs: typeof globalThis.chrome?.tabs })).catch(e => ({ error: e.message }));
			if(state.ready === 'complete' && state.tabs === 'object')
				break;
			await sleep(100);
		}
		if(state.tabs !== 'object')
			throw new Error('control tab (options page) has no tabs API: ' + JSON.stringify(state));
		let r = await this.ext(async (args, B) => {
			let tab = await B.tabs.getCurrent();
			await B.tabs.update(tab.id, { pinned: true, active: false });
			window.__e2eTabOpens = [];
			B.tabs.onCreated.addListener(() => window.__e2eTabOpens.push(performance.timeOrigin + performance.now()));
			return { tabId: tab.id, windowId: tab.windowId };
		});
		this.controlTabId = r.tabId;
		this.mainWindowId = r.windowId;
	}

	// ---- extension -----------------------------------------------------------------------------------------------

	/** The build was loaded at launch (--load-extension); waits for onInstalled to record the version */
	async install(dir) {
		if(path.resolve(dir) !== path.resolve(this.build))
			throw new Error(`${this.browserKind}: the build is loaded at launch, cannot install ${dir} later`);
		let stored;
		for(let i = 0; i < 50; i++) {
			stored = await this.storage();
			if(stored.local.LastInstalledVersion === this.manifest.version)
				break;
			await sleep(100);
		}
		return { id: this.extId, ms: null, version: this.manifest.version, mv: this.manifest.mv, background: this.bgType, lastInstalledVersion: stored.local.LastInstalledVersion ?? null, info: await this.extInfo() };
	}

	async extInfo() {
		let r = await this.ext(async (args, B) => {
			let m = B.runtime.getManifest(), p = await B.permissions.getAll();
			return { uuid: B.runtime.id, mv: m.manifest_version, version: m.version, background: m.background, permissions: p };
		});
		let persistent = r.mv === 2 && !r.background?.service_worker && r.background?.persistent !== false;
		return {
			uuid: r.uuid, mv: r.mv, version: r.version, temporary: null,
			backgroundState: await this.backgroundState(), backgroundType: this.bgType, persistentBackground: persistent,
			allowedOrigins: r.permissions.origins || [], apiPermissions: r.permissions.permissions || [], storedOptional: null,
		};
	}

	optionsUrl() {
		return `chrome-extension://${this.extId}/${this.manifest.optionsPage}`;
	}

	async storage() {
		return this.ext(async (args, B) => ({ sync: await B.storage.sync.get(null), local: await B.storage.local.get(null) }));
	}

	async setPrefs(prefs) {
		let r = await this.ext(async (prefs, B) => {
			let api = (await B.storage.local.get('StorageAPI')).StorageAPI === 'local' ? 'local' : 'sync';
			await B.storage[api].set(prefs);
			return { api, now: await B.storage[api].get(Object.keys(prefs)) };
		}, prefs);
		await sleep(250);
		return r;
	}

	async hasPermission(perm) {
		return this.ext(async (perm, B) => B.permissions.contains({ permissions: [perm] }), perm);
	}

	/** permissions.request() shows a browser prompt that CDP cannot answer; tried with a short timeout */
	async grantPermission(perm) {
		try {
			return await this.ext(async (perm, B) => ({ granted: await B.permissions.request({ permissions: [perm] }) }), perm, 5000);
		} catch(e) {
			return { granted: false, error: e.message };
		}
	}

	async backgroundState() {
		let { targetInfos } = await this.cdp.send('Target.getTargets');
		return targetInfos.some(t => t.type === this.bgType && t.url.startsWith(`chrome-extension://${this.extId}/`)) ? 'running' : 'stopped';
	}

	/** Stops an MV3 service worker (ServiceWorker.stopAllWorkers); a background page cannot be stopped this way */
	async terminateBackground() {
		let before = await this.backgroundState(), error = null;
		try {
			await this.cdp.send('ServiceWorker.enable', {}, this.controlSession);
			await this.cdp.send('ServiceWorker.stopAllWorkers', {}, this.controlSession);
		} catch(e) {
			error = e.message;
		}
		let after;
		for(let i = 0; i < 30; i++) {
			after = await this.backgroundState();
			if(after !== 'running')
				break;
			await sleep(100);
		}
		return { before, after, persistentBackground: this.bgType === 'background_page', error };
	}

	// ---- tabs and windows ----------------------------------------------------------------------------------------

	async prepare(url, { fillers = [], settleMs = this.settleMs } = {}) {
		let u = new URL(url);
		u.searchParams.set('e2e', String(++this.seq));
		let tp = Date.now();
		let r = await this.ext(async ({ url, fillers, main, control }, B) => {
			for(let w of await B.windows.getAll({}))
				if(w.id !== main)
					await B.windows.remove(w.id);
			let tab = await B.tabs.create({ windowId: main, url, active: true });
			for(let t of await B.tabs.query({ windowId: main }))
				if(t.id !== tab.id && t.id !== control)
					await B.tabs.remove(t.id);
			for(let f of fillers)
				await B.tabs.create({ windowId: main, url: f, active: false });
			await B.windows.update(main, { focused: true }).catch(() => {});
			return { tabId: tab.id };
		}, { url: u.href, fillers, main: this.mainWindowId, control: this.controlTabId });
		// Poll from here: timers in the (background) control tab are throttled
		for(let i = 0; i < 200; i++) {
			let ts = await this.ext(async ({ main }, B) => B.tabs.query({ windowId: main }), { main: this.mainWindowId });
			if(ts.every(t => t.status === 'complete'))
				break;
			await sleep(50);
		}
		let tw = Date.now();
		let target = await this.findTarget(t => t.type === 'page' && t.url === u.href);
		if(!target)
			throw new Error('fixture target not found: ' + u.href);
		if(process.env.E2E_DEBUG)
			log(`  prepare: tabs ${tw - tp} ms, target ${Date.now() - tw} ms`);
		this.ctx        = await this.attach(target.targetId);
		this.fixtureUrl = u.href;
		this.fixtureTab = r.tabId;
		this.targetTab.set(target.targetId, r.tabId);
		await this.cdp.send('Page.bringToFront', {}, this.ctx).catch(() => {});
		await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, this.ctx).catch(() => {});
		await this.cdp.send('Browser.grantPermissions', { origin: u.origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(e => log('  grantPermissions:', e.message));
		await this.recordMouseUps(this.ctx);
		await this.markTabs();
		await sleep(settleMs);
		return this.ctx;
	}

	/** Windows and tabs as chrome.tabs sees them: without the "tabs" permission there are no URLs */
	async rawTabs() {
		return this.ext(async (args, B) => (await B.windows.getAll({ populate: true })).map(w => ({
			id: w.id, focused: w.focused, type: w.type,
			tabs: w.tabs.map(t => ({ id: t.id, i: t.index, selected: t.active, status: t.status, url: t.url || t.pendingUrl || null })),
		})));
	}

	/**
	 * Maps page targets (which have URLs) to tab ids (which have order): activates each unknown target, reads the
	 * active tab of its window, then restores the active tabs and the focused window.
	 */
	async mapTargets() {
		let { targetInfos } = await this.cdp.send('Target.getTargets');
		let pages   = targetInfos.filter(t => t.type === 'page' && t.targetId !== this.controlTargetId);
		let unknown = pages.filter(t => !this.targetTab.has(t.targetId));
		if(unknown.length) {
			let tm = Date.now();
			let before = await this.rawTabs();
			for(let t of unknown) {
				await this.cdp.send('Target.activateTarget', { targetId: t.targetId }).catch(() => {});
				let after = await this.rawTabs();
				let changed = after.flatMap(w => w.tabs.filter(x => x.selected && !before.find(b => b.id === w.id)?.tabs.find(y => y.id === x.id)?.selected));
				let tabId = changed[0]?.id;
				if(tabId == null) {
					// Already active: its window via the Browser domain, else the only active tab not mapped yet
					let win = await this.cdp.send('Browser.getWindowForTarget', { targetId: t.targetId }).catch(() => null);
					let mapped = new Set(this.targetTab.values());
					let cands = after.flatMap(w => w.tabs.filter(x => x.selected && (!win || w.id === win.windowId) && !mapped.has(x.id)));
					if(cands.length === 1)
						tabId = cands[0].id;
				}
				if(tabId != null)
					this.targetTab.set(t.targetId, tabId);
			}
			await this.ext(async ({ before }, B) => {
				for(let w of before) {
					let a = w.tabs.find(t => t.selected);
					if(a)
						await B.tabs.update(a.id, { active: true }).catch(() => {});
				}
				let f = before.find(w => w.focused);
				if(f)
					await B.windows.update(f.id, { focused: true }).catch(() => {});
			}, { before });
			if(process.env.E2E_DEBUG)
				log(`  mapTargets: ${unknown.length} targets in ${Date.now() - tm} ms`);
		}
		let urls = new Map();
		for(let t of pages)
			if(this.targetTab.has(t.targetId))
				urls.set(this.targetTab.get(t.targetId), t.url);
		return urls;
	}

	async markTabs() {
		let wins = await this.rawTabs();
		this.oldWindows = new Set(wins.map(w => w.id));
		this.oldTabs    = new Set(wins.flatMap(w => w.tabs.map(t => t.id)));
		await this.ext(() => { window.__e2eTabOpens = []; });
	}

	/** Same shape as the Firefox session; the control tab is left out and indices renumbered without it */
	async tabs() {
		let urls = await this.mapTargets();
		let wins = await this.rawTabs();
		return wins.map(w => ({
			main: w.id === this.mainWindowId, old: this.oldWindows?.has(w.id) ?? true, focused: w.focused,
			tabs: w.tabs.filter(t => t.id !== this.controlTabId).map((t, i) => ({ i, url: t.url || urls.get(t.id) || '', selected: t.selected, old: this.oldTabs?.has(t.id) ?? true })),
		}));
	}

	/** Polls chrome.tabs (cheap) until n new tabs have loaded, then maps URLs once */
	async waitNewTabs(n, timeout = 10000) {
		let t0 = Date.now();
		for(;;) {
			let wins  = await this.rawTabs();
			let fresh = wins.flatMap(w => w.tabs.filter(t => t.id !== this.controlTabId && !this.oldTabs.has(t.id)));
			if(n > 0 && fresh.length >= n && fresh.every(t => t.status === 'complete')) {
				let snap = await this.tabs();
				if(snap.flatMap(w => w.tabs.filter(t => !t.old)).every(t => t.url && t.url !== 'about:blank'))
					return snap;
			}
			if(Date.now() - t0 > timeout)
				return this.tabs();
			await sleep(n > 0 ? 50 : 200);
		}
	}

	async closeNewTabs() {
		await this.ext(async ({ main, oldTabs, fixture }, B) => {
			for(let w of await B.windows.getAll({ populate: true })) {
				if(w.id !== main) {
					await B.windows.remove(w.id);
					continue;
				}
				for(let t of w.tabs)
					if(!oldTabs.includes(t.id))
						await B.tabs.remove(t.id);
			}
			await B.tabs.update(fixture, { active: true });
			window.__e2eTabOpens = [];
		}, { main: this.mainWindowId, oldTabs: [...this.oldTabs], fixture: this.fixtureTab });
		await this.cdp.send('Page.bringToFront', {}, this.ctx).catch(() => {});
	}

	async tabOpenTimes() {
		return this.ext(() => window.__e2eTabOpens);
	}

	// ---- input ---------------------------------------------------------------------------------------------------

	async mouse(ctx, type, x, y, button, buttons, modifiers, clickCount = 0) {
		this.lastPos = { x, y };
		await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, modifiers, clickCount, pointerType: 'mouse' }, ctx);
	}

	async key(ctx, name, down, modifiers) {
		let k = KEYS[name];
		await this.cdp.send('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', modifiers, ...k }, ctx);
	}

	async drag(ctx, { from, to, via = [], button = 2, steps = 8, stepMs = 40, hold = [], atRelease = [], escape = false, settleMs = 150, up = true }) {
		let [name, mask] = BUTTON[button];
		let mods = hold.reduce((m, k) => m | (MOD[k] || 0), 0);
		for(let k of hold)
			await this.key(ctx, k, true, mods);
		await this.mouse(ctx, 'mouseMoved', from.x, from.y, 'none', 0, mods);
		await this.mouse(ctx, 'mousePressed', from.x, from.y, name, mask, mods, 1);
		let prev = from;
		for(let pt of [...via, to]) {
			for(let i = 1; i <= steps; i++) {
				await sleep(stepMs);
				await this.mouse(ctx, 'mouseMoved', prev.x + (pt.x - prev.x) * i / steps, prev.y + (pt.y - prev.y) * i / steps, name, mask, mods);
			}
			prev = pt;
		}
		await sleep(settleMs);
		this.dragState = { name, mask, mods, hold };
		if(escape) {
			await this.key(ctx, 'Escape', true, mods);
			await this.key(ctx, 'Escape', false, mods);
		}
		if(!up)
			return;
		let relMods = mods;
		for(let k of atRelease) {
			relMods |= MOD[k] || 0;
			await this.key(ctx, k, true, relMods);
		}
		await this.mouse(ctx, 'mouseReleased', to.x, to.y, name, 0, relMods, 1);
		for(let k of [...atRelease, ...hold])
			await this.key(ctx, k, false, 0);
	}

	/** Moves the pointer while the button of a drag started with up=false is still held */
	async moveHeld(ctx, to, { steps = 4, stepMs = 40, settleMs = 300 } = {}) {
		let { name, mask, mods } = this.dragState, from = this.lastPos;
		for(let i = 1; i <= steps; i++) {
			await sleep(stepMs);
			await this.mouse(ctx, 'mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, name, mask, mods);
		}
		await sleep(settleMs);
	}

	async release(ctx, { escape = false } = {}) {
		let { name, mods, hold } = this.dragState;
		if(escape) {
			await this.key(ctx, 'Escape', true, mods);
			await this.key(ctx, 'Escape', false, mods);
		}
		await this.mouse(ctx, 'mouseReleased', this.lastPos.x, this.lastPos.y, name, 0, mods, 1);
		for(let k of hold)
			await this.key(ctx, k, false, 0);
	}

	async click(ctx, x, y) {
		await this.mouse(ctx, 'mouseMoved', x, y, 'none', 0, 0);
		await this.mouse(ctx, 'mousePressed', x, y, 'left', 1, 0, 1);
		await this.mouse(ctx, 'mouseReleased', x, y, 'left', 0, 0, 1);
	}

	async recordMouseUps(ctx) {
		await this.content(ctx, () => {
			window.__e2eUps = [];
			window.__e2eCtx = [];
			window.addEventListener('mouseup', () => window.__e2eUps.push(performance.timeOrigin + performance.now()), true);
			window.addEventListener('contextmenu', e => window.__e2eCtx.push({ phase: 'bubble', prevented: e.defaultPrevented, t: performance.timeOrigin + performance.now() }), false);
		});
	}

	async lastMouseUp(ctx = this.ctx) {
		return this.content(ctx, () => window.__e2eUps.at(-1) ?? null);
	}

	/**
	 * Chromium on Windows dispatches contextmenu itself after a right button release, so this only reads what the page
	 * saw since the last call: a contextmenu that reached the bubble phase un-prevented would show the menu.
	 */
	async osContextMenu() {
		await sleep(400);
		let ev = await this.content(this.ctx, () => window.__e2eCtx.splice(0));
		return { menuAttempted: ev.some(e => !e.prevented), pageEvents: ev };
	}

	async menuAttempts() {
		return null;
	}

	// ---- clipboard, bookmarks, processes -------------------------------------------------------------------------

	async readClipboard() {
		return this.content(this.ctx, async () => {
			try {
				return await navigator.clipboard.readText();
			} catch(e) {
				return `(clipboard read failed: ${e.message})`;
			}
		});
	}

	async writeClipboard(text) {
		return this.content(this.ctx, async text => navigator.clipboard.writeText(text), text);
	}

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

	async snapLinksFolders() {
		return this.ext(async (args, B) => {
			if(!B.bookmarks)
				return { unfiledGuid: null, folders: [], unavailable: 'no bookmarks permission' };
			let out = [];
			let walk = n => {
				if(!n.url && /^Snap Links /.test(n.title || ''))
					out.push({ title: n.title, parentGuid: n.parentId, children: (n.children || []).map(c => ({ title: c.title, url: c.url })) });
				for(let c of n.children || [])
					walk(c);
			};
			for(let root of await B.bookmarks.getTree())
				walk(root);
			return { unfiledGuid: '2', folders: out };
		});
	}

	async procInfo() {
		let { processInfo } = await this.cdp.send('SystemInfo.getProcessInfo');
		let all = processInfo.map(p => ({ pid: p.id, type: p.type, cpuMs: p.cpuTime * 1000 }));
		return { parent: all.find(p => p.type === 'browser') || { pid: 0, type: 'browser', cpuMs: 0 }, children: all.filter(p => p.type !== 'browser') };
	}

	async pref() {
		return { value: null, note: 'Firefox-only preference' };
	}

	/** Opens the options page in a new active tab, returns its session */
	async openOptionsTab() {
		await this.ext(async ({ url, main }, B) => { await B.tabs.create({ windowId: main, url, active: true }); }, { url: this.optionsUrl(), main: this.mainWindowId });
		let t = await this.findTarget(t => t.type === 'page' && t.url === this.optionsUrl() && t.targetId !== this.controlTargetId, 5000);
		if(!t)
			throw new Error('options page target not found');
		let ctx = await this.attach(t.targetId);
		for(let i = 0; i < 50; i++) {
			if(await this.content(ctx, () => document.readyState === 'complete').catch(() => false))
				break;
			await sleep(100);
		}
		return ctx;
	}
}

/** The Windows clipboard text (PowerShell), null if it holds no text or cannot be read */
function readSystemClipboard() {
	if(process.platform !== 'win32')
		return null;	// Headless browsers on Linux use their own clipboard
	try {
		let out = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; $t = Get-Clipboard -Raw; if ($null -ne $t) { [Console]::Out.Write($t) }'], { encoding: 'utf8' });
		return out === '' ? null : out;
	} catch(e) {
		return null;
	}
}

function writeSystemClipboard(text) {
	if(process.platform !== 'win32')
		return;
	try {
		execFileSync('powershell.exe', ['-NoProfile', '-Command', '$t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t'], { input: text, encoding: 'utf8' });
	} catch(e) {
		log('  could not restore the system clipboard:', e.message);
	}
}
