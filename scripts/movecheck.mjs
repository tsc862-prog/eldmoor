// Class abilities (issue #81): the tables are well formed, the one resolver works in both modes
// (real-time seconds and Table rounds), passives reach the stat model, and the state survives a save.
// Usage: npm run movecheck
import {init, step, S, snapshot, restore} from '../src/sim/index.js';
import {MOVES, PASSIVES, CLASS_MOVES, CLASS_PASSIVES, KINDS} from '../src/data/moves.js';
import {CLS} from '../src/data/classes.js';
import {movesOf, useMove, canUse, pickMove, tickRound, cdLeft, roundsLeft, abilityView, fightMoves} from '../src/sim/moves.js';
import {setRunnerLinks} from '../src/sim/runlink.js';
import {actionLog} from '../src/sim/actlog.js';
import {addUse, take, bestUse} from '../src/sim/inv.js';
import {combatStats, dmgTaken} from '../src/sim/stats.js';
import {effOn} from '../src/sim/eff.js';
import {rebuild} from '../src/sim/spatial.js';
import {optionsFor, reflexFor, TABLE} from '../src/sim/table.js';
import {SPECS, CLASS_SPECS, SPEC_LVL} from '../src/data/classes.js';
import {SPEC_MOVES, SPEC_PASSIVES} from '../src/data/moves.js';
import {chooseSpec, specBlock, pickSpec, ensureSpec} from '../src/sim/spec.js';
import {score} from '../src/sim/abilities.js';
import {SKILLS} from '../src/data/abilities.js';

let bad = 0;
const ok = (c, m) => {console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++};

console.log('\nmovecheck: class abilities\n');
for (const c in CLS) {
  const mv = CLASS_MOVES[c] || [], ps = CLASS_PASSIVES[c] || [];
  ok(mv.length >= 2 && mv.length <= 4, `${c}: ${mv.length} active abilities (2-4)`);
  ok(ps.length >= 1 && ps.length <= 2, `${c}: ${ps.length} passives (1-2)`);
  ok(mv.some(id => MOVES[id].lvl === 1) || ps.some(id => PASSIVES[id].lvl === 1), `${c}: something to use from level 1`);
}
const names = new Set(), req = ['name', 'cls', 'kind', 'lvl', 'cd', 'rounds', 'target', 'range', 'fx', 'use', 'desc'];
for (const id in MOVES) {
  const M = MOVES[id];
  ok(req.every(k => M[k] !== undefined) && KINDS.includes(M.kind) && M.cd > 0 && M.rounds > 0 && !names.has(M.name) && M.desc.length > 10, `${id}: well formed (${M.name}, ${M.kind}, ${M.cd} s / ${M.rounds} rounds)`);
  names.add(M.name);
}
for (const id in PASSIVES) {const P = PASSIVES[id]; ok(P.name && P.cls in CLS && P.lvl >= 1 && P.desc && !names.has(P.name), `${id}: passive well formed (${P.name})`); names.add(P.name)}

// ---- the resolver ----
init({fellowship: false}); for (let i = 0; i < 600; i++) step(1 / 60);
const used = new Set();
const mk = (cls, lvl) => {const pick = u => S.agents.find(x => x.cls === cls && x.kind === 'hero' && !u.has(x.id) && !x.hidden && !x.player && x.state !== 'dead' && x.state !== 'ghost'); const a = pick(used) || pick(new Set()); // the roster has few of each class: reuse one when all are taken
   used.add(a.id); a.lvl = lvl; delete a.spec; a.hp = combatStats(a).health; a.mcd = {}; a.mcr = {}; a.eff = {}; return a};
const usedM = new Set();
const foeNear = a => {const m = S.mobs.find(x => x.alive && !x.gone && !x.elite && !usedM.has(x.id)); usedM.add(m.id); m.x = a.x + 1; m.y = a.y; m.lvl = Math.max(1, a.lvl - 2); m.maxhp = 400; m.hp = 400; m.target = a; m.cd = 0; rebuild(); return m};

let w = mk('Warrior', 8), m = foeNear(w), ally = mk('Priest', 8);
ok(movesOf(w).length === 3 && movesOf(mk('Warrior', 3)).length === 1, 'abilities are learned by level (Warrior: 1 at level 3, 3 at level 8)');
ok(canUse(w, 'bastion', null) === null && /not learned|learned at/.test(canUse(mk('Warrior', 3), 'bastion', null) || ''), 'a move above your level is refused');
ok(/no such ability/i.test(canUse(w, 'runelance', m) || ''), 'another class\'s move is refused');
let r = useMove(w, 'bastion', null); const hit = dmgTaken(w);
ok(r.ok && effOn(w, 'taken') && cdLeft(w, 'bastion') > 20, `Bastion: ${r.text}; cooldown ${cdLeft(w, 'bastion')} s`);
ok(!useMove(w, 'bastion', null).ok, 'a cooling ability is refused in seconds');
w.eff = {}; const open = dmgTaken(w); ok(hit < open, `Bastion lowers damage taken (${hit.toFixed(2)} < ${open.toFixed(2)})`);
const hp0 = m.hp; r = useMove(w, 'recklessblow', m); ok(r.ok && m.hp < hp0 && w.hp < combatStats(w).health, `Reckless Blow: ${r.text}; cost paid`);
const ally2 = mk('Priest', 8); ally2.x = w.x + 1; ally2.y = w.y; m.target = ally2; w.hp = combatStats(w).health;
r = useMove(w, 'challenge', m); ok(r.ok && m.target === w, 'Challenge turns a monster off a friend: ' + r.text);

// kinds: heal and ward and control in both modes
const pr = mk('Priest', 9); pr.x = w.x; pr.y = w.y; const hurt = mk('Warrior', 9); hurt.fac = pr.fac; hurt.x = pr.x + 1; hurt.y = pr.y; hurt.hp = 5;
r = useMove(pr, 'chorus', null, {mates: [pr, hurt]}); ok(r.ok && hurt.hp > 5 && r.healed > 0, 'Chorus of Mending heals the group: ' + r.text);
r = useMove(pr, 'dawnward', hurt); ok(r.ok && effOn(hurt, 'taken'), 'Ward of Dawn on a friend: ' + r.text);
const hu = mk('Hunter', 8), mm = foeNear(hu); r = useMove(hu, 'quarrymark', mm); ok(r.ok, 'Quarry Mark: ' + r.text);
const ma = mk('Mage', 8), m2 = foeNear(ma); const cd0 = m2.cd; r = useMove(ma, 'rimering', null); ok(r.ok && (m2.cd > cd0 || r.saved), 'Rime Ring slows or is resisted: ' + r.text);
const ro = mk('Rogue', 8), m3 = foeNear(ro); m3.hp = m3.maxhp; r = useMove(ro, 'ambush', m3); ok(r.ok && m3.hp < m3.maxhp, 'Ambush: ' + r.text);

// ---- round mode ----
const rw = mk('Warrior', 8), rm = foeNear(rw);
r = useMove(rw, 'bastion', null, {mode: 'round'}); ok(r.ok && effOn(rw, 'taken') && roundsLeft(rw, 'bastion') === MOVES.bastion.rounds, 'round mode: Bastion holds for rounds, cooldown ' + MOVES.bastion.rounds + ' rounds');
ok(!canUse(rw, 'bastion', null, 'round') === false, 'a cooling ability is refused in rounds');
tickRound(rw); tickRound(rw); ok(!effOn(rw, 'taken') && roundsLeft(rw, 'bastion') === MOVES.bastion.rounds - 2, 'two rounds pass: the effect ends, the cooldown runs down');
for (let i = 2; i < MOVES.bastion.rounds; i++) tickRound(rw); ok(canUse(rw, 'bastion', null, 'round') === null, 'after its rounds the ability is ready again');
ok(pickMove(mk('Rogue', 5), foeNear(rw), [], true, 'round') !== undefined, 'the scripted policy answers in round mode');

// ---- passives reach the stat model ----
used.clear();
const lo = mk('Warrior', 3), hi = mk('Warrior', 8), base = combatStats(lo).health;
ok(combatStats(hi).bd.health.some(p => p.src === 'passive'), 'Stout Heart shows in the Health breakdown');
const rg = mk('Rogue', 6); ok(combatStats(rg).bd.crit.some(p => p.src === 'passive'), 'Knife-Hand shows in the Crit breakdown');
const pa = mk('Warrior', 5); pa.hp = combatStats(pa).health * .2; const low = dmgTaken(pa); pa.hp = combatStats(pa).health; ok(low < dmgTaken(pa), 'Unbowed: wounded blows land softer');


// ---- specialisations (#82) ----
for (const c in CLS) ok((CLASS_SPECS[c] || []).length === 2, c + ': two paths');
for (const id in SPECS) {const P = SPECS[id];
  ok(P.name && P.desc && P.skill in SKILLS && Object.keys(P.abil).length && (SPEC_MOVES[id] || []).length === 1 && (SPEC_PASSIVES[id] || []).length === 1 && MOVES[SPEC_MOVES[id][0]].cls === P.cls && MOVES[SPEC_MOVES[id][0]].lvl === SPEC_LVL, id + ': well formed (' + P.name + ', 1 ability + 1 passive at ' + SPEC_LVL + ')')}
{const t = mk('Priest', 9); ok(/level 10/.test(specBlock(t) || ''), 'no path before level 10');
 const m10 = mk('Priest', 10), brawn0 = score(m10, 'insight'), crit0 = combatStats(m10).crit, n0 = movesOf(m10).length, h0 = abilityView(m10).length;
 ok(!chooseSpec(m10, 'reaver').ok, 'a path of another class is refused');
 const r = chooseSpec(m10, 'mender'); ok(r.ok && m10.spec === 'mender', 'Mender chosen: ' + r.text);
 ok(score(m10, 'insight') === brawn0 + 1 && m10.prof.includes('empathy'), 'the path adds a score point and a trained skill');
 ok(movesOf(m10).includes('mendingtouch') && movesOf(m10).length === n0 + 1 && abilityView(m10).length === h0 + 2, 'the path adds an ability and a passive to the list');
 ok(!chooseSpec(m10, 'battlecleric').ok, 'a path is permanent');
 ok(!!S.chronicle.find(e => e.parts.some(x => x && x.t === 'Mender')) && m10.history.some(h => /path of the Mender/.test(h.text)), 'the Chronicle and the hero log record the choice');
 const hurt = mk('Warrior', 10); hurt.hp = 10; hurt.x = m10.x + 1; hurt.y = m10.y; hurt.fac = m10.fac; const rr = useMove(m10, 'mendingtouch', hurt); ok(rr.ok && hurt.hp > 10 && rr.healed > 0, 'Mending Touch heals one friend: ' + rr.text);
 const r2 = useMove(mk('Priest', 10), 'mendingtouch', hurt); ok(!r2.ok, 'a spec ability is refused to a hero without the path');
 const b = mk('Warrior', 10); const d0 = combatStats(b).defense; chooseSpec(b, 'warden'); ok(combatStats(b).defense > d0 && combatStats(b).bd.defense.some(p => p.src === 'passive'), 'Wardens Vow reaches Defense (cache rebuilt)');
 const cr = mk('Rogue', 10); const c0 = combatStats(cr).crit; chooseSpec(cr, 'cutthroat'); ok(combatStats(cr).crit > c0, 'Cutthroat raises Crit');
 const sc = mk('Mage', 10); sc.traits = ['Cautious']; ok(pickSpec(sc, []) === 'rimekeeper', 'a Cautious Mage leans to the Rimekeeper');
 sc.traits = []; sc.id = 0; ok(pickSpec(sc, [{...mk('Mage', 10), spec: 'rimekeeper'}]) === 'runescribe', 'a party that has control wants damage');
 const sg = mk('Hunter', 12); sg.traits = ['Loner']; ok(!sg.spec && ensureSpec(sg, [sg]) && sg.spec, 'a scripted hero at level 10+ picks a path by itself: ' + sg.spec);
 const old = mk('Warrior', 14); ok(!old.spec && movesOf(old).length === 3, 'an old save (no spec) keeps its three abilities and plays on');
 const back2 = (restore(JSON.parse(JSON.stringify(snapshot()))), S.agents.find(x => x.id === m10.id)); ok(back2 && back2.spec === 'mender' && score(back2, 'insight') === brawn0 + 1, 'the path survives a save');
}

// ---- the Table offers abilities ----
init({fellowship: true}); for (let i = 0; i < 60; i++) step(1 / 60); used.clear(); usedM.clear();
if (S.fellowship) {
  TABLE.mode = 'auto';
  const f = S.agents.find(x => x.fellow && x.state !== 'dead'), mob = S.mobs.find(x => x.alive && !x.gone);
  f.mcd = {}; f.mcr = {}; // abilities used during the warm-up steps may still be cooling down (seed-dependent on CI)
  const sc2 = {kind: 'elite', ctx: {mob: mob.id}, ids: [f.id], acts: {}, beats: []}; // a combat scene's shape; no need to run one
  const opts = optionsFor(sc2, f).filter(o => MOVES[o.k]);
  ok(opts.length >= 1, 'a combat scene lists ready abilities as options: ' + optionsFor(sc2, f).map(o => o.k).join(', ') + ' (' + f.cls + ' L' + f.lvl + ')');
  const hp0 = mob.hp, r2 = useMove(f, opts[0].k, MOVES[opts[0].k].target === 'foe' ? mob : f, {mode: 'round', mates: [f], foe: mob});
  ok(r2.ok, 'the option resolves in round mode: ' + (r2.text || r2.error));
  ok(!optionsFor(sc2, f).some(o => o.k === opts[0].k), 'a used ability leaves the options until its rounds pass');
} else ok(false, 'a Fellowship to test the Table with');

// ---- Skald (issue #83): the party-wide ward and the mark ----
{
  const sk = mk('Skald', 8), mate = mk('Warrior', 8); mate.x = sk.x + 1; mate.y = sk.y; const fo = foeNear(sk); fo.target = mate; rebuild();
  ok(movesOf(sk).length === 3 && movesOf(mk('Skald', 1)).length === 1, 'Skald learns Biting Verse at 1 and three verses by 8');
  const rr = useMove(sk, 'rallyverse', null, {mates: [sk, mate], foe: fo});
  ok(rr.ok && effOn(sk, 'taken') && effOn(mate, 'taken') && rr.hit === 2, 'Rallying Verse wards every friend in range: ' + (rr.text || rr.error));
  const d0 = fo.hp, rd = useMove(sk, 'bitingverse', fo); ok(rd.ok && fo.hp < d0, 'Biting Verse strikes: ' + (rd.text || rd.error));
  ok(CLASS_SPECS.Skald && CLASS_SPECS.Skald.length === 2, 'Skald has two specialisations');
}

// ---- Wildspeaker (issue #83): the single-target mend and the root ----
{
  const ws = mk('Wildspeaker', 8), hurt = mk('Warrior', 8); hurt.x = ws.x + 1; hurt.y = ws.y; hurt.hp = 5; const fo = foeNear(ws); rebuild();
  ok(movesOf(ws).length === 3 && movesOf(mk('Wildspeaker', 1)).length === 1, 'Wildspeaker learns Briar Lash at 1 and three abilities by 8');
  const h = useMove(ws, 'greenmend', hurt, {mates: [ws, hurt], foe: fo}); ok(h.ok && hurt.hp > 5, 'Greenmend heals one friend: ' + (h.text || h.error));
  const d0 = fo.hp, rd = useMove(ws, 'briarlash', fo); ok(rd.ok && fo.hp < d0, 'Briar Lash strikes: ' + (rd.text || rd.error));
  const rb = useMove(ws, 'rootbind', fo); ok(rb.ok, 'Rootbind holds a foe: ' + (rb.text || rb.error));
  ok(CLASS_SPECS.Wildspeaker && CLASS_SPECS.Wildspeaker.length === 2, 'Wildspeaker has two specialisations');
}

// ---- a reflex Fellowship healer heals with its class move (#347) ----
{
  const uses = id => (S.moveStats && S.moveStats.uses[id]) || 0;
  const mem = S.agents.filter(x => x.fellow && x.state !== 'dead' && x.state !== 'ghost' && !x.hidden);
  const hl = mem.find(x => CLS[x.cls].heal), mate = mem.find(x => x !== hl);
  if (hl && mate) {
    for (const b of mem) b.hp = combatStats(b).health;
    hl.lvl = 12; hl.traits = ['Pious']; delete hl.spec; // Pious leans to the Mender path, so the pick does not depend on the world's seed hl.mcd = {}; hl.mcr = {}; hl.mvAt = 0; hl.hp = combatStats(hl).health;
    mate.x = hl.x + 1; mate.y = hl.y; mate.hp = combatStats(mate).health * .5; const fo = foeNear(hl); fo.target = mate; rebuild();
    ok(hl.player, `the Fellowship ${hl.cls} is agent-played`);
    setRunnerLinks(() => 'connected'); const h0 = mate.hp;
    ok(fightMoves(hl, fo, mem, false) === null && mate.hp === h0 && !hl.spec, 'with its runner there, the agent keeps its moves and its path');
    setRunnerLinks(null);
    ok(fightMoves(hl, fo, mem, false) === 'free' && !!hl.spec && mate.hp > h0, `on reflex it takes a path (${hl.spec}) and heals with a class move (${(hl.moveLog || []).map(x => x.id).join(', ')})`);
    // the Mender's own heal, through useMove: cooldown, the action log, once per cooldown
    for (const b of mem) b.hp = combatStats(b).health;
    const seat = hl;
    {const bg = seat.cls === 'Priest' ? null : mk('Priest', 12), hl = bg || seat; // a background Priest stands in on reflex when the seat is another healer
      if (bg) {bg.player = true; bg.fac = mate.fac; bg.x = mate.x - 1; bg.y = mate.y; rebuild()}
      delete hl.spec; chooseSpec(hl, 'mender'); hl.mcd = {}; hl.mcr = {}; hl.mvAt = 0; mate.hp = combatStats(mate).health * .5; const n0 = uses('mendingtouch');
      ok(fightMoves(hl, fo, mem, false) === 'free' && uses('mendingtouch') === n0 + 1 && cdLeft(hl, 'mendingtouch') > 0, 'a reflex Mender heals with Mending Touch, and it cools down');
      ok(actionLog(hl, {kinds: ['heal']}).some(e => e.name === 'Mending Touch' && e.target === mate.name), 'the heal is in the action log, named');
      hl.mvAt = 0; mate.hp = combatStats(mate).health * .5; fightMoves(hl, fo, mem, false); ok(uses('mendingtouch') === n0 + 1, 'not again while it cools down');
      // at the Table: the reflex heal is the class move when it is ready, the plain heal when it is not
      hl.mcd = {}; hl.mcr = {}; mate.hp = combatStats(mate).health * .45;
      const sc3 = {kind: 'elite', ctx: {mob: fo.id}, ids: [hl.id], acts: {}, beats: []};
      ok(reflexFor(sc3, hl) === 'mendingtouch', 'at the Table a reflex Mender heals with Mending Touch: ' + reflexFor(sc3, hl));
      hl.mcr.mendingtouch = 2; ok(reflexFor(sc3, hl) === 'heal', 'and with the plain heal while it cools down');
      // badly hurt (below 35%): the class move first, then a potion, then the plain heal (#387)
      hl.mcd = {}; hl.mcr = {}; mate.hp = combatStats(mate).health * .2; addUse(hl, 'Redroot Draught', 1);
      const r35 = reflexFor(sc3, hl), healMv = movesOf(hl).filter(id => MOVES[id].kind === 'heal');
      ok(healMv.includes(r35), 'below 35% a reflex Mender with a potion still heals with a class move first: ' + r35);
      for (const id of healMv) hl.mcr[id] = 2; ok(reflexFor(sc3, hl) === 'potion', 'and drinks the potion while it cools down: ' + reflexFor(sc3, hl));
      for (let p; (p = bestUse(hl, 'potion'));) take(hl, 'use', p, 99); ok(reflexFor(sc3, hl) === 'heal', 'and with no potion and no ready move, the plain heal: ' + reflexFor(sc3, hl));
      if (bg) bg.player = false;
    }
    for (const b of mem) b.hp = combatStats(b).health;
  } else ok(false, 'a Fellowship healer to test reflex heals with');
  // a reflex Wildspeaker (an agent-played hero with no runner) mends with Greenmend
  const ws = mk('Wildspeaker', 8), hu = mk('Warrior', 8); hu.fac = ws.fac; hu.x = ws.x + 1; hu.y = ws.y; hu.hp = combatStats(hu).health * .4; const fo = foeNear(ws); rebuild();
  ws.player = true; ws.mvAt = 0; const g0 = uses('greenmend'), hh = hu.hp;
  ok(fightMoves(ws, fo, [ws, hu], false) === 'free' && uses('greenmend') === g0 + 1 && hu.hp > hh, 'a reflex Wildspeaker heals with Greenmend');
  ws.mvAt = 0; ws.mcd = {}; hu.hp = combatStats(hu).health * .4; const hp1 = fo.hp;
  ok(fightMoves(ws, fo, [ws, hu], true) !== 'swing' && fo.hp === hp1, 'on reflex it heals, but strikes and control stay with the agent');
  ws.player = false;
}

// ---- Antler Ward fires for one hurt, hunted friend (#348); Rallying Verse keeps its company trigger ----
{
  const sw = mk('Wildspeaker', 10), mate = mk('Warrior', 10); mate.fac = sw.fac; mate.x = sw.x + 1; mate.y = sw.y; mate.eff = {};
  chooseSpec(sw, 'springwarden'); for (const m of S.mobs) if (m.target === sw || m.target === mate) m.target = null; // only our foe hunts them
  const fo = foeNear(sw); fo.target = mate; mate.hp = combatStats(mate).health * .65; sw.hp = combatStats(sw).health; sw.eff = {}; rebuild();
  const p = pickMove(sw, fo, [sw, mate], false);
  ok(p && p.id === 'antlerward', 'a Springwarden wards the company when one friend in reach is hunted and below 70%: ' + (p && p.id));
  mate.hp = combatStats(mate).health * .9; ok((pickMove(sw, fo, [sw, mate], false) || {}).id !== 'antlerward', 'not while that friend is still hale');
  mate.hp = combatStats(mate).health * .65; fo.target = null; rebuild(); ok((pickMove(sw, fo, [sw, mate], false) || {}).id !== 'antlerward', 'nor when nothing hunts them');
  // the duel: the foe in hand is a hero
  const du = mk('Warrior', 10); du.fac = 1 - sw.fac; du.target = sw; du.x = sw.x + 30; du.y = sw.y; rebuild(); sw.hp = combatStats(sw).health * .6; sw.mcd = {}; // pinned out of weapon reach: where the duellist stands (it wandered with the 600 warm-up steps) decided whether Rootbind, an earlier free move, was picked first
  ok((pickMove(sw, du, [sw], false) || {}).id === 'antlerward', 'and in a duel, once the Springwarden is below 70%');
  const sk = mk('Skald', 10); sk.fac = mate.fac; sk.x = mate.x - 1; sk.y = mate.y; sk.hp = combatStats(sk).health; sk.eff = {}; for (const m of S.mobs) if (m.target === sk || m.target === mate) m.target = null; const fo2 = foeNear(sk); fo2.target = mate; mate.hp = combatStats(mate).health * .65; rebuild();
  ok((pickMove(sk, fo2, [sk, mate], false) || {}).id !== 'rallyverse', 'Rallying Verse still waits for the company moment (two hunted, or one below half)');
  const r = useMove(sw, 'antlerward', null, {mates: [sw, mate]}); ok(r.ok && effOn(mate, 'taken'), 'Antler Ward wards the friend: ' + (r.text || r.error));
}

// ---- save round trip ----
const sv = mk('Priest', 9); useMove(sv, 'dawnward', sv); const left = cdLeft(sv, 'dawnward');
const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
const back = S.agents.find(x => x.id === sv.id);
ok(back && Math.abs(cdLeft(back, 'dawnward') - left) < 1 && effOn(back, 'taken'), `cooldown and ward survive a save (${left} s left)`);
ok(abilityView(back).length === 5, 'the view lists 3 abilities and 2 passives');
console.log(bad ? `\n${bad} check(s) failed` : '\nmovecheck: all checks passed');
process.exit(bad ? 1 : 0);
