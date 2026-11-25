// Extracts the JSON array from agent outputs and prints a compact table.  Usage: node parse.mjs <out files...>
import fs from 'node:fs';
const all = [];
for(const f of process.argv.slice(2)) {
	const t = fs.readFileSync(f, 'utf8');
	const start = t.search(/\[\s*\{/), end = t.lastIndexOf(']');
	try {
		const arr = JSON.parse(t.slice(start, end + 1));
		all.push(...arr);
		console.error(`${f.split('/').pop()}: ${arr.length} entries`);
	} catch(e) { console.error(`${f}: PARSE FAILED ${e.message}`); }
}
fs.writeFileSync(process.env.OUT || 'parsed.json', JSON.stringify(all, null, 1));
for(const x of all) {
	if(x.recommendation)
		console.log(`PR #${x.number} ${x.recommendation} (${x.confidence}) ${x.title}\n   ${x.summary}\n   findings: ${(x.findings || []).join(' | ').slice(0, 900)}`);
	else
		console.log(`#${x.number} [${x.category}] close=${x.close_recommended} (${x.confidence}) ${x.author}: ${x.title}\n   ${x.reason.slice(0, 400)}${x.fix_candidate ? `\n   FIX ${x.fix_candidate.effort}/${x.fix_candidate.merge_likelihood}: ${x.fix_candidate.approach.slice(0, 250)}` : ''}`);
}
