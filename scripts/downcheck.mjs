// Downed and death saves (#626 slices 1a #652, 1b #653 and the agent side #658): a hero at zero HP is downed, rolls death saves,
// can be stabilized, healed or given a potion by a friend, and dies only through slay() -> fall().
// The dice are forced through a stubbed Math.random (core/rng.js captures it at load), so every case is exact.
// At the table (#654): a downing in the world with an agent involved opens a rescue scene (the world holds), saves are per
// round in initiative order, a companion stabilizes as their act, three failures at the table kill, a combat scene
// goes on past its rounds while someone bleeds, and a foe strikes the downed only when nobody else stands.
// Usage: node scripts/downcheck.mjs
let seed = 0x5eed; const forced = [];
Math.random = () => {if (forced.length) return forced.shift(); seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const d20 = (...v) => {for (const x of v) forced.push((x - 1) / 20 + .01)}; // ri(1,20) reads one rnd()
const {init, step, S, snapshot, restore} = await import('../src/sim/index.js');
const {agentDie, maxHp} = await import('../src/sim/heroes.js');
const {DOWN, downHit, foeOnDowned, downStats, downedStep} = await import('../src/sim/downed.js');
const {addUse} = await import('../src/sim/inv.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {MERCY, mercyStats, finishTool, spareTool, finishOdds} = await import('../src/sim/mercy.js');
const {pvpCheck} = await import('../src/sim/pvp.js');
const {setRunnerLinks} = await import('../src/sim/runlink.js');
const {markPlayer} = await import('../src/sim/player.js');
const {tiersOf} = await import('../src/sim/tiers.js');
const {zoneAt} = await import('../src/world/map.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor downcheck\n');

// A quiet corner: no mobs, every other hero home in town; heroes under test stand in the open.
const P = {x: 40, y: 25};
const SP = (() => {for (let x = 40; x < 80; x++) if (zoneAt(x, 25) >= 1) return {x: x + 2, y: 25}; return P})(); // outside the safe zone, where duels happen
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
  const c = hero(2); c.hp = -1; forced.push(.5, .001); agentDie(c, b); // pop's jitter, then the victor's die: under the odds, a finish
  ok(c.state === 'dead' && S.recruits.length === 1, 'a hero downed by an enemy who rolls to finish dies (#657)');
  const e = hero(3); e.hp = -maxHp(e) - 1; agentDie(e, m);
  ok(e.state === 'dead', 'a blow from zero past full health kills outright');
  ok(downStats().why.massive === 1 && mercyStats().finished === 1, 'the summary counts both');}

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

// 7c. At the table (#654). Companies of agent heroes with no runner host: reflexes act at once, the world pauses at 1x.
{const T = await import('../src/sim/table.js'), TRD = await import('../src/sim/tableround.js'), {markPlayer} = await import('../src/sim/player.js');
  const CO = await import('../src/sim/company.js'), {tableSave} = await import('../src/sim/downed.js'), {addUse: addU} = await import('../src/sim/inv.js');
  const company = (...L) => {for (const b of L) markPlayer(b, true); const C = CO.companyOf(L[0]); for (const b of L.slice(1)) {CO.leaveCompany(b); CO.joinCompany(C, b)} return C};
  const scene = a => S.table && S.table.ids.includes(a.id) ? S.table : null;
  const runScene = (sc, max = 6000, act) => {let k = 0; while (S.table === sc && k++ < max) {if (act) act(sc); step(1 / 60)} return S.table !== sc};
  const saves = (sc, a) => sc.beats.filter(b => b.k === 'save' && b.id === a.id);
  const RL = await import('../src/sim/runlink.js'); RL.setRunnerLinks(x => 'connected'); // a host whose runners hold every agent: the company has the say
  const LM = T.TABLE.liveMs, TM = T.TABLE.turnMs; T.TABLE.liveMs = 60; T.TABLE.turnMs = 20; // a silent agent's reflex acts after a short wait
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';

  // (a) a downing in the world with an agent involved opens a rescue scene, the world holds, saves per round; a stabilize ends it
  world(); {const a = hero(0), b = hero(1, 'Warrior'), m = mob(); b.x = a.x + 2; b.y = a.y;
    const C = company(a, b); mates(a, b); addU(b, 'Linen Bandage', 1);
    ok(C && C.ids.length === 2 && a.player && b.player, 'a company of two agent heroes (no runner host: reflexes act at once)');
    down(a, m); m.alive = false; // the foe that did it is gone: only the bleeding is left
    ok(a.state === 'downed' && !scene(a), 'downed in the world, no scene yet');
    T.tableTick(); const sc = scene(a);
    ok(sc && sc.kind === 'rescue' && sc.ctx.down === 1 && sc.pause && sc.ids.includes(b.id), 'a downing with an agent involved opens a rescue scene (' + (sc && sc.title) + '), paused at 1x');
    const g0 = S.gameMin; let k = 0; while (S.table === sc && sc.phase === 'frame' && k++ < 600) step(1 / 60);
    ok(S.gameMin === g0, 'the world holds while the scene frames');
    ok(sc && T.optionsFor(sc, a).length === 0 && /down and bleeding/.test(T.sceneAct(a, 'strike', '')), 'the downed one has no options and scene_act is refused');
    ok(sc && T.optionsFor(sc, b).some(o => o.k === 'stabilize' && /Linen Bandage/.test(o.text)), 'a companion is offered stabilize (' + (sc && (T.optionsFor(sc, b).find(o => o.k === 'stabilize') || {}).text) + ')');
    const tv = sc && T.tableView(a); ok(tv && tv.you_are_down && tv.downed && tv.downed[0].name === a.name, 'the table view says who is down and their tally');
    runScene(sc);
    ok(S.gameMin === g0 || !scene(a), 'the scene resolved at the table');
    ok(a.state === 'downed' && a.down && a.down.stable, 'the companion\'s reflex was stabilize (no healer stands): the bandage makes them stable');
    ok(sc.beats.some(x => x.id === b.id && x.k === 'stabilize'), 'the stabilize is the companion\'s act at the table');
    ok(S.table !== sc && sc.phase !== 'turn', 'the scene ends once nobody bleeds');}

  // (b) per round, in initiative order: a lone downed agent rolls a save each round, three failures and it dies
  world(); {const a = hero(0), m = mob(); company(a); down(a, m); m.alive = false;
    T.tableTick(); const sc = scene(a);
    ok(sc && sc.kind === 'rescue' && sc.ids.length === 1, 'a solo agent downed alone still gets the rescue scene (rounds, not a stopwatch)');
    d20(5, 9, 3); runScene(sc);
    const sv = saves(sc, a);
    ok(sv.length === 3 && sv.map(x => x.rd).join() === '1,2,3', 'one death save a round (rounds ' + sv.map(x => x.rd).join(',') + ')');
    ok(sv[0].check && sv[0].check.kind === 'death' && sv[0].check.die === 5 && /a failure/.test(sv[0].res), 'the save is on the beat as a check (' + (sv[0] && sv[0].res) + ')');
    ok(a.state === 'dead' && S.facStats[a.fac].fallen === 1 && /3 failures: dead/.test(sv[2].res), 'the third failure at the table is death, through fall (' + sv[2].res + ')');
    ok(/fell\./.test(sc.summary || ''), 'the outcome says who fell: ' + sc.summary);}
  // the save rules at the table: a 20 rises, three successes with kin is stable, without is dying alone, a healer gives a fourth failure
  world(); {const a = hero(0), m = mob(); down(a, m); d20(20); const r = tableSave(a, {kin: true});
    ok(r.out === 'rose' && a.hp === 1 && a.state !== 'downed', 'a natural 20 at the table: up on 1 HP');}
  world(); {const a = hero(0), m = mob(); down(a, m); d20(10, 12, 15); let r; for (let i = 0; i < 3; i++) r = tableSave(a, {kin: true});
    ok(r.out === 'stable' && a.down.stable, 'three successes with someone standing at the table: stable');}
  world(); {const a = hero(0), m = mob(); down(a, m); d20(10, 12, 15); let r; for (let i = 0; i < 3; i++) r = tableSave(a, {kin: false});
    ok(r.out === 'dead' && a.state === 'dead', 'three successes with nobody standing: dies alone');}
  world(); {const a = hero(0), m = mob(); down(a, m); d20(2, 3, 4); let r; for (let i = 0; i < 3; i++) r = tableSave(a, {kin: true, healer: true});
    ok(r.out === 'failure' && r.f === 3 && r.of === 4 && a.state === 'downed', 'a healer standing at the table: three failures are not yet four');}

  // (c) a downing inside a combat scene: the hero stays in it, downed; the scene goes on past its rounds while they bleed
  world(); {const a = hero(0), b = hero(1, 'Warrior'), m = mob(); const C = company(a, b); mates(a, b);
    m.maxhp = m.hp = 40000; m.hit = .001; m.cd = 99; m.x = a.x + 1; m.y = a.y;
    for (const x of [a, b]) {x.state = 'fight'; x.target = m}
    const R0 = TRD.TR.ROUNDS; TRD.TR.ROUNDS = 1;
    const sc = T.openScene('rescue', a.name + ' is going down', [a, ' is down.'], {hero: a.id, mob: m.id}, C);
    ok(sc && sc.rd === 1 && sc.ids.length === 2, 'a combat scene in rounds is open');
    rebuild(); a.hp = -3; (await import('../src/sim/heroes.js')).agentDie(a, m);
    ok(a.state === 'downed' && sc.ids.includes(a.id), 'a member at zero inside the scene is downed and stays at the table (no instant death)');
    runScene(sc, 6000, sc => {if (sc.phase === 'turn' && !sc.acts[b.id]) T.sceneAct(b, 'guard', '')}); // the companion holds the foe off each round
    const sv = saves(sc, a);
    ok(sc.rd >= 2 && sv.length >= 2 && sv.every((x, i) => x.rd === i + 1), 'the scene went on past TR.ROUNDS 1 while they bled: ' + sc.rd + ' rounds, a save in each (' + sv.map(x => x.res.replace(/^death save /, '')).join(' | ') + ')');
    ok(!sc.beats.some(x => x.by === 'foe' && /where they lie/.test(x.text)), 'the foe kept to the one standing (it does not finish)');
    ok(!(a.state === 'downed' && a.down && !a.down.stable) || sc.rd >= T.TABLE.DOWN_ROUNDS, 'when it ended nobody still bled (or the rescue cap was reached)');
    TRD.TR.ROUNDS = R0;}

  // (d) the foe strikes the downed only when nobody else stands
  world(); {const a = hero(0), m = mob(); const C = company(a);
    m.maxhp = m.hp = 40000; m.cd = 99; m.x = a.x + 1; m.y = a.y; a.state = 'fight'; a.target = m;
    const sc = T.openScene('rescue', a.name + ' is going down', [a, ' is down.'], {hero: a.id, mob: m.id}, C);
    rebuild(); a.hp = -3; (await import('../src/sim/heroes.js')).agentDie(a, m);
    runScene(sc);
    ok(sc.beats.some(x => x.by === 'foe' && /where they lie/.test(x.text)), 'with nobody else standing the foe strikes the one who lies down');
    ok(a.state === 'dead' || !a.down || a.down.stable || sc.rd >= T.TABLE.DOWN_ROUNDS, 'and it ended at the dice (' + a.state + ', ' + sc.rd + ' rounds)');}
  // (e) a PvP downing at a Table scene (#657 at the table): the hero goes down there too, and the scripted victor finishes or spares at once
  world(); {const a = hero(0), k = hero(1); const C = company(a); k.fac = 1 - a.fac; k.nemesis = {}; a.nemesis = {}; k.player = false;
    k.state = 'duel'; k.target = a; a.state = 'duel'; a.target = k; k.x = a.x + 1; k.y = a.y;
    const sc = T.openScene('ambush', 'Ambush: ' + k.name, [k, ' falls on ', a, '.'], {foe: k.id}, C);
    rebuild(); a.hp = -3; (await import('../src/sim/heroes.js')).agentDie(a, k);
    const spared = a.state === 'downed' && a.down && a.down.stable && a.debts && a.debts[k.id], finished = a.state === 'dead';
    ok(sc && sc.ids.includes(a.id) && (spared || finished), 'a PvP downing at a Table scene goes through finish or spare (' + (spared ? 'spared: stable, owes a life' : finished ? 'finished' : a.state) + ')');
    T.TABLE.mode = 'off'; T.tableHold(0); T.TABLE.mode = 'auto';}
  RL.setRunnerLinks(null); T.TABLE.liveMs = LM; T.TABLE.turnMs = TM;
}


// 9b. PvP finish or spare (#657). A hero's blow downs an enemy hero; the victor finishes or spares.
const foes = () => {const a = hero(0), k = hero(1); a.fac = 0; k.fac = 1; a.lvl = 6; k.lvl = 7; a.nemesis = {}; k.nemesis = {}; return [a, k]};
world(); {const [a, k] = foes(); const h0 = k.honor, g0 = a.gold = 100;
  rebuild(); a.hp = -1; forced.push(.5, .999); agentDie(a, k); // pop's jitter, then the victor's die: over the odds, a spare
  ok(a.state === 'downed' && a.down.stable && a.debts && a.debts[k.id], 'a scripted victor who rolls high spares: stable, and a life-debt on the spared');
  ok(k.honor === h0 && a.gold === g0 && mercyStats().spared === 1, 'sparing takes no honour and no gold');
  ok(S.chronicle.some(e => e.parts.some(p => p === ' spared ')), 'the chronicle names the mercy');
  const vf = {...k, nemesis: {[a.id]: 'Bram'}}; ok(finishOdds(vf, a) === 1, 'a sworn blood debt is always finished');
  ok(finishOdds(k, a) >= MERCY.MIN && finishOdds(k, a) <= MERCY.MAX, 'otherwise the odds are bounded (' + finishOdds(k, a).toFixed(2) + ')');}

// An agent victor whose runner holds it waits; a third hero who finishes takes the honour, the XP and the gold.
world(); {const [a, k] = foes(), f = hero(2); f.fac = 1; f.lvl = 7; f.nemesis = {}; a.gold = 200;
  markPlayer(k, true); setRunnerLinks(x => x === k ? 'connected' : 'none');
  rebuild(); a.hp = -1; agentDie(a, k);
  ok(a.state === 'downed' && a.down.victor === k.id, 'an agent victor with a live runner gets the choice (the downed waits)');
  const kh = k.honor, kx = k.xp, kg = k.gold, fh = f.honor, fx = f.xp, fg = f.gold;
  rebuild(); const r = finishTool(f, a.name);
  ok(r.ok && a.state === 'dead', 'finish {hero} kills the downed enemy');
  ok(f.honor > fh && f.xp !== fx && f.gold === fg + 20, 'honour, XP and a tenth of the gold go to the finisher (' + (f.honor - fh) + ' honour, ' + (f.gold - fg) + 'g)');
  ok(k.honor === kh && k.xp === kx && k.gold === kg, 'the one who downed them gets nothing');
  setRunnerLinks(null);}

// Left to bleed: an agent victor who never chooses; the downed fails their saves; nobody gets the credit.
world(); {const [a, k] = foes(); markPlayer(k, true); setRunnerLinks(x => x === k ? 'connected' : 'none');
  rebuild(); a.hp = -1; agentDie(a, k); const kh = k.honor; k.x = a.x + 6;
  d20(5, 5, 5); tick(3);
  ok(a.state === 'dead' && /^bled out after /.test(a.cause || '') && k.honor === kh && mercyStats().bled === 1, 'a downed enemy left to bleed dies with no honour to anyone (' + a.cause + ')');
  setRunnerLinks(null);}

// Agent spare through the tool: a landmark for both; the debt holds back the debtor's blade and the finish tool.
world(); {const [a, k] = foes(); markPlayer(a, true); markPlayer(k, true); setRunnerLinks(() => 'connected');
  rebuild(); a.hp = -1; agentDie(a, k);
  rebuild(); const r = spareTool(k, a.name);
  ok(r.ok && a.down.stable && a.debts[k.id] && a.debts[k.id].name === k.name, 'spare {hero} leaves them stable and owing a life');
  ok(tiersOf(k).marks.some(m => m.k === 'mercy') && tiersOf(a).marks.some(m => m.k === 'mercy'), 'both get a landmark');
  setRunnerLinks(null);
  // the spared wakes and meets the sparer again: sworn on them, still no charge
  a.down = null; a.state = 'hunt'; a.hp = maxHp(a); a.nemesis[k.id] = 'a friend'; a.spotCd = 0; k.state = 'hunt'; k.hp = maxHp(k);
  a.player = false; k.player = false; a.x = SP.x; a.y = SP.y; k.x = SP.x + 2; k.y = SP.y;
  rebuild(); S.pvpT = 0; pvpCheck(.5);
  ok(a.state !== 'duel' && k.state !== 'duel' && mercyStats().held >= 1, 'a life owed holds back a sworn charge');
  k.state = 'downed'; k.hp = 0; k.down = {at: S.gameMin, next: S.gameMin + 10, s: 0, f: 0, stable: false, wake: 0, by: {kind: 'mob'}};
  rebuild(); const t = finishTool(a, k.name);
  ok(!t.ok && /owe/.test(t.error || ''), 'finish is refused against the one you owe a life');}

// The debt is paid once: the sparer hard pressed by a creature near the debtor, or down near them.
world(); {const [a, k] = foes(); (a.debts = {})[k.id] = {name: k.name, fac: 1, day: 1}; const m = mob();
  k.state = 'fight'; k.target = m; m.target = k; k.hp = Math.floor(maxHp(k) * .3); m.lvl = a.lvl; a.x = k.x + 2;
  rebuild(); S.pvpT = 0; pvpCheck(.5);
  ok(a.state === 'fight' && a.target === m && !a.debts && mercyStats().repaid === 1, 'the debtor joins the sparer\'s fight with a creature: the debt is paid');}
world(); {const [a, k] = foes(); (a.debts = {})[k.id] = {name: k.name, fac: 1, day: 1}; const m = mob(); a.x = k.x + 3;
  down(k, m); rebuild(); S.pvpT = 0; pvpCheck(.5);
  ok(a.state === 'aid' && a.aid === k.id && !a.debts, 'the debtor comes to the downed sparer\'s side');}

// The grudge: a level-5 hero finished passes it to the whole guild; one who bled out only to their party.
const G = () => ({tag: 'TT', name: 'Test Guild', fac: 0});
world(); {const [a, k] = foes(), g = hero(2); g.fac = 0; a.lvl = 5; a.guild = g.guild = G(); g.nemesis = {};
  rebuild(); a.hp = -1; forced.push(.5, .001); agentDie(a, k);
  ok(a.state === 'dead' && g.nemesis[k.id] === a.name, 'a finished hero below level 12 still swears their whole guild');}
world(); {const [a, k] = foes(), g = hero(2); g.fac = 0; a.lvl = 5; a.guild = g.guild = G(); g.nemesis = {}; g.state = 'town'; g.x = 5;
  markPlayer(k, true); setRunnerLinks(x => x === k ? 'connected' : 'none');
  rebuild(); a.hp = -1; agentDie(a, k); k.x = a.x + 6; d20(5, 5, 5); tick(3);
  ok(a.state === 'dead' && !g.nemesis[k.id], 'one who bled out below level 12 does not');
  setRunnerLinks(null);}

// Save and restore: the debt and a waiting victor survive.
world(); {const [a, k] = foes(); markPlayer(k, true); setRunnerLinks(x => x === k ? 'connected' : 'none');
  (a.debts = {})[99] = {name: 'Old Friend', fac: 1, day: 1}; rebuild(); a.hp = -1; agentDie(a, k);
  const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap); const r = S.agents.find(x => x.id === a.id);
  ok(r.down && r.down.victor === k.id && r.debts && r.debts[99], 'save and restore keep the waiting victor and the debts');
  setRunnerLinks(null);}
// 9. The agent side (#658): events in range, the downed agent's reflection, aid rules, the stabilize/tend/carry tools.
{const PL = await import('../src/sim/player.js'), G = await import('../src/sim/gambits.js'), RF = await import('../src/sim/reflect.js');
 const PC = await import('./pacing.mjs');
 const {homeOf} = await import('../src/data/races.js');
 const agent = a => {PL.markPlayer(a, true); a.playEvSeen = a.playEvN || 0; a.playActAt = S.gameMin; return a};
 const fresh = a => (a.playEv || []).filter(e => e.n > (a.playEvSeen || 0));
 const heard = (a, rx) => fresh(a).find(e => rx.test(e.text));
 console.log('\nthe agent side (#658)');

 // events: kin in shouting range (urgent, with the tools), a stranger in sight (urgent, no tools), nobody far away
 world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'), c = hero(2), f = hero(3);
  mates(a, b); agent(b); agent(c); c.fac = 1 - a.fac; c.x = a.x + 6; agent(f); f.x = a.x + 20; b.x = a.x + 10; b.state = 'town';
  down(a, m);
  const e = heard(b, /is down and dying/);
  ok(e && e.w === 2 && /stabilize \{who:/.test(e.text) && /tiles (east|west|north|south)/.test(e.text), 'a companion in shouting range hears it at once, where, and how to help: ' + (e && e.text.slice(0, 70)));
  const s = heard(c, /falls and lies bleeding/);
  ok(s && s.w === 2 && !/stabilize/.test(s.text), 'a hero of the other side in sight sees the fall (no help hint)');
  ok(!fresh(f).some(x => new RegExp(a.name).test(x.text)), 'a hero 20 tiles off hears nothing');
  ok(!/death save|failure|success/i.test(e.text + s.text), 'the events never tell the saves');
  d20(12, 15, 18); tick(3);
  ok(a.down && a.down.stable && heard(b, /has stopped bleeding/) && heard(b, /has stopped bleeding/).w === 2, 'the stable event reaches the companion');
  S.gameMin = a.down.wake + 1; tick();
  ok(a.state !== 'downed' && heard(b, /back on their feet/), 'so does the waking');}
 world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); mates(a, b); agent(b); b.state = 'town'; b.x = a.x + 6;
  down(a, m); d20(5, 5, 5); tick(3);
  ok(a.state === 'dead' && heard(b, /has died of their wounds/), 'and the death');}

 // the downed agent: a reflection turn past the day's count and gap, no acting tools; its downings are counted
 world(); {const a = agent(hero(0, 'Warrior')), m = mob();
  a.reflect = {seq: 3, cur: null, d: Math.floor(S.gameMin / 1440) + 1, n: 4, dusk: 0, last: S.gameMin - 5, ev: 0, log: []};
  down(a, m);
  const r = RF.reflectDue(a);
  ok(r && r.kind === 'downed' && /lying in the dark/.test(r.why), 'the downed agent has a reflection due even past its day\'s count (' + (r && r.why) + ')');
  const b = PL.playerAct ? null : null; const br = {state: 'downed', reflect: r};
  ok(PC.reflectNow(br, {wake: 'now'}) && !PC.reflectNow({state: 'hunt', reflect: {id: 'x', kind: 'camp'}}, {wake: 'now'}), 'the runner plays it as the turn even on an urgent wake');
  ok(/You lie in the dark/.test(PC.reflectPrompt(r)) && /What do you hear/.test(PC.reflectPrompt(r, {tools: false})), 'the prompt: you lie in the dark, what do you hear?');
  ok(!PL.playerAct(a.id, 'stabilize', {who: 'x'}).ok && PL.playerAct(a.id, 'remember', {title: 'The dark', text: 'I heard wolves and a friend calling.'}).ok !== false, 'acting tools refused, remember still answers');
  ok((a.downs || []).length === 1, 'the downing is counted (self_downed_count)');
  d20(20); tick(); ok(a.state !== 'downed' && (!a.reflect.cur || a.reflect.cur.kind !== 'downed'), 'up again: the moment is no longer "lying in the dark"');}

 // aid rules: the preset comes as the reflex did; with the aid rules dropped the agent does not come
 world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); b.x = a.x + 4; b.inv.list.length = 0; mates(a, b); agent(b);
  down(a, m);
  ok(b.state === 'aid' && b.aid === a.id && b.aidHow && b.aidHow.revive && b.aidHow.stab, 'an agent on its class preset comes (revive_ally and stabilize, as the old reflex)');
  ok(G.gambitRec(b) && G.gambitRec(b).last && G.gambitRec(b).last.phase === 'aid' && G.gambitRec(b).last.then === 'revive_ally', 'its aid rule is the one that fired');
  b.x = a.x + .5; d20(20); walk(1); ok(a.down.stable, 'and stabilizes them');}
 world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); b.x = a.x + 4; mates(a, b); agent(b);
  b.gambits = G.presetFor(b.cls).filter(r => r.when !== 'ally_downed').map(r => ({...r})); b.gambitsDown = 1;
  down(a, m); ok(b.state !== 'aid', 'an agent that dropped its aid rules does not come');}
 world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); b.x = a.x + .5; b.inv.list.length = 0; b.potCd = 0; addUse(b, 'Redroot Draught', 1); mates(a, b); agent(b);
  b.gambits = [{id: 1, when: 'ally_downed', then: 'stabilize', on: true}]; b.gambitsDown = 1;
  down(a, m); d20(20); walk(3);
  ok(b.aidHow && !b.aidHow.revive && a.state === 'downed' && a.down.stable && b.inv.list.length === 1, 'a stabilize-only rule binds or rolls and keeps the potion');}
 world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'), h = hero(0, 'Priest'); b.x = a.x + 6; h.x = a.x + 3; h.healCd = 0; mates(a, b, h); agent(b);
  down(a, m);
  ok(h.state === 'aid' && b.state !== 'aid', 'a nearer free healer comes; the agent Warrior (no_healer false) stays');
  ok(G.aidPlan(b, a, {noHealer: false}) === null && G.aidPlan(b, a, {noHealer: true}).how.stab, 'aidPlan: the preset needs no healer nearer');}
 world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); b.x = a.x + 3; mates(a, b); agent(b);
  b.gambits = G.presetFor(b.cls).filter(r => r.when !== 'ally_downed').map(r => ({...r})); // a list from before #658: no aid rules, no mark
  const L = G.rulesOf(b);
  ok(b.gambitsDown === 1 && L[0].when === 'ally_downed' && L.filter(r => r.when === 'ally_downed').length === 2 && new Set(L.map(r => r.id)).size === L.length, 'an older list takes the aid rules at its top once, with new ids');
  down(a, m); ok(b.state === 'aid', 'so the edited hero still comes');}

 // the tools: stabilize, tend, carry
 world(); {const a = hero(0, 'Warrior'), m = mob(), b = hero(1, 'Warrior'); b.state = 'town'; b.x = a.x + 30; mates(a, b); agent(b);
  down(a, m); b.state = 'hunt'; b.x = a.x + 3; rebuild();
  let r = PL.playerAct(b.id, 'stabilize', {who: 'Nobody'});
  ok(!r.ok && /No one called "Nobody"/.test(r.error) && new RegExp('Down in sight: ' + a.name).test(r.error), 'stabilize names who lies downed in sight when the name is wrong');
  b.inv.list.length = 0; b.potCd = 0; addUse(b, 'Redroot Draught', 1);
  r = PL.playerAct(b.id, 'stabilize', {who: a.name.split(' ')[0]});
  ok(r.ok && b.state === 'aid' && b.aid === a.id && b.aidHow.stab && !b.aidHow.revive && /roll d20/.test(r.how), 'stabilize {who} sends the hero to them, to stabilize only');
  d20(20); walk(40);
  ok(a.down && a.down.stable && b.inv.list.length === 1, 'they are stabilized (the potion kept)');
  r = PL.playerAct(b.id, 'stabilize', {who: a.name}); ok(!r.ok && /already stable/.test(r.error) && /carry/.test(r.error), 'stabilize on a stable hero is refused, naming carry');
  const c = homeOf(b), d0 = Math.hypot(a.x - c.gate.x, a.y - c.gate.y);
  r = PL.playerAct(b.id, 'carry', {who: a.name, to: 'town'});
  ok(r.ok && b.aidHow.carry === 'town' && new RegExp(c.name).test(r.how), 'carry {who, to: town} takes them up: ' + r.how.slice(0, 60));
  walk(60, .1);
  const d1 = Math.hypot(a.x - c.gate.x, a.y - c.gate.y);
  ok(d1 < d0 - 1 && Math.hypot(a.x - b.x, a.y - b.y) < .1, 'the carrier walks home with them (' + Math.round(d0) + ' -> ' + Math.round(d1) + ' tiles from the gate)');
  r = PL.playerAct(b.id, 'move_to', {target: 'north'});
  ok(r.ok && b.state !== 'aid' && b.aid == null, 'a new order ends the help' + (r.ok ? ' (' + b.state + ')' : ': ' + r.error));}
 world(); {const a = hero(0, 'Warrior'), m = mob(), h = hero(0, 'Priest'); h.state = 'town'; h.x = a.x + 30; mates(a, h); agent(h);
  down(a, m); h.state = 'hunt'; h.x = a.x + 3; h.healCd = 0; rebuild();
  const r = PL.playerAct(h.id, 'tend', {hero_id: a.id});
  ok(r.ok && h.aidHow.revive && h.aidHow.stab && /your heal/.test(r.how), 'tend uses everything: ' + r.how);
  walk(3); ok(a.state !== 'downed' && a.hp > 0, 'the healer brings them up');}
 world(); {const a = hero(0), b = hero(1); agent(b);
  const r = PL.playerAct(b.id, 'tend', {});
  ok(!r.ok && /No one of your side lies downed in sight/.test(r.error), 'tend with no one down says so');}
 // a PvP downing (#657 with #658): the agent victor is offered finish or spare, the downed's companion still hears it and comes
 world(); {const a = hero(0, 'Warrior'), k = hero(1), b = hero(0, 'Priest'); k.fac = 1 - a.fac; k.nemesis = {}; mates(a, b); b.x = a.x + 6;
  agent(k); agent(b); setRunnerLinks(() => 'connected');
  rebuild(); a.hp = -1; agentDie(a, k);
  ok(a.state === 'downed' && a.down.victor === k.id && heard(k, /finish \{hero:/), 'a PvP downing offers the agent victor finish or spare');
  ok(heard(b, /is down and dying/) && b.state === 'aid', 'the companion of the downed hears it and comes (aid)');
  rebuild(); finishTool(k, a.name);
  ok(a.state === 'dead' && heard(b, /is finished where they lay/), 'a finish is heard by the companion in range');
  setRunnerLinks(null);}
}

// 10. Watch mode and the DM's downed call (#655).
{const T = await import('../src/sim/table.js'), DC = await import('../src/sim/downcall.js'), DR = await import('../src/sim/dmreflex.js');
 const {dmAct, setDmSeat} = await import('../src/sim/index.js');
 const agent = a => {markPlayer(a, true); a.playEvSeen = a.playEvN || 0; return a};
 const fresh = a => (a.playEv || []).filter(e => e.n > (a.playEvSeen || 0));
 const wtick = (n = 1) => {for (let i = 0; i < n; i++) {rebuild(); S.gameMin += DOWN.WATCH_TICK; for (const x of busy()) downedStep(x, DOWN.WATCH_TICK / 6)}};
 console.log('\nWatch mode and the DM\'s downed call (#655)');
 const mode = T.TABLE.mode;

 // the clock: Table Off, an agent hero and a host with links -> WATCH_TICK; any of them missing -> TICK
 world(); {const a = agent(hero(0, 'Warrior')), m = mob(), b = agent(hero(1, 'Warrior')); mates(a, b); b.state = 'town'; b.x = a.x + 6;
  T.TABLE.mode = 'off'; setRunnerLinks(() => 'connected');
  down(a, m);
  ok(a.down.next - a.down.at === DOWN.WATCH_TICK && /every 20 game minutes/.test(fresh(a).map(e => e.text).join(' ')), 'Watch mode: a downed agent hero saves every ' + DOWN.WATCH_TICK + ' game minutes');
  b.playEvSeen = b.playEvN || 0;
  d20(12); S.gameMin += DOWN.TICK; rebuild(); downedStep(a, 1);
  ok(a.down.s === 0, 'no save at ' + DOWN.TICK + ' minutes');
  S.gameMin += DOWN.WATCH_TICK - DOWN.TICK; rebuild(); downedStep(a, 1);
  ok(a.down.s === 1 && a.down.next - a.down.at === 2 * DOWN.WATCH_TICK, 'the save comes at ' + DOWN.WATCH_TICK + ', the next ' + DOWN.WATCH_TICK + ' later');
  const e = fresh(b).find(x => /still lies bleeding/.test(x.text));
  ok(e && e.w === 2 && /1 of 3 saves made/.test(e.text) && /stabilize \{who:/.test(e.text), 'the companion in reach gets an urgent wake at the save: ' + (e && e.text.slice(0, 80)));
  T.TABLE.mode = mode; setRunnerLinks(null);}
 world(); {const a = agent(hero(0, 'Warrior')), m = mob(); T.TABLE.mode = 'off'; // no host: the old clock
  down(a, m); ok(a.down.next - a.down.at === DOWN.TICK, 'Watch mode with no runner host keeps the ' + DOWN.TICK + '-minute clock');
  T.TABLE.mode = mode;}
 world(); {const a = hero(0, 'Warrior'), m = mob(); T.TABLE.mode = 'off'; setRunnerLinks(() => 'connected');
  down(a, m); ok(a.down.next - a.down.at === DOWN.TICK, 'a scripted hero keeps the ' + DOWN.TICK + '-minute clock in Watch mode');
  T.TABLE.mode = 'auto'; const c = agent(hero(1, 'Warrior')); down(c, m);
  ok(c.down.next - c.down.at === DOWN.TICK, 'and so does an agent hero with the Table on');
  T.TABLE.mode = mode; setRunnerLinks(null);}

 // the DM's call: answered by the DM agent while it listens
 world(); {const a = agent(hero(0, 'Warrior')), m = mob(), b = agent(hero(1, 'Warrior')); mates(a, b); b.state = 'town'; b.x = a.x + 6;
  T.TABLE.mode = 'off'; setRunnerLinks(() => 'connected'); setDmSeat(true); DR.heard('table');
  down(a, m);
  const t = dmAct('table_call');
  ok(t.ok && t.call && t.call.kind === 'downed' && t.call.id > DC.DCALL.ID_BASE && new RegExp(a.name).test(t.call.about) && t.call.seconds_left > 0 && t.scene && t.scene.kind === 'downed', 'table_call hands the DM the downing: ' + (t.call && t.call.about.slice(0, 70)));
  const st = dmAct('dm_status');
  ok(/never decide whether they live/.test(t.call.about) && st.downed && st.downed.waiting === 1, 'the call asks for words only; dm_status names it');
  const r = dmAct('table_answer', {call: t.call.id, text: 'The blade slips and the warrior drops into the bracken, breath hitching.'});
  ok(r.ok && r.kind === 'downed', 'table_answer voices it');
  ok((b.chat || []).some(l => /drops into the bracken/.test(l.text) && l.from.kind === 'dm') && (a.chat || []).some(l => /bracken/.test(l.text)), 'the companion who saw it and the downed hear the line');
  const L = S.dmLog.find(x => x.detail && x.detail.call === 'downed');
  ok(L && L.detail.by === 'dm-agent' && !L.detail.fill && a.hp === 0 && a.state === 'downed', 'the DM log has it as the DM agent\'s; HP untouched');
  ok(!dmAct('table_answer', {call: t.call.id, text: 'again'}).ok, 'a second answer to the same call is refused');
  d20(12); wtick(); const s = dmAct('table_call');
  ok(s.call && s.call.kind === 'downed' && /death save: success/.test(s.call.about) && /d20 12/.test(s.call.about), 'a save is a call too, with its dice');
  d20(15, 18); wtick(2); // fills the save call (pending) and the stable end
  const C = DC.downCallsOf(a.id);
  ok(a.down && a.down.stable && C.some(c => c.kind === 'end' && /stable/.test(c.about)) && C.length <= DC.DCALL.PER_DOWN, 'the end (stable) is voiced, ' + C.length + ' calls for the downing (cap ' + DC.DCALL.PER_DOWN + ')');
  setDmSeat(false); T.TABLE.mode = mode; setRunnerLinks(null);}

 // the reflex fill: the DM silent past its budget, or gone
 world(); {const a = agent(hero(0, 'Warrior')), m = mob(), b = agent(hero(1, 'Warrior')); mates(a, b); b.state = 'town'; b.x = a.x + 6;
  T.TABLE.mode = 'off'; setRunnerLinks(() => 'connected'); setDmSeat(true); DR.heard('table');
  down(a, m);
  const c = S.downCalls.cur[0]; ok(c && c.state === 'wait', 'the call waits while the DM listens');
  c.real -= 60000; DC.downCallTick();
  const L = S.dmLog.find(x => x.detail && x.detail.call === 'downed');
  ok(!S.downCalls.cur.length && L && L.detail.fill && L.detail.why === 'slow' && L.detail.by === 'scripted', 'past its budget the scripted DM fills it (fill, slow)');
  ok((b.chat || []).some(l => /goes down/.test(l.text)), 'and the companion hears the scripted line: ' + ((b.chat || []).slice(-1)[0] || {}).text);
  DR.gone();
  const e = agent(hero(2, 'Warrior')); mates(a, b, e); down(e, m);
  const G = S.dmLog.find(x => x.detail && x.detail.call === 'downed' && x.detail.hero === e.id);
  ok(G && G.detail.fill && G.detail.why === 'gone' && !S.downCalls.cur.length, 'nobody listening: filled at once (fill, gone)');
  setDmSeat(false); T.TABLE.mode = mode; setRunnerLinks(null);}
 world(); {const a = agent(hero(0, 'Warrior')), m = mob(); T.TABLE.mode = 'off'; setDmSeat(true);
  down(a, m); ok(!S.downCalls, 'no host with runner links: no call at all (seeded worlds unchanged)');
  setDmSeat(false); T.TABLE.mode = mode;}
}

// 8. Determinism: two runs from the same seed give the same downings and deaths.
const run = () => {seed = 0x1234; forced.length = 0; init({fellowship: false}); for (let i = 0; i < 2400; i++) step(.5);
  const D = downStats(); return JSON.stringify([D, S.facStats, S.agents.map(a => [a.id, a.state, a.lvl, Math.round(a.hp)])])};
const r1 = run(), r2 = run(); const D = JSON.parse(r1)[0];
ok(r1 === r2, 'twenty seeded minutes twice give the same world (' + D.downed + ' downings, ' + D.died + ' died while down)');
ok(D.downed > 0, 'downings happen in an ordinary world');

console.log(fail ? '\n' + fail + ' failed' : '\nall ok');
process.exit(fail ? 1 : 0);
