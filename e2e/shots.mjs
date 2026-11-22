// Screenshots of the options page as users see it: embedded in about:addons (where MV2's browser_style applied), and
// standalone.  Usage: node shots.mjs <buildDir> <name>   (writes <name>-addons.png, <name>-page.png here)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';

const [build, name] = process.argv.slice(2);
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-${name}-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });

const server = await startFixtureServer('V:\\SnapLinksPlus\\test');
let s;
try {
	s = await Session.start({ runDir, name, server });
	await s.install(build);

	const shot = async (context, file) => {
		let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context, origin: 'viewport' });
		fs.writeFileSync(path.join(Here, file), Buffer.from(data, 'base64'));
	};

	// about:addons > Snap Links > Options tab
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.navigate', { context, url: 'about:addons', wait: 'complete' });
	await s.bidi.send('script.evaluate', {
		expression: `gViewController.loadView('addons://detail/' + encodeURIComponent('snaplinks@snaplinks.mozdev.org') + '/preferences')`,
		target: { context }, awaitPromise: true,
	}).catch(e => console.log('loadView failed:', e.message));
	await sleep(3000);
	await shot(context, `${name}-addons.png`);

	// The page on its own
	let page = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.navigate', { context: page.context, url: s.optionsUrl(), wait: 'complete' });
	await sleep(1000);
	await shot(page.context, `${name}-page.png`);
	console.log('done', name);
} finally {
	await s?.close();
	server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
