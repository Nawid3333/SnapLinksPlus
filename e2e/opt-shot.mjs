// Screenshot of the options page tab.  Usage: node opt-shot.mjs <buildDir> <outPng> [prefsJson]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer, sleep } from './lib.mjs';
const [build, out, prefsJson = '{}'] = process.argv.slice(2);
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-opt-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const server = await startFixtureServer(Here);
let s;
try {
	s = await Session.start({ runDir, name: 'opt', server });
	await s.install(build);
	let prefs = JSON.parse(prefsJson);
	if(Object.keys(prefs).length)
		await s.setPrefs(prefs);
	let ctx = await s.openOptionsTab();
	await sleep(800);
	let { data } = await s.bidi.send('browsingContext.captureScreenshot', { context: ctx, origin: 'viewport' });
	fs.writeFileSync(out, Buffer.from(data, 'base64'));
	console.log('saved', out);
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
