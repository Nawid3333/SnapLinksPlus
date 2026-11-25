import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { startFixtureServer } from './lib.mjs';
const Here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(Here, `run-pref-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const server = await startFixtureServer(Here);
let s;
try {
	s = await Session.start({ runDir, name: 'pref', server });
	console.log(JSON.stringify(await s.chrome(() => {
		let names = Services.prefs.getChildList('webextensions.storage.sync');
		return { version: Services.appinfo.version, prefs: names.map(n => [n, Services.prefs.getPrefType(n), Services.prefs.prefHasDefaultValue(n)]) };
	})));
} finally {
	await s?.close();
	await server.close?.();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
