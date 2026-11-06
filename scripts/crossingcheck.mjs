// crossingcheck (#1013): one process, more than one map. Part 1 (slice 1b): the switch of the live map itself.
//   1. every key of S, and of what modules keep beside it, is placed in sim/atlas.js: per map, with the company or campaign-wide.
//   2. after setWorld, everything a module captured from the map (kept.js worldCaptures: road points, level tables, words, the text
//      built from them, the path grid, the fauna) equals what a fresh process on that map builds, from every starting world.
//   3. after setWorld to a TESTLINK fixture (no lair, no dungeon, one region) the same captures describe the fixture, and nothing
//      of the old map is left in them; back again they equal the start, byte for byte.
//   4. what acts on the live map follows it: the spatial index, homes, node and outpost state, and a world built after a switch
//      plays exactly as a world built in a fresh process.
// The pack, the unpack and the crossing are later slices. Usage: npm run crossingcheck
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkTmp} from './tmp.mjs';
import {parseAst} from 'rollup/parseAst';
import {localsOf} from './mapcapture.mjs';

const HERE = fileURLToPath(import.meta.url), ROOT = resolve(dirname(HERE), '..');
const [mode, ...args] = process.argv.slice(2);
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
// One stub, before the sim loads: core/rng.js takes Math.random when it loads, so reseeding restarts this stub's state.
let seed = 0x1013; const reseed = () => {seed = 0x1013};
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

// Loads the sim for a child process (which world it starts on is ELDMOOR_WORLD).
async function sim() {
  const SIM = await import('../src/sim/index.js');
  await import('../src/sim/player.js'); await import('../src/sim/dmagent.js'); await import('../src/sim/staged.js'); await import('../src/sim/dmwhen.js');
  const K = await import('../src/sim/kept.js'), M = await import('../src/world/map.js'), T = await import('../src/world/tiles.js');
  const {MOBS, COUNTS, ELITES, ECO} = await import('../src/data/mobs.js'), {EPICS} = await import('../src/data/items.js');
  const dump = () => ({...K.worldCaptures(), size: [T.W, T.H], zones: M.ZONES, towns: M.CITY.map(c => c.name), crypts: M.CRYPTS.map(c => c.name), lair: M.LAIR && M.LAIR.name,
    exits: M.EXITS, mobs: MOBS, counts: COUNTS, elites: ELITES, epics: EPICS, roadMinX: ECO.roadMinX});
  return {SIM, K, M, T, dump, run: s => {for (let i = 0; i < s * 60; i++) SIM.step(1 / 60)}};
}
// A world played a while, as plain facts: who stands where, what they have, what roams.
const fingerprint = S => JSON.stringify({heroes: S.agents.map(a => [a.id, a.name, a.cls, a.lvl, a.state, Math.round(a.x * 100), Math.round(a.y * 100), a.hp, a.gold, a.town]),
  mobs: S.mobs.map(m => [m.id, m.type, m.lvl, Math.round(m.x * 100), Math.round(m.y * 100), m.alive]), boss: [S.boss.x, S.boss.y, S.boss.hp], log: S.chronicle.length});
const diffKeys = (a, b, norm = x => x) => Object.keys({...a, ...b}).filter(k => norm(JSON.stringify(a[k])) !== norm(JSON.stringify(b[k])));

// ---- children ----
if (mode === '--fresh') { // what a process that started on this map holds
  const {SIM, dump, run} = await sim();
  reseed(); SIM.init(); run(5);
  const {WORDS} = await import('../src/world/words.js');
  writeFileSync(args[0], JSON.stringify({dump: dump(), world: WORDS.world, play: fingerprint(SIM.S)}));
  process.exit(0);
}
if (mode === '--hop') { // start here, go to every map, come back
  const fresh = JSON.parse(readFileSync(args[0], 'utf8')); // {worldId: {dump, world, play}}
  const {SIM, M, T, dump, run} = await sim();
  const {MAPS, WORLDS, TESTLINK, WORLD_ID} = await import('../src/world/spec.js');
  const {WORDS} = await import('../src/world/words.js');
  const {homeOf} = await import('../src/data/races.js');
  const {rebuild, nearMobs, nearHeroes} = await import('../src/sim/spatial.js');
  const {harvest, isReady, readyAt, NODES} = await import('../src/sim/nodes.js');
  const {mapKey} = await import('../src/sim/atlas.js');
  const {lineCost} = await import('../src/sim/path.js');
  const {S} = SIM;
  console.log('\nfrom ' + WORLD_ID);
  reseed(); SIM.init(); run(5);
  ok(M.MAP_ID === WORLD_ID, 'a world that never switched is on its own map');
  const start = JSON.stringify(dump()), startWord = WORDS.world;
  const hero = S.agents.find(a => a.state !== 'dead'), homeTown = homeOf(hero);
  const node = NODES.find(n => isReady(n)), spent = harvest(node);
  ok(spent.ok && readyAt(node) > 0 && S.nodes.world === S.worldId, 'on its first map node state keeps the stamp it always had');
  const swap = (s, from, to) => s.split(from).join(to);
  for (const id of Object.keys(WORLDS)) {
    if (id === WORLD_ID) continue;
    ok(M.setWorld(id) === true && M.MAP_ID === id && WORLD_ID !== id, `setWorld(${id}) switches the live map and leaves the campaign where it was`);
    const bad = diffKeys(dump(), fresh[id].dump, s => swap(swap(String(s), startWord, '<world>'), fresh[id].world, '<world>'));
    ok(bad.length === 0, `${id}: every capture equals a fresh process on it (${Object.keys(dump()).length} compared)` + (bad.length ? ': ' + bad.join(', ') : ''));
    ok(WORDS.world === startWord, `${id}: the campaign's name stays`);
    ok(M.CITY.includes(homeOf(hero)), `${id}: a hero's remembered home is a town of the live map`);
    ok(isReady(M.NODES[0]) && readyAt(M.NODES[0]) === 0 && mapKey() !== S.worldId, `${id}: the spent nodes of another map do not count here`);
    if (M.OUTPOSTS.length) {const {holderOf} = await import('../src/sim/outposts.js'); ok(M.OUTPOSTS.every(p => holderOf(p) === -1), `${id}: its outposts start unheld`)}
  }
  for (const id of Object.keys(TESTLINK)) {
    const was = {towns: M.CITY.map(c => c.name), zones: M.ZONES.slice()};
    ok(M.setWorld(id) === true, `setWorld(${id})`);
    const D = dump(), spec = MAPS[id];
    ok(T.W === spec.size.w && T.H === spec.size.h && M.tiles.length === T.W * T.H, `${id}: the size is the map's`);
    ok(M.ZONES.length === spec.regions.length && D.mobZones === M.ZONES.length && D.mobTargets.length === M.ZONES.length && D.mobTypes.length === M.ZONES.length && D.mobRoads.length === M.ZONES.length && D.skies.length === M.ZONES.length && D.encZoneLevels.length === M.ZONES.length && D.dmRoads.length === M.ZONES.length, `${id}: every per-zone table has its zones`);
    ok(Object.values(D.mobs).every(m => m.z < M.ZONES.length) && D.mobTargets.every(n => n > 0) && D.elites.length === M.ZONES.length && D.epics.length === M.ZONES.length, `${id}: its fauna is its own`);
    const onRoad = p => M.tiles[M.I(Math.floor(p.x), Math.floor(p.y))] === T.ROAD;
    ok(D.dmRoads.flat().every(onRoad) && D.encSpots.every(onRoad) && D.mobRoads.flat().every(onRoad), `${id}: the road points stand on its roads`);
    ok(D.pathN === T.W * T.H && D.pathCost.every((c, i) => (c === Infinity) === !!M.solid[i]), `${id}: the path grid is its own`);
    {const i = M.solid.findIndex(v => !v), x = i % T.W, y = (i - x) / T.W, c = lineCost(x + .1, y + .5, x + .9, y + .5); ok(Number.isFinite(c) || !!M.solid[i + 1], `${id}: lineCost reads it`)}
    ok(D.spatial[0] === Math.ceil(T.W / 4) + 1 && D.spatial[1] === Math.ceil(T.H / 4) + 1 && D.spatial[3] === D.spatial[0] * D.spatial[1], `${id}: the spatial grids are its size`);
    {const m = {id: 1e9, x: T.W - .5, y: T.H - .5, alive: true}, h = {id: 1e9 + 1, x: 1.5, y: 1.5, state: 'hunt'}; S.mobs.push(m); S.agents.push(h); rebuild();
      ok(nearMobs(m.x, m.y, 2).includes(m) && nearHeroes(h.x, h.y, 2).includes(h), `${id}: the spatial index finds what stands at its corners`); S.mobs.pop(); S.agents.pop(); rebuild()}
    ok(D.goalCryptZone === -1 && !D.bossAt[2] && S.boss, `${id}: no dungeon reads as none, and no lair keeps a dormant boss`);
    ok(WORDS.lowRegion === M.ZONES[0] && WORDS.town(0) === M.CITY[0].name, `${id}: the words name its places`);
    // Nothing of the map just left, but the dungeon and the lair, which a map without its own keeps as the far places they are.
    const kept = new Set([WORDS.cryptRegion, WORDS.lairRegion]), left = [...was.towns, ...was.zones].filter(n => !kept.has(n) && !M.ZONES.includes(n));
    const text = JSON.stringify(D), stale = left.filter(n => text.includes(n));
    ok(stale.length === 0, `${id}: no name of the map it left is in its captures` + (stale.length ? ': ' + stale.join(', ') : ''));
  }
  ok(M.setWorld(WORLD_ID) === true && M.MAP_ID === WORLD_ID, 'back to the first map');
  const back = dump(), first = JSON.parse(start), moved = diffKeys(back, first).filter(k => k !== 'bossAt' || S.boss.alive !== first.bossAt[2]);
  ok(moved.length === 0, 'back: every capture equals the start' + (moved.length ? ': ' + moved.join(', ') : ''));
  ok(mapKey() === S.worldId && readyAt(node.id) > 0, 'back: its spent node is spent again');
  ok(homeOf(hero).name === homeTown.name, 'back: the hero is home again');
  // A world built after a switch is the world a fresh process builds.
  for (const id of Object.keys(WORLDS)) {
    M.setWorld(id); reseed(); SIM.init(); run(5);
    const got = fingerprint(S), want = fresh[id].play, same = swap(got, startWord, '<w>') === swap(want, fresh[id].world, '<w>');
    ok(same, `init() on ${id} after the switches plays as a fresh process does (5 s, ${S.agents.length} heroes, ${S.mobs.length} mobs)`);
  }
  process.exit(fail ? 1 : 0);
}

// ---- 1. every key is placed ----
console.log('\nEldmoor crossingcheck\n');
console.log('every key of S is per map, with the company or campaign-wide (sim/atlas.js)');
{
  const {S, init, step} = await import('../src/sim/index.js');
  await import('../src/sim/player.js'); await import('../src/sim/dmagent.js');
  const A = await import('../src/sim/atlas.js'), {keptState} = await import('../src/sim/kept.js');
  const walk = d => readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const keys = new Set(), collect = n => {
    const go = x => {if (Array.isArray(x)) x.forEach(go); else if (x && typeof x.type === 'string') {
      if (/Function/.test(x.type) && localsOf(x).has('S')) return; // a parameter or local named S is not this S
      if (x.type === 'MemberExpression' && !x.computed && x.object.type === 'Identifier' && x.object.name === 'S' && x.property.type === 'Identifier') keys.add(x.property.name);
      for (const k of Object.keys(x)) if (k !== 'type') {const v = x[k]; if (v && typeof v === 'object') go(v)}}};
    go(n)};
  for (const f of ['sim', 'ui', 'render', 'data', 'world'].flatMap(l => walk(join(ROOT, 'src', l))).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(f, 'utf8');
    if (!/import \{[^}]*\bS\b[^}]*\} from '[^']*state\.js'/.test(src)) continue; // a file with an S of its own is not this S
    collect(parseAst(src));
  }
  init(); for (let i = 0; i < 600; i++) step(1 / 60);
  for (const k of Object.keys(S)) keys.add(k);
  for (const k of ['fellowship', 'fellowshipsPast']) keys.delete(k); // old saves only: the migration reads them and they never reach a live S (rulescheck's shim rule)
  const loose = A.unclassified([...keys]);
  ok(loose.length === 0, `${keys.size} keys of S are placed` + (loose.length ? ': place ' + loose.join(', ') + ' in src/sim/atlas.js' : ''));
  const all = [...A.MAP_KEYS, ...A.COMPANY_KEYS, ...A.CAMPAIGN_KEYS], twice = all.filter((k, i) => all.indexOf(k) !== i), gone = all.filter(k => !keys.has(k));
  ok(twice.length === 0, 'no key is in two tables' + (twice.length ? ': ' + twice.join(', ') : ''));
  ok(gone.length === 0, 'no table names a key nothing uses' + (gone.length ? ': ' + gone.join(', ') : ''));
  const kept = Object.keys(keptState()), lost = kept.filter(k => !A.KEPT_MAP.includes(k) && !A.KEPT_CAMPAIGN.includes(k));
  ok(lost.length === 0, `${kept.length} kept states are placed` + (lost.length ? ': ' + lost.join(', ') : ''));
  ok(A.unclassified(['aNewKey']).length === 1, 'a new key is caught');
}

// ---- 2-4. a process per starting world ----
const {WORLDS} = await import('../src/world/spec.js');
const dir = mkTmp('eldmoor-crossing-'), fresh = {}, env = id => ({...process.env, ELDMOOR_WORLD: id});
for (const id of Object.keys(WORLDS)) {
  const f = join(dir, id + '.json'), r = spawnSync(process.execPath, [HERE, '--fresh', f], {env: env(id), encoding: 'utf8'});
  if (r.status !== 0) {ok(false, `a fresh process on ${id}: ` + (r.stderr || '').trim().slice(-400)); continue}
  fresh[id] = JSON.parse(readFileSync(f, 'utf8'));
}
const all = join(dir, 'fresh.json'); writeFileSync(all, JSON.stringify(fresh));
for (const id of Object.keys(WORLDS)) {
  const r = spawnSync(process.execPath, [HERE, '--hop', all], {env: env(id), encoding: 'utf8'});
  process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr.slice(-2000));
  ok(r.status === 0, `from ${id}: every hop holds`);
}
console.log(fail ? `\n${fail} FAILED` : '\ncrossingcheck ok');
process.exit(fail ? 1 : 0);
