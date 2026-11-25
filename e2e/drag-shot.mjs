// Screenshot of a lasso in progress: drag (not released), capture the viewport, cancel with Escape.
// Usage: node drag-shot.mjs <buildDir> <siteRoot> <page> <outPng> [prefsJson] [fromX,fromY] [toX,toY]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';

const [build, root, page, out, prefsJson = '{}', fromArg = '70,120', toArg = '520,420'] = process.argv.slice(2);
const pt = s => { let [x, y] = s.split(',').map(Number); return { x, y }; };
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-shot-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });

const server = await startFixtureServer(root);
let s;
try {
	s = await Session.start({ runDir, name: 'shot', server });
	await s.install(build);
	let prefs = JSON.parse(prefsJson);
	if(Object.keys(prefs).length)
		console.log('prefs', JSON.stringify(await s.setPrefs(prefs)));
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.navigate', { context, url: server.base + page, wait: 'complete' });
	await sleep(500);
	await s.drag(context, { from: pt(fromArg), to: pt(toArg), up: false, settleMs: 400 });
	let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport' });
	fs.writeFileSync(out, Buffer.from(data, 'base64'));
	let label = await s.content(context, () => {
		let l = document.querySelector('.SL_SelectionLabel');
		return l && { text: l.textContent, rect: l.getBoundingClientRect().toJSON(), display: getComputedStyle(l).display };
	});
	console.log('label', JSON.stringify(label));
	await s.bidi.send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
	await s.bidi.send('input.releaseActions', { context });
	console.log('saved', out);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
