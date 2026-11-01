// World generator check: builds every spec headlessly, prints per-zone tile
// histograms, road tile counts and spawn-point counts, proves that routed
// roads bridge rivers, and fails if the ELDMOOR map drifted from its snapshot.
// Usage: npm run worldcheck
// If you changed the Eldmoor map on purpose, paste the new hashes into SNAPSHOT.
import {ELDMOOR, TESTWORLD} from '../src/world/spec.js';
import {buildWorld} from '../src/world/gen.js';
import {ROAD, BRIDGE, RIVER, WALKABLE} from '../src/world/tiles.js';

// FNV-1a of the zone and tile arrays of the Eldmoor map as of the spec rewrite.
const SNAPSHOT = {zone: '7d08ac18', tiles: 'bda9e97b'};
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

let fail = 0;
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
// every spawn point is on a walkable tile
for (const w of [eld, tw]) for (const L of w.ZPTS) for (const p of L) if (WALKABLE.indexOf(w.tileAt(p.x, p.y)) < 0) {console.error(`FAIL: ${w.name} spawn point ${p.x},${p.y} is not walkable`); fail++; break}

console.log(fail ? `\n${fail} check(s) failed` : '\nworldcheck: all checks passed');
process.exit(fail ? 1 : 0);
