// crossingcheck (#1013): one process, more than one map. Part 1 (slice 1b): the switch of the live map itself.
//   1. every key of S, and of what modules keep beside it, is placed in sim/atlas.js: per map, with the company or campaign-wide.
//   2. after setWorld, everything a module captured from the map (kept.js worldCaptures: road points, level tables, words, the text
//      built from them, the path grid, the fauna) equals what a fresh process on that map builds, from every starting world.
//   3. after setWorld to a TESTLINK fixture (no lair, no dungeon, one region) the same captures describe the fixture, and nothing
//      of the old map is left in them; back again they equal the start, byte for byte.
//   4. what acts on the live map follows it: the spatial index, homes, node and outpost state, and a world built after a switch
//      plays exactly as a world built in a fresh process.
//   5. a map with no lair and no dungeon plays: a whole game day through npm run sim's path, and with a host a company, a camp, votes,
//      a site crawl, a first delve, every read tool of a hero and of the DM, and the orders such a map cannot carry refused in words.
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
  // A map with no lair keeps the words it was handed (world/words.js: the place is still out there), so its text depends on the road taken, not on a stale capture.
  const noLair = id => !(WORLDS[id].landmarks || []).some(l => l.kind === 'lair'), handed = (L, id) => L.filter(k => !(noLair(id) && (k === 'words' || k === 'wordedTables')));
  for (const id of Object.keys(WORLDS)) {
    if (id === WORLD_ID) continue;
    ok(M.setWorld(id) === true && M.MAP_ID === id && WORLD_ID !== id, `setWorld(${id}) switches the live map and leaves the campaign where it was`);
    const bad = diffKeys(dump(), fresh[id].dump, s => swap(swap(String(s), startWord, '<world>'), fresh[id].world, '<world>'));
    ok(handed(bad, id).length === 0, `${id}: every capture equals a fresh process on it (${Object.keys(dump()).length} compared)` + (handed(bad, id).length ? ': ' + handed(bad, id).join(', ') : ''));
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
  ok(handed(moved, WORLD_ID).length === 0, 'back: every capture equals the start' + (handed(moved, WORLD_ID).length ? ': ' + handed(moved, WORLD_ID).join(', ') : ''));
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

if (mode === '--bare') { // a map with no lair and no dungeon, played as the only map of the world (ELDMOOR_WORLD=testbare)
  const {SIM, M, run} = await sim();
  const {S, init, snapshot, restore, markPlayer, playerAct, dmAct, setDmSeat, setRunnerLinks, setReflexAck, defaultSetup, cleanSetup} = SIM;
  const CO = await import('../src/sim/company.js'), CN = await import('../src/sim/council.js'), T = await import('../src/sim/table.js'), L = await import('../src/sim/levers.js');
  const {PLAYER_TOOLS} = await import('../src/data/player-tools.js'), {DM_TOOLS} = await import('../src/data/dm-tools.js');
  const {NO_CRYPT} = await import('../src/sim/crypts.js'), {NO_LAIR} = await import('../src/sim/lair.js');
  const {WORDS} = await import('../src/world/words.js');
  // A thrown TypeError comes back from both doors as a sentence: these are the sentences a read of nothing leaves.
  const BROKE = /did not understand that|DM tool failed|Cannot read|is not a function|is not iterable/;
  const shown = r => JSON.stringify(r, (k, v) => typeof v === 'function' ? undefined : v);
  const act = (a, tool, args) => {a.playRate = []; return playerAct(a.id, tool, args || {})};
  const refused = (r, words, m) => ok(r && r.ok === false && !BROKE.test(shown(r)) && (!words || r.error.includes(words)), m + ': ' + (r && r.error));
  const hosted = () => {T.TABLE.mode = 'auto'; T.TABLE.speed = 1; T.TABLE.drop = null; setRunnerLinks(() => 'none'); setReflexAck(() => true)};
  const words = ps => (ps || []).map(p => typeof p === 'string' ? p : p && (p.t != null ? p.t : p.name)).join('');
  const clearText = () => [...S.chronicle, ...(S.timeline || [])].map(e => words(e.parts)).join('\n');

  console.log('\na map with no lair and no dungeon');
  ok(!M.LAIR && !M.CRYPT && M.CRYPTS.length === 0, 'the fixture has neither');
  ok(!/undefined/.test(JSON.stringify([PLAYER_TOOLS, DM_TOOLS, {...WORDS, town: 0}])), 'the tools and the world\'s words read whole, with no dungeon or lair to name');

  reseed(); hosted(); init();
  const F = CO.slotted(), mem = CO.members(F), lead = CN.leaderOfC(F);
  ok(F && mem.length === 5 && mem.every(a => a.player) && !S.boss.alive, 'a company stands in its hall and the boss record is dormant');

  console.log('what a hero can read');
  {
    const bad = [];
    for (const t of PLAYER_TOOLS) if (!t.act) {const r = act(lead, t.name, {}); if (BROKE.test(shown(r))) bad.push(t.name + ': ' + (r.error || '').slice(0, 120))}
    ok(!bad.length, PLAYER_TOOLS.filter(t => !t.act).length + ' read tools answer without tripping' + (bad.length ? '\n    ' + bad.join('\n    ') : ''));
    const look = act(lead, 'look'), jobs = act(lead, 'list_jobs');
    ok(look.ok !== false && !BROKE.test(shown(look)), 'look answers');
    ok(jobs.ok !== false && !BROKE.test(shown(jobs)), 'list_jobs answers');
  }
  console.log('what the map cannot carry is refused in words');
  {
    refused(act(lead, 'propose', {kind: 'crypt'}), NO_CRYPT, 'propose crypt');
    refused(act(lead, 'propose', {kind: 'crypt', dungeon: 'the sunken crypt'}), NO_CRYPT, 'propose crypt, by name');
    refused(act(lead, 'propose', {kind: 'raid'}), NO_LAIR, 'propose raid');
    ok(CN.propose(lead, 'crypt', 'down') === NO_CRYPT && CN.propose(lead, 'raid', 'up') === NO_LAIR, 'and at the council\'s own door');
    ok(CN.askCompany(F, 'crypt', {src: 'dm', caller: 'A voice', details: 'go'}) === NO_CRYPT, 'askCompany with no dungeon answers the same');
    refused(act(mem[1], 'go_crypt'), null, 'go_crypt in a company');
    refused(act(mem[1], 'join_raid'), null, 'join_raid in a company');
    const solo = S.agents.find(a => a.state !== 'dead' && !CO.companyOf(a)); markPlayer(solo, true);
    ok(solo.player && CO.isSolo(CO.companyOf(solo)), solo.name + ' rides alone');
    refused(act(solo, 'go_crypt'), NO_CRYPT, 'go_crypt alone');
    refused(act(solo, 'go_crypt', {dungeon: 'the barrow', force: 'yes'}), NO_CRYPT, 'go_crypt to a name');
    refused(act(solo, 'join_raid'), NO_LAIR, 'join_raid alone');
    refused(act(solo, 'propose', {kind: 'crypt'}), NO_CRYPT, 'propose crypt alone');
    refused(act(lead, 'move_to', {target: 'the crypt'}), null, 'move_to the crypt');
    const nearby = (S.npcs || []).find(p => p.role === 'captain' && p.fac === lead.fac);
    if (nearby) {lead.x = nearby.x; lead.y = nearby.y; const r = act(lead, 'talk', {target: nearby.name, text: 'Where is the crypt?'}); ok(r.ok !== false && !BROKE.test(shown(r)), 'the gate captain is asked of the crypt and answers: ' + shown(r).slice(0, 110))}
  }
  console.log('what the DM can read and call');
  {
    setDmSeat(true);
    const bad = []; for (const t of DM_TOOLS) if (!t.act) {const r = dmAct(t.name, {}); if (BROKE.test(shown(r))) bad.push(t.name + ': ' + (r.error || '').slice(0, 120))}
    ok(!bad.length, DM_TOOLS.filter(t => !t.act).length + ' DM reads answer without tripping' + (bad.length ? '\n    ' + bad.join('\n    ') : ''));
    const w = dmAct('world_standing'); ok(w.ok && w.boss === null && w.crypt && w.crypt.name === null, 'world_standing says there is neither');
    const by = {by: 'dm-agent', reason: 'a test'};
    for (const kind of ['crypt', 'raid']) {const r = L.pull('call_to', {kind, company: F.id}, by); ok(!r.ok && /this map has no/.test(r.reason || r.error || ''), 'call_to ' + kind + ' is refused: ' + (r.reason || r.error))}
  }
  console.log('a company plays a whole game day on it');
  {
    const day0 = S.gameMin; let camps = 0, votes = 0, opened = 0;
    for (const a of mem) {a.x = lead.x; a.y = lead.y}
    const sayIt = act(lead, 'propose', {kind: 'other', details: 'We hold the ford tonight.'}); ok(sayIt.ok, 'the leader puts something to the vote');
    const P = F.props.find(q => q.kind === 'other');
    for (let i = 0; S.gameMin - day0 < 1440 && i < 12 * 60 * 60; i++) { // a table holds the clock while it plays
      SIM.step(1 / 60);
      if (F.camp && F.camp.phase) camps++;
      if (T.openScenes().length) opened++;
      if (P.status !== 'open') votes = 1;
      if (i === 40 * 60 && !(F.camp && F.camp.phase)) {const c = mem[0]; for (const a of mem) if (a.state !== 'dead') {a.x = c.x; a.y = c.y} act(CN.leaderOfC(F), 'rest', {hours: 3})}
    }
    ok(S.gameMin - day0 >= 1439, 'a full game day passed (' + Math.round(S.gameMin - day0) + ' game minutes)');
    ok(votes === 1, 'the vote settled: ' + P.status + ', ' + P.result);
    ok(camps > 0, 'the company made camp (' + camps + ' ticks at a fire), ' + opened + ' ticks at a table');
    ok(!S.boss.alive && !S.raidOn.some(Boolean), 'the boss stayed dormant and nobody mustered');
    const text = clearText(); ok(!/undefined/.test(text), 'nothing in the chronicle or timeline reads "undefined"');
    ok(!/stirs again|sleeps in its lair|lair lies empty|sleeps untouched/.test(text), 'nobody is told of a lair that is not here');
  }
  console.log('a save of it');
  {
    const a = JSON.stringify(snapshot()), snap = JSON.parse(a);
    ok(!('CRYPT' in snap), 'the save holds no dungeon');
    restore(snap); ok(JSON.stringify(snapshot()) === a, 'it restores to the same world'); run(5); ok(true, 'and plays on');
  }
  console.log('a site is the map\'s only dungeon');
  {
    reseed(); hosted(); init({fellowship: false}); const b = S.agents.find(x => x.state !== 'dead'); markPlayer(b, true);
    const by = {by: 'dm-agent', reason: 'a test'}, r0 = L.pull('create_site', {theme: 'barrow', region: 0, rooms: 3}, by);
    ok(r0.ok, 'the DM raises one: ' + shown(r0.effect || r0.reason).slice(0, 80));
    const st = S.sites.list[0]; b.x = st.x; b.y = st.y + 1; b.state = 'hunt'; b.lvl = 12; b.hp = 9999; SIM.step(1 / 60);
    const r = act(b, 'enter_site', {site: st.id}); ok(r.ok, 'a solo goes down: ' + shown(r).slice(0, 110));
    let inside = false, shut = false;
    for (let i = 0; i < 3000 * 60 && !shut; i++) {SIM.step(1 / 60); if (st.group) inside = true; else if (inside) shut = true; if (b.state === 'dead') break}
    ok(inside, 'the crawl ran on a map with no dungeon'); ok(shut || b.state === 'dead', 'and ended: ' + (st.state || st.phase || 'done'));
  }
  console.log('the first delve');
  {
    reseed(); hosted(); init({setup: cleanSetup({...defaultSetup(7, 'testbare', 0)})});
    const C = CO.slotted(); let began = false, done = false;
    for (let i = 0; i < 200000 && !done; i++) {SIM.step(1 / 60); if (C.prologue) began = true; else if (began) done = true}
    ok(began, 'a setup world on this map opens at a first delve'); ok(done, 'and comes home from it');
    const lines = (C.log || []).map(e => words(e.parts)).join('\n'); ok(!/undefined/.test(lines + clearText()), 'its words read whole');
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
// ---- 5. a map with no lair and no dungeon plays ----
console.log('\na game day through npm run sim\'s path');
for (const [id, extra, what] of [['testbare', {}, 'no lair, no dungeon'], ['testbare', {ELDMOOR_OTHERS: 'none'}, 'and nobody else on it'], ['testcellar', {}, 'a dungeon and no lair'], ['testden', {}, 'a lair and no dungeon']]) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/headless.mjs'), '4'], {env: {...env(id), ...extra}, encoding: 'utf8'}), out = r.stdout || '';
  ok(r.status === 0, `${what}: npm run sim plays 4 minutes, a whole game day` + (r.status ? ': ' + (r.stderr || '').trim().slice(-500) : ''));
  ok((id === 'testden' || /Kragmaw alive: false/.test(out)) && !/undefined/.test(out), `${what}: ${id === 'testden' ? 'the' : 'a dormant'} boss, and the summary reads whole`);
}
{
  const r = spawnSync(process.execPath, [HERE, '--bare'], {env: env('testbare'), encoding: 'utf8'});
  process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr.slice(-2000));
  ok(r.status === 0, 'the fixture holds with a host');
}
console.log(fail ? `\n${fail} FAILED` : '\ncrossingcheck ok');
process.exit(fail ? 1 : 0);
