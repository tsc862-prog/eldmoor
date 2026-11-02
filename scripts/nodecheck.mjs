// Gathering nodes check (issue #255): placement from spec data in every region of all three specs, bands matching the
// region's level band, nothing on a road, bridge, town, water or landmark, fish on the shore of real river water,
// determinism, the lookups, respawn, the save round trip, and that a world nobody gathers in carries no node state.
// Usage: npm run nodecheck
import {ELDMOOR, TESTWORLD, STEPPING} from '../src/world/spec.js';
import {buildWorld} from '../src/world/gen.js';
import {bandOf, NODE_KINDS} from '../src/world/nodes.js';
import {ROAD, BRIDGE, RIVER, FLOOR, WALL, WALKABLE} from '../src/world/tiles.js';
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor nodecheck\n');

for (const [name, spec] of [['Eldmoor', ELDMOOR], ['Stepping Lands', STEPPING], ['Testworld', TESTWORLD]]) {
  console.log(name);
  const w = buildWorld(spec), N = w.NODES;
  ok(N.length > 0, N.length + ' nodes');
  ok(JSON.stringify(N) === JSON.stringify(buildWorld(spec).NODES), 'placement is deterministic');
  ok(new Set(N.map(n => n.id)).size === N.length, 'ids are unique');
  const pad = (spec.spawn && spec.spawn.townPad) || [4, 3];
  let bad = [];
  for (const n of N) {
    const t = w.tiles[w.I(n.tx, n.ty)];
    const r = w.REGIONS[n.z];
    if (w.zone[w.I(n.tx, n.ty)] !== n.z || r.id !== n.region) bad.push(n.id + ' outside its region');
    if (!WALKABLE.includes(t) || [ROAD, BRIDGE, RIVER, FLOOR, WALL].includes(t)) bad.push(n.id + ' on tile ' + t);
    if (n.band !== bandOf(r.band)) bad.push(n.id + ' band ' + n.band + ' != ' + bandOf(r.band));
    if (!(n.band >= 0 && n.band <= 3) || !NODE_KINDS.includes(n.kind) || !(n.respawn > 0)) bad.push(n.id + ' malformed');
    if (n.x !== n.tx + .5 || n.y !== n.ty + .5) bad.push(n.id + ' not centred on its tile');
    for (const c of w.CITY) if (n.tx >= c.x0 - pad[0] && n.tx <= c.x1 + pad[0] && n.ty >= c.y0 - pad[1] && n.ty <= c.y1 + pad[1]) bad.push(n.id + ' by town ' + c.name);
    for (const l of w.LANDMARKS) if (l.exclude > 0) {
      const cx = l.mouth ? (l.mouth.x0 + l.mouth.x1 + 1) / 2 : l.x, cy = l.mouth ? (l.mouth.y0 + l.mouth.y1 + 1) / 2 : l.y;
      if (Math.hypot(n.x - cx, n.y - cy) < l.exclude) bad.push(n.id + ' by ' + l.name);
    }
    if (n.kind === 'fish') {
      const wt = n.water && w.tiles[w.I(n.water.x, n.water.y)];
      if (wt !== RIVER || Math.abs(n.water.x - n.tx) + Math.abs(n.water.y - n.ty) !== 1) bad.push(n.id + ' fishes no real water');
    } else if (n.water) bad.push(n.id + ' has water but is not a fish node');
  }
  ok(!bad.length, 'every node is in its region, on open ground, band matches the region, off roads/towns/landmarks/water' + (bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''));
  let short = [];
  for (const r of w.REGIONS) {
    const want = (spec.nodes.regions || {})[r.id] || {};
    for (const k of NODE_KINDS) {
      const got = N.filter(n => n.region === r.id && n.kind === k).length;
      if (got !== (want[k] | 0)) short.push(r.id + ' ' + k + ' ' + got + '/' + (want[k] | 0));
    }
  }
  ok(!short.length, 'every region holds the nodes its spec asks for' + (short.length ? ': ' + short.join(', ') : ''));
  const bands = new Set(N.map(n => n.band));
  ok(spec.regions.length < 3 || bands.size >= 3, 'bands climb with the regions: ' + [...bands].sort().join(','));
  ok(N.filter(n => n.kind === 'fish').length > 0 && NODE_KINDS.every(k => N.some(n => n.kind === k)), 'all four kinds are present, fish on river shores');
}

// Spec-less worlds have no nodes and need no spec.nodes
{
  const s = {...TESTWORLD}; delete s.nodes;
  ok(buildWorld(s).NODES.length === 0, 'a spec without nodes places none');
}

// The sim registry
let seed = 0x3a4e5 ^ 11;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore} = SIM;
const NS = await import('../src/sim/nodes.js');
const M = await import('../src/world/map.js');
console.log('Registry');
init({fellowship: false});
ok(NS.NODES === M.NODES && NS.NODES.length > 0 && S.nodes === undefined, 'a world nobody gathers in carries no node state');
const herb = NS.nodesIn(0, 'herb')[0];
ok(herb && NS.nodeById(herb.id) === herb, 'nodesIn and nodeById find a herb patch in zone 0');
const near = NS.nodeNear(herb.x, herb.y, 1);
ok(near[0] === herb && NS.nodeNear(herb.x, herb.y, 30).every((n, i, a) => i === 0 || Math.hypot(a[i - 1].x - herb.x, a[i - 1].y - herb.y) <= Math.hypot(n.x - herb.x, n.y - herb.y)), 'nodeNear is nearest first');
ok(NS.nodeNear(herb.x, herb.y, 30, 'ore').every(n => n.kind === 'ore'), 'nodeNear filters by kind');
ok(NS.isReady(herb) && NS.availableNodes(0, 'herb').length === NS.nodesIn(0, 'herb').length, 'all ready at the start');
const t0 = S.gameMin, h1 = NS.harvest(herb);
ok(h1.ok && Math.abs(h1.readyAt - (t0 + herb.respawn)) < 1e-6 && !NS.isReady(herb), 'a harvested node is spent for its respawn time');
ok(!NS.harvest(herb).ok && NS.readyAt(herb) === h1.readyAt, 'a spent node refuses a second harvest');
ok(!NS.availableNear(herb.x, herb.y, 1).includes(herb), 'a spent node is not offered');
ok(!NS.harvest('nowhere:herb:9').ok, 'an unknown node is refused');
const snap = JSON.parse(JSON.stringify(snapshot()));
S.gameMin = h1.readyAt - 1; ok(!NS.isReady(herb), 'one minute early it is still spent');
S.gameMin = h1.readyAt;     ok(NS.isReady(herb), 'at its time it has grown back');
ok(NS.harvest(herb).ok, 'and can be harvested again');
restore(snap);
ok(!NS.isReady(herb) && NS.readyAt(herb) === h1.readyAt, 'a saved world restores the spent node');
for (let i = 0; i < 60 * 60; i++) step(1 / 60);
ok(S.gameMin < h1.readyAt ? !NS.isReady(herb) : NS.isReady(herb), 'the clock, not a tick, brings it back');
init({fellowship: false});
ok(NS.isReady(herb), 'a new world instance starts with every node ready');
console.log(fail ? '\nnodecheck: ' + fail + ' FAILED' : '\nnodecheck: all checks passed');
process.exit(fail ? 1 : 0);
