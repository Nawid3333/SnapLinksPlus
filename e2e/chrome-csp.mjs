// Drags a lasso (not released) on each page in Chromium, records the lasso's state and a screenshot, then cancels with Escape.
// Usage: node chrome-csp.mjs <buildDir> <siteRoot> <outDir> <page...>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CdpSession } from './chromium.mjs';
import { startFixtureServer, sleep } from './lib.mjs';

const [build, root, outDir, ...pages] = process.argv.slice(2);
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-csp-'));
fs.mkdirSync(outDir, { recursive: true });

const PICK = () => {
	let a = [...document.querySelectorAll('a[href]')].map(a => a.getBoundingClientRect()).filter(b => b.width > 20 && b.top > 20 && b.left > 20)[0];
	return a && [Math.round(a.left - 15), Math.round(a.top - 8), Math.round(a.right + 250), Math.round(a.top + 220)];
};
const STATE = () => {
	let c = document.querySelector('.SnapLinksContainer');
	if(!c)
		return { container: false };
	let r = c.querySelector('.SL_SelectionRect'), l = r.firstElementChild, svg = c.querySelector('svg'), rs = getComputedStyle(r);
	let box = e => { let b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
	let a = document.createElement('div'), b = document.createElement('div');
	a.setAttribute('style', 'position: absolute'); b.style.cssText = 'position: absolute';
	document.body.append(a, b);
	let page = { setAttribute: getComputedStyle(a).position, cssText: getComputedStyle(b).position };
	a.remove(); b.remove();
	return {
		container: true, styles: document.querySelectorAll('style').length, z: getComputedStyle(c).zIndex,
		rect: [rs.position, rs.outlineStyle, rs.outlineWidth], label: [getComputedStyle(l).position, box(l), l.textContent],
		svg: svg && getComputedStyle(svg).position, actOn: c.querySelectorAll('rect.ActOn').length,
		fill: c.querySelector('rect.ActOn') && getComputedStyle(c.querySelector('rect.ActOn')).fill, page,
	};
};

const server = await startFixtureServer(root);
let s;
try {
	s = await CdpSession.start({ runDir, name: 'csp', server, build, kind: 'chromium' });
	let results = { browser: s.browserVersion };
	for(let page of pages) {
		await s.prepare(server.base + page);
		await sleep(400);
		let [x0, y0, x1, y1] = await s.content(s.ctx, PICK);
		await s.drag(s.ctx, { from: { x: x0, y: y0 }, to: { x: x1, y: y1 }, up: false, settleMs: 500 });
		results[page] = await s.content(s.ctx, STATE);
		let { data } = await s.cdp.send('Page.captureScreenshot', {}, s.ctx);
		fs.writeFileSync(path.join(outDir, `${process.env.NAME || 'x'}-${page}.png`), Buffer.from(data, 'base64'));
		await s.release(s.ctx, { escape: true });
		await sleep(200);
	}
	console.log(JSON.stringify(results));
} finally {
	await s?.close();
	await server.close();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
