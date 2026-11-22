// A real add-on update, as AMO users get it: build A installed permanently, then build B installed over it permanently
// (not the temporary installs of about:debugging, which Firefox grants host access to on its own).  Needs a Firefox that
// allows unsigned permanent installs (Developer Edition / Nightly with xpinstall.signatures.required = false).
//
// Usage: E2E_FIREFOX=<firefox> node upgrade-permanent.mjs <xpiA> <dirA> <xpiB> <dirB> <fixturesDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, readManifest, sleep, log } from './lib.mjs';

const [xpiA, dirA, xpiB, dirB, fixtures] = process.argv.slice(2);
const Here   = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, 'runs', `permanent-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`); };

const server = await startFixtureServer(fixtures);
let s;
try {
	s = await Session.start({ runDir, name: 'permanent', server });
	log(`browser ${s.browserVersion}`);
	await s.chrome(() => Services.prefs.setBoolPref('xpinstall.signatures.required', false));

	/** Installs the xpi permanently and waits for its onInstalled handling to record its version */
	const installPermanent = async (xpi, dir) => {
		let r = await s.bidi.send('webExtension.install', { extensionData: { type: 'archivePath', path: xpi }, 'moz:permanent': true });
		s.extId    = r.extension;
		s.manifest = readManifest(dir);
		s.uuid     = (await s.extInfo()).uuid;
		for(let i = 0; i < 60; i++) {
			if((await s.storage()).local.LastInstalledVersion === s.manifest.version)
				break;
			await sleep(500);
		}
		return s.extInfo();
	};

	/** Drags over the 6 links of a freshly loaded test_links.html, returns the URLs of the tabs that opened */
	const dragOpens = async () => {
		let ctx = await s.prepare(server.base + 'test_links.html');
		let rects = await s.content(ctx, async () => {
			let ul = [...document.querySelectorAll('a')].find(a => a.textContent === 'cooker').closest('ul');
			ul.scrollIntoView({ block: 'center' });
			await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
			return [...ul.querySelectorAll('a')].map(a => { let b = a.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
		});
		await s.drag(ctx, { from: { x: Math.min(...rects.map(r => r.l)) - 20, y: rects[0].t + 2 }, to: { x: Math.max(...rects.map(r => r.r)) + 20, y: rects.at(-1).b - 2 } });
		let snap = await s.waitNewTabs(6, 8000);
		let opened = snap.flatMap(w => w.tabs.filter(t => !t.old)).map(t => t.url);
		await s.closeNewTabs();
		return opened;
	};

	const canAccess = () => s.chrome(([id, url]) => WebExtensionPolicy.getByID(id).canAccessURI(Services.io.newURI(url)), [s.extId, server.base + 'test_links.html']);

	// --- A: the current release (MV2), installed permanently
	let infoA = await installPermanent(xpiA, dirA);
	check(`A ${infoA.version} (MV${infoA.mv}) installed permanently`, infoA.temporary === false, { temporary: infoA.temporary });
	check('A: may run on http pages', await canAccess());
	check('A: a drag opens the 6 links', (await dragOpens()).length === 6);
	await s.setPrefs({ OpenTabs: 'OpenTabsToRight', CopyFormat: 'Markdown', ShowNumberOfLinks: false });

	// --- B: the update (MV3)
	let infoB = await installPermanent(xpiB, dirB);
	check(`B ${infoB.version} (MV${infoB.mv}) installed over A permanently`, infoB.temporary === false && infoB.version === s.manifest.version, { temporary: infoB.temporary, version: infoB.version });
	let stored = await s.storage();
	check('B: the preferences set in A are kept', stored.sync.OpenTabs === 'OpenTabsToRight' && stored.sync.CopyFormat === 'Markdown' && stored.sync.ShowNumberOfLinks === false, stored.sync);
	let granted = await canAccess();
	log(`  B: allowedOrigins ${JSON.stringify(infoB.allowedOrigins)}, stored ${JSON.stringify(infoB.storedOptional)}`);
	check('B: may run on http pages right after the update (host access granted by the update)', granted);
	await sleep(1500);
	let tabs = (await s.tabs()).flatMap(w => w.tabs).map(t => t.url);
	let optionsOpened = tabs.some(u => u.startsWith('about:addons') || u.includes('/src/html/options.html'));
	check('B: options page opened after the update exactly when host access is missing', optionsOpened === !granted, { optionsOpened, tabs });
	let opened = await dragOpens();
	check(`B: a drag on a page loaded after the update opens ${granted ? '6 links' : 'nothing (no host access)'}`, opened.length === (granted ? 6 : 0), opened.length);

	if(!granted) {
		// The user clicks "Allow on all websites" on the options page and accepts Firefox's prompt
		let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
		await s.bidi.send('browsingContext.navigate', { context, url: s.optionsUrl(), wait: 'complete' });
		await sleep(800);
		let note = await s.content(context, () => {
			let b = document.getElementById('GrantSitesPermission').getBoundingClientRect();
			return { hidden: document.getElementById('SitesPermission').hidden, x: b.left + b.width / 2, y: b.top + b.height / 2 };
		});
		check('options page: the "Allow on all websites" note shows', note.hidden === false);
		await s.bidi.send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
			{ type: 'pointerMove', x: Math.round(note.x), y: Math.round(note.y), origin: 'viewport' },
			{ type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
		] }] });
		let prompt = false;
		for(let i = 0; i < 20 && !prompt; i++) {
			await sleep(300);
			prompt = await s.chrome(() => {
				let n = PopupNotifications.getNotification('addon-webext-permissions');
				if(!n)
					return false;
				n.mainAction.callback();
				PopupNotifications.remove(n);
				return true;
			});
		}
		check('clicking Allow shows Firefox\'s permission prompt (accepted here)', prompt);
		await sleep(1000);
		check('after Allow: may run on http pages', await canAccess());
		check('after Allow: the note is hidden', await s.content(context, () => document.getElementById('SitesPermission').hidden));
		opened = await dragOpens();
		check('after Allow: a drag on a newly loaded page opens the 6 links', opened.length === 6, opened.length);
	}
} catch(e) {
	check('ERROR ' + e.message, false);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
	let failed = results.filter(r => !r.ok).length;
	log(`${results.length - failed}/${results.length} checks passed`);
	fs.writeFileSync(path.join(Here, 'upgrade-permanent-result.json'), JSON.stringify(results, null, 1));
	process.exitCode = failed ? 1 : 0;
}
