// #602: lasso over the checkbox column of section A (native) and B (Shopee EDS), reads the counter.
// Usage: node eds-check.mjs <buildDir> <demoDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';
const [build, demoDir] = process.argv.slice(2);
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-eds-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const server = await startFixtureServer(demoDir);
let s;
try {
	s = await Session.start({ runDir, name: 'eds', server });
	await s.install(build);
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	let result = [];
	for(let section of ['A', 'B']) {
		await s.bidi.send('browsingContext.navigate', { context, url: server.base + 'eds-checkbox.html', wait: 'complete' });
		await sleep(400);
		let box = await s.content(context, (sel) => {
			let els = Array.from(document.querySelectorAll(sel));
			let rs = els.map(e => (e.closest('label') || e).getBoundingClientRect());
			return { top: Math.min(...rs.map(r => r.top)) - 6, left: Math.min(...rs.map(r => r.left)) - 6, bottom: Math.max(...rs.map(r => r.bottom)) + 6, right: Math.max(...rs.map(r => r.right)) + 6 };
		}, section === 'A' ? 'input[type=checkbox]:not(.eds-checkbox__input)' : '.eds-checkbox');
		await s.drag(context, { from: { x: box.left, y: box.top }, to: { x: box.right, y: box.bottom }, up: false, settleMs: 400 });
		let label = await s.content(context, () => document.querySelector('.SL_SelectionLabel')?.textContent ?? '(no lasso)');
		let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport', clip: { type: 'box', x: 0, y: 0, width: 700, height: 560 } });
		fs.writeFileSync(path.join(process.env.SHOTS, path.basename(build) + '-' + section + '.png'), Buffer.from(data, 'base64'));
		result.push(JSON.stringify(box));
		result.push(`${section}: ${label}`);
		await s.bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
		await s.bidi.send('input.releaseActions', { context });
	}
	console.log(`${path.basename(build)} -> ${result.join(' | ')}`);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
