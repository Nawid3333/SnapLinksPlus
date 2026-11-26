// Times the new per-element checks (innerText, querySelector) on a live page, the way one lasso tick runs them
// Usage: node bench.mjs <url> [count]
import path from 'node:path';
import fs from 'node:fs';
import { Session } from './session.mjs';
import { sleep } from './lib.mjs';

const [url, count = '400'] = process.argv.slice(2);
const runDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), `run-bench-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
let s;
try {
	s = await Session.start({ runDir, name: 'bench', server: { port: null, base: '' } });
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.navigate', { context, url, wait: 'complete' }, 60000);
	await sleep(2000);
	let r = await s.content(context, (n) => {
		let links = [...document.querySelectorAll('a[href]')].slice(0, n);
		let buttons = [...document.querySelectorAll('button, [role="button"]')].slice(0, n);
		let svg = document.documentElement.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
		let rect = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
		let times = [];
		for(let tick = 0; tick < 30; tick++) {
			rect.setAttribute('width', String(tick + 1));	// What the highlight does between ticks: layout is dirty again
			document.elementFromPoint(10, 10);					// The obscured check flushes layout in every tick anyway
			let t0 = performance.now();
			let shows = links.map(a => /[\p{L}\p{N}]/u.test(a.innerText ?? a.textContent) || a.querySelector('img, picture, video, canvas, input[type="image"]') !== null);
			let lengths = new Map(links.map(a => [a, (a.innerText ?? a.textContent).trim().length]));
			let controls = buttons.map(b => b.hasAttribute('aria-expanded') || !/[\p{L}\p{N}]/u.test(b.innerText ?? b.textContent));
			times.push(performance.now() - t0);
			if(!shows.length && !lengths.size && !controls.length)
				return null;
		}
		svg.remove();
		times.sort((a, b) => a - b);
		return { links: links.length, buttons: buttons.length, medianMs: times[15].toFixed(2), maxMs: times[29].toFixed(2) };
	}, Number(count));
	console.log(url, JSON.stringify(r));
} finally {
	await s?.close();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
