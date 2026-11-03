// Town autopilot and danger edges check (issues #466, #465). No model, no network.
//   town     an agent-played hero idle in town (no order, no scene) carries on: rests at the inn when hurt, sells its loot,
//            buys a potion or two, then walks out to a ground that fits its level and hunts; never takes a job, Crypt or raid
//   follow   a company member whose leader stays in town waits for them first, then hunts near town on its own
//   silent   a level-1 agent hero left alone in town (no runner turns at all) reaches level 3 within 24 game hours
//   edge     a walk (move_to "explore <dir>", hunt {where}) into a region 5+ levels above the hero stops at its edge once,
//            with the danger in words; the same call again (or force: "yes") goes on; leaving a party leader says so
//   world    background heroes are never touched (their seeded hash: node scripts/professioncheck.mjs --hash)
// Usage: npm run townpilotcheck
let seed = 0x7a466 ^ (Number(process.env.TOWNPILOT_SEED) || 3);
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

console.log('\nEldmoor townpilotcheck: autopilot in town (#466), danger edges (#465)\n');
init({fellowship: false}); run(5);
const heroes = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');
const A = heroes.find(a => a.fac === 0), B = heroes.find(a => a.fac === 0 && a !== A);
const c = homeOf(A);
// a hero at its gate, idle, level 1, with nothing in its pack: the scene of the playtest (a company at the gate for days)
const fresh = (a, lvl = 1) => {a.lvl = lvl; a.xp = 0; a.hp = maxHp(a); a.party = null; a.partyOk = false; a.target = null; a.dest = null; a.pq = []; a.hidden = false;
  if (!a.player) P.markPlayer(a, true); a.x = c.gate.x - 1; a.y = c.gate.y; a.state = 'town'; a.adv = null; a.quest = null; invOf(a).list = []; a.gold = 0; a.playOrder = null; a.playGround = null; a.playDare = null};
const idle = (a, min = 130) => {a.playActAt = S.gameMin - min; a.playTurn = null; a.playIdle = false};

// ---------------------------------------------------------------- town
console.log('town');
fresh(A); idle(A); run(.1);
let q = (A.pq || []).map(x => x.kind).join(',');
ok(/^move,hunt$/.test(q) && A.playIdle && /autopilot: heading out/.test(A.playDoing || ''), `idle at the gate, autopilot heads out to hunt (${q}; "${A.playDoing}")`);
const goal = A.pq[0] && A.pq[0].label;
ok(goal && ZONES.some((n, z) => n === goal && band(z)[0] <= A.lvl + 1), `to a ground that fits level ${A.lvl}: ${goal}`);
ok((A.playEv || []).some(e => /^Autopilot: heading out/.test(e.text)), 'and the hero is told so in an event');
run(12);
ok(!inTownRect(A) && ['hunt', 'travel', 'fight'].includes(A.state), `it leaves town (${A.state} in ${ZONES[zoneAt(A.x, A.y)]})`);
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

// ---------------------------------------------------------------- silent
console.log('silent');
fresh(A); idle(A); const l0 = A.lvl, t0 = S.gameMin;
while (S.gameMin - t0 < 24 * 60 && A.state !== 'dead') {run(5); if (!A.playIdle) idle(A)}
ok(A.state !== 'dead' && A.lvl >= 3, `a level-1 agent hero left alone in town reaches level ${A.lvl} in 24 game hours (${A.kills} kills, ${A.state} in ${ZONES[zoneAt(A.x, A.y)]})`);
ok(!A.adv && !A.quest, 'still no job or bounty it did not take');
void l0; void xpNeed;

console.log(fail ? `\ntownpilotcheck: ${fail} FAILED\n` : '\ntownpilotcheck: all ok\n');
process.exit(fail ? 1 : 0);
