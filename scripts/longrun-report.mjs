// What a scripts/longrun.mjs run did (#926): reads <out>/behavior/<world>/*.jsonl, <out>/run.log and <out>/samples.jsonl and prints one summary.
//   node scripts/longrun-report.mjs [DIR]   (default logs/longrun)
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
const dir = process.argv[2] || 'logs/longrun', bdir = join(dir, 'behavior'), world = existsSync(bdir) ? readdirSync(bdir)[0] : null;
const jl = f => { const p = join(bdir, world || '', f); return existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []; };
const W = jl('world.jsonl'), T = jl('turns.jsonl'), A = jl('anomalies.jsonl'), S = existsSync(join(dir, 'samples.jsonl')) ? readFileSync(join(dir, 'samples.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : [];
const log = existsSync(join(dir, 'run.log')) ? readFileSync(join(dir, 'run.log'), 'utf8').split(/\r?\n/) : [];
const sum = (xs, f) => xs.reduce((t, x) => t + (Number(f(x)) || 0), 0), count = (xs, f) => { const o = {}; for (const x of xs) { const k = f(x); if (k) o[k] = (o[k] || 0) + 1; } return o; };
console.log(`digests ${W.length} (game hours), game clock ${W.length ? W[W.length - 1].clock : '-'}, agent turns ${T.length}`);
console.log('table:', JSON.stringify(['opened', 'resolved', 'agentTurns', 'reflexTurns', 'missed'].reduce((o, k) => (o[k] = sum(W, w => w.table && w.table[k]), o), {})), '| votes', JSON.stringify({agent: sum(W, w => w.votes && w.votes.agent), reflex: sum(W, w => w.votes && w.votes.reflex)}));
const dl = {}; for (const w of W) for (const [k, n] of Object.entries(w.dmlog || {})) dl[k] = (dl[k] || 0) + (typeof n === 'number' ? n : 0); console.log('dm log kinds:', JSON.stringify(dl));
const deaths = W.flatMap(w => w.deaths || []); console.log(`deaths ${deaths.length}:`, JSON.stringify(count(deaths, d => String(d.cause || d.why || '?').replace(/ in .*|^slain by .*|^felled by .*/, m => m.startsWith('slain') ? 'mob' : m.startsWith('felled') ? 'Crypt' : m).slice(0, 30))));
console.log('anomalies:', JSON.stringify(count(A, a => a.kind)), '| turn flags:', JSON.stringify(count(T.flatMap(t => (t.flags || []).map(f => ({f}))), x => x.f)));
const calls = n => log.filter(l => l.includes('> ' + n + '(')).length, res = n => { const o = {}; for (let i = 0; i < log.length; i++) if (log[i].includes('> ' + n + '(')) { const r = (log[i + 1] || '').match(/< (\{.{0,160})/); const k = r ? (r[1].includes('"ok":true') ? 'ok' : (r[1].match(/"error":"([^"]{0,70})/) || [, 'error'])[1]) : 'no result'; o[k] = (o[k] || 0) + 1; } return o; };
for (const n of ['propose', 'vote', 'go_crypt', 'join_raid', 'lead_to']) console.log(n, calls(n), JSON.stringify(res(n)));
const mb = S.map(s => s.worldMB).filter(x => x > 0); console.log(`world memory MB: first ${mb[0]}, max ${Math.max(...mb)}, last ${mb[mb.length - 1]} over ${S.length} samples (${S.length ? S[S.length - 1].t : 0} min)`);
console.log('processes that exited:', JSON.stringify([...new Set(S.flatMap(s => s.dead))]));
console.log('crashes/exceptions in log:', log.filter(l => /Error:|TypeError|ReferenceError|unhandled|ECONN|EADDR|at .*\.mjs:\d+/.test(l)).slice(0, 6).map(l => l.slice(0, 160)));
