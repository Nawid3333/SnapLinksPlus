// Before/after sheet for the PR: "before" tiles are earlier renders of the old look, "after" is rendered now with the default prefs.
// Usage: node before-after.mjs <buildDir> <demoDir> <outPng> <optionsPng>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';

const [build, demoDir, out, optOut] = process.argv.slice(2);
const Pages = [['light', 'links.html'], ['dark', 'links-dark.html'], ['busy', 'links-busy.html']];
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-ba-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const tiles = path.join(demoDir, 'tiles');

const server = await startFixtureServer(demoDir);
let s;
try {
	s = await Session.start({ runDir, name: 'ba', server });
	await s.install(build);
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	for(let [kind, page] of Pages) {
		await s.bidi.send('browsingContext.navigate', { context, url: server.base + page, wait: 'complete' });
		await sleep(400);
		await s.drag(context, { from: { x: 70, y: 120 }, to: { x: 520, y: 420 }, up: false, settleMs: 400 });
		let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport', clip: { type: 'box', x: 40, y: 85, width: 540, height: 355 } });
		fs.writeFileSync(path.join(tiles, `after-${kind}.png`), Buffer.from(data, 'base64'));
		await s.bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
		await s.bidi.send('input.releaseActions', { context });
	}
	await s.bidi.send('browsingContext.setViewport', { context, viewport: { width: 1700, height: 900 }, devicePixelRatio: 1 });
	fs.writeFileSync(path.join(demoDir, 'before-after.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
		body { font: 14px system-ui, sans-serif; margin: 16px; background: #f3f3f3; color: #111; width: 1660px; }
		.row { display: grid; grid-template-columns: 540px 540px 540px; gap: 10px; margin-bottom: 14px; }
		.cap { grid-column: 1 / 4; font-weight: 600; }
		img { width: 540px; border: 1px solid #bbb; display: block; }
	</style></head><body>
	<div class="row"><div class="cap">Before: 2px dashed #00c800, selected links #00ff00, yellow counter</div>${Pages.map(([k]) => `<img src="tiles/box-today-${k}.png">`).join('')}</div>
	<div class="row"><div class="cap">After (new defaults): 3px dashed #009900, selected links #ff0000, dark counter</div>${Pages.map(([k]) => `<img src="tiles/after-${k}.png">`).join('')}</div>
	</body></html>`);
	await s.bidi.send('browsingContext.navigate', { context, url: server.base + 'before-after.html', wait: 'complete' });
	await sleep(600);
	let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'document' });
	fs.writeFileSync(out, Buffer.from(data, 'base64'));
	let opt = await s.openOptionsTab();
	
	await sleep(800);
	({ data } = await s.bidi.send('browsingContext.captureScreenshot', { context: opt, origin: 'viewport', clip: { type: 'box', x: 0, y: 0, width: 1100, height: 270 } }));
	fs.writeFileSync(optOut, Buffer.from(data, 'base64'));
	console.log('saved', out, optOut);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
