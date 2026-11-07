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
// The crossing itself is a later slice. Usage: npm run crossingcheck
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
  let failed = 0; page2.onSaveFail(() => failed++); idb.fail = true; page2.saveStore().setItem(save.SAVE_KEY, 'last gasp'); await page2.whenSaved(); idb.fail = false;
  ok(failed === 1 && ls.getItem(save.SAVE_KEY) === 'last gasp', 'a write IndexedDB refuses is said, and kept in localStorage for the next open');
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
console.log(fail ? `\n${fail} FAILED` : '\ncrossingcheck ok');
process.exit(fail ? 1 : 0);
