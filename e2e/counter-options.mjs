// Mockups of counter label styles: a real lasso, the label's look overridden by injected CSS, 2x close-ups on a light and a dark page.
// Usage: node counter-options.mjs <buildDir> <demoDir> <outPng>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';

const [build, demoDir, out] = process.argv.slice(2);
const Base = 'font: 600 12px/16px system-ui, -apple-system, "Segoe UI", sans-serif !important; letter-spacing: .2px !important; white-space: nowrap !important;';
const Options = [
	{ id: 'now', title: 'Today: pale yellow box, Verdana', css: '' },
	{ id: 'dark', title: '1. Dark pill (like a modern tooltip)', css: `${Base} background: rgba(32,33,36,.92) !important; color: #fff !important; border: 1px solid rgba(255,255,255,.18) !important; border-radius: 999px !important; padding: 2px 9px !important; box-shadow: 0 2px 8px rgba(0,0,0,.30) !important;` },
	{ id: 'accent', title: '2. Pill in the selection color (follows the color setting)', css: `${Base} background: #009900 !important; color: #fff !important; border: none !important; border-radius: 999px !important; padding: 3px 10px !important; box-shadow: 0 2px 8px rgba(0,0,0,.30) !important;` },
	{ id: 'card', title: '3. Light card (white, soft shadow)', css: `${Base} background: #fff !important; color: #1f1f1f !important; border: 1px solid rgba(0,0,0,.12) !important; border-radius: 6px !important; padding: 3px 8px !important; box-shadow: 0 4px 14px rgba(0,0,0,.22) !important;` },
	{ id: 'glass', title: '4. Frosted glass (blurs what is behind it)', css: `${Base} background: rgba(255,255,255,.62) !important; -webkit-backdrop-filter: blur(8px) saturate(1.4); backdrop-filter: blur(8px) saturate(1.4) !important; color: #111 !important; border: 1px solid rgba(255,255,255,.6) !important; border-radius: 8px !important; padding: 3px 9px !important; box-shadow: 0 4px 16px rgba(0,0,0,.25) !important;` },
	{ id: 'bold', title: '5. Dark pill, count in big bold type', css: `${Base} background: rgba(32,33,36,.92) !important; color: rgba(255,255,255,.85) !important; border: 1px solid rgba(255,255,255,.18) !important; border-radius: 999px !important; padding: 1px 10px 2px !important; box-shadow: 0 2px 8px rgba(0,0,0,.30) !important; font-weight: 500 !important;`, bold: true },
];
const Pages = [['light', 'links.html'], ['dark', 'links-dark.html']];
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-ctr-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const tiles = path.join(demoDir, 'tiles');
fs.mkdirSync(tiles, { recursive: true });

const server = await startFixtureServer(demoDir);
let s;
try {
	s = await Session.start({ runDir, name: 'ctr', server });
	await s.install(build);
	await s.setPrefs({ SelectionRectColor: '#009900', HighlightColor: '#ff0000' });
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.setViewport', { context, viewport: { width: 1280, height: 900 }, devicePixelRatio: 2 });
	for(let o of Options) {
		for(let [kind, page] of Pages) {
			await s.bidi.send('browsingContext.navigate', { context, url: server.base + page, wait: 'complete' });
			await sleep(400);
			await s.drag(context, { from: { x: 70, y: 120 }, to: { x: 520, y: 420 }, up: false, settleMs: 400 });
			await s.content(context, ({ css, bold }) => {
				let st = document.createElement('style');
				st.textContent = `.SnapLinksContainer .SL_SelectionRect > .SL_SelectionLabel { ${css} }`;
				document.head.appendChild(st);
				let l = document.querySelector('.SL_SelectionLabel');
				if(bold) {
					let [n, ...rest] = l.textContent.split(' ');
					l.textContent = '';
					let b = document.createElement('b');
					b.textContent = n;
					b.style.cssText = 'font: 700 15px/18px system-ui, "Segoe UI", sans-serif; color: #fff; margin-right: 4px; vertical-align: -1px;';
					l.append(b, rest.join(' '));
				}
			}, { css: o.css, bold: !!o.bold });
			await sleep(150);
			let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport', clip: { type: 'box', x: 330, y: 300, width: 250, height: 135 } });
			fs.writeFileSync(path.join(tiles, `ctr-${o.id}-${kind}.png`), Buffer.from(data, 'base64'));
			await s.bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
			await s.bidi.send('input.releaseActions', { context });
		}
		console.log('option', o.id);
	}
	await s.bidi.send('browsingContext.setViewport', { context, viewport: { width: 1100, height: 900 }, devicePixelRatio: 1 });
	fs.writeFileSync(path.join(demoDir, 'counter.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
		body { font: 14px system-ui, sans-serif; margin: 16px; background: #f3f3f3; color: #111; width: 1040px; }
		h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #444; }
		.row { display: grid; grid-template-columns: 500px 500px; gap: 12px; margin-bottom: 16px; }
		.cap { grid-column: 1 / 3; font-weight: 600; }
		img { width: 500px; border: 1px solid #bbb; display: block; }
	</style></head><body><h1>Snap Links: counter label options (close-up, 2x)</h1>
	<p>The mouse pointer is at the bottom-right corner of the dashed box (screenshots do not show the pointer itself). Box #009900, items #ff0000.</p>
	${Options.map(o => `<div class="row"><div class="cap">${o.title}</div><img src="tiles/ctr-${o.id}-light.png"><img src="tiles/ctr-${o.id}-dark.png"></div>`).join('')}</body></html>`);
	await s.bidi.send('browsingContext.navigate', { context, url: server.base + 'counter.html', wait: 'complete' });
	await sleep(600);
	let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'document' });
	fs.writeFileSync(out, Buffer.from(data, 'base64'));
	console.log('saved', out);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
