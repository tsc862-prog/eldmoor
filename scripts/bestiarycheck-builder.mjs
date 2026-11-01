// Encounter-builder half of the bestiary check (see bestiarycheck.mjs).
import {init, step, S, snapshot} from '../src/sim/index.js';
import {buildEncounter, buildSite, customFoe, spawnFoe, budgetFor} from '../src/sim/encounterbuilder.js';
import {THEMES, CUSTOM} from '../src/data/encounter-tables.js';
import {MOBS} from '../src/data/mobs.js';

const seeded = (s) => () => {s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296};
const show = (f) => `${f.name}${f.variant ? ' [' + f.variant + ']' : ''} L${f.lvl} ${f.role}/${f.family} cost ${f.cost} abil ${f.abilities.join('+')}${f.boss ? ' BOSS' : ''}`;

export async function runBuilderChecks(ok) {
  init();
  // determinism
  const a = JSON.stringify(buildSite('crypt', [8, 11], 6, {rng: seeded(7)})), b = JSON.stringify(buildSite('crypt', [8, 11], 6, {rng: seeded(7)}));
  ok(a === b, 'buildSite is deterministic given the rng');
  ok(JSON.stringify(buildEncounter('den', 1, 7, 4, {rng: seeded(3)})) === JSON.stringify(buildEncounter('den', 1, 7, 4, {rng: seeded(3)})), 'buildEncounter is deterministic given the rng');

  // budgets across themes, regions, party levels and sizes
  let over = 0, n = 0, empty = 0, sizes = {};
  for (const theme of Object.keys(THEMES)) for (let region = 0; region < 4; region++) for (const lvl of [2, 7, 12, 17]) for (const size of [1, 2, 4, 6]) {
    const E = buildEncounter(theme, region, lvl, size, {rng: seeded(n * 31 + 5)});
    n++; if (!E.foes.length) empty++; if (E.foes.length > 1 && E.spent > E.budget + .2) over++;
    sizes[size] = (sizes[size] || 0) + E.foes.length;
  }
  ok(over === 0, `budget respected in ${n} encounters (${over} over)`);
  ok(empty === 0, 'no empty encounter');
  console.log('  avg foes per party size: ' + Object.keys(sizes).map((k) => k + ':' + (sizes[k] / (n / 4)).toFixed(1)).join('  '));

  // sites
  for (const theme of Object.keys(THEMES)) {
    const site = buildSite(theme, [8, 11], 6, {rng: seeded(11)});
    ok(site.rooms.length === 6 && site.rooms[0].kind === 'guard' && site.rooms[5].kind === 'boss', theme + ' site: 6 rooms, guard first, boss last');
    const boss = site.rooms[5];
    ok(boss.foes[0].boss && boss.loot.epic && boss.loot.gold > 0, theme + ' boss has a template, loot and a named epic');
  }

  // spawn every foe of a big site, run the world, round-trip the save
  const site = buildSite('crypt', [8, 11], 9, {rng: seeded(2)}), before = S.mobs.length;
  for (const r of site.rooms) for (const f of r.foes) {const m = spawnFoe(f); m.x = 40; m.y = 20; m.home = {x: 40, y: 20}; m.spawn = {x: 40, y: 20}}
  for (let i = 0; i < 600; i++) step(1 / 60);
  ok(S.mobs.length > before, 'site foes spawned and the world ran');
  const snap = JSON.parse(JSON.stringify(snapshot()));
  ok(Array.isArray(snap.mobs), 'a world holding spawned site foes serializes');
  const dm = S.mobs.find((x) => x.alive && !x.gone); dm.dots = [{h: S.agents[0], id: 'venom', rem: 3, dps: 2}];
  const snap2 = JSON.parse(JSON.stringify(snapshot())), {restore} = await import('../src/sim/index.js'); restore(snap2);
  const rm = S.mobs.find((x) => x.id === dm.id);
  ok(rm && rm.dots && rm.dots[0].h === S.agents.find((x) => x.id === snap2.agents[0].id) && rm.ab && rm.abcd, 'poison dots, abilities and cooldowns survive save and load');

  // custom foes
  S.gameMin = 1440 * 5 + 10; S.customFoes = null;
  const c1 = customFoe('spider', {name: 'The Grey Widow of Cairn', levels: 2, swap: ['venom', 'chill']}, {region: 0, level: 4, reason: 'test: a named horror for the Thornvale road'});
  ok(c1 && c1.special && c1.lvl === 6 && c1.points === 3, 'customFoe grants a special foe within 3 points');
  ok(customFoe('spider', {levels: 3}, {region: 0}) === null, 'customFoe refuses +3 levels');
  ok(customFoe('spider', {levels: 2, swap: ['venom', 'chill'], resist: ['holy', .9]}, {region: 0}) === null, 'customFoe refuses over the point budget');
  const c2 = customFoe('wolf', {resist: ['cold', .85]}, {region: 0});
  ok(!!c2, 'a second special foe is allowed in the region');
  ok(customFoe('boar', {}, {region: 0}) === null, `a third special foe in one region and day is refused (cap ${CUSTOM.perRegionDay})`);
  ok(!!customFoe('boar', {}, {region: 1, level: 8}), 'another region has its own cap');
  S.gameMin += 1440;
  ok(!!customFoe('boar', {}, {region: 0}), 'the cap resets the next game-day');
  ok(S.dmLog.some((e) => e.kind === 'custom' && e.detail.granted) && S.dmLog.some((e) => e.kind === 'custom' && !e.detail.granted), 'grants and refusals are in the DM log');
  const m = spawnFoe(c1); ok(m.special && m.ab.includes('chill') && m.name === 'The Grey Widow of Cairn', 'a special foe spawns with its tweaks');

  // samples (pasted into the PR)
  console.log('\nbuildEncounter("den", 1, 7, 4) seeded:');
  const E = buildEncounter('den', 1, 7, 4, {rng: seeded(42)}); console.log(`  budget ${E.budget} spent ${E.spent}`); E.foes.forEach((f) => console.log('  ' + show(f)));
  console.log('\nbuildSite("crypt", [8, 11], 6) seeded:');
  const s = buildSite('crypt', [8, 11], 6, {rng: seeded(42)});
  for (const r of s.rooms) {
    console.log(`  room ${r.i + 1} ${r.kind.toUpperCase()} L${r.level} (${['Thornvale', 'Mirefen', 'Cinderpass', 'Hoarfell'][r.region]})` + (r.hazard ? ' - ' + r.hazard.name + (r.hazard.dc ? ' (DC ' + r.hazard.dc + ')' : '') : ''));
    r.foes.forEach((f) => console.log('     ' + show(f)));
    const L = r.loot; console.log(`     loot: ${L.gold}g` + (L.goods.length ? ', ' + L.goods.join(', ') : '') + (L.gear ? `, ${L.gear.quality} item ilvl ${L.gear.ilvl}` : '') + (L.epic ? `, ${Math.round(L.epicChance * 100)}% ${L.epic}` : ''));
  }
}
