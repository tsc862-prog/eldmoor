// Downed and death saves (#626 slices 1a #652 and 1b #653): a hero at zero HP is downed, rolls death saves,
// can be stabilized, healed or given a potion by a friend, and dies only through slay() -> fall().
// The dice are forced through a stubbed Math.random (core/rng.js captures it at load), so every case is exact.
// Usage: node scripts/downcheck.mjs
let seed = 0x5eed; const forced = [];
Math.random = () => {if (forced.length) return forced.shift(); seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const d20 = (...v) => {for (const x of v) forced.push((x - 1) / 20 + .01)}; // ri(1,20) reads one rnd()
const {init, step, S, snapshot, restore} = await import('../src/sim/index.js');
const {agentDie, maxHp} = await import('../src/sim/heroes.js');
const {DOWN, downHit, foeOnDowned, downStats, downedStep} = await import('../src/sim/downed.js');
const {addUse} = await import('../src/sim/inv.js');
const {rebuild} = await import('../src/sim/spatial.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor downcheck\n');

// A quiet corner: no mobs, every other hero home in town; heroes under test stand in the open.
const P = {x: 40, y: 25};
function world() {
  forced.length = 0; seed = 0x5eed; init({fellowship: false});
  for (const m of S.mobs) {m.alive = false; m.respawn = 1e9; m.target = null}
  for (const a of S.agents) {a.state = 'town'; a.townStep = 0; a.wait = 1e9; a.x = 5; a.y = 5; a.party = null; a.guild = null; a.company = null}
  S.recruits.length = 0; S.raidT = 1e9; S.pvpT = 1e9;
}
function hero(i, cls) {const a = S.agents.filter(x => !cls || x.cls === cls)[i]; a.state = 'hunt'; a.wait = 0; a.x = P.x + i * .5; a.y = P.y; a.hp = maxHp(a); a.zone = 1; a.dest = {x: a.x, y: a.y}; a.scan = 1e9; return a}
const {blockOf} = await import('../src/data/bestiary.js');
const fin = m => !!blockOf(m.type, m.v, m.role).beh.finishes;
const mob = (f = false) => {const m = S.mobs.find(x => fin(x) === f); m.alive = true; m.hp = m.maxhp; m.x = P.x + 3; m.y = P.y + 3; m.target = null; m.cd = 1e9; return m};
const down = (a, m, over = 5) => {rebuild(); a.hp = -over; agentDie(a, m)};
// The downed and their helpers stepped alone (no other system draws a die between), DOWN.TICK game minutes a tick.
const busy = () => S.agents.filter(x => x.state === 'downed' || x.state === 'aid');
const tick = (n = 1) => {for (let i = 0; i < n; i++) {rebuild(); S.gameMin += DOWN.TICK; for (const x of busy()) downedStep(x, DOWN.TICK / 6)}};
const walk = (n = 1, dt = .05) => {for (let i = 0; i < n; i++) {rebuild(); S.gameMin += dt * 6; for (const x of busy()) downedStep(x, dt)}};
const mates = (...L) => {const p = {id: 999, fac: L[0].fac, leader: L[0], mem: L, zone: 1, home: false}; S.parties.push(p); for (const b of L) {b.party = p; b.fac = L[0].fac}; return p};

// 1. Downing: zero HP is downed, not dead; a hero's blow finishes; a blow past full health kills.
world(); {const a = hero(0), m = mob();
  down(a, m);
  ok(a.state === 'downed' && a.hp === 0 && a.down && a.down.f === 0, 'a hero at zero HP from a mob is downed (hp 0, saves 0/0)');
  ok(S.facStats[a.fac].fallen === 0 && S.recruits.length === 0, 'a downing is not a death: no grave, no recruit');
  const b = hero(1); b.fac = 1 - a.fac;
  const c = hero(2); c.hp = -1; agentDie(c, b);
  ok(c.state === 'dead' && S.recruits.length === 1, 'a blow from a hero finishes (PvP spare comes with #657)');
  const e = hero(3); e.hp = -maxHp(e) - 1; agentDie(e, m);
  ok(e.state === 'dead', 'a blow from zero past full health kills outright');
  ok(downStats().why.massive === 1 && downStats().why.finish === 1, 'the summary counts both');}

// 2. Saves: three failures die (through fall: grave and recruit), a 1 is two failures, a 20 rises on 1 HP.
world(); {const a = hero(0), m = mob(), b = hero(1); mates(a, b); b.state = 'town'; b.x = 5; // kin far away, no helper
  down(a, m); d20(5); tick(); ok(a.down && a.down.f === 1, 'a save under 10 is one failure');
  d20(1); tick(); ok(a.state === 'dead' && a.cause === 'slain by a ' + (await import('../src/data/mobs.js')).MOBS[m.type].name, 'a 1 is two failures: three in all, dead, cause names the mob');
  ok(S.recruits.length === 1 && S.facStats[a.fac].fallen === 1, 'the death goes through fall(): a grave and a recruit of the same class');
  ok(S.recruits[0].cls === a.cls && S.recruits[0].fac === a.fac, 'the replacement is the same class and faction');}
world(); {const a = hero(0), m = mob();
  down(a, m); d20(20); tick();
  ok(a.state !== 'downed' && a.state !== 'dead' && a.hp >= 1 && !a.down, 'a natural 20 rises on 1 HP');}

// 3. Three successes with a friend near: stable, then wakes on 1 HP. With nobody near: dies alone.
world(); {const a = hero(0), m = mob(), b = hero(1); mates(a, b); b.state = 'town'; b.x = a.x + 3; b.y = a.y; // near, but not free to come
  down(a, m); d20(12, 15, 18); tick(3);
  ok(a.state === 'downed' && a.down.stable, 'three successes with a friend in reach: stable');
  tick(Math.ceil(DOWN.WAKE / DOWN.TICK) + 1);
  ok(a.state !== 'downed' && a.state !== 'dead' && a.hp >= 1, 'a stable hero wakes on 1 HP after the wake time');}
world(); {const a = hero(0), m = mob();
  down(a, m); d20(12, 15, 18); tick(3);
  ok(a.state === 'dead' && downStats().why.alone === 1, 'three successes with nobody standing in reach: dies alone');}

// 4. Help: a party mate stabilizes (d20 + Healing vs 10), a bandage is automatic, a potion brings them up, a healer heals.
world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); b.x = a.x + 4; b.inv.list.length = 0; mates(a, b);
  down(a, m); ok(b.state === 'aid' && b.aid === a.id, 'a free party mate in reach comes to help (aid)');
  b.x = a.x + .5; d20(20); walk(1); // at their side: d20 + Healing against 10
  ok(a.state === 'downed' && a.down.stable && downStats().stabilized === 1, 'the mate stabilizes them at their side');}
world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); b.x = a.x + .5; b.inv.list.length = 0; addUse(b, 'Linen Bandage', 1); mates(a, b);
  down(a, m); walk(5);
  ok(a.down && a.down.stable && !b.inv.list.some(e => e.id === 'Linen Bandage'), 'a bandage stabilizes at once and is used up');}
world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); b.x = a.x + .5; b.inv.list.length = 0; b.potCd = 0; mates(a, b);
  addUse(b, 'Redroot Draught', 1);
  down(a, m); walk(5);
  ok(a.state !== 'downed' && a.hp >= Math.floor(maxHp(a) * .3) && !b.inv.list.length, 'a potion from an adjacent party mate brings them up at the potion\'s amount');}
world(); {const a = hero(0, 'Warrior'), m = mob(), h = hero(0, 'Priest'); h.x = a.x + 4; h.healCd = 0; h.inv.list.length = 0; mates(a, h);
  down(a, m); const bonus = Math.round(maxHp(a) * DOWN.HEALER_BONUS);
  walk(5);
  ok(a.state !== 'downed' && a.hp >= bonus, 'a healer within ' + DOWN.HEAL_RANGE + ' tiles heals them up, with the healer bonus (' + a.hp + ' >= ' + bonus + ')');}

// 5. A healer in heal range buys a fourth failure.
world(); {const a = hero(0, 'Warrior'), m = mob(), h = hero(0, 'Priest'); h.x = a.x + 3; h.healCd = 1e9; h.state = 'town'; mates(a, h);
  down(a, m); d20(5, 5, 5); tick(3);
  ok(a.state === 'downed' && a.down.f === 3, 'with a healer in range, three failures are not yet death');
  d20(5); tick(); ok(a.state === 'dead', 'the fourth failure is');}

// 6. Foes: a blow on the downed is a failure (a critical two); a mob turns to whoever stands and fights it.
world(); {const a = hero(0), m = mob();
  down(a, m); downHit(a, m, false); ok(a.down.f === 1, 'a blow on the downed is one failure');
  downHit(a, m, true); ok(a.state === 'dead', 'a critical blow is two: dead');}
world(); {const a = hero(0), m = mob(), b = hero(1); b.fac = 1 - a.fac;
  m.target = a; down(a, m); b.state = 'fight'; b.target = m; b.x = m.x + 1; b.y = m.y;
  rebuild(); const o = foeOnDowned(m); ok(o === b && m.target === b, 'a mob whose prey is down turns to the hero fighting it');
  const c = hero(2); m.target = c; c.hp = -2; agentDie(c, m); b.state = 'town'; b.x = 5;
  rebuild(); ok(foeOnDowned(m) === c, 'with no one else standing it stays on the downed');}
world(); {const a = hero(0), m = mob(true), b = hero(1); b.fac = 1 - a.fac;
  m.target = a; down(a, m); b.state = 'fight'; b.target = m; b.x = m.x + 1; b.y = m.y;
  rebuild(); ok(foeOnDowned(m) === a, 'a creature that finishes (' + m.type + ') stays on the downed even with a hero fighting it');}

// 7. Downed heroes cannot act; a mid-downed save restores exactly.
world(); {const a = hero(0), m = mob();
  down(a, m); d20(5); tick();
  const snap = JSON.parse(JSON.stringify(snapshot()));
  restore(snap); const r = S.agents.find(x => x.id === a.id);
  ok(r.state === 'downed' && r.down && r.down.f === 1 && r.hp === 0, 'save and restore mid-downed keeps the state and the tally');
  d20(5, 5); tick(2); ok(r.state === 'dead', 'and the saves go on after the restore');}

// 7b. An agent-played hero who is down: acting tools are refused (offline, not a failed turn); reads answer.
world(); {const {markPlayer, playerAct} = await import('../src/sim/player.js'); const a = hero(0), m = mob();
  markPlayer(a, true); down(a, m);
  const r = playerAct(a.id, 'say', {text: 'Help me'}), l = playerAct(a.id, 'look', {});
  ok(r && !r.ok && r.downed && r.offline, 'a downed agent hero cannot act (' + (r && r.error || '').slice(0, 40) + '...)');
  ok(l && l.ok !== false, 'but can still look');}

// 8. Determinism: two runs from the same seed give the same downings and deaths.
const run = () => {seed = 0x1234; forced.length = 0; init({fellowship: false}); for (let i = 0; i < 2400; i++) step(.5);
  const D = downStats(); return JSON.stringify([D, S.facStats, S.agents.map(a => [a.id, a.state, a.lvl, Math.round(a.hp)])])};
const r1 = run(), r2 = run(); const D = JSON.parse(r1)[0];
ok(r1 === r2, 'twenty seeded minutes twice give the same world (' + D.downed + ' downings, ' + D.died + ' died while down)');
ok(D.downed > 0, 'downings happen in an ordinary world');

console.log(fail ? '\n' + fail + ' failed' : '\nall ok');
process.exit(fail ? 1 : 0);
