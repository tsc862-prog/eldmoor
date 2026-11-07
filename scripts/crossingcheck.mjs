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
// Part 2 (slice 2): the pack.
//   6. pack, play elsewhere, unpack, on the fixtures and on a full world: who freezes, what stays campaign-wide, heroes away are not heroes
//      gone, catchUp, and frozen state identical on return.
//   7. a save with a frozen map, at the moment of the switch and after play there, replayed in a fresh process that boots on the first map.
//   8. a full roster on five maps against the store: mock IndexedDB under the real ui/savestore.js, a localStorage that refuses past 5 MB;
//      the page's save, load, export, import and the move out of localStorage through the real ui/save.js.
// Part 3 (slice 3): the crossing.
//   9. on the TESTLINK fixtures: the leader's word and nothing else opens a road; every hold in words; go, wait, turn back as a vote; all or
//      none; the company spread at the entry, what it leaves behind, the arrival; frozen state identical on return; a fallen member on the far
//      map; the DM at both tables; mock runners holding real claims across it, one mid-wait; a save mid-crossing in a fresh process.
//  10. a company stays a party (#1048): through a walk to any town, on any map, after a fall; lead_to after it, for any company; C.road ends with the words.
// Usage: npm run crossingcheck
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
  // render's captures (slice 4): chunk grid, scenery, peak and shadow sizes, weather boxes, town labels, creature sheets. Two modules make a small canvas as they load; nothing else here wants a DOM
  globalThis.document = {createElement: () => ({getContext: () => ({})})}; await import('../src/render/draw.js'); delete globalThis.document;
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

// ---- part 2 (slice 2): the pack ----
// A save reduced to what the pack must keep: hero references without their inline name, and what a crossing rightly changes taken out.
const plainRefs = v => {if (Array.isArray(v)) return v.map(plainRefs); if (!v || typeof v !== 'object') return v;
  if (v.ref === 'hero') return {ref: 'hero', id: v.id}; const o = {}; for (const k in v) o[k] = plainRefs(v[k]); return o};
function firstDiffs(a, b, p = '$', out = []) {if (out.length > 8 || a === b) return out;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {if (!(Number.isNaN(a) && Number.isNaN(b))) out.push(p + ': ' + String(JSON.stringify(a)).slice(0, 70) + ' != ' + String(JSON.stringify(b)).slice(0, 70)); return out}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) firstDiffs(a[k], b[k], p + '.' + k, out); return out}
const TAKEN = ['x', 'y', 'zone', 'target', 'dest', 'path', 'moving', 'state']; // what a crossing does to those who go
async function packTools() {
  const base = await sim(), {SIM, M} = base, {S, snapshot, restore, switchMap, setDmSeat, playerAct, dmAct} = SIM;
  const P = await import('../src/sim/mappack.js'), A = await import('../src/sim/atlas.js'), L = await import('../src/sim/levers.js');
  const {PLAYER_TOOLS} = await import('../src/data/player-tools.js'), {DM_TOOLS} = await import('../src/data/dm-tools.js');
  const {inCompany} = await import('../src/sim/state.js'), {slotted, members, leaderOf} = await import('../src/sim/company.js');
  const json = () => JSON.parse(JSON.stringify(snapshot()));
  const comparable = (snap, deadGone) => {const s = plainRefs(snap), go = new Set(s.agents.filter(a => a.state !== 'dead' && (a.company != null || a.player || a.companion != null || a.hire)).map(a => a.id));
    for (const p of s.parties) if (p.mem.some(r => go.has(r.id))) for (const r of p.mem) go.add(r.id);
    const whole = a => a.company != null || a.player || a.companion != null || (s.pinned && s.pinned.id === a.id);
    s.agents = s.agents.filter(a => !(deadGone.has(a.id) && !whole(a)));
    for (const a of s.agents) {if (go.has(a.id)) for (const k of TAKEN) delete a[k]; else if (a.history) a.history = a.history.slice(-P.FROZEN_HISTORY)}
    for (const m of s.mobs) if (m.target && go.has(m.target.id)) m.target = null;
    delete s.uid; delete s.campaign; delete s.dmLog; delete s.dmLogSeq; delete s.fx; if (s.levers) delete s.levers.ecoT; return s};
  return {...base, S, snapshot, restore, switchMap, setDmSeat, playerAct, dmAct, P, A, L, PLAYER_TOOLS, DM_TOOLS, inCompany, slotted, members, leaderOf, json, comparable};
}
const BROKEN = /did not understand that|DM tool failed|Cannot read|is not a function|is not iterable/;
const said = r => JSON.stringify(r, (k, v) => typeof v === 'function' ? undefined : v);

if (mode === '--pack') { // pack, play elsewhere, unpack: the frozen state comes back as it left. args[0]: the map to go to
  const far = args[0], T = await packTools(), {S, SIM, M, run, json, comparable, switchMap, P, A, L} = T, home = M.MAP_ID;
  console.log('\npack ' + home + ', go to ' + far + ', come back');
  reseed(); SIM.init(); T.setDmSeat(true); run(240);
  ok(!S.maps && json().campaign.map === home && !Object.keys(json().campaign.maps).length && json().version === 8, 'a world that never left its map has packed nothing: v8, campaign ' + home + ', no frozen maps');
  // Give every split something to hold: a daily count, a region's count and cooldown, a bare cooldown, a death the DM has seen, an encounter seen.
  L.ensureLevers(); const Lv = S.levers, day = Math.floor(S.gameMin / 1440); if (Lv.day.d !== day) Lv.day = {d: day, n: {}, rz: {}, nf: {}};
  Lv.day.n.summon_hero = 2; Lv.day.nf.seed_rumour = 1; Lv.day.rz['post_hook:0'] = 1; Lv.cd.start_event = S.gameMin + 9999; Lv.cd['create_npc:0'] = S.gameMin + 9999; Lv.active.push({id: ++Lv.seq, name: 'test_mark', until: S.gameMin + 9999});
  S.dmSeen = S.dmSeen || {dead: [], enc: {}}; S.dmSeen.dead.push(4242); S.dmSeen.enc.test = 1; S.worldEvent = {lastEnd: S.gameMin - 5, done: [{kind: 'festival', z: 0}], cur: {id: 1, kind: 'plague', z: 0}};
  const left = S.agents.filter(a => !T.inCompany(a) && !a.party), dead = S.agents.filter(a => a.state === 'dead' && !a.player && a.company == null && a !== S.pinned), living = left.filter(a => a.state !== 'dead');
  if (!dead.length && living.length) {const d = living.pop(); d.state = 'dead'; d.cause = 'a test'; dead.push(d)}
  const F = T.slotted(), lead = T.leaderOf(F), foe = living.find(a => a.fac !== lead.fac) || living[0], friend = living[1] || living[0];
  lead.nemesis[foe.id] = 'an old friend'; lead.bonds = {...(lead.bonds || {}), [friend.id]: 30}; lead.goal = {type: 'rival', targetId: foe.id, target: foe.name, targetFac: foe.fac, need: 99, progress: 0, tier: 0, text: 'To best ' + foe.name};
  if (M.CRYPT) M.CRYPT.cd = 50;
  const before = json(), rich = [...S.agents].sort((a, b) => (b.history || []).length - (a.history || []).length).find(a => !T.inCompany(a) && a.state !== 'dead');
  const richLines = rich ? (rich.history || []).length : 0, deadSize = JSON.stringify(before.agents.find(a => a.id === dead[0].id)).length, heroes = S.agents.length;
  const keep = {seq: Lv.seq}, crypt0 = M.CRYPT && M.CRYPT.name, raider = living[2] || living[0], raiderId = raider.id, friendId = friend.id;
  raider.target = S.boss; if (M.CRYPT) M.CRYPT.group = {fac: raider.fac, mem: [raider], phase: 'gather', t: 30};

  const P0 = S.parties.find(p => p.company != null) || null; if (P0) P0.zone = M.ZONES.length - 1;
  lead.goal.zone = M.ZONES.length - 1;
  console.log('leaving');
  ok(switchMap(far) === true && M.MAP_ID === far && S.maps[home], 'the map is packed and ' + far + ' is live');
  ok(S.parties.every(p => M.ZPTS[p.zone]), 'a company party walks by the regions of the map it stands on');
  const m = S.maps[home];
  ok(S.agents.every(a => T.inCompany(a) || (a.party && a.party.mem.some(T.inCompany))) && m.agents.length + m.dead.length + S.agents.length === heroes, `frozen heroes left S.agents: ${S.agents.length} went, ${m.agents.length} stayed, ${m.dead.length} are stubs`);
  ok(T.members(F).length === before.companies.find(c => c.slots).ids.length, 'the company crossed whole');
  ok(m.dead.length === dead.length && m.dead.every(a => Object.keys(a).every(k => !['history', 'slots', 'inv', 'memory', 'bonds', 'abil'].includes(k)) && a.name && a.kind === 'hero' && a.state === 'dead') && JSON.stringify(m.dead[0]).length * 4 < deadSize, `the dead pack as stubs (${JSON.stringify(m.dead[0]).length} of ${deadSize} characters)`);
  ok(m.agents.filter(a => a.state !== 'dead').every(a => !a.history || a.history.length <= P.FROZEN_HISTORY), `a frozen hero's log is capped at ${P.FROZEN_HISTORY} lines (the richest had ${richLines})`);
  console.log('what stays with the campaign');
  ok(S.levers.seq === keep.seq && S.levers.day.n.summon_hero === 2 && S.levers.day.nf.seed_rumour === 1 && S.levers.day.d === day, 'the daily counts, the summon and rumour caps and seq stay: a crossing refills nothing');
  ok(S.levers.cd.start_event > S.gameMin && !('create_npc:0' in S.levers.cd) && !S.levers.day.rz['post_hook:0'] && !S.levers.active.length, 'a bare cooldown stays; region counts, region cooldowns and what is in force freeze with the land');
  ok(S.dmSeen.dead.includes(4242) && !S.dmSeen.enc.test, 'dmSeen: the dead stay, the encounters freeze');
  ok(S.worldEvent.lastEnd != null && !S.worldEvent.cur && !S.worldEvent.done.length, 'worldEvent: the cooldown stays, the event in force freezes');

  console.log('heroes away are not heroes gone');
  const read = () => {const bad = []; for (const t of T.PLAYER_TOOLS) if (!t.act) {lead.playRate = []; const r = T.playerAct(lead.id, t.name, {}); if (BROKEN.test(said(r))) bad.push(t.name)}
    T.setDmSeat(true); for (const t of T.DM_TOOLS) if (!t.act) {const r = T.dmAct(t.name, {}); if (BROKEN.test(said(r))) bad.push('dm ' + t.name)} return bad};
  {const bad = read(); ok(!bad.length, 'every hero and DM read answers with the others frozen' + (bad.length ? ': ' + bad.join(', ') : ''))}
  {const g = m.agents.find(a => a.guild && a.state !== 'dead'), G = g && g.guild, line = S.chronicle.length, was = S.gameMin, oath = lead.goal; run(2); S.gameMin += 9 * 1440; S.bondT = 1e7; run(30);
    ok(lead.goal === oath && !oath.done, 'an oath against a hero on a frozen map stands');
    ok(lead.bonds[friend.id] > 0, 'a bond with a hero on a frozen map waits');
    if (G) ok(!G.retired && G.leaderId === before.GUILDS.find(x => x.id === G.id).leaderId, `<${G.tag}> with its people away neither dwindles nor passes its banner, nine days on`);
    ok(!S.chronicle.slice(0, Math.max(0, S.chronicle.length - line)).some(e => /now its leader has fallen|dwindled/.test(e.parts.map(p => typeof p === 'string' ? p : '').join(''))), 'the chronicle says nothing of it');
    {const was = ((S.legends && S.legends.list) || []).filter(e => A.isAway(e.id)); ok(was.length > 0 && was.every(e => e.alive || m.agents.find(a => a.id === e.id).state === 'dead'), `the Legends hall keeps them alive (${was.length} listed)`)}
    S.gameMin = was}
  {const a = JSON.stringify(T.snapshot()), j = JSON.parse(a); ok(j.campaign.map === far && j.campaign.maps[home] && j.campaign.maps[home].agents.length === m.agents.length, 'the save holds the frozen map under campaign.maps');
    T.restore(j); const d = firstDiffs(JSON.parse(a), json()); ok(!d.length, 'a save on the far map restores to the same world' + (d.length ? ':\n    ' + d.join('\n    ') : ''));
    ok(A.frozenMaps().length === 1 && S.maps[home].boss.kind === 'boss', 'with the frozen map whole');
    const w = S.maps[home], r = w.agents.find(x => x.id === raiderId); ok(r && r.target === w.boss && (!crypt0 || w.crypts[crypt0].group.mem[0] === r), 'a frozen hero\'s links hold through the save: its target is that map\'s boss, its dungeon group holds it');
    const inside = []; const walk = (v, p) => {if (!v || typeof v !== 'object') return; if (v.kind === 'hero' || v.kind === 'mob') {if (!/^\$(\.campaign\.maps\.\w+)?\.(agents|dead|mobs)\.\d+$/.test(p)) inside.push(p)} for (const k in v) walk(v[k], p + '.' + k)}; walk(j, '$');
    ok(!inside.length, 'no live entity is written outside its home' + (inside.length ? ': ' + inside.slice(0, 4).join(', ') : ''))}

  console.log('coming back');
  S.gameMin += 60; const elapsed = S.gameMin - S.maps[home].left, cd = crypt0 && S.maps[home].crypts[crypt0].cd;
  ok(switchMap(home) === true && M.MAP_ID === home && !(S.maps && S.maps[home]), 'back: the map is unpacked');
  if (M.CRYPT) ok(Math.abs(M.CRYPT.cd - Math.max(0, cd - elapsed / 6)) < 1e-9, `catchUp: ${elapsed.toFixed(0)} game minutes off the dungeon's cooldown (${cd.toFixed(1)} s, now ${M.CRYPT.cd.toFixed(1)})`);
  ok(S.levers.active.some(x => x.name === 'test_mark') && S.levers.cd['create_npc:0'] > 0 && S.dmSeen.enc.test === 1 && S.worldEvent.cur.kind === 'plague', 'the land\'s part of every split is back');
  ok(!M.CRYPT || M.CRYPT.name === crypt0, 'the dungeon is its own');

  console.log('straight there and back');
  {S.worldEvent.lastEnd = S.gameMin; const a0 = json(), dead0 = new Set(S.agents.filter(a => a.state === 'dead').map(a => a.id)); switchMap(far); switchMap(home); const a1 = json();
    const d = firstDiffs(comparable(a0, dead0), comparable(a1, dead0));
    ok(!d.length, 'frozen state identical on return, every key of the save (' + a1.agents.length + ' heroes, ' + a1.mobs.length + ' mobs)' + (d.length ? '\n    ' + d.join('\n    ') : ''));
    const ids = S.agents.map(a => a.id); ok(ids.every((x, i) => !i || ids[i - 1] < x), 'heroes stand in the order they were made')}
  console.log('a frozen map cut again');
  {switchMap(far); S.maps[home].mapRev = 99; const logs = S.dmLogSeq; switchMap(home);
    ok(!(S.maps && S.maps[home]) && S.agents.every(a => T.inCompany(a) || (a.party && a.party.mem.some(T.inCompany))) && S.dmLogSeq > logs, 'is built afresh, with a word in the DM log')}
  process.exit(fail ? 1 : 0);
}

if (mode === '--away') { // a world taken to its far map, played, saved; then it goes home and plays on. Run by the parent and, from the save, by a fresh process
  const [far, saveFile, outFile] = args, T = await packTools(), {S, SIM, M, run, json} = T, home = M.WORLD_ID;
  const onward = () => {reseed(); run(20); const s = JSON.stringify(json()); T.switchMap(home); reseed(); run(20); return {far: s, home: JSON.stringify(json())}};
  if (saveFile === '-') { // the original: writes two saves and what came of each
    reseed(); SIM.init(); T.setDmSeat(true); run(120); T.switchMap(far);
    const first = JSON.stringify(json()); writeFileSync(outFile + '.0', first); // at the moment of the switch
    reseed(); run(30); writeFileSync(outFile + '.1', JSON.stringify(json()));
    const mid = onward(); T.restore(JSON.parse(first)); const at = onward();
    writeFileSync(outFile, JSON.stringify({at, mid})); process.exit(0)}
  T.restore(JSON.parse(readFileSync(saveFile, 'utf8')));
  ok(M.MAP_ID === far, 'a fresh process that booted on ' + home + ' picks the saved map: ' + M.MAP_ID);
  writeFileSync(outFile, JSON.stringify(onward())); process.exit(fail ? 1 : 0);
}

if (mode === '--size') { // a full roster on every map, packed: what the save comes to, against what the store takes. args: game days on the first map, on each other
  const days = Number(args[0]) || 6, later = Number(args[1]) || 2;
  const T = await packTools(), {S, SIM, M, run, json} = T, {makeHero} = await import('../src/sim/heroes.js'), {CLSN} = await import('../src/data/classes.js');
  const KB = n => Math.round(n / 1024) + ' KiB', sizes = {};
  reseed(); SIM.init(); T.setDmSeat(true); run(days * 240);
  const maps = ['eldmoor', 'stepping', 'testlinka', 'testlinkb'].filter(id => id !== M.MAP_ID).slice(0, 4), whole = JSON.stringify(json()), first = M.MAP_ID;
  console.log(`\nfive maps, a full roster on each: ${first} ${days} game days, the others ${later}`);
  console.log(`  ${first} before the pack: whole save ${KB(whole.length)}, ${S.agents.length} heroes, ${S.agents.filter(a => a.state === 'dead').length} dead`);
  for (const id of maps) {T.switchMap(id); for (let f = 0; f < 2; f++) for (let i = 0; i < 14; i++) makeHero(f, CLSN[i % CLSN.length], null, i * .6); run(later * 240)}
  const j = JSON.stringify(json()), snap = JSON.parse(j);
  for (const id in snap.campaign.maps) {const m = snap.campaign.maps[id], len = JSON.stringify(m).length; sizes[id] = len; console.log(`  frozen ${id}: ${KB(len)}: ${m.agents.length} heroes (${KB(JSON.stringify(m.agents).length)}), ${m.dead.length} stubs (${KB(JSON.stringify(m.dead).length)}), ${m.mobs.length} mobs (${KB(JSON.stringify(m.mobs).length)})`)}
  console.log(`  whole save, ${Object.keys(sizes).length + 1} maps: ${KB(j.length)}`);
  ok(Object.keys(sizes).length === 4, 'four maps frozen beside the live one');
  // The real store on a mock IndexedDB, under a localStorage that refuses past the origin's 5 MB.
  const {mockIdb, mockStorage} = await import('./mockidb.mjs'), QUOTA = 5 * 1024 * 1024;
  const idb = mockIdb(), ls = mockStorage(QUOTA); globalThis.window = {indexedDB: idb, localStorage: ls};
  ls.setItem('eldmoor.save.v1.vale', j.slice(0, 1000)); ls.setItem('eldmoor.save.v1.vale.at', '5'); ls.setItem('eldmoor.notesSeen', 'x');
  const big = j + ' '.repeat(Math.max(0, QUOTA + 1 - j.length)); let refused = false; try {ls.setItem('eldmoor.save.v1.vale', big)} catch (e) {refused = true}
  ok(refused, `localStorage refuses a campaign past ${KB(QUOTA)}`);
  const st = await import('../src/ui/savestore.js');
  ok(await st.openSaves() === true && ls.getItem('eldmoor.save.v1.vale') === null && ls.getItem('eldmoor.notesSeen') === 'x', 'an old slot moves into IndexedDB, and only the slots');
  ok(st.saveStore().getItem('eldmoor.save.v1.vale').length === 1000 && st.saveStore().getItem('eldmoor.save.v1.vale.at') === '5', 'with its time');
  st.saveStore().setItem('eldmoor.save.v1.vale', big); await st.whenSaved();
  ok(idb.dump().get('eldmoor.save.v1.vale').length === big.length, `the store takes ${KB(big.length)} in one slot`);
  const again = await import('../src/ui/savestore.js?page=2'); await again.openSaves();
  ok(again.saveStore().getItem('eldmoor.save.v1.vale') === big, 'and a new page reads it back');
  process.exit(fail ? 1 : 0);
}

if (mode === '--store') { // the page's save, load, export and import on IndexedDB, through the real ui/save.js with a mock browser under it
  const {mockIdb, mockStorage} = await import('./mockidb.mjs');
  const idb = mockIdb(), ls = mockStorage(5 * 1024 * 1024), ss = mockStorage(), T = await packTools(), {S, SIM, M, run, json} = T;
  let reloads = 0, writtenAtReload = null, blob = null;
  const stat = {textContent: ''}, doc = {getElementById: id => id === 'wStatus' ? stat : null, addEventListener() {}, createElement: () => ({click() {}, remove() {}}), body: {append() {}}};
  globalThis.window = {indexedDB: idb, localStorage: ls, sessionStorage: ss, addEventListener() {}}; globalThis.document = doc; globalThis.localStorage = ls;
  globalThis.location = {href: 'http://localhost/', reload() {reloads++; writtenAtReload = idb.dump().get(save.SAVE_KEY)}};
  globalThis.fetch = async () => ({ok: false, status: 404, json: async () => ({})});
  URL.createObjectURL = b => {blob = b; return 'blob:x'}; URL.revokeObjectURL = () => {};
  const save = await import('../src/ui/save.js'), st = await import('../src/ui/savestore.js');
  const settle = async () => {for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 1))};
  console.log('\nthe page\'s saves on IndexedDB');
  reseed(); SIM.init(); T.setDmSeat(true); run(30);
  // A page from before: the save, its time and an earlier-map copy in localStorage. The copy is older than this build's format on purpose.
  const v7 = json(); delete v7.campaign; v7.version = 7; const raw = JSON.stringify(v7), day = Math.floor(v7.gameMin / 1440) + 1;
  ls.setItem(save.SAVE_KEY, raw); ls.setItem(save.SAVE_KEY + '.at', '1234'); ls.setItem(save.EARLIER_KEY, '{"kept":1}'); ls.setItem(save.PENDING_KEY + '.other', 'stays');
  ok(await st.openSaves() === true, 'the store opens on IndexedDB');
  ok(!ls.getItem(save.SAVE_KEY) && !ls.getItem(save.EARLIER_KEY) && !ls.getItem(save.SAVE_KEY + '.at') && ls.getItem(save.PENDING_KEY + '.other') === 'stays', 'the slot, its time and the earlier-map copy left localStorage, and nothing else did');
  ok(idb.dump().get(save.SAVE_KEY) === raw && idb.dump().get(save.EARLIER_KEY) === '{"kept":1}', 'all of it is in IndexedDB');
  {const sum = save.saveSummary(M.WORLD_ID); ok(sum && sum.day === day && sum.at === 1234 && save.hasSave(), `the title screen reads it: day ${sum && sum.day}, saved at ${sum && sum.at}`)}
  ok(save.boot(SIM.init) === true && save.bootKind() === 'restored' && S.gameMin === v7.gameMin, 'boot restores the moved v7 save');
  ok(!!save.writeSave() && /Saved/.test(stat.textContent), 'writeSave: ' + stat.textContent); await st.whenSaved();
  const stored = idb.dump().get(save.SAVE_KEY); ok(JSON.parse(stored).version === 8 && +idb.dump().get(save.SAVE_KEY + '.at') > 1234, 'the autosave lands in IndexedDB as v8, with its time');
  ok(save.exportStored(M.WORLD_ID) === true && await blob.text() === stored, 'Export hands over the stored save as it is');
  save.exportSave(); ok(JSON.parse(await blob.text()).version === 8, 'and the live world');
  const FR = globalThis.FileReader; let text = JSON.stringify({...JSON.parse(stored), gameMin: 777});
  globalThis.FileReader = class {readAsText() {this.result = text; this.onload()}};
  save.importFile({name: 'x.json'}); await settle();
  ok(reloads === 1 && JSON.parse(writtenAtReload).gameMin === 777 && JSON.parse(st.saveStore().getItem(save.SAVE_KEY)).gameMin === 777, 'Import reloads only once the file is in IndexedDB');
  ok(!idb.dump().has(save.SAVE_KEY + '.at'), 'and a new page will read it as unsaved by the clock, as before');
  text = 'not a save'; let said = ''; save.importFile({name: 'y.json'}, m => {said = m}); await settle(); ok(said === 'Not an Eldmoor save' && reloads === 1, 'a file that is no save is refused');
  globalThis.FileReader = FR;
  // A newer slot in IndexedDB is not overwritten by an older one left in localStorage; a refused write falls back to localStorage.
  ls.setItem(save.SAVE_KEY, 'old'); ls.setItem(save.SAVE_KEY + '.at', '1'); idb.dump().set(save.SAVE_KEY + '.at', '999');
  const page2 = await import('../src/ui/savestore.js?page=2'); await page2.openSaves();
  ok(page2.saveStore().getItem(save.SAVE_KEY) !== 'old' && !ls.getItem(save.SAVE_KEY), 'an older copy left in localStorage does not beat IndexedDB');
  let failed = 0, kept = null; page2.onSaveFail((e, k) => {failed++; kept = k}); idb.fail = true; page2.saveStore().setItem(save.SAVE_KEY, 'last gasp'); await page2.whenSaved(); idb.fail = false;
  ok(failed === 1 && kept === true && ls.getItem(save.SAVE_KEY) === 'last gasp' && +ls.getItem(save.SAVE_KEY + '.at') > 1e12, 'a write IndexedDB refuses is said, and kept in localStorage with its time for the next open');
  // A build without IndexedDB played on after this one: its newer slot wins, and the slot it displaces is kept once. A tie goes to localStorage.
  idb.dump().set(save.SAVE_KEY, 'from idb'); idb.dump().set(save.SAVE_KEY + '.at', '5'); ls.setItem(save.SAVE_KEY, 'from an older build'); ls.setItem(save.SAVE_KEY + '.at', '9');
  const page3 = await import('../src/ui/savestore.js?page=3'); await page3.openSaves();
  ok(page3.saveStore().getItem(save.SAVE_KEY) === 'from an older build' && idb.dump().get(save.SAVE_KEY + '.replaced') === 'from idb' && !ls.getItem(save.SAVE_KEY), 'a newer slot left in localStorage wins, and the IndexedDB slot it displaces is kept as .replaced');
  idb.dump().set(save.SAVE_KEY + '.at', '9'); ls.setItem(save.SAVE_KEY, 'tied'); ls.setItem(save.SAVE_KEY + '.at', '9');
  const page4 = await import('../src/ui/savestore.js?page=4'); await page4.openSaves();
  ok(page4.saveStore().getItem(save.SAVE_KEY) === 'tied' && !ls.getItem(save.SAVE_KEY), 'a tie goes to the localStorage copy, which is only there because IndexedDB refused it');
  process.exit(fail ? 1 : 0);
}

// ---- part 3 (slice 3): the crossing ----
// A company on the TESTLINK fixtures, every seat held, walking and voting through the real tools; the world stepped by hand, except where
// mock runners hold real claims at the relay.
async function crossTools() {
  const T = await packTools(), {S, SIM, M} = T, {setRunnerLinks, setReflexAck, playerAct, dmAct, setDmSeat} = SIM;
  const CO = await import('../src/sim/company.js'), CN = await import('../src/sim/council.js'), TB = await import('../src/sim/table.js'), SC = await import('../src/sim/scenewait.js');
  const CR = await import('../src/sim/crossing.js'), PC = await import('../src/sim/pace.js'), {tableView} = TB, home = M.MAP_ID;
  const act = (a, tool, args) => {a.playRate = []; return playerAct(a.id, tool, args || {})};
  const steps = (n = 1) => {for (let i = 0; i < n; i++) SIM.step(1 / 60)};
  const until = (f, max = 60 * 400) => {for (let i = 0; i < max; i++) {if (f()) return true; SIM.step(1 / 60)} return !!f()};
  const calm = () => {for (const m of S.mobs) {m.alive = false; m.respawn = 1e9; m.target = null}}; // nothing bites while the table is tested
  // A fresh world on the first map, every member's runner live. o.others 'none' for the flows; the full roster for what freezes.
  const world = (o = {others: 'none'}) => {M.setWorld(home); reseed(); TB.TABLE.mode = 'auto'; TB.TABLE.speed = 1; TB.TABLE.drop = null; TB.TABLE.liveMs = 120000; setRunnerLinks(() => 'connected'); setReflexAck(() => false); SIM.init(o);
    const F = CO.slotted(); setDmSeat(true); calm(); return F ? {F, mem: CO.slotHeroes(F), lead: CN.leaderOfC(F)} : {}};
  const exit = () => M.EXITS[0], off = a => Math.hypot(a.x - exit().x, a.y - exit().y);
  const at = (L, p = exit()) => L.forEach((a, i) => {a.x = p.x - 1 - (i % 3) * .5; a.y = p.y - 1 + Math.floor(i / 3); a.zone = M.zoneAt(a.x, a.y); a.state = 'hunt'; a.dest = null; a.target = null; a.moving = false; a.pq = []});
  const scene = C => TB.sceneFor(C);
  const opened = (C, kind) => until(() => {const s = scene(C); return !!s && s.kind === kind && s.phase === 'turn' && !SC.framing(s) && !!s.wk && !!s.wk.done}, 60 * 60);
  const byId = id => S.agents.find(a => a.id === id);
  const answers = (C, pick) => scene(C).ids.map(byId).map((a, i) => act(a, 'scene_act', {option: typeof pick === 'function' ? pick(a, i) : pick, line: ''}));
  const closed = C => until(() => !scene(C), 60 * 60);
  const go = (F, mem, lead) => {at(mem); act(lead, 'move_to', {target: exit().name}); if (!opened(F, 'crossing')) return false; answers(F, 'go'); return until(() => M.MAP_ID !== home, 60 * 60)};
  const {knowsPlace: knows} = await import('../src/sim/lore.js'), {homeOf} = await import('../src/data/races.js');
  return {...T, knows, homeOf, home, CO, CN, TB, SC, CR, PC, tableView, act, steps, until, calm, world, exit, off, at, scene, opened, answers, closed, go, byId, setRunnerLinks, setReflexAck};
}
if (mode === '--party') { // a company stays a party (#1048): through a walk to any town, across a road, after a fall; and C.road lasts as long as the words that made it
  const X = await crossTools(), {S, SIM, M, home, CO, CN, TB, act, steps, until, calm, world, exit, at, scene, opened, answers, closed, go, setRunnerLinks} = X;
  const {maxHp} = await import('../src/sim/heroes.js'), {slotParty} = CO;
  const together = (F, L) => {const P = slotParty(F); return !!P && L.every(a => a.party === P)};
  const idle = L => {for (const a of L) {a.playActAt = -1e9; a.pq = []}}; // nobody has given an order for hours: autopilot plays them
  // Autopilot's walk home (homeCmd), for the leader; the others follow by themselves. Asks that nobody was ever without the party on the way, and that they all come in.
  const heading = (F, mem, lead) => {const c = X.homeOf(lead); S.gameMin = Math.ceil(S.gameMin / 1440) * 1440 + 480; at(mem, {x: 22, y: 12}); idle(mem); steps(5); lead.pq = [{kind: 'move', legs: [{x: c.gate.x, y: c.gate.y, st: 'return'}], last: 'town', label: c.name, auto: 'heading home to ' + c.name + ' (the pack is full)'}]; let held = true;
    const inTown = until(() => {held = held && together(F, mem); return lead.state === 'town'}, 60 * 60); for (let i = 0; i < 300; i++) {steps(); held = held && together(F, mem)} return {held, inTown}}; // autopilot may walk straight out again, and that is the case that lost the party
  const leadsOut = (lead, n, target = 'east') => {const r = act(lead, 'lead_to', {target}); ok(r.ok && r.followers > 0 && r.followers <= n, 'lead_to works there: ' + (r.error || r.leading + ', ' + r.followers + ' of ' + n + ' in earshot')); return r};

  console.log('\na company stays a party');
  {const {F, mem, lead} = world(); ok(together(F, mem), 'the company stands in the hall as one party');
    const w = heading(F, mem, lead); ok(w.inTown, 'autopilot heads home to ' + M.CITY[0].name); ok(w.held, 'one party every step of the way, and five seconds on'); calm(); leadsOut(lead, mem.length - 1)}
  {const {F, mem, lead} = world(), town = M.CITY[0].name; at(mem); steps(5); const r = act(lead, 'lead_to', {target: town}); ok(r.ok, 'lead_to ' + town + ': ' + (r.error || r.leading));
    ok(until(() => lead.state === 'town' && mem.every(a => a.state === 'town'), 60 * 200), 'the company walks in behind the leader'); steps(120); ok(together(F, mem), 'and is a party when it gets there'); leadsOut(lead, mem.length - 1)}
  {const {F, mem, lead} = world(), hurt = mem.find(a => a !== lead); at(mem); steps(5); hurt.hp = maxHp(hurt) * .1; act(hurt, 'flee', {}); hurt.state = 'return'; hurt.pq = []; act(lead, 'hunt', {}); steps(120);
    ok(lead.state !== 'return' && lead.state !== 'town', 'one who runs for home does not turn the leader round: ' + lead.state); ok(until(() => hurt.state === 'town', 60 * 200) && together(F, mem), 'and is still of the party in town')}

  console.log('a fall out in the field');
  {const {F, mem, lead} = world(); at(mem); steps(5); const gone = mem.find(a => a !== lead); gone.state = 'dead'; gone.hp = 0; steps(10); const L = mem.filter(a => a !== gone); ok(together(F, L), 'the party closes up where it stands'); ok(CN.leaderOfC(F) === lead, 'with the same leader'); leadsOut(lead, L.length - 1, 'west')}

  console.log('on the far side of a road');
  {const {F, mem, lead} = world(); ok(go(F, mem, lead) && opened(F, 'farside'), 'they take the road'); answers(F, 'look'); closed(F); ok(together(F, mem), 'a party on the far side'); calm();
    const w = heading(F, mem, lead); ok(w.inTown && w.held, 'autopilot heads home to ' + M.CITY[0].name + ', on ' + M.MAP_ID + ', one party every step'); leadsOut(lead, mem.length - 1);
    const back = act(lead, 'lead_to', {target: M.EXITS[0].name}); ok(back.ok && !!F.road, 'and may lead them back to the road: ' + (back.error || back.leading))}

  console.log('any company');
  {world({fellowship: false}); const L = S.agents.filter(a => a.fac === 0 && a.state !== 'dead').slice(0, 2); for (const a of L) {a.town = M.CITY[0].name; SIM.markPlayer(a, true)}
    const C = CO.companyOf(L[0]); CO.joinCompany(C, L[1]); for (const a of S.agents) if (!L.includes(a) && CO.companyOf(a)) SIM.markPlayer(a, false); for (const a of L) a.partyOk = true; calm();
    const ld = CN.leaderOfC(C), P = () => S.parties.find(p => p.company === C.id); at(L); steps(120); ok(!!P() && L.every(a => a.party === P()), 'two who ride together form up in the field');
    const r = act(ld, 'lead_to', {target: M.CITY[0].name}); ok(r.ok && r.followers === 1, 'lead_to is theirs too: ' + (r.error || r.leading)); ok(until(() => L.every(a => a.state === 'town'), 60 * 200) && !!P() && L.every(a => a.party === P()), 'and they are a party in town')}
  {world({fellowship: false}); const a = S.agents.find(x => x.fac === 0 && x.state !== 'dead'); a.town = M.CITY[0].name; SIM.markPlayer(a, true); calm(); at([a]); const r = act(a, 'lead_to', {target: M.CITY[0].name}); ok(r.ok && r.followers === 0, 'for a solo lead_to is move_to: ' + (r.error || r.leading))}

  console.log('the road lasts as long as the words');
  {const {F, mem, lead} = world(); at(mem, {x: exit().x - 14, y: exit().y}); steps(5); ok(act(lead, 'move_to', {target: exit().name}).ok && !!F.road, 'an order names the road'); steps(60); ok(!!F.road, 'and it stands while they walk');
    const c = act(lead, 'rest', {minutes: 30}); ok(c.ok && !F.road, 'another order ends it: ' + (c.error || 'rest'));
    act(lead, 'move_to', {target: exit().name}); ok(!!F.road, 'the order given anew'); lead.pq = []; steps(2); ok(!F.road, 'a walk order that is gone (a night\'s camp clears it) takes the road with it');
    act(lead, 'move_to', {target: exit().name}); steps(60); lead.pq = [{kind: 'hunt', n: 1, k0: lead.kills}]; steps(2); ok(!F.road, 'and a leader who hunts the other way is on no road')}
  {const {F, mem, lead} = world(); at(mem, {x: exit().x - 14, y: exit().y}); steps(5); act(lead, 'intent', {goal: 'take ' + exit().name + ' out of here', why: 'the hall is too small'}); ok(!!F.road, 'an aim names the road'); lead.pq = []; steps(60); ok(!!F.road, 'and holds with no walk order under it: autopilot carries an aim');
    lead.intent.done = {at: S.gameMin, why: 'test'}; ok(until(() => true, 1) && !!F.road, 'a spent aim keeps the road while they stand by it'); steps(2); ok(!F.road, 'and not fourteen tiles off')}
  {const {F, mem, lead} = world(); at(mem); act(lead, 'move_to', {target: exit().name}); ok(opened(F, 'crossing'), 'at the road the order is spent and the table still opens'); answers(F, 'wait'); closed(F)}
  console.log(fail ? fail + ' failed' : 'the party holds'); process.exit(fail ? 1 : 0);
}
if (mode === '--road') { // when the scene opens, what holds it, what it asks and what comes of it
  const X = await crossTools(), {S, SIM, M, home, CO, CN, TB, PC, tableView, act, steps, until, world, exit, off, at, scene, opened, answers, closed, setRunnerLinks, setReflexAck} = X;
  const {learnPlace} = await import('../src/sim/lore.js'), {setGateHold} = await import('../src/sim/prep.js'), far = exit().to.map;

  console.log('\nnever on proximity');
  {const {F, mem, lead} = world(); at(mem); steps(600);
    ok(!F.road && !scene(F) && M.MAP_ID === home, 'a company standing at the road with no order is asked nothing, ten seconds on');
    at(mem); act(lead, 'hunt', {}); steps(60); ok(!F.road && !scene(F), 'nor a company hunting there');
    at(mem); const r = act(mem[1] === lead ? mem[0] : mem[1], 'move_to', {target: exit().name}); ok(r.ok && !F.road, 'a follower may walk there, and that opens nothing: ' + r.note);
    act(lead, 'intent', {goal: 'hunt the mead', why: 'for coin'}); steps(60); ok(!F.road, 'an aim that names no road makes none');
    setRunnerLinks(null); F.road = {exit: exit().id, by: lead.id, at: 0}; at(mem); steps(120); ok(!scene(F) && M.MAP_ID === home, 'a world with no host never opens one, whatever is written'); delete F.road; setRunnerLinks(() => 'connected')}

  console.log('the leader\'s word');
  {const {F, mem, lead} = world(), town = M.EXITS[0].to.map, beyondTown = (await import('../src/world/spec.js')).MAPS[town].towns[0].name;
    const r = act(lead, 'move_to', {target: beyondTown}); ok(!r.ok && !F.road, 'a place beyond the road nobody has heard of is refused: ' + (r.error || '').slice(0, 70));
    learnPlace(lead, beyondTown, 'told'); const r2 = act(lead, 'move_to', {target: beyondTown}); ok(r2.ok && F.road && F.road.exit === exit().id, 'heard of, it walks to the road that leads there: ' + r2.going);
    act(lead, 'move_to', {target: 'gate'}); ok(!F.road, 'an order elsewhere ends it');
    lead.pq = []; act(lead, 'intent', {goal: 'take ' + exit().name + ' out of here', why: 'the hall is too small'}); ok(F.road && F.road.aim === lead.intent.n && lead.intent.order && lead.intent.order.label === exit().name, 'a stated aim that names the road carries it, and autopilot walks it');
    act(lead, 'hunt', {}); ok(!!F.road, 'a hunt on the way does not end an aim\'s road');
    act(lead, 'intent', {goal: 'hunt the mead', why: 'for coin'}); ok(!F.road, 'a new aim does');
    act(lead, 'intent', {goal: 'reach ' + beyondTown + ' and see the water', why: 'an old promise'}); ok(!!F.road, 'an aim that names a place beyond the road carries it too');
    act(lead, 'intent', {done: 'yes', why: 'not today'}); ok(!F.road, 'setting the aim down ends it');
    const e0 = exit(), was = e0.to; e0.to = {map: null, heard: 'lands not yet seen'}; const c = act(lead, 'move_to', {target: e0.name}); ok(!c.ok && /not yet open/.test(c.error) && !F.road, 'a road with no map behind it is refused in words: ' + c.error); e0.to = was}

  console.log('the walk');
  {const {F, mem, lead} = world(), r = act(lead, 'lead_to', {target: exit().name}); ok(r.ok && !!F.road, 'lead_to names the road: ' + r.leading + ', ' + r.followers + ' following');
    ok(until(() => scene(F)), 'the company walks there and the scene opens when the leader reaches it');
    ok(scene(F).kind === 'crossing' && scene(F).all === true && TB.PLAY.crossing === 'all' && off(lead) <= exit().r + .1, 'kind crossing, everyone at once, ' + off(lead).toFixed(1) + ' tiles from the road (it reaches ' + exit().r + ')')}

  console.log('the holds, each in words');
  {const {F, mem, lead} = world(), m = mem.filter(a => a !== lead);
    const fresh = () => {at(mem); F.road = {exit: exit().id, by: lead.id, at: Math.round(S.gameMin)}};
    const once = (k, re, what, setup, undo) => {fresh(); setup(); steps(1); const h = F.road && F.road.hold, b = PC.paceBrief(lead.id).brief;
      ok(!(scene(F) && scene(F).kind === 'crossing') && !!h && h.k === k && re.test(h.text) && M.MAP_ID === home, what + ': ' + (h && h.text)); ok(b.crossing_waits === (h && h.text), 'the leader\'s header carries it');
      undo(); delete F.road; steps(2)};
    const foe = S.mobs[0];
    once('split', /off on their own/, 'a split-off member', () => {m[1].splitUntil = S.gameMin + 300}, () => {delete m[1].splitUntil});
    once('down', /down/, 'a member downed', () => {m[0].state = 'downed'; m[0].down = {s: 0, f: 0, stable: true, wake: S.gameMin + 9999, at: S.gameMin, by: {}}; m[0].hp = 0}, () => {m[0].state = 'hunt'; delete m[0].down; m[0].hp = 40});
    once('fight', /is fighting/, 'a fight', () => {Object.assign(foe, {alive: true, hp: 1e6, maxhp: 1e6, x: m[2].x + .4, y: m[2].y, target: m[2], respawn: 0}); m[2].state = 'fight'; m[2].target = foe}, () => {foe.alive = false; foe.target = null; foe.respawn = 1e9; m[2].state = 'hunt'; m[2].target = null});
    once('camp', /camped/, 'a camp', () => {F.camp = {phase: 'rest', ids: [], x: lead.x, y: lead.y, zone: 0}}, () => {delete F.camp});
    once('vote', /still open/, 'an open vote', () => {(F.props || (F.props = [])).unshift({id: 9001, kind: 'other', details: 'We hold here', by: lead.id, at: S.gameMin, until: S.gameMin + 900, votes: {}, status: 'open'})}, () => {F.props.shift()});
    once('off', /table is closed/, 'the table closed (Watch mode)', () => {TB.TABLE.mode = 'off'}, () => {TB.TABLE.mode = 'auto'});
    {fresh(); setGateHold(true); steps(3); const h = F.road.hold; ok(!scene(F) && h && h.k === 'held', 'the world held: ' + (h && h.text)); setGateHold(false); steps(2); ok(!!scene(F) && scene(F).kind === 'crossing', 'and the moment it lets go the scene opens'); opened(F, 'crossing'); answers(F, 'wait'); closed(F)}
    {fresh(); const a = m[3], x0 = a.x; a.x = lead.x - 25; a.playEv = []; steps(3); const h = F.road.hold; ok(!scene(F) && h && h.k === 'far' && h.away.includes(a.id), 'a member out of shouting range: ' + (h && h.text));
      ok((a.playEv || []).some(e => e.u && /Walk there now/.test(e.text)), 'who is away is told, urgently: ' + ((a.playEv || []).find(e => /Walk there/.test(e.text)) || {}).text); ok(PC.paceBrief(a.id).brief.crossing_waits === h.come, 'and carries it in the header');
      const lines = (lead.playEv || []).filter(e => /out of shouting/.test(e.text)).length; steps(60); ok((lead.playEv || []).filter(e => /out of shouting/.test(e.text)).length === lines && !!F.road.hold, 'told once, not every tick');
      const r = act(a, 'follow', {who: lead.name}); a.x = x0; a.pq = []; steps(3); ok(!!scene(F) && scene(F).kind === 'crossing' && !F.road.hold, 'back in range the scene opens with everyone: ' + scene(F).ids.length + ' at it'); opened(F, 'crossing'); answers(F, 'wait'); closed(F)}
    {at(mem); act(lead, 'move_to', {target: exit().name}); const a = m[3]; a.x = lead.x - 25; steps(3); ok(!!F.road.hold, 'held, the leader may change its mind'); act(lead, 'move_to', {target: 'gate'}); ok(!F.road, 'an order elsewhere ends the wait')}}

  console.log('all or none: a second company on the map');
  {const {F, mem, lead} = world({}), o = S.agents.find(a => a.state !== 'dead' && !CO.companyOf(a)); SIM.markPlayer(o, true); ok(CO.companyOf(o) && CO.companyOf(o) !== F, o.name + ' rides alone on this map');
    at(mem); act(lead, 'move_to', {target: exit().name}); at(mem); steps(3); ok(!scene(F) && F.road.hold && F.road.hold.k === 'others', 'the road waits, in words: ' + (F.road.hold && F.road.hold.text));
    o.state = 'dead'; steps(3); ok(!!scene(F) && scene(F).kind === 'crossing', 'once they are gone the scene opens')}

  console.log('wait, and turn back');
  {const {F, mem, lead} = world(), goal = 'take ' + exit().name; at(mem); act(lead, 'intent', {goal, why: 'onward'}); ok(opened(F, 'crossing'), 'the scene opens on the aim');
    const b = mem.find(a => a !== lead), v = tableView(b); ok(v && v.options.length === 3 && v.options.every(o => /^(go|wait|turn_back) = /.test(o)) && v.everyone_answers, 'every member has go, wait, turn_back at once: ' + v.options.map(o => o.split(' = ')[0]).join(', '));
    ok(v.frame.includes(exit().name) && !(await import('../src/world/spec.js')).MAPS[far].towns.some(t => v.frame.includes(t.name)), 'the frame names the road and nothing unheard of beyond it: ' + v.frame);
    answers(F, a => a === lead ? 'go' : a === b ? 'go' : 'wait'); ok(closed(F), 'settled'); steps(120);
    ok(!F.road && M.MAP_ID === home && !!lead.intent.done, 'two for going, three against: they stay, and the aim that brought them is done: ' + (lead.intent.done && lead.intent.done.why));
    at(mem); steps(600); ok(!scene(F) && !F.road, 'standing there, nobody is asked again');
    act(lead, 'move_to', {target: exit().name}); ok(opened(F, 'crossing'), 'the same order anew asks again');
    answers(F, 'turn_back'); ok(closed(F), 'settled'); const d0 = off(lead); ok(!F.road && lead.pq.length === 1 && lead.pq[0].label === M.CITY[0].name, 'turn back walks the leader to ' + lead.pq[0].label); steps(240); ok(!F.road && !scene(F) && off(lead) > d0 + 2, 'away from the road, and it is not asked again');
    at(mem); act(lead, 'move_to', {target: exit().name}); ok(opened(F, 'crossing'), 'asked again'); const two = mem.filter(a => a !== lead).slice(0, 2); answers(F, a => a === lead || two.includes(a) ? 'go' : 'wait');
    ok(until(() => M.MAP_ID !== home, 120), 'three for going, two against: the leader settles it and the whole company goes')}

  console.log('a word taken and the leader gone');
  {const {F, mem, lead} = world(); at(mem); act(lead, 'move_to', {target: exit().name}); opened(F, 'crossing'); answers(F, 'go'); until(() => F.road && F.road.phase === 'go'); lead.x -= 15; ok(until(() => !F.road, 200) && M.MAP_ID === home, 'a leader who walks off between the vote and the road takes the word with it')}

  console.log('any company: a solo, and two who ride together');
  for (const n of [1, 2]) {world({fellowship: false}); const L = S.agents.filter(a => a.fac === 0 && a.state !== 'dead').slice(0, n); for (const a of L) {a.town = M.CITY[0].name; SIM.markPlayer(a, true)}
    let C = CO.companyOf(L[0]); if (n > 1) {for (const a of L) if (a !== L[0]) CO.joinCompany(C, a)}
    for (const a of S.agents) if (!L.includes(a) && CO.companyOf(a)) SIM.markPlayer(a, false);
    const ld = CN.leaderOfC(C); at(L); act(ld, 'move_to', {target: exit().name}); ok(opened(C, 'crossing'), (n === 1 ? ld.name + ' alone' : C.name || 'the pair') + ': the road opens with ' + scene(C).ids.length + ' at it'); answers(C, 'go'); ok(until(() => M.MAP_ID === far, 300) && L.every(a => S.agents.includes(a)), 'and they cross'); ok(opened(C, 'farside'), 'to an arrival'); answers(C, 'look'); ok(closed(C), 'and on')}

  console.log('a tie goes to the leader');
  {const {F, mem, lead} = world(); F.ids.includes(mem[4].id); at(mem); act(lead, 'move_to', {target: exit().name}); opened(F, 'crossing'); const sc = scene(F);
    const up = mem.filter(a => a !== lead).slice(0, 1); sc.ids = sc.ids.filter(id => id === lead.id || id === up[0].id); answers(F, a => a === lead ? 'wait' : 'go'); closed(F); steps(60); ok(M.MAP_ID === home && !F.road, 'one each, the leader says wait: they wait')}

  console.log('a silent table, a gone runner');
  {const {F, mem, lead} = world(); TB.TABLE.liveMs = 400; at(mem); act(lead, 'move_to', {target: exit().name}); ok(until(() => !!scene(F), 60), 'the scene opens'); ok(closed(F) && !F.road && M.MAP_ID === home, 'five live agents who run out the clock: their reflexes wait, and nobody crosses');
    setRunnerLinks(() => 'none'); setReflexAck(() => true); at(mem); steps(600); ok(!F.road && !scene(F), 'a company on its reflexes walks to no road and opens nothing');
    at(mem); F.road = {exit: exit().id, by: lead.id, at: 0}; ok(until(() => M.MAP_ID !== home, 600), 'a road ordered before the runners went, and the owner resumed: their reflexes may go on')}
  process.exit(fail ? 1 : 0);
}

if (mode === '--over') { // the crossing itself, and the far side
  const X = await crossTools(), {S, SIM, M, home, A, P, CO, CN, TB, CR, PC, tableView, act, steps, until, world, exit, at, scene, opened, answers, closed, go, byId, json, comparable, dmAct} = X;
  const {MAPS} = await import('../src/world/spec.js'), far = exit().to.map, farTown = MAPS[far].towns[0].name, Q = await import('../src/sim/questlog.js'), H = await import('../src/sim/heroes.js');
  const open = (x, y) => !(M.solid && M.solid[M.I(Math.floor(x), Math.floor(y))]);

  console.log('\nthe company goes, all of it');
  {const {F, mem, lead} = world(); at(mem); const ids = mem.map(a => a.id).sort();
    lead.adv = 777; (S.adventures || (S.adventures = [])).push({id: 777, phase: 'active', mem: mem.map(a => a.id), lead: lead.id, title: 'The Old Errand', foes: [], data: {}, scenes: [{type: 'travel', at: {x: exit().x - 12, y: exit().y}}], idx: 0, stage: 'go', log: [], z: 0, town: M.CITY[0].name}); for (const a of mem) a.adv = 777;
    const ok1 = dmAct('watch', {trigger: 'enter_town', on: {town: M.CITY[0].name}, note: 'home again', hours: 72}), ok2 = dmAct('watch', {trigger: 'after_hours', on: {h: 48}, note: 'a clock', hours: 72}); ok(ok1.ok && ok2.ok, 'the DM has left a place-bound watch and a timed one');
    lead.goal = {type: 'pilgrim', zone: 0, text: 'To walk ' + M.ZONES[0], need: 1, minLvl: 1, progress: 0, tier: 0}; lead.playGround = 0;
    act(lead, 'intent', {goal: 'take ' + exit().name, why: 'onward'}); ok(opened(F, 'crossing'), 'the scene opens');
    answers(F, 'go'); ok(until(() => F.road && F.road.phase === 'go'), 'everyone says go'); ok(M.MAP_ID === home && !!scene(F), 'the outcome stays on the table; nobody has moved');
    ok(until(() => M.MAP_ID === far, 120), 'then the map turns over');
    ok(CO.slotHeroes(F).map(a => a.id).sort().join() === ids.join() && mem.every(a => S.agents.includes(a) && a.state !== 'dead'), 'all five stand on ' + far);
    ok(!A.frozenHeroes().some(a => ids.includes(a.id)), 'nobody of theirs is left on the map behind');
    const entry = exit(), spots = new Set(mem.map(a => a.x.toFixed(2) + ',' + a.y.toFixed(2)));
    ok(spots.size === mem.length, 'spread out, not on one spot: ' + mem.map(a => a.x.toFixed(1) + ',' + a.y.toFixed(1)).join(' '));
    ok(mem.every(a => open(a.x, a.y) && a.x > 0 && a.y > 0 && a.x < 32 && a.y < 24 && Math.hypot(a.x - entry.x, a.y - entry.y) < 8), 'on open ground by ' + entry.name);
    ok(mem.every(a => !a.pq.length && !a.target && !a.adv && a.playGround === undefined), 'orders, targets and the old ground are gone: ' + JSON.stringify(mem.map(a => [a.pq.length, !!a.target, a.adv, a.playGround])));
    ok(mem.every(a => !a.intent || !!a.intent.done), 'aims of the old land are done: ' + (lead.intent.done && lead.intent.done.why));
    {const v = S.maps[home].adventures.find(x => x.id === 777); ok(v && v.held === lead.id && v.away && v.mem.join() === String(lead.id), 'the adventure is set aside with its map, held by the leader');
      ok(act(lead, 'quests').left_behind.join() === 'The Old Errand', 'and the quest log says where it was left')}
    ok(!F.road && !F.wait, 'the road is spent');
    {const w = S.dmAgent.when; ok(w.list.length === 1 && w.list[0].trigger === 'after_hours' && w.parked[home].list[0].trigger === 'enter_town', 'the watch on a place parks with its map, the timed one goes with the DM');
      ok(dmAct('dm_status').campaign.waiting_on_other_maps[MAPS[home].name] === 1, 'and the DM can see it waits')}
    {const g = lead.goal, r = act(lead, 'status'); ok(g.zoneMap === home && g.zoneName === MAPS[home].regions[0].name, 'an oath\'s region keeps its map and its name');
      ok(A.oathZone(g) === null && M.zoneAt(lead.x, lead.y) === 0 && !g.done, 'and index 0 of the far map is not the place sworn to')}
    ok(mem.every(a => a.lore == null || X.knows(a, M.ZONES[0])), 'they know the ground they stand on');
    console.log('the far side');
    ok(opened(F, 'farside'), 'an arrival scene opens at once'); const b = mem.find(a => a !== lead), v = tableView(b), sc = scene(F);
    ok(sc.all === true && sc.ids.length === mem.length, 'everyone present, one round');
    ok(v.frame.includes(entry.name) && v.frame.includes(M.ZONES[0]) && v.frame.includes(farTown), 'the scripted frame is the entry exit and the map\'s own words: ' + v.frame);
    ok(sc.calls && sc.calls.length === 1 && sc.calls[0].kind === 'frame' && sc.calls[0].by === 'scripted' && (b.chat || []).some(e => e.dm && e.text.includes(entry.name)), 'with no DM listening the scripted line is spoken, the land opens in words');
    ok(mem.every(a => (a.playEv || []).some(e => /You have crossed/.test(e.text))), 'each member has the crossed event');
    answers(F, (a, i) => i ? 'look' : 'speak'); ok(closed(F), 'one round, and the table closes');
    ok((lead.playEv || []).some(e => /Where you go/.test(e.text)), 'the leader is told the next move is theirs');
    ok(S.chronicle.some(e => e.parts.map(p => p && p.t || p).join('').includes(MAPS[far].name)) && S.dmLog.some(e => e.detail && e.detail.crossing && e.detail.to === far), 'the Chronicle and the DM log have it');
    const bad = []; for (const t of X.PLAYER_TOOLS) if (!t.act) {const r = act(lead, t.name, {}); if (BROKEN.test(said(r))) bad.push(t.name)} for (const t of X.DM_TOOLS) if (!t.act) {const r = dmAct(t.name, {}); if (BROKEN.test(said(r))) bad.push('dm ' + t.name)}
    ok(!bad.length, 'every hero and DM read answers on the far side' + (bad.length ? ': ' + bad.join(', ') : ''));
    const r = act(lead, 'move_to', {target: farTown}); ok(r.ok, 'the leader can walk to ' + farTown + ': ' + r.going); steps(600); ok(until(() => !lead.pq.length, 3000) && lead.state !== 'dead', 'and does');

    console.log('frozen state identical on return');
    {const packed = () => JSON.stringify(json().campaign.maps[home]), p0 = packed(); steps(60 * 30); ok(packed() === p0, 'a frozen map does not move while the company plays elsewhere');
      const back = exit(), when0 = S.dmAgent.when.parked[home].list[0], until0 = when0.until, gone = S.gameMin; at(mem, back); act(lead, 'move_to', {target: back.name}); ok(opened(F, 'crossing'), 'the road home opens the same way');
      const fr = tableView(b).frame; ok(/walked it before/.test(fr), 'and says they know it: ' + fr); answers(F, 'go'); ok(until(() => M.MAP_ID === home, 300), 'home');
      ok(opened(F, 'farside') && /^Back in /.test(scene(F).title), 'with an arrival of its own: ' + scene(F).title); answers(F, 'look'); closed(F);
      const w = S.dmAgent.when; ok(!w.parked && w.list.some(e => e.trigger === 'enter_town') && w.list.find(e => e.trigger === 'enter_town').until > until0, 'the parked watch is back, its hours stopped while they were away');
      ok(S.adventures.find(x => x.id === 777).held === lead.id, 'the adventure is there to take up');
      const v0 = S.adventures.find(x => x.id === 777); lead.pq = []; lead.state = 'hunt'; lead.x = v0.scenes[0].at.x; lead.y = v0.scenes[0].at.y; ok(until(() => lead.adv === 777, 30), 'and is taken up on the spot'); for (const a of mem) a.adv = null; S.adventures.splice(S.adventures.indexOf(v0), 1); // a stand-in with no scenes of its own: its work here is done
      ok(A.oathZone(lead.goal) === 0, 'the oath reads its region again')}}

  console.log('there and straight back, a full roster');
  {const {F, mem, lead} = world({}), Tmode = TB.TABLE; SIM.step(1 / 60); for (let i = 0; i < 60 * 120; i++) {if (S.table) break; SIM.step(1 / 60)} while (TB.sceneFor(F)) {answersAny(X, F); SIM.step(1 / 60)}
    Tmode.mode = 'off'; const live = mem.filter(a => a.state !== 'dead'); at(live);
    const a0 = json(), dead0 = new Set(S.agents.filter(a => a.state === 'dead').map(a => a.id)); CR.cross(F, exit()); ok(M.MAP_ID === far, 'there'); CR.cross(F, exit()); ok(M.MAP_ID === home, 'and back');
    const scrub = s => {const o = comparable(s, dead0), go = new Set(o.agents.filter(a => a.company != null || a.player || a.companion != null || a.hire).map(a => a.id));
      for (const a of o.agents) if (go.has(a.id)) for (const k of ['history', 'pq', 'intent', 'lore', 'memory', 'playEv', 'playEvN', 'playGround', 'goal', 'adv']) delete a[k];
      for (const k of ['chronicle', 'timeline', 'gameMin']) delete o[k]; for (const c of o.companies) {delete c.log; delete c.road; delete c.seq} return o};
    const d = firstDiffs(scrub(a0), scrub(json())); ok(!d.length, 'every key of the save, the company\'s own road aside (' + a0.agents.length + ' heroes, ' + a0.mobs.length + ' mobs)' + (d.length ? '\n    ' + d.join('\n    ') : ''))}

  console.log('a fallen member on the far map');
  {const {F, mem, lead} = world(); ok(go(F, mem, lead), 'the company crosses'); opened(F, 'farside'); answers(F, 'look'); closed(F); const hall = F.hall; ok(!M.CITY.some(c => c.name === hall), 'its hall ' + hall + ' is on the map behind');
    ok(A.townNear(hall, lead) === farTown, 'the town near them stands in for it: ' + A.townNear(hall, lead)); const c = M.CITY[0]; for (const a of mem) {a.x = c.gate.x; a.y = c.gate.y; a.state = 'town'; a.pq = []}
    const lost = mem.find(a => a !== lead); H.slay(lost, {kind: 'boss', name: 'a test', id: 0}); ok(lost.state === 'dead' && until(() => F.arrivals && F.arrivals.length === 1 || TB.sceneFor(F), 60), lost.name + ' falls, and a seat waits');
    ok(until(() => TB.sceneFor(F) && TB.sceneFor(F).kind === 'arrival', 600), 'the newcomer comes to the town they are in'); const sc = TB.sceneFor(F), n = byId(sc.ctx.recruit);
    ok(n && n.town === farTown && X.homeOf(n).name === farTown && Math.hypot(n.x - c.gate.x, n.y - c.gate.y) < 2, n.name + ' is at the gate of ' + n.town + ', and that is home')}

  console.log('a world with a second map whose hero is not of the map\'s people');
  {const {F, mem, lead} = world(); const was = lead.town; ok(go(F, mem, lead), 'the company crosses'); ok(lead.town === was && X.homeOf(lead).name === farTown, 'a.town keeps ' + was + ' for the record; home here is ' + X.homeOf(lead).name)}
  process.exit(fail ? 1 : 0);
}
function answersAny(X, F) {const sc = X.TB.sceneFor(F); if (!sc) return; for (const id of sc.ids) {const a = X.byId(id); if (a && !sc.acts[id] && a.state !== 'dead') {const o = X.TB.optionsFor(sc, a)[0]; if (o) X.act(a, 'scene_act', {option: o.k, line: ''})}}}

if (mode === '--voice') { // the DM at both tables; what it reads
  const X = await crossTools(), {S, M, home, CO, TB, act, steps, until, world, exit, at, scene, opened, answers, closed, dmAct} = X;
  const {MAPS} = await import('../src/world/spec.js'), far = exit().to.map, {sceneCall} = await import('../src/sim/arrival.js');
  console.log('\nthe DM frames both ends of the road');
  const {F, mem, lead} = world(); at(mem);
  {const st = dmAct('dm_status'); ok(st.campaign.map === home && st.campaign.visited.join() === MAPS[home].name && st.campaign.roads.length === 1 && st.campaign.roads[0].name === exit().name && st.campaign.roads[0].open && st.campaign.roads[0].to === MAPS[far].name, 'dm_status.campaign: the map, what was walked, the roads: ' + JSON.stringify({map: st.campaign.map, visited: st.campaign.visited, roads: st.campaign.roads})); ok('loaded' in st.campaign, 'beside the campaign seed it always showed')}
  const voice = text => {let got = null; const r = until(() => {const c = dmAct('table_call'); if (c.call) {got = c; return true} return false}, 60 * 10); if (!r) return null; const a = dmAct('table_answer', {call: got.call.id, key: got.call.key, text}); return {call: got.call, a}};
  const sig0 = dmAct('dm_status').fellowship_change; act(lead, 'move_to', {target: exit().name}); steps(2); ok(!!scene(F), 'the scene opens');
  {const c = dmAct('dm_status').crossing; ok(c && c.road === exit().name && c.phase === 'table', 'dm_status.crossing says where they stand: ' + JSON.stringify(c))}
  {const v = voice('Grey milestones go off over the rise, and a wind comes back along them.'); ok(v && v.call.kind === 'frame' && v.a.ok && v.call.about.includes(MAPS[far].name), 'table_call asks for the frame, and tells the DM alone what lies beyond'); }
  ok(opened(F, 'crossing'), 'the members are woken once it is set'); ok(/Grey milestones/.test(X.tableView(mem[0]).frame), 'and read the DM\'s frame');
  answers(F, 'go'); ok(until(() => M.MAP_ID === far, 300), 'they go');
  {const v = voice('The road drops into a green bowl of land, and far off there are walls.'); ok(v && v.call.kind === 'frame' && /first time/.test(v.call.about) && v.a.ok, 'the far side is framed by the DM: the first view of a new land')}
  ok(opened(F, 'farside'), 'the arrival waits for it'); ok(/green bowl/.test(X.tableView(mem[0]).frame), 'and the members read it'); answers(F, 'look'); closed(F);
  {const st = dmAct('dm_status'); ok(st.fellowship_change !== sig0 && st.fellowship_change.endsWith('@' + far), 'fellowship_change carries the map, so the DM takes an event turn: ' + st.fellowship_change);
    ok(st.campaign.map === far && st.campaign.visited.length === 2 && st.campaign.roads[0].walked === true, 'dm_status.campaign reads the far map, both lands walked')}
  {const r = dmAct('read_dm_log', {n: 12}); ok(JSON.stringify(r).includes('crossed from'), 'the DM log has the crossing')}
  process.exit(fail ? 1 : 0);
}

if (mode === '--know') { // what heroes and the DM know of other maps (slice 5): a mock leader hears of the far land, orders the walk, crosses, and the DM follows
  const X = await crossTools(), {S, M, home, CO, TB, act, steps, until, world, exit, at, scene, opened, answers, closed, dmAct, knows, json} = X;
  const {MAPS} = await import('../src/world/spec.js'), L = await import('../src/sim/lore.js'), A = await import('../src/sim/atlas.js'), DA = await import('./dm-agent.mjs'), OR = await import('./orders.mjs');
  const far = exit().to.map, farName = MAPS[far].name, farTown = MAPS[far].towns[0].name, third = 'testlinkc', thirdName = MAPS[third].name, thirdTown = MAPS[third].towns[0].name;
  const inTown = (mem) => {const c = M.CITY[0]; for (const a of mem) {a.x = c.gate.x - 2; a.y = c.gate.y; a.state = 'town'; a.pq = []; a.dest = null; a.zone = M.zoneAt(a.x, a.y)}};
  const crossNow = (F, mem, lead, target) => {const r = act(lead, 'move_to', {target}); if (!r.ok) return r; const was = M.MAP_ID; at(mem, F.road ? A.exitById(F.road.exit) : exit()); if (!opened(F, 'crossing')) return {ok: false, error: 'no scene'}; answers(F, 'go'); if (!until(() => M.MAP_ID !== was, 3600)) return {ok: false, error: 'no crossing'}; opened(F, 'farside'); answers(F, 'look'); closed(F); return r};

  console.log('\nheroes hear of other lands');
  {const {F, mem, lead} = world(); inTown(mem); act(lead, 'look');
    ok(act(lead, 'look').land === MAPS[home].name && act(lead, 'status').land === MAPS[home].name, 'look and status name the land they stand in');
    const r0 = act(lead, 'move_to', {target: farTown}); ok(!r0.ok && !F.road, 'a far town nobody has told them of is refused: ' + (r0.error || '').slice(0, 60));
    {const v = act(lead, 'look').roads_out; ok(v && v[0].road === exit().name && !v[0].leads_to && /gate will know/.test(v[0].word), 'in town look names the road and not what lies past it: ' + JSON.stringify(v))}
    {const j = act(lead, 'list_jobs'), r = j.roads_out[0]; ok(r.road === exit().name && r.leads_to === farName && r.beyond.includes(farTown) && /road|test|blades|going/.test(r.word), 'list_jobs gives the gate\'s word: ' + JSON.stringify(r));
      ok(knows(lead, farName) && knows(lead, farTown) && !knows(lead, thirdName), 'and it teaches the land past the road and its first town, no further');
      ok(/gate captain/.test(JSON.stringify(act(lead, 'lore', {about: farTown}).places)), 'the lore tool says who said so')}
    {const p = act(lead, 'places'), q = act(lead, 'places', {kind: 'road'}); ok(p.roads_out[0].road === exit().name && /tiles/.test(p.roads_out[0].way) && /walks to that road/.test(p.use), 'places lists the roads the hero knows: ' + JSON.stringify(p.roads_out[0]));
      ok(q.ok && !q.places.length && q.roads_out.length === 1, 'places {kind: road} lists only them'); ok(act(lead, 'places', {about: farTown}).roads_out.length === 1, 'and about finds a place past one')}
    {const b = mem.find(a => a !== lead); ok(!knows(b, farTown), 'a companion who has not read the gate has not heard'); L.hear(b, 'I hear ' + farTown + ' has good walls.', lead.name); ok(knows(b, farTown), 'until a line names it');
      const c = mem.filter(a => a !== lead && a !== b)[0], cp = S.npcs.find(p => p.role === 'captain'); c.x = cp.x; c.y = cp.y + .5; const t = act(c, 'talk', {target: 'captain', text: 'Where does the east road lead?'}); ok(knows(c, farName), 'a townsperson asked about the road answers: ' + JSON.stringify(t).slice(0, 140));
      const d = dmAct('seed_rumour', {town: M.CITY[0].name, text: 'They say the walls of ' + farTown + ' are worth the walk.', about: farTown, reason: 'to draw them on'}); ok(d.ok, 'the DM may seed a rumour about a place on another land: ' + (d.error || ''))}

    console.log('the walk and the crossing');
    const r = act(lead, 'move_to', {target: farTown}); ok(r.ok && r.going === exit().name && F.road && F.road.exit === exit().id && F.road.bound === farTown, 'move_to ' + farTown + ' goes to the right road: ' + r.note); ok(r.note.includes(farName) && r.note.includes(exit().name), 'and says so in words');
    {const b = mem.find(a => a !== lead), h = act(b, 'hunt', {where: farTown}); ok(!h.ok && /not in this land/.test(h.error), 'hunt {where} refuses a land it cannot reach: ' + (h.error || '').slice(0, 70))}
    {const st = dmAct('dm_status'), R = st.campaign.roads[0]; ok(R.to === farName && R.levels === '1-5' && R.towns.includes(farTown) && R.then.includes(thirdName), 'dm_status.campaign says what is next along the road: ' + JSON.stringify(R));
      const s = dmAct('survey', {near: M.CITY[0].name}), g = dmAct('regions'); ok(s.map === MAPS[home].name && /live map/.test(s.map_note) && g.map === MAPS[home].name && g.roads_out[0].to === farName && g.roads_out[0].open, 'survey and regions name the map, and that it is the live one');
      const n = dmAct('survey', {near: farTown}), m = dmAct('mark_place', {kind: 'ruin', near: farTown, reason: 'x'}), h = dmAct('hooks', {town: farTown}), w = dmAct('narrate', {near: farTown, text: 'Far off.'}); ok([n, m, h, w].every(x => !x.ok && x.error.includes(farName) && /live map/.test(x.error)), 'near refuses a place of another land and names the land: ' + n.error.slice(-170));
      const e1 = dmAct('when', {trigger: 'enter_map', on: {map: farName, company: 'fellowship'}, action: 'narrate', args: {near: farTown, text: 'Bells ring in the valley as {who} comes down the road.'}, reason: 'the road\'s end'}); ok(e1.ok && e1.hours === 240 && /read then/.test(e1.note), 'when enter_map takes a place of that land, read when it fires: ' + (e1.error || e1.trigger));
      const e2 = dmAct('when', {trigger: 'enter_map', on: {map: 'Nowhere Land'}, action: 'narrate', args: {near: 'table', text: 'x'}, reason: 'x'}); ok(!e2.ok && /no land called/.test(e2.error), 'a land the roads do not reach is refused in words');
      const e3 = dmAct('when', {trigger: 'after_hours', on: {h: 3}, action: 'narrate', args: {near: M.CITY[0].name, text: 'The bell tolls in the empty square.'}, reason: 'home'}); ok(e3.ok, 'a timed when with a place in its action');
      const e4 = dmAct('when', {trigger: 'after_hours', on: {h: 72}, action: 'narrate', args: {near: lead.name, text: 'The wind turns.'}, reason: 'follows them'}); ok(e4.ok, 'and one that follows the company')}
    lead.quest = {type: Object.keys((await import('../src/data/mobs.js')).MOBS)[0], need: 5, have: 2, at: 1}; const q0 = lead.quest; {const c = CO.companyOf ? null : null}
    F.plans = [{id: 1, where: M.CITY[0].name, at: S.gameMin + 30, atText: 'noon', made: S.gameMin, by: lead.id, byName: lead.name, who: mem.map(a => a.id), whoNames: mem.map(a => a.name), status: 'open'}];
    lead.lore.p['My Cairn'] = {how: 'own', mk: 1, x: 6, y: 6, zone: 0, at: 0, day: 1};
    at(mem); ok(opened(F, 'crossing'), 'at the road the company is asked'); ok(!tableMentions(X, mem[0], farTown) || knows(mem[0], farTown), 'the frame names nothing they have not heard'); answers(F, 'go'); ok(until(() => M.MAP_ID === far, 3600), 'they cross');
    ok(opened(F, 'farside'), 'the far side opens'); answers(F, 'look'); ok(closed(F), 'and closes');
    ok((lead.playEv || []).some(e => e.text.includes(farTown) && /in this land/.test(e.text)), 'the leader is told the place it set out for is in this land');
    until(() => (S.dmAgent.when.fired || []).some(x => x.tool === 'narrate' && x.ok), 600); {const f = S.dmAgent.when.fired.find(x => x.tool === 'narrate'); ok(f && f.ok && /comes to/.test(f.trigger), 'enter_map fires on arrival, on that land: ' + JSON.stringify(f))}
    {const w = S.dmAgent.when, P = w.parked[home].list; ok(P.some(e => e.args && e.args.near === M.WORLD_ID) === false && P.length === 1 && P[0].args.near === MAPS[home].towns[0].name, 'the when with a place of the old land parks with it, unfired'); ok(w.list.some(e => e.args && e.args.near === lead.name), 'the one that follows the company goes with the DM');
      ok(dmAct('dm_status').campaign.waiting_on_other_maps[MAPS[home].name] === 1, 'and the DM can see it waits')}
    {const st = dmAct('dm_status').campaign; ok(st.map === far && st.visited.length === 2 && st.roads.find(x => x.to === MAPS[home].name).walked === true && !!st.empty_land, 'the DM\'s status follows them: ' + JSON.stringify(st).slice(0, 200))}

    console.log('what does not cross');
    {const s = act(lead, 'status'), q = act(lead, 'quests'); ok(s.quest === null && !lead.quest, 'the kill quest does not read as if it were here');
      ok(q.left_behind.some(x => x.includes('2/5') && x.includes(MAPS[home].name)), 'the quest log says where it waits: ' + q.left_behind.join('; '))}
    {steps(60 * 60); ok(F.plans[0].status === 'left' && !S.chronicle.some(e => /came and went/.test(e.parts.map(p => typeof p === 'string' ? p : p && p.t || '').join(''))), 'a meeting of the old land closes quietly: they are together, and nobody missed it');
      ok(!CO.openThreads(F).some(t => t.kind === 'meeting'), 'and is no open thread')}
    {delete F.camp; for (const a of mem) if (a.state === 'camp') a.state = 'hunt'; const r = act(lead, 'move_to', {target: 'My Cairn'}); ok(r.ok && r.going === exit().name, 'a mark of the old land walks to the road home, not to its old numbers: ' + r.going + ' ' + (r.error || ''));  ok(!act(lead, 'places').places.some(x => x.name === 'My Cairn'), 'and places gives it no way from here'); act(lead, 'move_to', {target: 'gate'})}

    console.log('several roads on');
    world(); }
  {const {F, mem, lead} = world(); L.learnPlace(lead, thirdTown, 'told'); const r = act(lead, 'move_to', {target: thirdTown}); ok(!r.ok && /not how to get there/.test(r.error) && !F.road, 'a place past a land they know nothing of: heard of, and no way there: ' + (r.error || '').slice(0, 80));
    L.learnPlace(lead, farName, 'told'); const r2 = act(lead, 'move_to', {target: thirdTown}); ok(r2.ok && r2.going === exit().name && F.road.bound === thirdTown && /2 lands on/.test(r2.note) && r2.note.includes(farName), 'once the land between is known the walk starts: ' + r2.note);
    at(mem); ok(opened(F, 'crossing'), 'the first road'); answers(F, 'go'); ok(until(() => M.MAP_ID === far, 3600), 'crossed'); opened(F, 'farside'); answers(F, 'look'); closed(F);
    ok((lead.playEv || []).some(e => e.text.includes(thirdTown) && e.text.includes('the north road')), 'the leader is told the next road in words');
    const n = M.EXITS.find(e => e.id === 'north'), r3 = crossNow(F, mem, lead, thirdTown); ok(r3.ok && r3.going === n.name && M.MAP_ID === third, 'the same order on the next land takes the next road: ' + M.MAP_ID);
    const homeTown = MAPS[home].towns[0].name, r4 = act(lead, 'move_to', {target: homeTown}); ok(r4.ok && /2 lands on/.test(r4.note) && r4.going === M.EXITS[0].name, 'and the way home is known, across the land between: ' + JSON.stringify(r4).slice(0, 300)); act(lead, 'move_to', {target: 'gate'});
    ok(dmAct('dm_status').campaign.visited.length === 3, 'the DM has all three lands walked')}
  {const {F, mem, lead} = world(); lead.quest = {type: Object.keys((await import('../src/data/mobs.js')).MOBS)[0], need: 5, have: 2, at: 1}; X.CR.cross(F, exit()); ok(!lead.quest && lead.questsAway[home], 'over: the quest waits'); while (TB.sceneFor(F)) {answers(F, 'look'); closed(F)} X.CR.cross(F, exit()); ok(lead.quest && lead.quest.have === 2 && !lead.questsAway, 'back: it is theirs again, count and all')}

  console.log('what the runners are told');
  {const st = dmAct('dm_status'), withL = OR.ordersFor(OR.ORDERS_FULL, null, farName), sys = DA.dmSystemPrompt(st); ok(withL.includes(OR.LAND_ORDERS) && !OR.ORDERS_FULL.includes('Roads between lands'), 'hero orders carry the lands only with a land to name');
    ok(sys.includes(DA.DM_MAP_ORDERS) && sys.includes(DA.DM_EMPTY_LAND_ORDERS) && /enter_map/.test(DA.DM_MAP_ORDERS), 'the DM\'s orders say it may prepare the next land, and that an empty world\'s is its own to fill');
    ok(DA.withDmMapOrders('old prompt', st).includes(DA.DM_MAP_ORDERS) && DA.withDmMapOrders(sys, st) === sys, 'an older session gets the line once')}
  process.exit(fail ? 1 : 0);
}
function tableMentions(X, a, name) {const v = X.tableView(a); return !!v && String(v.frame).includes(name)}
if (mode === '--hear') { // npm run lorecheck runs this: a far name is a place heard of, by the same ears
  const X = await crossTools(), {M, act, world, exit, knows} = X, {MAPS} = await import('../src/world/spec.js'), L = await import('../src/sim/lore.js');
  const far = MAPS[exit().to.map], town = far.towns[0].name, {mem, lead} = world(), b = mem.find(a => a !== lead);
  ok(!knows(b, town) && !knows(b, far.name), 'nobody has heard of ' + town);
  ok(L.hear(b, 'Beware of ' + town + ', they say the road there is deadly.', lead.name) > 0 && knows(b, town), 'a line that names it teaches it'); ok(!knows(b, far.name), 'and nothing else of that land');
  ok(/deadly/.test(act(b, 'lore', {about: town}).places[0].notes.join()), 'the warning is kept with the place');
  ok(act(b, 'status').places.some(p => p.startsWith(town)), 'status.places lists it, heard of');
  ok(knows(b, exit().name), 'the road out is known by name from the first');
  process.exit(fail ? 1 : 0);
}
if (mode === '--oneland') { // a world of one map: not a word about lands. Run on the Vale.
  const {SIM, M} = await sim(); const {S, init, markPlayer, playerAct, dmAct, setDmSeat} = SIM, A = await import('../src/sim/atlas.js'), L = await import('../src/sim/lore.js'), DA = await import('./dm-agent.mjs');
  init({}); setDmSeat(true); const a = S.agents.find(x => x.kind === 'hero' && x.state !== 'dead'); markPlayer(a, true);
  ok(!M.EXITS.length && !A.manyMaps() && !A.farNames().length && !A.roadsFrom().size, 'no roads, no far names');
  const reads = ['look', 'status', 'places', 'quests'].map(t => playerAct(a.id, t, {})), st = dmAct('dm_status'), g = dmAct('regions'), s = dmAct('survey', {near: M.CITY[0].name});
  ok(reads.every(r => !('land' in r) && !('roads_out' in r)), 'hero reads carry nothing of lands'); ok(!('map' in st.campaign) && !('roads' in st.campaign) && !('map' in g) && !('roads_out' in g) && !('map' in s), 'nor do the DM\'s: ' + JSON.stringify(st.campaign).slice(0, 80));
  const w = dmAct('when', {trigger: 'enter_map', on: {map: 'Anywhere'}, action: 'narrate', args: {near: 'table', text: 'x'}, reason: 'x'}); ok(!w.ok && /one land/.test(w.error), 'enter_map is refused in words: ' + w.error.slice(0, 60)); ok(!dmAct('whens').triggers.some(t => /enter_map/.test(t)), 'and the trigger list leaves it out');
  ok(!DA.dmSystemPrompt(st).includes('several lands'), 'the DM\'s orders say nothing of them');
  process.exit(fail ? 1 : 0);
}

if (mode === '--mid') { // a save between the vote and the road, played on in a fresh process. args: '-' (the original) or the save, then the out file
  const [saveFile, outFile] = args, X = await crossTools(), {S, M, home, CO, TB, act, steps, until, world, exit, at, scene, answers, opened, closed, json, restore, setRunnerLinks, setReflexAck} = X;
  const on = () => {const F = CO.slotted(); until(() => M.MAP_ID !== home, 600); opened(F, 'farside'); answers(F, 'look'); closed(F); steps(120); return JSON.stringify(json())};
  if (saveFile === '-') {const {F, mem, lead} = world(); at(mem); act(lead, 'move_to', {target: exit().name}); opened(F, 'crossing'); answers(F, 'go'); until(() => F.road && F.road.phase === 'go');
    const s = json(); writeFileSync(outFile + '.save', JSON.stringify(s)); ok(!!s.table && s.companies.find(c => c.slots).road.phase === 'go', 'saved with the vote taken and the map not yet changed'); restore(JSON.parse(JSON.stringify(s))); reseed(); writeFileSync(outFile, on()); process.exit(fail ? 1 : 0)} // restored here too, as --away does: the pool of names a save does not hold starts the same
  setRunnerLinks(() => 'connected'); setReflexAck(() => false); restore(JSON.parse(readFileSync(saveFile, 'utf8'))); ok(M.MAP_ID === home && CO.slotted().road.phase === 'go', 'a fresh process has the vote and the map as they were'); reseed(); writeFileSync(outFile, on()); process.exit(fail ? 1 : 0);
}

if (mode === '--runners') { // mock runners hold real claims at the relay across a crossing, one mid-wait, and the DM mid-poll
  const X = await crossTools(), {S, SIM, M, home, CO, CN, TB, CR, act, steps, until, world, exit, at, scene, opened, answers, closed, byId} = X;
  const http = (await import('node:http')).default, {attachPlay} = await import('./relay-mcp.mjs'), {localBackend} = await import('./play-headless.mjs'), {hostCall, hostDm} = await import('../src/sim/player-host.js');
  console.log('\nmock runners across a crossing');
  const {F, mem, lead} = world(); at(mem);
  const server = http.createServer((q, s) => {s.writeHead(404); s.end()}), play = attachPlay(server, {backend: localBackend(), log: () => {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => (await fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})).json();
  const health = async () => (await fetch(base + '/play/health')).json(), run = a => 'runner-' + a.id;
  for (const a of mem) await post('/play/claim', {hero: a.id, runner: run(a)});
  const dmC = await post('/play/claim', {role: 'dm', runner: 'runner-dm'}); ok(dmC.ok !== false, 'the DM seat is claimed');
  const h0 = await health(); ok(h0.map === home && h0.heroes.filter(h => h.claimed).length === 5, '/play/health: map ' + h0.map + ', five seats claimed');
  const call = (a, tool, args = {}) => post('/play/call', {hero: a.id, runner: run(a), tool, args});
  const clock = setInterval(() => {for (let i = 0; i < 40; i++) SIM.step(1 / 60); play.tick && play.tick()}, 5); // the world runs while the runners talk
  const sleep = ms => new Promise(r => setTimeout(r, ms)), waitFor = async (f, ms = 20000) => {const t0 = Date.now(); while (Date.now() - t0 < ms) {if (await f()) return true; await sleep(10)} return false};
  await waitFor(async () => (await health()).heroes.every(h => h.link === 'waiting' || h.link === 'connected'));
  ok(await call(lead, 'move_to', {target: exit().name}).then(r => r.ok), 'the leader orders the road over /play/call'); ok(await waitFor(() => scene(F) && scene(F).kind === 'crossing' && !X.SC.framing(scene(F)) && scene(F).wk && scene(F).wk.done), 'the scene is up');
  const r = await Promise.all(mem.map(a => call(a, 'scene_act', {option: 'go', line: ''}))); ok(r.every(x => x.ok), 'five runners answer go: ' + r.map(x => x.chose).join(','));
  ok(await waitFor(() => M.MAP_ID !== home), 'the map turns over');
  const h1 = await health(); ok(h1.map === exit().id ? false : h1.map === M.MAP_ID && h1.heroes.map(h => h.id).join() === h0.heroes.map(h => h.id).join() && h1.heroes.every(h => h.claimed && h.alive), '/play/health: map ' + h1.map + ', the same five, every claim held');
  ok((await post('/play/claim', {hero: lead.id, runner: 'runner-other'})).ok !== true, 'a seat stays its runner\'s across the road');
  ok(await waitFor(() => scene(F) && scene(F).kind === 'farside' && !X.SC.framing(scene(F)) && scene(F).wk && scene(F).wk.done), 'the arrival is up'); const r2 = await Promise.all(mem.map(a => call(a, 'scene_act', {option: 'look', line: ''}))); ok(r2.every(x => x.ok), 'and they answer it through the same claims');
  ok(await waitFor(() => !scene(F)), 'the table closes');
  // a wait and a DM long-poll in flight as the world changes under them
  const b = mem.find(a => a !== lead); TB.TABLE.mode = 'off'; let done = null; const w = call(b, 'wait', {minutes: 60}).then(x => {done = x}); const poll = hostDm('table_call', {wait_ms: 400}); await sleep(30);
  ok(done === null, 'a member is mid-wait'); const was = M.MAP_ID; CR.cross(F, exit()); ok(M.MAP_ID !== was, 'the company crosses back with the wait pending'); await w; const p = await poll;
  ok(done && done.ok !== false && !BROKEN.test(said(done)) && done.hp, 'the wait comes home whole on the other map: ' + (done && done.why)); ok(!BROKEN.test(said(p)), 'and the DM\'s poll answers');
  ok(await call(b, 'look').then(x => x.ok !== false), 'the next read is of the map they stand on');
  clearInterval(clock); server.close(); play.close && play.close(); process.exit(fail ? 1 : 0);
}

if (mode === '--channel') { // npm run channelcheck runs this: the crossing's texts against the seats' private words
  const X = await crossTools(), {S, M, home, TB, PC, tableView, act, steps, until, world, exit, at, scene, opened, answers, closed, dmAct, PLAYER_TOOLS} = X;
  const {MAPS} = await import('../src/world/spec.js'), far = exit().to.map, farName = MAPS[far].name, farTown = MAPS[far].towns[0].name;
  console.log('\nthe crossing\'s texts');
  const {F, mem, lead} = world(); at(mem);
  const plant = {notes: 'QZXnote', plan: 'QZXplan', intent: 'QZXintent', watch: 'QZXwatch', reason: 'QZXreason'};
  ok(dmAct('notes_write', {section: 'secrets', op: 'add', text: 'The far town hides ' + plant.notes, about: lead.name}).ok, 'a DM secret');
  ok(dmAct('notes_write', {section: 'plans', op: 'add', text: 'Waiting in ' + farName + ': ' + plant.plan}).ok, 'a DM plan for the far map');
  dmAct('log_intent', {text: 'They will cross: ' + plant.intent});
  ok(dmAct('watch', {trigger: 'enter_town', on: {town: M.CITY[0].name}, note: plant.watch, hours: 72}).ok, 'a parked watch');
  ok(dmAct('when', {trigger: 'after_hours', on: {h: 40}, action: 'narrate', args: {text: 'Rain.', near: M.CITY[0].name}, reason: plant.reason, hours: 72}).ok, 'a when with a reason');
  const heard = [], reads = PLAYER_TOOLS.filter(t => !t.act).map(t => t.name);
  const gather = what => {for (const a of mem) {heard.push({what, text: JSON.stringify([tableView(a), PC.paceBrief(a.id), a.playEv, a.chat])}); for (const t of reads) heard.push({what: what + ' ' + t, text: JSON.stringify(act(a, t, {}))})}};
  const leak = re => heard.filter(h => re.test(h.text)).map(h => h.what);
  // the hold
  const b = mem.find(a => a !== lead); act(lead, 'move_to', {target: exit().name}); at(mem); b.x = lead.x - 25; steps(3); ok(!!F.road.hold, 'held at the road'); gather('the hold'); b.x = lead.x - 1; steps(1);
  // the leaving, with the DM at the table
  let call = null; ok(until(() => {const c = dmAct('table_call'); if (c.call) call = c.call; return !!call}, 600), 'the DM is asked to frame the leaving');
  ok(call.about.includes(plant.plan) && call.about.includes(farName), 'its call carries what is its alone: the far map and its plan for it');
  ok(dmAct('table_answer', {call: call.id, key: call.key, text: 'The milestones go on over the rise.'}).ok, 'the DM answers'); ok(opened(F, 'crossing'), 'the scene is up'); gather('the leaving');
  ok(!leak(new RegExp(farName + '|' + farTown)).length, 'nobody at the table is told what lies beyond a road they never heard of' + leak(new RegExp(farName + '|' + farTown)).slice(0, 3).join(', '));
  answers(F, 'go'); ok(until(() => M.MAP_ID === far, 300), 'they cross');
  call = null; ok(until(() => {const c = dmAct('table_call'); if (c.call) call = c.call; return !!call}, 600) && call.about.includes(plant.plan), 'the far side\'s call carries the plan as well');
  ok(dmAct('table_answer', {call: call.id, key: call.key, text: 'A green bowl of land.'}).ok, 'the DM frames it'); ok(opened(F, 'farside'), 'the arrival is up'); gather('the far side');
  ok(tableView(lead).frame.includes('green bowl'), 'what the DM said reaches them, and that is the channel');
  answers(F, 'look'); closed(F); gather('after');
  const L = leak(/QZX/); ok(!L.length, L.length ? 'LEAKS: ' + L.slice(0, 8).join('; ') : heard.length + ' hero-side texts of the crossing: no DM note, plan, log line, watch or when reason among them');
  ok(!leak(/waiting_on_other_maps|table_call|DM log|dm_status/).length, 'nor a word of the DM\'s tools');
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
// ---- 6. the pack ----
for (const [from, to] of [['testlinka', 'testlinkb'], ['testbare', 'testlinka'], ['eldmoor', 'testlinkb'], ['vale', 'testcellar']]) {
  const r = spawnSync(process.execPath, [HERE, '--pack', to], {env: env(from), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr.slice(-2000));
  ok(r.status === 0, `${from} to ${to} and back`);
}
// ---- 7. a save with a frozen map, in a fresh process ----
console.log('\na save with a frozen map, replayed');
for (const [from, to] of [['testlinka', 'testlinkb'], ['eldmoor', 'testlinkb']]) {
  const out = join(dir, 'away-' + from + '.json'), o = spawnSync(process.execPath, [HERE, '--away', to, '-', out], {env: env(from), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (o.status !== 0) {ok(false, `${from}: the original: ` + (o.stderr || '').trim().slice(-500)); continue}
  const want = JSON.parse(readFileSync(out, 'utf8'));
  for (const [i, what, key] of [[0, 'at the moment of the switch', 'at'], [1, 'after play on the far map', 'mid']]) {
    const end = out + '.end' + i, c = spawnSync(process.execPath, [HERE, '--away', to, out + '.' + i, end], {env: env(from), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    process.stdout.write(c.stdout || '');
    if (c.status !== 0) {ok(false, `${from}, ${what}: ` + (c.stderr || '').trim().slice(-500)); continue}
    const got = JSON.parse(readFileSync(end, 'utf8'));
    for (const part of ['far', 'home']) {const d = firstDiffs(JSON.parse(want[key][part]), JSON.parse(got[part]));
      ok(!d.length, `${from}, saved ${what}: a fresh process plays ${part === 'far' ? 'on there' : 'on, home again,'} exactly as the original did` + (d.length ? '\n    ' + d.join('\n    ') : ''))}
  }
}
// ---- 8. five maps against the store, and the page on it ----
{
  const s = spawnSync(process.execPath, [HERE, '--store'], {env: env('testlinka'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  process.stdout.write(s.stdout || ''); if (s.stderr) process.stderr.write(s.stderr.slice(-2000));
  ok(s.status === 0, 'save, load, export and import work on IndexedDB');
  const r = spawnSync(process.execPath, [HERE, '--size', process.env.CROSSING_DAYS || '6', '2'], {env: env('vale'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr.slice(-2000));
  ok(r.status === 0, 'five maps fit the store');
}
// ---- 9. the crossing ----
for (const [m, what] of [['--road', 'when a road opens, what holds it and what it asks'], ['--party', 'a company stays a party, and the road lasts as long as the words'], ['--over', 'the crossing, the far side and home again'], ['--voice', 'the DM at both tables'], ['--know', 'what heroes and the DM know of other lands'], ['--runners', 'mock runners hold their claims across it']]) {
  const r = spawnSync(process.execPath, [HERE, m], {env: env('testlinka'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000});
  process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr.slice(-2000));
  ok(r.status === 0, what);
}
{const r = spawnSync(process.execPath, [HERE, '--oneland'], {env: env('vale'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}); process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr.slice(-2000)); ok(r.status === 0, 'a world of one map hears nothing of lands')}
{ // a save between the vote and the road, in a fresh process
  const out = join(dir, 'mid.json'), o = spawnSync(process.execPath, [HERE, '--mid', '-', out], {env: env('testlinka'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  process.stdout.write(o.stdout || ''); if (o.status !== 0) ok(false, 'the save mid-crossing: ' + (o.stderr || '').trim().slice(-500));
  else {const end = out + '.end', c = spawnSync(process.execPath, [HERE, '--mid', out + '.save', end], {env: env('testlinka'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    process.stdout.write(c.stdout || ''); if (c.status !== 0) ok(false, 'mid-crossing, fresh process: ' + (c.stderr || '').trim().slice(-500));
    else {const d = firstDiffs(JSON.parse(readFileSync(out, 'utf8')), JSON.parse(readFileSync(end, 'utf8'))); ok(!d.length, 'saved mid-crossing, a fresh process crosses and plays on exactly as the original did' + (d.length ? '\n    ' + d.join('\n    ') : ''))}}
}
console.log(fail ? `\n${fail} FAILED` : '\ncrossingcheck ok');
process.exit(fail ? 1 : 0);
