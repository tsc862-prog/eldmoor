// Scene waits check (issue #515): Fellowship members mid-turn or queued behind each other must still answer their Table
// scene inside the window. No Ollama, no API key: a mock Ollama (scripts/mock-ollama.mjs, model mock-busy) and an in-process
// world served like play-headless.
//   A. The Ollama adapter's queue: an urgent request (a scene answer) goes ahead of ordinary ones waiting; a request whose
//      signal aborts while it waits leaves the queue without reaching Ollama.
//   B. The local loop: interrupt() ends a free turn at once (a model call in flight is withdrawn); a tool result carrying the
//      game's table_waits line ends it after that call; joinTurns adds the forced answer to it.
//   C. The game: every tool result (and a wait) of a member whose own scene is open says so (table_waits); scene_act reports
//      how long the table waited (waited_s); a runner's pace {queued:true} gives that live member a bounded extra wait; a live
//      member the table timed out is the `scene-missed` anomaly (behavior watch) and the report counts it per member with the
//      answer latency per mind (p50/p90).
//   D. End to end: `npm run fellowship -- --provider ollama` with five slow mock members (every tool-loop call 1.2 s on one
//      Ollama queue, so they are nearly always mid-turn); an everyone-at-once scene opens while a member's turn is in flight:
//      every member answers by its agent inside the window (TABLE.liveMs set to 15 s here), the mid-turn member gives its turn
//      up for the scene, and the turn lines carry the table's wait.
// Usage: npm run scenewaitcheck
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir, hostname} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localTurn, joinTurns} from './local-agent.mjs';
import {ollamaAdapter} from './providers/ollama.mjs';
import {attachPlay} from './relay-mcp.mjs';
import {startMockOllama, MOCK_BUSY} from './mock-ollama.mjs';
import {sceneAnswers} from './behavior-report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, msg) => {console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => {const t0 = Date.now(); while (Date.now() - t0 < ms) {if (f()) return true; await sleep(50)} return false};

// ---------------------------------------------------------------- A. the queue
console.log('A. the Ollama adapter queue: scene answers first, withdrawn requests leave');
{
  const order = [], posted = [];
  const ad = ollamaAdapter({url: 'http://127.0.0.1:9', parallel: 1, chatPost: async (u, b) => {posted.push(b.messages[0].content); await sleep(80); order.push(b.messages[0].content); return {ok: true, status: 200, json: async () => ({message: {role: 'assistant', content: 'ok'}, prompt_eval_count: 1, eval_count: 1})}}});
  const m = c => [{role: 'user', content: c}];
  const ac = new AbortController();
  const ps = [ad.chat({model: 'm', messages: m('first')}), ad.chat({model: 'm', messages: m('free-1')}), ad.chat({model: 'm', messages: m('free-2'), signal: ac.signal}).catch(e => e),
    ad.chat({model: 'm', messages: m('scene-1'), urgent: true}), ad.chat({model: 'm', messages: m('scene-2'), urgent: true})];
  await sleep(10); ok(ad.busy() === 5 && ad.queued() === 4, `five requests: one in flight, four waiting (busy ${ad.busy()}, queued ${ad.queued()})`);
  ac.abort();
  const rs = await Promise.all(ps);
  ok(order.join(',') === 'first,scene-1,scene-2,free-1', 'the scene answers went ahead of the free turn waiting before them, in their own order: ' + order.join(','));
  ok(rs[2] instanceof Error && rs[2].withdrawn && !posted.includes('free-2'), 'a request withdrawn while it waited never reached Ollama: ' + (rs[2] && rs[2].message));
  ok(ad.busy() === 0, 'the queue is empty afterwards');
}

// ---------------------------------------------------------------- B. the local loop gives way
console.log('B. the local loop gives a free turn up for its scene');
{
  const sess = () => ({system: 'You are Test.', local: null});
  // interrupt(): a model call in flight is withdrawn and the turn ends at once
  let flip = false, calls = 0, aborted = false;
  const slowChat = async ({signal}) => {calls++; await new Promise((res, rej) => {const t = setTimeout(res, 3000); if (signal) signal.addEventListener('abort', () => {clearTimeout(t); aborted = true; rej(new Error('aborted'))}, {once: true})});
    return {message: {role: 'assistant', content: '', tool_calls: [{function: {name: 'look', arguments: {}}}]}, usage: {in: 1, out: 1}, ms: 1}};
  setTimeout(() => {flip = true}, 300);
  const t0 = Date.now(), r = await localTurn({chat: slowChat, call: async () => ({ok: true}), sess: sess(), prompt: 'Turn 2.', model: 'm', toolTurns: 6, interrupt: () => flip});
  ok(r.sceneJump && aborted && calls === 1 && Date.now() - t0 < 1500, `interrupt ends the turn at once: sceneJump ${!!r.sceneJump}, the call in flight withdrawn (${aborted}), ${calls} model call, ${Date.now() - t0} ms`);
  ok(/its scene opened mid-turn/.test((await import('./local-agent.mjs')).localLine(r, 'm')), 'the turn line says the scene opened mid-turn');
  // the game's table_waits line in a tool result ends the turn after that call
  let n = 0; const chat2 = async () => {n++; return {message: {role: 'assistant', content: '', tool_calls: [{function: {name: n === 1 ? 'look' : 'status', arguments: {}}}]}, usage: {in: 1, out: 1}, ms: 1}};
  const r2 = await localTurn({chat: chat2, call: async t => ({ok: true, table_waits: 'A Table scene waits on you (Test): answer with scene_act now (options: press, steady).'}), sess: sess(), prompt: 'Turn 2.', model: 'm', toolTurns: 6});
  ok(r2.sceneJump && n === 1 && r2.tools === 1, `a tool result saying the scene waits ends the turn after that call (model calls ${n}, tools ${r2.tools})`);
  const j = joinTurns(r2, {tools: 1, acts: 1, modelCalls: 1, in: 5, out: 6, cost: 0, modelMs: 9, ms: 10, rejected: 0, calls: [{name: 'scene_act', ok: true}], sceneS: [3.2], narration: 'Steady. (press)', mode: 'scene', forced: true});
  ok(j.tools === 2 && j.calls.length === 2 && j.sceneS[0] === 3.2 && j.sceneJump && j.forced && j.narration === 'Steady. (press)', 'joinTurns adds the forced answer to the given-up turn');
}

// ---------------------------------------------------------------- C. the game side
console.log('C. the game: waits note, waited_s, queued extra wait, scene-missed');
const sim = await import('../src/sim/index.js');
const {S, TABLE, setRunnerLinks} = sim, {openScene} = await import('../src/sim/table.js'), SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const {SW, sceneDue} = await import('../src/sim/scenewait.js'), {makeWatch} = await import('../src/sim/behavior.js'), {hostCall} = await import('../src/sim/player-host.js');
sim.init({fellowship: false});
for (let i = 0; i < 60 * 10; i++) sim.step(1 / 60);
const fo = SLT.foundSlots(SLT.autoPick(0), {fac: 0, ai: false}); SLT.setSlotMinds(SLT.slotted(), 'agent'); S.brainOn = false;
ok(fo.ok && SLT.slotted().ids.length === 5, 'a Fellowship of five, Minds: agents');
const mem = SLT.slotted().ids.map(id => S.agents.find(x => x.id === id));
const gather = () => {const L = mem.find(a => a.state !== 'dead'); let i = 0; for (const a of mem) if (a.state !== 'dead') {a.state = 'town'; a.hidden = false; a.target = null; a.pq = []; a.dest = null; a.hp = Math.max(a.hp, a.maxhp || 0); a.x = L.x + (i++ % 3 ? .5 : 0); a.y = L.y}};
{
  const liveMs0 = TABLE.liveMs, extra0 = SW.EXTRA_MS; TABLE.liveMs = 2000; SW.EXTRA_MS = 3000;
  setRunnerLinks(() => 'connected'); // every member's runner holds it
  const watch = makeWatch(); watch.tick();
  gather(); const sc = openScene('check', 'A test of the wait', ['The DM calls for a roll at the ford.'], {anchor: mem[0].id});
  ok(sc && sc.all && sc.pause, 'an everyone-at-once scene opens and pauses the world'); watch.tick(); // the watch sees it open
  const [a, b, c] = mem.filter(x => sc.ids.includes(x.id));
  const lk = sim.playerAct(a.id, 'look', {});
  ok(sceneDue(a) && typeof lk.table_waits === 'string' && /A Table scene waits on you \(A test of the wait\): answer with scene_act now \(options: [a-z, ]*press/.test(lk.table_waits), 'a member\'s tool result says its scene waits: ' + lk.table_waits);
  const wt = await hostCall(b.id, 'wait', {minutes: 30}, {poll: 5});
  ok(!wt.ok || /table_waits/.test(JSON.stringify(wt)), 'a wait on its own open scene is refused or says the scene waits: ' + JSON.stringify(wt).slice(0, 140));
  const q = await hostCall(c.id, 'pace', {queued: true});
  ok(q.ok && q.queued && q.scene === sc.title && q.extra_s === 3 && sc.q.includes(c.id), 'pace {queued:true} marks the member queued for this scene: ' + JSON.stringify(q));
  // the table ticks real time: 1.5 s, then a answers (waited_s), then the others run out of time; c gets its extra wait
  for (let i = 0; i < 100 && sc.phase === 'frame'; i++) sim.step(1 / 60); // the DM frames it first (TABLE.frameS)
  for (let i = 0; i < 90; i++) sim.step(1 / 60);
  const ans = sim.playerAct(a.id, 'scene_act', {option: 'press', line: 'Now.'});
  ok(ans.ok && ans.waited_s >= 1.2 && ans.waited_s <= 2 && !('table_waits' in ans), `scene_act says how long the table had waited (${ans.waited_s} s) and carries no waits note`);
  ok(!('table_waits' in sim.playerAct(a.id, 'look', {})), 'once answered, its tool results say nothing of the scene');
  for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60); // past liveMs for everyone but c
  const late = mem.filter(x => sc.ids.includes(x.id) && x !== a && x !== c);
  ok(late.every(x => sc.w[x.id] && sc.w[x.id].late) && !(sc.w[c.id] && sc.w[c.id].late) && S.table === sc && !sc.resolved, 'past the wait the unqueued live members fall to their reflex; the queued one is still waited for');
  ok(late.every(x => sc.miss.includes(x.id)) && !sc.miss.includes(c.id), 'the table records the missed members: ' + sc.miss.length);
  const cAns = sim.playerAct(c.id, 'scene_act', {option: 'steady', line: 'Here.'});
  ok(cAns.ok && cAns.waited_s > 2, `the queued member answers inside its extra wait (${cAns.waited_s} s, beyond the ${TABLE.liveMs / 1000} s base)`);
  for (let i = 0; i < 60 * 3 && S.table === sc; i++) sim.step(1 / 60);
  ok(sc.resolved && sc.acts[c.id].by === 'agent' && sc.acts[a.id].by === 'agent' && late.every(x => sc.acts[x.id].by === 'reflex'), 'the scene resolves: a and the queued member by their agents, the rest by reflex');
  for (let i = 0; i < 60 * 30 && S.table; i++) sim.step(1 / 60);
  const outs = watch.tick(), missed = outs.filter(o => o.kind === 'anomaly' && o.rec.kind === 'scene-missed');
  ok(missed.length === late.length && missed.every(o => o.rec.severity === 'bad' && o.rec.evidence.scene === sc.title && o.rec.evidence.queued === false), `the behavior watch reports each missed member as scene-missed (${missed.map(o => o.rec.hero.name).join(', ')})`);
  // a second scene where nobody is live (no host links): reflexes act at once, nothing is missed
  setRunnerLinks(null); gather();
  const sc2 = openScene('check', 'A quiet ford', ['Nothing much.'], {anchor: mem[0].id});
  for (let i = 0; i < 60 * 30 && S.table; i++) sim.step(1 / 60);
  ok(!sc2 || !sc2.miss, 'with no runner links (npm run sim, the checks) no member counts as missed');
  ok(!watch.tick().some(o => o.kind === 'anomaly' && o.rec.kind === 'scene-missed'), 'and no scene-missed anomaly');
  // the report: latency per mind and misses per member
  const T = [{seat: 'hero:' + a.id, hero: {id: a.id, name: a.name}, provider: 'ollama', model: 'qwen2.5:14b', sceneS: [2, 4]}, {seat: 'hero:' + c.id, hero: {id: c.id, name: c.name}, provider: 'ollama', model: 'qwen2.5:14b', sceneS: [10]},
    {seat: 'hero:' + b.id, hero: {id: b.id, name: b.name}, provider: 'anthropic', model: 'claude-haiku-5-5', sceneS: [1.5]}];
  const A = missed.map(o => ({...o.rec, heldBack: 1}));
  const rep = sceneAnswers(T, A), q14 = rep.data.minds.find(x => x.mind === 'ollama/qwen2.5:14b'), lm = rep.data.members.find(x => x.name === late[0].name);
  ok(q14 && q14.answers === 3 && q14.p50 === 4 && q14.p90 === 10 && lm && lm.missed === 2 && /## Table scene answers/.test(rep.lines.join('\n')), `the report: answer latency p50/p90 per mind (qwen ${q14 && q14.p50}/${q14 && q14.p90} s) and missed per member (${lm && lm.name} ${lm && lm.missed})`);
  TABLE.liveMs = liveMs0; SW.EXTRA_MS = extra0; S.table = null;
}

// ---------------------------------------------------------------- D. five slow local members, end to end
console.log('D. five slow local members on one Ollama queue answer an everyone-at-once scene in time');
const {url: OLLAMA, seen, close: closeOllama} = await startMockOllama();
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-scenewait-'));
const kids = [];
{
  const {localBackend} = await import('./play-headless.mjs');
  const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
  attachPlay(server, {backend: localBackend(), log: () => {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PB = `http://127.0.0.1:${server.address().port}`;
  TABLE.speed = 1; const LIVE = 15000, liveMs0 = TABLE.liveMs; TABLE.liveMs = LIVE;
  let last = Date.now();
  const tick = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; const n = Math.ceil(real / (1 / 60)); for (let i = 0; i < n; i++) {sim.step(real / n); if (!S.table) gather()}}, 50);
  gather();
  const env = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OLLAMA_URL: OLLAMA, AGENT_REFLECT: '0'};
  const p = spawn(process.execPath, ['scripts/fellowship.mjs', '--url', PB, '--provider', 'ollama', '--model', 'mock-busy:1b', '--min-gap', '0', '--heartbeat', '5', '--ollama-url', OLLAMA, '--new'], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  kids.push(p); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const health = () => fetch(PB + '/play/health').then(r => r.json()).catch(() => null);
  const claimed = await (async () => {for (let i = 0; i < 300; i++) {const h = await health(); if (h && h.heroes && h.heroes.filter(x => x.fellow && x.claimed).length === 5) return true; await sleep(100)} return false})();
  ok(claimed, 'the Fellowship runner claims all five (mock-busy:1b, one Ollama queue)' + (claimed ? '' : '\n' + out.slice(-1500)));
  // a member mid-turn: its free turn has made a call and goes on (each call takes 1.2 s on the shared queue)
  const live = mem.filter(a => a.state !== 'dead'), names = live.map(a => a.name);
  const midTurn = () => {for (const nm of names) {const L = out.split(/\r?\n/).filter(l => l.includes('[' + nm + ']')); const i = L.map((l, k) => /\] > (look|status|rest)\(/.test(l) ? k : -1).filter(k => k >= 0).pop();
    if (i != null && i >= 0 && !L.slice(i).some(l => /\[turn \d+/.test(l))) return nm} return null};
  ok(await until(() => midTurn(), 60000), 'a member is mid-turn: ' + midTurn());
  const X = live.find(a => a.name === midTurn()), mark = out.length;
  gather(); const t0 = Date.now(), sc = openScene('check', 'A test at the ford', ['The DM calls for a roll at the ford.'], {anchor: live[0].id});
  ok(sc && sc.all && sc.pause && sc.ids.length === live.length, `an everyone-at-once scene opens while ${X.name} is mid-turn (${sc && sc.ids.length} members)`);
  const doneIn = await until(() => S.table !== sc, LIVE + 30000) ? Date.now() - t0 : null;
  const after = out.slice(mark);
  ok(doneIn != null && doneIn < LIVE && !sc.late && !sc.miss, `the scene resolves inside the window (${doneIn == null ? 'still open' : (doneIn / 1000).toFixed(1) + ' s'} of ${LIVE / 1000} s), nobody timed out` + (doneIn != null && !sc.late ? '' : '\n' + after.slice(-3000)));
  ok(sc.beats.length === live.length && sc.beats.every(b => b.by === 'agent' && b.k === 'press'), 'every member answered by its agent (press): ' + sc.beats.map(b => b.name + ' ' + b.k + '/' + b.by).join(', '));
  const xl = after.split(/\r?\n/).filter(l => l.includes('[' + X.name + ']')), jumped = xl.some(l => /opened mid-turn; answering it first|its scene opened mid-turn: answered it first/.test(l));
  ok(jumped, `${X.name}, mid-turn when the scene opened, gave that turn up and answered the scene in it` + (jumped ? '' : '\n' + xl.slice(0, 10).join('\n')));
  ok((seen.busyScene || 0) >= live.length, `the scene answers were forced structured answers (${seen.busyScene || 0})`);
  ok(sc.q && sc.q.includes(X.id) && /answer queued behind other work: the table waits up to 90 s more/.test(after), `the runner told the game which answers were queued behind other work (${(sc.q || []).length} of ${live.length})`);
  p.kill(); clearInterval(tick); TABLE.liveMs = liveMs0;
  for (const a of mem) await fetch(PB + '/play/release', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: a.id, runner: `${hostname()}:${p.pid}:fellowship`})}).catch(() => {});
  server.close();
}
closeOllama();
for (const k of kids) try {k.kill()} catch {}
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fails ? `\nscenewaitcheck: ${fails} FAILED` : '\nscenewaitcheck: all ok');
process.exit(fails ? 1 : 0);
