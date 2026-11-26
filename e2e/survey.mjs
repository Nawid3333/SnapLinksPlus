// Runs the same held lasso on several live pages with one Snap Links build; records the label, the highlighted
// elements and a screenshot per page.
// Usage: node survey.mjs <buildDir> <outDir> <sites.json> [only-name,...]
import fs from 'node:fs';
import path from 'node:path';
import { Session } from './session.mjs';
import { sleep, startFixtureServer } from './lib.mjs';

const [build, outDir, sitesFile, only] = process.argv.slice(2);
let sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
if(only)
	sites = sites.filter(s => only.split(',').includes(s.name));
fs.mkdirSync(outDir, { recursive: true });
const runDir = path.join(outDir, `run-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });

const ESC = { type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '' }, { type: 'keyUp', value: '' }] };
const results = [];
let s, fixtures;
try {
	if(sites.some(site => site.url.startsWith('fixture:'))) {
		fixtures = await startFixtureServer('V:/SnapLinksPlus/test');
		for(let site of sites)
			site.url = site.url.replace(/^fixture:/, fixtures.base);
	}
	s = await Session.start({ runDir, name: 'survey', server: { port: null, base: '' } });
	await s.install(build);
	for(let site of sites) {
		let r = { name: site.name, url: site.url };
		let context;
		try {
			({ context } = await s.bidi.send('browsingContext.create', { type: 'tab' }));
			await s.bidi.send('browsingContext.activate', { context });
			await s.bidi.send('browsingContext.navigate', { context, url: site.url, wait: 'complete' }, 60000);
			await sleep(1500);
			if(/consent\./.test(await s.content(context, () => location.href))) {
				await s.content(context, () => [...document.querySelectorAll('button')].find(b => /reject all/i.test(b.textContent))?.click());
				await sleep(4000);
			}
			await sleep(site.waitMs ?? 3000);
			// A cookie dialog inside the page (SoundCloud, YouTube watch pages) covers what the lasso should see
			if(await s.content(context, () => { let b = [...document.querySelectorAll('button')].find(b => /^reject all$/i.test(b.textContent.trim())); b?.click(); return !!b; }))
				await sleep(2500);
			if(site.setup)
				await s.content(context, new Function(site.setup));
			await s.content(context, (y) => window.scrollTo(0, y), site.scrollY ?? 0);
			await sleep(1200);
			await s.drag(context, { from: { x: site.from[0], y: site.from[1] }, to: { x: site.to[0], y: site.to[1] }, up: false, settleMs: 900 });
			let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport' });
			fs.writeFileSync(path.join(outDir, `${site.name}.png`), Buffer.from(data, 'base64'));
			Object.assign(r, await s.content(context, () => {
				let label = document.querySelector('.SL_SelectionLabel')?.textContent;
				let rects = [...document.querySelectorAll('svg.SnapLinksHighlighter rect.ActOn')].filter(x => x.style.display != 'none');
				// The element under the middle of each highlight, to name what was highlighted
				let what = rects.map(x => {
					let b = x.getBoundingClientRect();
					let svg = x.ownerSVGElement;
					svg.style.visibility = 'hidden';
					let el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
					svg.style.visibility = '';
					let c = el?.closest('a, button, [role], input') || el;
					return c ? `${c.tagName}${c.getAttribute('role') ? '[' + c.getAttribute('role') + ']' : ''} "${(c.innerText || c.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30)}"` : '?';
				});
				return { label, highlights: rects.length, what };
			}));
		} catch(e) {
			r.error = e.message.split('\n')[0];
		}
		try {
			await s.bidi.send('input.performActions', { context, actions: [ESC] });
			await s.bidi.send('input.releaseActions', { context });
			await s.bidi.send('browsingContext.close', { context });
		} catch(e) { /* the tab may be gone */ }
		console.log(JSON.stringify(r));
		results.push(r);
	}
	fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1));
} finally {
	await s?.close();
	await fixtures?.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
