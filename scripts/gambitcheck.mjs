// Gambits check (issue #617): an agent hero's own ordered rules, run by autopilot and the reflexes. No model, no network.
//   --hash   a seeded world with a dozen agent heroes left on autopilot (town, field, hunts, follows, fights, flee marks)
//            hashed; with the class presets it must equal origin/main's (run it there too: npm run hashcheck does)
// Usage: node scripts/gambitcheck.mjs [--hash]
const argv = process.argv.slice(2);
let seed = 0x617a;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S} = SIM;
const P = await import('../src/sim/player.js');

// ---------------------------------------------------------------- the autopilot hash
// Twelve heroes of every level band made agent-played and left alone for 30 game hours: autopilot does it all (town rests,
// sells, potions, hunts, moving on, heading home, the fight reflexes). The hash covers where they are and what they did.
function autopilotHash(fellowship) {
  seed = 0x617a ^ (fellowship ? 1 : 0);
  init({fellowship}); for (let i = 0; i < 60 * 20; i++) step(1 / 60);
  const pick = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && !a.player).sort((x, y) => x.id - y.id).filter((a, i) => i % 3 === 0).slice(0, 12);
  for (const a of pick) {P.markPlayer(a, true); a.playActAt = S.gameMin - 200}
  pick[0].playOrder = {kind: 'hunt', n: 4}; // a last hunt order autopilot carries on
  let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
  for (let i = 0; i < 300 * 60; i++) {step(1 / 60); if (i % 600 === 0) for (const a of pick) feed([a.id, a.state, a.x.toFixed(2), a.y.toFixed(2), Math.round(a.hp), a.pq && a.pq[0] ? a.pq[0].kind + (a.pq[0].auto || '') : '-'].join(','))}
  for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(','));
  return {h, dead: pick.filter(a => a.state === 'dead').length, kills: pick.reduce((n, a) => n + a.kills, 0)};
}
if (argv.includes('--hash')) {
  for (const f of [false, true]) {const r = autopilotHash(f); console.log('HASH autopilot fellowship=' + f + ' ' + r.h + ' (agent heroes dead ' + r.dead + ', kills ' + r.kills + ')')}
  process.exit(0);
}

// ---------------------------------------------------------------- the engine
const G = await import('../src/sim/gambits.js');
const D = await import('../src/data/gambits.js');
const {CLS} = await import('../src/data/classes.js');
const {maxHp} = await import('../src/sim/heroes.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {dist} = await import('../src/world/map.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
console.log('\nEldmoor gambitcheck: agent heroes\' own rules (#617)\n');

console.log('presets');
for (const cls of Object.keys(CLS)) {
  const L = G.presetFor(cls);
  ok(L.length <= D.GAMBIT.MAX && L.every(r => D.CONDS[r.when] && D.ACTS[r.then] && (!r.and || D.CONDS[r.and])), cls + ': ' + L.length + ' rules, every condition and action in the vocabulary');
  ok(!!CLS[cls].heal === L.some(r => r.then === 'heal'), cls + (CLS[cls].heal ? ' casts heals: its preset heals' : ' has no heal rule'));
  ok(L.some(r => r.then === 'flee_home' && r.on) && L.some(r => r.then === 'defend' && r.on) && L.some(r => r.then === 'drink_potion' && r.on), cls + ': flee, defend and potion rules are on');
}
ok(G.presetFor('Warrior').some(r => r.then === 'guard' && r.on === false), 'a tank\'s guard suggestion is in its list, off');
ok(Object.isFrozen(G.presetFor('Mage')), 'presets are shared and frozen (never stored on a hero)');

// a fight: a hero, a creature on it, the hero at low HP
init({fellowship: false}); run(5);
const heroes = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && !a.party);
const fightSetup = (a, hpShare, lvl) => {
  if (!a.player) P.markPlayer(a, true);
  a.pq = []; a.party = null; a.partyOk = false; a.adv = null; a.traits = []; a.hidden = false; a.playActAt = S.gameMin; a.playIdle = false; a.playTurn = null;
  const m = S.mobs.find(x => x.alive && !x.gone && !x.elite && !x.named && !x.target && dist(x, a) > 3);
  for (const x of S.mobs) if (x !== m && x.target === a) x.target = null;
  m.x = a.x + .6; m.y = a.y; m.lvl = lvl == null ? a.lvl : lvl; m.hp = m.maxhp; m.target = a; a.target = m; a.state = 'fight'; a.hp = maxHp(a) * hpShare; a.cd = 5; rebuild();
  return m};

console.log('flee rule');
let A = heroes.find(a => !CLS[a.cls].heal);
fightSetup(A, .1); run(.05);
ok(A.state === 'return', 'with its class preset a hero below its flee mark breaks off (' + A.state + ')');
ok(G.gambitRec(A) && G.gambitRec(A).last && G.gambitRec(A).last.then === 'flee_home', 'the flee rule is the last that fired');
A.gambits = G.presetFor(A.cls).filter(r => r.then !== 'flee_home').map(r => ({...r}));
fightSetup(A, .1); run(.05);
ok(A.state === 'fight', 'with the flee rule dropped it fights on at 10% HP (' + A.state + ')');
A.gambits = [...G.presetFor(A.cls).map(r => ({...r}))]; A.gambits.unshift({id: 99, when: 'self_hp_below', w: {pct: 60}, then: 'flee_home', on: true});
fightSetup(A, .5); run(.05);
ok(A.state === 'return', 'a rule "self_hp_below 60 -> flee_home" breaks off at half health');
A.gambits = null;

console.log('heal rule');
const Hh = heroes.find(a => CLS[a.cls].heal && a !== A), Bb = heroes.find(a => a !== A && a !== Hh && a.fac === Hh.fac);
fightSetup(Hh, 1);
P.markPlayer(Bb, true); Bb.x = Hh.x + 1; Bb.y = Hh.y; Bb.hp = maxHp(Bb) * .65; Bb.state = 'hunt'; Bb.pq = []; Bb.playActAt = S.gameMin; Bb.party = null;
const party = {leader: Hh, mem: [Hh, Bb]}; Hh.party = party; Bb.party = party; Hh.partyOk = Bb.partyOk = true; Hh.healCd = 0; rebuild();
let hp0 = Bb.hp; run(.05);
ok(Bb.hp - hp0 < 5, 'the preset heals only below its own mark (about 55%): a companion at 65% is left alone');
Hh.gambits = [{id: 1, when: 'ally_hp_below', w: {pct: 70}, then: 'heal', on: true}, ...G.presetFor(Hh.cls).filter(r => r.then !== 'heal').map((r, i) => ({...r, id: i + 2}))];
Hh.healCd = 0; Hh.hp = maxHp(Hh); Bb.hp = maxHp(Bb) * .65; hp0 = Bb.hp; run(.05);
ok(Bb.hp - hp0 >= 20, 'a rule "ally_hp_below 70 -> heal" heals the companion at 65% (' + Math.round(hp0) + ' -> ' + Math.round(Bb.hp) + ')');
ok(G.gambitRec(Hh).last && G.gambitRec(Hh).last.id === 1, 'that rule is the last that fired');
Hh.party = null; Bb.party = null; Hh.gambits = null;

console.log('autopilot');
// the engine is what autopilot runs: an emptied list leaves an idle hero standing in town
const T = heroes.find(a => a !== A && a !== Hh && a !== Bb);
const toTown = a => {const c = S.agents && a; a.target = null; a.pq = []; a.state = 'town'; a.hp = maxHp(a); a.playActAt = S.gameMin - 200; a.playIdle = false; a.playTurn = null};
if (!T.player) P.markPlayer(T, true);
T.gambits = []; T.party = null; toTown(T); T.x = (await import('../src/data/races.js')).homeOf(T).gate.x; T.y = (await import('../src/data/races.js')).homeOf(T).gate.y; run(.2);
ok(T.playIdle && !(T.pq || []).length, 'with no rules autopilot starts nothing (' + ((T.pq || [])[0] || {}).kind + ')');
T.gambits = [{id: 1, when: 'in_town', then: 'rest', t: {minutes: 30}, on: true}]; T.hp = maxHp(T) * .99; run(.05);
ok(G.gambitRec(T) && G.gambitRec(T).last && G.gambitRec(T).last.then === 'rest' && G.gambitRec(T).last.id === 1, 'a rule "in_town -> rest {minutes: 30}" rests in town');
T.gambits = null;

console.log('\n' + (fail ? fail + ' FAILED' : 'all ok'));
process.exit(fail ? 1 : 0);
