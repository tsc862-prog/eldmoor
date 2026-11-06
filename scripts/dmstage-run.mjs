// The DM on stage, measured (#1017): a long headless Fellowship with a mock DM on the real runners, and counts per game day of DM turns,
// lines heard, scene frames and lever refusals. Run it on a checkout of main and on a branch to compare: --root DIR plays that checkout.
// No paid model and nothing beyond 127.0.0.1. The members are mock-crypt:1b (scripts/mock-ollama.mjs). The DM is mock-stage:1b, this
// file's model, which plays what the owner's Haiku DM did on 2026-11-06: it reads, names the places of its campaign notes ("the Cold
// Forge", "Greymane"), drops a refused name unless the refusal says how to make it real, and calls narrate only when its turn prompt
// tells it to. So a run proves the plumbing (who is asked, what is refused, what is heard), not a model's taste. Voices answer after
// VOICE_MS, what Haiku took live.
//   node scripts/dmstage-run.mjs [--root DIR] [--minutes 12] [--speed 8] [--port 18810] [--out DIR] [--label after] [--level 8]
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
const HERE = dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2), opt = (n, d) => {const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d};
const ROOT = resolve(opt('root', join(HERE, '..'))), MINUTES = Number(opt('minutes', 12)), SPEED = Number(opt('speed', 8)), PORT = Number(opt('port', 18810)), LABEL = opt('label', 'run'), LEVEL = opt('level', '8');
const OUT = resolve(opt('out', join(HERE, '..', 'logs', 'dmstage', LABEL))), WORLD = 'dmstage', VOICE_MS = 2500, sleep = ms => new Promise(r => setTimeout(r, ms));
export const STAGE_MODEL = 'mock-stage:1b';
const {startMockOllama, MOCK_MODELS} = await import('./mock-ollama.mjs');
const mock = await startMockOllama(); mkdirSync(OUT, {recursive: true}); writeFileSync(join(OUT, 'run.log'), '');

// ---- the mock DM ----
const counts = {turns: 0, turnCalls: 0, voices: {}}; let turnNo = 0, said = 0;
const WORDS = ['rain', 'stone', 'lantern', 'crow', 'ember', 'moss', 'iron', 'tide', 'bell', 'thorn', 'ash', 'reed', 'salt', 'owl', 'frost', 'hearth'];
const line = () => {said++; return ['The', ...Array.from({length: 7}, (_, i) => WORDS[(said * 5 + i * (said % 7 + 1)) % WORDS.length])].join(' ') + ' ' + said + '.'};
const fillOf = s => !s || typeof s !== 'object' ? null : Array.isArray(s.enum) ? s.enum[s.enum.length > 1 && s.enum[0] === '' ? 1 : 0] : s.type === 'object' ? Object.fromEntries(Object.keys(s.properties || {}).map(k => [k, fillOf(s.properties[k])])) : s.type === 'array' ? [] : s.type === 'number' || s.type === 'integer' ? 0 : line();
const voiceOf = f => {const p = f.properties || {}; return p.dc ? 'ruling' : p.offer ? 'talk' : p.pick ? 'table' : 'narrator or companion'};
const planAttempts = (t, town) => [[['post_hook', {town, tpl: 'investigate', place: 'the Cold Forge', reason: 'the forge went cold the week the river shifted'}], ['post_hook', {town, tpl: 'investigate', reason: 'the forge went cold'}]],
  [['seed_rumour', {town, text: 'A grey-backed wolf leaves one lamb untouched at each fold.', about: 'Greymane', reason: 'a hint at the grudge'}], ['seed_rumour', {town, text: 'A grey-backed wolf leaves one lamb untouched at each fold.', reason: 'a hint at the grudge'}]],
  [['seed_rumour', {town, text: 'They speak of the post at the old ford.', about: 'the Drowned Post', reason: 'a lead'}], ['seed_rumour', {town, text: 'They speak of the post at the old ford.', reason: 'a lead'}]]][t % 3];
let hall = null;
function dmTurn(body) {const msgs = body.messages, lastTurn = msgs.map((m, i) => m.role === 'user' && !/^(Result of|That was not)/.test(m.content) ? i : -1).filter(i => i >= 0).pop(), after = msgs.slice(lastTurn + 1), prompt = String(msgs[lastTurn].content), k = after.filter(m => m.role === 'assistant').length;
  if (k === 0) {counts.turns++; turnNo++} counts.turnCalls++;
  const results = after.filter(m => m.role === 'tool').map(m => String(m.content)), last = results[results.length - 1] || '', call = (name, a = {}) => ({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: a}}]});
  const [first, plain] = planAttempts(turnNo, hall), speak = /End this turn with something they can hear: narrate \{near: "([^"]+)"/.exec(prompt), done = {role: 'assistant', content: 'Prepared the next stretch.'};
  const name = /mark_place \{kind, near, name: \\?"([^"\\]+)/.exec(last);
  if (/^Session zero|paused for a short prep/.test(prompt)) return k === 0 ? call('dm_status') : k === 1 ? call('prep_done', {summary: 'prepared'}) : done;
  if (k === 0) return call('dm_status'); if (k === 1) return call('hear');
  if (k === 2) return call(...first);
  if (k === 3) {if (name) return call('mark_place', {kind: 'ruin', near: 'fellowship', name: name[1], reason: 'it was only in my notes: now it stands'}); if (/"ok":false/.test(last)) return call(...plain)}
  if (k === 4 && name === null && /"lever":"mark_place"/.test(last)) return call(...first);
  const spoke = after.some(m => (m.tool_calls || []).some(c => c.function.name === 'narrate'));
  return speak && !spoke && k < 8 ? call('narrate', {near: speak[1], text: line()}) : done}
const proxy = (req, res, b) => {const r = http.request(mock.url + req.url, {method: req.method, headers: {'content-type': 'application/json'}}, p => {res.writeHead(p.statusCode, {'content-type': 'application/json'}); p.pipe(res)}); r.on('error', () => res.destroy()); r.end(b)};
const front = http.createServer((req, res) => {const send = o => {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(o))}, done = {done: true, done_reason: 'stop', prompt_eval_count: 900, eval_count: 40};
  if (req.url === '/api/tags') return send({models: [...MOCK_MODELS, STAGE_MODEL].map(name => ({name, model: name}))});
  if (req.url === '/api/ps') return send({models: []});
  let b = ''; req.on('data', c => b += c); req.on('end', () => {let body = null; try {body = JSON.parse(b)} catch {}
    if (!body || body.model !== STAGE_MODEL) return proxy(req, res, b);
    if (body.format && body.format.properties && body.format.properties.ready) return send({...done, model: body.model, message: {role: 'assistant', content: '{"ready": true}'}});
    if (body.format) {const v = voiceOf(body.format); counts.voices[v] = (counts.voices[v] || 0) + 1; return void setTimeout(() => send({...done, model: body.model, message: {role: 'assistant', content: JSON.stringify(fillOf(body.format))}}), VOICE_MS)}
    send({...done, model: body.model, message: body.tools ? dmTurn(body) : {role: 'assistant', content: 'Prepared.'}})})});
await new Promise(r => front.listen(0, '127.0.0.1', r)); const LLM = `http://127.0.0.1:${front.address().port}`;

// ---- the run ----
const env = {...process.env, ELDMOOR_WORLD: 'vale', AGENT_LOGS: join(OUT, 'agents'), BEHAVIOR_DIR: join(OUT, 'behavior'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OLLAMA_URL: LLM, AGENT_MIN_GAP: '2', AGENT_HEARTBEAT: '60', AGENT_REFLECT: '0'};
const kids = [], log = [], kid = (name, a) => {const p = spawn(process.execPath, a, {cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe']}), k = {name, p, done: new Promise(r => p.on('exit', c => r(c)))};
  const keep = d => {for (const l of String(d).split(/\r?\n/)) if (l.trim()) {log.push(`[${name}] ${l}`); appendFileSync(join(OUT, 'run.log'), `[${name}] ${l}\n`)}};
  p.stdout.on('data', keep); p.stderr.on('data', keep); kids.push(k); return k};
const world = kid('world', ['scripts/play-headless.mjs', '--fellowship', '--dm', '--agents', '0', '--told-crypt', '--fellowship-level', LEVEL, '--port', String(PORT), '--quiet', '--speed', String(SPEED), '--world', join(OUT, 'world.json'), '--log-world', WORLD, '--no-relay', '--no-mirror']);
for (let i = 0; i < 400 && !log.some(l => /headless world at /.test(l)); i++) await sleep(200);
if (!log.some(l => /headless world at /.test(l))) throw new Error('the world did not start\n' + log.slice(-20).join('\n'));
const base = `http://127.0.0.1:${PORT}`;
{const r = await (await fetch(base + '/play/dm', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({tool: 'fellowship_view', args: {}, role: 'dm'})})).json(); hall = r.fellowship && r.fellowship.hall || 'fellowship'}
const rflags = ['--url', base, '--provider', 'ollama', '--ollama-url', LLM];
kid('fellowship', ['scripts/fellowship.mjs', ...rflags, '--model', 'mock-crypt:1b', '--min-gap', '2', '--heartbeat', '60']);
kid('dm', ['scripts/dm-agent.mjs', ...rflags, '--model', STAGE_MODEL, '--min-gap', '2']);
console.log(`[dmstage ${LABEL}] ${base} from ${ROOT}: ${MINUTES} real minutes at ${SPEED}x, hall ${hall}`);
await sleep(MINUTES * 60000);
for (const k of kids.slice().reverse()) {try {k.p.stdin.write('stop\n')} catch {}}
await sleep(4000); for (const k of kids.slice().reverse()) if (k.p.exitCode === null) k.p.kill();
await Promise.race([Promise.all(kids.map(k => k.done)), sleep(8000)]); front.close(); mock.close();

// ---- the counts ----
const read = f => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const dir = join(OUT, 'behavior', WORLD), W = read(join(dir, 'world.jsonl')), T = read(join(dir, 'turns.jsonl')).filter(t => t.seat === 'dm');
const days = new Map(), row = d => days.get(d) || days.set(d, {hours: 0, turns: 0, lines: 0, scenes: 0, tableAgent: 0, tableScripted: 0, voiceLines: 0, pulled: 0, refused: 0}).get(d), dn = m => Math.floor(Math.max(0, (m || 1) - 1) / 1440) + 1;
for (const w of W) {const r = row(dn(w.gameMin)), K = (w.dmShare && w.dmShare.kinds) || {}; r.hours++; r.lines += (w.chat && w.chat.dm) || 0; r.scenes += (w.table && w.table.opened) || 0; r.tableAgent += (K.table && K.table.agent) || 0; r.tableScripted += (K.table && K.table.scripted) || 0; r.pulled += (w.levers && w.levers.pulled) || 0; r.refused += (w.levers && w.levers.refused) || 0; r.voiceLines += (w.dmStage && w.dmStage.moments) || 0}
for (const t of T) row(dn(t.gameMin)).turns++;
const R = [...days.entries()].sort((x, y) => x[0] - y[0]), sum = k => R.reduce((n, [, v]) => n + v[k], 0), hours = sum('hours') || 1, perDay = k => (sum(k) / hours * 24).toFixed(1);
const dmLog = readFileSync(join(OUT, 'run.log'), 'utf8').split('\n').filter(l => l.startsWith('[dm]'));
const out = {label: LABEL, root: ROOT, gameHours: sum('hours'), gameDays: +(sum('hours') / 24).toFixed(1), dmTurns: sum('turns'), dmModelCalls: counts.turnCalls, voiceCalls: counts.voices, linesHeard: sum('lines'), voiceLines: sum('voiceLines'), scenes: sum('scenes'), framesByDm: dmLog.filter(l => /\[table\] call \d+ (frame|voice): "/.test(l)).length, tableCallsByDm: sum('tableAgent'), tableFilled: sum('tableScripted'), pulled: sum('pulled'), refused: sum('refused'),
  perGameDay: {dmTurns: perDay('turns'), linesHeard: perDay('lines'), scenes: perDay('scenes'), framesByDm: (dmLog.filter(l => /\[table\] call \d+ (frame|voice): "/.test(l)).length / hours * 24).toFixed(1), tableFilled: perDay('tableScripted'), refused: perDay('refused'), pulled: perDay('pulled')}, days: R.map(([d, v]) => ({day: d, ...v}))};
writeFileSync(join(OUT, 'counts.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out)); process.exit(0);
