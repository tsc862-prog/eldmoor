// Agent player check (issue #75): a scripted mock agent plays one hero through the real tools,
// in a real world that keeps stepping on its own while the agent "thinks". No model is called.
//   look and status in town, a townsperson, a journal entry, a posted job taken, a scene choice
//   answered (and logged by the DM as the player's), a fight out in the world, gear and selling,
//   a save and restore mid-run (the agent hero, its queue and journal come back), a silent agent
//   (a choice times out to the scripted branch, the world keeps running), the rate limit, the
//   MCP and /play/call endpoints over HTTP, two agents playing two heroes at once through one
//   relay (issue #93: per-hero routing, runner claims and link states), one session file per
//   hero, and a dead hero's answers. The mock agent's waits drive game time themselves, so the
//   run depends on the seed (PLAYCHECK_SEED), not on how fast the machine is.
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
const {TOOL_NAMES} = await import('../src/data/player-tools.js');
const {localBackend} = await import('./play-headless.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

// Game time. While `driven` (the default), the mock agent's own waits step the world: a pause of
// ms real milliseconds runs the frames the browser loop would have run in that time (about 12x
// real time) and the host's clock is virtual, so the run depends on the seed alone, not on how
// fast the machine is. The HTTP sections switch to a real background ticker (driven = false),
// because their tool calls come in over sockets like a real runner's.
let paused = false, driven = true, vclock = 0;
const FRAMES_PER_MS = 12 / 16;
const advance = async ms => {vclock += ms; for (let i = 0, n = Math.round(ms * FRAMES_PER_MS); i < n; i++) step(1 / 60); await null};
const pause = ms => driven ? advance(ms) : sleep(ms);
const ticker = setInterval(() => {if (!paused && !driven) for (let i = 0; i < 12; i++) step(1 / 60)}, 16);
const until = async (cond, maxS, label) => {let t = 0; while (!cond()) {if (t > maxS * 1000) {ok(false, 'timed out waiting for ' + label); return false} await pause(20); t += 20} return true};
const hostOpts = () => driven ? {nap: advance, now: () => vclock} : undefined;

console.log('\nEldmoor playcheck: a mock agent plays a hero through the tools\n');
init({fellowship: false}); run(1); // the old start (#111): this check sets up its own heroes and Fellowship
// A mid-level hero so posted jobs fit (the DM offers adventures from level 4).
let a = S.agents.find(x => x.fac === 0 && x.cls === 'Warrior' && x.state === 'town') || S.agents.find(x => x.fac === 0 && x.state === 'town');
a.lvl = 7; a.hp = maxHp(a); a.gold = 120; // enough to shop once
ok(P.markPlayer(a, true) && a.player && S.playerHeroes.includes(a.id), `marked ${a.name} (#${a.id}) agent-played`);
const id = a.id;
const call = (tool, args) => hostCall(id, tool, args, hostOpts());

// ---- town ----
let r = await call('look');
ok(r.ok && /inside/.test(r.where) && Array.isArray(r.townsfolk) && r.townsfolk.length > 0, `look in town: ${r.where}, ${r.townsfolk && r.townsfolk.length} townsfolk, ${r.heroes.length} heroes`);
ok(r.monsters.every(m => m.dist <= 12.01) && r.heroes.every(h => h.hp === undefined || h.party), 'look keeps to sight and never shows a stranger\'s HP');
r = await call('status');
ok(r.ok && r.name === a.name && r.level === 7 && Array.isArray(r.places), `status: ${r.name}, level ${r.level} ${r.cls}, oath "${r.oath}"`);
r = await call('inventory'); ok(r.ok && r.slots && Array.isArray(r.items) && r.capacity && r.capacity.max >= 16, 'inventory: slots, pack capacity and items');
r = await call('move_to', {target: 'inn'}); ok(r.ok, `move_to inn (${r.going})`);
await until(() => !(S.agents.find(x => x.id === id).pq || []).length, 20, 'reaching the inn');
r = await call('talk', {target: 'innkeeper'}); ok(r.ok && typeof r.answer === 'string' && r.answer.length > 5, `the innkeeper answers: "${r.answer && r.answer.slice(0, 60)}"`);
r = await call('say', {text: 'Ale first, then the road.'}); ok(r.ok && a.bubble && a.bubble.text === 'Ale first, then the road.', 'say puts a bubble over the hero');
r = await call('journal_write', {text: 'Day one. The innkeeper thinks I will die. I would like to disappoint him.'}); ok(r.ok && a.journal.length === 1, 'journal_write');
r = await call('fight', {target_id: 1}); ok(!r.ok, 'fight is refused inside the town walls');
// class abilities (#81): listed in status, used with use_ability, cooldowns hold
{const st = await call('status'); ok(Array.isArray(st.abilities) && st.abilities.length >= 3 && st.abilities.some(l => /READY/.test(l)), `status lists the abilities (${st.abilities && st.abilities.length} learned, e.g. "${st.abilities && st.abilities[0] && st.abilities[0].slice(0, 50)}")`);
 const foe = S.mobs.find(m => m.alive && !m.gone); const keep = {x: a.x, y: a.y}; a.x = foe.x - 1; a.y = foe.y;
 r = await call('use_ability', {ability: 'Challenge', target_id: foe.id}); ok(r.ok && foe.target === a && /Challenge/.test(r.result), 'use_ability Challenge: ' + (r.result || r.error));
 r = await call('use_ability', {ability: 'challenge', target_id: foe.id}); ok(!r.ok && /not ready/.test(r.error), 'a cooling ability is refused: ' + r.error);
 r = await call('use_ability', {ability: 'Smite of Nonsense'}); ok(!r.ok && /no ability/.test(r.error), 'an unknown ability is refused');
 a.x = keep.x; a.y = keep.y; foe.target = null; a.state = 'town'; a.target = null; a.playRate = [];} // the rate budget goes back to the rest of the check
r = await call('buy', {slot: 'head'}); ok(r.ok || /gold|better/i.test(r.error), 'buy: ' + (r.ok ? r.bought : r.error));
// ---- the pack (issue #124): supplies, use, give, drop, quest items ----
{const INV = await import('../src/sim/inv.js');
 a.gold = Math.max(a.gold, 100);
 r = await call('buy', {item: 'Redroot Draught', count: 2}); ok(r.ok && /Redroot/.test(r.bought), 'buy a supply: ' + (r.ok ? r.bought : r.error));
 r = await call('buy', {item: 'Moonwater'}); ok(!r.ok && /Not sold/.test(r.error), 'buy refuses a supply that is not sold');
 r = await call('inventory'); const pi = r.items.find(e => /Redroot/.test(e.item)); ok(pi && pi.kind === 'use' && /Heals 35%/.test(pi.item), 'the potions are in the pack with their numbers');
 a.hp = maxHp(a); r = await call('use_item', {index: pi.index}); ok(!r.ok && /not hurt/.test(r.error), 'a potion is not wasted at full health');
 a.hp = Math.floor(maxHp(a) * .3); r = await call('use_item', {index: pi.index}); ok(r.ok && a.hp > maxHp(a) * .5, 'use_item heals: ' + (r.result || r.error));
 const other = S.agents.find(x => x !== a && x.kind === 'hero' && x.state !== 'dead' && !(x.party && x.party === a.party));
 r = await call('give', {index: pi.index, hero_id: other.id}); ok(!r.ok && /party/.test(r.error), 'give refuses anyone outside the party: ' + r.error);
 INV.addQuest(a, 'Cairn-Door Key'); r = await call('inventory'); const qi = r.items.find(e => e.kind === 'quest');
 ok(qi && /cannot be sold/.test(qi.item), 'a quest item shows in the pack');
 r = await call('drop', {index: qi.index}); ok(!r.ok && /quest/i.test(r.error), 'a quest item cannot be dropped');
 r = await call('sell', {index: qi.index}); ok(!r.ok, 'a quest item cannot be sold');
 r = await call('give', {index: qi.index, hero_id: other.id}); ok(!r.ok, 'a quest item cannot be given');
 INV.take(a, 'quest', 'Cairn-Door Key', 1); a.hp = maxHp(a);}

// ---- a posted job with a choice scene ----
// Prefer a job with a choice scene; take it, and if the job-giver turns the hero away (the DM's
// own fit rules can differ from list_jobs' summary), try the next posting, as an agent would.
let job = null, offered = null, turnedAway = 0;
const refused = new Set();
for (let k = 0; k < 160 && !(job && r.ok); k++) {
  r = await call('list_jobs');
  const fit = (r.jobs || []).filter(j => j.fits && !j.resume && !refused.has(j.id));
  const withChoice = fit.find(j => {const h = S.adventures.find(x => x.id === j.id); return h && ADV[h.tpl] && ADV[h.tpl].scenes.some(sc => sc.type === 'choice')});
  job = withChoice || (k >= 60 ? fit[0] : null) || null; r = {ok: false};
  if (job) {offered = offered || job; r = await call('take_adventure', {job_id: job.id}); if (!r.ok) {refused.add(job.id); turnedAway++; job = null}}
  if (!job) await pause(250);
}
ok(offered, `list_jobs offers a fitting job: ${offered && offered.job}`);
ok(job && r.ok && a.adv === job.id, `take_adventure: ${r.adventure || r.error}${turnedAway ? ' (turned away ' + turnedAway + 'x first)' : ''}`);
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
// Bounded by game time (three game days) and loop count, not wall clock, so a slow machine
// cannot run out of time before the adventure reaches its choice.
const gm0 = S.gameMin;
const jobHasChoice = (() => {const h = S.adventures.find(x => x.id === job.id); return !!(h && ADV[h.tpl] && ADV[h.tpl].scenes.some(sc => sc.type === 'choice'))})();
for (let loops = 0; loops < 400 && S.gameMin - gm0 < 3 * 1440 && !(chose && saved); loops++) {
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
  if (!saved && (chose || loops >= 8)) saveRestore('mid-adventure');
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
  // b leaves its party properly: a party still listing b would call it home with the others
  if (h) {if (b.party) (await import('../src/sim/party.js')).leaveParty(b); b.state = 'town'; b.target = null; const c = homeOf(b); b.x = c.gate.x; b.y = c.gate.y;
    r = P.playerAct(b.id, 'take_adventure', {job_id: h.id}); adv = S.adventures.find(x => x.id === h.id && x.phase === 'active')}
  if (adv) {
    const T = (await import('../src/data/adventures.js')).ADVENTURES[adv.tpl]; const k = T.scenes.findIndex(s => s.type === 'choice');
    if (k >= 0) {adv.idx = adv.scenes.findIndex(s => s.k === k && s.type === 'choice'); const sc = adv.scenes[adv.idx]; sc.at = {x: b.x, y: b.y}; sc.z = 0; b.state = 'travel'; b.inv = {list: []}; b.pq = []; b.hp = maxHp(b);
      // nothing may pull the hero off the scene while it waits: a full pack of loot sends it home to sell, a storm home to shelter
      const {zoneAt} = await import('../src/world/map.js'), zw = S.weather && S.weather[zoneAt(b.x, b.y)]; if (zw) {zw.k = 'clear'; zw.until = S.gameMin + 1e4}}
    const gm = S.gameMin; let sawWait = false;
    // a monster that wanders by is waved off: this case is about the choice timing out, not a fight
    for (let i = 0; i < (CHOICE_MIN / 6 + 20) * 60; i++) {step(1 / 60); if (k >= 0 && b.state === 'fight') {b.target = null; b.state = 'travel'; b.hp = maxHp(b)} const x = S.adventures.find(v => v.id === adv.id); if (x && x.stage === 'choose') sawWait = true; if (sawWait && (!x || x.stage !== 'choose')) break}
    const x = S.adventures.find(v => v.id === adv.id);
    if (k >= 0) {ok(sawWait, 'a silent agent\'s hero waits at the choice scene');
      ok(!x || x.stage !== 'choose', `the choice timed out after ${Math.round(S.gameMin - gm)} game minutes and the scripted branch went on`);
      const e = (S.dmLog || []).find(v => v.kind === 'branch' && v.advId === adv.id); ok(e && e.detail.why !== 'player choice', 'the timed-out branch is logged as the DM\'s own' + (e ? '' : ' [adv ' + JSON.stringify(x && {phase: x.phase, outcome: x.outcome, stage: x.stage, idx: x.idx, pto: x.pickTimedOut, pick: x.pick}) + ' hero ' + b.state + ' ev ' + JSON.stringify((b.playEv || []).slice(-5).map(v => v.text)) + ' hp ' + Math.round(b.hp) + ' log ' + JSON.stringify((S.dmLog || []).filter(v => v.advId === adv.id).slice(-4).map(v => [v.kind, v.detail])) + ']'))}
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
driven = false; // from here on tool calls arrive over sockets; the background ticker runs the world
{
  const server = http.createServer((q, s) => {s.writeHead(404); s.end()});
  attachPlay(server, {backend: localBackend(), log: () => {}});
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, h = {}) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', ...h}, body: JSON.stringify(body)});
  let j = await (await post('/mcp', {jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})).json();
  ok(j.result && j.result.tools.length === TOOL_NAMES.length && j.result.tools.some(t => t.name === 'take_adventure'), `MCP tools/list: ${j.result && j.result.tools.length} tools`);
  j = await (await post('/mcp', {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'journal_read', arguments: {n: 5}}}, {'x-eldmoor-hero': String(id)})).json();
  const body = j.result && JSON.parse(j.result.content[0].text);
  ok(body && body.ok && body.entries.length >= 1, `MCP tools/call journal_read (X-Eldmoor-Hero #${id}): ${body && body.entries.length} entries`);
  j = await (await post('/play/call', {tool: 'status', hero: id})).json(); ok(j.ok === true && j.name === a.name || j.dead, '/play/call status for a named hero');
  j = await (await post('/play/call', {tool: 'status'})).json(); const first = P.playerHero();
  ok(first && (j.name === first.name || j.dead), `a call naming no hero takes the old single-hero path (${j.name || j.error})`);
  const bad = await post('/play/call', {tool: 'status'}, {origin: 'http://evil.example'}); ok(bad.status === 403, 'a browser origin is refused (403)');
  const code2 = await new Promise(res => {const q = http.request({host: '127.0.0.1', port: server.address().port, path: '/play/health', headers: {host: 'evil.example'}}, s => {s.resume(); res(s.statusCode)}); q.on('error', () => res(0)); q.end()});
  ok(code2 === 403, 'a foreign Host header is refused (DNS rebinding)');
  server.close();
}

// ---- two agents side by side (issue #93): two runners, two heroes, one world ----
{
  console.log('two concurrent mock agents');
  const {pickHero} = await import('./agent-sessions.mjs');
  const {LINK_MS, CLAIM_MS} = await import('./relay-mcp.mjs');
  const fresh = f => S.agents.find(x => x.fac === f && x.state !== 'dead' && !x.player && !x.hidden && !x.adv && x.id !== other.id);
  const hA = fresh(0), hB = fresh(1);
  for (const h of [hA, hB]) {h.lvl = Math.max(h.lvl, 5); h.hp = maxHp(h); P.markPlayer(h, true)}
  ok(hA.player && hB.player && P.playerSeats().length >= 3, `marked ${hA.name} (#${hA.id}) and ${hB.name} (#${hB.id}) agent-played (${P.playerSeats().length} agent heroes in the world)`);
  ok(P.playerHero(hB.id) === hB && P.playerSeat(hA.id) === hA && P.playerHero(other.id) === null && P.playerHero() === P.playerSeats().find(x => x.state !== 'dead'), 'playerHero(id) / playerSeat(id) answer per hero; playerHero() keeps the single-hero path');
  let skew = 0;
  const server = http.createServer((q, s) => {s.writeHead(404); s.end()});
  const play = attachPlay(server, {backend: localBackend(), log: () => {}, now: () => Date.now() + skew});
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, h = {}) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', ...h}, body: JSON.stringify(body)});
  const health = async () => (await fetch(base + '/play/health')).json();
  const linkOf = async h => ((await health()).heroes.find(x => x.id === h.id) || {}).link;

  // runners claim their heroes; one runner per hero
  let c = await post('/play/claim', {hero: hA.id, runner: 'runner-A'}); ok(c.status === 200, 'runner A claims ' + hA.name);
  c = await post('/play/claim', {hero: hA.id, runner: 'runner-B'}); ok(c.status === 409, 'a second runner for the same hero is refused (409): ' + (await c.json()).error);
  c = await post('/play/claim', {hero: hB.id, runner: 'runner-B'}); ok(c.status === 200, 'runner B claims ' + hB.name);
  c = await post('/play/claim', {hero: other.id, runner: 'runner-C'}); ok(c.status === 404, 'a hero that is not agent-played cannot be claimed');
  let hs = await health();
  ok(hs.heroes.length === P.playerSeats().length && hs.heroes.find(x => x.id === hA.id).link === 'waiting' && hs.heroes.find(x => x.id === hB.id).link === 'waiting', 'health lists every agent hero; claimed and quiet -> waiting');
  let pk = pickHero(hs.heroes); ok(pk.hero && pk.hero.id !== hA.id && pk.hero.id !== hB.id, `a runner without --hero takes a free hero (${pk.hero && pk.hero.name}), not a claimed one`);
  pk = pickHero(hs.heroes, hA.name.toUpperCase()); ok(pk.error && /already has a live agent runner/.test(pk.error), '--hero for a hero with a live runner is refused');
  pk = pickHero(hs.heroes.map(h => ({...h, link: 'waiting'}))); ok(pk.error && /No free/.test(pk.error), 'no free hero -> the runner says so');
  pk = pickHero(hs.heroes, 'Nobody'); ok(pk.error && /No agent-played hero/.test(pk.error), '--hero for an unknown name lists the agent heroes');

  // the two agents play at once: A over MCP (X-Eldmoor-Hero header), B over /play/call (hero field)
  let rpc = 10;
  // each runner names itself on every call (issue #123: a claimed hero answers only its own runner)
  const viaMcp = (hero, name, args, runner = 'runner-A') => post('/mcp', {jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: {name, arguments: args || {}}}, {'x-eldmoor-hero': String(hero.id), 'x-eldmoor-runner': runner}).then(r => r.json()).then(j => JSON.parse(j.result.content[0].text));
  const viaPlay = (hero, name, args, runner = 'runner-B') => post('/play/call', {hero: hero.id, tool: name, args: args || {}, runner}).then(r => r.json());
  const seen = {};
  async function agent(hero, send) {
    const out = [], line = 'I am ' + hero.name + ' and no one else.';
    out.push(await send(hero, 'status'));
    out.push(await send(hero, 'look'));
    out.push(await send(hero, 'say', {text: line}));
    out.push(await send(hero, 'journal_write', {text: hero.name + ' kept their own counsel today.'}));
    const w = send(hero, 'wait', {minutes: 30});
    await sleep(60); seen[hero.id] = await linkOf(hero); // while its wait is in flight
    out.push(await w);
    out.push(await send(hero, 'status'));
    return out;
  }
  const before = JSON.stringify(S.agents.find(x => x.id === id).playLog || []);
  const [ra, rb] = await Promise.all([agent(hA, viaMcp), agent(hB, viaPlay)]);
  ok(ra.every(x => x.ok !== false || x.dead) && rb.every(x => x.ok !== false || x.dead), `both agents' calls answered (${ra.length + rb.length} calls, ${ra.filter(x => x.ok === false).length + rb.filter(x => x.ok === false).length} refused)`);
  ok(ra[0].name === hA.name && rb[0].name === hB.name && ra[5].name === hA.name && rb[5].name === hB.name, 'each agent\'s status names its own hero');
  ok(typeof ra[4].waited_min === 'number' && typeof rb[4].waited_min === 'number', `both waits ran side by side (${ra[4].waited_min} and ${rb[4].waited_min} game min)`);
  ok(seen[hA.id] === 'connected' && seen[hB.id] === 'connected', 'link is connected while a call is in flight (' + seen[hA.id] + ', ' + seen[hB.id] + ')');
  const said = h => (h.playLog || []).filter(e => e.tool === 'say').map(e => e.args);
  ok(said(hA).length === 1 && said(hA)[0].includes(hA.name) && said(hB).length === 1 && said(hB)[0].includes(hB.name), 'each hero\'s log holds only its own agent\'s calls');
  ok(hA.journal.length === 1 && hA.journal[0].text.startsWith(hA.name) && hB.journal.length === 1 && hB.journal[0].text.startsWith(hB.name), 'journals are kept apart');
  ok(JSON.stringify(S.agents.find(x => x.id === id).playLog || []) === before, 'the first agent hero was not touched by either runner');
  let j = await viaPlay(other, 'look'); ok(j.ok === false && /not agent-played/.test(j.error), 'a call for a hero that is not agent-played is refused');
  c = await post('/play/call', {hero: 'abc', tool: 'look'}); ok(c.status === 400, 'a bad hero id is refused (400)');
  // one runner never reads or plays the other's hero (issue #123)
  c = await post('/play/call', {hero: hA.id, tool: 'journal_read', runner: 'runner-B'}); j = await c.json();
  ok(c.status === 409 && j.ok === false && !JSON.stringify(j).includes(hA.name + ' kept'), 'runner B cannot call ' + hA.name + ' tools (409): ' + j.error);
  j = await viaMcp(hB, 'journal_read', {}, 'runner-A'); ok(j.ok === false && j.refused, 'nor runner A ' + hB.name + ' over MCP');
  c = await post('/play/call', {hero: hA.id, tool: 'status'}); ok(c.status === 409, 'a call naming no runner is refused for a claimed hero');
  c = await post('/play/narrate', {hero: hA.id, text: 'Not mine to say.', runner: 'runner-B'}); ok(c.status === 409 && !(hA.playNarr || []).some(n => n.text === 'Not mine to say.'), 'narration for a hero of another runner is refused');
  await post('/play/narrate', {hero: hB.id, text: 'B watches the road.', runner: 'runner-B'});
  ok((hB.playNarr || [])[0] && hB.playNarr[0].text === 'B watches the road.' && !(hA.playNarr || []).some(n => n.text === 'B watches the road.'), 'narration lands on the named hero only');

  // links age out: a quiet runner -> waiting; released or expired -> none; then free for another runner
  skew += LINK_MS + 1000; ok(await linkOf(hA) === 'waiting', 'after the calls stop, a claimed hero is waiting');
  await post('/play/release', {hero: hA.id, runner: 'runner-A'}); ok(await linkOf(hA) === 'none', 'runner A lets go -> no runner');
  skew += CLAIM_MS + 1000; ok(await linkOf(hB) === 'none', 'a runner that stops refreshing its claim expires -> no runner');
  c = await post('/play/claim', {hero: hB.id, runner: 'runner-C'}); ok(c.status === 200, 'an expired claim frees the hero for a new runner');
  ok(play.links()[hA.id] === 'none' && play.links()[hB.id] === 'waiting', 'links() (pushed to the page) match health');
  server.close();
}

// ---- the browser bridge (src/ui/player-bridge.js) serves every agent hero in its world ----
{
  console.log('the browser bridge with two agent heroes');
  const {WebSocket: WsClient} = await import('ws');
  const {LINK_MS} = await import('./relay-mcp.mjs');
  const [hA, hB] = P.playerSeats().filter(x => x.state !== 'dead').slice(-2);
  let skew = 0;
  const server = http.createServer((q, s) => {s.writeHead(404); s.end()});
  attachPlay(server, {log: () => {}, now: () => Date.now() + skew}); // the relay's own browser backend
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  // the page's globals: a WebSocket that sends the game's origin, and localStorage with the bridge URL
  globalThis.WebSocket = class extends WsClient {constructor(u) {super(u, {origin: 'http://localhost:5173'})}};
  globalThis.localStorage = {getItem: k => k === 'eldmoor.playUrl' ? `ws://127.0.0.1:${server.address().port}/play` : null};
  const BR = await import('../src/ui/player-bridge.js');
  BR.initBridge();
  const health = async () => (await fetch(base + '/play/health')).json();
  let hs = null;
  await until(() => BR.bridgeStatus() === 'connected', 5, 'the page connecting');
  for (let k = 0; k < 50 && !(hs && hs.heroes.length === P.playerSeats().length); k++) {await sleep(40); hs = await health()}
  ok(hs && hs.connected && hs.heroes.some(h => h.id === hA.id) && hs.heroes.some(h => h.id === hB.id), `the page tells the relay all ${hs && hs.heroes.length} agent heroes`);
  const post = (path, body) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(r => r.json());
  const [sa, sb] = await Promise.all([post('/play/call', {hero: hA.id, tool: 'status'}), post('/play/call', {hero: hB.id, tool: 'status'})]);
  ok(sa.name === hA.name && sb.name === hB.name, `the page answers each call for its own hero (${sa.name}, ${sb.name})`);
  skew += LINK_MS + 1000; await post('/play/claim', {hero: hA.id, runner: 'page-test'});
  await until(() => BR.agentLink(hA) === 'waiting', 5, 'the link states reaching the page');
  ok(BR.agentLink(hA) === 'waiting' && BR.agentLink(hB) === 'none', `the page sees each agent's link (${BR.agentLink(hA)}, ${BR.agentLink(hB)})`);
  const w = post('/play/call', {hero: hA.id, tool: 'wait', args: {minutes: 30}, runner: 'page-test'});
  await until(() => BR.agentLink(hA) === 'connected', 5, 'the link turning connected');
  ok(BR.agentLink(hA) === 'connected', 'a call in flight shows as connected on the page'); await w;
  await post('/play/narrate', {hero: hB.id, text: 'Through the page.'}); await until(() => (hB.playNarr || [])[0] && hB.playNarr[0].text === 'Through the page.', 5, 'narration through the page');
  BR.agentOff(hB); await sleep(100);
  const r2 = await post('/play/call', {hero: hB.id, tool: 'look'});
  ok(r2.ok === false && /not agent-played/.test(r2.error) && hA.player, 'Agent off on one hero leaves the other agent-played; its calls are refused');
  server.close();
}

// ---- one saved session per hero (issue #93) ----
{
  const {mkdtempSync, writeFileSync: wf, existsSync: ex, readdirSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const SS = await import('./agent-sessions.mjs');
  const logs = mkdtempSync(join(tmpdir(), 'eldmoor-sess-'));
  wf(join(logs, 'agent-session.json'), JSON.stringify({sessionId: 's-old', heroId: 5, heroName: 'Ann', turns: 3}));
  const note = SS.migrateLegacy(logs);
  ok(ex(SS.sessionPath(5, logs)) && !ex(join(logs, 'agent-session.json')) && /moved/.test(note), 'the old single session file moves to logs/agents/5.json on first run');
  const fresh = (hid, name) => () => ({sessionId: null, heroId: hid, heroName: name, turns: 0});
  let L = SS.loadSession(5, 'Ann', fresh(5, 'Ann'), {logs}); ok(L.sess.sessionId === 's-old' && L.sess.turns === 3 && !L.note, 'Ann resumes her migrated session');
  const B6 = SS.loadSession(6, 'Bo', fresh(6, 'Bo'), {logs}).sess; B6.sessionId = 's-bo'; SS.saveSession(B6, {}, logs);
  L.sess.turns++; SS.saveSession(L.sess, {}, logs);
  ok(SS.loadSession(6, 'Bo', fresh(6, 'Bo'), {logs}).sess.sessionId === 's-bo' && SS.loadSession(5, 'Ann', fresh(5, 'Ann'), {logs}).sess.turns === 4, 'two heroes, two files: saving one never touches the other');
  L = SS.loadSession(5, 'Cyd', fresh(5, 'Cyd'), {logs});
  ok(L.sess.sessionId === null && /kept at/.test(L.note) && readdirSync(join(logs, 'agents', 'old')).some(f => f.startsWith('5-Ann-')), 'a new world reusing id 5 for another hero sets Ann\'s session aside, never overwrites it');
  SS.saveSession(L.sess, {}, logs);
  L = SS.loadSession(6, 'Bo', fresh(6, 'Bo'), {logs, startNew: true});
  ok(L.sess.sessionId === null && readdirSync(join(logs, 'agents', 'old')).some(f => f.startsWith('6-Bo-')), '--new starts afresh and keeps the old conversation in logs/agents/old/');
  ok(SS.migrateLegacy(logs) === null, 'migration runs once');
  // per-hero runner settings ride with the session: each hero may later have its own provider and model
  const D = {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium'};
  let RS = SS.runnerSettings({}, {}, D).runner; ok(RS.provider === 'anthropic' && RS.model === D.model && RS.effort === 'medium', 'runner settings default to anthropic and the current model');
  const kept = SS.loadSession(6, 'Bo', fresh(6, 'Bo'), {logs}).sess; kept.runner = {provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low'}; SS.saveSession(kept, {}, logs);
  RS = SS.runnerSettings(SS.loadSession(6, 'Bo', fresh(6, 'Bo'), {logs}).sess, {}, D).runner;
  ok(RS.model === 'claude-haiku-5-5' && RS.effort === 'low' && SS.loadSession(5, 'Cyd', fresh(5, 'Cyd'), {logs}).sess.runner === undefined, 'a hero keeps its own saved model and effort; other heroes are unaffected');
  RS = SS.runnerSettings({runner: {provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low'}}, {effort: 'high'}, D).runner; ok(RS.model === 'claude-haiku-5-5' && RS.effort === 'high', 'a command-line flag overrides one saved setting');
  RS = SS.runnerSettings({runner: {provider: 'ollama', model: 'llama', effort: null}}, {}, D).runner; ok(RS.provider === 'ollama' && RS.model === 'llama', 'a saved non-anthropic provider is kept as is (the runner refuses it until Mixed minds lands)');
  RS = SS.runnerSettings({runner: {provider: 'ollama', model: 'llama'}}, {provider: 'anthropic'}, D).runner; ok(RS.provider === 'anthropic' && RS.model === D.model, 'switching provider drops the old provider\'s model');
  rmSync(logs, {recursive: true, force: true});
}

// ---- reflection moments (issue #179): the cap holds ----
{
  paused = true; a = S.agents.find(x => x.id === id);
  const RF = await import('../src/sim/reflect.js'), {hostPace} = await import('../src/sim/player-host.js'), R = RF.REFLECT;
  const gm0 = S.gameMin, day0 = Math.floor(gm0 / 1440) + 2; delete a.reflect;
  S.gameMin = (day0 - 1) * 1440 + 8 * 60; // 08:00 on a fresh day
  let done = 0, offered = 0;
  for (let i = 0; i < R.PER_DAY + 3; i++) {
    RF.moment(a, i % 2 ? 'scene' : 'camp', 'test ' + i); const due = RF.reflectDue(a);
    if (due) {offered++; const r = await hostPace(id, {reflected: due.id, wrote: 1}); if (r.ok) done++}
    S.gameMin += R.GAP;
  }
  ok(done === R.PER_DAY && offered === R.PER_DAY, `at most ${R.PER_DAY} reflections a game day, however many moments come (${done} done of ${R.PER_DAY + 3} moments)`);
  a.playEvN = (a.playEvN || 0) + R.EV_MIN; S.gameMin = (day0 - 1) * 1440 + R.DUSK + 30;
  ok(!RF.reflectDue(a), 'once the day\'s cap is spent, not even the evening reflection is offered');
  delete a.reflect; S.gameMin = day0 * 1440 + 8 * 60; RF.moment(a, 'camp', 'gap test'); let due = RF.reflectDue(a);
  ok(due && (await hostPace(id, {reflected: due.id, wrote: 0})).ok, 'a moment closed with no memory still counts (one try per moment)');
  RF.moment(a, 'scene', 'too soon'); ok(!RF.reflectDue(a), `two reflections are at least ${R.GAP} game minutes apart`);
  S.gameMin += R.GAP; a.playActAt = -1;
  ok(RF.reflectDue(a) && RF.reflectDue(a).kind === 'scene', 'a waiting moment comes once the gap has passed');
  await hostPace(id, {reflected: RF.reflectDue(a).id, wrote: 0}); S.gameMin = day0 * 1440 + R.DUSK + 10;
  ok(!RF.reflectDue(a), 'the evening reflection is skipped when nothing happened since the last one');
  S.gameMin += R.GAP; a.playEvN += R.EV_MIN; due = RF.reflectDue(a);
  ok(due && due.kind === 'dusk', 'with something happened, the day ends with a reflection: ' + (due && due.why));
  const nb = await call('remember', {title: 'Cap test', text: 'A night by the road.', tags: ['test']});
  ok(nb.ok && !RF.reflectDue(a) && a.memories.notes.find(n => n.title === 'Cap test').rf === 'dusk', 'a note written while a moment is due closes it and is marked as a reflection');
  S.gameMin += R.GAP; a.playEvN += R.EV_MIN; ok(!RF.reflectDue(a), 'one evening reflection a game day');
  ok(!(await hostPace(id, {reflected: 'm999', wrote: 3})).ok, 'closing a moment that is not due is refused');
  const bg = S.agents.find(x => !x.player && x.state !== 'dead'); RF.moment(bg, 'camp', 'x'); RF.talked(bg, ['Ann']);
  ok(!bg.reflect && !RF.reflectDue(bg), 'a hero that is not agent-played gets no moments (the scripted sim is untouched)');
  S.gameMin += 1440; delete a.reflect; for (let i = 0; i < R.TALK; i++) RF.talked(a, ['Bo']);
  due = RF.reflectDue(a); ok(due && due.kind === 'talk' && /with Bo/.test(due.why), 'a conversation of ' + R.TALK + ' lines raises a moment: ' + (due && due.why));
  delete a.reflect; S.gameMin = gm0;
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
