// Tool quick wins check (issue #399): hero tools accept more and fail helpfully.
//   move_to   reads the game's own labels back ("gate in Highgate", "the inn", "Lowmark (home)", "(x, y)", the header's
//             "Highgate (town; Lowmark around it)"), a known region inside longer words, the world's name, a companion in
//             sight; an unknown place gets a "did you mean" and the places the hero knows, never one it does not (#188)
//   header    paceBrief's place names the town when the hero stands in one
//   targets   fight, use_ability, use_item, give, join_party take a name as well as an id, and the refusals list the
//             legal names and ids (only what is in sight)
//   hunt      a hunt in town names the region around the town
//   relay     a page that went away reads as a pause (PAUSED), marked offline
// No model, no network. Usage: node scripts/toolwincheck.mjs
let seed = 0x0399aced;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const PC = await import('../src/sim/pace.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {ZONES, CITY, zoneAt, zonePoint, dist} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');
const {PAUSED} = await import('./relay-mcp.mjs');
const {cleanArgs} = await import('./local-agent.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => {a.playRate = []; return P.playerAct(a.id, tool, args || {})}; // the rate limit is not under test
const J = v => JSON.stringify(v);

console.log('\nEldmoor toolwincheck: tools accept more and fail helpfully (#399)\n');
init({fellowship: false}); run(20);
const heroes = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');
const A = heroes.find(a => a.fac === 0), B = heroes.find(a => a.fac === 0 && a !== A);
const c = homeOf(A), home = ZONES[zoneAt(c.gate.x, c.gate.y)];
P.markPlayer(A, true);
const reset = (x, p, st) => {x.x = p.x; x.y = p.y; x.state = st; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []};
const sq = c.spots.square;
reset(A, sq, 'town');

console.log('move_to:');
const go = t => {const r = act(A, 'move_to', {target: t}); A.pq = []; return r};
let r = go('gate in ' + c.name); ok(r.ok && /gate in /.test(r.going), `"gate in ${c.name}" -> ${r.going || r.error}`);
r = go('the inn'); ok(r.ok && /inn/.test(r.going), `"the inn" -> ${r.going || r.error}`);
r = go('town square'); ok(r.ok && /square/.test(r.going), `"town square" -> ${r.going || r.error}`);
r = go('blacksmith'); ok(r.ok && /smith/.test(r.going), `"blacksmith" -> ${r.going || r.error}`);
r = go(c.name + ' gate'); ok(r.ok && /gate/.test(r.going), `"${c.name} gate" -> ${r.going || r.error}`);
r = go(home + ' (home)'); ok(r.ok && r.going === home, `"${home} (home)" -> ${r.going || r.error}`);
r = go(home + ' Forest'); ok(r.ok && r.going === home && /Read /.test(r.note || ''), `"${home} Forest" -> ${r.going || r.error} (${r.note})`);
const hp = PC.paceBrief(A.id).brief.place; ok(hp.startsWith(c.name + ' (town'), `header place in town: "${hp}"`);
r = go(hp); ok(r.ok && r.going === c.name, `the header's own place "${hp}" -> ${r.going || r.error}`);
r = go('Eldmoor'); ok(r.ok && r.going === home && /whole land/.test(r.note || ''), `"Eldmoor" -> ${r.going || r.error} (${r.note})`);
r = go('(' + Math.round(sq.x) + ', ' + Math.round(sq.y) + ')'); ok(r.ok, `"(x, y)" -> ${r.going || r.error}`);
r = go('the innn'); ok(!r.ok && /Did you mean "inn"/.test(r.error) && /Places you know/.test(r.error), `a typo: ${r.error}`);
// a region the hero has never heard of is never offered back
const unknownZ = ZONES.find((n, i) => n && A.lore && !A.lore.p[n]);
r = go('Zzyzx Bog'); ok(!r.ok && (!unknownZ || !r.error.includes(unknownZ)), `an unknown place names only known places: ${r.error}`);
const enemy = CITY.find(t => t.fac !== A.fac);
if (enemy) {r = go('gate in ' + enemy.name); ok(!r.ok && /enemy town/.test(r.error), `an enemy town's gate is refused: ${r.error}`)}

console.log('header and hunt:');
r = act(A, 'hunt', {}); ok(!r.ok && r.error.includes(home), `hunt in town names the region: ${r.error}`);
const field = zonePoint(zoneAt(c.gate.x, c.gate.y), null, c.gate); reset(A, field, 'hunt'); rebuild();
const fp = PC.paceBrief(A.id).brief.place; ok(fp === ZONES[zoneAt(A.x, A.y)], `header place in the field: "${fp}"`);

console.log('targets:');
// a companion: B joins A's party, both in the field
reset(B, {x: A.x + 2, y: A.y}, 'hunt'); rebuild();
const party = {id: ++S.uid, fac: A.fac, leader: A, mem: [A, B], zone: zoneAt(A.x, A.y), home: false}; A.party = B.party = party; S.parties.push(party);
r = act(A, 'give', {index: 0, hero_id: 5}); ok(!r.ok && r.error.includes(B.name) && r.error.includes('id ' + B.id), `give to a guessed id lists the companions: ${r.error}`);
r = act(A, 'use_item', {index: 99, target: B.name}); ok(!r.ok && /No usable item/.test(r.error), `use_item checks the item first: ${r.error}`);
r = act(A, 'move_to', {target: B.name}); ok(r.ok && r.going === 'where ' + B.name + ' stands', `move_to a companion in sight -> ${r.going || r.error}`); A.pq = [];
B.x = A.x + 60; B.y = A.y; r = act(A, 'move_to', {target: 'follow ' + B.name}); ok(!r.ok && /not in sight/.test(r.error), `a companion out of sight: ${r.error}`); B.x = A.x + 2;
r = act(A, 'fight', {target_id: 1}); ok(!r.ok && /No such target|Foes in sight|No foe/.test(r.error), `fight a guessed id lists the foes: ${r.error}`);
// a foe in sight, by name
for (const m of S.mobs) if (m.alive && !m.gone && dist(m, A) < 20) {m.alive = false; m.gone = true}
const mob = S.mobs.find(m => m.alive && !m.gone && !m.target);
if (mob) {mob.x = A.x + 3; mob.y = A.y; rebuild();
  const P2 = await import('../src/sim/lore.js'); const nm = P2.foeName(A, mob);
  r = act(A, 'fight', {target_id: 99999}); ok(!r.ok && r.error.includes('id ' + mob.id), `the refusal names the foe in sight: ${r.error}`);
  r = act(A, 'fight', {target: nm}); ok(r.ok && A.target === mob, `fight by name "${nm}" -> ${r.target || r.error}`);
  A.state = 'hunt'; A.target = null; mob.target = null; A.pq = []}
const ca = cleanArgs('fight', {target_id: 'Timber Wolf'}); ok(ca.args && ca.args.target === 'Timber Wolf', `a local model's name in target_id goes to target: ${J(ca)}`);

console.log('relay:');
ok(/paused or reloading/.test(PAUSED) && !/Press/.test(PAUSED), `the pause line: "${PAUSED}"`);

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
