// World generator check: builds every spec headlessly, prints per-zone tile
// histograms, road tile counts and spawn-point counts, proves that routed
// roads bridge rivers, and fails if the ELDMOOR map drifted from its snapshot.
// Usage: npm run worldcheck
// If you changed the Eldmoor map on purpose, paste the new hashes into SNAPSHOT.
import {ELDMOOR, TESTWORLD, STEPPING} from '../src/world/spec.js';
import {buildWorld} from '../src/world/gen.js';
import {ROAD, BRIDGE, RIVER, WALKABLE} from '../src/world/tiles.js';

// FNV-1a of the zone and tile arrays of the Eldmoor map as of the spec rewrite.
const SNAPSHOT = {zone: '7d08ac18', tiles: 'bda9e97b'};
// Same for the Stepping Lands (160x100). Update when the STEPPING spec or the generator changes on purpose.
const SNAPSHOT_STEPPING = {zone: '1089eab4', tiles: 'cfab7241'};
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
const eld = report(ELDMOOR);
const zh = fnv(eld.zone), th = fnv(eld.tiles);
if (zh !== SNAPSHOT.zone) {console.error(`FAIL: Eldmoor zone array hash ${zh} != snapshot ${SNAPSHOT.zone}`); fail++}
if (th !== SNAPSHOT.tiles) {console.error(`FAIL: Eldmoor tile array hash ${th} != snapshot ${SNAPSHOT.tiles}`); fail++}
for (let z = 0; z < eld.ZONES.length; z++) if (!eld.ZPTS[z].length) {console.error(`FAIL: Eldmoor region ${eld.ZONES[z]} has no spawn points`); fail++}

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
// the Stepping Lands: snapshot, spawn points in every region, routed roads continuous, towns reachable
const st = report(STEPPING);
if (fnv(st.zone) !== SNAPSHOT_STEPPING.zone) {console.error(`FAIL: Stepping zone array hash ${fnv(st.zone)} != snapshot ${SNAPSHOT_STEPPING.zone}`); fail++}
if (fnv(st.tiles) !== SNAPSHOT_STEPPING.tiles) {console.error(`FAIL: Stepping tile array hash ${fnv(st.tiles)} != snapshot ${SNAPSHOT_STEPPING.tiles}`); fail++}
for (let z = 0; z < st.ZONES.length; z++) if (st.ZPTS[z].length < 200) {console.error(`FAIL: Stepping region ${st.ZONES[z]} has ${st.ZPTS[z].length} spawn points`); fail++}
for (const path of st.ROUTES) {const a = path[0], b = path[path.length - 1];
  if (!roadConnected(st, a, b)) {console.error(`FAIL: Stepping routed road ${a} -> ${b} is not continuous`); fail++}}
{ // every town gate reaches every other over walkable tiles (flood fill from the first gate)
  const key = (x, y) => y * st.w + x, seen = new Uint8Array(st.w * st.h), q = [];
  const g0 = st.CITY[0].gate; q.push([Math.floor(g0.x), Math.floor(g0.y)]); seen[key(q[0][0], q[0][1])] = 1;
  while (q.length) {const [x, y] = q.pop();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= st.w || ny >= st.h || seen[key(nx, ny)]) continue;
      const t = st.tiles[st.I(nx, ny)]; if (WALKABLE.indexOf(t) < 0 && t !== BRIDGE) continue;
      if (dx && dy && (st.tiles[st.I(x, ny)] === RIVER && st.tiles[st.I(nx, y)] === RIVER)) continue;
      seen[key(nx, ny)] = 1; q.push([nx, ny])}}
  for (const c of st.CITY) if (!seen[key(Math.floor(c.gate.x), Math.floor(c.gate.y))]) {console.error(`FAIL: Stepping town ${c.name} is not reachable from ${st.CITY[0].name}`); fail++}
  for (const l of st.LANDMARKS) if (!seen[key(Math.floor(l.x), Math.floor(l.y))] && !(l.kind === 'lair')) {console.error(`FAIL: Stepping landmark ${l.name} is not reachable`); fail++}
  console.log('  stepping reachability: ' + st.CITY.map(c => c.name).join(', ') + ' all connected by walkable tiles');
}
// the road net joins the towns: every gate is within 3 tiles of a road tile reachable from the first gate along roads
{ const reach = (a, b) => roadConnected(st, a, b); const near = c => {const gx = Math.floor(c.gate.x), gy = Math.floor(c.gate.y);
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {const t = st.tiles[st.I(gx + dx, gy + dy)]; if (t === ROAD) return [gx + dx, gy + dy]} return null};
  const a = near(st.CITY[0]); for (const c of st.CITY) {const b = near(c); if (!a || !b || !reach(a, b)) {console.error(`FAIL: no continuous road from ${st.CITY[0].name} to ${c.name}`); fail++}} }

// every spawn point is on a walkable tile
for (const w of [eld, tw, st]) for (const L of w.ZPTS) for (const p of L) if (WALKABLE.indexOf(w.tileAt(p.x, p.y)) < 0) {console.error(`FAIL: ${w.name} spawn point ${p.x},${p.y} is not walkable`); fail++; break}

console.log(fail ? `\n${fail} check(s) failed` : '\nworldcheck: all checks passed');
process.exit(fail ? 1 : 0);
