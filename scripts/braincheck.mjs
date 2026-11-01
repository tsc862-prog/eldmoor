// Brain check (issue #40). Proves, without touching the real API, that:
//   - the relay validates, builds structured-output requests, times out and guards its origin (fake model client);
//   - a hero with a brain applies valid choices, drops invalid and late ones, and falls back
//     silently when the relay is down or killed (mock relay in this script);
//   - nothing is sent for heroes without a brain or when S.brainOn is false;
//   - waiting never changes the simulation: a run with brain heroes and a dead relay is identical,
//     state for state, to a run without brains (seeded Math.random, child processes).
// Usage: npm run braincheck
// Internal: node scripts/braincheck.mjs --fp plain|brain   (prints a fingerprint of a short run)
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const argFp = process.argv[2] === '--fp' ? process.argv[3] : null;

// ---- child phase: seeded run, print fingerprint ----
if (argFp) {
  let s = 12345; Math.random = () => {s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296};
  const {init, step, S, enableBrain} = await import('../src/sim/index.js');
  const B = await import('../src/sim/brain.js');
  init();
  if (argFp === 'brain') {B.CFG.url = 'http://127.0.0.1:9/decide'; B.CFG.timeoutMs = 200; for (const a of S.agents.slice(0, 3)) enableBrain(a)}
  for (let i = 0; i < 3 * 60 * 60; i++) {step(1 / 60); if (i % 900 === 0) await sleep(2)}
  await sleep(50);
  console.log(JSON.stringify({t: S.gameMin, uid: S.uid, a: S.agents.map(a => [a.id, a.state, a.lvl, a.xp, Math.round(a.x * 100), Math.round(a.y * 100), Math.round(a.hp), a.deaths, a.kills, a.gold, a.chat ? a.chat.length : 0])}));
  process.exit(0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};

// ======== 1. relay, with a fake model client ========
console.log('relay');
const {createRelay, checkReply, checkRequest, DEFAULT_MODEL, costOf, TIMEOUT_MS, DEV_ORIGIN} = await import('./relay.mjs');
const {systemFor, schemaFor, VOICE} = await import('../src/data/prompts.js');
let seen = null, fakeMode = 'ok';
const fakeClient = {messages: {create: async (req, opt) => {
  seen = {req, opt};
  if (fakeMode === 'slow') return new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('Request was aborted.'), {name: 'AbortError'}))));
  if (fakeMode === 'bad') return {stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 5}, content: [{type: 'text', text: JSON.stringify({choice: 'Nowhere', crypt: true})}]};
  if (fakeMode === 'refusal') return {stop_reason: 'refusal', usage: {input_tokens: 10, output_tokens: 0}, content: []};
  return {stop_reason: 'end_turn', usage: {input_tokens: 500, output_tokens: 20}, content: [{type: 'text', text: JSON.stringify(req.output_config.format.schema.properties.crypt ? {choice: 'Mirefen', crypt: true} : {line: 'Steel and patience.'})}]};
}}};
const lines = [];
const relay = createRelay({client: fakeClient, timeoutMs: 120, log: m => lines.push(m)});
await new Promise(r => relay.server.listen(0, '127.0.0.1', r));
const RP = relay.server.address().port, base = `http://127.0.0.1:${RP}`;
const post = (body, origin) => fetch(base + '/decide', {method: 'POST', headers: {'content-type': 'application/json', ...(origin ? {origin} : {})}, body: JSON.stringify(body)});
const town = {kind: 'townPlan', snapshot: {fac: 'Warband', name: 'Test', options: ['Thornvale', 'Mirefen']}};
let r = await post(town, DEV_ORIGIN), j = await r.json();
ok(r.status === 200 && j.choice === 'Mirefen' && j.crypt === true, 'valid townPlan returns {choice, crypt}');
ok(r.headers.get('access-control-allow-origin') === DEV_ORIGIN, 'CORS header for the dev origin');
ok(seen.req.model === DEFAULT_MODEL && DEFAULT_MODEL === 'claude-haiku-5-5', 'model is the cheap tier (' + seen.req.model + ')');
ok(JSON.stringify(seen.req.output_config.format.schema.properties.choice.enum) === '["Thornvale","Mirefen"]' && seen.req.output_config.format.type === 'json_schema', 'schema enum is the options the sim sent');
ok(seen.req.max_tokens <= 100 && seen.opt.maxRetries === 0 && seen.opt.timeout <= TIMEOUT_MS, 'small max_tokens, no retries, hard timeout');
ok(seen.req.system.includes(VOICE[1]) && !seen.req.system.includes(VOICE[0]), 'Warband voice picked from the faction name');
ok(systemFor('say', 0).includes(VOICE[0]) && /one life/i.test(systemFor('townPlan', 0)), 'prompts carry voice and hardcore rules');
ok(lines.some(l => /in=500 out=20 \$0\.00006/.test(l)), 'usage and cost logged: ' + (lines[0] || '').replace('[relay] ', ''));
r = await fetch(base + '/decide', {method: 'OPTIONS', headers: {origin: DEV_ORIGIN}});
ok(r.status === 204 && r.headers.get('access-control-allow-origin') === DEV_ORIGIN, 'preflight allowed for the dev origin');
r = await post(town, 'http://evil.example');
ok(r.status === 403 && !r.headers.get('access-control-allow-origin'), 'other origins refused');
fakeMode = 'bad'; r = await post(town); ok(r.status === 502 && (await r.json()).error, 'model choice outside the options -> error');
fakeMode = 'refusal'; r = await post(town); ok(r.status === 502, 'refusal -> error');
fakeMode = 'slow'; const t0 = Date.now(); r = await post(town); ok(r.status === 504 && Date.now() - t0 < 1500, 'slow model aborted -> 504 within the budget');
fakeMode = 'ok';
r = await post({kind: 'nope', snapshot: {}}); ok(r.status === 400, 'unknown kind -> 400');
r = await post({kind: 'townPlan', snapshot: {options: []}}); ok(r.status === 400, 'empty options -> 400');
r = await post({kind: 'say', snapshot: {fac: 'Concord', name: 'T', trigger: 'kill', ctx: {}}}); ok(r.status === 200 && (await r.json()).line === 'Steel and patience.', 'say returns {line}');
ok(checkReply('fightOrFlee', ['fight', 'flee'], '{"choice":"flee","line":"Back!"}').choice === 'flee', 'checkReply parses fightOrFlee');
ok(checkRequest({kind: 'say', snapshot: {}}) === null && Math.abs(costOf('claude-haiku-5-5', 1e6, 1e6) - 0.6) < 1e-9, 'checkRequest / costOf');
await new Promise(r => relay.server.close(r));

// ======== 2. the sim with a mock relay ========
const {init, step, S, enableBrain, disableBrain, brainStatus, onLog} = await import('../src/sim/index.js');
const B = await import('../src/sim/brain.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {maxHp} = await import('../src/sim/index.js');
init();
let quietLines = 0; onLog(e => {if (e.parts.some(p => p && typeof p.t === 'string' && p.t.includes('thoughts go quiet')))quietLines++});

let mode = 'valid', delay = 0; const got = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const q = JSON.parse(b); got.push(q);
    const reply = () => {
      let out;
      if (mode === 'valid') out = q.kind === 'townPlan' ? {choice: q.snapshot.options[0], crypt: false} : q.kind === 'fightOrFlee' ? {choice: 'flee', line: 'Back!'} : {line: 'Steel and patience.'};
      else if (mode === 'invalid') out = q.kind === 'townPlan' ? {choice: 'Nowhere', crypt: 'yes'} : q.kind === 'fightOrFlee' ? {choice: 'dance'} : {line: 'As an AI language model I decline.'};
      else out = {choice: q.snapshot.options && q.snapshot.options[0], crypt: true, line: 'late'};
      res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(out));
    };
    delay ? setTimeout(reply, delay) : reply();
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
B.CFG.url = `http://127.0.0.1:${mock.address().port}/decide`; B.CFG.timeoutMs = 300;

const heroes = [S.agents.find(a => a.fac === 0), S.agents.find(a => a.fac === 1)];
for (const h of heroes) {h.lvl = 8; h.hp = maxHp(h); enableBrain(h)}
const run = async (steps) => {for (let i = 0; i < steps; i++) {step(1 / 60); if (i % 240 === 0) await sleep(2)}};
const runUntil = async (cond, maxSimMin) => {for (let i = 0; i < maxSimMin * 60 * 60 / 240 && !cond(); i++) await run(240); await sleep(20)};
const reset = () => {B.resetBrain(); for (const h of heroes) {delete h.brainPlan; h.brain = true}};

console.log('policy: valid answers apply');
ok(brainStatus(heroes[0]) === 'on' && S.brainHeroes.length === 2, 'two heroes AI-played, flag and id list set');
let threw = null;
try {
  await runUntil(() => B.stats.applied.townPlan >= 2 && B.stats.applied.say >= 1, 40);
} catch (e) {threw = e}
ok(!threw, 'no exception while running' + (threw ? ': ' + threw.stack : ''));
ok(B.stats.applied.townPlan >= 1, 'townPlan applied (' + B.stats.applied.townPlan + ')');
ok(B.stats.lastZone && B.stats.lastZone.zone === 0, 'zone chosen by the model (Thornvale, a level-8 hero would script Mirefen)');
ok(B.stats.applied.say >= 1 && S.agents.some(a => a.chat && a.chat.some(e => e.ai && e.text === 'Steel and patience.')), 'model line spoken and marked ai:true in the chat buffer');
ok(got.filter(q => q.kind === 'townPlan').every(q => q.snapshot.options.length >= 1), 'requests carried options');
const sn = JSON.stringify(got.find(q => q.kind === 'townPlan').snapshot);
console.log('       snapshot ' + sn.length + ' chars (~' + Math.round(sn.length / 3.6) + ' tokens)');
ok(sn.length / 3.6 < 600, 'snapshot under ~600 tokens');
// crypt refusal is honoured
const h0 = heroes[0]; h0.brainPlan = {town: {choice: 'Thornvale', crypt: false, t: B.brainClock()}};
ok(B.brainOk(h0, 'crypt') === false && B.brainOk({}, 'crypt') === true, 'crypt call declined by plan; scripted heroes always accept');
// fight bail-out at 50% HP
{
  reset(); mode = 'valid';
  const h = heroes[0], m = S.mobs.find(x => x.alive);
  m.lvl = h.lvl + 2; h.x = m.x; h.y = m.y; h.state = 'fight'; h.target = m; h.hp = maxHp(h) * .4; h.cd = 99; m.cd = 99;
  rebuild(); step(1 / 60); await sleep(120); step(1 / 60);
  ok(B.stats.sent >= 1 && B.stats.applied.fightOrFlee === 1 && h.state === 'return', 'fightOrFlee: model said flee at <50% HP, hero fled (state ' + h.state + ')');
}
// information limits
{
  const h = heroes[0], e = S.agents.find(a => a.fac !== h.fac && a.state !== 'dead');
  e.x = h.x + 30; e.y = h.y; rebuild();
  ok(!JSON.stringify(B.snapshotFor(h, 'say', {trigger: 'kill'})).includes(e.name), 'enemy hero 30 tiles away is not in the snapshot');
  e.x = h.x + 3; e.y = h.y; e.state = 'hunt'; e.hidden = false; rebuild();
  ok(JSON.stringify(B.snapshotFor(h, 'say', {trigger: 'kill'})).includes(e.name), 'enemy hero 3 tiles away is');
}

console.log('policy: invalid answers are dropped');
reset(); mode = 'invalid';
await runUntil(() => B.rejections.length >= 3, 40);
ok(B.stats.rejected >= 3 && B.stats.applied.townPlan === 0 && B.stats.applied.say === 0, 'rejected ' + B.stats.rejected + ', applied 0 (' + B.rejections.map(x => x.kind + ':' + x.why).slice(0, 3).join(', ') + ')');
ok(heroes.every(h => !(h.brainPlan && h.brainPlan.town)), 'no plan parked from a bad answer');
{ // an answer that was legal when asked but not when applied is refused too
  const h = heroes[1]; h.brainPlan = {town: {choice: 'Hoarfell', crypt: true, t: B.brainClock()}};
  const z = B.townZone(h); ok(z === B.SCRIPTED.townPlan(h).zone, 'plan outside the legal zones -> scripted zone');
}

console.log('policy: slow relay falls back');
reset(); mode = 'valid'; delay = 900;
await runUntil(() => B.stats.timeouts >= 1, 10);
ok(B.stats.timeouts >= 1 && B.stats.applied.townPlan === 0, 'timed out after ' + B.CFG.timeoutMs + ' ms, nothing applied');
ok(heroes.some(h => brainStatus(h) === 'offline'), 'hero marked offline');
await run(600); await sleep(900);
ok(B.stats.applied.townPlan === 0 && B.stats.applied.say === 0, 'the late answers were dropped');
delay = 0;

console.log('policy: relay killed mid-run');
reset(); mode = 'valid';
await runUntil(() => B.stats.applied.townPlan >= 1, 20);
ok(B.stats.applied.townPlan >= 1, 'relay up: plans apply');
mock.closeAllConnections(); await new Promise(r => mock.close(r));
const before = B.stats.applied.townPlan, simT = S.gameMin; quietLines = 0;
await runUntil(() => B.stats.failures >= 1, 10);
ok(B.stats.failures >= 1 && heroes.some(h => brainStatus(h) === 'offline'), 'connection refused -> offline (' + B.stats.failures + ' failures)');
await run(3600);
ok(quietLines <= 1 + Math.floor((S.gameMin - simT) / 60), 'chronicle "thoughts go quiet" at most once per game hour (' + quietLines + ')');
ok(S.gameMin > simT + 5, 'the world kept running');
const s1 = B.stats.sent; await run(60 * 61); // offline for 60 sim seconds, then it tries again
ok(B.stats.sent > s1, 'after the 60 s quiet period the hero asks again (and falls back again)');

console.log('policy: off switches');
S.brainOn = false; reset(); const s2 = B.stats.sent; await run(60 * 30);
ok(B.stats.sent === s2, 'S.brainOn=false: nothing sent');
S.brainOn = undefined; for (const h of heroes) disableBrain(h);
await run(60 * 120);
ok(B.stats.sent === s2 && !S.brainHeroes.length && heroes.every(h => !h.brain), 'no AI heroes: nothing sent, flags cleared');
ok(!('brain' in heroes[0]) && B.townZone(heroes[0]) === B.SCRIPTED.townPlan(heroes[0]).zone && B.brainLine(heroes[0], 'kill', {}) === null, 'scripted hero: scripted zone, no model line');

console.log('save and load');
{
  const {snapshot, restore} = await import('../src/sim/index.js');
  const ids = heroes.map(h => h.id); for (const h of heroes) enableBrain(h);
  heroes[0].brainPlan = {town: {choice: 'Thornvale', crypt: false, t: B.brainClock() + 5000}}; // as if saved by a longer-running session
  const snap = JSON.parse(JSON.stringify(snapshot()));
  restore(snap);
  const back = ids.map(i => S.agents.find(a => a.id === i));
  ok(back.every(a => a && a.brain === true) && JSON.stringify(S.brainHeroes) === JSON.stringify(ids), 'brain flags and S.brainHeroes survive save/load as plain ids');
  ok(back[0].brainPlan.town.choice === 'Thornvale' && B.brainOk(back[0], 'crypt') === true && B.townZone(back[0]) === B.SCRIPTED.townPlan(back[0]).zone, 'plan data survives; a plan stamped after the (restarted) clock is ignored');
  for (const h of back) disableBrain(h);
}

// ======== 3. cost estimate from the observed rate ========
{
  const sys = ['townPlan', 'fightOrFlee', 'say'].map(k => systemFor(k, 0).length);
  const inTok = Math.round((Math.max(...sys) + 1900) / 3.6); // system + a busy snapshot (~1900 chars)
  console.log(`cost: ~${inTok} input + ~30 output tokens per decision; Haiku 5.5 $0.10 / $0.50 per 1M`);
}

// ======== 4. determinism: a dead relay changes nothing ========
console.log('determinism');
const fp = m => {const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fp', m], {encoding: 'utf8', maxBuffer: 1 << 26}); if (p.status !== 0) {console.error(p.stderr); return null} return p.stdout.trim().split('\n').pop()};
const pa = fp('plain'), pb = fp('plain'), br = fp('brain');
ok(pa && pa === pb, 'seeded plain runs are identical (harness is sound)');
ok(pa && br === pa, 'seeded run with 3 brain heroes and a dead relay is identical to the plain run (no RNG used, no state changed)');

console.log(fail ? `\n${fail} FAILED` : '\nbraincheck passed');
process.exit(fail ? 1 : 0);
