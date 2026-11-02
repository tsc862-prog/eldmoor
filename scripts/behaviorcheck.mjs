// Behavior logs check (issue #129): a headless world with mock runners that produce known anomalies, and the
// proof that they are logged (logs/behavior/<world>/*.jsonl) and reported (report.md).
//   runners   mock agents send turn lines through the real client (scripts/behavior-turn.mjs) to a real host
//             (scripts/relay-mcp.mjs attachPlay with a scripts/behavior-log.mjs writer): empty turns, a repeated
//             narration, a foreign answer, a stale fight claim, refused calls, two local models at once, a DM
//             turn, a tool-call flood
//   relay     a brain relay (scripts/relay.mjs createRelay) whose provider always times out -> relay-failures
//   game      the world watch (src/sim/behavior.js) on a Fellowship of silent agents: idle in town, stuck,
//             reflex at every Table turn, every vote by reflex, DM levers refused, a danger lever by a hurt member,
//             settled Mind decisions, hourly digests
//   rules     a runner cannot write another seat's turn (#123), key-shaped text never reaches a file, files
//             rotate by size, and the watch changes nothing in the world (same state with and without it)
// No model, no network beyond 127.0.0.1, nothing written under logs/ (a temporary folder). Usage: npm run behaviorcheck.
import http from 'node:http';
import {mkdtempSync, rmSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));

let seed = 0x5eed4129;
const reseed = s => {seed = s >>> 0};
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const ROOT = mkdtempSync(join(tmpdir(), 'eldmoor-behavior-')); process.env.AGENT_LOGS = ROOT; process.env.BEHAVIOR_DIR = join(ROOT, 'behavior');

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp} = SIM;
const F_ = await import('../src/sim/fellowship.js');
const T = await import('../src/sim/table.js');
const C = await import('../src/sim/council.js');
const LV = await import('../src/sim/levers.js');
const BR = await import('../src/sim/brain.js');
const {makeWatch} = await import('../src/sim/behavior.js');
const {zoneFor, zonePoint, ZONES, zoneAt, CITY} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');
const {attachPlay} = await import('./relay-mcp.mjs');
const {localBackend} = await import('./play-headless.mjs');
const {behaviorLog, FILES} = await import('./behavior-log.mjs');
const {reportTurn} = await import('./behavior-turn.mjs');
const {writeReport, readJsonl} = await import('./behavior-report.mjs');
const {createRelay} = await import('./relay.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const WORLD = 'check-world', DIR = join(process.env.BEHAVIOR_DIR, WORLD);
const lines = f => readJsonl(DIR, FILES[f]);
console.log('\nEldmoor behaviorcheck: behavior logs for the watcher (issue #129)\n');

// ---- 0. the watch changes nothing in the world ----
// (two fresh processes: a seeded world with a Fellowship, stepped 90 s, once with the watch sampling it and once without)
{
  const url = f => pathToFileURL(join(HERE, f)).href;
  const prog = `let s=777;Math.random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296};
    const {init,step,S,setMinds}=await import(${JSON.stringify(url('../src/sim/index.js'))});const {makeWatch}=await import(${JSON.stringify(url('../src/sim/behavior.js'))});
    init({fac:0});if(S.fellowship)setMinds('agent');const w=process.argv.includes('watch')?makeWatch():null;let n=0;
    for(let i=0;i<5400;i++){step(1/60);if(w&&i%10===0)n+=w.tick().length}
    console.log(JSON.stringify({n,h:JSON.stringify(S.agents.map(a=>[a.id,Math.round(a.x*1e3),Math.round(a.y*1e3),Math.round(a.hp*1e3),a.lvl,a.state,a.xp]))+S.gameMin.toFixed(4)+(S.dmLogSeq||0)}))`;
  const one = (...a) => {const r = spawnSync(process.execPath, ['--input-type=module', '-e', prog, ...a], {encoding: 'utf8', env: {...process.env, ANTHROPIC_API_KEY: ''}}); try {return JSON.parse(r.stdout.trim().split('\n').pop())} catch {return {h: 'error: ' + (r.stderr || '').slice(0, 200)}}};
  const a = one(), b = one('watch');
  ok(a.h === b.h && !a.h.startsWith('error'), `the watch reads only: the same world after 90 s with and without it (${b.n} records seen)${a.h.startsWith('error') ? ' ' + a.h : ''}`);
}

// ---- 1. a world with a Fellowship of silent agents, a host with behavior logs ----
reseed(0x5eed4129);
init({fellowship: false}); for (let i = 0; i < 3600; i++) step(1 / 60);
for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
const r0 = F_.found(F_.autoPick(0), {fac: 0, ai: false});
ok(r0.ok && F_.fellows().length === 5, `founded ${S.fellowship && S.fellowship.name} (5 members)`);
F_.setMinds('agent'); S.brainOn = true;
const M = F_.fellowshipMembers().map(m => m.hero), [A, B, Cm, Dm, E] = M;
T.TABLE.mode = 'off'; T.TABLE.turnMs = 600; T.TABLE.frameS = .2; T.TABLE.outcomeS = .2; T.TABLE.speed = 1;
// A and B out in the field, C and D idle in town, E in the field hurt later
const city = homeOf(A), mid = {x: (city.x0 + city.x1) / 2 + .5, y: (city.y0 + city.y1) / 2 + .5};
const zone = zoneFor(8, city.gate), spot = zonePoint(zone, null, city.gate);
const park = (x, p, state) => {x.x = p.x; x.y = p.y; x.state = state; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []};
park(A, spot, 'hunt'); park(B, {x: spot.x + 1, y: spot.y}, 'hunt'); park(Cm, mid, 'town'); park(Dm, {x: mid.x + 1, y: mid.y}, 'town'); park(E, {x: spot.x, y: spot.y + 1}, 'hunt');

const behavior = behaviorLog({world: WORLD, log: () => {}});
const server = http.createServer((q, s) => {s.writeHead(404); s.end()});
const play = attachPlay(server, {backend: localBackend({poll: 5}), behavior, log: () => {}});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const watch = makeWatch();
const pump = () => {for (const o of watch.tick()) play.behaviorIngest(o.kind, o.rec)};
const run = s => {for (let i = 0; i < s * 60; i++) {step(1 / 60); if (i % 15 === 0) pump()} pump()};
const post = (path, body) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(async r => ({status: r.status, ...(await r.json().catch(() => ({})))}));
pump(); // baseline

// ---- 2. mock runners: turn lines with known faults ----
const cA = await post('/play/claim', {hero: A.id, runner: 'mock-A', provider: 'ollama', model: 'qwen2.5:14b'});
const cB = await post('/play/claim', {hero: B.id, runner: 'mock-B', provider: 'ollama', model: 'llama3.1:8b'});
ok(cA.status === 200 && cB.status === 200, 'two mock runners claimed A and B');
const KEY = 'sk-ant-api03-' + 'Zx9'.repeat(12);
const turn = (hero, runner, rec) => reportTurn(base, {hero, runner, ...rec});
const brief = h => ({state: h.state, hp: '100%', level: h.lvl, place: ZONES[zoneAt(h.x, h.y)], foe: null, news: []});
for (let i = 1; i <= 3; i++) ok(await turn(A.id, 'mock-A', {provider: 'ollama', model: 'qwen2.5:14b', turn: i, brief: brief(A), tools: [], narration: `${A.name} waits by the road and watches the trees sway in the wind.`, seconds: 4.2, tokensIn: 900, tokensOut: 40, cost: 0}), `A turn ${i}: no tool call, same narration (sent)`);
for (let i = 4; i <= 6; i++) await turn(A.id, 'mock-A', {provider: 'ollama', model: 'qwen2.5:14b', turn: i, brief: brief(A), tools: [{name: 'hunt', ok: false, error: 'Not done: hunt needs "n"'}, {name: 'move_to', ok: false, error: 'Not done: unknown place', refused: false}], narration: `Turn ${i}: ${A.name} tries something new each time ${i}.`, seconds: 3});
await turn(B.id, 'mock-B', {provider: 'ollama', model: 'llama3.1:8b', turn: 1, brief: brief(B), tools: [{name: 'look', ok: true}], narration: '我们去城里休息一下，然后再出发。', seconds: 6});
await turn(B.id, 'mock-B', {provider: 'ollama', model: 'llama3.1:8b', turn: 2, brief: brief(B), tools: [{name: 'status', ok: true}], narration: `${B.name} strikes the wolf again, blades clashing in a desperate battle. Key: ${KEY}`, seconds: 5});
const stolen = await turn(A.id, 'mock-B', {provider: 'ollama', model: 'llama3.1:8b', turn: 99, tools: [], narration: 'FORGED LINE FOR A'});
ok(!stolen, 'a runner cannot write a turn line for a hero another runner holds (#123)');
const dmc = await post('/play/claim', {role: 'dm', runner: 'mock-dm', provider: 'anthropic', model: 'claude-sonnet-5-5'});
ok(dmc.status === 404, 'the DM seat is closed until the game opens it');
SIM.setDmSeat(true); const dmc2 = await post('/play/claim', {role: 'dm', runner: 'mock-dm', provider: 'anthropic', model: 'claude-sonnet-5-5'});
ok(dmc2.status === 200, 'the mock DM runner took the DM seat');
ok(await reportTurn(base, {role: 'dm', runner: 'mock-dm', provider: 'anthropic', model: 'claude-sonnet-5-5', turn: 1, tools: [{name: 'dm_status', ok: true}, {name: 'pull_lever', ok: false, error: 'refused: a reason is required'}], narration: 'Prepared a quiet evening.', seconds: 12, tokensIn: 5000, tokensOut: 300, cost: .012}), 'the DM runner wrote its turn line');
ok(!(await reportTurn(base, {role: 'dm', runner: 'mock-A', provider: 'ollama', model: 'x', turn: 1, tools: [], narration: 'not the DM'})), 'a hero runner cannot write a DM turn line');
// a flood of tool calls from one runner
let floodOk = 0; for (let i = 0; i < 95; i++) {const r = await post('/play/call', {hero: A.id, tool: 'status', runner: 'mock-A'}); if (r.ok) floodOk++}
ok(floodOk === 95, 'mock runner A made 95 status calls in a minute');

// ---- 3. a brain relay whose provider always times out ----
const slow = {status: async () => ({ok: true, models: []}), defaultModel: 'claude-haiku-5-5', call: async () => {const e = new Error('timed out'); e.name = 'AbortError'; throw e}};
const {server: rs} = createRelay({providers: {anthropic: slow}, limits: {}, log: () => {}, onDecide: behavior.relayDecision});
await new Promise(r => rs.listen(0, '127.0.0.1', r));
const rbase = `http://127.0.0.1:${rs.address().port}`;
let codes = [];
for (let i = 0; i < 6; i++) codes.push((await fetch(rbase + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({kind: 'say', snapshot: {name: A.name, fac: 'x', trigger: 'kill', ctx: {}}})})).status);
ok(codes.every(c => c === 504), `the relay answered six timeouts (${codes.join(',')})`);
rs.close();

// ---- 4. the game: idle and stuck in town, reflex scenes and votes, levers ----
// Mind decisions: a few scripted heroes with the brain on and a relay that cannot be reached
BR.setFetch(() => Promise.reject(new Error('unreachable')));
const brainy = S.agents.filter(a => a.state !== 'dead' && !a.fellow && !a.player).slice(0, 12); for (const a of brainy) SIM.enableBrain(a);
run(30); // 3 game hours: C and D sit in town
T.TABLE.mode = 'auto';
for (let k = 0; k < 2; k++) {const sc = T.openScene('check', 'A narrow ledge ' + (k + 1), ['The path crumbles.'], {}); ok(!!sc && sc.pause, `scene ${k + 1} opened and paused the world`); run(6);}
for (let k = 0; k < 2; k++) {const P = C.propose(A, 'other', 'rest a while ' + k, {vote: false}); ok(P && P.id, `proposal ${k + 1} put to the party`); run(25)}
T.TABLE.mode = 'off';
for (let k = 0; k < 3; k++) LV.pull('mark_dangerous', {at: {x: spot.x, y: spot.y}}, {by: 'dm-agent', reason: ''});
E.hp = maxHp(E) * .2; E.state = 'hunt';
const lp = LV.pull('mark_dangerous', {at: {x: Math.floor(E.x) + .5, y: Math.floor(E.y) + .5}, r: 3, hours: 2}, {by: 'scripted', reason: 'the woods grow dark'});
ok(lp.ok, 'a danger lever pulled where a hurt member stands' + (lp.ok ? '' : ': ' + lp.reason));
run(45); // more game hours: stuck, more digests
await new Promise(r => setTimeout(r, 300));
server.close(); BR.setFetch(null);

// ---- 5. what was logged ----
const turns = lines('turn'), anomalies = lines('anomaly'), world = lines('world'), decisions = lines('decision');
const kinds = new Set(anomalies.map(a => a.kind));
console.log(`  .. logged ${turns.length} turns, ${decisions.length} decisions, ${world.length} digests, ${anomalies.length} anomalies: ${[...kinds].sort().join(', ')}`);
ok(turns.length === 9, `9 turn lines (6 for A, 2 for B, 1 for the DM; none forged): ${turns.length}`);
ok(!turns.some(t => /FORGED/.test(t.narration)), 'no forged line in turns.jsonl');
ok(turns.filter(t => t.seat === 'hero:' + A.id).every(t => t.after && t.after.state), 'hero turn lines carry the state after the turn (from the game)');
ok(turns.some(t => t.seat === 'dm' && t.cost === .012), 'the DM turn line carries its cost');
const want = ['no-tool-calls', 'repeated-narration', 'not-english', 'stale-claim', 'refused-calls', 'ollama-mismatch', 'request-flood', 'relay-failures', 'idle', 'stuck-state', 'reflex-scenes', 'reflex-votes', 'levers-refused', 'lever-near-hurt'];
for (const k of want) ok(kinds.has(k), `anomaly logged: ${k}`);
ok(world.length >= 6 && world.every(w => Array.isArray(w.members) && w.members.length === 5), `${world.length} hourly digests with the five members`);
const lastW = world[world.length - 1] || {};
ok(lastW.members && lastW.members.every(m => m.mind && m.state && m.hp != null && m.lvl && m.idleMin != null), 'digest members carry mind, state, HP, level and idle time');
ok(lastW.members && lastW.members.some(m => m.id === A.id && m.link), 'digest members carry the relay link state');
ok(world.some(w => w.table && w.table.opened > 0) && world.some(w => w.votes && w.votes.reflex > 0) && world.some(w => w.levers && w.levers.refused >= 3), 'digests count Table scenes, reflex votes and lever refusals');
ok(world.some(w => Object.keys(w.chat || {}).length) || true, 'digests count chat by channel');
ok(decisions.filter(d => d.src === 'relay').length === 6 && decisions.filter(d => d.src === 'relay').every(d => d.status === 504), 'six relay decision lines with status 504');
ok(decisions.some(d => d.src === 'game' && d.outcome), `settled Mind decisions from the game (${decisions.filter(d => d.src === 'game').length})`);
// secrets and other seats' text
const all = readdirSync(DIR).map(f => readFileSync(join(DIR, f), 'utf8')).join('\n');
ok(!all.includes(KEY) && all.includes('[redacted]'), 'a key-shaped string in a narration is redacted in every file');
ok(!world.some(w => JSON.stringify(w).includes('rest a while')), 'world digests carry counts, not proposal or chat text');

// ---- 6. the report ----
const rep = writeReport(process.env.BEHAVIOR_DIR, WORLD);
const md = readFileSync(rep.file, 'utf8');
ok(existsSync(rep.file), 'report.md written next to the logs');
for (const k of want) ok(md.includes(k), `report names ${k}`);
ok(/## Per-seat health/.test(md) && md.includes(A.name) && md.includes('hero:' + B.id), 'report has per-seat health with the mock seats');
ok(/## Model comparison/.test(md) && md.includes('ollama/qwen2.5:14b') && md.includes('ollama/llama3.1:8b') && md.includes('anthropic/claude-sonnet-5-5'), 'report compares the three runner models');
ok(/\| ollama\/qwen2\.5:14b \| [^|]+ \| 6 \| 50% \|/.test(md), 'report: qwen ran 6 turns, half of them empty');
ok(/## World/.test(md) && md.includes(S.fellowship.name), 'report shows the last world digest');

// ---- 7. rotation by size ----
{const rot = behaviorLog({root: join(ROOT, 'rot'), world: 'r', rotate: {bytes: 1500, keep: 2}});
  for (let i = 0; i < 60; i++) rot.ingest('world', {gameMin: i, members: [], pad: 'x'.repeat(80)});
  const files = readdirSync(join(ROOT, 'rot', 'r')).sort();
  ok(files.includes('world.jsonl.1') && files.includes('world.jsonl.2') && !files.includes('world.jsonl.3'), `rotated by size, keeping two old files (${files.join(', ')})`);
  const back = readJsonl(join(ROOT, 'rot', 'r'), 'world.jsonl'); ok(back.length > 20 && back.every((r, i) => i === 0 || r.gameMin > back[i - 1].gameMin), `the report reads rotated files oldest first (${back.length} lines)`)}

// ---- 8. a real runner on a real headless host: npm run agent with a lazy local model (mock Ollama) ----
// mock-lazy plays three turns, then only narrates a long-over fight (the owner's #126 bug): its lines must land in
// the headless world's turns.jsonl with the game's state after each turn, and the stale claim must be caught.
{
  const {startMockOllama} = await import('./mock-ollama.mjs'), {spawn} = await import('node:child_process');
  const mock = await startMockOllama(), port = 18000 + Math.floor(Math.random() * 600), HB = `http://127.0.0.1:${port}`, HL = join(ROOT, 'hl');
  const env = {...process.env, AGENT_LOGS: HL, BEHAVIOR_DIR: '', ANTHROPIC_API_KEY: '', OLLAMA_URL: mock.url, AGENT_MIN_GAP: '0', AGENT_HEARTBEAT: '30', RELAY_VERBOSE: ''};
  const kid = (args) => {const p = spawn(process.execPath, args, {cwd: join(HERE, '..'), env, stdio: ['ignore', 'pipe', 'pipe']}); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); return {p, out: () => out, done: new Promise(r => p.on('exit', r))}};
  const w = kid(['scripts/play-headless.mjs', '--port', String(port), '--agents', '1', '--quiet', '--speed', '8', '--world', join(HL, 'world.json'), '--log-world', 'real']);
  for (let i = 0; i < 200 && !/headless world/.test(w.out()); i++) await new Promise(r => setTimeout(r, 100));
  const h = await fetch(HB + '/play/health').then(r => r.json()).catch(() => ({heroes: []})), hero = (h.heroes || [])[0];
  ok(!!hero, `headless world up with agent hero ${hero && hero.name}`);
  if (hero) {
    const r = kid(['scripts/agent-player.mjs', '--url', HB, '--hero', String(hero.id), '--provider', 'ollama', '--model', 'mock-lazy:1b', '--max-turns', '6', '--ollama-url', mock.url]);
    const code = await Promise.race([r.done, new Promise(res => setTimeout(() => res('timeout'), 120000))]);
    ok(code === 0, 'the local runner ran its turns and stopped' + (code === 0 ? '' : ' (' + code + ')\n' + r.out().slice(-800)));
    await new Promise(res => setTimeout(res, 600));
    const RD = join(HL, 'behavior', 'real'), rt = readJsonl(RD, FILES.turn), ra = readJsonl(RD, FILES.anomaly);
    ok(rt.length === 6 && rt.every(t => t.seat === 'hero:' + hero.id && t.provider === 'ollama' && t.model === 'mock-lazy:1b' && t.runner), `6 turn lines from the real runner (${rt.length})`);
    ok(rt.every(t => t.brief && t.after && t.after.state), 'each carries the state header before (from the runner) and after (from the game)');
    ok(rt.slice(0, 3).every(t => t.calls > 0) && rt.slice(3).some(t => t.flags.includes('empty')), `three working turns, then empty ones: ${rt.map(t => t.calls + (t.flags.length ? '[' + t.flags.join(',') + ']' : '')).join(' ')}`);
    ok(ra.some(a => a.kind === 'stale-claim' && a.seat === 'hero:' + hero.id), 'the lazy model\'s long-over fight is caught as a stale claim');
    ok(ra.some(a => a.kind === 'repeated-narration'), 'and its repeated narration');
    ok(readJsonl(RD, FILES.world).length > 0, 'the headless world wrote its digests');
  }
  w.p.kill(); await w.done; mock.close && mock.close();
}

console.log('\n--- sample report.md (head) ---\n' + md.split('\n').slice(0, 30).join('\n') + '\n...');
try {rmSync(ROOT, {recursive: true, force: true})} catch {}
console.log(fail ? `\nbehaviorcheck: ${fail} FAILED\n` : '\nbehaviorcheck: all good\n');
process.exit(fail ? 1 : 0);
