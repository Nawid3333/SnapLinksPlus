// Color comparison sheet: for each combination, a lasso on a light and a dark page (real extension rendering), then one sheet.
// Usage: node compare.mjs <buildDir> <demoDir> <outPng>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';

const [build, demoDir, out] = process.argv.slice(2);
const Combos = [
	{ id: 'old',   title: 'Today\'s defaults',               box: '#00c800', items: '#00ff00', note: 'box 2.3:1 on white, items 1.4:1 on white' },
	{ id: 'yours', title: 'Your pick: 200 green box + red',  box: '#00c800', items: '#ff0000', note: 'box 2.3:1 white / 7.4:1 dark; red 4.0 / 4.2' },
	{ id: 'green', title: 'Option A: mid green box + red',   box: '#009900', items: '#ff0000', note: 'box 3.8:1 white / 4.4:1 dark' },
	{ id: 'blue',  title: 'Option B: blue box + red',        box: '#0078d4', items: '#ff0000', note: 'box 4.5:1 white / 3.7:1 dark; colorblind-safe next to red' },
];
const Pages = [['light', 'links.html'], ['dark', 'links-dark.html']];
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-cmp-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const tiles = path.join(demoDir, 'tiles');
fs.mkdirSync(tiles, { recursive: true });

const server = await startFixtureServer(demoDir);
let s;
try {
	s = await Session.start({ runDir, name: 'cmp', server });
	await s.install(build);
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	for(let c of Combos) {
		await s.setPrefs({ SelectionRectColor: c.box, HighlightColor: c.items });
		for(let [kind, page] of Pages) {
			await s.bidi.send('browsingContext.navigate', { context, url: server.base + page, wait: 'complete' });
			await sleep(400);
			await s.drag(context, { from: { x: 70, y: 120 }, to: { x: 520, y: 420 }, up: false, settleMs: 400 });
			let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport', clip: { type: 'box', x: 40, y: 30, width: 560, height: 410 } });
			fs.writeFileSync(path.join(tiles, `${c.id}-${kind}.png`), Buffer.from(data, 'base64'));
			await s.bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
			await s.bidi.send('input.releaseActions', { context });
			console.log('tile', c.id, kind);
		}
	}
	let sw = (hex) => `<span class="sw" style="background:${hex}"></span><code>${hex}</code>`;
	fs.writeFileSync(path.join(demoDir, 'compare.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
		body { font: 14px system-ui, sans-serif; margin: 16px; background: #f3f3f3; color: #111; width: 1180px; }
		h1 { font-size: 18px; margin: 0 0 10px; }
		.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
		.cap { grid-column: 1 / 3; font-weight: 600; }
		.cap small { font-weight: normal; color: #555; margin-left: 8px; }
		img { width: 100%; border: 1px solid #bbb; display: block; }
		.sw { display: inline-block; width: 14px; height: 14px; border: 1px solid #666; vertical-align: -2px; margin: 0 4px 0 10px; }
	</style></head><body><h1>Snap Links: selection colors (lasso = dashed box, selected links = solid outlines)</h1>
	${Combos.map(c => `<div class="row"><div class="cap">${c.title} — box ${sw(c.box)} items ${sw(c.items)}<small>${c.note}</small></div>
		<img src="tiles/${c.id}-light.png"><img src="tiles/${c.id}-dark.png"></div>`).join('')}</body></html>`);
	await s.bidi.send('browsingContext.navigate', { context, url: server.base + 'compare.html', wait: 'complete' });
	await sleep(600);
	let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'document' });
	fs.writeFileSync(out, Buffer.from(data, 'base64'));
	console.log('saved', out);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
