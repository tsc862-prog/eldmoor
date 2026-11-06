// sidescheck (#1025): factions are lore, not sides. S.setup.sides==='lore' (loreSides() in sim/state.js) is set by the setup page on every new world;
// a seeded or older world has no such field and reads as ever. This check plays a lore world with a mixed-faction company, and proves the setting
// changes nothing where it is absent.
// Usage: npm run sidescheck      (internal: --child <kind> prints a world signature)
import './seed-first.mjs'; // before the sim loads: a child's run repeats (#888)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {init, S, step, snapshot, restore, validateSetup, defaultSetup, applyPreset, cleanSetup} from '../src/sim/index.js';
import {loreSides, sameSide} from '../src/sim/state.js';
import {sidesStart} from '../src/sim/opening.js';
import {SIDES, hallTowns, slotsView} from '../src/sim/setup.js';
import * as SLT from '../src/sim/company.js';
import {CITY} from '../src/world/map.js';
import {RACES, racesOf} from '../src/data/races.js';
import {FAC} from '../src/data/factions.js';

let fails = 0, n = 0;
const ok = (c, m) => {n++; if (!c) {fails++; console.log('  FAIL ' + m)} else console.log('  ok ' + m)};

// The classic five with peoples of both histories, in a hall of the other one.
const PEOPLE = [racesOf(1)[0].id, racesOf(0)[0].id, racesOf(1)[1].id, racesOf(0)[1].id, racesOf(1)[2].id];
export const mixed = (seed = 1025, more = {}) => {const s = {...defaultSetup(seed, 'eldmoor', 0), sides: 'lore', ...more}; PEOPLE.forEach((r, i) => {s.heroes[i].race = r}); return s};
const sig = () => JSON.stringify(S.agents.map(a => [a.id, a.name, a.fac, a.lvl, a.x.toFixed(2), a.y.toFixed(2), a.gold, a.state]));

if (process.argv[2] === '--child') {const k = process.argv[3];
  init(k === 'lore' ? {setup: cleanSetup(mixed())} : {setup: cleanSetup(defaultSetup(1025, 'eldmoor', 0))});
  for (let i = 0; i < 300; i++) step(1); console.log('SIG ' + sig()); process.exit(0)}

console.log('The setting');
{ok(SIDES.join() === 'war,lore' && !('sides' in defaultSetup(1)), 'sides: the default says nothing');
 {const t = defaultSetup(1); t.sides = 'some'; ok(validateSetup(t).some(x => /Sides/.test(x)), 'an unknown sides is refused')}
 ok(!('sides' in cleanSetup({...defaultSetup(1), sides: 'war'})) && cleanSetup(mixed()).sides === 'lore', 'cleanSetup stores only lore');
 ok(sidesStart({}) === null && sidesStart({sides: 'lore'}) === 'lore' && sidesStart({setup: {sides: 'lore'}}) === 'lore', 'sidesStart: an option or a setup');
 ok(slotsView(mixed()).sides === 'lore' && cleanSetup(slotsView(mixed())).sides === 'lore', 'a v1 view of it keeps the setting');
 ok(applyPreset('last', {...defaultSetup(12, 'eldmoor', 1), sides: 'lore'}, {last: mixed(11)}).heroes[0].race === PEOPLE[0], 'Last used keeps the heroes whatever side the page stood on');
 init({}); ok(!loreSides() && sameSide({fac: 0}, {fac: 0}) && !sameSide({fac: 0}, {fac: 1}), 'a world with no setting: sides as ever');
 init({sides: 'lore'}); ok(loreSides(), 'init({sides}) writes it even with no setup'); ok(sameSide({fac: 0}, {fac: 1}), 'sameSide: everyone, in a lore world');
 const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const {init,S}=await import(process.argv[1]);init({});console.log('SIDES='+(S.setup&&S.setup.sides))", new URL('../src/sim/index.js', import.meta.url).href], {encoding: 'utf8', env: {...process.env, ELDMOOR_SIDES: 'lore'}}).stdout.trim();
 ok(r.endsWith('SIDES=lore'), 'ELDMOOR_SIDES=lore in Node');
}

console.log('A mixed company at setup');
{const s = mixed();
 ok(validateSetup(s).length === 0, 'a five of both histories is a legal lore setup: ' + validateSetup(s).join(' | '));
 ok(validateSetup({...mixed(), sides: undefined}).some(x => /people is not|one faction/.test(x)), 'the same five with no setting is refused as ever');
 const other = CITY.find(c => c.fac === 1).name, own = CITY.find(c => c.fac === 0).name;
 ok(hallTowns('eldmoor', null).includes(other) && hallTowns('eldmoor', null).includes(own) && hallTowns('eldmoor', 0).every(n => CITY.find(c => c.name === n).fac === 0), 'hallTowns: fac null is every town, a fac only its own');
 ok(validateSetup(mixed(1025, {hall: other})).length === 0, 'a hall of the other history is legal');
 ok(validateSetup(mixed(1025, {hall: 'Nowhere'})).some(x => /not a town of this world/.test(x)), 'an unknown hall is still refused, without naming a side');
 init({setup: cleanSetup(mixed(1025, {hall: other}))});
 const F = SLT.slotted(), L = SLT.slotHeroes(F);
 ok(!!F && L.length === 5 && new Set(L.map(a => a.fac)).size === 2, 'the company is founded with both histories in it');
 ok(L.every((a, i) => a.race === PEOPLE[SLT.SLOT_KEYS.indexOf(SLT.slotKeyOf(a))] && RACES.find(r => r.id === a.race).fac === a.fac), 'each hero keeps the people chosen, its fac the lore tag of that people');
 ok(L.every(a => FAC[a.fac] && FAC[a.fac].name) && S.agents.every(a => FAC[a.fac]) && CITY.every(c => FAC[c.fac]), 'fac stays set on every hero and town');
 const c = CITY.find(t => t.name === other); ok(F.hall === other && L.every(a => a.x >= c.x0 - 1 && a.x <= c.x1 + 2 && a.y >= c.y0 - 1 && a.y <= c.y1 + 2), 'all five stand in the chosen hall');
 ok(S.setup.sides === 'lore' && S.setup.world === 'eldmoor', 'S.setup keeps the setting beside the record');
 const snap = JSON.parse(JSON.stringify(snapshot())); init({}); ok(!loreSides(), 'a world made after it has sides again'); restore(snap); ok(loreSides() && SLT.slotHeroes(SLT.slotted()).length === 5, 'a load keeps the setting');
 {const a = applyPreset('pairs-and-solo', mixed()), t = CITY[CITY.length - 1].name; a.heroes[0].start = {town: t}; ok(validateSetup(a).length === 0, 'apart: a pair of two histories, a start town of either');
  init({setup: cleanSetup(a)}); const Cs = SLT.companies(); ok(Cs.length === 3 && SLT.members(Cs[0]).length === 2 && new Set(SLT.members(Cs[0]).map(h => h.fac)).size === 2 && Cs[0].hall === t, 'apart founds the mixed pair at its start town')}
}

console.log('Any town takes a company in');
{const {playerAct} = await import('../src/sim/player.js'), {dmAct, setDmSeat} = await import('../src/sim/dmagent.js'), {takeWound} = await import('../src/sim/tend.js'), {maxHp} = await import('../src/sim/heroes.js'), {rebuild} = await import('../src/sim/spatial.js'), {dist} = await import('../src/world/map.js');
 const own = CITY.find(c => c.fac === 0), far = CITY.find(c => c.fac === 1), act = (a, t, x) => playerAct(a.id, t, x || {});
 const world = lore => {init({setup: cleanSetup(lore ? mixed(1025, {hall: own.name}) : defaultSetup(1025, 'eldmoor', 0))}); if (S.opening) S.opening.queue.length = 0; setDmSeat(true); return SLT.slotHeroes(SLT.slotted())};
 const at = (L, p) => {L.forEach((a, i) => {Object.assign(a, {x: p.x + (i % 3) * .4, y: p.y + (i > 2 ? .4 : 0), state: 'hunt', hp: maxHp(a), dest: null, target: null, pq: []})}); rebuild()};
 const L = world(true), hero = L.find(a => a.fac === 0), walker = hero;
 at(L, {x: far.gate.x, y: far.gate.y + 3});
 let r = act(walker, 'move_to', {target: far.name}); ok(r.ok, 'move_to the other history\'s town: ' + (r.error || r.going || 'ok'));
 r = act(walker, 'move_to', {target: 'chapel in ' + far.name}); ok(r.ok && /chapel/.test(JSON.stringify(r)), 'move_to its chapel walks to the chapel, not the gate');
 {const c = far.spots.chapel; at(L, {x: c.x, y: c.y}); takeWound(L[0], 'a test'); takeWound(L[1], 'a test');
  const payer = L.find(a => a.fac === 0); payer.gold = 500; r = act(payer, 'chapel_tend', {}); if (r.error && /no wound/.test(r.error)) r = act(payer, 'chapel_tend', {who: L[0].name === payer.name ? L[1].name : L[0].name});
  ok(r.ok, 'the chapel priest of that town tends a wound: ' + (r.error || r.result))}
 at(L, {x: far.spots.square ? far.spots.square.x : far.gate.x, y: far.spots.square ? far.spots.square.y : far.gate.y});
 r = act(hero, 'learn_profession', {id: 'mining'}); ok(r.ok, 'its trainers teach: ' + (r.error || r.learned));
 r = act(hero, 'smith', {}); ok(!/friendly town/.test(r.error || ''), 'its smith works: ' + (r.error || 'ok'));
 r = act(hero, 'craft', {recipe: 'nothing such'}); ok(!/friendly town/.test(r.error || ''), 'its workshops open');
 r = act(hero, 'rest', {minutes: 30}); ok(r.ok, 'a hero rests there: ' + (r.error || r.resting_min));
 hero.pq = [];
 {const p = S.npcs.find(x => x.town === far.name && x.role === 'innkeeper') || S.npcs.find(x => x.town === far.name); at(L, {x: p.x, y: p.y + .6}); r = act(hero, 'talk', {target: p.role}); ok(r.ok && !/contempt/.test(JSON.stringify(r)), 'the townsfolk answer: ' + (r.error || String(r.answer).slice(0, 50)))}
 {const ls = act(hero, 'lore'); ok(CITY.every(c => (ls.towns || []).includes(c.name)), 'lore lists every town')}
 // the DM stages and summons at any town
 const F = SLT.slotted(); F.fac = 0;
 r = dmAct('stage_scene', {kind: 'meeting', near: 'fellowship', at: far.name, frame: 'A stranger at the square waits with a letter.', cast: {role: 'stranger', name: 'Tessel', want: 'a word'}, reason: 'test'});
 ok(r.ok, 'stage_scene at that town: ' + (r.error || r.kind));
 r = dmAct('summon_hero', {fac: FAC[0].name, cls: 'Rogue', level: 1, near: far.name, why: 'test'});
 ok(r.ok, 'summon_hero inside that town, of either history: ' + (r.error || 'ok'));
 // and with no setting everything refuses as before
 const M = world(false), m = M[0], foeTown = CITY.find(c => c.fac !== m.fac);
 at(M, {x: foeTown.gate.x, y: foeTown.gate.y + 16});
 r = act(m, 'move_to', {target: foeTown.name}); ok(!r.ok && /enemy town/.test(r.error), 'no setting: an enemy town is refused as ever');
 at(M, {x: foeTown.spots.square.x, y: foeTown.spots.square.y}); r = act(m, 'learn_profession', {id: 'mining'}); ok(!r.ok && /not a town of your side/.test(r.error), 'no setting: its trainers refuse as ever');
}

console.log('Between sides');
{const {playerAct} = await import('../src/sim/player.js'), {dmAct, setDmSeat} = await import('../src/sim/dmagent.js'), {takeWound, tendBlock} = await import('../src/sim/tend.js'), {maxHp, slay} = await import('../src/sim/heroes.js'), {rebuild} = await import('../src/sim/spatial.js'), {nearestFoe} = await import('../src/sim/party.js'), {foeOf, inCompany, sidesOff, mayFight} = await import('../src/sim/state.js'), {zoneFor, zonePoint} = await import('../src/world/map.js'), {TABLE} = await import('../src/sim/table.js');
 const act = (a, t, x) => playerAct(a.id, t, x || {});
 init({setup: cleanSetup(mixed(1025))}); if (S.opening) S.opening.queue.length = 0; setDmSeat(true); TABLE.mode = 'off';
 const F = SLT.slotted(), L = SLT.slotHeroes(F), con = L.find(a => a.fac === 0), war = L.find(a => a.fac === 1), bg = f => S.agents.filter(a => !inCompany(a) && a.fac === f && a.state !== 'dead');
 for (const a of L) a.lvl = Math.max(a.lvl, 6);
 const p = zonePoint(zoneFor(6, CITY[0].gate), null, CITY[0].gate);
 const put = (list, q) => {list.forEach((a, i) => {Object.assign(a, {x: q.x + (i % 3) * .5, y: q.y + (i > 2 ? .5 : 0), state: 'hunt', hp: maxHp(a), dest: null, target: null, pq: []})}); rebuild()};
 put(L, p);
 ok(!foeOf(con, war) && !foeOf(war, con), 'two of one company are no foes, whatever their history');
 {const b = bg(1)[0], c = bg(0)[0]; ok(!foeOf(con, b) && !foeOf(b, con) && !sidesOff(c, b) && sidesOff(con, b), 'a background hero is no foe of a company'); ok(foeOf(c, b), 'the background keeps its sides among itself');
  put([b], {x: p.x + 1, y: p.y + 1}); ok(!nearestFoe(con, 6) && !nearestFoe(b, 6), 'nearestFoe: neither sees the other');
  let r = act(con, 'look'); ok(!JSON.stringify(r.foes || []).includes(b.name), 'look lists no background hero as a foe');
  r = act(con, 'fight', {target: b.name}); ok(!r.ok && /no foe of yours|No such target/.test(r.error), 'fight is refused against a background hero: ' + r.error);
  r = act(con, 'talk', {target: b.name}); ok(r.ok && !/hand on their weapon/.test(JSON.stringify(r)), 'a hero of the other history answers without a hand on a weapon')}
 // company verbs
 {const C2 = SLT.companies()[0], s = bg(1)[1]; ok(SLT.refuseJoin(C2, s) === null || !/faction/.test(SLT.refuseJoin(C2, s)), 'refuseJoin says nothing of factions');
  let r = act(con, 'follow', {who: war.name}); ok(r.ok, 'follow a companion of the other history: ' + (r.error || 'ok')); con.pq = [];
  takeWound(war, 'a test'); ok(!/no friend/.test(tendBlock(con, war) || ''), 'tend: a companion of the other history is a friend');
  r = act(con, 'challenge', {hero: war.name}); ok(r.ok, 'challenge: an honour duel with a companion of the other history: ' + (r.error || 'offered'));
  con.pq = []; if (S.challenges) S.challenges.length = 0}
 // the DM's antagonist
 {put(L, p); let r = dmAct('summon_hero', {fac: FAC[1 - F.fac].name, cls: 'Rogue', level: con.lvl, near: 'fellowship', name: 'Sefa Dray', why: 'a rival'}); const foe = S.agents.find(a => a.name === 'Sefa Dray');
  ok(r.ok && foe && foe.summoned, 'summon_hero brings an antagonist: ' + (r.error || foe.name));
  r = dmAct('summon_hero', {fac: FAC[F.fac].name, cls: 'Priest', level: con.lvl, near: 'fellowship', name: 'Ansa Wey', why: 'a healer'}); const kind = S.agents.find(a => a.name === 'Ansa Wey');
  ok(foeOf(con, foe) && foeOf(war, foe) && foeOf(foe, war), 'a summon of the other fac from the company\'s own is a foe to every member, of either history');
  ok(kind && !foeOf(con, kind) && !foeOf(war, kind) && mayFight(con, kind), 'a summon of the company\'s own fac is no foe, though a hero may turn on it');
  put([foe], {x: p.x + 1, y: p.y}); put(L, p); const hon = con.honor, fh = S.facStats[con.fac].honor;
  r = act(war, 'look'); ok(JSON.stringify(r).includes('Sefa Dray'), 'look shows the antagonist');
  r = act(war, 'fight', {target: 'Sefa Dray'}); ok(r.ok, 'fight is valid against a summoned antagonist: ' + (r.error || r.duel));
  ok(foe.state === 'duel' && war.state === 'duel', 'and it is a duel');
  war.state = 'hunt'; war.target = null; foe.state = 'hunt'; foe.target = null; foe.guild = null;
  const mate = L.find(a => a !== con), n0 = Object.keys(mate.nemesis || {}).length; slay(mate, foe);
  ok(Object.keys(con.nemesis || {}).length === 0 && !L.some(a => a !== mate && a.nemesis && a.nemesis[foe.id]), 'a companion slain by the antagonist leaves no nemesis in the company');
  ok(foe.honor === 0 || foe.honor == null, 'no honour credit for that kill'); foe.hp = 1;
  slay(foe, con); ok(con.honor === hon && S.facStats[con.fac].honor === fh, 'nor for slaying the antagonist')}
 // a long run: a full roster around a mixed company
 {init({setup: cleanSetup(mixed(1025))}); if (S.opening) S.opening.queue.length = 0; TABLE.mode = 'off';
  let touched = 0, bgDuels = 0; const seen = new Set();
  for (let i = 0; i < 1800; i++) {step(1); for (const a of S.agents) {if (a.state !== 'duel' && a.state !== 'assist') continue; if (!a.target || a.target.kind !== 'hero') continue; if (inCompany(a) || inCompany(a.target)) touched++; else if (!seen.has(a.id)) {seen.add(a.id); bgDuels++}}}
  const nem = S.agents.filter(a => inCompany(a) && Object.keys(a.nemesis || {}).length), onCo = S.agents.filter(a => !inCompany(a) && Object.keys(a.nemesis || {}).some(id => {const k = S.agents.find(x => x.id === +id); return k && inCompany(k)}));
  ok(touched === 0, 'seven game days with a full roster: no background hero ever duels a company member (' + touched + ')');
  ok(bgDuels > 0, 'while the background still duels among itself (' + bgDuels + ' heroes)');
  ok(nem.length === 0 && onCo.length === 0, 'no nemesis in or on a company');
  ok(S.agents.filter(a => a.goal && inCompany(a) && (a.goal.type === 'rival' || a.goal.type === 'avengeHero')).every(a => a.goal.aside || a.goal.offered), 'no company hero is sworn against a hero')}
}

console.log('Raids');
{const {playerAct} = await import('../src/sim/player.js'), {joinRaid, raidCheck, updBoss} = await import('../src/sim/boss.js'), {musterWord, lastCall} = await import('../src/sim/callto.js'), {raidSide, inCompany} = await import('../src/sim/state.js'), {maxHp, gainXp} = await import('../src/sim/heroes.js'), {seedLevel} = await import('../src/sim/heroes.js'), {TABLE} = await import('../src/sim/table.js'), {pull} = await import('../src/sim/levers.js'), {rebuild} = await import('../src/sim/spatial.js');
 const chron = () => S.chronicle.slice(0, 30).flatMap(e => e.parts.map(p => typeof p === 'string' ? p : p && (p.name || p.t) || '')).join(' ');
 init({setup: cleanSetup(mixed(1025))}); if (S.opening) S.opening.queue.length = 0; TABLE.mode = 'off';
 const F = SLT.slotted(), L = SLT.slotHeroes(F), f = F.fac;
 for (const a of L) {seedLevel(a, 14); Object.assign(a, {x: L[0].x, y: L[0].y, state: 'hunt', hp: maxHp(a), gear: 12, dest: null, target: null, pq: []})} rebuild();
 S.raidOn[f] = S.raidOn[1 - f] = true; // a background muster is out, of both histories
 ok(!joinRaid(L[0]) && !L[0].raid, 'joinRaid: no muster to fall in with');
 ok(!/muster is out/.test(musterWord(F, false) || ''), 'musterWord: no faction muster reaches a company');
 S.raidOn[0] = S.raidOn[1] = false;
 {const r = playerAct(L[0].id, 'join_raid', {}); ok(!r.ok, 'join_raid is refused: ' + r.error)}
 // the company's own raid: its vote passed
 (F.wait || (F.wait = {})).raid = S.gameMin + 600; (F.accept || (F.accept = {})).raid = S.gameMin + 600; for (const a of L) a.raidOk = true; S.raidT = 0;
 raidCheck(.1);
 ok(L.every(a => a.raid && a.state === 'raid') && S.raidOn[f], 'the company musters whole, both histories in it');
 ok(L.every(a => raidSide(a) === f), 'all five fight under one side');
 ok(S.agents.filter(a => a.raid && !inCompany(a)).length === 0, 'no background hero joins a company\'s raid');
 ok(chron().includes(F.name + ' musters') || chron().includes(F.name), 'the Chronicle names the company, not a faction: ' + chron().slice(0, 80));
 raidCheck(.1); ok(L.every(a => a.raid), 'the raid holds while its side stands');
 const g0 = L.map(a => a.gold); S.boss.hp = 1; S.boss.dmg = [0, 0]; S.boss.dmg[f] = 5000; for (const a of L) {a.x = S.boss.x + 1; a.y = S.boss.y + 1}
 S.boss.hp = 0; updBoss(.1);
 ok(!S.boss.alive && L.every((a, i) => a.gold > g0[i]), 'Kragmaw falls and all five are paid, whatever their history');
 ok(chron().split(' ').join('').includes(F.name.split(' ').join('') + 'slew'), 'the Chronicle says the company slew it');
 for (const a of L) {a.raid = false; a.state = 'hunt'}
 S.raidOn[f] = false;
 // a background muster never drafts a company
 init({setup: cleanSetup(mixed(1025))}); if (S.opening) S.opening.queue.length = 0; TABLE.mode = 'off'; const M = SLT.slotHeroes(SLT.slotted());
 for (const a of M) {seedLevel(a, 15); a.gear = 12}
 for (const a of S.agents) if (!inCompany(a) && a.state !== 'dead') {seedLevel(a, 15); a.gear = 12}
 let drafted = 0, bgRaid = 0; for (let i = 0; i < 1200; i++) {step(1); if (M.some(a => a.raid)) drafted++; if (S.agents.some(a => a.raid && !inCompany(a))) bgRaid++}
 ok(drafted === 0, 'a company is never drafted into a muster'); ok(bgRaid > 0, 'while the background raids among itself');
}
{ // no setting: as ever
 init({setup: cleanSetup(defaultSetup(1025, 'eldmoor', 0))}); if (S.opening) S.opening.queue.length = 0; const {joinRaid} = await import('../src/sim/boss.js'), a = SLT.slotHeroes(SLT.slotted())[0]; S.raidOn[a.fac] = true;
 ok(joinRaid(a) && a.raid, 'no setting: joinRaid falls in as ever'); a.raid = false; a.state = 'hunt'; S.raidOn[a.fac] = false}

console.log('A world repeats');
{const run = k => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', k], {encoding: 'utf8', env: {...process.env, ELDMOOR_SIDES: ''}}).stdout.split(/\r?\n/).find(l => l.startsWith('SIG ')) || 'none';
 const a = run('seeded'), b = run('seeded'), c = run('lore'), d = run('lore');
 ok(a !== 'none' && a === b, 'a seeded world repeats');
 ok(c !== 'none' && c === d, 'a lore world repeats for its seed');
}

console.log(fails ? fails + ' of ' + n + ' FAILED' : n + ' checks passed');
process.exit(fails ? 1 : 0);
