// Class abilities (issue #81): the tables are well formed, the one resolver works in both modes
// (real-time seconds and Table rounds), passives reach the stat model, and the state survives a save.
// Usage: npm run movecheck
import {init, step, S, snapshot, restore} from '../src/sim/index.js';
import {MOVES, PASSIVES, CLASS_MOVES, CLASS_PASSIVES, KINDS} from '../src/data/moves.js';
import {CLS} from '../src/data/classes.js';
import {movesOf, useMove, canUse, pickMove, tickRound, cdLeft, roundsLeft, abilityView} from '../src/sim/moves.js';
import {combatStats, dmgTaken} from '../src/sim/stats.js';
import {effOn} from '../src/sim/eff.js';
import {rebuild} from '../src/sim/spatial.js';
import {optionsFor, TABLE} from '../src/sim/table.js';

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
const mk = (cls, lvl) => {const a = S.agents.find(x => x.cls === cls && x.kind === 'hero' && !used.has(x.id) && !x.hidden && !x.player && x.state !== 'dead' && x.state !== 'ghost'); used.add(a.id); a.lvl = lvl; a.hp = combatStats(a).health; a.mcd = {}; a.mcr = {}; a.eff = {}; return a};
const usedM = new Set();
const foeNear = a => {const m = S.mobs.find(x => x.alive && !x.gone && !x.elite && !usedM.has(x.id)); usedM.add(m.id); m.x = a.x + 1; m.y = a.y; m.lvl = Math.max(1, a.lvl - 2); m.maxhp = 400; m.hp = 400; m.target = a; m.cd = 0; rebuild(); return m};

let w = mk('Warrior', 8), m = foeNear(w), ally = mk('Priest', 8);
ok(movesOf(w).length === 3 && movesOf(mk('Warrior', 3)).length === 1, 'abilities are learned by level (Warrior: 1 at level 3, 3 at level 8)');
ok(canUse(w, 'bastion', null) === null && /not learned|learned at/.test(canUse(mk('Warrior', 3), 'bastion', null) || ''), 'a move above your level is refused');
ok(/no such ability/i.test(canUse(w, 'runelance', m) || ''), 'another class\'s move is refused');
let r = useMove(w, 'bastion', null); const hit = dmgTaken(w);
ok(r.ok && effOn(w, 'taken') && cdLeft(w, 'bastion') > 20, `Dig In: ${r.text}; cooldown ${cdLeft(w, 'bastion')} s`);
ok(!useMove(w, 'bastion', null).ok, 'a cooling ability is refused in seconds');
w.eff = {}; const open = dmgTaken(w); ok(hit < open, `Dig In lowers damage taken (${hit.toFixed(2)} < ${open.toFixed(2)})`);
const hp0 = m.hp; r = useMove(w, 'recklessblow', m); ok(r.ok && m.hp < hp0 && w.hp < combatStats(w).health, `Reckless Blow: ${r.text}; cost paid`);
const ally2 = mk('Priest', 8); ally2.x = w.x + 1; ally2.y = w.y; m.target = ally2; w.hp = combatStats(w).health;
r = useMove(w, 'challenge', m); ok(r.ok && m.target === w, 'Challenge turns a monster off a friend: ' + r.text);

// kinds: heal and ward and control in both modes
const pr = mk('Priest', 9); pr.x = w.x; pr.y = w.y; const hurt = mk('Warrior', 9); hurt.fac = pr.fac; hurt.x = pr.x + 1; hurt.y = pr.y; hurt.hp = 5;
r = useMove(pr, 'chorus', null, {mates: [pr, hurt]}); ok(r.ok && hurt.hp > 5 && r.healed > 0, 'Knitting Hymn heals the group: ' + r.text);
r = useMove(pr, 'dawnward', hurt); ok(r.ok && effOn(hurt, 'taken'), 'Ward of Dawn on a friend: ' + r.text);
const hu = mk('Hunter', 8), mm = foeNear(hu); r = useMove(hu, 'quarrymark', mm); ok(r.ok, 'Name the Quarry: ' + r.text);
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

// ---- the Table offers abilities ----
init({fellowship: true}); for (let i = 0; i < 60; i++) step(1 / 60); used.clear(); usedM.clear();
if (S.fellowship) {
  TABLE.mode = 'auto';
  const f = S.agents.find(x => x.fellow && x.state !== 'dead'), mob = S.mobs.find(x => x.alive && !x.gone);
  const sc2 = {kind: 'elite', ctx: {mob: mob.id}, ids: [f.id], acts: {}, beats: []}; // a combat scene's shape; no need to run one
  const opts = optionsFor(sc2, f).filter(o => MOVES[o.k]);
  ok(opts.length >= 1, 'a combat scene lists ready abilities as options: ' + optionsFor(sc2, f).map(o => o.k).join(', ') + ' (' + f.cls + ' L' + f.lvl + ')');
  const hp0 = mob.hp, r2 = useMove(f, opts[0].k, MOVES[opts[0].k].target === 'foe' ? mob : f, {mode: 'round', mates: [f], foe: mob});
  ok(r2.ok, 'the option resolves in round mode: ' + (r2.text || r2.error));
  ok(!optionsFor(sc2, f).some(o => o.k === opts[0].k), 'a used ability leaves the options until its rounds pass');
} else ok(false, 'a Fellowship to test the Table with');

// ---- save round trip ----
const sv = mk('Priest', 9); useMove(sv, 'dawnward', sv); const left = cdLeft(sv, 'dawnward');
const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
const back = S.agents.find(x => x.id === sv.id);
ok(back && Math.abs(cdLeft(back, 'dawnward') - left) < 1 && effOn(back, 'taken'), `cooldown and ward survive a save (${left} s left)`);
ok(abilityView(back).length === 5, 'the view lists 3 abilities and 2 passives');
console.log(bad ? `\n${bad} check(s) failed` : '\nmovecheck: all checks passed');
process.exit(bad ? 1 : 0);
