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
const {dist, CITY, zonePoint} = await import('../src/world/map.js');
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
  // fight in the field, well away from every gate: a hero that flees home from a step outside the gate arrives (state town) within the run
  if (CITY.some(c => dist(a, c.gate) < 12)) {let p = null; for (let i = 0; i < 80 && !p; i++) {const q = zonePoint(a.zone, null, CITY[0].gate); if (CITY.every(c => dist(q, c.gate) >= 12)) p = q} if (p) {a.x = p.x; a.y = p.y}}
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


console.log('tools');
const {snapshot, restore} = await import('../src/sim/save.js');
const {makeWatch} = await import('../src/sim/behavior.js');
const {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
for (const t of ['gambits', 'set_gambit', 'move_gambit', 'toggle_gambit', 'drop_gambit', 'reset_gambits']) ok(PLAYER_TOOLS.some(x => x.name === t), 'tool ' + t + ' is listed');
const K = heroes.find(a => a !== A && a !== Hh && a !== Bb && a !== T && !CLS[a.cls].heal && a.state !== 'dead');
if (!K.player) P.markPlayer(K, true); K.gambits = null; K.gambitDay = null; K.gambitHist = null;
const call = (tool, args) => P.playerAct(K.id, tool, args || {});
let r = call('gambits');
ok(r.ok && r.rules.length === G.presetFor(K.cls).length && /class preset/.test(r.source) && r.conditions && r.actions, 'gambits reads the class preset with the vocabulary (' + r.rules.length + ' rules)');
const playAct0 = K.playActAt;
r = call('set_gambit', {when: 'ally hp below 40', then: 'shout Hold on, I am coming!', before: 1, why: 'my friends first'});
ok(r.ok && K.gambits && K.gambits[0].when === 'ally_hp_below' && K.gambits[0].w.pct === 40 && K.gambits[0].then === 'shout', 'set_gambit adds a rule in words, at the top (' + (r.done || r.error) + ')');
ok(K.playActAt === playAct0, 'editing rules is not an order: autopilot is not ended by it');
const newId = K.gambits[0].id;
r = call('set_gambit', {when: 'sunny day', then: 'flee_home'}); ok(!r.ok && /self_hp_below/.test(r.error), 'an unknown condition is refused, naming the vocabulary');
r = call('set_gambit', {when: 'always', then: 'dance'}); ok(!r.ok && /flee_home/.test(r.error), 'an unknown action is refused, naming the vocabulary');
r = call('set_gambit', {when: 'self_hp_below', then: 'flee_home'}); ok(!r.ok && /needs a share/.test(r.error), 'a condition without its argument is refused with an example');
r = call('move_gambit', {id: newId, after: 'bottom'}); ok(r.ok && K.gambits[K.gambits.length - 1].id === newId, 'move_gambit moves it to the bottom');
r = call('toggle_gambit', {id: newId, on: 'no'}); ok(r.ok && K.gambits.find(x => x.id === newId).on === false, 'toggle_gambit switches it off');
r = call('toggle_gambit', {id: newId, on: 'no'}); ok(!r.ok && /already off/.test(r.error), 'switching it off again is refused');
const flee = K.gambits.find(x => x.then === 'flee_home');
const hist0 = (K.persona && K.persona.hist || []).length;
r = call('drop_gambit', {id: flee.id, why: 'I stand or fall here'});
ok(r.ok && !K.gambits.some(x => x.then === 'flee_home') && /safety rule/.test(r.note || ''), 'dropping the flee rule is allowed, with a note (' + (r.note || r.error) + ')');
ok(K.persona && K.persona.hist.length === hist0 + 1 && /stopped fleeing/.test(K.persona.hist[K.persona.hist.length - 1].why), 'it lands in the persona history ("stopped fleeing: ...")');
ok(K.gambitHist.some(h => h.kind === 'drop' && h.safety), 'and in the edit history, marked as a safety change');
r = call('gambits'); ok(r.no_flee_rule && /one life/.test(r.no_flee_rule), 'gambits marks a list with no flee rule');
// the behavior watch counts it
{const W = makeWatch(); W.tick(); const out = []; for (let i = 0; i < 70 * 60 && !out.some(x => x.kind === 'world'); i++) {step(1 / 60); out.push(...W.tick())}
  const an = out.filter(x => x.kind === 'anomaly' && x.rec.kind === 'no-flee-rule' && x.rec.hero && x.rec.hero.id === K.id), wd = out.find(x => x.kind === 'world');
  ok(an.length === 1, 'the behavior watch flags no-flee-rule once (' + an.length + ')');
  ok(wd && wd.rec.gambits && wd.rec.gambits[K.name] && wd.rec.gambits[K.name].noFlee && wd.rec.gambits[K.name].own, 'the hourly digest counts it per hero (gambits: ' + JSON.stringify(wd && wd.rec.gambits && wd.rec.gambits[K.name]) + ')');
  ok(wd && wd.rec.gambits[K.name].wrote === 1 && wd.rec.gambits[K.name].wroteAb === 0, 'it counts the one rule the hero wrote itself, none with an ability (#779)')}
{r = call('set_gambit', {when: 'always', then: 'use_ability id=taunt'}); const W = K.gambitWrote;
  ok(r.ok && W.n === 2 && W.ab === 1, 'a rule naming use_ability counts as written and as an ability rule (' + JSON.stringify(W) + ')');
  call('set_gambit', {id: K.gambits[0].id, when: 'self_hp_below 50', then: 'drink_potion'}); call('toggle_gambit', {id: K.gambits[0].id, on: 'yes'});
  ok(K.gambitWrote.n === 2, 'changing, moving or switching a rule is not writing a new one')}
// save and restore
const before = JSON.stringify(K.gambits);
restore(JSON.parse(JSON.stringify(snapshot())));
const K2 = S.agents.find(x => x.id === K.id);
ok(K2 && JSON.stringify(K2.gambits) === before, 'the rules survive save and restore');
const call2 = (tool, args) => P.playerAct(K2.id, tool, args || {});
r = call2('reset_gambits', {preset: 'class', why: 'that was foolish'});
ok(r.ok && K2.gambits.some(x => x.then === 'flee_home' && x.on), 'reset_gambits class brings the flee rule back');
r = call2('reset_gambits', {preset: 'reckless'}); ok(!r.ok && /cautious/.test(r.error), 'an unknown preset is refused, naming the presets');
// the day's limit
let n = 0; while (n < 30) {r = call2('toggle_gambit', {id: K2.gambits[0].id}); if (!r.ok) break; n++}
ok(!r.ok && /times today/.test(r.error) && K2.gambitDay.n === 20, 'the day\'s limit stops edits at ' + K2.gambitDay.n + ' (' + r.error + ')');
// privacy: another hero's tools never show a hero's rules
{const secret = 'Zorvath-unique-ward-line'; K2.gambitDay.d = -1;
  r = call2('set_gambit', {when: 'night', then: 'shout ' + secret}); ok(r.ok, 'a shout rule is set (' + (r.done || r.error) + ')');
  const O = S.agents.find(x => x !== K2 && x.kind === 'hero' && x.state !== 'dead' && x.fac === K2.fac); if (!O.player) P.markPlayer(O, true); O.x = K2.x + 1; O.y = K2.y;
  let leak = false; for (const t of ['look', 'status', 'companions', 'gambits', 'earshot', 'party_read', 'chat_read']) {const x = P.playerAct(O.id, t, {}); if (JSON.stringify(x).includes('Zorvath')) leak = true}
  ok(!leak, 'another hero\'s look, status, companions, gambits and chat never show a hero\'s rules')}
// ---------------------------------------------------------------- the hold (#630)
console.log('hold');
{
  const {setRunnerLinks, runnerLinks} = await import('../src/sim/runlink.js');
  const HD = await import('../src/sim/gambithold.js');
  const TBL = await import('../src/sim/table.js');
  const {seatInfo} = await import('../src/sim/player-host.js');
  const {paceBrief} = await import('../src/sim/pace.js');
  const {briefText, holdNote} = await import('../scripts/pacing.mjs');
  const links0 = runnerLinks();
  const W = S.agents.find(x => x.kind === 'hero' && x.state !== 'dead' && !x.party && x.id !== K2.id);
  if (!W.player) P.markPlayer(W, true);
  setRunnerLinks(a => a.id === W.id ? 'connected' : 'none');
  S.gambitHold = null; W.holdDay = null; W.gambits = null;
  const hr = {id: 1, when: 'always', then: 'hold', on: true};
  const mk = () => {W.gambits = [{...hr}, ...G.presetFor(W.cls).map((r, i) => ({...r, id: i + 2}))];};
  ok(D.ACTS.hold && D.ACTS.hold.phase === 'both' && G.presetFor(W.cls).every(r => r.then !== 'hold'), 'hold is in the vocabulary and no class preset uses it');
  ok(G.presetFor(W.cls, 'cautious').some(r => r.then === 'hold' && r.when === 'foe_is' && r.w.what === 'elite' && r.and === 'attacked'), 'the cautious preset holds when an elite attacks');
  let rr = P.playerAct(W.id, 'set_gambit', {when: 'foe_is elite', and: 'attacked', then: 'hold', why: 'test'}); W.gambits = null;
  ok(rr.ok, 'set_gambit takes "then: hold" (' + (rr.done || rr.error) + ')');
  mk(); W.gambitDay = null;
  fightSetup(W, .9); run(.05);
  ok(S.gambitHold && S.gambitHold.id === W.id && S.gambitHold.rid === 1, 'a rule "always -> hold" holds the world for its hero');
  ok((W.playEv || []).some(e => /holds the world/.test(e.text) && e.u), 'and starts the agent\'s turn at once (an urgent event)');
  const g0 = S.gameMin; run(3);
  ok(S.gameMin === g0 && S.gambitHold.s >= 2.9, 'the clock is stopped while held (' + S.gambitHold.s.toFixed(1) + ' s held)');
  const v = P.playerAct(W.id, 'gambits'); ok(v.holding && v.rules.find(x => x.id === 1).holding, 'gambits marks the holding rule');
  ok(seatInfo(W).hold === true, 'the seat info (/play/health) carries hold, so the runner starts at once');
  const br = paceBrief(W.id).brief; ok(br.hold && /hold/.test(br.hold) && /HELD FOR YOU/.test(briefText(br)), 'the turn header says the world is held');
  ok(!holdNote({}) && !seatInfo(S.agents.find(x => x.kind === 'hero' && x !== W)).hold, 'nothing is said for a hero that holds nothing');
  rr = P.playerAct(W.id, 'say', {text: 'I see it'});
  ok(!S.gambitHold, 'the hero\'s next acting call (' + (rr.ok ? 'say' : rr.error) + ') releases the hold');
  const g1 = S.gameMin; run(1); ok(S.gameMin > g1, 'and the world runs on');
  ok(S.gambitStats.holds === 1 && S.gambitStats.holdLog.slice(-1)[0].how === 'answered', 'it is counted (answered)');
  // the gap and the cap
  mk(); W.playActAt = S.gameMin; fightSetup(W, .9); run(.05);
  ok(!S.gambitHold, 'the same rule does not hold again within ' + D.GAMBIT.HOLD_GAP + ' game minutes');
  G.gambitRec(W).once = {}; W.holdDay = {d: Math.floor(S.gameMin / 1440) + 1, n: D.GAMBIT.HOLD_PER_DAY};
  ok(!HD.holdStart(W, hr).ok && /holds/.test(HD.holdStart(W, hr).why), 'a hero is held at most ' + D.GAMBIT.HOLD_PER_DAY + ' times a game day');
  W.holdDay = null; W.gambits = null;
  // the limit in real seconds
  ok(HD.holdStart(W, hr).ok, 'a hold starts'); const t0 = S.gameMin;
  run(D.GAMBIT.HOLD_MAX_S - 5); ok(S.gambitHold && S.gameMin === t0, 'it waits for the agent');
  run(10);
  ok(!S.gambitHold && S.gambitStats.holdExpired === 1 && S.gambitStats.holdLog.slice(-1)[0].how === 'expired', JSON.stringify([!!S.gambitHold, S.gambitStats.holdExpired, S.gambitStats.holdLog.slice(-1)[0]]) + ' after ' + D.GAMBIT.HOLD_MAX_S + ' real seconds with no act it releases (expired)');
  {const Wt = makeWatch(); Wt.tick(); S.table = null; S.tables = {}; HD.holdStart(W, hr); S.gambitHold.s = D.GAMBIT.HOLD_MAX_S - .01; run(1); const out = Wt.tick();
    ok(out.some(x => x.kind === 'anomaly' && x.rec.kind === 'hold-expired'), 'the behavior watch flags hold-expired')}
  // the runner is gone
  HD.holdStart(W, hr); setRunnerLinks(() => 'none'); run(.1);
  ok(!S.gambitHold && S.gambitStats.holdLog.slice(-1)[0].how === 'no-runner', 'with no runner the hold releases at once and the reflexes play');
  ok(!HD.holdStart(W, hr).ok, 'and none starts without a live runner'); S.gambitHold = null;
  setRunnerLinks(a => a.id === W.id ? 'connected' : 'none');
  // a Table scene already waits: no hold
  S.tables = S.tables || {}; const fake = {ids: [W.id]}; S.tables.__hold = fake;
  ok(!HD.holdStart(W, hr).ok && /Table/.test(HD.holdStart(W, hr).why), 'a hold at a Table scene is a no-op (the table already waits)');
  delete S.tables.__hold;
  // owner override and speed
  ok(HD.holdStart(W, hr).ok, 'a hold starts again'); TBL.TABLE.speed = 3; TBL.TABLE.drop = null; HD.holdTick(.1);
  ok(TBL.TABLE.drop && /held for/.test(TBL.TABLE.drop.reason), 'above 1x it asks the host for 1x'); TBL.TABLE.speed = 1; TBL.TABLE.drop = null;
  HD.holdResume(); ok(!S.gambitHold && S.gambitStats.holdLog.slice(-1)[0].how === 'owner', 'Resume anyway (the owner) releases it');
  // death
  HD.holdStart(W, hr); const hp = W.hp; W.state = 'dead'; HD.holdTick(.1); ok(!S.gambitHold, 'a hold ends with its hero'); W.state = 'town'; W.hp = hp;
  setRunnerLinks(links0); W.gambits = null;
}
// ---------------------------------------------------------------- the diff against the class preset (#679)
console.log('\nhow a list differs from its class preset (#679)');
{
  const Wr = S.agents.find(a => a.kind === 'hero' && a.cls === 'Warrior' && a.state !== 'dead');
  const saved = Wr.gambits, hist = Wr.gambitHist, day = Wr.gambitDay; Wr.gambits = null; Wr.gambitHist = []; Wr.gambitDay = null;
  if (!Wr.player) P.markPlayer(Wr, true);
  const Pr = G.presetFor('Warrior'), idOf = t => Pr.find(r => r.then === t).id, fleeId = idOf('flee_home'), potId = idOf('drink_potion');
  let d = G.gambitDiff(Wr);
  ok(d.unchanged && !d.edited && d.summary === 'class preset, unchanged' && d.rules.every(r => r.status === 'same' && !r.moved) && !d.dropped.length, 'an untouched preset: "' + d.summary + '"');
  const s0 = JSON.stringify(G.gambitDiff(Wr)); ok(s0 === JSON.stringify(G.gambitDiff(Wr)) && !Wr.gambits, 'the diff is read-only and repeats');
  // added
  G.setGambit(Wr, {when: 'self_hp_below 25', then: 'shout Fall back!', why: 'call for help'});
  d = G.gambitDiff(Wr); let r = d.rules.find(x => x.status === 'added');
  ok(d.counts.added === 1 && r && r.edit && r.edit.why === 'call for help' && /1 added/.test(d.summary), 'added: ' + d.summary);
  // changed (arguments of a preset rule, same id)
  const restId = Pr.find(x => x.then === 'rest' && x.w && x.w.pct === 60).id;
  G.setGambit(Wr, {id: restId, when: 'self_hp_below 70', then: 'rest 60 yes', why: 'rest sooner'});
  d = G.gambitDiff(Wr); r = d.rules.find(x => x.id === restId);
  ok(r.status === 'changed' && r.preset && /pct: 60/.test(r.preset.rule) && /pct: 70/.test(r.rule) && r.edit.why === 'rest sooner', 'changed: rule ' + restId + ' shows the preset version (' + r.preset.rule + ')');
  // moved
  G.moveGambit(Wr, {id: potId, before: 'top', why: 'potions first'});
  d = G.gambitDiff(Wr); r = d.rules.find(x => x.id === potId);
  ok(r.moved === 'up' && r.status === 'same' && d.counts.moved === 1 && d.rules.filter(x => x.moved).length === 1, 'moved: only the rule moved is marked (up), ' + d.summary);
  // turned off: a safety rule
  G.toggleGambit(Wr, {id: fleeId, on: 'no', why: 'stand and fight'});
  d = G.gambitDiff(Wr); r = d.rules.find(x => x.id === fleeId);
  ok(r.status === 'off' && d.safety.flee === 'off' && /flee rule off/.test(d.summary), 'off: ' + d.summary);
  // a tank's off suggestion turned on is a change
  const guardId = idOf('guard'); G.toggleGambit(Wr, {id: guardId, on: 'yes'});
  ok(G.gambitDiff(Wr).rules.find(x => x.id === guardId).status === 'changed', 'the guard suggestion turned on reads as changed');
  // dropped
  G.dropGambit(Wr, {id: fleeId, why: 'one life, no running'});
  d = G.gambitDiff(Wr);
  ok(d.dropped.length === 1 && d.dropped[0].id === fleeId && d.dropped[0].safety === 'flee' && d.safety.flee === 'gone' && /1 dropped/.test(d.summary) && /flee rule gone/.test(d.summary), 'dropped: ' + d.summary);
  // weakened: a potion rule changed while another potion rule stands
  G.setGambit(Wr, {id: potId, when: 'self_hp_below 10', then: 'drink_potion'}); G.setGambit(Wr, {when: 'foe_is elite', then: 'drink_potion'});
  ok(G.gambitDiff(Wr).safety.potion === 'weakened', 'weakened: a preset potion rule changed while another stands');
  // the purpose line names the hero's own rule
  ok(G.ownRule(Wr, d.rules.find(x => x.status === 'added').id) && !G.ownRule(Wr, idOf('defend')), 'ownRule: an added rule is the hero\'s own, a preset rule is not');
  // reset
  G.resetGambits(Wr, {preset: 'class', why: 'back to basics'});
  d = G.gambitDiff(Wr); ok(d.unchanged && d.edited && d.summary === 'own list, same as the Warrior preset' && d.rules.every(r => !r.edit), 'after reset: "' + d.summary + '"');
  G.resetGambits(Wr, {preset: 'cautious'}); d = G.gambitDiff(Wr);
  ok(d.counts.added === 2 && !d.counts.dropped && !Object.keys(d.safety).length, 'the cautious preset: ' + d.summary);
  G.resetGambits(Wr, {preset: 'empty'}); d = G.gambitDiff(Wr);
  ok(d.dropped.length === Pr.length && d.safety.flee === 'gone' && d.safety.potion === 'gone' && d.safety.defend === 'gone', 'the empty preset: ' + d.summary);
  // the cap is 30 (#779): the class presets stay as they were, the list may grow to 30 and the 31st is refused naming 30
  ok(D.GAMBIT.MAX === 30 && Pr.length < 30 && !Pr.some(x => x.then === 'use_ability'), 'the cap is 30; the class preset is untouched and has no use_ability rule');
  Wr.gambitDay = null; let n = 0; while (n < 40 && G.setGambit(Wr, {when: 'always', then: 'rest 60'}).ok) { n++; Wr.gambitDay = null }
  ok(Wr.gambits.length === 30 && n === 30, 'a hero can keep 30 rules (' + Wr.gambits.length + ')');
  r = G.setGambit(Wr, {when: 'always', then: 'rest 60'}); ok(!r.ok && /at most 30 rules/.test(r.error), 'the 31st is refused: ' + r.error);
  ok(G.gambitsView(Wr).max_rules === 30 || JSON.stringify(G.gambitsView(Wr)).includes('30'), 'gambits shows the 30 cap');
  Wr.gambits = saved; Wr.gambitHist = hist; Wr.gambitDay = day; delete Wr.gambitWrote;
}

// ---------------------------------------------------------------- the downed (#658)
console.log('\nthe downed (#658): aid rules and presets');
{
  ok(D.CONDS.ally_downed && D.CONDS.no_healer && D.CONDS.self_downed_count && ['revive_ally', 'stabilize', 'carry'].every(k => D.ACTS[k] && D.ACTS[k].phase === 'aid'), 'conditions ally_downed, no_healer, self_downed_count and aid actions revive_ally, stabilize, carry are in the vocabulary');
  for (const cls of Object.keys(CLS)) {const L = G.presetFor(cls), heal = L.findIndex(r => r.then === 'heal');
    const rv = L.findIndex(r => r.when === 'ally_downed' && r.then === 'revive_ally'), st = L.find(r => r.when === 'ally_downed' && r.then === 'stabilize');
    ok(rv >= 0 && st && st.and === 'no_healer' && (CLS[cls].heal ? !L[rv].and && rv < heal : L[rv].and === 'no_healer'), cls + (CLS[cls].heal ? ': "ally downed -> revive_ally" above its heal rule' : ': "ally downed and no healer -> revive_ally" (a potion)') + ', and "ally downed and no healer -> stabilize"');}
  const V = G.vocabulary(); ok(V.actions.some(x => /^carry <to>/.test(x) && /when a companion goes down/.test(x)), 'the vocabulary names when aid rules act');
  // words: the new conditions and actions parse
  ok(JSON.stringify(G.parseWords(D.CONDS, 'self downed count 2 days 3', 'condition')) === JSON.stringify({name: 'self_downed_count', args: {n: 2, days: 3}}), 'set_gambit words: "self downed count 2 days 3"');
  ok(G.parseWords(D.ACTS, 'carry camp', 'action').args.to === 'camp' && G.parseWords(D.ACTS, 'carry', 'action').args.to === 'town' && G.parseWords(D.ACTS, 'carry somewhere', 'action').error, 'carry {to} defaults to town; to is town, camp or leader');
  ok(G.parseWords(D.CONDS, 'self_downed_count', 'condition').error, 'self_downed_count needs n');
  // the conditions read the world; the aid actions never run between turns or in a fight
  init({fellowship: false}); run(5);
  const L = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && !a.party && !CLS[a.cls].heal).slice(0, 2), [X, Y] = L;
  for (const a of L) {if (!a.player) P.markPlayer(a, true); a.pq = []; a.state = 'hunt'; a.x = 40; a.y = 25; a.hidden = false}
  Y.x = 43; const pt = {id: 991, fac: X.fac, leader: X, mem: [X, Y], zone: 1, home: false}; S.parties.push(pt); X.party = Y.party = pt; Y.fac = X.fac;
  Y.state = 'downed'; Y.hp = 0; Y.down = {at: S.gameMin, next: 1e9, s: 0, f: 0, stable: false, wake: 0, by: {kind: 'mob'}}; rebuild();
  const ctx = {field: true, town: false};
  X.gambits = [{id: 1, when: 'ally_downed', then: 'revive_ally', on: true}, {id: 2, when: 'ally_downed', then: 'wake_me', on: true}]; X.gambitsDown = 1;
  const ev0 = X.playEvN || 0; G.idlePick(X, ctx);
  ok(G.gambitRec(X).last && G.gambitRec(X).last.id === 2 && (X.playEvN || 0) > ev0, 'between turns an aid rule is skipped; "ally downed -> wake_me" calls the hero');
  X.gambits = [{id: 1, when: 'ally_downed', w: {who: 'nobody'}, then: 'wake_me', on: true}]; G.gambitRec(X, true).last = null; G.idlePick(X, ctx);
  ok(!G.gambitRec(X).last, 'ally_downed {who} names one companion');
  X.downs = [S.gameMin - 3000, S.gameMin - 10]; X.gambits = [{id: 1, when: 'self_downed_count', w: {n: 2}, then: 'wake_me', on: true}, {id: 2, when: 'self_downed_count', w: {n: 2, days: 1}, then: 'hold_position', on: true}];
  G.gambitRec(X, true).last = null; G.gambitRec(X).once = {}; G.idlePick(X, ctx); ok(G.gambitRec(X).last && G.gambitRec(X).last.id === 1, 'self_downed_count 2 holds after two downings in a life');
  X.gambits.shift(); G.gambitRec(X, true).last = null; G.idlePick(X, ctx); ok(!G.gambitRec(X).last, 'but not "in the last day" when one was days ago');
  // set_gambit through the tool, and the edit keeps the aid rules of an older list
  X.gambits = null; X.gambitsDown = 0; X.gambitDay = null;
  let r = P.playerAct(X.id, 'set_gambit', {when: 'ally downed', then: 'carry camp', why: 'get them to the fire'});
  ok(r.ok && X.gambits.some(x => x.then === 'carry' && x.t.to === 'camp') && X.gambits.filter(x => D.ACTS[x.then].phase === 'aid').length === 3, 'set_gambit "ally downed -> carry camp" joins the preset aid rules (' + (r.done || r.error) + ')');
  ok(G.aidPlan(X, Y, {noHealer: true}).how.carry === 'camp', 'aidPlan: every aid rule that holds adds what the hero does (revive, stabilize, carry to camp)');
  const old = G.presetFor(X.cls).filter(x => x.when !== 'ally_downed').map(x => ({...x})); X.gambits = old; delete X.gambitsDown; X.gambitDay = null;
  r = P.playerAct(X.id, 'drop_gambit', {id: 999});
  ok(!r.ok && X.gambits.filter(x => x.when === 'ally_downed').length === 2, 'a refused edit on an older list keeps the aid rules it took');
  const d = G.gambitDiff(X); ok(!d.dropped.some(x => x.rule.startsWith('ally_downed')), 'the diff reads the migrated aid rules as the preset rules');
}
console.log('\n' + (fail ? fail + ' FAILED' : 'all ok'));
process.exit(fail ? 1 : 0);
