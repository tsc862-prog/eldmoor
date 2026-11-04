// Road traffic check (#796, slice 5 of the solid-world epic #791): carts, travellers and guard patrols.
//   net       stops and routes come from the map and every route tile is road or bridge, open and next to the last
//   walking   walkers stay on road tiles every step, set out only by the schedule, within the cap, and never fight
//   guards    gate and bridge posts, on their beat by shift, off it out of hours
//   goods     an arriving cart of a traded good adds a little supply, and the price barely moves
//   word      a rumour leaves with a cart, reaches the next town, and is heard on the road by an agent hero in reach
//   beset     a wandering creature stops one; killing it is a rescue, its leaving lets the walker go on, alone it may be lost
//   staged    the DM's ambush near "traffic:<n>" stops the cart under the same caps; its end settles it; the rescue hook stays
//             silent without a host, and with one it goes through stageScene and its limits
//   look      on_the_road and the turn header: in words, inside sight only, not from inside a town, no numbers but the distance
//   seeded    TRAFFIC.MARKET off = a world without traffic, hash for hash; two runs agree; a save goes on as if never saved
//   empty     a world with no others (#780) keeps its traffic
// No model, no network. Usage: npm run trafficcheck. ELDMOOR_WORLD=stepping runs the road checks on the bigger map.
let seed = 0x796aced;
const stub = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
Math.random = stub;

const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, maxHp} = SIM;
const T = await import('../src/sim/traffic.js');
const {TRAFFIC} = T;
const P = await import('../src/sim/player.js');
const PC = await import('../src/sim/pace.js');
const SP = await import('../src/sim/spatial.js');
const DMA = await import('../src/sim/dmagent.js');
const ST = await import('../src/sim/staged.js');
const SLT = await import('../src/sim/company.js');
const L = await import('../src/sim/levers.js');
const {talkText} = await import('./pacing.mjs');
const {tiles, I, CITY, dist, zoneAt} = await import('../src/world/map.js');
const {MOBS} = await import('../src/data/mobs.js');
const {ROAD, BRIDGE, W} = await import('../src/world/tiles.js');
const {solidAt} = await import('../src/world/passable.js');
const {GOODS, price} = await import('../src/data/items.js');
const {CARGO} = await import('../src/data/traffic.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 20; i++) step(1 / 20)};
const onRoad = (x, y) => {const t = tiles[I(Math.floor(x), Math.floor(y))]; return t === ROAD || t === BRIDGE};
const fresh = (o = {fellowship: false}) => {seed = 0x796aced; init(o); run(1)};
// A cart on the road, away from everyone: the next walker out, moved along its route and given a clear road.
const clear = (p, r = 14) => {for (const m of S.mobs) if (dist(m, p) < r) {m.alive = false; m.gone = true}};
const walker = (kind, at = .5) => {for (let i = 0; i < 4000; i++) {const w = S.traffic.list.find(x => x.kind === kind && !x.beset && !x.wait); if (w) {const R = T.trafficRoute(w.from, w.to); w.p = R.length * at; w.scan = 1e6; step(1 / 20); return w} step(1 / 20)} return null};
const park = (a, p) => {a.x = p.x; a.y = p.y; a.state = 'hunt'; a.hidden = false; a.target = null; a.dest = null; a.pq = []; a.hp = maxHp(a)};
const hero = () => S.agents.find(a => a.kind === 'hero' && a.state !== 'dead' && !a.player);

console.log('\nEldmoor trafficcheck: life on the roads (#796)\n');
fresh();

console.log('net');
const stops = T.trafficStops(), townStops = stops.filter(s => s.kind === 'town');
ok(CITY.every(c => stops.some(s => s.name === c.name)), 'every town stands on the road net (' + stops.map(s => s.name).join(', ') + ')');
{let bad = 0, n = 0;
  for (const a of stops) for (const b of stops) {if (a === b) continue; const R = T.trafficRoute(a.name, b.name); if (!R) continue; n++;
    R.forEach((t, i) => {const x = t % W, y = (t - x) / W; if (!onRoad(x, y) || solidAt(x + .5, y + .5)) bad++; if (i) {const p = R[i - 1], px = p % W, py = (p - px) / W; if (Math.max(Math.abs(px - x), Math.abs(py - y)) !== 1) bad++}})}
  ok(n >= 2 && !bad, n + ' routes, every tile road or bridge, open, each step to the next tile')}
ok(!stops.some(s => s.name === 'Kragmaw'), 'nobody takes the road to a wyrm for choice');
const posts = T.trafficPosts();
ok(posts.some(p => p.kind === 'gate') && posts.every(p => p.beat.every(t => {const x = t % W, y = (t - x) / W; return onRoad(x, y)})), 'guard posts: ' + posts.map(p => p.key).join(', ') + ', beats all on the road');
ok(posts.filter(p => p.kind === 'gate').length === townStops.length, 'a post at every town gate on the net');
if (process.env.ELDMOOR_WORLD !== 'stepping') ok(posts.some(p => p.kind === 'bridge'), 'bridges have posts');

console.log('walking');
{let off = 0, over = 0, nightSet = 0, seenN = 0, seq = S.traffic.seq;
  const mob0 = S.mobs.length;
  for (let i = 0; i < 240 * 20 * 2; i++) {step(1 / 20); const Tf = S.traffic;
    if (Tf.seq !== seq) {const h = Math.floor(S.gameMin / 60) % 24; if (h < TRAFFIC.DAY[0] || h >= TRAFFIC.DAY[1]) nightSet++; seq = Tf.seq}
    if (Tf.list.length > T.trafficCap()) over++; seenN = Math.max(seenN, Tf.list.length);
    for (const w of Tf.list) if (!onRoad(w.x, w.y)) off++}
  ok(!off, 'two game days: nobody ever stepped off the road'); ok(!over && seenN > 1, 'at most ' + T.trafficCap() + ' on the roads (peak ' + seenN + ')'); ok(!nightSet, 'nobody sets out at night');
  ok(S.traffic.stats.departed >= 6 && S.traffic.stats.arrived > 0, S.traffic.stats.departed + ' set out, ' + S.traffic.stats.arrived + ' arrived');
  ok(S.traffic.list.every(w => w.hp == null && w.lvl == null && w.kind !== 'hero' && w.kind !== 'mob'), 'no walker has HP or a level: nothing can fight them, and they fight nothing');
  ok(mob0 <= S.mobs.length + 30, 'mobs not touched')}

console.log('guards');
{const at = h => {S.gameMin = Math.floor(S.gameMin / 1440) * 1440 + 1440 + h * 60; run(1)};
  at(12); const day = S.traffic.guards.filter(g => g.on); at(23); const night = S.traffic.guards.filter(g => g.on);
  ok(day.length > night.length && night.length > 0, day.length + ' on watch by day, ' + night.length + ' by night');
  ok(night.every(g => g.post.startsWith('gate:')), 'only the gates keep a night watch');
  at(12); const g = S.traffic.guards.find(x => x.on), x0 = g.x, y0 = g.y; run(3);
  ok(g.moving && (g.x !== x0 || g.y !== y0) && onRoad(g.x, g.y), 'a guard walks the beat, on the road')}

console.log('goods');
{fresh(); const row = CARGO.find(c => c.good), w = walker('cart'); w.word = row.word; w.good = row.good; const R = T.trafficRoute(w.from, w.to);
  const dest = stops.find(s => s.name === w.to);
  if (dest.kind === 'town') {GOODS[row.good].supply = 8; const p0 = price(row.good), s0 = GOODS[row.good].supply; w.p = R.length - 1.01; step(.1); const s1 = GOODS[row.good].supply, p1 = price(row.good);
    ok(s1 > s0 + TRAFFIC.SUPPLY * .9 && !S.traffic.list.includes(w), 'an arriving ' + row.word + ' cart adds to the auction house (' + s0.toFixed(1) + ' -> ' + s1.toFixed(1) + ')');
    ok(p1 <= p0 && (p0 - p1) / p0 < .1, 'the price effect is small (' + p0 + 'g -> ' + p1 + 'g)')}
  ok(CARGO.every(c => !c.good || GOODS[c.good]), 'every traded load is a row of the auction house')}

console.log('word');
if (townStops.length > 1) {fresh(); for (const c of CITY) void c;
  const R0 = L.pull('seed_rumour', {town: townStops[0].name, text: 'The ford at the old mill runs with blood at dusk.', days: 5}, {by: 'dm-agent', reason: 'check'});
  ok(R0.ok, 'a rumour is seeded in ' + townStops[0].name);
  const r = R0.ret; let w = null;
  for (let i = 0; i < 2000 * 20 && !w; i++) {step(1 / 20); w = S.traffic.list.find(x => x.from === townStops[0].name && x.news.includes(r.id) && stops.find(s => s.name === x.to).kind === 'town')}
  ok(!!w, 'a walker sets out with the word');
  clear(w); const A = hero(); P.markPlayer(A, true); const Rt = T.trafficRoute(w.from, w.to); w.p = Rt.length * .5; step(1 / 20); park(A, {x: w.x + 1, y: w.y}); w.scan = 0; step(1 / 20);
  ok((A.playEv || []).some(e => /blood at dusk/.test(e.text)) && r.heard[A.id] != null, 'an agent hero it passes hears the word on the road');
  const n = (A.playEv || []).filter(e => /blood at dusk/.test(e.text)).length; w.scan = 0; step(1 / 20);
  ok((A.playEv || []).filter(e => /blood at dusk/.test(e.text)).length === n, 'and only once a game day');
  w.beset = null; w.p = Rt.length - 1.01; step(.1);
  ok(r.towns.includes(w.to) && S.traffic.stats.news >= 1, 'on arrival ' + w.to + ' has the word too');
  P.markPlayer(A, false)}

console.log('beset');
{fresh(); const w = walker('cart'), A = hero(); clear(w); P.markPlayer(A, true); w.scan = 1e6; park(A, {x: w.x + 3, y: w.y});
  const m = S.mobs.find(x => x.alive && !x.gone && !x.elite); m.x = w.x + .5; m.y = w.y; m.home = {x: m.x, y: m.y}; m.spawn = {...m.home}; m.target = null; m.dest = null; SP.rebuild();
  const keep = TRAFFIC.BESET_P; TRAFFIC.BESET_P = 2; for (const g of S.traffic.guards) g.on = false; const px = w.x; w.scan = 0; step(1 / 20); TRAFFIC.BESET_P = keep;
  if (!w.beset) {console.error('  FAIL a creature stops the cart'); fail++}
  else {ok(w.beset.mob === m.id && !w.moving, 'a wandering creature stops the cart');
    ok((A.playEv || []).some(e => /has stopped/.test(e.text) && /cart/.test(e.text)), 'the agent hero in sight is told');
    ok(!/\bL\d|level/i.test((A.playEv || []).map(e => e.text).join(' ')), 'in words, no level');
    ok(m.target == null, 'the creature itself is not touched');
    const line = T.roadSight(A); ok(line.some(l => /standstill, set upon by/.test(l)), 'look reads it: ' + line[0]);
    step(1); ok(Math.abs(w.x - px) < .6, 'it stands while beset');
    const g0 = A.gold; m.alive = false; m.respawn = 60; run(2); ok(!w.beset && S.traffic.stats.rescued === 1 && A.gold > g0, 'the creature slain by a hero near: a rescue, and the carter pays ' + (A.gold - g0) + 'g');
    ok((A.playEv || []).some(e => /thanks you/.test(e.text)), 'and thanks them')}
  P.markPlayer(A, false)}
{fresh(); const w = walker('traveller'), T0 = S.traffic; clear(w); w.scan = 1e6; const m = S.mobs.find(x => x.alive && !x.gone); T.besetBy(w, {mob: m.id, foe: 'a wolf'}); m.x = w.x + 10; m.y = w.y; m.home = {x: m.x, y: m.y}; run(2);
  ok(!w.beset && T0.list.includes(w), 'a creature that wanders off lets the traveller go on');
  const w2 = walker('cart'); clear(w2); w2.scan = 1e6; const m2 = S.mobs.find(x => x.alive && !x.gone); T.besetBy(w2, {mob: m2.id, foe: 'a wolf'}); m2.x = w2.x + 1; m2.y = w2.y; m2.home = {x: m2.x, y: m2.y}; const l0 = T0.stats.lost, f0 = T0.stats.freed; w2.beset.until = S.gameMin; m2.update = 0; for (const a of S.agents) if (dist(a, w2) < 9) a.hidden = true; w2.beset.chk = 0; step(1 / 20);
  ok(T0.stats.lost + T0.stats.freed > l0 + f0, 'left alone to the end: ' + (T0.stats.lost > l0 ? 'lost on the road' : 'it limps on'))}

console.log('staged');
{fresh({}); const F = SLT.slotted(), mem = SLT.slotHeroes(F); DMA.setDmSeat(true); for (const b of mem) b.lvl = 14;
  const w = walker('cart'), lead = mem[0]; clear(w, 20); w.scan = 1e6;
  for (const b of mem) park(b, {x: w.x + 9, y: w.y + 1});
  const r = DMA.dmAct('stage_scene', {kind: 'ambush', near: 'traffic:' + w.n, frame: 'A hard knot of creatures rings the cart in the road ahead.', reason: 'check', cast: {}});
  ok(r.ok || /Refused/.test(r.error), 'stage_scene takes a walker: ' + (r.ok ? r.where : r.error));
  if (r.ok) {ok(w.beset && w.beset.staged === r.staged && !w.moving, 'the cart stops for the staged foe');
    const v = DMA.dmAct('dm_status').road_traffic; ok(v && v.some(x => x.ref === 'traffic:' + w.n && x.beset), 'dm_status shows it, as traffic:' + w.n);
    const again = DMA.dmAct('stage_scene', {kind: 'ambush', near: 'traffic:' + w.n, frame: 'Another knot of creatures rings the cart in the road.', reason: 'check'});
    ok(!again.ok && /already part|one at a time/.test(again.error), 'one staged scene at a time, cart or no cart');
    const G = S.staged, rec = G.cur; ok(rec.traffic === w.id, 'the scene remembers the cart');
    for (const id of rec.cast.mobs) {const m = S.mobs.find(x => x.id === id); m.alive = false}
    rec.until = 0; step(1 / 20); ok(!w.beset && S.traffic.stats.rescued === 1, 'its foes slain, the cart is saved (' + (S.chronicle[0] ? 'chronicled' : '') + ')');
    const w2 = walker('cart'); clear(w2, 20); w2.scan = 1e6; for (const b of mem) park(b, {x: w2.x + 9, y: w2.y + 1});
    const r2 = DMA.dmAct('stage_scene', {kind: 'ambush', near: 'traffic:' + w2.n, frame: 'A hard knot of creatures rings the cart in the road ahead.', reason: 'check'});
    ok(r2.ok, 'a second one');
    if (r2.ok) {const un = ST.unstage(); ok(un.ok && !w2.beset, 'unstaged: the cart goes on')}
    const d = S.staged.day; d.n = ST.STAGE.PER_DAY;
    const w3 = walker('traveller'); clear(w3, 20); for (const b of mem) park(b, {x: w3.x + 9, y: w3.y + 1});
    const r3 = DMA.dmAct('stage_scene', {kind: 'ambush', near: 'traffic:' + w3.n, frame: 'A hard knot of creatures rings the walker in the road ahead.', reason: 'check'});
    ok(!r3.ok && /staged scenes today/.test(r3.error) && !w3.beset, 'the day\'s cap holds for the road too')}
  // the rescue hook: silent with no host; with one, through stageScene
  const hook = () => {const w4 = walker('cart'); clear(w4, 20); w4.scan = 1e6; const b = mem[0]; for (const x of mem) park(x, {x: w4.x + 8, y: w4.y}); const m = S.mobs.find(x => x.alive && !x.gone && !x.elite && MOBS[x.type].z === zoneAt(w4.x, w4.y)); m.x = w4.x + .5; m.y = w4.y; m.home = {x: m.x, y: m.y}; m.target = null; SP.rebuild(); for (const g of S.traffic.guards) g.on = false; const keep = TRAFFIC.BESET_P; TRAFFIC.BESET_P = 2; w4.scan = 0; step(1 / 20); TRAFFIC.BESET_P = keep; return {w: w4, b}};
  S.staged.day.n = 0; S.traffic.day = {d: 0, rescues: 0}; const refused0 = S.staged.stats.refused, st0 = S.traffic.stats.staged;
  const h1 = hook(); ok(h1.w.beset && !h1.w.beset.staged && S.traffic.stats.staged === st0, 'no host with runners: no scene, the world plays on');
  SIM.setRunnerLinks(() => 'connected'); h1.w.beset = null; h1.w.moving = true; S.traffic.day = {d: 0, rescues: 0};
  const h2 = hook(); ok(h2.w.beset && (h2.w.beset.staged != null) && S.traffic.stats.staged === st0 + 1, 'with a host: the rescue is staged where the cart stands');
  const log0 = S.dmLog.find(e => /road stages/.test(JSON.stringify(e.summary || e.parts || e.text || '')));
  ok(!!log0, 'the DM log names it as the road\'s, not the DM agent\'s');
  ok(S.staged.cur && S.staged.cur.until - S.gameMin <= TRAFFIC.RESCUE_MIN + 1, 'and it waits ' + TRAFFIC.RESCUE_MIN + ' game minutes, no more');
  const rf = S.staged.stats.refused, q = ST.stageScene({kind: 'ambush', near: 'fellowship', frame: 'A second knot of creatures bars the road ahead.', reason: 'check'}, {quiet: true});
  ok(!q.ok && /one at a time/.test(q.error) && S.staged.stats.refused === rf, 'one scene at a time: a second offer is refused quietly');
  SIM.setRunnerLinks(null); DMA.setDmSeat(false)}

console.log('look');
{fresh(); const A = hero(); P.markPlayer(A, true); const w = walker('cart'); clear(w); w.scan = 1e6; for (const g of S.traffic.guards) g.on = false;
  park(A, {x: w.x + 2, y: w.y}); let v = P.playerAct(A.id, 'look', {});
  ok(Array.isArray(v.on_the_road) && v.on_the_road.some(l => l.includes(w.word + ' cart heading for ' + w.to)), 'look: ' + (v.on_the_road || [])[0]);
  ok(v.on_the_road.every(l => !/level|\bL\d|\bhp\b/i.test(l)), 'no level, no HP');
  const b = PC.paceBrief(A.id).brief; ok(talkText(b).includes('On the road: ' + (b.road || [])[0]), 'the turn header says so too');
  park(A, {x: w.x + 40, y: w.y}); v = P.playerAct(A.id, 'look', {}); ok(!(v.on_the_road || []).some(l => l.includes('cart')), 'out of sight: not named');
  const c = CITY[0]; park(A, {x: c.spots.square.x, y: c.spots.square.y}); A.state = 'town'; ok(!T.roadSight(A).length, 'not through the walls of a town');
  P.markPlayer(A, false)}

console.log('seeded');
{const digest = () => {let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0}; for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(',')); feed(String(S.uid)); return h};
  const world = (on, market) => {TRAFFIC.ON = on; TRAFFIC.MARKET = market; seed = 0x51ed; init({fellowship: false}); run(240); const d = digest(), t = JSON.stringify(S.traffic && S.traffic.stats); TRAFFIC.ON = true; TRAFFIC.MARKET = true; return {d, t}};
  const none = world(false, false), off = world(true, false), a = world(true, true), b = world(true, true);
  ok(none.d === off.d, 'market off: hash for hash a world without traffic (' + none.d + '), with ' + off.t);
  ok(a.d === b.d && a.t === b.t, 'two runs agree (' + a.d + ')');
    const keepR = TRAFFIC.BESET_R; TRAFFIC.BESET_R = 0; seed = 0x51ed; init({fellowship: false}); run(120); const snap = JSON.parse(JSON.stringify(snapshot())); const s0 = seed; run(60); const t1 = JSON.stringify(S.traffic.list.map(w => [w.id, w.x, w.y])), g1 = S.traffic.seed;
  seed = s0; restore(snap); ok(!!S.traffic && S.traffic.list.length >= 0, 'S.traffic is in the save'); run(60);
  ok(JSON.stringify(S.traffic.list.map(w => [w.id, w.x, w.y])) === t1 && S.traffic.seed === g1, 'a load goes on exactly as if never saved');
  TRAFFIC.BESET_R = keepR; delete S.traffic; run(1); ok(!!S.traffic, 'an old save with no traffic simply starts it')}

console.log('empty');
{seed = 0x51ed; init({fellowship: false, others: 'none'}); run(240); ok(S.traffic.stats.departed > 0, 'a world with no others still has its roads (' + S.traffic.stats.departed + ' set out, ' + S.agents.filter(a => a.state !== 'dead').length + ' heroes)')}

console.log('cost');
{seed = 0x51ed; init({fellowship: false}); run(30); const n = 20000, t0 = performance.now(); for (let i = 0; i < n; i++) T.trafficTick(1 / 20); const ms = (performance.now() - t0) / n; ok(ms < .05, 'a tick costs ' + (ms * 1000).toFixed(1) + ' microseconds')}

console.log(fail ? `\n${fail} check(s) FAILED\n` : '\nall trafficcheck checks passed\n'); process.exit(fail ? 1 : 0);
