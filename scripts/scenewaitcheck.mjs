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
  ok(sc.ids.every(id => !sceneDue(S.agents.find(x => x.id === id))), 'while the DM sets the scene nothing is due yet (#682)');
  const gap0 = TABLE.wakeGapMs; TABLE.wakeGapMs = 0; // everyone woken together here (the stagger is tablecheck's and part E's)
  for (let i = 0; i < 600 && !(sc.wk && sc.wk.done); i++) sim.step(1 / 60); TABLE.wakeGapMs = gap0;
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
// ---------------------------------------------------------------- E. the DM sets the scene first (#682)
// Session zero with a DM table voice whose model takes 5 s and five live members: nobody is woken or may act before the frame,
// the frame is the DM agent's (not lost to the clock), the wakes carry it and go out in seat order TABLE.wakeGapMs apart.
console.log('E. a slow DM frame and five live members: nobody acts before the frame, wakes staggered by seat');
{
  const {tableVoice} = await import('./dm-agent.mjs'), {allScenes} = await import('../src/sim/scenes.js');
  for (const sc of allScenes()) sc.resolved = true; S.table = null;
  const live = mem.filter(a => a.state !== 'dead'); gather(); for (const a of live) a.playEv = [];
  sim.setDmSeat(true); setRunnerLinks(() => 'connected'); TABLE.speed = 1; TABLE.mode = 'auto';
  let last = Date.now(); const tick = setInterval(() => {const n = Date.now(); for (const a of live) a.hp = Math.max(a.hp, a.maxhp || 0); sim.step(Math.min(.1, (n - last) / 1000)); last = n}, 20);
  const adapter = {call: ({signal}) => new Promise((res, rej) => {const t = setTimeout(() => res({text: JSON.stringify({text: 'MOCKFRAME Rain on the shutters; the hall fire is low.', pick: ''}), usage: {in: 300, out: 20, cost: 0}}), 5000);
    if (signal) signal.addEventListener('abort', () => {clearTimeout(t); rej(new Error('Request was aborted.'))})})};
  const V = tableVoice({base: 'x', adapter, model: 'mock', tool: async (b, t, a) => sim.dmAct(t, a), pollIdle: 50, pollHot: 50, waitMs: 0});
  sim.planOpening();
  const until2 = async (f, ms) => {const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 20)); return f()};
  ok(await until2(() => S.table && S.table.kind === 'opening', 5000), 'session zero opens');
  const sc = S.table, t0 = Date.now(), told = a => (a.playEv || []).find(e => /TABLE \(opening\)/.test(e.text) && e.w === 3);
  const woke = {}, early = [], acted = {};
  let frameAt = null;
  await until2(() => {const now = Date.now() - t0;
    if (frameAt == null && sc.calls && sc.calls[0] && sc.calls[0].done) frameAt = now;
    for (const a of live) {if (!sc.ids.includes(a.id) || acted[a.id]) continue;
      if (!told(a)) {if (early.length < 40) {const r = sim.playerAct(a.id, 'scene_act', {option: 'listen'}); early.push(r)} continue}
      if (woke[a.id] == null) woke[a.id] = now;
      const tv = sim.playerAct(a.id, 'status', {}).table, k = tv && tv.options && tv.options[0].split(' = ')[0];
      if (k) {const r = sim.playerAct(a.id, 'scene_act', {option: k}); if (r.ok) acted[a.id] = 1}}
    return S.table !== sc}, 60000);
  await V.stop(); clearInterval(tick);
  const fr = sc.calls && sc.calls[0];
  ok(fr && fr.kind === 'frame' && fr.by === 'dm-agent' && /MOCKFRAME/.test(fr.text), `the frame is the DM agent's after 5 s of model time (${fr && fr.by}), set ${frameAt != null ? (frameAt / 1000).toFixed(1) + ' s' : '?'} in`);
  ok(early.length > 0 && early.every(r => !r.ok && r.offline && /still setting the scene/.test(r.error)), `every scene_act before a member was woken was refused, offline (${early.length} tries)`);
  const seats = sc.ids.filter(id => woke[id] != null), times = seats.map(id => woke[id]), gaps = times.slice(1).map((t, i) => t - times[i]);
  ok(seats.length === live.length && times[0] >= frameAt - 50, `nobody was woken before the frame (first wake ${(times[0] / 1000).toFixed(2)} s, frame ${(frameAt / 1000).toFixed(2)} s)`);
  ok(gaps.every(g => g >= TABLE.wakeGapMs - 250 && g <= TABLE.wakeGapMs + 400), `the wakes go out in seat order about ${TABLE.wakeGapMs / 1000} s apart (${gaps.map(g => (g / 1000).toFixed(2)).join(', ')} s)`);
  ok(live.every(a => /MOCKFRAME/.test((told(a) || {}).text || '')), 'each wake carries the DM\'s final frame');
  ok(sc.beats.length === live.length && sc.beats.every(b => b.by === 'agent'), 'every member answered by its agent: ' + sc.beats.map(b => b.name + '/' + b.by).join(', '));
  setRunnerLinks(null);
}
// ---------------------------------------------------------------- F. Claude slots and the scene (#687)
// Three Claude slots under the supervisor (RUNNER_CLAUDE_MAX 3), five Claude members and the DM. Three members are deep in
// long turns holding the slots, the DM and a fourth member (for a party line) wait for one, the fifth proposes a vote, and
// everyone answers at once. The waiting member's slot wait sees its scene: it tells the table (queued, why slot) and asks
// again as a scene, which the supervisor serves before the DM. Every answer lands, nobody's reflex votes, and a member that
// answered and waits gets one wait back when the table settles.
console.log('F. three Claude slots, five Claude members and the DM: every vote lands, the slot wait answers the scene first');
{
  const {EventEmitter} = await import('node:events'), {attachRunners} = await import('./runners.mjs'), {takeClaudeSlot} = await import('./pacing.mjs');
  const {localBackend} = await import('./play-headless.mjs'), {allScenes} = await import('../src/sim/scenes.js');
  for (const sc of allScenes()) sc.resolved = true; S.table = null;
  const live = mem.filter(a => a.state !== 'dead'); gather(); for (const a of live) a.playEv = [];
  sim.setDmSeat(true); setRunnerLinks(() => 'connected'); TABLE.speed = 1; TABLE.mode = 'auto';
  const liveMs0 = TABLE.liveMs, extra0 = SW.EXTRA_MS; TABLE.liveMs = 9000; SW.EXTRA_MS = 30000; // a short live wait: only a queued member outlasts it
  let last = Date.now(); const tick = setInterval(() => {const n = Date.now(); for (const a of live) a.hp = Math.max(a.hp, a.maxhp || 0); sim.step(Math.min(.1, (n - last) / 1000)); last = n}, 20);
  const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
  const play = attachPlay(server, {backend: localBackend(), log: () => {}}); setRunnerLinks(() => 'connected'); // every member's runner holds it (after the backend's own links)
  const fakeSpawn = () => {const k = new EventEmitter(); k.pid = 50000 + Math.floor(Math.random() * 1000); k.stdout = new EventEmitter(); k.stderr = new EventEmitter(); k.stdin = Object.assign(new EventEmitter(), {write() {}}); k.kill = () => setTimeout(() => k.emit('exit', null), 5); return k};
  const tmpF = mkdtempSync(join(tmpdir(), 'eldmoor-slotscene-'));
  let PBF = null;
  const sup = attachRunners(server, {play, enabled: true, log: () => {}, spawnImpl: fakeSpawn, base: () => PBF, logs: tmpF, env: {PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-test-not-a-key', RUNNER_CLAUDE_MAX: '3', RUNNER_DM_SLOTS: '0'}}); // the DM in the shared pool, as before its own slot (#733): scene first still holds there
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PBF = `http://127.0.0.1:${server.address().port}`;
  const J = (path, body, origin) => fetch(PBF + path, {method: 'POST', headers: {'content-type': 'application/json', ...(origin ? {origin} : {})}, body: JSON.stringify(body)}).then(r => r.json());
  const starts = [];
  for (const a of live) starts.push(await J('/play/runner/start', {hero: a.id, provider: 'anthropic'}, 'http://localhost:5173'));
  starts.push(await J('/play/runner/start', {kind: 'dm', provider: 'anthropic'}, 'http://localhost:5173'));
  ok(starts.every(x => x.ok !== false) && live.length === 5, 'five Claude member runners and the DM under the supervisor, 3 slots: ' + starts.filter(x => x.ok === false).map(x => x.error).join('; '));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const due = id => async () => {const h = await (await fetch(PBF + '/play/health')).json(); const me = (h.heroes || []).find(x => x.id === id); return !!(me && me.due)};
  const why = {}, logs = [];
  const queued = (a, w) => async () => {why[a.id] = w; await J('/play/pace', {hero: a.id, queued: true, why: w})};
  const call = (a, tool, args) => J('/play/call', {hero: a.id, tool, args});
  const answer = async a => {const r = await call(a, 'scene_act', {option: 'yes', line: 'Aye.'}); return r.ok};
  const [A, B, C, D, E] = live, answered = {};
  // a member's answer once its scene is due: a slot (scene first), one model call (1 s), scene_act, release
  const answerWhenDue = async (a, w) => {for (let i = 0; i < 600 && !(await due(a.id)()); i++) await sleep(100);
    const free = await takeClaudeSlot(PBF, s => logs.push(a.name + ' ' + s), {key: 'hero:' + a.id, due: due(a.id), onDue: queued(a, w)});
    await sleep(1000); answered[a.id] = await answer(a); free()};
  // A, B, C: long turns holding the three slots (16 s of model time); when their scene comes up mid-turn they say so (turn)
  const long = async a => {const free = await takeClaudeSlot(PBF, () => {}, {key: 'hero:' + a.id});
    for (let i = 0; i < 160; i++) {await sleep(100); if (!why[a.id] && await due(a.id)()) await queued(a, 'turn')()} free(); await answerWhenDue(a, 'turn')};
  const runs = [long(A), long(B), long(C)];
  await sleep(500);
  // the DM's turn waits for a slot; D waits for one for a party line; its scene opens while it waits
  runs.push((async () => {const free = await takeClaudeSlot(PBF, () => {}, {key: 'dm'}); logs.push('dm got a slot'); await sleep(3000); free()})());
  let dSlot = null;
  runs.push((async () => {const free = await takeClaudeSlot(PBF, s => logs.push(D.name + ' ' + s), {key: 'hero:' + D.id, due: due(D.id), onDue: queued(D, 'slot')}); dSlot = free.scene;
    logs.push(D.name + ' got a slot' + (free.scene ? ' for its scene' : ''));
    if (free.scene) {await sleep(1000); answered[D.id] = await answer(D)} free(); if (!answered[D.id]) await answerWhenDue(D, 'slot')})());
  await sleep(500);
  const pr = await call(E, 'propose', {kind: 'other', details: 'Ride for the ford at first light'});
  ok(pr.ok, 'the fifth member puts a vote to the company: ' + (pr.error || 'ok'));
  const sc = await (async () => {for (let i = 0; i < 100 && !(S.table && S.table.kind === 'decision'); i++) await sleep(50); return S.table})();
  ok(sc && sc.all && sc.ids.length === 5, 'an everyone-answers vote opens for the five');
  // A answers and then waits: one wait, back when the table settles
  let waits = 0, wr = null;
  const aWait = (async () => {for (let i = 0; i < 1200 && !answered[A.id]; i++) await sleep(50); waits++; wr = await call(A, 'wait', {minutes: 30})})();
  await Promise.all(runs); await aWait;
  for (let i = 0; i < 100 && S.table === sc; i++) await sleep(100);
  clearInterval(tick);
  const beats = sc ? sc.beats : [];
  ok(beats.length === 5 && beats.every(b => b.by === 'agent'), 'every member\'s answer landed, no reflex voted: ' + beats.map(b => b.name + ' ' + b.k + '/' + b.by).join(', '));
  ok(sc && !(sc.miss && sc.miss.length) && !sc.late, 'nobody was missed');
  ok(dSlot === true && sc && sc.qw && sc.qw[D.id] === 'slot' && sc.q.includes(D.id), `${D.name}, waiting for a slot when its scene opened, told the table (queued, why slot) and got a slot for the scene`);
  const dmAt = logs.indexOf('dm got a slot'), dAt = logs.findIndex(l => l.startsWith(D.name + ' got a slot'));
  ok(dAt >= 0 && dmAt >= 0 && dAt < dmAt, 'the supervisor served the scene request before the DM, which asked first: ' + logs.filter(l => /got a slot/.test(l)).join(' | '));
  ok(sc && [A, B, C].every(a => sc.qw && sc.qw[a.id] === 'turn'), 'the members mid-turn reported why (turn)');
  ok(waits === 1 && wr && wr.ok && wr.why === 'the table settled' && /Passed 5-0/.test(wr.scene_outcome || ''), `the member that answered and waited got one wait back when the table settled (${wr && wr.why}: ${wr && wr.scene_outcome})`);
  // the cause of a miss reaches the anomaly and the report
  const {missCause} = await import('../src/sim/scenewait.js');
  ok(missCause(sc, D.id) === 'waiting for a slot' && missCause(sc, A.id) === 'mid-turn' && missCause({}, 1) === 'no answer', 'the miss cause names what the answer waited behind');
  const rep = sceneAnswers([], [{kind: 'scene-missed', hero: {name: 'X'}, evidence: {cause: 'waiting for a slot'}}, {kind: 'scene-missed', hero: {name: 'X'}, evidence: {cause: 'mid-turn'}, heldBack: 1}]);
  const xm = rep.data.members.find(m => m.name === 'X');
  ok(xm && xm.missed === 3 && xm.causes['waiting for a slot'] === 1 && xm.causes['mid-turn'] === 2 && /missed by cause/.test(rep.lines.join('\n')), 'the report splits misses by cause');
  TABLE.liveMs = liveMs0; SW.EXTRA_MS = extra0; setRunnerLinks(null); sup.killAll(); server.close();
  try {rmSync(tmpF, {recursive: true, force: true})} catch {}
}
// ---------------------------------------------------------------- G. a Claude member mid-turn is aborted for its scene (#687 follow-up)
// The Agent SDK query is a model call no tool result can interrupt, so the runner watches whether the member's own scene is due
// (sceneGrab, scripts/pacing.mjs): due for SCENE_GRAB_MS with no scene_act, the query's AbortController fires, the structured
// scene answer is played, and the member's turn resumes. Here the "query" is a mock that runs until its signal aborts.
console.log('G. a Claude member mid-turn is aborted at SCENE_GRAB_MS, answers in time, resumes, and nobody is missed');
{
  const {sceneGrab, SCENE_GRAB_MS, GRAB_RESUME} = await import('./pacing.mjs');
  ok(SCENE_GRAB_MS === 15000 && /Carry on/.test(GRAB_RESUME), 'the grab is 15 s by default and the resume prompt tells the member to carry on');
  // unit: answered in time -> never fires; stop() ends the poll; a flap resets the clock
  {let d = true, n = 0; const g = sceneGrab({due: () => d, abort: () => n++, ms: 400, every: 50}); await sleep(200); d = false; await sleep(150); d = true; await sleep(250); ok(n === 0 && !g.grabbed(), 'due, then not due, then due again: the clock restarted, nothing fired'); g.stop();
   const g2 = sceneGrab({due: () => true, abort: () => n++, ms: 200, every: 50}); g2.stop(); await sleep(400); ok(n === 0, 'a stopped grab never fires');
   const g3 = sceneGrab({due: () => true, abort: () => n++, ms: 200, every: 50}); await sleep(500); ok(n === 1 && g3.grabbed(), 'due for the whole window: fires once')}
  const liveMs0 = TABLE.liveMs, extra0 = SW.EXTRA_MS, gap0 = TABLE.wakeGapMs; TABLE.liveMs = 4000; SW.EXTRA_MS = 2000; TABLE.wakeGapMs = 0;
  setRunnerLinks(() => 'connected'); S.table = null; gather();
  const sc = openScene('check', 'A stair in the dark', ['The DM calls for a roll at the stair.'], {anchor: mem[0].id});
  for (let i = 0; i < 600 && !(sc.wk && sc.wk.done); i++) sim.step(1 / 60);
  const ids = sc.ids, [A, B, ...rest] = mem.filter(x => ids.includes(x.id));
  // A is mid-turn: a mock query that only ends when aborted. The others answer at once.
  const ac = new AbortController(); let aborted = 0, resumed = 0, failed = false, grabAt = null;
  const t0 = Date.now(), inFlight = (async () => {try {await new Promise((res, rej) => {const t = setTimeout(res, 20000); ac.signal.addEventListener('abort', () => {clearTimeout(t); aborted++; rej(Object.assign(new Error('aborted'), {name: 'AbortError'}))}, {once: true})})} catch (e) {if (!grab.grabbed()) failed = true}})();
  const grab = sceneGrab({due: () => sceneDue(A), abort: () => ac.abort(), onGrab: () => {grabAt = Date.now() - t0}, ms: 800, every: 100});
  for (const x of [B, ...rest]) sim.playerAct(x.id, 'scene_act', {option: 'press', line: 'Down.'});
  const ticker = setInterval(() => {for (let i = 0; i < 6; i++) sim.step(1 / 60)}, 100); // the table ticks real time, as the page does
  await inFlight; grab.stop();
  ok(aborted === 1 && !failed && grab.grabbed() && grabAt >= 700 && grabAt < 2500, `the mid-turn member's query was aborted once, ${grabAt} ms after its scene was due, and the abort was not counted as a failure`);
  // the structured scene answer, then the turn resumes (a second query)
  const ans = sim.playerAct(A.id, 'scene_act', {option: 'press', line: 'Coming.'}); resumed++;
  ok(ans.ok && ans.waited_s * 1000 < TABLE.liveMs, `the structured answer lands inside the table's wait (${ans.waited_s} s of ${TABLE.liveMs / 1000} s)`);
  ok(resumed === 1 && !sceneDue(A), 'the scene is answered, so the next turn resumes without it');
  for (let i = 0; i < 100 && S.table === sc; i++) await sleep(100);
  clearInterval(ticker);
  ok(sc.resolved && !(sc.miss && sc.miss.length) && ids.every(id => sc.acts[id] && sc.acts[id].by === 'agent'), 'the scene resolved with every answer by its agent and nobody missed');
  TABLE.liveMs = liveMs0; SW.EXTRA_MS = extra0; TABLE.wakeGapMs = gap0; setRunnerLinks(null); S.table = null;
}
closeOllama();
for (const k of kids) try {k.kill()} catch {}
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fails ? `\nscenewaitcheck: ${fails} FAILED` : '\nscenewaitcheck: all ok');
process.exit(fails ? 1 : 0);
