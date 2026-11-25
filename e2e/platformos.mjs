import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer } from './lib.mjs';
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-pos-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const server = await startFixtureServer(Here);
let s;
try {
	s = await Session.start({ runDir, name: 'pos', server });
	await s.install(process.argv[2]);
	console.log(JSON.stringify(await s.inOptionsPage(async () => ({
		PlatformOs: typeof chrome !== 'undefined' && chrome.runtime.PlatformOs ? chrome.runtime.PlatformOs : null,
		os: (await browser.runtime.getPlatformInfo()).os,
	}))));
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
