// World generator check: builds every spec headlessly, prints per-zone tile
// histograms, road tile counts and spawn-point counts, proves that routed
// roads bridge rivers, and fails if a map drifted from its snapshot. Every world of WORLDS (src/world/spec.js) is held to the same
// checks; a new world needs only a row in scripts/world-snapshots.mjs.
// Usage: npm run worldcheck
// If you changed a map on purpose, paste the new hashes into scripts/world-snapshots.mjs.
import {ELDMOOR, TESTWORLD, STEPPING, VALE, WORLDS, MAPS, TESTLINK, TESTBARE, TOWN_KIT} from '../src/world/spec.js';
import {buildWorld} from '../src/world/gen.js';
import {RACES} from '../src/data/races.js';
import {FAC} from '../src/data/factions.js';
import {ROAD, BRIDGE, RIVER, WALKABLE} from '../src/world/tiles.js';

import {SNAPSHOTS} from './world-snapshots.mjs'; // FNV-1a hashes of every world's zone and tile arrays, one table
const TILE_NAMES = ['grass','tree','swamp','mud','rock','peak','lava','road','floor','wall','river','bridge','sgrass','flower','snow','ice'];

function fnv(a) {let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) {h ^= a[i]; h = Math.imul(h, 16777619) >>> 0} return h.toString(16).padStart(8, '0')}

function report(spec) {
  const w = buildWorld(spec);
  console.log(`\n== ${w.name} ${w.w}x${w.h}: ${w.ZONES.length} regions, ${w.CITY.length} towns, ${w.LANDMARKS.length} landmarks, ${w.LIGHTS.length} lights, ${w.LABELS.length} labels`);
  let roads = 0, bridges = 0;
  for (let z = 0; z < w.ZONES.length; z++) {
    const hist = new Array(TILE_NAMES.length).fill(0); let n = 0;
    for (let i = 0; i < w.tiles.length; i++) if (w.zone[i] === z) {hist[w.tiles[i]]++; n++}
    roads += hist[ROAD]; bridges += hist[BRIDGE];
    const band = w.REGIONS[z].band;
    console.log(`  ${w.ZONES[z].padEnd(12)} L${band[0]}-${band[1] === Infinity ? '+' : band[1]}  ${String(n).padStart(4)} tiles  spawn ${String(w.ZPTS[z].length).padStart(4)}  ` +
      hist.map((c, t) => c ? `${TILE_NAMES[t]}:${c}` : '').filter(Boolean).join(' '));
  }
  console.log(`  roads: ${roads} road tiles, ${bridges} bridge tiles; routed roads: ${w.ROUTES.length}`);
  for (const c of w.CITY) console.log(`  town ${c.name} (fac ${c.fac}) rect ${c.x0},${c.y0}-${c.x1},${c.y1} gate ${c.gate.x},${c.gate.y}`);
  for (const l of w.LANDMARKS) console.log(`  ${l.kind} ${l.name} at ${l.x},${l.y}`);
  console.log(`  zoneFor 1..20: ${Array.from({length: 20}, (_, i) => w.zoneFor(i + 1)).join('')}`);
  console.log(`  hashes: zone ${fnv(w.zone)} tiles ${fnv(w.tiles)}`);
  return w;
}

// Walk only road and bridge tiles from a to b (8-neighbour). Proves a routed road is continuous.
function roadConnected(w, a, b) {
  const key = (x, y) => y * w.w + x, seen = new Uint8Array(w.w * w.h), q = [[a[0], a[1]]]; seen[key(a[0], a[1])] = 1;
  while (q.length) {const [x, y] = q.shift(); if (x === b[0] && y === b[1]) return true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h || seen[key(nx, ny)]) continue; const t = w.tiles[w.I(nx, ny)];
      if (t === ROAD || t === BRIDGE) {seen[key(nx, ny)] = 1; q.push([nx, ny])}}}
  return false;
}

import {skyFor, WEATHER} from '../src/sim/weather.js';
let fail = 0;
// Region skies (#318): a Stepping region with a sky follows its own table; the rest follow their biome.
{
  const sw = buildWorld(STEPPING), pale = sw.REGIONS.find(r => r.id === 'palereach'), low = sw.REGIONS.find(r => r.id === 'lowmark');
  const kinds = skyFor(pale).map(o => o[0]);
  if (!kinds.includes('fog') || kinds.includes('squall')) {console.error('FAIL: Palereach sky does not follow its own table'); fail++}
  if (sw.REGIONS.some(r => r.sky && r.sky.some(o => !WEATHER[o[0]]))) {console.error('FAIL: a region sky names an unknown weather kind'); fail++}
  if (skyFor(low).map(o => o[0]).join() !== 'clear,rain,drizzle') {console.error('FAIL: Lowmark sky is not its biome table'); fail++}
  if (ELDMOOR.regions.some(r => r.sky)) {console.error('FAIL: Eldmoor regions must not name a sky'); fail++}
}
report(ELDMOOR); // the loop below checks it with the others
const tw = report(TESTWORLD);
for (let z = 0; z < tw.ZONES.length; z++) if (!tw.ZPTS[z].length) {console.error(`FAIL: Testworld region ${tw.ZONES[z]} has no spawn points`); fail++}
if (!tw.ROUTES.length) {console.error('FAIL: Testworld has no routed roads'); fail++}
for (const path of tw.ROUTES) {
  const a = path[0], b = path[path.length - 1];
  if (!roadConnected(tw, a, b)) {console.error(`FAIL: routed road ${a} -> ${b} is not continuous`); fail++}
}
// the first route starts west of the brook and ends east of it, so it must have bridged
const first = tw.ROUTES[0], brook = tw.curves.brook;
if (first) {
  const crossed = first[0][0] < brook(first[0][1]) && first[first.length - 1][0] >= brook(first[first.length - 1][1]);
  const bridged = first.some(([x, y]) => tw.tiles[tw.I(x, y)] === BRIDGE);
  if (!crossed || !bridged) {console.error('FAIL: Testworld road from the town did not bridge the brook'); fail++}
  else console.log(`  bridge check: route 1 crosses the brook over ${first.filter(([x, y]) => tw.tiles[tw.I(x, y)] === BRIDGE).length} bridge tile(s)`);
}
// ---- every world of WORLDS (epic #940): the same checks, a row in world-snapshots.mjs each ----
// #934: a company that starts at a home town must not find a region far above it next door. Two regions are neighbours where their
// tiles touch (8-neighbour). From every town the regions are walked outward; each step to a neighbour that is no nearer the town may
// raise the low band by at most spec.ladder.step levels. Returns [{town, from, to, up}] for every step that breaks it.
function ladderBreaks(w, step) {
  const R = w.REGIONS.length, adj = Array.from({length: R}, () => new Set());
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {const a = w.zone[w.I(x, y)];
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {const nx = x + dx, ny = y + dy; if (nx >= w.w || ny < 0 || ny >= w.h) continue;
      const b = w.zone[w.I(nx, ny)]; if (a !== b) {adj[a].add(b); adj[b].add(a)}}}
  const out = [];
  for (const c of w.CITY) {const home = w.zoneAt(c.gate.x, c.gate.y), depth = new Array(R).fill(-1); depth[home] = 0;
    const q = [home]; while (q.length) {const a = q.shift(); for (const b of adj[a]) if (depth[b] < 0) {depth[b] = depth[a] + 1; q.push(b)}}
    for (let a = 0; a < R; a++) for (const b of adj[a]) if (depth[a] >= 0 && depth[b] >= depth[a]) {
      const up = w.REGIONS[b].band[0] - w.REGIONS[a].band[0]; if (up > step) out.push({town: c.name, from: w.REGIONS[a].name, to: w.REGIONS[b].name, up})}}
  return {breaks: out, adj};
}
function restFaults(id, spec) {
  const towns = spec.towns || [], out = [];
  if (!towns.length) out.push(id + ' has no town to rest in');
  else if (spec.sides !== 'lore') for (let f = 0; f < FAC.length; f++) if (!towns.some(t => t.fac === f)) out.push(id + ' has no town the ' + FAC[f].name + ' may rest in (give it one, or set sides: lore)');
  return out;
}
for (const [id, spec] of Object.entries(WORLDS)) {
  const w = buildWorld(spec), tag = id + ' (' + w.name + ')', snap = SNAPSHOTS[id];
  if (id !== 'eldmoor') report(spec); // Eldmoor was reported above
  if (!snap) {console.error(`FAIL: ${tag} has no row in scripts/world-snapshots.mjs`); fail++}
  else {
    if (fnv(w.zone) !== snap.zone) {console.error(`FAIL: ${tag} zone array hash ${fnv(w.zone)} != snapshot ${snap.zone}`); fail++}
    if (fnv(w.tiles) !== snap.tiles) {console.error(`FAIL: ${tag} tile array hash ${fnv(w.tiles)} != snapshot ${snap.tiles}`); fail++}
    for (let z = 0; z < w.ZONES.length; z++) if (w.ZPTS[z].length < snap.minSpawn) {console.error(`FAIL: ${tag} region ${w.ZONES[z]} has ${w.ZPTS[z].length} spawn points (< ${snap.minSpawn})`); fail++}
  }
  for (const path of w.ROUTES) {const a = path[0], b = path[path.length - 1];
    if (!roadConnected(w, a, b)) {console.error(`FAIL: ${tag} routed road ${a} -> ${b} is not continuous`); fail++}}
  { // every town gate reaches every other over walkable tiles (flood fill from the first gate)
    const key = (x, y) => y * w.w + x, seen = new Uint8Array(w.w * w.h), q = [];
    const g0 = w.CITY[0].gate; q.push([Math.floor(g0.x), Math.floor(g0.y)]); seen[key(q[0][0], q[0][1])] = 1;
    while (q.length) {const [x, y] = q.pop();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h || seen[key(nx, ny)]) continue;
        const t = w.tiles[w.I(nx, ny)]; if (WALKABLE.indexOf(t) < 0 && t !== BRIDGE) continue;
        if (dx && dy && (w.tiles[w.I(x, ny)] === RIVER && w.tiles[w.I(nx, y)] === RIVER)) continue;
        seen[key(nx, ny)] = 1; q.push([nx, ny])}}
    for (const c of w.CITY) if (!seen[key(Math.floor(c.gate.x), Math.floor(c.gate.y))]) {console.error(`FAIL: ${tag} town ${c.name} is not reachable from ${w.CITY[0].name}`); fail++}
    for (const l of w.LANDMARKS) if (!seen[key(Math.floor(l.x), Math.floor(l.y))] && !(l.kind === 'lair') && !l.mouth) {console.error(`FAIL: ${tag} landmark ${l.name} is not reachable`); fail++}
    console.log(`  ${id} reachability: ${w.CITY.map(c => c.name).join(', ')} all connected by walkable tiles`);
  }
  { // the road net joins the towns: every gate is within 3 tiles of a road tile reachable from the first gate along roads
    const near = c => {const gx = Math.floor(c.gate.x), gy = Math.floor(c.gate.y);
      for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {const t = w.tiles[w.I(gx + dx, gy + dy)]; if (t === ROAD) return [gx + dx, gy + dy]} return null};
    const a = near(w.CITY[0]); for (const c of w.CITY) {const b = near(c); if (!a || !b || !roadConnected(w, a, b)) {console.error(`FAIL: ${tag} has no continuous road from ${w.CITY[0].name} to ${c.name}`); fail++}}
  }
  // #715: a world whose towns name a people has its own home town for every people (homeOf picks the town whose race matches)
  if (w.CITY.some(c => c.race)) {
    for (const r of RACES) {const t = w.CITY.find(c => c.race === r.id);
      const named = w.CITY.find(c => c.name === r.home); // a town of the canonical name must be that people's; elsewhere any town of the people's faction will do
      if (w.CITY.length >= RACES.length && (!t || t.fac !== r.fac || (named && named !== t))) {console.error(`FAIL: ${tag} has no home town for ${r.name} (${t ? t.name : 'none'})`); fail++}}
    console.log(`  ${id} homes: ` + RACES.map(r => r.id + '@' + (w.CITY.find(c => c.race === r.id) || {}).name).join(', '));
  }
  // every spawn point is on a walkable tile
  for (const L of w.ZPTS) for (const p of L) if (WALKABLE.indexOf(w.tileAt(p.x, p.y)) < 0) {console.error(`FAIL: ${tag} spawn point ${p.x},${p.y} is not walkable`); fail++; break}
  if (spec.ladder) { // a world with a ladder in its spec is held to the first-ten-levels rule
  const {breaks} = ladderBreaks(w, spec.ladder.step);
  if (breaks.length) {for (const b of breaks.slice(0, 8)) console.error(`FAIL: ${tag}: from ${b.town}, ${b.from} -> ${b.to} raises the low band by ${b.up} (> ${spec.ladder.step})`); fail++}
  else console.log(`  ${id} ladder: from every town each neighbouring region raises the low band by at most ${spec.ladder.step}`);
  { // the rule is real: a doctored copy with one region lifted far above its neighbours must be caught
    const bad = buildWorld({...spec, regions: spec.regions.map((r, i) => i === 1 ? {...r, band: [r.band[0] + spec.ladder.step + 3, r.band[1] + spec.ladder.step + 3]} : r)});
    if (!ladderBreaks(bad, spec.ladder.step).breaks.length) {console.error(`FAIL: ${tag}: the ladder check missed a region lifted ${spec.ladder.step + 3} levels`); fail++}
  }
  }
  // town plans (epic #940 slice C): a spec town's own buildings keep the art kit's footprints and doors, rise only over the wall or another
  // building, and stay inside their walls (the LPC cutter, scripts/art/packcut-buildings.mjs, cuts one shape per style and kit row).
  // Held for every town of every world whose spec gives it buildings.
  for (const c of w.CITY) {
    if (!(spec.towns.find(t => t.name === c.name) || {}).buildings) continue;
    const at = (x, y) => c.buildings.some(b => x >= b.box[0] && x < b.box[0] + b.box[2] && y >= b.box[1] && y < b.box[1] + b.box[3]);
    for (const b of c.buildings) {const k = TOWN_KIT[b.kit], [bx, by, bw, bh] = b.box;
      if (!k || bw !== k.foot[0] || bh !== k.foot[1] || b.door[0] - bx !== k.door[0] || b.door[1] - by !== k.door[1]) {console.error(`FAIL: ${tag} ${c.name}: ${b.piece} does not keep the kit's footprint and door`); fail++}
      if (bx <= c.x0 || by <= c.y0 || bx + bw - 1 >= c.x1 || by + bh - 1 >= c.y1) {console.error(`FAIL: ${tag} ${c.name}: ${b.piece} is not inside the walls`); fail++}
      if (k) for (let j = 1; j <= k.rise; j++) for (let i = 0; i < bw; i++) if (by - j > c.y0 && !at(bx + i, by - j)) {console.error(`FAIL: ${tag} ${c.name}: ${b.piece} would rise over walkable ground at ${bx + i},${by - j}`); fail++}}
  }
  const onMain = (x, y) => w.land[w.I(Math.floor(x), Math.floor(y))] === w.mainLand;
  for (const c of w.CITY) if (!onMain(c.gate.x, c.gate.y)) {console.error(`FAIL: ${tag} town ${c.name} is not on the main land`); fail++}
  for (const l of w.LANDMARKS) {const m = l.mouth, px = m ? m.x0 - 1 : l.x - l.r - 1, py = m ? m.y1 + 2 : l.y;
    let reach = false; for (let dy = -3; dy <= 3 && !reach; dy++) for (let dx = -3; dx <= 3; dx++) if (onMain(px + dx, py + dy)) {reach = true; break}
    if (!reach) {console.error(`FAIL: ${tag} landmark ${l.name} cannot be reached over open ground`); fail++}}
  for (const o of w.OUTPOSTS) if (!onMain(o.x, o.y)) {console.error(`FAIL: ${tag} outpost ${o.name} is not on the main land`); fail++}
  if (spec.river) {let open = 0; for (const i of w.fords) open++; console.log(`  ${id} river crossings: ${new Set(w.ROUTES.flat().filter(([x, y]) => w.tiles[w.I(x, y)] === BRIDGE).map(([x]) => Math.round(x / 4))).size} bridge span(s), ${(spec.river.fords || []).length} ford(s), ${open} open ford tiles`)}
  const dungeons = w.LANDMARKS.filter(l => l.kind === 'crypt'); if (spec.ladder && !spec.chapter && !dungeons.some(l => (l.rooms || []).length >= 5)) {console.error(`FAIL: ${tag} has no great dungeon (5+ rooms)`); fail++}
  const names = [...w.CITY.map(c => c.name), ...w.LANDMARKS.map(l => l.name), ...w.ZONES]; if (new Set(names).size !== names.length) {console.error(`FAIL: ${tag} repeats a place name`); fail++}
  for (const b of restFaults(id, spec)) {console.error('FAIL: ' + b); fail++}
  if (spec.river && spec.river.closed && (w.fords.length || w.tiles.includes(BRIDGE))) {console.error(`FAIL: ${tag}: a closed river has a crossing`); fail++}
  // a town's own delve (#1013): on the map's main land, on open ground, with a road ending beside it that joins the gate, in a band a green company can stand
  for (const c of w.CITY) if (c.delve) {const dx = Math.floor(c.delve.x), dy = Math.floor(c.delve.y), band = w.REGIONS[w.zoneAt(c.delve.x, c.delve.y)].band;
    if (!onMain(c.delve.x, c.delve.y) || w.solid[w.I(dx, dy)] || w.solid[w.I(dx, dy + 1)]) {console.error(`FAIL: ${tag} ${c.name}'s delve does not stand on open main land`); fail++}
    let end = null; for (let j = -3; j <= 3 && !end; j++) for (let i = -3; i <= 3; i++) if (w.tiles[w.I(dx + i, dy + j)] === ROAD) {end = [dx + i, dy + j]; break}
    const gx = Math.floor(c.gate.x), gy = Math.floor(c.gate.y); let g0 = null; for (let r = 0; r <= 3 && !g0; r++) for (let j = -r; j <= r && !g0; j++) for (let i = -r; i <= r; i++) if (w.tiles[w.I(gx + i, gy + j)] === ROAD) {g0 = [gx + i, gy + j]; break}
    if (!end || !g0 || !roadConnected(w, g0, end)) {console.error(`FAIL: ${tag} no road runs from ${c.name}'s gate to its delve`); fail++}
    if (band[0] > 3) {console.error(`FAIL: ${tag} ${c.name}'s delve stands in a band above a green company`); fail++}
    console.log(`  ${id} delve: ${c.name}'s stands ${Math.round(Math.hypot(c.delve.x - c.gate.x, c.delve.y - c.gate.y))} tiles from the gate, at a road's end`)}
}
// every canon map has a town a company can rest in (#1013 review point 3): any company of any people, wherever it comes from. A map with sides as lore opens every
// town to everyone, so one town will do; otherwise each faction needs a town of its own, because homeOf ends in the first town of the map and ownTown would shut it out.
{
  const bad = restFaults('hollin', {...WORLDS.hollin, sides: undefined}), none = restFaults('x', {name: 'x', towns: [], sides: 'lore'});
  if (!bad.length || !none.length) {console.error('FAIL: the rest check missed a doctored map'); fail++}
  console.log('  rest: every map of WORLDS has a town each company may rest in');
}
// ---- linked maps (#1013 slice 1a): exits are data on every map of MAPS (the worlds and the TESTLINK fixtures) ----
// Each exit stands on walkable road (a road or bridge tile at its spot, on an edge exit all of its stretch), is joined to a town by
// road, names a map and an exit that exist, and the far exit names this one back. MAPS is looped over, never counted. A link
// fixture is never in WORLDS.
function exitFaults(maps) {
  const bad = [], built = {};
  for (const [id, spec] of Object.entries(maps)) built[id] = buildWorld(spec);
  for (const [id, w] of Object.entries(built)) {
    const ids = w.EXITS.map(e => e.id);
    if (new Set(ids).size !== ids.length) bad.push(id + ' repeats an exit id');
    for (const e of w.EXITS) {
      const tag = id + ' exit ' + e.id;
      const open = e.to && e.to.map == null; // to:{map:null, heard}: a road whose far side is not built, refused in words in play (sim/roads.js)
      if (open && (!e.name || !e.to.heard)) {bad.push(tag + ' goes nowhere yet: it needs a name and the words `heard`'); continue}
      if (open && maps[id].final) {bad.push(tag + ' goes nowhere, on a map marked final'); continue}
      if (!open && (!e.name || !e.to || !e.to.map || !e.to.exit)) {bad.push(tag + ' needs a name and a destination {map, exit}'); continue}
      const cells = e.edge ? Array.from({length: e.edge.to - e.edge.from + 1}, (_, k) => e.edge.side === 'N' ? [e.edge.from + k, 0] : e.edge.side === 'S' ? [e.edge.from + k, w.h - 1] : e.edge.side === 'W' ? [0, e.edge.from + k] : [w.w - 1, e.edge.from + k]) : [[Math.floor(e.x), Math.floor(e.y)]];
      for (const [x, y] of cells) {const t = w.tiles[w.I(x, y)]; if (t !== ROAD && t !== BRIDGE) {bad.push(tag + ' does not stand on road at ' + x + ',' + y); break}}
      const cx = Math.min(w.w - 1, Math.floor(e.x)), cy = Math.min(w.h - 1, Math.floor(e.y));
      if (!w.CITY.some(c => roadConnected(w, [Math.floor(c.gate.x), Math.floor(c.gate.y)], [cx, cy]))) bad.push(tag + ' is not joined to a town by road');
      if (open) continue;
      const far = built[e.to.map]; if (!far) {bad.push(tag + ' leads to a map that does not exist: ' + e.to.map); continue}
      const back = far.EXITS.find(f => f.id === e.to.exit);
      if (!back) bad.push(tag + ' leads to ' + e.to.map + ' exit ' + e.to.exit + ', which does not exist');
      else if (back.to.map !== id || back.to.exit !== e.id) bad.push(tag + ' and ' + e.to.map + ' ' + back.id + ' do not name each other');
    }
  }
  return bad;
}
{
  for (const b of exitFaults(MAPS)) {console.error('FAIL: ' + b); fail++}
  const n = Object.values(MAPS).reduce((a, sp) => a + (sp.exits || []).length, 0);
  console.log('  exits: ' + n + ' exit(s) over ' + Object.keys(MAPS).length + ' maps, all on road and linked both ways');
  if (Object.keys({...TESTLINK, ...TESTBARE}).some(k => WORLDS[k])) {console.error('FAIL: a test fixture is in WORLDS'); fail++}
  const a = TESTLINK.testlinka, b = TESTLINK.testlinkb;
  const doctored = [
    {...MAPS, testlinka: {...a, exits: [{...a.exits[0], to: {map: 'nowhere', exit: 'x'}}]}},
    {...MAPS, testlinka: {...a, exits: [{...a.exits[0], to: {map: 'testlinkb', exit: 'nope'}}]}},
    {...MAPS, testlinkb: {...b, exits: [{...b.exits[0], to: {map: 'testlinka', exit: 'zzz'}}, ...b.exits.slice(1)]}},
    {...MAPS, testlinka: {...a, roads: [], exits: [{...a.exits[0], edge: undefined, at: {x: 20.5, y: 5.5, r: 2}}]}},
    {...MAPS, testlinka: {...a, exits: [{...a.exits[0], to: {map: null}}]}},
    {...MAPS, testlinka: {...a, final: true, exits: [{...a.exits[0], to: {map: null, heard: 'lands not yet seen'}}]}},
  ];
  doctored.forEach((m, i) => {if (!exitFaults(m).length) {console.error('FAIL: the exit check missed doctored case ' + (i + 1)); fail++}});
  // setWorld swaps every live binding and the size, and back (single-map worlds never call it)
  const M = await import('../src/world/map.js'), T = await import('../src/world/tiles.js');
  const id0 = M.MAP_ID, w0 = T.W, n0 = M.CITY.length;
  M.setWorld('testlinka');
  if (M.MAP_ID !== 'testlinka' || T.W !== 32 || M.CITY[0].name !== 'Hearthlink' || M.EXITS.length !== 1 || M.tiles.length !== 32 * 24) {console.error('FAIL: setWorld did not swap the live bindings'); fail++}
  M.setWorld(id0);
  if (M.MAP_ID !== id0 || T.W !== w0 || M.CITY.length !== n0 || M.WORLD_ID !== id0) {console.error('FAIL: setWorld did not swap back'); fail++}
  let threw = false; try {M.setWorld('nowhere')} catch (e) {threw = true} if (!threw) {console.error('FAIL: setWorld accepted an unknown map'); fail++}
  console.log('  setWorld: linka and back, live bindings follow');
}
console.log(fail ? `\n${fail} check(s) failed` : '\nworldcheck: all checks passed');
process.exit(fail ? 1 : 0);
