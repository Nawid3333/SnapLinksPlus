// Drafts of the selection box look (line width, style, halo, fill): a real lasso with the box CSS overridden, on light/dark/busy pages.
// Usage: node box-options.mjs <buildDir> <demoDir> <outPng>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';

const [build, demoDir, out] = process.argv.slice(2);
const G = '#009900';
const Drafts = [
	{ id: 'today', title: 'Today: 2px dashed #00c800, items 1px #00ff00', box: '#00c800', items: '#00ff00', css: '' },
	{ id: 'color', title: 'A. Color only: 2px dashed #009900, items red', css: '' },
	{ id: 'thick', title: 'B. Thicker: 3px dashed #009900', css: `outline: 3px dashed ${G} !important;` },
	{ id: 'halo', title: 'C. 2px dashed #009900 with a thin white halo (gaps and edges white): readable on any background', css: `outline: 2px dashed ${G} !important; box-shadow: 0 0 0 3px rgba(255,255,255,.85), inset 0 0 0 1px rgba(255,255,255,.85) !important;` },
	{ id: 'halo3', title: 'D. 3px dashed #009900 with the white halo', css: `outline: 3px dashed ${G} !important; box-shadow: 0 0 0 4px rgba(255,255,255,.85), inset 0 0 0 1px rgba(255,255,255,.85) !important;` },
	{ id: 'tint', title: 'E. Solid 2px #009900 and a light green fill (like the selection in a file manager)', css: `outline: 2px solid ${G} !important; background-color: rgba(0,153,0,.08) !important;` },
];
const Pages = [['light', 'links.html'], ['dark', 'links-dark.html'], ['busy', 'links-busy.html']];
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-box-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const tiles = path.join(demoDir, 'tiles');
fs.mkdirSync(tiles, { recursive: true });

const server = await startFixtureServer(demoDir);
let s;
try {
	s = await Session.start({ runDir, name: 'box', server });
	await s.install(build);
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	for(let d of Drafts) {
		await s.setPrefs({ SelectionRectColor: d.box || G, HighlightColor: d.items || '#ff0000' });
		for(let [kind, page] of Pages) {
			await s.bidi.send('browsingContext.navigate', { context, url: server.base + page, wait: 'complete' });
			await sleep(400);
			await s.drag(context, { from: { x: 70, y: 120 }, to: { x: 520, y: 420 }, up: false, settleMs: 400 });
			if(d.css)
				await s.content(context, (css) => {
					let st = document.createElement('style');
					st.textContent = `.SnapLinksContainer > .SL_SelectionRect { ${css} }`;
					document.head.appendChild(st);
				}, d.css);
			await sleep(150);
			let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport', clip: { type: 'box', x: 40, y: 85, width: 540, height: 355 } });
			fs.writeFileSync(path.join(tiles, `box-${d.id}-${kind}.png`), Buffer.from(data, 'base64'));
			await s.bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
			await s.bidi.send('input.releaseActions', { context });
		}
		console.log('draft', d.id);
	}
	await s.bidi.send('browsingContext.setViewport', { context, viewport: { width: 1700, height: 900 }, devicePixelRatio: 1 });
	fs.writeFileSync(path.join(demoDir, 'box.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
		body { font: 14px system-ui, sans-serif; margin: 16px; background: #f3f3f3; color: #111; width: 1660px; }
		h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #444; }
		.row { display: grid; grid-template-columns: 540px 540px 540px; gap: 10px; margin-bottom: 16px; }
		.cap { grid-column: 1 / 4; font-weight: 600; }
		img { width: 540px; border: 1px solid #bbb; display: block; }
	</style></head><body><h1>Snap Links: selection box drafts (actual size)</h1>
	<p>Light, dark and a deliberately busy page. Selected links outlined in red #ff0000 (1px) except in the first row. Counter label unchanged.</p>
	${Drafts.map(d => `<div class="row"><div class="cap">${d.title}</div>${Pages.map(([k]) => `<img src="tiles/box-${d.id}-${k}.png">`).join('')}</div>`).join('')}</body></html>`);
	await s.bidi.send('browsingContext.navigate', { context, url: server.base + 'box.html', wait: 'complete' });
	await sleep(600);
	let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'document' });
	fs.writeFileSync(out, Buffer.from(data, 'base64'));
	console.log('saved', out);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
