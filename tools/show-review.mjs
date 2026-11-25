import fs from 'node:fs';
const t = fs.readFileSync(process.argv[2], 'utf8');
const s = t.search(/\{\s*"verdict"/), e = t.lastIndexOf('}');
let j;
try { j = JSON.parse(t.slice(s, e + 1)); } catch(err) { console.log('PARSE FAILED:', err.message); console.log(t.slice(-3000)); process.exit(); }
console.log('VERDICT:', j.verdict);
for(const f of j.findings) console.log(`[${f.severity}] ${f.file}:${f.line}\n  P: ${f.problem}\n  E: ${String(f.evidence).slice(0, 600)}\n  FIX: ${f.fix}\n`);
console.log('checked ok:', j.checked_ok.length, 'items');
for(const c of j.checked_ok) console.log('  -', c.slice(0, 220));
