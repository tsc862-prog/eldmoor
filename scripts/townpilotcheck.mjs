// Town autopilot and danger edges check (issues #466, #465). No model, no network.
//   town     an agent-played hero idle in town (no order, no scene) carries on: rests at the inn when hurt, sells its loot,
//            buys a potion or two, then walks out to a ground that fits its level and hunts; never takes a job, Crypt or raid
//   follow   a company member whose leader stays in town waits for them first, then hunts near town on its own
//   caution  (#487) autopilot rests before heading out, heads home when hurt (rests in the field only with nothing close),
//            hunts only what it can take on its own ground, breaks off sooner from a foe above it; agent orders untouched
//   silent   a level-1 agent hero left alone in town (no runner turns at all) lives and reaches level 2 within 24 game hours
//            (six trials, each its own dice; at least 3 must level, the wary autopilot being about a coin flip per day)
//   edge     a walk (move_to "explore <dir>", hunt {where}) into a region 5+ levels above the hero stops at its edge once,
//            with the danger in words; the same call again (or force: "yes") goes on; leaving a party leader says so
//   errand   (#727) an arrival in town on the agent's own order is a now wake and holds autopilot in town 120 game minutes;
//            an errand aim (ask, buy, rest, ...) waits in town until its until, then autopilot hunts as before; running it
//            (list_jobs) is progress; intent and move_to naming the town it stands in answer "already here"; a forced aim
//            copying a finished one word for word is dropped
//   world    background heroes are never touched (their seeded hash: node scripts/professioncheck.mjs --hash)
// Usage: npm run townpilotcheck
const baseSeed = Number(process.env.TOWNPILOT_SEED) || 3;
let seed = 0x7a466 ^ baseSeed;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {ZONES, REGIONS, CITY, zoneAt, dist} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');
const {invOf, addUse, addGear} = await import('../src/sim/inv.js');
const {makeItem} = await import('../src/sim/gear.js');
const {xpNeed} = await import('../src/sim/heroes.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});
const band = z => REGIONS[z] && REGIONS[z].band;
const inTownRect = a => CITY.some(c => a.x >= c.x0 - .5 && a.x <= c.x1 + 1.5 && a.y >= c.y0 - .5 && a.y <= c.y1 + 1.5);

console.log('\nEldmoor townpilotcheck: autopilot in town (#466), danger edges (#465), town errands (#727)\n');
init({fellowship: false}); run(5);
const heroes = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');
let A = heroes.find(a => a.fac === 0); let B = heroes.find(a => a.fac === 0 && a !== A);
let c = homeOf(A);
// a hero at its gate, idle, level 1, with nothing in its pack: the scene of the playtest (a company at the gate for days)
const fresh = (a, lvl = 1) => {a.traits = []; a.lvl = lvl; a.xp = 0; a.hp = maxHp(a); a.party = null; a.partyOk = false; a.target = null; a.dest = null; a.pq = []; a.hidden = false;
  if (!a.player) P.markPlayer(a, true); a.x = c.gate.x - 1; a.y = c.gate.y; a.state = 'town'; a.adv = null; a.quest = null; invOf(a).list = []; a.gold = 0; a.playOrder = null; a.playGround = null; a.playDare = null};
const idle = (a, min = 130) => {a.playActAt = S.gameMin - min; a.playTurn = null; a.playIdle = false};

// ---------------------------------------------------------------- silent (first, on the untouched world: later sections thin and move the fields' creatures)
console.log('silent');
// the wary autopilot's pace depends on the dice, so a single seed is a coin flip: several trials, each its own dice, most must level
const TRIALS = 6, NEED = 3; let leveled = 0, alive = 0, last = null;
for (let t = 0; t < TRIALS; t++) {
  seed = (0x51e47 ^ (t + 1) * 7919 ^ baseSeed) >>> 0; // its own dice, and a clean slate for the hero (no fears learned in an earlier trial)
  for (const m of S.mobs) if (!m.alive && !m.gone) {m.alive = true; m.hp = m.maxhp; m.target = null} // the fields as a fresh hero finds them
  fresh(A); A.lore = null; A.kills = 0; A.nemesis = {}; idle(A); const t0 = S.gameMin;
  while (S.gameMin - t0 < 24 * 60 && A.state !== 'dead') {run(5); if (!A.playIdle) idle(A)}
  const up = A.state !== 'dead' && A.lvl >= 2; if (A.state !== 'dead') alive++; if (up) leveled++; last = A;
  console.log(`  trial ${t + 1}: level ${A.lvl}, ${A.kills} kills, ${A.state} in ${ZONES[zoneAt(A.x, A.y)]}${up ? '' : ' (no progress)'}`);
}
ok(leveled >= NEED, `a level-1 agent hero left alone in town reaches level 2 in 24 game hours in ${leveled} of ${TRIALS} trials (need ${NEED}; ${alive} lived)`);
ok(!A.adv && !A.quest, 'still no job or bounty it did not take');

// the silent days age the world (creatures, heroes' lives), so the rest starts from a new one
init({fellowship: false}); run(5);
{const hs = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead'); A = hs.find(a => a.fac === 0); c = homeOf(A); B = hs.find(a => a.fac === 0 && a !== A && !a.party && homeOf(a) === c) || hs.find(a => a.fac === 0 && a !== A)}

// ---------------------------------------------------------------- town
console.log('town');
fresh(A); idle(A); run(.1);
let q = (A.pq || []).map(x => x.kind).join(',');
ok(/^move,hunt$/.test(q) && A.playIdle && /autopilot: heading out/.test(A.playDoing || ''), `idle at the gate, autopilot heads out to hunt (${q}; "${A.playDoing}")`);
const goal = A.pq[0] && A.pq[0].label;
ok(goal && ZONES.some((n, z) => n === goal && band(z)[0] <= A.lvl + 1), `to a ground that fits level ${A.lvl}: ${goal}`);
ok((A.playEv || []).some(e => /^Autopilot: heading out/.test(e.text)), 'and the hero is told so in an event');
run(12);
ok(!inTownRect(A) && ['hunt', 'travel', 'fight', 'return'].includes(A.state), `it leaves town (${A.state} in ${ZONES[zoneAt(A.x, A.y)]})`);
ok(!A.adv && !A.quest && !A.cryptOk && !A.raidOk, 'and takes no job, bounty, Crypt or raid on its own');

fresh(A); A.hp = maxHp(A) * .3; idle(A); run(.05);
ok((A.pq || []).length === 2 && /inn/.test(A.pq[0].label) && A.pq[1].kind === 'rest', 'hurt in town: to the inn to rest');
fresh(A); for (let i = 0; i < 5; i++) addGear(A, makeItem(A.cls, 'chest', 1, 0, {src: 'test', rare: 0})); idle(A); run(.05);
ok(A.gold > 0 && invOf(A).list.length === 0, `loot in the pack: sold (${A.gold}g)`);
const pots = a => invOf(a).list.filter(e => e.id === 'Redroot Draught').reduce((n, e) => n + (e.n || 1), 0);
fresh(A); A.gold = 50; idle(A); run(.05);
ok(pots(A) === 2 && A.gold === 50 - 16, `gold and no potions: buys two (${pots(A)}, ${A.gold}g left)`);
fresh(A); A.gold = 50; addUse(A, 'Redroot Draught', 2); idle(A); run(.05);
ok(pots(A) === 2 && A.gold === 50 && /^move/.test((A.pq || []).map(x => x.kind).join(',')), 'with potions in the pack it buys none and heads out');
fresh(A); idle(A, 30); run(.05);
ok(!(A.pq || []).length && !A.playIdle, 'an order given half an hour ago: autopilot does not start yet');
fresh(A); idle(A); A.playTurn = S.gameMin; run(.05);
ok(!(A.pq || []).length, 'the agent\'s turn is open (#240): nothing new starts under it');
A.playTurn = null;

// ---------------------------------------------------------------- follow
console.log('follow');
fresh(A); fresh(B); B.player = false; B.state = 'town'; B.x = c.gate.x - 2; B.y = c.gate.y;
const party = {id: ++S.uid, fac: A.fac, leader: B, mem: [B, A], zone: 0, home: false}; A.party = B.party = party; A.partyOk = true; S.parties.push(party);
idle(A); run(.05);
ok(!(A.pq || []).length, 'a member whose leader is in town waits for the leader first');
idle(A, 130 + 245); run(.05);
ok(/^move,hunt$/.test((A.pq || []).map(x => x.kind).join(',')) && /still in town/.test(A.pq[0].auto), `then hunts nearby on its own ("${A.pq[0] && A.pq[0].auto}")`);
S.parties = S.parties.filter(p => p !== party); A.party = B.party = null; A.pq = [];
if (B.player) P.markPlayer(B, false);

// ---------------------------------------------------------------- edge
console.log('edge');
// a spot in a level-1 region whose road east enters a region 5+ levels above, first (no milder region between)
let spot = null, far = null;
for (let y = 2; y < 48 && !spot; y += 1) for (let x = 2; x < 76 && !spot; x += 1) {const z0 = zoneAt(x, y); if (!band(z0) || band(z0)[0] > 1) continue;
  if (CITY.some(t => Math.hypot(t.gate.x - x, t.gate.y - y) < 6 || (x >= t.x0 - 2 && x <= t.x1 + 2 && y >= t.y0 - 2 && y <= t.y1 + 2))) continue;
  for (let d = 3; d <= 12; d++) {const z = zoneAt(x + d, y); if (z === z0) continue; if (band(z) && band(z)[0] >= 6 && band(z)[0] === Math.max(...REGIONS.map(r => r.band ? r.band[0] : 0))) {spot = {x, y}; far = z} break}}
ok(spot && far != null, `a ${ZONES[zoneAt(spot.x, spot.y)]} field with ${ZONES[far]} (from level ${band(far)[0]}) just east`);
fresh(A); A.x = spot.x; A.y = spot.y; A.state = 'hunt'; idle(A, 0); for (const m of S.mobs) if (dist(m, spot) < 20) {m.alive = false; m.gone = true} rebuild();
let r = act(A, 'move_to', {target: 'explore east'});
ok(r.ok && r.stops_short && /edge/.test(r.warning) && /one life/.test(r.warning) && /same call again/.test(r.warning), `a level-1 hero exploring east stops at the edge, warned: ${r.warning}`);
ok(!/\d+\s*-\s*\d+|level \d/i.test(r.warning), 'in words, no level numbers');
for (let i = 0; i < 40 && (A.pq || []).length; i++) run(.5);
ok(zoneAt(A.x, A.y) !== far, `the walk ends short of ${ZONES[far]} (at ${A.x.toFixed(1)},${A.y.toFixed(1)}, ${ZONES[zoneAt(A.x, A.y)]})`);
r = act(A, 'move_to', {target: 'explore east'});
ok(r.ok && !r.stops_short && /You go on/.test(r.warning || ''), 'the same call again goes on, still warned');
A.pq = []; A.x = spot.x; A.y = spot.y; A.playDare = null;
r = act(A, 'move_to', {target: 'explore east', force: 'yes'});
ok(r.ok && !r.stops_short, 'force: "yes" goes on at once');
A.pq = []; A.playDare = null; A.lvl = band(far)[0] - 2;
r = act(A, 'move_to', {target: 'explore east'});
ok(r.ok && !r.stops_short, `a hero near the region's level (${A.lvl}) walks in unwarned`);
A.pq = []; A.lvl = 1; A.playDare = null;
r = act(A, 'hunt', {where: 'east'});
ok(r.ok && r.stops_short && /edge/.test(r.warning), 'hunt {where: "east"} stops at the edge too');
A.pq = []; A.playDare = null;
// leaving a party leader who will not follow
fresh(B); B.player = false; B.x = spot.x; B.y = spot.y; B.state = 'hunt'; A.x = spot.x; A.y = spot.y; A.state = 'hunt';
const p2 = {id: ++S.uid, fac: A.fac, leader: B, mem: [B, A], zone: 0, home: false}; A.party = B.party = p2; A.partyOk = true; S.parties.push(p2);
r = act(A, 'move_to', {target: Math.round(spot.x) + ',' + Math.round(spot.y + 20)});
ok(r.ok && r.apart && new RegExp(B.name).test(r.apart), `walking away from the leader says so: ${r.apart || JSON.stringify(r)}`);
S.parties = S.parties.filter(p => p !== p2); A.party = B.party = null; A.pq = [];

// ---------------------------------------------------------------- caution (#487)
console.log('caution');
fresh(A); A.hp = maxHp(A) * .75; idle(A); run(.05);
ok((A.pq || [])[0] && A.pq[0].kind === 'rest' && /before heading out/.test(A.pq[0].auto), 'not near full health in town: rests before heading out');
// a clear patch of Thornvale (the level-1 region) away from both towns
let field0 = null;
for (let y = 2; y < 48 && !field0; y++) for (let x = 2; x < 76 && !field0; x++) {const z0 = zoneAt(x, y); if (!band(z0) || band(z0)[0] > 1) continue;
  if (CITY.some(t => Math.hypot(t.gate.x - x, t.gate.y - y) < 10 || (x >= t.x0 - 4 && x <= t.x1 + 4 && y >= t.y0 - 4 && y <= t.y1 + 4))) continue; let edge = false; for (let d = -8; d <= 8 && !edge; d += 2) if (zoneAt(x + d, y) !== z0 || zoneAt(x, y + d) !== z0) edge = true; if (!edge) field0 = {x, y, z: z0}}
const cleared = new Set(), clearAround = p => {for (const m of S.mobs) if (dist(m, p) < 16) {m.alive = false; m.gone = true; m.target = null; cleared.add(m)} rebuild()};
const place = (type, lvl, dx) => {const m = S.mobs.find(x => x.type === type && !(x.elite || x.named) && !x.placed); m.placed = true; m.alive = true; m.gone = false; m.hidden = false; m.target = null; m.lvl = lvl; m.hp = m.maxhp;
  m.x = field0.x + dx; m.y = field0.y; m.home = {x: m.x, y: m.y}; m.dest = null; m.scan = 999; m.wait = 999; return m};
const inField = (hp = 1) => {fresh(A); for (const p of S.parties) p.mem = p.mem.filter(b => b !== A); A.traits = []; A.x = field0.x; A.y = field0.y; A.state = 'hunt'; A.hp = maxHp(A) * hp; idle(A); clearAround(field0)};
ok(!!field0, `a clear field in ${field0 && ZONES[field0.z]}`);
inField(.4); run(.05);
ok((A.pq || [])[0] && A.pq[0].kind === 'move' && /too hurt/.test(A.pq[0].auto), `badly hurt in the field: heads home ("${A.pq[0] && A.pq[0].auto}")`);
inField(.55); run(.05);
ok((A.pq || [])[0] && A.pq[0].kind === 'rest', 'hurt with no creature close: rests where it stands');
inField(.55); place('wolf', 1, 3); rebuild(); run(.05);
ok((A.pq || [])[0] && A.pq[0].kind === 'move' && /creatures close/.test(A.pq[0].auto), 'hurt with a creature close: heads home to heal instead');
inField(); const big = place('spider', 6, 1.2), small = place('wolf', 1, 2.4); rebuild(); const k0 = A.kills; let bigPicked = false;
for (let i = 0; i < 20 && !(A.target === small || A.kills > k0 || !small.alive); i++) {run(.4); if (A.target === big || big.target === A) bigPicked = true}
ok((A.target === small || !small.alive) && !bigPicked && A.target !== big && big.target !== A, `a wary hunt leaves a creature far above it alone and takes the one it can (${A.target ? A.target.type + ' ' + A.target.lvl : A.kills > k0 ? 'slew the wolf' : !small.alive ? 'the wolf fell to another hand' : 'none'})`);
ok((A.pq || [])[0] && A.pq[0].wary && A.pq[0].ground === field0.z, 'the hunt keeps to its ground');
inField(); big.alive = true; big.gone = false; big.hp = big.maxhp; big.target = A; A.target = big; A.state = 'fight'; big.x = A.x + .5; big.y = A.y; A.hp = maxHp(A) * .45; rebuild(); run(.05);
ok(A.state === 'return' && A.target == null, 'jumped by a creature far above it: autopilot breaks off below half health');
inField(); A.lore = null; place('spider', 6, 1.5); rebuild(); A.playActAt = S.gameMin; A.playIdle = false; r = act(A, 'hunt', {}); run(.8);
ok(r.ok && A.target && A.target.type === 'spider', 'the agent\'s own hunt order is untouched: it takes what the agent sends it at');
A.target = null; A.pq = []; A.state = 'hunt';
for (const m of S.mobs) if (m.placed) {m.placed = false; m.scan = 0; m.wait = 0}
for (const m of cleared) {m.alive = true; m.gone = false; m.target = null; m.hp = m.maxhp} rebuild(); // the field as it was

// ---------------------------------------------------------------- errand (#727)
console.log('errand');
const IN = await import('../src/sim/intent.js');
const ARRIVE_HOLD = 120; // TP.ARRIVE_HOLD in sim/player.js
const outside = () => {for (const d of [6, 8, 10]) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {const p = {x: c.gate.x + dx * d, y: c.gate.y + dy * d};
  if (p.x > 1 && p.y > 1 && p.x < 78 && p.y < 48 && !inTownRect(p) && ZONES[zoneAt(p.x, p.y)]) return p} return null};
const away = outside();
const atField = () => {fresh(A); A.playArrive = null; A.intent = null; A.intentPast = null; A.x = away.x; A.y = away.y; A.state = 'hunt'};
const walkIn = (max = 400) => {for (let i = 0; i < max && (A.pq || []).length && A.pq[0].kind !== 'rest'; i++) run(.1)};
const kinds = () => (A.pq || []).map(x => x.kind).join(',');
ok(!!away, `a spot outside ${c.name} (${away && away.x},${away && away.y})`);
// 1. an arrival on the agent's own move_to, the idle clock long past PK.IDLE: a now wake, and autopilot stays in town
atField(); r = act(A, 'move_to', {target: c.name}); A.playTurn = null; A.playActAt = S.gameMin - 500;
const ev0 = A.playEvN || 0; walkIn();
const arr = (A.playEv || []).find(e => e.n > ev0 && /^Arrived/.test(e.text));
ok(r.ok && arr && arr.w === 2, `arriving in ${c.name} on its own order is a now wake (${arr ? arr.text + ' w=' + arr.w : 'no arrival event'})`);
ok(A.playArrive != null && Math.abs(A.playArrive - S.gameMin) < 30, 'the arrival is noted for the hold');
run(.2);
ok(A.playIdle && (A.pq || [])[0] && A.pq[0].kind === 'rest' && /staying in/.test(A.pq[0].auto || ''), `autopilot runs but stays in town ("${A.playDoing}")`);
{const t0 = A.playArrive; let left = false; while (S.gameMin < t0 + ARRIVE_HOLD - 8) {run(.5); if (!inTownRect(A)) left = true}
  ok(!left && A.state === 'town', `still in ${c.name} ${Math.round(S.gameMin - t0)} game minutes after arriving`);
  while (S.gameMin < t0 + ARRIVE_HOLD + 6 && !/^move/.test(kinds())) run(.2);
  ok(/^move,hunt$/.test(kinds()), `after the hold, autopilot heads out to hunt as before (${kinds()})`)}
// 2. an errand aim in town: a wait-kind order until its until (4 h by default), then autopilot hunts as before
fresh(A); A.playArrive = null; A.intent = null;
r = act(A, 'intent', {goal: 'Ask the innkeeper for news of the Sunken Crypt', why: 'I need the way down'}); A.playTurn = null;
ok(r.ok && /waiting in/.test(r.carries_on || '') && A.intent.order && A.intent.order.kind === 'wait' && A.intent.order.errand === 'ask', `an errand aim in town waits there: ${r.carries_on}`);
ok(/talk|list_jobs/.test(r.next || '') && /earshot/.test(r.next || ''), `and names the next step: ${r.next}`);
ok(A.intent.untilAt != null && Math.abs(A.intent.untilAt - S.gameMin - IN.INTENT.ERRAND) < 2, 'with no hours given it holds 4 game hours');
ok(/Your aim says ask: talk to someone here/.test(IN.aimBrief(A).errand || ''), `the turn header names it: ${IN.aimBrief(A).errand}`);
{idle(A); run(.1);
  ok((A.pq || [])[0] && A.pq[0].kind === 'rest' && A.pq[0].hold && /waiting in/.test(A.pq[0].auto || ''), `autopilot keeps to the errand ("${A.pq[0] && A.pq[0].auto}")`);
  const until = A.intent.untilAt; let left = false; while (S.gameMin < until - 10) {run(.5); if (!inTownRect(A)) left = true}
  ok(!left && IN.aimState(A) === 'set', `in town ${Math.round((S.gameMin - until + IN.INTENT.ERRAND) / 60 * 10) / 10} game hours on, the aim not stale (${left ? 'left town' : IN.aimState(A)})`);
  while (S.gameMin < until + 6 && !/^move/.test(kinds())) run(.2);
  ok(A.intent.done && /^move,hunt$/.test(kinds()), `the errand's time up: autopilot hunts as before (${kinds()})`)}
// 3. running the errand is progress, and acting on it
fresh(A); A.playArrive = null; A.intent = null;
act(A, 'intent', {goal: 'Find out where the Sunken Crypt lies', why: 'the job'}); r = act(A, 'list_jobs', {}); A.playTurn = null;
ok(r.ok !== false && A.intent.acted === true && !IN.aimBrief(A).errand, 'list_jobs runs the errand: acted, and the header no longer asks it');
// 4. already here: intent and move_to naming the town it stands in
fresh(A); A.playArrive = null; A.intent = null;
r = act(A, 'intent', {goal: 'Return to ' + c.name + ' and recover fully', why: 'hurt'});
ok(r.ok && r.here === 'You are already in ' + c.name + '.' && /earshot/.test(r.next || ''), `intent naming ${c.name} inside it: "${r.here}" ${r.people ? '(' + r.people.slice(0, 2).join('; ') + ')' : ''}`);
A.pq = []; r = act(A, 'move_to', {target: c.name});
ok(r.ok && r.already_here && /already in/.test(r.here) && !(A.pq || []).length, 'move_to the town it stands in: already here, no walk');
r = act(A, 'move_to', {target: 'the inn'});
ok(r.ok && !r.already_here && (A.pq || []).length, 'move_to a spot in town still walks');
A.pq = []; A.playTurn = null;
// 5. an errand aim set out in the field: the aim's walk arrives (a now wake) and becomes the wait in town
atField(); r = act(A, 'intent', {goal: 'Return to ' + c.name + ' and ask about the Crypt', why: 'rumours'}); A.playTurn = null;
ok(r.ok && A.intent.order && A.intent.order.kind === 'move', `in the field it is a walk first (${r.carries_on})`);
idle(A); const ev1 = A.playEvN || 0; for (let i = 0; i < 400 && A.intent.order.kind !== 'wait'; i++) run(.1);
for (let i = 0; i < 40 && (A.pq || []).length && A.pq[0].kind === 'move'; i++) run(.1);
const arr2 = (A.playEv || []).find(e => e.n > ev1 && /^Arrived/.test(e.text));
ok(A.intent.order.kind === 'wait' && !A.intent.done && A.intent.order.town && inTownRect(A), `on arrival the errand holds it in town (${IN.orderText(A.intent.order)})`);
ok(arr2 && arr2.w === 2, `the aim's own walk arriving is a now wake too (${arr2 ? arr2.text : 'none'})`);
// 6. a forced answer that copies a finished aim word for word is dropped; said again by the agent itself it is set
fresh(A); A.playArrive = null; A.intent = null; A.intentPast = null;
const g6 = 'Break off from the Webspinner and get back to the road'; act(A, 'intent', {goal: g6, why: 'x'}); act(A, 'intent', {done: 'yes'});
r = act(A, 'intent', {goal: g6, why: 'x', forced: 'yes'});
ok(r.ok && r.dropped === 'stale aim dropped' && A.intent.done && IN.aimBrief(A).ask, 'a forced aim copied from a finished one is dropped and the header asks again');
act(A, 'intent', {goal: 'Hunt boars in the fields', why: 'coin'});
r = act(A, 'intent', {goal: g6, why: 'x', forced: 'yes'});
ok(r.dropped, 'an older finished aim copied word for word is dropped too');
r = act(A, 'intent', {goal: g6, why: 'x'});
ok(r.ok && !r.dropped && A.intent.goal === g6, 'the agent restating it in a free turn sets it');
A.pq = []; A.playTurn = null; A.intent = null;

void xpNeed; void last;

console.log(fail ? `\ntownpilotcheck: ${fail} FAILED\n` : '\ntownpilotcheck: all ok\n');
process.exit(fail ? 1 : 0);
