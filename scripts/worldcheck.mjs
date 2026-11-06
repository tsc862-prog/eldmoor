// World generator check: builds every spec headlessly, prints per-zone tile
// histograms, road tile counts and spawn-point counts, proves that routed
// roads bridge rivers, and fails if a map drifted from its snapshot. Every world of WORLDS (src/world/spec.js) is held to the same
// checks; a new world needs only a row in scripts/world-snapshots.mjs.
// Usage: npm run worldcheck
// If you changed a map on purpose, paste the new hashes into scripts/world-snapshots.mjs.
import {ELDMOOR, TESTWORLD, STEPPING, WORLDS} from '../src/world/spec.js';
import {buildWorld} from '../src/world/gen.js';
import {RACES} from '../src/data/races.js';
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
  const onMain = (x, y) => w.land[w.I(Math.floor(x), Math.floor(y))] === w.mainLand;
  for (const c of w.CITY) if (!onMain(c.gate.x, c.gate.y)) {console.error(`FAIL: ${tag} town ${c.name} is not on the main land`); fail++}
  for (const l of w.LANDMARKS) {const m = l.mouth, px = m ? m.x0 - 1 : l.x - l.r - 1, py = m ? m.y1 + 2 : l.y;
    let reach = false; for (let dy = -3; dy <= 3 && !reach; dy++) for (let dx = -3; dx <= 3; dx++) if (onMain(px + dx, py + dy)) {reach = true; break}
    if (!reach) {console.error(`FAIL: ${tag} landmark ${l.name} cannot be reached over open ground`); fail++}}
  for (const o of w.OUTPOSTS) if (!onMain(o.x, o.y)) {console.error(`FAIL: ${tag} outpost ${o.name} is not on the main land`); fail++}
  if (spec.river) {let open = 0; for (const i of w.fords) open++; console.log(`  ${id} river crossings: ${new Set(w.ROUTES.flat().filter(([x, y]) => w.tiles[w.I(x, y)] === BRIDGE).map(([x]) => Math.round(x / 4))).size} bridge span(s), ${(spec.river.fords || []).length} ford(s), ${open} open ford tiles`)}
  const dungeons = w.LANDMARKS.filter(l => l.kind === 'crypt'); if (spec.ladder && !dungeons.some(l => (l.rooms || []).length >= 5)) {console.error(`FAIL: ${tag} has no great dungeon (5+ rooms)`); fail++}
  const names = [...w.CITY.map(c => c.name), ...w.LANDMARKS.map(l => l.name), ...w.ZONES]; if (new Set(names).size !== names.length) {console.error(`FAIL: ${tag} repeats a place name`); fail++}
}
console.log(fail ? `\n${fail} check(s) failed` : '\nworldcheck: all checks passed');
process.exit(fail ? 1 : 0);
