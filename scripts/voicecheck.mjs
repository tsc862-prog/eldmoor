// The DM's voices in time (issue #680). No API key, no Ollama: a mock model with realistic latency (2-5 s a call).
// Seen live: the runner polled table_call / npc_call / ruling_call every 0.4-2.5 s, the game counted each call's budget from
// when it was posted, so session zero's frame, talk lines and rulings were lost to the clock (the scripted DM filled them) and
// the three pollers made ~90 calls a minute (the request-flood anomaly). Now the voices long-poll ({wait_ms}: the host holds
// the request until a call waits) and a call's budget starts when the runner first reads it, capped at budget + pickupMs.
//   1. Idle: the three voices (scripts/dm-agent.mjs tableVoice, talkVoice, rulingVoice) over the real relay routes
//      (attachPlay + the headless backend) make at most POLL_BOUND polls a voice in IDLE_S seconds.
//   2. Session zero's frame posted while the table voice is not polling, picked up PICKUP_S (5) seconds later and answered
//      after 5 s of model time: the DM agent's frame, not the scripted fill.
//   3. A member's talk line and a free action (attempt) answered by the DM's voices with 2-5 s model calls, in time.
//   4. A hero goes down while the table voice is mid-call (#655): the DM's lines, not the scripted fill, both for a second hero
//      down during the model call and for a downing whose end comes while its line is being written.
//   5. Nothing was filled by the scripted DM, and the whole run stays under RATE_BOUND DM calls a real minute (the
//      request-flood anomaly fires at 90).
import http from 'node:http';
let seed = 0x9e3779b9 ^ 680;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const sim = await import('../src/sim/index.js');
const {init, step, S, setDmSeat, setDmAlive, setRunnerLinks} = sim;
const SLT = await import('../src/sim/company.js'), A_ = await import('../src/sim/arrival.js'), T = await import('../src/sim/table.js');
const P = await import('../src/sim/player.js'), {homeOf} = await import('../src/data/races.js'), {maxHp} = await import('../src/sim/heroes.js');
(await import('../src/sim/fireside.js')).FIRE.ON = false; (await import('../src/sim/outposts.js')).OP.ON = false;
const {attachPlay} = await import('./relay-mcp.mjs'), {localBackend} = await import('./play-headless.mjs');
const {tableVoice, talkVoice, rulingVoice, dmTool, VOICE_WAIT_MS} = await import('./dm-agent.mjs');
const {BD} = await import('./behavior-log.mjs');
const DCALL = await import('../src/sim/downcall.js'), D = await import('../src/sim/downed.js');

const IDLE_S = 25, POLL_BOUND = 3, PICKUP_S = 5, RATE_BOUND = 20;
let fails = 0; const ok = (c, m) => {console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++};
const sleep = ms => new Promise(r => setTimeout(r, ms));

init({fellowship: false}); for (let i = 0; i < 600; i++) step(1 / 60);
SLT.foundSlots(SLT.autoPick(0), {fac: 0, ai: false}); SLT.setSlotMinds(SLT.slotted(), 'agent');
setDmSeat(true); setRunnerLinks(() => 'none'); T.TABLE.speed = 1; T.TABLE.mode = 'auto';
const L = SLT.slotHeroes(SLT.slotted()); for (const x of L) x.hp = maxHp(x);

// the world runs in real time at 1x, as on the page
let last = Date.now(), still = false; const ticker = setInterval(() => {const n = Date.now(); if (still) {S.gameMin += (n - last) / 1000 * 6; last = n; DCALL.downCallTick(); return} for (const x of L) if (x.state !== 'dead' && x.state !== 'downed') x.hp = maxHp(x); step(Math.min(.1, (n - last) / 1000)); last = n}, 25); // the members kept whole: a death would open an arrival scene mid-test; the downed are left down, healing them fakes a revival and a new downing every blow

const server = http.createServer();
const play = attachPlay(server, {backend: localBackend(), log: () => {}});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// the mock model: 2-5 s a call (it honours the abort signal), a JSON answer for each voice's schema
const LAT = [4000, 2500, 5000, 3000, 2000, 3500]; let li = 0; const asked = [];
const adapter = {call: ({system, schema, signal}) => new Promise((res, rej) => {
  const ms = LAT[li++ % LAT.length], kind = /voicing one of its people/.test(system) ? 'talk' : /ruling on what a hero tries/.test(system) ? 'ruling' : 'table';
  asked.push({kind, ms});
  const t = setTimeout(() => {
    const p = schema.properties;
    const j = kind === 'table' ? {text: 'MOCKVOICE The hall smells of wet wool and lamp oil.', pick: p.pick.enum[p.pick.enum.length - 1]}
      : kind === 'talk' ? {text: 'MOCKVOICE Rope I have, and pork, at honest weight.', offer: 'none', about: '', region: '', warmth: '1', remember: ''}
      : {skill: 'lore', dc: 'fair', effects: [{kind: 'none', target: '', value: ''}], fail_effects: [{kind: 'none', target: '', value: ''}], text: 'MOCKVOICE The letters are older than the road.', fail_text: 'MOCKVOICE The moss hides them.', note: 'test'};
    res({text: JSON.stringify(j), usage: {in: 300, out: 30, cost: 0}})}, ms);
  if (signal) signal.addEventListener('abort', () => {clearTimeout(t); rej(Object.assign(new Error('Request was aborted.'), {name: 'AbortError'}))});
})};
const counts = {table_call: 0, npc_call: 0, ruling_call: 0}; let calls = 0;
const tool = (b, t, a) => {calls++; if (t in counts) counts[t]++; return dmTool(b, t, a)};
const lines = [], log = s => lines.push(s);
const voices = {
  table: tableVoice({base, adapter, model: 'mock', log, tool}),
  talk: talkVoice({base, adapter, model: 'mock', log, tool}),
  ruling: rulingVoice({base, adapter, model: 'mock', log, tool}),
};
const t0 = Date.now(), fill0 = (S.dmLog || []).length ? S.dmLog[0].id : 0;

// 1. idle
console.log(`idle: the three voices long-poll (wait_ms ${VOICE_WAIT_MS})`);
await sleep(IDLE_S * 1000);
for (const k of Object.keys(counts)) ok(counts[k] <= POLL_BOUND, `${k}: ${counts[k]} polls in ${IDLE_S} s idle (bound ${POLL_BOUND}; the old poller made ${Math.round(IDLE_S / (k === 'table_call' ? 2.5 : 1.5))}+)`);

// 2. session zero's frame, picked up 5 s late
console.log(`session zero: the frame picked up ${PICKUP_S} s after it was posted`);
await voices.table.stop(); setDmAlive(() => true); // a runner holds the seat but its table voice is busy elsewhere
{const L = SLT.slotHeroes(SLT.slotted()); for (const a of L) {a.x = L[0].x; a.y = L[0].y}} // session zero waits for members out of range (#771)
A_.planOpening();
let sc = null; {const w = Date.now(); while (Date.now() - w < 5000 && !(S.table && S.table.kind === 'opening' && S.table.calls && S.table.calls.length)) await sleep(25); sc = S.table}
ok(sc && sc.kind === 'opening' && sc.calls && sc.calls[0] && sc.calls[0].kind === 'frame', 'the opening scene asks for its frame');
const posted = Date.now(); await sleep(PICKUP_S * 1000);
ok(sc && sc.calls[0] && !sc.calls[0].done, `${PICKUP_S} s later the frame still waits for the DM (not picked up yet)`);
voices.table = tableVoice({base, adapter, model: 'mock', log, tool});
{const w = Date.now(); while (Date.now() - w < 20000 && sc && !sc.calls[0].done) await sleep(25)}
const fr = sc && sc.calls[0];
ok(fr && fr.done && fr.by === 'dm-agent', `the frame is the DM agent's (${fr && fr.by}), answered ${((Date.now() - posted) / 1000).toFixed(1)} s after it was posted`);
ok(L.some(a => (a.chat || []).some(e => /^MOCKVOICE The hall/.test(e.text))), 'the members hear the frame');
{const w = Date.now(); while (Date.now() - w < 60000 && S.table) await sleep(50)}
ok(!S.table, 'the opening scene ends');
setDmAlive(null);

// 3. a talk line and a free action
console.log('a member talks to a townsperson, then tries something of their own');
const a = L[0], c0 = homeOf(a), qm = S.npcs.find(p => p.town === c0.name && p.role === 'quartermaster');
for (const x of L) if (x !== a) {x.x = c0.gate.x + 14; x.y = c0.gate.y} // out of earshot, on ground that fits them: 30 tiles out one blow beat a whole health bar, downing a member every few seconds
a.state = 'town'; a.town = c0.name; a.x = qm.x + 1; a.y = qm.y; a.pq = []; a.target = null; a.dest = null; a.hidden = false; a.playRate = [];
const tr = P.playerAct(a.id, 'talk', {target: 'quartermaster', text: 'Have you rope and salt pork?'});
ok(tr.waiting, 'the line waits for the DM');
{const w = Date.now(); while (Date.now() - w < 15000 && !(a.chat || []).some(e => /^MOCKVOICE Rope/.test(e.text))) await sleep(25)}
ok((a.chat || []).some(e => /^MOCKVOICE Rope/.test(e.text) && e.by === 'dm-agent'), 'the talk voice answered as the quartermaster');
a.playRate = []; const ar = P.playerAct(a.id, 'attempt', {what: 'I read the worn letters on the milestone by touch.'});
ok(ar.ok && ar.call, 'the attempt waits for a ruling');
{const w = Date.now(); while (Date.now() - w < 15000 && S.rulings.cur.some(x => x.id === ar.call)) await sleep(25)}
ok(S.dmLog.some(e => e.detail && e.detail.ruling && e.detail.call === ar.call && e.detail.by === 'dm-agent'), 'the ruling voice ruled on it');

// 4. a downing while the table voice is thinking; the mock's 5 s and 3 s calls come next. This is about the call's clock, so the
// heroes stand still (no reflex, heal or save ends a downing unasked) while the game clock and the calls run on at 1x, in real time.
// They stay still to the end of the run: a downing after the voices stop would be nobody listening, not a late voice.
console.log('a hero goes down while the table voice is mid-call');
{const {downCallsOf} = DCALL; T.TABLE.mode = 'off'; still = true; // no rescue scene: the call is the point here
 const foe = S.mobs.find(m => m.alive), [b, c, d] = L.filter(x => x !== a && x.state !== 'dead' && x.state !== 'downed'), down0 = D.downStats().downed;
 const lay = x => {x.hp = 0; D.goDown(x, foe)};
 const calls = x => downCallsOf(x.id), picked = async x => {const w = Date.now(); while (Date.now() - w < 5000 && !calls(x).some(k => k.seen != null)) await sleep(10)}, settled = async (x, n) => {const w = Date.now(); while (Date.now() - w < 20000 && calls(x).filter(k => k.state === 'done').length < n) await sleep(25)};
 const by = x => calls(x).map(k => k.kind + ':' + k.by + (k.why ? '/' + k.why : '')).join(', ');
 li = 2; lay(b); await picked(b); await sleep(1500); const mid = calls(b)[0].state === 'wait'; lay(c);
 ok(mid && calls(c).length === 1 && calls(c)[0].state === 'wait', 'a second hero goes down 1.5 s into a 5 s model call: its call waits');
 await settled(b, 1); await settled(c, 1);
 ok(calls(b).length === 1 && calls(c).length === 1 && calls(b)[0].by === 'dm-agent' && calls(c)[0].by === 'dm-agent', `both lines are the DM's (${by(b)}; ${by(c)})`);
 ok(c.chat.some(e => /^MOCKVOICE/.test(e.text) && e.dm), 'the hero down during the call hears that line');
 li = 3; lay(d); await picked(d); await sleep(500); D.tellNear(d, 'revived'); await settled(d, 2);
 ok(calls(d).length === 2 && calls(d).every(k => k.by === 'dm-agent'), `the end coming mid-call leaves the line being written, and is voiced after it (${by(d)})`);
 ok(D.downStats().downed === down0 + 3, 'three downings, three heroes');}

// 5. no scripted fill, and the rate
for (const v of Object.values(voices)) await v.stop();
const fills = S.dmLog.filter(e => e.id > fill0 && e.detail && e.detail.fill);
if (fills.length) console.log(JSON.stringify(fills.map(e => ({t: e.t, s: e.summary, d: e.detail})), null, 1), Date.now() - t0, L.map(x => x.name + ' ' + x.state));
ok(!fills.length, `no call was filled by the scripted DM (${fills.length}${fills.length ? ': ' + fills.map(e => e.detail.call + ' ' + (e.detail.late || e.detail.why)).join(', ') : ''})`);
ok(asked.length >= 3 && asked.every(x => x.ms >= 2000 && x.ms <= 5000), `${asked.length} model calls of 2-5 s (${asked.map(x => x.kind + ' ' + x.ms / 1000).join(', ')})`);
const mins = (Date.now() - t0) / 60000, rate = calls / mins;
ok(rate < RATE_BOUND && rate < BD.FLOOD_PER_MIN, `${calls} DM calls in ${(mins * 60).toFixed(0)} s: ${rate.toFixed(1)} a minute (bound ${RATE_BOUND}; request-flood at ${BD.FLOOD_PER_MIN})`);
ok(play.stats.calls >= calls, 'the relay counted them');
if (fails) console.log(lines.join('\n'));
clearInterval(ticker); server.close();
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll voice checks passed.');
process.exit(fails ? 1 : 0);
