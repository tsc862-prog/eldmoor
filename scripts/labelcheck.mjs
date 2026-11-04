// Runner label check (issue #563): while a runner holds a Fellowship seat, every view says one steady thing.
// The owner saw the frames "rotate between no runner and Fellowship runner" with Claude members whose turns ran
// 60-90 s. Cause: two sources. The supervisor's runner list (GET /play/runner) kept every living member under the
// Fellowship runner, while the relay's claims (the links) dropped a member the runner had finished with (its 6-turn
// cap) or whose link aged from connected to waiting; and the page read 'no runner' for a moment after every
// (re)connect, before the relay's first links message. This check plays it with the real relay routes
// (scripts/relay-mcp.mjs attachPlay), the real supervisor (scripts/runners.mjs, a fake child process), the real page
// modules (src/ui/runners.js, mindlabel.js, rungate.js, player-bridge.js in a stub DOM) and a fake clock:
//   1. a page that just connected reads 'connecting', never 'no runner';
//   2. a 120 s silent Claude turn (claims refreshed every 8 s, no tool call): each member's mind label, runner line
//      and the start gate stay the same at every second;
//   3. a member the Fellowship runner lets go (its turns or budget ran out) reads 'no runner' at once and steadily,
//      the runner line and the gate say the runner is done with it, and the gate's button restarts that runner;
//   4. a claimed seat with no warm-up record counts as ready once its runner has played a turn;
//   5. the runner line shows spend against the budget, with no turn cap (owner, #563);
//   6. every mind active or the world pauses (owner decision on #559): the DM seat always counts; a runner that crashes
//      mid-play pauses the world at once and the banner names who; restarted, it runs; the DM runner stops: paused; the
//      owner's Resume anyway overrides until the next change.
// Usage: npm run labelcheck
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir, hostname} from 'node:os';
import {join} from 'node:path';
import {install} from './stubdom.mjs';

install(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
let T = Date.parse('2026-11-03T07:23:00Z'); const realNow = Date.now.bind(Date); Date.now = () => T; // one fake clock for the relay, the supervisor and the page
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0; const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};

const {seedRng} = await import('../src/core/rng.js'); seedRng(563);
const sim = await import('../src/sim/index.js'); sim.init();
const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const {attachPlay} = await import('./relay-mcp.mjs');
const {attachRunners} = await import('./runners.mjs');
const RN = await import('../src/ui/runners.js');
const {mindLabel} = await import('../src/ui/mindlabel.js');
const BR = await import('../src/ui/player-bridge.js');
const G = await import('../src/ui/rungate.js');

const mem = SLT.slotMembers(SLT.slotted()).map(m => m.hero).filter(Boolean);
for (const a of mem) if (!a.player) sim.markPlayer(a, true);
ok(mem.length === 5 && mem.every(a => a.player), 'a Fellowship of five agent-played members');
const hello = () => mem.map(a => ({id: a.id, name: a.name, alive: a.state !== 'dead', fellow: true, role: SLT.slotKeyOf(a) || null}));

// the relay with a backend standing in for the page's socket, and the supervisor with a fake child
const be = {call: async () => ({ok: true}), dmCall: async () => ({ok: true}), narrate() {}, info: () => ({connected: true, heroes: hello(), dm: sim.dmSeatOn()})};
sim.setDmSeat(true); // the DM is always an agent (#559): the page plays every world with its DM seat open
const kids = [];
const fakeSpawn = (cmd, args, opts) => {const k = new EventEmitter(); k.pid = 47000 + kids.length; k.stdout = new EventEmitter(); k.stderr = new EventEmitter();
  k.stdin = Object.assign(new EventEmitter(), {write() {}}); k.kill = () => setTimeout(() => k.emit('exit', null), 1); kids.push(k); return k};
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-labelcheck-'));
const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
const play = attachPlay(server, {backend: be, log: () => {}});
attachRunners(server, {play, enabled: true, log: () => {}, spawnImpl: fakeSpawn, base: () => 'http://127.0.0.1:1', logs: tmp, env: {PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-test-not-a-key', RUNNER_CLAUDE_MAX: '3'}});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
localStorage.setItem('eldmoor.playUrl', base.replace(/^http/, 'ws') + '/play');
const post = (path, body, origin) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', ...(origin ? {origin} : {})}, body: JSON.stringify(body)}).then(async r => ({status: r.status, ...(await r.json().catch(() => ({})))}));

// the page's view: the relay's links message as the socket would bring it, then the runner list poll
const linksMsg = () => {const ids = hello().map(h => h.id);
  return {type: 'links', links: play.links(), dm: play.dmInfo(), runners: Object.fromEntries(ids.map(id => [id, play.runnerOf(id)]).filter(e => e[1])), ready: Object.fromEntries(ids.map(id => [id, play.readyOf(id)]).filter(e => e[1]))}};
async function view() {BR.bridgeFeed(linksMsg()); RN.runnerSig(mem[0]); for (let i = 0; i < 40; i++) {await sleep(2); if (RN.allRunners().length) break} await sleep(5)}
const norm = s => String(s).replace(/last \d+ (s|min|h) ago/g, 'last # ago').replace(/\$\d+\.\d+ of \$\d+\.\d+/g, '$ of $').replace(/\d+(\.\d+)?/g, '#'); // spend, turns, rates and ages move; the words must not
const labels = a => ({mind: mindLabel(a).text + ' · ' + (BR.agentReadyWord(a) || '-'), run: norm(RN.runnerControl(a).textContent)});
const gate = () => {G.checkRunGate(T); return G.gateMissing().map(m => m.name + ': ' + G.whyMissing(m))};

// ---- 1. a page that just connected
BR.bridgeFeed(null); BR.bridgeFeed({type: 'hello-only'}); // connected, no links message yet
ok(BR.agentLink(mem[0]) === 'connecting' && !/no runner/.test(mindLabel(mem[0]).text), `right after (re)connecting the page says connecting, not no runner ("${mindLabel(mem[0]).text}")`);

// ---- the Fellowship runner, started from the page, its members claimed and warmed up
const st = await post('/play/runner/start', {kind: 'fellowship', provider: 'anthropic', model: 'claude-haiku-5-5'}, 'http://localhost:5173');
ok(st.status === 200 && st.runner && st.runner.maxTurns == null && st.runner.turnCap === 'until stopped' && st.runner.budget === 2, `a paid Fellowship runner has no turn cap and the $2 budget (${st.runner && st.runner.turnCap})`);
const kid = kids[0], rid = `${hostname()}:${kid.pid}:fellowship`, say = l => kid.stdout.emit('data', Buffer.from(l + '\n'));
const claim = a => post('/play/claim', {hero: a.id, runner: rid, provider: 'anthropic', model: 'claude-haiku-5-5'});
for (const a of mem) await claim(a);
for (const a of mem.slice(0, 4)) await post('/play/ready', {hero: a.id, runner: rid, state: 'ready', model: 'claude-haiku-5-5', ms: 3600});
for (const a of mem) await post('/play/call', {tool: 'status', args: {}, hero: a.id, runner: rid});
// the DM runner (#559: its seat always counts), claimed and warmed up
const dst = await post('/play/runner/start', {kind: 'dm', provider: 'anthropic', model: 'claude-haiku-5-5'}, 'http://localhost:5173');
let dkid = kids[kids.length - 1], drid = `${hostname()}:${dkid.pid}:dm`;
const dmClaim = () => post('/play/claim', {role: 'dm', runner: drid, provider: 'anthropic', model: 'claude-haiku-5-5'});
await dmClaim(); await post('/play/ready', {role: 'dm', runner: drid, state: 'ready', model: 'claude-haiku-5-5', ms: 2100});
ok(dst.status === 200 && play.dmInfo().claimed && play.readyOf('dm') && play.readyOf('dm').state === 'ready', 'the DM runner holds the open DM seat and is ready');
say(`[07:23:56] [${mem[0].name}] [turn 1] claude-haiku-5-5 | 15 tool calls, 32.0 s | turn $0.0073 | member $0.0073 | run $0.0073 of $2.0000`);
await view();

// ---- 4. the fifth seat never posted a warm-up: the gate holds on it until its runner plays a turn
let g = gate();
ok(g.length === 1 && g[0].startsWith(mem[4].name) && /claimed/.test(g[0]), `a claimed seat with no warm-up holds the gate (${g.join(' | ')})`);
const tl = await post('/play/behavior/turn', {hero: mem[4].id, runner: rid, rec: {turn: 1, tools: ['status'], seconds: 30}});
T += 1000; await view(); g = gate();
ok(tl.status === 404 && g.length === 0 && play.readyOf(mem[4].id) && play.readyOf(mem[4].id).state === 'ready', 'once its runner has played a turn, the seat counts as ready (the gate opens, even without behavior logs)');
ok(BR.agentReadyWord(mem[4]) === 'ready', 'the frame reads ready for it too');

// ---- 2. a 120 s silent turn: claims every 8 s, no tool call, one Claude slot leased then waited for
const seen = mem.map(() => ({mind: new Set(), run: new Set()})), gates = new Set();
await post('/play/runner/slot', {key: 'fellowship', op: 'take'}, 'http://localhost:5173').catch(() => {});
for (let s = 1; s <= 120; s++) {
  T += 1000;
  if (s % 8 === 0) {for (const a of mem) await claim(a); await dmClaim()}
  if (s === 60) say(`[${mem[1].name}] [pace] waiting: a turn on an event, else every 120 game min, at least 20 s apart`);
  await view();
  mem.forEach((a, i) => {const L = labels(a); seen[i].mind.add(L.mind); seen[i].run.add(L.run)});
  gates.add(gate().join('|'));
}
mem.forEach((a, i) => ok(seen[i].mind.size === 1 && seen[i].run.size === 1 && /claude-haiku-5-5 · live\) · ready/.test([...seen[i].mind][0]) && /^Fellowship runner/.test([...seen[i].run][0]),
  `${a.name}: one label for 120 s of silence ("${[...seen[i].mind].join('" / "')}" | "${[...seen[i].run].join('" / "')}")`));
ok(gates.size === 1 && [...gates][0] === '', 'the start gate stays open through the silent turn');
ok(play.links()[mem[0].id] === 'waiting', 'the relay itself still tells thinking (waiting) from calling tools (the tooltip and Agent tab detail)');

// ---- 5. spend against the budget, no turn cap
const line = RN.stateLine(RN.runnerByKey('fellowship'), 'fellowship');
ok(/\$0\.007 of \$2\.00/.test(line) && !/up to \d+ turns/.test(line), `the runner line shows spend of budget, no turn cap ("${line}")`);

// ---- 3. the runner finishes with one member while the others play on
const done = mem[3];
say(`[07:29:09] [${done.name}] done (budget reached): 6 turns, 2 at the table, $0.0128`);
await post('/play/call', {tool: 'wait', args: {minutes: 30}, hero: done.id, runner: rid}); // its last call, a moment before it lets go
await post('/play/release', {hero: done.id, runner: rid});
const after = new Set(), runs = new Set(), why = new Set();
for (let s = 1; s <= 60; s++) {
  T += 1000; if (s % 8 === 0) {for (const a of mem) if (a !== done) await claim(a); await dmClaim()}
  await view(); if (s <= 2) continue; // the page polls the runner list every 2 s: its first poll after the release
  const L = labels(done); after.add(L.mind); runs.add(L.run); why.add(gate().join('|'));
}
ok(after.size === 1 && /no runner/.test([...after][0]), `a member the runner let go reads no runner at once and stays so ("${[...after].join('" / "')}")`);
ok(runs.size === 1 && /done with .*budget reached/.test([...runs][0]), `its runner line says the Fellowship runner is done with it ("${[...runs][0]}")`);
ok(why.size === 1 && new RegExp(done.name + ': the Fellowship runner is done with').test([...why][0]), `the gate says why (${[...why][0]})`);
{const box = document.getElementById('rgate'), b = box && box.querySelector('[data-runact]');
  ok(!!b && b.dataset.runact === 'restart' && b.dataset.runkind === 'fellowship' && b.dataset.runhero == null, 'the gate\'s button restarts the Fellowship runner, not a hero runner the seats would refuse')}
{const box = document.getElementById('rgate'), t = box.textContent, w = [...why][0]; // a budget stop's alert (#807): what was spent, what another start costs
  ok(/budget spent: \$\d+\.\d\d of \$2\.00/.test(w) && /Restart spends another \$2\.00/.test(w), `the gate names the spend and the price (${w})`);
  ok(/Restart · another \$2\.00/.test(t) && /Start all · another \$\d+\.00/.test(t), 'the buttons carry the price: ' + [...box.querySelectorAll('button')].map(b => b.textContent).join(' | '));
  ok(/No session budget is set/.test(t), 'and the alert says no session budget is set')}
const others = mem.filter(a => a !== done).map(labels);
ok(others.every(L => /live\) · ready/.test(L.mind) && /^Fellowship runner/.test(L.run)), 'the other four still read live and ready under the Fellowship runner');
const rv = RN.runnerByKey('fellowship');
ok(rv && !rv.heroes.includes(done.id) && rv.left && rv.left[0].id === done.id && rv.left[0].why === 'budget reached', 'the supervisor lists it as left, not as played');

// ---- 6. every mind active or the world pauses (owner decision on #559)
{const {ctl} = await import('../src/ui/controls.js'), box = document.getElementById('rgate');
  const tick = async (n = 3) => {for (let i = 0; i < n; i++) {T += 1000; await dmClaim(); await view(); G.checkRunGate(T)}};
  // a fresh Fellowship runner for all five (the old one let a member go above): the world runs
  kid.emit('exit', 0); await tick(3);
  const st2 = await post('/play/runner/start', {kind: 'fellowship', provider: 'anthropic', model: 'claude-haiku-5-5'}, 'http://localhost:5173');
  const k2 = kids[kids.length - 1], rid2 = `${hostname()}:${k2.pid}:fellowship`;
  const up = async () => {for (const a of mem) {await post('/play/claim', {hero: a.id, runner: rid2, provider: 'anthropic', model: 'claude-haiku-5-5'}); await post('/play/ready', {hero: a.id, runner: rid2, state: 'ready', model: 'claude-haiku-5-5', ms: 900})}};
  await up(); for (let i = 0; i < 3; i++) {T += 1000; await up(); await dmClaim(); await view(); G.checkRunGate(T)}
  ok(st2.status === 200 && !ctl.held && gate().length === 0, 'every member and the DM live: the world runs (' + gate().join(' | ') + ')');
  // the Fellowship runner crashes mid-play: paused at once, the banner names the members
  k2.emit('exit', 1); T += 1000; await view(); await sleep(5); for (let i = 0; i < 3; i++) {T += 1000; await dmClaim(); await view(); G.checkRunGate(T)}
  const g6 = gate();
  ok(ctl.held && mem.every(a => g6.some(x => x.startsWith(a.name))), 'a runner that crashes mid-play pauses the world at once and the banner names every member it played (' + g6.join(' | ') + ')');
  ok(/Resume anyway/.test(box.textContent) && /Restart|Start/.test(box.textContent), 'the banner offers Restart/Start and Resume anyway once the world has run');
  // restarted: it runs again
  const st3 = await post('/play/runner/start', {kind: 'fellowship', provider: 'anthropic', model: 'claude-haiku-5-5'}, 'http://localhost:5173');
  const k3 = kids[kids.length - 1], rid3 = `${hostname()}:${k3.pid}:fellowship`;
  const up3 = async () => {for (const a of mem) {await post('/play/claim', {hero: a.id, runner: rid3, provider: 'anthropic', model: 'claude-haiku-5-5'}); await post('/play/ready', {hero: a.id, runner: rid3, state: 'ready', model: 'claude-haiku-5-5', ms: 900})}};
  for (let i = 0; i < 3; i++) {T += 1000; await up3(); await dmClaim(); await view(); G.checkRunGate(T)}
  ok(st3.status === 200 && !ctl.held, 'the runner restarted and ready: the world runs again');
  // the DM runner stops: paused, the DM named
  dkid.emit('exit', 0); for (let i = 0; i < 3; i++) {T += 1000; await up3(); await view(); G.checkRunGate(T)}
  ok(ctl.held && gate().length === 1 && /^DM: /.test(gate()[0]), 'the DM runner stops: the world pauses for the DM (' + gate().join(' | ') + ')');
  ok(sim.worldHeld() === 'gate', 'while paused, the heroes are held too (no paced turns, acting tools refused)');
  // the owner's override holds until the next change
  G.startAnyway(); for (let i = 0; i < 3; i++) {T += 1000; await up3(); await view(); G.checkRunGate(T)}
  ok(!ctl.held && !sim.worldHeld(), 'Resume anyway: the world runs without the DM (the scripted DM answers as reflexes)');
  const st4 = await post('/play/runner/start', {kind: 'dm', provider: 'anthropic', model: 'claude-haiku-5-5'}, 'http://localhost:5173');
  dkid = kids[kids.length - 1]; drid = `${hostname()}:${dkid.pid}:dm`;
  for (let i = 0; i < 3; i++) {T += 1000; await up3(); await dmClaim(); await post('/play/ready', {role: 'dm', runner: drid, state: 'failed', error: 'model not found', model: 'x'}); await view(); G.checkRunGate(T)}
  ok(st4.status === 200 && !ctl.held, 'a DM runner is back (its warm-up failed, but it is there and playing: active)');
  dkid.emit('exit', 1); for (let i = 0; i < 3; i++) {T += 1000; await up3(); await view(); G.checkRunGate(T)}
  ok(ctl.held && /^DM: /.test(gate()[0] || ''), 'the override held only until the next change: the DM runner goes again and the world pauses again');
  // Restart is one click (#807): it waits for the old child to go; the relay refuses a start while it is stopping
  const n5 = kids.length, p5 = RN.restartRunner('fellowship'); await sleep(40); k3.emit('exit', 0); const r5 = await p5;
  ok(r5.ok && kids.length === n5 + 1, 'Restart stops the runner and starts it again with one click: ' + JSON.stringify(r5.error || 'started'))}

server.close(); try {rmSync(tmp, {recursive: true, force: true})} catch {}
Date.now = realNow;
console.log(fail ? `\nlabelcheck: ${fail} failed` : '\nlabelcheck: all ok');
process.exit(fail ? 1 : 0);
