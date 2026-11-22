// Infrastructure for the Snap Links e2e harness: fixture server + stub proxy, Firefox launcher, WebDriver BiDi client.
// No npm dependencies: Node's built-in WebSocket, http, child_process, fs.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

export const FIREFOX  = process.platform === 'win32' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : (process.env.E2E_FIREFOX || '/opt/firefox/firefox');
/** Kills a process and its children: taskkill on Windows, SIGKILL to the children and the process elsewhere */
export function killTree(pids) {
	pids = [].concat(pids).map(String);
	if(process.platform === 'win32')
		return execFileSync('taskkill', ['/T', '/F', ...pids.flatMap(p => ['/PID', p])], { stdio: 'ignore' });
	for(let pid of pids) {
		try { execFileSync('pkill', ['-KILL', '-P', pid], { stdio: 'ignore' }); } catch(e) { /* no children */ }
		try { process.kill(Number(pid), 'SIGKILL'); } catch(e) { /* gone */ }
	}
}

export const EXT_ID   = 'snaplinks@snaplinks.mozdev.org';
export const EXT_UUID = '5a1c1e2e-0000-4000-8000-000000005117';	// pinned via extensions.webextensions.uuids

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function log(...args) {
	console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...args);
}

/** A free TCP port on 127.0.0.1 */
export function freePort() {
	return new Promise((resolve, reject) => {
		let srv = net.createServer();
		srv.unref();
		srv.on('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			let { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

/**
 * Serves root (only) at http://127.0.0.1:<port>/, and acts as the browser's HTTP proxy so no request leaves the machine:
 *   - absolute-form requests for other hosts (http://en.wikipedia.org/...) get a tiny stub page (images: 404)
 *   - CONNECT (https) is refused with 403, so https links end in a proxy error page whose URL is still the link
 */
export async function startFixtureServer(root) {
	root = path.resolve(root);
	const Types = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif', '.png': 'image/png', '.svg': 'image/svg+xml' };
	const stats = { files: 0, stubbed: [], refusedConnect: [] };
	let port;
	const sockets = new Set();

	const server = http.createServer((req, res) => {
		let url;
		try {
			url = new URL(req.url, `http://127.0.0.1:${port}`);
		} catch(e) {
			return res.writeHead(400).end();
		}
		let own = url.hostname === '127.0.0.1' && Number(url.port) === port;
		if(!own) {
			stats.stubbed.push(url.href);
			if(/\.(png|jpe?g|gif|svg|ico|css|js|swf)$/i.test(url.pathname))
				return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('stub');
			let esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
			return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
				.end(`<!DOCTYPE html><html><head><title>stub ${esc(url.host)}</title></head><body><p>e2e stub for ${esc(url.href)}</p></body></html>`);
		}
		let file = path.join(root, path.normalize(decodeURIComponent(url.pathname)));
		if(!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
			return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
		stats.files++;
		res.writeHead(200, { 'Content-Type': Types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
		fs.createReadStream(file).pipe(res);
	});
	server.on('connect', (req, socket) => {
		stats.refusedConnect.push(req.url);
		socket.on('error', () => {});
		socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
	});
	server.on('connection', s => {
		sockets.add(s);
		s.on('close', () => sockets.delete(s));
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	port = server.address().port;
	return {
		port,
		base: `http://127.0.0.1:${port}/`,
		stats,
		close: () => new Promise(resolve => {
			for(let s of sockets)
				s.destroy();
			server.close(() => resolve());
		}),
	};
}

/** user.js preferences for a quiet, offline test profile */
export function profilePrefs({ proxyPort, idleTimeout }) {
	let p = {
		'browser.shell.checkDefaultBrowser':                          false,
		'browser.startup.homepage_override.mstone':                   'ignore',
		'browser.startup.page':                                       0,
		'browser.startup.homepage':                                   'about:blank',
		'startup.homepage_welcome_url':                               'about:blank',
		'startup.homepage_welcome_url.additional':                    '',
		'browser.aboutwelcome.enabled':                               false,
		'trailhead.firstrun.didSeeAboutWelcome':                      true,
		'datareporting.policy.dataSubmissionEnabled':                 false,
		'datareporting.policy.firstRunURL':                           '',
		'datareporting.healthreport.uploadEnabled':                   false,
		'toolkit.telemetry.enabled':                                  false,
		'toolkit.telemetry.unified':                                  false,
		'toolkit.telemetry.reportingpolicy.firstRun':                 false,
		'toolkit.telemetry.server':                                   'http://127.0.0.1:1/',
		'app.update.disabledForTesting':                              true,
		'app.update.auto':                                            false,
		'app.update.checkInstallTime':                                false,
		'app.normandy.enabled':                                       false,
		'app.shield.optoutstudies.enabled':                           false,
		'extensions.update.enabled':                                  false,
		'extensions.update.autoUpdateDefault':                        false,
		'extensions.getAddons.cache.enabled':                         false,
		'extensions.systemAddon.update.enabled':                      false,
		'extensions.blocklist.enabled':                               false,
		'extensions.webcompat-reporter.enabled':                      false,
		'extensions.webextensions.uuids':                             JSON.stringify({ [EXT_ID]: EXT_UUID }),
		'browser.safebrowsing.malware.enabled':                       false,
		'browser.safebrowsing.phishing.enabled':                      false,
		'browser.safebrowsing.downloads.enabled':                     false,
		'browser.safebrowsing.blockedURIs.enabled':                   false,
		'browser.safebrowsing.provider.mozilla.updateURL':            '',
		'network.captive-portal-service.enabled':                     false,
		'network.connectivity-service.enabled':                       false,
		'browser.newtabpage.enabled':                                 false,
		'browser.newtab.preload':                                     false,
		'browser.newtabpage.activity-stream.feeds.system.topstories': false,
		'browser.newtabpage.activity-stream.default.sites':           '',
		'browser.topsites.contile.enabled':                            false,
		'services.settings.server':                                   'http://127.0.0.1:1/',
		'browser.region.network.url':                                 '',
		'browser.search.update':                                      false,
		'geo.provider.network.url':                                   '',
		'network.dns.disablePrefetch':                                true,
		'network.prefetch-next':                                      false,
		'network.http.speculative-parallel-limit':                    0,
		'network.trr.mode':                                           5,
		'dom.security.https_first':                                   false,
		'dom.security.https_first_schemeless':                        false,
		'dom.security.https_only_mode':                               false,
		'browser.tabs.warnOnClose':                                   false,
		'browser.warnOnQuit':                                         false,
		'browser.sessionstore.resume_from_crash':                     false,
		'browser.tabs.closeWindowWithLastTab':                        false,
		'browser.uitour.enabled':                                     false,
		'browser.discovery.enabled':                                  false,
		'browser.ml.enable':                                          false,
		'browser.pagethumbnails.capturing_disabled':                  true,
		'signon.rememberSignons':                                     false,
		'toolkit.startup.max_resumed_crashes':                        -1,
		// Install/update notifications of the extension must not become Windows toasts on the user's desktop
		'alerts.useSystemBackend':                                    false,
		'alerts.useSystemBackend.windows.notificationserver.enabled': false,
		// Everything goes to our own proxy: http gets a stub page, https is refused, nothing leaves the machine
		'network.proxy.type':                                         1,
		'network.proxy.http':                                         '127.0.0.1',
		'network.proxy.http_port':                                    proxyPort,
		'network.proxy.ssl':                                          '127.0.0.1',
		'network.proxy.ssl_port':                                     proxyPort,
		'network.proxy.share_proxy_settings':                         false,
		'network.proxy.allow_hijacking_localhost':                    false,
		'network.proxy.no_proxies_on':                                '',
		'devtools.console.stdout.content':                            false,
	};
	if(idleTimeout != null)
		p['extensions.background.idle.timeout'] = Number(idleTimeout);
	return p;
}

/** Writes user.js into a new profile directory */
export function createProfile(dir, prefs) {
	fs.mkdirSync(dir, { recursive: true });
	let lines = Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
	fs.writeFileSync(path.join(dir, 'user.js'), lines.join('\n') + '\n');
}

/**
 * Starts Firefox on a fresh profile with WebDriver BiDi. Returns { proc, pid, wsUrl, kill() }.
 * Only the spawned PID (and its child tree) is ever killed.
 */
export async function launchFirefox({ profileDir, headless = true, width = 1280, height = 1000, logFile }) {
	let port = await freePort();
	let args = ['-no-remote', '-new-instance', '-wait-for-browser', '-profile', profileDir,
		'--remote-debugging-port', String(port), '--remote-allow-system-access'];
	if(headless)
		args.push('-headless');
	else
		args.push('-width', String(width), '-height', String(height));
	let env = { ...process.env, MOZ_CRASHREPORTER_DISABLE: '1', MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1', MOZ_HEADLESS_WIDTH: String(width), MOZ_HEADLESS_HEIGHT: String(height) };
	delete env.MOZ_NO_REMOTE;
	let proc = spawn(FIREFOX, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	let out  = logFile ? fs.createWriteStream(logFile) : null;
	let wsUrl = await new Promise((resolve, reject) => {
		let buf = '';
		let timer = setTimeout(() => reject(new Error('Firefox did not announce WebDriver BiDi within 60s:\n' + buf.slice(-2000))), 60000);
		let onData = d => {
			let s = d.toString();
			out?.write(s);
			buf += s;
			let m = buf.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
			if(m) {
				clearTimeout(timer);
				resolve(m[1].replace(/\/$/, ''));
			}
		};
		proc.stdout.on('data', onData);
		proc.stderr.on('data', onData);
		proc.on('exit', code => {
			clearTimeout(timer);
			reject(new Error(`Firefox exited early (code ${code}):\n${buf.slice(-2000)}`));
		});
	});
	let exited = new Promise(r => proc.on('exit', r));
	return {
		proc, pid: proc.pid, wsUrl, port,
		alive: () => proc.exitCode === null && proc.signalCode === null,
		waitExit: ms => Promise.race([exited.then(() => true), sleep(ms).then(() => false)]),
		async kill() {
			if(proc.exitCode === null && proc.signalCode === null) {
				try {
					killTree(proc.pid);
				} catch(e) { /* already gone */ }
				await Promise.race([exited, sleep(5000)]);
			}
			out?.end();
		},
	};
}

/**
 * Lists processes that are ours: firefox.exe/node.exe whose command line mentions dir, plus any process whose PID or
 * parent PID is in pids (the launcher and browser processes we spawned).
 */
export function leftoverProcs(dir, pids = []) {
	if(process.platform !== 'win32') {
		let out = execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8', maxBuffer: 64 << 20 });
		let ids = new Set(pids.filter(Boolean).map(String));
		return out.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/)).map(([pid, ppid, name, ...args]) => [pid, ppid, name, args.join(' ')].join('\t'))
			.filter(l => {
				let [pid, ppid, name] = l.split('\t');
				if(pid == process.pid)
					return false;
				if(/^(firefox|firefox-bin|Web Content|WebExtensions|Isolated|RDD|Socket|Utility|crashhelper|forkserver|chrome|msedge)/i.test(name) && (ids.has(pid) || ids.has(ppid)))
					return true;
				return /^(firefox|firefox-bin|node|chrome|msedge|chrome_crashpad|msedge_crashpad)/.test(name) && l.includes(dir);
			});
	}
	try {
		let ps = `Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)\`t$($_.ParentProcessId)\`t$($_.Name)\`t$($_.CommandLine)" }`;
		let out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 << 20 });
		let needle = dir.toLowerCase().replace(/\//g, '\\');
		let ids = new Set(pids.filter(Boolean).map(String));
		// Only Firefox's own executables (and node for the work dir): a PID number can be reused by an unrelated process
		let ffNames = /^(firefox|crashhelper|minidump-analyzer|pingsender|plugin-container|msedge|chrome|identity_helper|chrome_crashpad_handler)\.exe$/i;
		return out.split(/\r?\n/).filter(l => {
			let [pid, ppid, name] = l.split('\t');
			if(!name || pid == process.pid)
				return false;
			if(ffNames.test(name) && (ids.has(pid) || ids.has(ppid)))
				return true;
			return /^(firefox|node|msedge|chrome|chrome_crashpad_handler)\.exe$/i.test(name) && l.toLowerCase().includes(needle);
		});
	} catch(e) {
		return [`(could not list processes: ${e.message})`];
	}
}

/**
 * Waits until no process of ours is left (PIDs, their children, command lines mentioning dir); after graceMs it
 * force-kills the stragglers (only those: they are our own Firefox processes). Returns what is still listed.
 */
export async function reapProcs(dir, pids, { graceMs = 8000, timeoutMs = 45000 } = {}) {
	let t0 = Date.now(), left;
	for(;;) {
		left = leftoverProcs(dir, pids);
		if(process.env.E2E_DEBUG && left.length)
			log(`  reap +${Date.now() - t0} ms: ${left.map(x => x.split('	').slice(0, 3).join(' ') + ' ' + (x.match(/--type=[a-z-]+/)?.[0] || '')).join(', ')}`);
		if(!left.length || Date.now() - t0 > timeoutMs)
			return left;
		if(Date.now() - t0 > graceMs) {
			let pids = left.map(x => x.split('\t')[0]).filter(p => /^\d+$/.test(p));
			if(pids.length) {
				try {
					killTree(pids);
				} catch(e) { /* some gone, or still terminating */ }
			}
		}
		await sleep(1000);
	}
}

/** rm -rf with retries (Firefox may hold files for a moment after exit) */
export async function removeDir(dir) {
	for(let i = 0; i < 10; i++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return true;
		} catch(e) {
			await sleep(300);
		}
	}
	return false;
}

/** Reads a build's manifest.json (id, version, manifest_version, options page) */
export function readManifest(buildDir) {
	let text = fs.readFileSync(path.join(buildDir, 'manifest.json'), 'utf8');
	let m;
	try {
		m = JSON.parse(text);
	} catch(e) {
		m = JSON.parse(text.replace(/^\s*\/\/.*$/mg, ''));
	}
	return {
		raw:         m,
		text,
		id:          m.browser_specific_settings?.gecko?.id || m.applications?.gecko?.id || EXT_ID,
		version:     m.version,
		mv:          m.manifest_version,
		optionsPage: m.options_ui?.page || m.options_page || 'src/html/options.html',
		background:  m.background,
	};
}

/** Copies a build dir and sets its manifest version, for a real ADDON_UPGRADE over another build */
export function copyBuildWithVersion(src, dst, version) {
	fs.rmSync(dst, { recursive: true, force: true });
	fs.cpSync(src, dst, { recursive: true });
	let file = path.join(dst, 'manifest.json');
	let text = fs.readFileSync(file, 'utf8');
	let patched = text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
	if(patched === text)
		throw new Error(`Could not find "version" in ${file}`);
	fs.writeFileSync(file, patched);
	if(readManifest(dst).version !== version)
		throw new Error(`Patching the version in ${file} failed`);
	return dst;
}

/** 3.1.16 -> 3.1.17 */
export function bumpVersion(v) {
	let parts = String(v).split('.');
	parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
	return parts.join('.');
}

export function compareVersions(a, b) {
	let pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
	for(let i = 0; i < Math.max(pa.length, pb.length); i++) {
		let d = (pa[i] || 0) - (pb[i] || 0);
		if(d)
			return Math.sign(d);
	}
	return 0;
}

/** Minimal WebDriver BiDi client over Node's built-in WebSocket */
export class Bidi {
	constructor(ws) {
		this.ws       = ws;
		this.nextId   = 1;
		this.pending  = new Map();
		this.handlers = new Set();
		ws.addEventListener('message', ev => this.onMessage(ev.data));
		ws.addEventListener('close', () => {
			for(let [, p] of this.pending)
				p.reject(new Error('BiDi connection closed'));
			this.pending.clear();
		});
	}

	static async connect(url) {
		let ws = new WebSocket(url);
		await new Promise((resolve, reject) => {
			ws.addEventListener('open', resolve, { once: true });
			ws.addEventListener('error', e => reject(new Error(`WebSocket error connecting to ${url}: ${e.message || e.type}`)), { once: true });
		});
		return new Bidi(ws);
	}

	onMessage(data) {
		let msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString());
		if(msg.id != null && this.pending.has(msg.id)) {
			let p = this.pending.get(msg.id);
			this.pending.delete(msg.id);
			if(msg.type === 'error')
				p.reject(Object.assign(new Error(`${p.method}: ${msg.error}: ${msg.message}`), { bidi: msg }));
			else
				p.resolve(msg.result);
			return;
		}
		if(msg.type === 'event')
			for(let h of [...this.handlers])
				h(msg);
	}

	send(method, params = {}, timeout = 60000) {
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
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	onEvent(fn) {
		this.handlers.add(fn);
		return () => this.handlers.delete(fn);
	}

	close() {
		try {
			this.ws.close();
		} catch(e) { /* ignore */ }
	}
}

/** Turns a BiDi RemoteValue into plain JS (enough for our JSON-ish results) */
export function fromRemote(v) {
	if(!v)
		return v;
	switch(v.type) {
		case 'undefined': return undefined;
		case 'null':      return null;
		case 'string': case 'boolean': return v.value;
		case 'number':    return typeof v.value === 'string' ? Number(v.value) : v.value;
		case 'bigint':    return BigInt(v.value);
		case 'array':     return (v.value || []).map(fromRemote);
		case 'object':    return Object.fromEntries((v.value || []).map(([k, val]) => [typeof k === 'string' ? k : fromRemote(k), fromRemote(val)]));
		default:          return { type: v.type };
	}
}
