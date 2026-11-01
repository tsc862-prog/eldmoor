// Brain check (issue #40). Proves, without touching the real API, that:
//   - the relay validates, builds structured-output requests, times out and guards its origin (fake model client);
//   - a hero with a brain applies valid choices, drops invalid and late ones, and falls back
//     silently when the relay is down or killed (mock relay in this script);
//   - nothing is sent for heroes without a brain or when S.brainOn is false;
//   - waiting never changes the simulation: a run with brain heroes and a dead relay is identical,
//     state for state, to a run without brains (seeded Math.random, child processes);
//   - the Mind log (issue #61) records every request with the right outcome (applied, rejected,
//     late, offline, superseded), the exact snapshot, the relay's echo of the prompt and a
//     validated reason; the relay's verbose log writes JSON lines without secrets;
//   - say lines (issue #71) are spoken in the moment or dropped: a fresh answer is said at once
//     and applied, a stale one or one whose situation changed settles late unsaid, and with
//     aiQuietTable the table line is held back and only said when no model line came in time;
//   - town plans respect parties: an AI leader's plan sets the party zone within the weakest
//     member's legal range (else it is overruled), followers are asked only the crypt call and
//     log "follows the party", solo heroes and scripted parties are unchanged.
// Usage: npm run braincheck
// Internal: node scripts/braincheck.mjs --fp plain|brain|loud   (prints a fingerprint of a short run)
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const argFp = process.argv[2] === '--fp' ? process.argv[3] : null;

// ---- child phase: seeded run, print fingerprint ----
if (argFp) {
  let s = 12345; Math.random = () => {s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296};
  const {init, step, S, enableBrain} = await import('../src/sim/index.js');
  const B = await import('../src/sim/brain.js');
  init();
  if (argFp !== 'plain') {B.CFG.url = 'http://127.0.0.1:9/decide'; B.CFG.timeoutMs = 200; B.CFG.aiQuietTable = argFp === 'brain'; for (const a of S.agents.slice(0, 3)) enableBrain(a)}
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
const {systemFor, schemaFor, VOICE, cleanReason, REASON_MAX, promptId} = await import('../src/data/prompts.js');
let seen = null, fakeMode = 'ok';
const fakeClient = {messages: {create: async (req, opt) => {
  seen = {req, opt};
  if (fakeMode === 'slow') return new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('Request was aborted.'), {name: 'AbortError'}))));
  if (fakeMode === 'bad') return {stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 5}, content: [{type: 'text', text: JSON.stringify({choice: 'Nowhere', crypt: true})}]};
  if (fakeMode === 'refusal') return {stop_reason: 'refusal', usage: {input_tokens: 10, output_tokens: 0}, content: []};
  return {stop_reason: 'end_turn', usage: {input_tokens: 500, output_tokens: 20}, content: [{type: 'text', text: JSON.stringify(req.output_config.format.schema.properties.crypt ? {choice: 'Mirefen', crypt: true, reason: 'The fen\nsuits my blade.'} : {line: 'Steel and patience.'})}]};
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
ok(seen.req.max_tokens <= 150 && seen.opt.maxRetries === 0 && seen.opt.timeout <= TIMEOUT_MS, 'small max_tokens (' + seen.req.max_tokens + '), no retries, hard timeout');
ok(j.reason === 'The fen suits my blade.', 'reason returned, cleaned to one line');
ok(seen.req.output_config.format.schema.required.includes('reason') && schemaFor('fightOrFlee', ['fight', 'flee']).properties.reason.type === 'string' && !schemaFor('say').properties.reason, 'reason is in the townPlan and fightOrFlee schemas, not in say');
ok(/one plain sentence/.test(systemFor('townPlan', 0)) && /one plain sentence/.test(systemFor('fightOrFlee', 1)) && !/reason/.test(systemFor('say', 0)), 'prompts ask for the reason in the hero\'s voice');
ok(j.sent && j.sent.id === promptId('townPlan') && j.sent.system === seen.req.system && j.sent.user === JSON.stringify(town.snapshot) && seen.req.messages[0].content === j.sent.user, 'reply echoes the exact system prompt and user content (' + j.sent.id + ')');
ok(j.usage && j.usage.in === 500 && j.usage.out === 20, 'reply carries token usage');
ok(cleanReason('x'.repeat(300)).length === REASON_MAX && cleanReason(42) === null && cleanReason('  ') === null && cleanReason('a<b>\tc') === 'a b c', 'cleanReason: truncates, drops non-strings and blanks, strips markup and control characters');
ok(seen.req.system.includes(VOICE[1]) && !seen.req.system.includes(VOICE[0]), 'Warband voice picked from the faction name');
// Fellowship writing kinds (#68): persona and backstory go to the Sonnet tier with between_tools thinking and the
// server-side refusal fallback (beta namespace); memory stays on the default tier; replies are validated per field.
{
  let w = null;
  const wFields = sch => {const o = {}; for (const k in sch.properties) {const pr = sch.properties[k]; o[k] = pr.enum ? pr.enum[0] : pr.type === 'object' ? Object.fromEntries(Object.keys(pr.properties).map(id => [id, 'Trusts them.\nMostly.'])) : 'Text for ' + k + '.'} return o};
  const reply = req => ({stop_reason: 'end_turn', model: req.model, usage: {input_tokens: 900, output_tokens: 400}, content: [{type: 'text', text: JSON.stringify(wFields(req.output_config.format.schema))}]});
  const wClient = {messages: {create: async (req, opt) => {w = {req, opt, beta: false}; return reply(req)}}, beta: {messages: {create: async (req, opt) => {w = {req, opt, beta: true}; return reply(req)}}}};
  const wr = createRelay({client: wClient, log: () => {}});
  await new Promise(r => wr.server.listen(0, '127.0.0.1', r));
  const wpost = body => fetch('http://127.0.0.1:' + wr.server.address().port + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(r => r.json());
  const comps = [{id: 7, name: 'Pellora'}, {id: 9, name: 'Garion'}];
  let k = await wpost({kind: 'persona', snapshot: {fac: 'Concord', name: 'Alwyn', companions: comps}});
  ok(w.beta && w.req.model === 'claude-sonnet-5-5' && w.req.thinking.type === 'between_tools' && w.req.fallbacks === 'default' && w.req.betas.includes('server-side-fallback-2026-07-01') && w.opt.timeout >= 30000, 'persona: Sonnet 5.5, between_tools, server-side fallback, long timeout');
  ok(k.voice && k.stances && k.stances['7'] === 'Trusts them. Mostly.' && Object.keys(w.req.output_config.format.schema.properties.stances.properties).join() === '7,9' && k.model === 'claude-sonnet-5-5', 'persona: stances keyed by the companions the sim sent, cleaned to one line');
  k = await wpost({kind: 'backstory', snapshot: {fac: 'Concord', name: 'Alwyn', companions: comps}});
  ok(k.family && k.joined && k.summary && k.link_id === 7 && k.link_kind === 'debt' && JSON.stringify(w.req.output_config.format.schema.properties.link_hero.enum) === '["Pellora","Garion"]', 'backstory: six paragraphs, summary and a link to a real companion');
  k = await wpost({kind: 'memory', snapshot: {name: 'Alwyn', long: '', items: ['D2 08:00: Reached level 5.']}});
  ok(!w.beta && w.req.model === DEFAULT_MODEL && w.req.thinking.type === 'disabled' && typeof k.long === 'string', 'memory: default tier, plain request');
  const {checkWriting} = await import('./relay.mjs');
  let threw = 0; try {checkWriting('backstory', {...wFields(schemaFor('backstory', null, {companions: comps})), link_hero: 'Nobody'}, {companions: comps})} catch {threw++}
  try {checkWriting('persona', {voice: 'x'}, {companions: comps})} catch {threw++}
  ok(threw === 2, 'writing replies with a missing field or an unknown companion are rejected');
  ok(checkRequest({kind: 'persona', snapshot: {companions: 'x'}}) === 'bad companions', 'relay refuses malformed companions');
  wr.server.close();
}
ok(systemFor('say', 0).includes(VOICE[0]) && /one life/i.test(systemFor('townPlan', 0)), 'prompts carry voice and hardcore rules');
ok(lines.some(l => /in=500 out=20 \$0\.00006/.test(l)), 'usage and cost logged: ' + (lines[0] || '').replace('[relay] ', ''));
r = await fetch(base + '/decide', {method: 'OPTIONS', headers: {origin: DEV_ORIGIN}});
ok(r.status === 204 && r.headers.get('access-control-allow-origin') === DEV_ORIGIN, 'preflight allowed for the dev origin');
r = await post(town, 'http://evil.example');
ok(r.status === 403 && !r.headers.get('access-control-allow-origin'), 'other origins refused');
fakeMode = 'bad'; r = await post(town); j = await r.json(); ok(r.status === 502 && j.error && j.sent && j.sent.user === JSON.stringify(town.snapshot), 'model choice outside the options -> error, still echoing the prompt');
fakeMode = 'refusal'; r = await post(town); ok(r.status === 502, 'refusal -> error');
fakeMode = 'slow'; const t0 = Date.now(); r = await post(town); ok(r.status === 504 && Date.now() - t0 < 1500, 'slow model aborted -> 504 within the budget');
fakeMode = 'ok';
r = await post({kind: 'nope', snapshot: {}}); ok(r.status === 400, 'unknown kind -> 400');
r = await post({kind: 'townPlan', snapshot: {options: []}}); ok(r.status === 400, 'empty options -> 400');
r = await post({kind: 'say', snapshot: {fac: 'Concord', name: 'T', trigger: 'kill', ctx: {}}}); ok(r.status === 200 && (await r.json()).line === 'Steel and patience.', 'say returns {line}');
ok(checkReply('fightOrFlee', ['fight', 'flee'], '{"choice":"flee","line":"Back!"}').choice === 'flee', 'checkReply parses fightOrFlee');
ok(checkRequest({kind: 'say', snapshot: {}}) === null && Math.abs(costOf('claude-haiku-5-5', 1e6, 1e6) - 0.6) < 1e-9, 'checkRequest / costOf');
await new Promise(r => relay.server.close(r));
{ // verbose log
  const file = join(mkdtempSync(join(tmpdir(), 'eldmoor-relay-')), 'logs', 'relay.jsonl');
  const v = createRelay({client: fakeClient, timeoutMs: 120, log: () => {}, verbose: file});
  await new Promise(r => v.server.listen(0, '127.0.0.1', r));
  const vb = `http://127.0.0.1:${v.server.address().port}/decide`;
  await fetch(vb, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(town)});
  fakeMode = 'bad'; await fetch(vb, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(town)}); fakeMode = 'ok';
  await new Promise(r => v.server.close(r));
  const recs = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  const keys = recs[0] ? Object.keys(recs[0]).join(',') : '';
  ok(recs.length === 2 && ['ts', 'kind', 'hero', 'system', 'user', 'response', 'usage', 'ms'].every(k => k in recs[0]) && recs[0].hero === 'Test' && recs[0].user === JSON.stringify(town.snapshot), 'verbose: one JSON line per call (' + keys + ')');
  ok(recs[1] && /not in options/.test(recs[1].error) && recs[1].response.includes('Nowhere'), 'verbose: failed calls are logged with the raw reply and the error');
  ok(!/api[-_]?key|x-api-key|authorization|sk-ant/i.test(readFileSync(file, 'utf8')), 'verbose: no key or headers in the log');
}

// ======== 2. the sim with a mock relay ========
const {init, step, S, enableBrain, disableBrain, brainStatus, onLog} = await import('../src/sim/index.js');
const B = await import('../src/sim/brain.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {maxHp} = await import('../src/sim/index.js');
const {setDmPolicy} = await import('../src/sim/dm.js');
init();
// The DM (sim/dm.js) may send heroes off on adventures at the gate, which would overrule their
// town plans at random. These checks are about the brain, so no hero takes a job here (a policy
// answer of null means "no hook"); the job overrule itself is checked directly in 2c.
setDmPolicy({pickHook: () => null});
let quietLines = 0; onLog(e => {if (e.parts.some(p => p && typeof p.t === 'string' && p.t.includes('thoughts go quiet')))quietLines++});

let mode = 'valid', delay = 0, status = 200; const got = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const q = JSON.parse(b); got.push(q);
    const reply = () => {
      let out;
      if (mode === 'valid') out = q.kind === 'townPlan' ? {choice: q.snapshot.options[0], crypt: false, reason: 'Fog on the fen; no sense dying blind.'} : q.kind === 'fightOrFlee' ? {choice: 'flee', line: 'Back!', reason: 'Too strong for me today. '.repeat(20)} : {line: 'Steel and patience.'};
      else if (mode === 'invalid') out = q.kind === 'townPlan' ? {choice: 'Nowhere', crypt: 'yes', reason: 42} : q.kind === 'fightOrFlee' ? {choice: 'dance'} : {line: 'As an AI language model I decline.'};
      else out = {choice: q.snapshot.options && q.snapshot.options[0], crypt: true, line: 'late'};
      out.sent = {id: q.kind + '@2', system: 'SYSTEM for ' + q.kind, user: JSON.stringify(q.snapshot)}; out.usage = {in: 800, out: 30};
      res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(status === 200 ? out : {error: 'model refused', sent: out.sent}));
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
const reset = () => {B.resetBrain(); for (const h of heroes) {delete h.brainPlan; delete h.mind; h.brain = true}};
const minds = () => heroes.flatMap(h => h.mind || []);
const isPlain = v => {try {return JSON.stringify(JSON.parse(JSON.stringify(v))) === JSON.stringify(v)} catch {return false}};

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
{
  const tp = minds().find(e => e.kind === 'townPlan' && e.outcome === 'applied');
  ok(tp && tp.choice === tp.options[0] && tp.reason === 'Fog on the fen; no sense dying blind.' && tp.scripted === tp.options[1], 'mind: townPlan applied, with the reason and the scripted zone it overrode');
  ok(tp && got.some(q => q.kind === 'townPlan' && JSON.stringify(q.snapshot) === JSON.stringify(tp.snapshot)) && tp.sent.userSame && B.mindUser(tp) === JSON.stringify(tp.snapshot) && tp.sent.system === 'SYSTEM for townPlan', 'mind: the exact snapshot sent and the relay echo are kept (user content deduplicated)');
  ok(tp && typeof tp.ms === 'number' && tp.ms >= 0 && tp.usage.in === 800 && /^D\d+ \d\d:\d\d$/.test(tp.t) && typeof tp.gameMin === 'number' && JSON.stringify(tp.options) === JSON.stringify(tp.snapshot.options), 'mind: latency, usage, time stamp and options recorded (' + (tp && tp.t) + ', ' + (tp && tp.ms) + ' ms)');
  const sy = minds().find(e => e.kind === 'say' && e.outcome === 'applied');
  ok(sy && sy.line === 'Steel and patience.' && sy.reason === null && sy.trigger, 'mind: spoken say line is applied, no reason needed (' + (sy && sy.trigger) + ')');
  ok(heroes.every(h => !h.mind || (h.mind.length <= B.MIND_MAX && h.mind.every((e, i) => !i || e.id < h.mind[i - 1].id))) && minds().every(isPlain), 'mind: newest first, capped at ' + B.MIND_MAX + ', plain JSON');
}
// crypt refusal is honoured
const h0 = heroes[0]; h0.brain = true; h0.brainPlan = {town: {choice: 'Thornvale', crypt: false, t: B.brainClock()}};
ok(B.brainOk(h0, 'crypt') === false && B.brainOk({}, 'crypt') === true, 'crypt call declined by plan; scripted heroes always accept');
// fight bail-out at 50% HP
{
  // the narrator's flee and scout rolls can end a fight on its own; retry on another mob if one did
  const h = heroes[0];
  for (let tries = 0, done = false; tries < 5 && !done; tries++) {
    reset(); mode = 'valid';
    const m = S.mobs.filter(x => x.alive)[tries];
    m.lvl = h.lvl + 2; h.x = m.x; h.y = m.y; h.state = 'fight'; h.target = m; h.hp = maxHp(h) * .4; h.cd = 99; m.cd = 99;
    rebuild(); step(1 / 60); for (let i = 0; i < 40 && !(h.brainPlan && h.brainPlan.fight) && h.state === 'fight'; i++) await sleep(15); step(1 / 60);
    done = B.stats.applied.fightOrFlee === 1;
  }
  ok(B.stats.sent >= 1 && B.stats.applied.fightOrFlee === 1 && h.state === 'return', 'fightOrFlee: model said flee at <50% HP, hero fled (state ' + h.state + ', sent ' + B.stats.sent + ', applied ' + B.stats.applied.fightOrFlee + ', mind ' + JSON.stringify((h.mind||[]).map(e=>[e.kind,e.outcome,e.error])) + ')');
  const fe = (h.mind || []).find(e => e.kind === 'fightOrFlee');
  ok(fe && fe.outcome === 'applied' && fe.choice === 'flee' && fe.scripted === 'fight' && fe.line === 'Back!', 'mind: fightOrFlee applied, scripted "fight" noted as overridden');
  ok(fe && fe.reason && fe.reason.length <= REASON_MAX && fe.reason.startsWith('Too strong for me today.'), 'mind: an over-long reason is truncated to ' + REASON_MAX + ' chars (' + (fe && fe.reason.length) + ')');
}
{ // late: the hero leaves town before the answer comes
  reset(); mode = 'valid'; delay = 150;
  const h = heroes[1]; h.state = 'town'; h.townStep = 0; h.hp = maxHp(h);
  B.brainTick(1.01);
  const e = h.mind && h.mind[0];
  ok(e && e.kind === 'townPlan' && e.outcome === 'pending', 'mind: a request opens a pending entry');
  const z = B.townZone(h);
  await sleep(400);
  ok(e.outcome === 'late' && z === B.SCRIPTED.townPlan(h).zone && e.scripted === e.options[1] && e.choice === e.options[0] && e.reason && !(h.brainPlan && h.brainPlan.town), 'mind: answer after the gate -> late, recorded but not parked, scripted zone taken (' + e.scripted + ')');
  delay = 0;
}
{ // superseded: a parked plan expires unused and a newer one replaces it
  reset(); mode = 'valid';
  const h = heroes[1]; h.state = 'town'; h.townStep = 0;
  B.brainTick(1.01); await sleep(150);
  const e = h.mind[0];
  ok(e.outcome === 'pending' && h.brainPlan.town.mid === e.id, 'mind: valid answer parked, entry waits for the gate');
  h.brainPlan.town.t -= B.CFG.planTtl + 5;
  B.brainTick(1.01); await sleep(150);
  ok(e.outcome === 'superseded' && h.mind[0] !== e && h.mind[0].kind === 'townPlan', 'mind: expired plan -> superseded by the next request (' + e.error + ')');
  h.state = 'hunt';
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
await runUntil(() => B.rejections.length >= 3 && minds().some(e => e.outcome === 'rejected' && e.kind === 'townPlan'), 40);
ok(B.stats.rejected >= 3 && B.stats.applied.townPlan === 0 && B.stats.applied.say === 0, 'rejected ' + B.stats.rejected + ', applied 0 (' + B.rejections.map(x => x.kind + ':' + x.why).slice(0, 3).join(', ') + ')');
ok(heroes.every(h => !(h.brainPlan && h.brainPlan.town)), 'no plan parked from a bad answer');
{
  const rj = minds().filter(e => e.outcome === 'rejected');
  ok(rj.length >= 3 && rj.every(e => e.error) && rj.some(e => e.kind === 'townPlan' && e.error === 'not in options' && e.choice === 'Nowhere' && e.reason === null && e.scripted) && rj.every(e => e.kind !== 'say' || e.error === 'bad line'), 'mind: invalid answers -> rejected with the validation error (' + [...new Set(rj.map(e => e.kind + ':' + e.error))].join(', ') + ')');
}
{ // an answer that was legal when asked but not when applied is refused too
  const h = heroes[1]; h.brainPlan = {town: {choice: 'Hoarfell', crypt: true, t: B.brainClock()}};
  const z = B.townZone(h); ok(z === B.SCRIPTED.townPlan(h).zone, 'plan outside the legal zones -> scripted zone');
}

console.log('policy: slow relay falls back');
reset(); mode = 'valid'; delay = 900;
await runUntil(() => B.stats.timeouts >= 1 && minds().some(e => e.outcome === 'offline'), 10);
ok(B.stats.timeouts >= 1 && B.stats.applied.townPlan === 0, 'timed out after ' + B.CFG.timeoutMs + ' ms, nothing applied');
ok(heroes.some(h => brainStatus(h) === 'offline'), 'hero marked offline');
ok(minds().some(e => e.outcome === 'offline' && /timeout/.test(e.error) && e.ms >= B.CFG.timeoutMs), 'mind: timed-out request -> offline (' + (minds().find(e => e.outcome === 'offline') || {}).error + ')');
await run(600); await sleep(900);
ok(B.stats.applied.townPlan === 0 && B.stats.applied.say === 0, 'the late answers were dropped');
delay = 0;

console.log('policy: relay error');
reset(); mode = 'valid'; status = 502;
await runUntil(() => minds().some(e => e.outcome === 'offline'), 10);
{const e = minds().find(e => e.outcome === 'offline');
  ok(e && e.error === 'relay: model refused' && e.sent && e.sent.userSame && (e.kind !== 'townPlan' || e.scripted), 'mind: relay error -> offline with the relay\'s message and the prompt it sent')}
status = 200;
const keptMind = JSON.parse(JSON.stringify(minds().slice(0, B.MIND_MAX)));

console.log('policy: relay killed mid-run');
reset(); mode = 'valid';
await runUntil(() => B.stats.applied.townPlan >= 1, 20);
ok(B.stats.applied.townPlan >= 1, 'relay up: plans apply');
mock.closeAllConnections(); await new Promise(r => mock.close(r));
const before = B.stats.applied.townPlan, simT = S.gameMin; quietLines = 0;
await runUntil(() => B.stats.failures >= 1 && minds().some(e => e.outcome === 'offline' && e.error === 'relay unreachable'), 10);
ok(B.stats.failures >= 1 && heroes.some(h => brainStatus(h) === 'offline'), 'connection refused -> offline (' + B.stats.failures + ' failures)');
ok(minds().some(e => e.outcome === 'offline' && e.error === 'relay unreachable' && !e.sent), 'mind: relay unreachable -> offline, nothing echoed');
await run(3600);
ok(quietLines <= 1 + Math.floor((S.gameMin - simT) / 60), 'chronicle "thoughts go quiet" at most once per game hour (' + quietLines + ')');
ok(S.gameMin > simT + 5, 'the world kept running');
for (const h of heroes) if (h.state !== 'dead') {h.state = 'town'; h.townStep = 0; h.wait = 200} // hold them in town so there is something to ask
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
  const live = heroes.filter(h => h.state !== 'dead'), ids = live.map(h => h.id); for (const h of live) enableBrain(h);
  live[0].brainPlan = {town: {choice: 'Thornvale', crypt: false, t: B.brainClock() + 5000}}; // as if saved by a longer-running session
  live[0].mind = keptMind; const mind0 = JSON.stringify(keptMind), mid = live[0].id;
  const snap = JSON.parse(JSON.stringify(snapshot()));
  restore(snap);
  const back = ids.map(i => S.agents.find(a => a.id === i));
  ok(JSON.stringify(S.agents.find(a => a.id === mid).mind) === mind0, 'mind log survives save/load unchanged (' + (mind0.length / 1024).toFixed(1) + ' KB)');
  ok(back.every(a => a && a.brain === true) && JSON.stringify(S.brainHeroes) === JSON.stringify(ids), 'brain flags and S.brainHeroes survive save/load as plain ids');
  ok(back[0].brainPlan.town.choice === 'Thornvale' && B.brainOk(back[0], 'crypt') === true && B.townZone(back[0]) === B.SCRIPTED.townPlan(back[0]).zone, 'plan data survives; a plan stamped after the (restarted) clock is ignored');
  for (const h of back) disableBrain(h);
}

// ======== 2b. say in the moment or not at all (issue #71) ========
console.log('say: in the moment or dropped');
{
  const {say, spotMob, COOL} = await import('../src/sim/chat.js');
  let answers = [];
  B.setFetch(() => new Promise(res => answers.push(line => res(line == null ? {ok: false, json: async () => ({error: 'model refused'})} : {ok: true, json: async () => ({line, usage: {in: 800, out: 12}})}))));
  const cfg0 = {...B.CFG}; B.CFG.timeoutMs = 5000;
  const h = S.agents.find(a => a.kind === 'hero' && a.state !== 'dead' && !a.hidden);
  const mob = S.mobs.find(m => m.alive);
  const prep = (quiet, brain = true) => {B.resetBrain(); B.CFG.aiQuietTable = quiet; answers = []; delete h.mind; h.chat = []; h.chatCd = 0; h.bubble = null; h.spotTgt = null;
    h.state = 'hunt'; h.target = null; h.hidden = false; if (brain) enableBrain(h); else disableBrain(h)};
  const answer = async (line, i = 0) => {answers[i](line); await sleep(10)};
  const aiLines = () => h.chat.filter(e => e.ai), table = () => h.chat.filter(e => !e.ai);
  const tick = dt => B.brainTick(dt);
  const fight = () => {mob.alive = true; mob.lvl = h.lvl + 3; h.state = 'fight'; h.target = mob};

  // fresh answer, table line already said (quiet table off)
  prep(false); say(h, 'kill', {target: 'Ser Test'});
  ok(table().length === 1 && answers.length === 1 && h.mind[0].outcome === 'pending', 'quiet off: table line said at once, model asked');
  tick(1.3); await answer('Rest now, Ser Test.'); tick(1 / 60);
  ok(aiLines().length === 1 && aiLines()[0].text === 'Rest now, Ser Test.' && h.bubble && h.bubble.text === 'Rest now, Ser Test.' && h.mind[0].outcome === 'applied' && h.mind[0].line === 'Rest now, Ser Test.', 'fresh answer is said immediately as a follow-up, marked ai, entry applied');
  ok(h.chat.length === 2 && h.chatCd === COOL, 'follow-up goes through chat like say (buffer, bubble, cool-down)');
  // stale answer
  prep(false); say(h, 'kill', {target: 'Ser Test'}); tick(B.CFG.sayFresh + .5); await answer('Too late for words.'); tick(1 / 60);
  ok(aiLines().length === 0 && h.mind[0].outcome === 'late' && h.mind[0].error === 'came after the moment passed' && h.mind[0].line === 'Too late for words.', 'stale answer settles late and is not said (' + h.mind[0].error + ')');
  // situation changed: the target died
  prep(false); fight(); spotMob(h, mob); tick(.5); mob.alive = false; await answer('This one is big.'); tick(1 / 60);
  ok(h.mind[0].trigger === 'spot' && h.mind[0].outcome === 'late' && h.mind[0].error === 'the situation changed' && aiLines().length === 0, 'spot: target died before the answer -> late, not said');
  // situation changed: the hero's state changed
  prep(false); fight(); spotMob(h, mob); tick(.5); h.state = 'return'; await answer('This one is big.'); tick(1 / 60);
  ok(h.mind[0].outcome === 'late' && h.mind[0].error === 'the situation changed' && aiLines().length === 0, 'spot: hero left the fight before the answer -> late, not said');
  // same situation: said
  prep(false); fight(); spotMob(h, mob); tick(.5); await answer('This one is big.'); tick(1 / 60);
  ok(h.mind[0].outcome === 'applied' && aiLines().length === 1, 'spot: same fight, same living target -> applied and said');
  // dead hero: dropped
  prep(false); say(h, 'kill', {target: 'X'}); h.state = 'ghost'; await answer('Words from beyond.'); tick(1 / 60);
  ok(h.mind[0].outcome === 'late' && aiLines().length === 0, 'hero no longer able to speak -> late, not said');
  // quiet table: model in time, table line never said
  prep(true); say(h, 'kill', {target: 'Ser Test'});
  ok(h.chat.length === 0 && h.chatCd === COOL && answers.length === 1, 'quiet on: table line held back while the model is asked');
  tick(1.5); await answer('Down you go.'); tick(1 / 60); tick(B.CFG.sayFresh + 1);
  ok(h.chat.length === 1 && aiLines().length === 1 && h.mind[0].outcome === 'applied', 'quiet on: model line in time -> said, table line never said');
  // quiet table: no answer in time, table line said when the window expires; the late answer is dropped
  prep(true); say(h, 'kill', {target: 'Ser Test'}); tick(B.CFG.sayFresh - .5);
  ok(h.chat.length === 0, 'quiet on: nothing said inside the window');
  tick(.6); ok(table().length === 1 && aiLines().length === 0, 'quiet on: window expired -> table line said');
  await answer('Down you go.'); tick(1 / 60);
  ok(h.chat.length === 1 && h.mind[0].outcome === 'late', 'quiet on: the late model line settles late, not said');
  // quiet table: relay error inside the window releases the table line at once
  prep(true); say(h, 'kill', {target: 'Ser Test'}); tick(.5); await answer(null); tick(1 / 60);
  ok(table().length === 1 && h.mind[0].outcome === 'offline', 'quiet on: failed request -> table line said without waiting out the window');
  // per-hero gap still applies: a second trigger inside sayGap sends nothing and speaks the table line
  prep(true); say(h, 'kill', {target: 'A'}); tick(1.5); await answer('One.'); tick(1 / 60); h.chatCd = 0; say(h, 'kill', {target: 'B'});
  ok(answers.length === 1 && table().length === 1 && aiLines().length === 1, 'say gap: second trigger within ' + B.CFG.sayGap + ' s is not asked, table line said at once (' + [answers.length, table().length, aiLines().length] + ')');
  // scripted hero: unchanged
  prep(true, false); say(h, 'kill', {target: 'Ser Test'}); tick(1 / 60);
  ok(table().length === 1 && answers.length === 0 && !h.mind && B.brainLine(h, 'kill', {}, 'x') === null, 'scripted hero: table line said at once, nothing asked or held');
  mob.alive = true; h.state = 'hunt'; h.target = null;
  B.setFetch(null); Object.assign(B.CFG, cfg0); B.resetBrain();
}

// ======== 2c. town plans respect parties ========
console.log('parties: the leader decides, followers follow');
{
  const {ZONES, zoneFor} = await import('../src/world/map.js');
  const {homeOf} = await import('../src/data/races.js');
  const {disband} = await import('../src/sim/party.js');
  const reqs = []; let pickLast = false;
  B.setFetch(async (url, opt) => {const q = JSON.parse(opt.body); reqs.push(q);
    const out = q.kind === 'cryptCall' ? {crypt: false, reason: 'Not into that dark.'} : {choice: q.snapshot.options[pickLast ? q.snapshot.options.length - 1 : 0], crypt: true, reason: 'Where my blade is needed.'};
    return {ok: true, json: async () => ({...out, usage: {in: 800, out: 30}})}});
  const cfg0 = {...B.CFG}; B.CFG.timeoutMs = 5000;
  for (const p of S.parties.slice()) disband(p);
  const live = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && !a.party);
  const L = live[0], F = live.find(b => b !== L && b.fac === L.fac && homeOf(b) === homeOf(L)) || live.find(b => b !== L);
  const fresh = (a, lvl, brain) => {a.lvl = lvl; a.hp = maxHp(a); a.state = 'town'; a.townStep = 0; a.wait = 200; a.party = null; delete a.mind; delete a.brainPlan; delete a.mindSeq;
    if (brain) enableBrain(a); else disableBrain(a)};
  const form = () => {const p = {id: ++S.uid, fac: L.fac, leader: L, mem: [L, F], zone: zoneFor(Math.min(L.lvl, F.lvl), homeOf(L).gate), home: false};
    L.party = F.party = p; S.parties.push(p); return p};
  const begin = (lL, lF, bL, bF) => {B.resetBrain(); S.brainHeroes = []; reqs.length = 0; pickLast = false; fresh(L, lL, bL); fresh(F, lF, bF)};
  const settleAsks = async () => {B.brainTick(1.01); await sleep(30)};

  // 1. leader's choice sets the party zone; follower asks only the crypt call and follows
  begin(9, 8, true, true); let p = form(); const scripted = p.zone;
  await settleAsks();
  const qL = reqs.find(q => q.snapshot.name === L.name), qF = reqs.find(q => q.snapshot.name === F.name);
  ok(qL && qL.kind === 'townPlan' && qL.snapshot.leadParty === true && JSON.stringify(qL.snapshot.options) === JSON.stringify(B.partyLegal(p).map(i => ZONES[i])), 'leader is asked the zone, offered the party\'s legal zones (' + (qL && qL.snapshot.options) + ')');
  ok(qF && qF.kind === 'cryptCall' && !qF.snapshot.options && qF.snapshot.leader === L.name && !reqs.some(q => q.snapshot.name === F.name && q.kind === 'townPlan'), 'follower makes no zone call, only the crypt call (' + (qF && qF.kind) + ')');
  ok(schemaFor('cryptCall').required.join() === 'crypt,reason' && !schemaFor('cryptCall').properties.choice && checkRequest({kind: 'cryptCall', snapshot: {}}) === null && checkReply('cryptCall', null, '{"crypt":false,"reason":"No."}').crypt === false, 'cryptCall schema is {crypt, reason}; relay accepts it without options');
  const zF = B.partyZone(F), zL = B.partyZone(L);
  const eL = L.mind.find(e => e.kind === 'townPlan'), eF = F.mind.find(e => e.kind === 'cryptCall'), fo = F.mind[0];
  ok(zF === 0 && zL === 0 && p.zone === 0 && scripted !== 0, 'leader\'s choice (' + ZONES[0] + ') sets the party zone over the scripted ' + ZONES[scripted] + ', for whoever leaves first');
  ok(eL && eL.outcome === 'applied' && eL.scripted === ZONES[scripted] && B.stats.applied.townPlan === 1, 'mind: leader\'s plan applied, scripted zone recorded (' + (eL && eL.outcome) + ')');
  ok(eF && eF.outcome === 'applied' && B.brainOk(F, 'crypt') === false, 'mind: follower\'s crypt answer applied and honoured');
  ok(fo && fo.kind === 'follow' && fo.outcome === 'applied' && fo.reason === 'follows the party to ' + ZONES[0] && !fo.usage && !fo.snapshot && !L.mind.some(e => e.kind === 'follow'), 'mind: follower logs "' + (fo && fo.reason) + '" (applied, no tokens); the leader does not');
  ok(F.mind.every(e => e.outcome !== 'pending') && L.mind.every(e => e.outcome !== 'pending'), 'no entry left to expire');

  // 2. a leader's choice outside the weakest member's range is overruled
  begin(12, 9, true, false); pickLast = true;
  await settleAsks(); // asked while still solo: its own range
  p = form(); const z2 = p.zone;
  const zz = B.partyZone(F); const e2 = L.mind.find(e => e.kind === 'townPlan');
  ok(e2 && e2.choice === ZONES[B.legalZones(L).slice(-1)[0]] && !B.partyLegal(p).includes(ZONES.indexOf(e2.choice)), 'leader chose ' + (e2 && e2.choice) + ', outside ' + F.name + '\'s range');
  ok(zz === z2 && p.zone === z2 && e2.outcome === 'overruled' && e2.error.includes(F.name) && e2.scripted === ZONES[z2], 'overruled, party keeps ' + ZONES[z2] + ' (' + (e2 && e2.error) + ')');
  ok(B.rejections.some(r => /overruled/.test(r.why)) && !F.mind, 'overrule logged as a rejection; a scripted follower gets no Mind entries');

  // 3. a low-level follower (no crypt question) asks nothing at all, and still follows
  begin(7, 5, true, true); p = form(); await settleAsks();
  ok(!reqs.some(q => q.snapshot.name === F.name) && reqs.some(q => q.snapshot.name === L.name), 'follower below crypt level sends no request');
  B.partyZone(F); ok(F.mind && F.mind.length === 1 && F.mind[0].kind === 'follow', 'and logs only the follow note');

  // 4. solo behaviour unchanged
  begin(9, 8, true, false); await settleAsks();
  const qs = reqs.find(q => q.snapshot.name === L.name);
  ok(qs && qs.kind === 'townPlan' && !qs.snapshot.leadParty && JSON.stringify(qs.snapshot.options) === JSON.stringify(B.legalZones(L).map(i => ZONES[i])), 'solo hero: asked the zone over its own range');
  ok(B.partyZone(L) === 0 && L.mind[0].outcome === 'applied', 'solo hero: partyZone without a party is townZone, plan applied');

  // 5. scripted party unchanged: no brains, no flags, no entries
  begin(9, 8, false, false); p = form(); const z5 = p.zone; await settleAsks();
  ok(B.partyZone(F) === z5 && B.partyZone(L) === z5 && !p.set && !L.mind && !F.mind && !reqs.length, 'scripted party: zone untouched, nothing asked or logged');

  // 7. the DM sends the party on an adventure: the leader's plan is overruled, the follower follows the job
  {
    const src = readFileSync(fileURLToPath(new URL('../src/sim/heroes.js', import.meta.url)), 'utf8');
    const iD = src.indexOf('if(dmDepart(a,c)){brainJob(a);break}'), iP = src.indexOf('partyZone(a)');
    ok(iD > 0 && iP > iD, 'gate order: dmDepart runs before the zone pick, and a taken job calls brainJob');
    begin(9, 8, true, true); p = form(); const z7 = p.zone; await settleAsks();
    if (!S.adventures) S.adventures = [];
    S.adventures.push({id: 'braincheck-job', phase: 'active', title: 'The Drowned Bell'}); L.adv = F.adv = 'braincheck-job';
    B.brainJob(L);
    const e7 = L.mind.find(e => e.kind === 'townPlan');
    ok(e7 && e7.outcome === 'overruled' && e7.error === 'the party took a job: The Drowned Bell', 'leader took a job: plan overruled ("' + (e7 && e7.error) + '")');
    const zf = B.partyZone(F);
    ok(zf === z7 && p.zone === z7 && F.mind[0].kind === 'follow' && F.mind[0].reason === 'follows the party on The Drowned Bell' && F.mind.find(e => e.kind === 'cryptCall').outcome === 'applied', 'follower follows the job ("' + F.mind[0].reason + '"), party zone untouched');
    B.brainJob(F); // not a leader on its own, nothing pending: no change
    ok(L.mind.concat(F.mind).every(e => e.outcome !== 'pending'), 'no entry left to expire');
    S.adventures = S.adventures.filter(v => v.id !== 'braincheck-job'); L.adv = F.adv = null;
    begin(9, 8, false, false); p = form(); B.brainJob(L); ok(!p.set && !L.mind, 'scripted leader taking a job: brainJob does nothing');
  }

  // 6. a plan that really expires in town says so
  begin(9, 8, true, false); await settleAsks(); L.townStep = 2; L.brainPlan.town.t -= B.CFG.planTtl + 5; B.brainTick(1.01);
  ok(L.mind[0].outcome === 'superseded' && L.mind[0].error === 'the hero did not leave town in time', 'expired plan: superseded, "' + L.mind[0].error + '"');

  for (const a of [L, F]) {disableBrain(a); a.party = null; a.wait = 0}
  for (const p of S.parties.slice()) disband(p);
  B.setFetch(null); Object.assign(B.CFG, cfg0); B.resetBrain();
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
const pa = fp('plain'), pb = fp('plain'), br = fp('brain'), lo = fp('loud');
const noChat = s => {const o = JSON.parse(s); for (const r of o.a) r.pop(); return JSON.stringify(o)};
ok(pa && pa === pb, 'seeded plain runs are identical (harness is sound)');
ok(pa && lo === pa, 'seeded run with 3 brain heroes, a dead relay and aiQuietTable off is identical to the plain run (no RNG used, no state changed)');
ok(pa && br && noChat(br) === noChat(pa), 'with aiQuietTable on, only chat buffers differ (held table lines are said a few seconds later); gameplay is identical');

console.log(fail ? `\n${fail} FAILED` : '\nbraincheck passed');
process.exit(fail ? 1 : 0);
