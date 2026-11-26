// Loads a live page (real network) in headless Firefox with a Snap Links build, lists the elements the lasso
// considers inside a region, and screenshots a held drag over that region.
// Usage: node live-inspect.mjs <buildDir> <url> <outDir> [fromX,fromY] [toX,toY] [scrollY]
import fs from 'node:fs';
import path from 'node:path';
import { Session } from './session.mjs';
import { sleep } from './lib.mjs';

const [build, url, outDir, fromArg = '300,300', toArg = '1200,700', scrollArg = '0'] = process.argv.slice(2);
const pt = s => { let [x, y] = s.split(',').map(Number); return { x, y }; };
fs.mkdirSync(outDir, { recursive: true });
const runDir = path.join(outDir, `run-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });

let s;
try {
	s = await Session.start({ runDir, name: 'live', server: { port: null, base: '' } });
	console.log('firefox', s.browserVersion, 'install', JSON.stringify((await s.install(build)).version));
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.activate', { context });
	await s.bidi.send('browsingContext.navigate', { context, url, wait: 'complete' });
	await sleep(1500);
	let where = await s.content(context, () => location.href);
	if(/consent\./.test(where)) {
		console.log('consent page, rejecting');
		await s.content(context, () => {
			let b = [...document.querySelectorAll('button, input[type=submit]')].find(b => /reject|ablehnen/i.test(b.textContent || b.value || b.getAttribute('aria-label') || ''));
			b?.click();
			return b?.textContent;
		});
		await sleep(4000);
	}
	await sleep(3000);
	await s.content(context, (y) => window.scrollTo(0, y), Number(scrollArg));
	await sleep(1500);
	let from = pt(fromArg), to = pt(toArg);
	let info = await s.content(context, ({ from, to }) => {
		let sel = ['A[href]:not([href=""])', 'INPUT[type="button"]', 'INPUT[type="submit"]', 'INPUT[type="reset"]', 'INPUT[type="checkbox"]', 'INPUT[type="radio"]',
			'BUTTON', '*[aria-checked]', '*[role="checkbox"]', '*[role="button"]', '*[role="link"]', '*[role="radio"]'].join(', ');
		let box = { l: Math.min(from.x, to.x), t: Math.min(from.y, to.y), r: Math.max(from.x, to.x), b: Math.max(from.y, to.y) };
		let out = [];
		for(let el of document.querySelectorAll(sel)) {
			let r = el.getBoundingClientRect();
			if(!r.width || !r.height || r.right < box.l || r.left > box.r || r.bottom < box.t || r.top > box.b)
				continue;
			let cs = getComputedStyle(el);
			let attrs = {};
			for(let a of el.attributes)
				if(/^(aria-|role$|id$|class$|title$|tabindex$|type$|target$)/.test(a.name))
					attrs[a.name] = a.value.slice(0, 80);
			out.push({
				tag: el.tagName, href: el.href || el.getAttribute('href') || undefined,
				text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
				rect: [r.left, r.top, r.width, r.height].map(Math.round),
				font: cs.fontSize + '/' + cs.fontWeight, attrs,
				hit: (() => { let e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e == el || el.contains(e) ? 'self' : (e ? e.tagName + '.' + (e.className?.baseVal ?? e.className) : null); })(),
			});
		}
		return { url: location.href, scrollY, out };
	}, { from, to });
	fs.writeFileSync(path.join(outDir, 'elements.json'), JSON.stringify(info, null, 1));
	console.log('candidates in region:', info.out.length, 'at', info.url);
	let { data: before } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport' });
	fs.writeFileSync(path.join(outDir, 'page.png'), Buffer.from(before, 'base64'));
	await s.drag(context, { from, to, up: false, settleMs: 800 });
	let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport' });
	fs.writeFileSync(path.join(outDir, 'drag.png'), Buffer.from(data, 'base64'));
	let hl = await s.content(context, () => {
		let label = document.querySelector('.SL_SelectionLabel');
		let rects = [...document.querySelectorAll('svg.SnapLinksHighlighter rect.ActOn')].filter(r => r.style.display != 'none');
		return { label: label?.textContent, highlights: rects.length };
	});
	console.log('during drag:', JSON.stringify(hl));
	await s.bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '' }, { type: 'keyUp', value: '' }] }] });
	await s.bidi.send('input.releaseActions', { context });
} finally {
	await s?.close();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
