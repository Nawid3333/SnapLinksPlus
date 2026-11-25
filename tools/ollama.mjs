// Usage: node ollama.mjs <model> <promptFile> <outFile> [timeoutMin] [--think]
// One /api/chat call, streamed: a non-streamed answer that takes over 300 s hits fetch's headers timeout ("fetch failed").
import fs from 'node:fs';
const [model, promptFile, outFile, timeoutMin = '40', think] = process.argv.slice(2);
const prompt = fs.readFileSync(promptFile, 'utf8');
const t0 = Date.now();
let content = '', last = null;
try {
	const res = await fetch('http://127.0.0.1:11434/api/chat', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, stream: true, think: think === '--think' || undefined, messages: [{ role: 'user', content: prompt }] }),
		signal: AbortSignal.timeout(Number(timeoutMin) * 60000),
	});
	if(!res.ok) {
		const text = await res.text();
		fs.writeFileSync(outFile, `HTTP ${res.status}: ${text}`);
		console.log(`FAILED HTTP ${res.status}: ${text.slice(0, 300)}`);
		process.exit(1);
	}
	let buf = '';
	for await (const chunk of res.body) {
		buf += Buffer.from(chunk).toString('utf8');
		let lines = buf.split('\n');
		buf = lines.pop();
		for(const line of lines.filter(Boolean)) {
			last = JSON.parse(line);
			if(last.error)
				throw new Error(last.error);
			content += last.message?.content ?? '';
		}
	}
	fs.writeFileSync(outFile, content);
	console.log(`done ${model} in ${Math.round((Date.now() - t0) / 1000)}s, ${last?.prompt_eval_count} prompt / ${last?.eval_count} output tokens -> ${outFile}`);
} catch(e) {
	fs.writeFileSync(outFile, content + '\nERROR: ' + e.message);
	console.log('ERROR after', Math.round((Date.now() - t0) / 1000), 's:', e.message);
	process.exit(1);
}
