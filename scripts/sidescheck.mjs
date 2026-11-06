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

console.log('A world repeats');
{const run = k => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', k], {encoding: 'utf8', env: {...process.env, ELDMOOR_SIDES: ''}}).stdout.split(/\r?\n/).find(l => l.startsWith('SIG ')) || 'none';
 const a = run('seeded'), b = run('seeded'), c = run('lore'), d = run('lore');
 ok(a !== 'none' && a === b, 'a seeded world repeats');
 ok(c !== 'none' && c === d, 'a lore world repeats for its seed');
}

console.log(fails ? fails + ' of ' + n + ' FAILED' : n + ' checks passed');
process.exit(fails ? 1 : 0);
