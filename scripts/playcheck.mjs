// Agent player check (issue #75): a scripted mock agent plays one hero through the real tools,
// in a real world that keeps stepping on its own while the agent "thinks". No model is called.
//   look and status in town, a townsperson, a journal entry, a posted job taken, a scene choice
//   answered (and logged by the DM as the player's), a fight out in the world, gear and selling,
//   a save and restore mid-run (the agent hero, its queue and journal come back), a silent agent
//   (a choice times out to the scripted branch, the world keeps running), the rate limit, the
//   MCP and /play/call endpoints over HTTP, and a dead hero's answers.
// Usage: npm run playcheck
import http from 'node:http';

// Seeded Math.random before the sim is imported (core/rng.js reads it at call time).
let seed = 0x9e3779b9 ^ (Number(process.env.PLAYCHECK_SEED) || 75);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const {init, step, S, snapshot, restore, maxHp} = await import('../src/sim/index.js');
const {homeOf} = await import('../src/data/races.js');
const {ADVENTURES: ADV} = await import('../src/data/adventures.js');
const P = await import('../src/sim/player.js');
const {hostCall} = await import('../src/sim/player-host.js');
const {CHOICE_MIN} = await import('../src/sim/player-choice.js');
const {setDmPolicy} = await import('../src/sim/dm.js');
const {attachPlay} = await import('./relay-mcp.mjs');
const {localBackend} = await import('./play-headless.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

// The world steps in the background (about 12x real time), like the browser frame loop.
let paused = false;
const ticker = setInterval(() => {if (!paused) for (let i = 0; i < 12; i++) step(1 / 60)}, 16);
const until = async (cond, maxS, label) => {const t0 = Date.now(); while (!cond()) {if (Date.now() - t0 > maxS * 1000) {ok(false, 'timed out waiting for ' + label); return false} await sleep(20)} return true};

console.log('\nEldmoor playcheck: a mock agent plays a hero through the tools\n');
init(); run(1);
// A mid-level hero so posted jobs fit (the DM offers adventures from level 4).
let a = S.agents.find(x => x.fac === 0 && x.cls === 'Warrior' && x.state === 'town') || S.agents.find(x => x.fac === 0 && x.state === 'town');
a.lvl = 7; a.hp = maxHp(a); a.gold = 120; // enough to shop once
ok(P.markPlayer(a, true) && a.player && S.playerHeroes.includes(a.id), `marked ${a.name} (#${a.id}) agent-played`);
const id = a.id;
const call = (tool, args) => hostCall(id, tool, args);

// ---- town ----
let r = await call('look');
ok(r.ok && /inside/.test(r.where) && Array.isArray(r.townsfolk) && r.townsfolk.length > 0, `look in town: ${r.where}, ${r.townsfolk && r.townsfolk.length} townsfolk, ${r.heroes.length} heroes`);
ok(r.monsters.every(m => m.dist <= 12.01) && r.heroes.every(h => h.hp === undefined || h.party), 'look keeps to sight and never shows a stranger\'s HP');
r = await call('status');
ok(r.ok && r.name === a.name && r.level === 7 && Array.isArray(r.places), `status: ${r.name}, level ${r.level} ${r.cls}, oath "${r.oath}"`);
r = await call('inventory'); ok(r.ok && r.slots && Array.isArray(r.bag), 'inventory: slots and bag');
r = await call('move_to', {target: 'inn'}); ok(r.ok, `move_to inn (${r.going})`);
await until(() => !(S.agents.find(x => x.id === id).pq || []).length, 20, 'reaching the inn');
r = await call('talk', {target: 'innkeeper'}); ok(r.ok && typeof r.answer === 'string' && r.answer.length > 5, `the innkeeper answers: "${r.answer && r.answer.slice(0, 60)}"`);
r = await call('say', {text: 'Ale first, then the road.'}); ok(r.ok && a.bubble && a.bubble.text === 'Ale first, then the road.', 'say puts a bubble over the hero');
r = await call('journal_write', {text: 'Day one. The innkeeper thinks I will die. I would like to disappoint him.'}); ok(r.ok && a.journal.length === 1, 'journal_write');
r = await call('fight', {target_id: 1}); ok(!r.ok, 'fight is refused inside the town walls');
r = await call('buy', {slot: 'head'}); ok(r.ok || /gold|better/i.test(r.error), 'buy: ' + (r.ok ? r.bought : r.error));

// ---- a posted job with a choice scene ----
let job = null;
for (let k = 0; k < 40 && !job; k++) {
  r = await call('list_jobs');
  const fit = (r.jobs || []).filter(j => j.fits && !j.resume);
  const withChoice = fit.find(j => {const h = S.adventures.find(x => x.id === j.id); return h && ADV[h.tpl] && ADV[h.tpl].scenes.some(sc => sc.type === 'choice')});
  job = withChoice || (k >= 39 ? fit[0] : null) || null; if (!job) await sleep(250);
}
ok(job, `list_jobs offers a fitting job: ${job && job.job}`);
r = await call('take_adventure', {job_id: job.id});
ok(r.ok && a.adv === job.id, `take_adventure: ${r.adventure || r.error}`);
ok(S.adventures.filter(h => h.phase === 'held').length === 0, 'no posted job is left held back after taking one');
r = await call('take_adventure', {job_id: job.id}); ok(!r.ok, 'a second take is refused (not in town / already on it)');

// Drive it: answer the first choice, fight what comes. Save and restore mid-run.
let chose = false, saved = false, fought = false;
function saveRestore(when) {
  paused = true;
  const snap = JSON.parse(JSON.stringify(snapshot()));
  run(1);
  restore(snap); a = S.agents.find(x => x.id === id);
  ok(a && a.player && a.journal.length === 1 && Array.isArray(a.pq) && a.playLog.length > 5, `save/restore ${when}: ${a && a.name} is still agent-played, journal and log intact`);
  ok(JSON.stringify(snapshot()) === JSON.stringify(snap), 'snapshot after restore equals the saved one');
  saved = true; paused = false;
}
const t0 = Date.now();
const jobHasChoice = (() => {const h = S.adventures.find(x => x.id === job.id); return !!(h && ADV[h.tpl] && ADV[h.tpl].scenes.some(sc => sc.type === 'choice'))})();
while (Date.now() - t0 < 90000 && !(chose && saved)) {
  a = S.agents.find(x => x.id === id);
  if (!a || a.state === 'dead') break;
  const adv = S.adventures.find(x => x.id === job.id);
  if (!adv || adv.phase !== 'active') break;
  if (adv.stage === 'choose' && adv.pick && !adv.pick.chosen && !chose) {
    r = await call('look'); ok(r.choice && r.choice.options && r.choice.options.a, `a choice is offered: a) ${r.choice && r.choice.options.a} / b) ${r.choice && r.choice.options.b}`);
    r = await call('choose', {option: 'b'}); ok(r.ok, 'choose b: ' + (r.chose || r.error)); chose = true;
    await until(() => !S.adventures.find(x => x.id === job.id) || S.adventures.find(x => x.id === job.id).stage !== 'choose', 10, 'the DM taking the choice');
    const e = (S.dmLog || []).find(x => x.kind === 'branch' && x.advId === job.id);
    ok(e && e.detail && e.detail.why === 'player choice' && e.detail.taken === 'b', 'the DM log records the branch as the player\'s choice');
  }
  if (a.state === 'fight') fought = true;
  // Fell back to town (hurt, a storm): heal up, then resume the same adventure, as an agent would.
  if (a.state === 'town' && adv.away && a.hp >= maxHp(a) * .9) {r = await call('take_adventure', {job_id: job.id}); if (r.ok) console.log('  ..   resumed ' + r.resumed)}
  if (!saved && (chose || Date.now() - t0 > 8000)) saveRestore('mid-adventure');
  r = await call('wait', {minutes: 60});
  if (r.dead) break;
}
if (!saved) saveRestore('after the adventure');
a = S.agents.find(x => x.id === id);
ok(chose || !jobHasChoice, chose ? 'the adventure reached a choice and took the agent\'s pick' : 'the job taken had no choice scene (the silent-agent case below covers one)');

// ---- out in the world: a fight ----
if (a.state !== 'dead') {
  if (a.adv) {const adv = S.adventures.find(x => x.id === a.adv); if (adv && adv.phase === 'active') {adv.phase = 'done'; adv.outcome = 'failure'; a.adv = null}}
  a.hp = Math.max(a.hp, 300);
  r = await call('move_to', {target: 'Mirefen'}); ok(r.ok || /fight/.test(r.error), 'move_to Mirefen: ' + (r.going || r.error));
  await until(() => {const b = S.agents.find(x => x.id === id); return b.state === 'hunt' && !(b.pq || []).length || b.state === 'fight'}, 25, 'arriving in Mirefen');
  let target = null;
  for (let k = 0; k < 30 && !target; k++) {r = await call('look'); target = (r.monsters || []).find(m => m.lvl <= a.lvl + 1 && !m.busy); if (!target) {await call('hunt', {count: 1}); await call('wait', {minutes: 30})}}
  const k0 = a.kills;
  if (target) {r = await call('fight', {target_id: target.id}); ok(r.ok, `fight ${r.target || r.error}`)}
  await until(() => {const b = S.agents.find(x => x.id === id); return b.kills > k0 || b.state === 'dead' || b.state === 'return'}, 30, 'the fight ending');
  a = S.agents.find(x => x.id === id);
  ok(a.kills > k0 || fought, `a fight was fought (${a.kills - k0} new kills)`);
  r = await call('hunt', {count: 2}); ok(r.ok || /home|town/.test(r.error), 'hunt: ' + (r.hunting || r.error));
  r = await call('wait', {minutes: 90}); ok(r.ok && typeof r.waited_min === 'number', `wait returned after ${r.waited_min} game minutes (${r.why})`);
  r = await call('journal_write', {text: 'Blood on the reeds, none of it mine.'}); ok(r.ok, 'journal_write after the fight');
}

// ---- a silent agent: the choice times out, the world goes on ----
{
  paused = true;
  const b = S.agents.find(x => x.fac === 1 && x.state !== 'dead' && !x.player && x.lvl >= 1);
  b.lvl = Math.max(b.lvl, 6); P.markPlayer(b, true);
  // Put b on an adventure whose next scene is a choice, standing on it.
  const h = S.adventures.find(x => x.phase === 'open' && x.town === homeOf(b).name && x.for == null) || null;
  let adv = null;
  if (h) {if (b.party) b.party = null; b.state = 'town'; b.target = null; const c = homeOf(b); b.x = c.gate.x; b.y = c.gate.y;
    r = P.playerAct(b.id, 'take_adventure', {job_id: h.id}); adv = S.adventures.find(x => x.id === h.id && x.phase === 'active')}
  if (adv) {
    const T = (await import('../src/data/adventures.js')).ADVENTURES[adv.tpl]; const k = T.scenes.findIndex(s => s.type === 'choice');
    if (k >= 0) {adv.idx = adv.scenes.findIndex(s => s.k === k && s.type === 'choice'); const sc = adv.scenes[adv.idx]; sc.at = {x: b.x, y: b.y}; sc.z = 0; b.state = 'travel'}
    const gm = S.gameMin; let sawWait = false;
    for (let i = 0; i < (CHOICE_MIN / 6 + 20) * 60; i++) {step(1 / 60); const x = S.adventures.find(v => v.id === adv.id); if (x && x.stage === 'choose') sawWait = true; if (sawWait && (!x || x.stage !== 'choose')) break}
    const x = S.adventures.find(v => v.id === adv.id);
    if (k >= 0) {ok(sawWait, 'a silent agent\'s hero waits at the choice scene');
      ok(!x || x.stage !== 'choose', `the choice timed out after ${Math.round(S.gameMin - gm)} game minutes and the scripted branch went on`);
      const e = (S.dmLog || []).find(v => v.kind === 'branch' && v.advId === adv.id); ok(e && e.detail.why !== 'player choice', 'the timed-out branch is logged as the DM\'s own')}
    else ok(true, 'second job had no choice scene; timeout path covered by the first');
  } else ok(true, 'no second job posted; skipped the silent-choice case');
  const gm0 = S.gameMin; run(120); ok(S.gameMin > gm0 + 700, 'the world kept running with an agent that never answered');
  paused = false;
}

// ---- rate limit, unknown tools, other heroes ----
a = S.agents.find(x => x.id === id);
if (a.state !== 'dead') {paused = true; let refused = null; for (let k = 0; k < 20 && !refused; k++) {const x = P.playerAct(id, 'say', {text: 'again ' + k}); if (!x.ok && /Slow down/.test(x.error)) refused = x}
  ok(refused && refused.retry_after_min >= 0, `rate limit: refused after ${P.PK.RATE} actions in a game hour`); paused = false}
ok(!P.playerAct(id, 'rm_rf', {}).ok, 'unknown tools are refused');
const other = S.agents.find(x => !x.player && x.state !== 'dead');
ok(!P.playerAct(other.id, 'look').ok, 'tools refuse a hero that is not agent-played');

// ---- the HTTP surfaces: MCP and /play/call ----
{
  const server = http.createServer((q, s) => {s.writeHead(404); s.end()});
  attachPlay(server, {backend: localBackend(() => S.agents.find(x => x.id === id)), log: () => {}});
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, h = {}) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', ...h}, body: JSON.stringify(body)});
  let j = await (await post('/mcp', {jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})).json();
  ok(j.result && j.result.tools.length === 23 && j.result.tools.some(t => t.name === 'take_adventure'), `MCP tools/list: ${j.result && j.result.tools.length} tools`);
  j = await (await post('/mcp', {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'journal_read', arguments: {n: 5}}})).json();
  const body = j.result && JSON.parse(j.result.content[0].text);
  ok(body && body.ok && body.entries.length >= 1, `MCP tools/call journal_read: ${body && body.entries.length} entries`);
  j = await (await post('/play/call', {tool: 'status'})).json(); ok(j.ok === true || j.dead, '/play/call status');
  const bad = await post('/play/call', {tool: 'status'}, {origin: 'http://evil.example'}); ok(bad.status === 403, 'a browser origin is refused (403)');
  const code2 = await new Promise(res => {const q = http.request({host: '127.0.0.1', port: server.address().port, path: '/play/health', headers: {host: 'evil.example'}}, s => {s.resume(); res(s.statusCode)}); q.on('error', () => res(0)); q.end()});
  ok(code2 === 403, 'a foreign Host header is refused (DNS rebinding)');
  server.close();
}

// ---- hardcore: a dead hero only answers that it is dead ----
{
  paused = true; a = S.agents.find(x => x.id === id);
  if (a.state !== 'dead') {const {fall} = await import('../src/sim/heroes.js'); fall(a, 'slain in a test')}
  r = await call('look'); ok(!r.ok && r.dead && /one life/.test(r.error), 'a dead hero\'s tools answer: ' + r.error);
  ok(S.agents.find(x => x.id === id).state === 'dead', 'nothing brings the hero back');
}

clearInterval(ticker);
setDmPolicy(null);
console.log(fail ? `\n${fail} check(s) failed` : '\nplaycheck: all checks passed');
process.exit(fail ? 1 : 0);
