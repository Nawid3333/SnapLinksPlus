// #422 in real Firefox: sync storage turned off, then the options page state and a lasso drag.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';
const [build, demoDir] = process.argv.slice(2);
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-sync-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const server = await startFixtureServer(demoDir);
let s;
try {
	s = await Session.start({ runDir, name: 'sync', server });
	await s.chrome(() => { Services.prefs.setBoolPref('webextensions.storage.sync.enabled', false); return true; });
	await s.install(build);
	let opt = await s.inOptionsPage(async () => {
		await new Promise(r => setTimeout(r, 800));
		let syncError = await browser.storage.sync.get().then(() => 'works', e => e.message);
		return { syncError, StorageAPI: Prefs.StorageAPI, SyncUnavailable: Prefs.SyncUnavailable,
			selectDisabled: document.getElementById('StorageAPI').disabled, noteShown: !document.getElementById('SyncUnavailable')?.hidden };
	});
	console.log('options page:', JSON.stringify(opt));
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.navigate', { context, url: server.base + 'links.html', wait: 'complete' });
	await sleep(500);
	await s.drag(context, { from: { x: 70, y: 120 }, to: { x: 520, y: 420 }, up: false, settleMs: 400 });
	console.log('lasso label:', JSON.stringify(await s.content(context, () => document.querySelector('.SL_SelectionLabel')?.textContent ?? null)));
	await s.bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
	await s.bidi.send('input.releaseActions', { context });
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
