// Records a lasso on a live page frame by frame (headless Firefox, real right-button input) and what its release does.
// Writes numbered PNG frames and frames.txt (an ffmpeg concat list with durations) into outDir.
// Usage: node demo-video.mjs <buildDir> <outDir> <title> <url> <fromX,fromY> <toX,toY> [steps]
import fs from 'node:fs';
import path from 'node:path';
import { Session } from './session.mjs';
import { sleep, startFixtureServer } from './lib.mjs';

let [build, outDir, title, url, fromArg, toArg, stepsArg = '22', scrollSel = ''] = process.argv.slice(2);
const pt = s => { let [x, y] = s.split(',').map(Number); return { x, y }; };
const from = pt(fromArg), to = pt(toArg), steps = Number(stepsArg);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const runDir = path.join(outDir, '..', `run-${path.basename(outDir)}-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });

const list = [];
let n = 0, s, ctx;

/** Caption bar over the page header and an arrow cursor; both ignore the mouse, so they change no hit test */
async function overlay(caption, sub, cursor) {
	await s.content(ctx, ({ caption, sub, cursor }) => {
		let bar = document.getElementById('__demoCaption');
		if(!bar) {
			bar = document.documentElement.appendChild(document.createElement('div'));
			bar.id = '__demoCaption';
			Object.assign(bar.style, { position: 'fixed', left: '0', right: '0', top: '0', height: '56px', zIndex: '2147483647', pointerEvents: 'none',
				background: '#111', color: '#fff', font: '600 22px/1.2 Segoe UI, Arial, sans-serif', display: 'flex', flexDirection: 'column',
				justifyContent: 'center', padding: '0 24px', borderBottom: '3px solid #555' });
			let c = document.documentElement.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
			c.id = '__demoCursor';
			c.setAttribute('width', '22');
			c.setAttribute('height', '30');
			let arrow = c.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));	// No innerHTML: YouTube enforces Trusted Types
			arrow.setAttribute('d', 'M1 1 L1 23 L7 17 L11 27 L15 25 L11 15 L19 15 Z');
			arrow.setAttribute('fill', '#fff');
			arrow.setAttribute('stroke', '#000');
			arrow.setAttribute('stroke-width', '1.5');
			Object.assign(c.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', left: '-50px', top: '-50px' });
		}
		bar.replaceChildren();
		bar.appendChild(document.createElement('div')).textContent = caption;
		if(sub) {
			let d = bar.appendChild(document.createElement('div'));
			d.textContent = sub;
			Object.assign(d.style, { font: '400 16px/1.3 Segoe UI, Arial, sans-serif', color: '#ddd' });
		}
		let c = document.getElementById('__demoCursor');
		if(cursor) {
			c.style.left = cursor.x + 'px';
			c.style.top = cursor.y + 'px';
		}
	}, { caption, sub, cursor });
}

async function frame(seconds) {
	let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context: ctx, origin: 'viewport' });
	let file = `f${String(n++).padStart(4, '0')}.png`;
	fs.writeFileSync(path.join(outDir, file), Buffer.from(data, 'base64'));
	list.push(`file '${file}'`, `duration ${seconds}`);
}

const pointer = actions => s.bidi.send('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }] }, 30000);
const label = () => s.content(ctx, () => document.querySelector('.SL_SelectionLabel')?.textContent || '');

let fixtures;
try {
	if(url.startsWith('fixture:')) {
		fixtures = await startFixtureServer('V:/SnapLinksPlus/test');
		url = url.replace(/^fixture:/, fixtures.base);
	}
	s = await Session.start({ runDir, name: 'demo', server: { port: null, base: '' } });
	await s.install(build);
	({ context: ctx } = await s.bidi.send('browsingContext.create', { type: 'tab' }));
	await s.bidi.send('browsingContext.activate', { context: ctx });
	await s.bidi.send('browsingContext.navigate', { context: ctx, url, wait: 'complete' }, 60000);
	await sleep(1500);
	if(/consent\./.test(await s.content(ctx, () => location.href))) {
		await s.content(ctx, () => [...document.querySelectorAll('button')].find(b => /reject all/i.test(b.textContent))?.click());
		await sleep(4000);
	}
	await sleep(2500);
	// The cookie dialog inside the page (watch pages), not the consent.youtube.com redirect
	if(await s.content(ctx, () => { let b = [...document.querySelectorAll('button')].find(b => /^reject all$/i.test(b.textContent.trim())); b?.click(); return !!b; }))
		await sleep(2500);
	await sleep(1500);
	if(scrollSel)	// The element's top just below the caption bar
		await s.content(ctx, sel => window.scrollTo(0, document.querySelector(sel).getBoundingClientRect().top + scrollY - 70), scrollSel);
	await sleep(500);
	let tabsBefore = (await s.tabs()).flatMap(w => w.tabs).length;
	let urlBefore = await s.content(ctx, () => location.href);
	// Count what the release clicks: Snap Links calls element.click(), which the page sees as a click event
	await s.content(ctx, () => {
		window.__demoClicks = [];
		document.addEventListener('click', e => {
			let t = e.target.closest?.('a, button, [role="button"]') || e.target;
			window.__demoClicks.push((t.getAttribute?.('aria-label') || t.textContent || t.tagName).replace(/\s+/g, ' ').trim().slice(0, 24));
		}, true);
	});

	await overlay(title, `Right mouse button held, dragging a lasso over ${process.env.DEMO_WHAT || 'the videos'}`, from);
	await frame(1.6);
	await pointer([{ type: 'pointerMove', x: from.x, y: from.y, origin: 'viewport' }, { type: 'pointerDown', button: 2 }]);
	for(let i = 1; i <= steps; i++) {
		let p = { x: Math.round(from.x + (to.x - from.x) * i / steps), y: Math.round(from.y + (to.y - from.y) * i / steps) };
		await pointer([{ type: 'pointerMove', x: p.x, y: p.y, origin: 'viewport', duration: 30 }, { type: 'pause', duration: 70 }]);
		await overlay(title, `Right mouse button held, dragging a lasso over ${process.env.DEMO_WHAT || 'the videos'}`, p);
		await frame(0.09);
	}
	await sleep(600);
	let held = await label();
	await overlay(title, `Selected: ${held}  (green boxes = what the release will act on)`, to);
	await frame(3.2);
	fs.copyFileSync(path.join(outDir, `f${String(n - 1).padStart(4, '0')}.png`), path.join(outDir, 'held.png'));

	await s.release(ctx);
	await sleep(3000);
	let clicks = await s.content(ctx, () => window.__demoClicks || []).catch(() => []);
	let tabsAfter = (await s.tabs()).flatMap(w => w.tabs).length;
	let urlAfter = await s.content(ctx, () => location.href).catch(() => '?');
	let result = [];
	if(tabsAfter > tabsBefore)
		result.push(`${tabsAfter - tabsBefore} new tabs opened`);
	if(clicks.length)
		result.push(`clicked ${clicks.length}: ${[...new Set(clicks)].join(', ')}`);
	if(urlAfter != urlBefore)
		result.push('and the page itself navigated away');
	if(!result.length)
		result.push('nothing happened');
	await overlay(title, `Released: ${result.join('; ')}`, to);
	await frame(4.0);
	list.push(`file 'f${String(n - 1).padStart(4, '0')}.png'`);	// The concat demuxer drops the last duration without this
	fs.writeFileSync(path.join(outDir, 'frames.txt'), list.join('\n') + '\n');
	fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ held, clicks, tabsBefore, tabsAfter, urlBefore, urlAfter }, null, 1));
	console.log(JSON.stringify({ held, clicks: clicks.length, newTabs: tabsAfter - tabsBefore, navigated: urlAfter != urlBefore }));
} finally {
	await s?.close();
	await fixtures?.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
