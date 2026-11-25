// A completed lasso, then scrolling: counts the errors Firefox logs for the extension's content scripts.
// Usage: node scroll-errors.mjs <buildDir> <demoDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';
const [build, demoDir] = process.argv.slice(2);
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-scroll-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const server = await startFixtureServer(demoDir);
let s;
const errors = () => s.chrome(() => Services.console.getMessageArray()
	.filter(m => m instanceof Ci.nsIScriptError && /moz-extension:/.test(m.sourceName) && !(m.flags & Ci.nsIScriptError.warningFlag))
	.map(m => `${m.errorMessage} (${m.sourceName.replace(/^.*\/src\//, '')}:${m.lineNumber})`));
try {
	s = await Session.start({ runDir, name: 'scroll', server });
	await s.install(build);
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.navigate', { context, url: server.base + 'links.html', wait: 'complete' });
	await sleep(500);
	await s.drag(context, { from: { x: 70, y: 120 }, to: { x: 520, y: 420 }, settleMs: 300 });
	await sleep(500);
	let before = (await errors()).length;
	await s.content(context, async () => {
		let box = document.createElement('div');
		box.style.cssText = 'height: 100px; width: 300px; overflow: auto; border: 1px solid #999;';
		box.innerHTML = '<p style="height: 1000px">a scrollable box, like a sidebar or a chat list</p>';
		document.body.appendChild(box);
		for(let y = 100; y <= 500; y += 100) {
			box.scrollTop = y;
			await new Promise(r => setTimeout(r, 100));
		}
	});
	await sleep(500);
	let after = await errors();
	console.log(`${path.basename(build)}: ${after.length - before} new extension errors while scrolling after a selection`);
	for(let e of [...new Set(after.slice(before))])
		console.log('   ', e);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
