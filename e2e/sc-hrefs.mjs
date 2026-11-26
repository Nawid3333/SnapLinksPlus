// Lists the hrefs of the first SoundCloud track rows (artist and title links)
import { Session } from './session.mjs';
import { sleep } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
const [build, url, runRoot] = process.argv.slice(2);
const runDir = path.join(runRoot, `run-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
let s;
try {
	s = await Session.start({ runDir, name: 'sc', server: { port: null, base: '' } });
	await s.install(build);
	let { context } = await s.bidi.send('browsingContext.create', { type: 'tab' });
	await s.bidi.send('browsingContext.navigate', { context, url, wait: 'complete' }, 60000);
	await sleep(6000);
	await s.content(context, () => [...document.querySelectorAll('button')].find(b => /^reject all$/i.test(b.textContent.trim()))?.click());
	await sleep(2500);
	console.log(JSON.stringify(await s.content(context, () => [...document.querySelectorAll('.soundList__item')].slice(0, 2).map(li =>
		[...li.querySelectorAll('.soundTitle__usernameTitleContainer a, .soundTitle__title')].map(a => `${a.textContent.trim()} -> ${a.getAttribute('href')}`))), null, 1));
} finally {
	await s?.close();
	fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
