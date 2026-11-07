// Open-world positions check (#746, slice 4 of #140's named positions): a Table fight on the real map.
//   - the ground: a patch of GEO.PATCH tiles clamped to the map; solid ground, shots over water, slow tiles, the bank nobody crosses in a
//     round, cover by the tile, the road back and the named things, words with no coordinates
//   - the scene: only with an agent deciding; tiles written to the world; reach, flank, guard, cover, free blows, a rooted hero; a retreat
//     down the road that stays where it got to; a foe brought in from an edge; a save mid-scene; Kragmaw keeps his place in the world
//   - with no agent nothing of this runs, and a forced patch world (FIELD.ALL) repeats on one seed
// Usage: npm run patchcheck   (PATCHCHECK_SEED to vary the world)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const argv = process.argv.slice(2);
let seed = 0x9e3779b9 ^ (Number(process.env.PATCHCHECK_SEED) || 746);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, maxHp} = SIM;
const SLT = await import('../src/sim/company.js');
const T = await import('../src/sim/table.js');
const RL = await import('../src/sim/runlink.js');
const PT = await import('../src/sim/patch.js');
const {GEO} = await import('../src/sim/geometry.js');
const {condOn, setCond} = await import('../src/sim/eff.js');
const {blk} = await import('../src/sim/mobs.js');
const {allScenes} = await import('../src/sim/scenes.js');
const SW = await import('../src/sim/scenewait.js');
const {tiles, I} = await import('../src/world/map.js');
const {W, H, ROAD, BRIDGE, RIVER, SNOW, SWAMP, TREE, ROCK} = await import('../src/world/tiles.js');
const {solidAt, solidWhy} = await import('../src/world/passable.js');

// A child: a world where every Table fight plays on a patch, its hash printed.
if (argv[0] === '--forced') {
  PT.FIELD.ALL = true; init();
  for (let i = 0; i < 60 * 60 * 24; i++) step(1 / 60);
  let h = 0; for (const a of S.agents) h = (Math.imul(h, 31) + Math.round(a.x * 100) + a.hp * 7 + a.lvl) | 0;
  console.log('HASH ' + h + ' scenes:' + ((S.patchStats || {}).scenes || 0)); process.exit(0);
}

let fails = 0, passed = 0;
const ok = (c, m) => {if (c) passed++; else {fails++; console.log('FAIL ' + m)}};
init();
const F = SLT.slotted(), M = F.ids.map(id => S.agents.find(a => a.id === id));
ok(M.length === 5, 'the default Fellowship stands');
const live = on => RL.setRunnerLinks(on ? () => 'connected' : null);
const held = () => allScenes().some(sc => sc.pause && !sc.resolved && sc.phase !== 'outcome' && (SW.framing(sc) || sc.wk && !sc.wk.done));
const settle = () => {let f = 0; while (held() && f < 1200) {step(1 / 60); f++}};
const run = (n = 40) => {for (let i = 0; i < n; i++) step(1 / 60)};

// ---- finding ground ----
// The first patch centre whose every tile passes `test` or whose tiles hold what `want` needs.
function find(want) {for (let y = 6; y < H - 6; y++) for (let x = 6; x < W - 6; x++) if (want(x, y)) return {x: x + .5, y: y + .5}; return null}
const box = (x, y, r, f) => {for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (!f(x + i, y + j)) return false; return true};
const T_ = (x, y) => tiles[I(x, y)];
const bare = (a, b) => !solidAt(a, b) && ![TREE, ROCK, SWAMP, SNOW, RIVER, ROAD, BRIDGE].includes(T_(a, b));
const plain = find((x, y) => box(x, y, 3, bare)); // the map is small and busy: no 9 by 7 of it is bare, so a fight here may still meet a rock or a road
const snow = find((x, y) => box(x, y, 1, (a, b) => T_(a, b) === SNOW && !solidAt(a, b)));
const bridge = find((x, y) => T_(x, y) === BRIDGE);
const river = find((x, y) => solidWhy(x, y) === 'river' && !solidAt(x - 2, y) && !solidAt(x + 2, y) && T_(x - 2, y) !== BRIDGE);
const forest = find((x, y) => solidWhy(x, y) === 'forest');
ok(plain && snow && bridge && river && forest, 'the map has plain, snow, a bridge, a river and a forest core ' + JSON.stringify({plain, snow, bridge, river, forest}));

// ---- the grid alone ----
const P0 = (x, y, fx = x + 2, fy = y) => {const [w, h] = GEO.PATCH, ox = Math.max(0, Math.min(W - w, Math.floor(x) - (w >> 1))), oy = Math.max(0, Math.min(H - h, Math.floor(y) - (h >> 1)));
  const c = (v, m) => Math.max(0, Math.min(m - 1, v));return {ox, oy, w, h, pt: {x: c(Math.floor(x) - ox, w), y: c(Math.floor(y) - oy, h)}, dn: {x: c(Math.floor(fx) - ox, w), y: c(Math.floor(fy) - oy, h)}}};
const scan = want => {for (let y = 4; y < H - 4; y++) for (let x = 5; x < W - 5; x++) {const g = PT.patchGrid(P0(x + .5, y + .5));if (want(g)) return g}return null};
{const g = PT.patchGrid(P0(plain.x, plain.y));
  ok(g.w === 9 && g.h === 7, 'a patch is 9 by 7');
  ok(g.names.includes('stair') && g.spots.stair && g.spots.front && g.spots.flankL && g.spots.flankR && g.spots.back, 'it names the same spots as a room');
  const nr = scan(q => !q.word.stair.startsWith('road') && !q.own.includes('road') && !q.own.includes('bridge'));ok(nr && nr.word.stair === 'way back', 'with no road the way out is the way back');
  const nc = scan(q => !q.cover.some(x => x));if (nc) ok(!nc.spots.cover && !nc.names.includes('cover'), 'bare ground names no cover');
  const c = PT.patchGrid(P0(0, 0)), e = PT.patchGrid(P0(W + 5, H + 5));
  ok(c.ox === 0 && c.oy === 0 && e.ox === W - 9 && e.oy === H - 7, 'a patch is clamped to the map');}
{const g = PT.patchGrid(P0(snow.x, snow.y));
  ok(g.cost[(Math.floor(snow.y) - g.oy) * 9 + Math.floor(snow.x) - g.ox] === PT.FIELD.SLOW, 'snow is a slow tile');
  ok(/slow/.test(g.note), 'the ground says so');}
{const g = PT.patchGrid(P0(bridge.x, bridge.y));let br = false;for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) if (T_(g.ox + x, g.oy + y) === BRIDGE) br = true;
  ok(br && g.own.includes('bridge'), 'a bridge is a spot of its own');
  ok(g.word.stair === 'road back', 'the way back follows the road: ' + g.word.stair);}
{const X = Math.floor(river.x), Y = Math.floor(river.y), g = PT.patchGrid(P0(X - 2, Y, X + 2, Y)), k = (Y - g.oy) * 9 + X - g.ox;
  ok(!g.ok[k] && g.see[k], 'nobody stands on the river, and a shot crosses it');
  ok(/river/i.test(g.note), 'the ground names the bank');
  ok(g.own.includes('bank'), 'the bank is a spot');}
{const X = Math.floor(forest.x), Y = Math.floor(forest.y), g = PT.patchGrid(P0(X - 3, Y, X - 3, Y + 2));let cov = 0, blocks = false;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) {const k = y * 9 + x;if (g.cover[k]) cov++;if (solidWhy(g.ox + x, g.oy + y) === 'forest' && !g.see[k]) blocks = true}
  ok(cov > 0 && blocks, 'trees are cover and a forest core stops a shot');
  ok(g.coverWord === 'trees' && g.names.includes('cover'), 'the cover is named for what it is');}

// ---- a fixture ----
const stand = (at, offs) => M.forEach((a, i) => {const o = offs[i] || [-3, 3];a.x = at.x + o[0];a.y = at.y + o[1];a.state = 'hunt';a.target = null;a.dest = null;a.hidden = false;a.hp = maxHp(a);a.wounds = []});
const beast = (x, y, role) => {const m = S.mobs.find(q => q.alive && !q.gone && !q.elite && !q.used && !q.named && (role ? blk(q).role === role : blk(q).role !== 'caster' && !blk(q).beh?.finishes));
  m.used = true;m.x = x;m.y = y;m.maxhp = 90000;m.hp = 90000;m.cd = 99;m.fledOnce = true;m.target = null;m.dest = null;m.lvl = 1;return m};
const open = (kind, ctx, foeLast = true) => {F.tableSeen = {};const sc = T.openScene(kind, 'Patch test', ['Something moves.'], ctx);if (sc && foeLast) sc.foeAt = sc.ids.length;settle();return sc};
const close = sc => {sc.end = 'yield';live(false);let g = 0;while (allScenes().includes(sc) && g++ < 2400) step(1 / 60);live(true);for (const a of M) {a.state = 'hunt';a.target = null}};
const tileOf = (sc, e, k) => ({x: Math.floor(e.x) - sc.fp.ox, y: Math.floor(e.y) - sc.fp.oy, p: sc.fp.pos[k]});
const beats = (sc, k) => sc.beats.filter(b => b.k === k);
const act = (a, k, move) => {const r = T.sceneAct(a, k, '', move);run();return r};

// no agent: nothing of this
live(false);
{stand(plain, [[-1, 0], [-2, 0], [-1, 1], [-2, 1], [-1, -1]]);const m = beast(plain.x + 1, plain.y);const sc = open('elite', {mob: m.id, hero: M[0].id}, false);
  ok(!S.table || !S.table.fp, 'no agent deciding: no patch');ok(!(S.patchStats && S.patchStats.scenes), 'no agent deciding: no patch scene counted');if (sc && allScenes().includes(sc)) close(sc)}
live(true);

// a fight on open ground
stand(plain, [[-3, 0], [-3, 1], [-3, -1], [-2, 2], [-2, -2]]);
const m1 = beast(plain.x + 3, plain.y);
let sc = open('elite', {mob: m1.id, hero: M[0].id});
ok(sc && sc.fp, 'an agent deciding: the scene freezes a patch');
{const seen = new Set();for (const a of M) {const t = tileOf(sc, a, a.id);ok(t.p && t.x === t.p.x && t.y === t.p.y, a.name + ' stands on its tile in the world');seen.add(t.x + ',' + t.y)}
  ok(seen.size === 5, 'one member a tile');const t = tileOf(sc, m1, 'f' + m1.id);ok(t.p && t.x === t.p.x, 'the foe stands where the sim had it')}
{const v = T.tableView(M[0]);ok(v.room && /(way|road) back/.test(v.room), 'the scene reads the ground in words: ' + v.room);ok(!/\d+,\s*\d+/.test(v.room), 'no coordinates in the words');ok(v.moves && v.moves.some(x => /(way|road) back/.test(x)), 'the moves name the way back');
  ok(v.room.length < 900, 'the words stay short: ' + v.room.length);ok(v.options.some(o => /out of reach/.test(o)), 'the strike says it is out of reach: ' + v.options[0])}
{const cur = S.agents.find(a => a.id === sc.ids[sc.i]);const bad = T.sceneAct(cur, 'strike', '', 'to the moon');ok(typeof bad === 'string' && /Cannot read/.test(bad), 'an unreadable move is refused with the act unsaid');
  // reach: a melee walk that does not get there
  const far = M.find(a => a.cls === 'Warrior' || a.cls === 'Rogue');let g = 0;
  while (S.table === sc && sc.acts[far.id] == null && g++ < 12) {const c = S.agents.find(a => a.id === sc.ids[sc.i]);if (!c) break;T.sceneAct(c, c === far ? 'strike' : 'guard', '');run()}
  const b = sc.beats.find(x => x.id === far.id);ok(b && (/walked toward/.test(b.res) || /d20/.test(b.res)), 'a strike walks first: ' + (b && b.res));
  ok(sc.fp.st.strikes >= 1, 'strikes are counted')}
close(sc);
ok(M.every(a => !solidAt(a.x, a.y)), 'nobody ends on solid ground');

// flank and guard
stand(plain, [[-1, 0], [1, 0], [0, 2], [0, 3], [1, 3]]);
const m2 = beast(plain.x, plain.y);
sc = open('elite', {mob: m2.id, hero: M[0].id});
{const order = sc.ids.map(id => S.agents.find(a => a.id === id));const [p, q] = [M[0], M[1]];let g = 0;
  for (const a of order) {if (a === p || a === q) T.sceneAct(a, 'strike', '');else T.sceneAct(a, 'strike', '', 'stay');run()}
  const R = sc.beats.filter(b => (b.id === p.id || b.id === q.id) && b.roll);ok(R.length >= 1, 'the flankers rolled');
  const base = 3 + Math.floor(p.lvl / 2);ok(R.some(b => b.roll.mod === base + GEO.FLANK), 'two across a foe flank it: ' + R.map(b => b.roll.mod).join() + ' on ' + base);
  ok(sc.fp.st.flanks >= 1, 'flanks are counted')}
close(sc);

// a free blow, and a guard that covers it
stand(plain, [[-1, 0], [-1, 2], [-1, -2], [-2, 3], [-2, -3]]);
const m3 = beast(plain.x, plain.y);
sc = open('elite', {mob: m3.id, hero: M[0].id});
{const a = M[0], order = sc.ids.map(id => S.agents.find(b => b.id === id));const r = T.sceneAct(a, 'strike', '', 'back');ok(r && !r.error && r.moved, 'a move lands with the act: ' + JSON.stringify(r));
  ok(sc.fp.free.length === 1, 'stepping out of reach owes a free blow');for (const b of order) if (b !== a && sc.acts[b.id] == null) T.sceneAct(b, 'strike', '', 'stay');
  let g = 0;while (!beats(sc, 'free').length && g++ < 300) step(1 / 60);ok(beats(sc, 'free').length === 1, 'the free blow lands as a beat');ok(sc.fp.st.free === 1, 'free blows are counted')}
close(sc);
stand(plain, [[-1, 0], [-1, 1], [-3, -2], [-3, 2], [-3, 3]]);
const m4 = beast(plain.x, plain.y);
sc = open('elite', {mob: m4.id, hero: M[0].id});
{sc.fp.guard.push(M[1].id);T.sceneAct(M[0], 'strike', '', '3 back');ok(sc.fp.free.length === 1, 'the step is noted');const owed = PT.freeOwed(sc);ok(owed.length === 0, 'a guard beside the tile left covers the step')}
close(sc);

// cover and a guard on a blow
stand(plain, [[-1, 0], [-2, 0], [-3, 2], [-3, 3], [-3, -3]]);
const m5 = beast(plain.x + 3, plain.y, 'caster');
if (m5) {sc = open('elite', {mob: m5.id, hero: M[0].id});
  const P = sc.fp, g = PT.patchGrid(P), t = P.pos[M[0].id];g.cover[t.y * g.w + t.x] = 1; // this tile counts as a tree for the test
  ok(PT.blowMods(sc, m5, M[0]).adj === -GEO.COVER, 'a shot at one in cover: ' + JSON.stringify(PT.blowMods(sc, m5, M[0])));g.cover[t.y * g.w + t.x] = 0;
  P.guard.push(M[1].id);ok(PT.blowMods(sc, m5, M[0]).adj === GEO.GUARD_PEN, 'one who stands by a guard is harder to hit');ok(PT.blowMods(sc, m5, M[1]).mul === GEO.GUARD_CUT, 'a guard takes the blow at its cut');
  close(sc)} else ok(false, 'no caster creature in the world');

// a foe reaches only who it reaches, and walks
stand(plain, [[-4, 0], [-4, 1], [-4, -1], [-4, 2], [-4, -2]]);
const m6 = beast(plain.x + 4, plain.y);
sc = open('elite', {mob: m6.id, hero: M[0].id}, false);
{sc.foeAt = 0;let g = 0;for (const b of M) sc.fp.pos[b.id].x = Math.max(0, sc.fp.pos[b.id].x - 3); // more ground between them than a foe walks in a round
  const was = {...sc.fp.pos['f' + m6.id]};while (!sc.beats.some(b => b.by === 'foe') && g++ < 300) step(1 / 60);
  const b = sc.beats.find(x => x.by === 'foe');ok(b && b.k === 'close', 'a foe out of reach closes in: ' + (b && b.k));const now = sc.fp.pos['f' + m6.id];ok(now.x !== was.x || now.y !== was.y, 'it walked');ok(Math.floor(m6.x) - sc.fp.ox === now.x, 'its walk is in the world')}
close(sc);

// rooted, and slow ground
stand(plain, [[0, 0], [-1, 1], [-1, -1], [-2, 1], [-2, -1]]);
const m7 = beast(plain.x + 3, plain.y);
sc = open('elite', {mob: m7.id, hero: M[0].id});
{const a = M[0], gr = PT.patchGrid(sc.fp), keep = gr.cost.slice();gr.cost.fill(PT.FIELD.SLOW); // this ground counts as all snow for the test
  const r = PT.PATCH_KIND.move(sc, a, '3 back');gr.cost.set(keep);ok(r.x != null && Math.max(Math.abs(r.x - sc.fp.pos[a.id].x), Math.abs(r.y - sc.fp.pos[a.id].y)) === 1, 'three steps of a walk are one tile in the snow: ' + JSON.stringify(r));
  a.eff = a.eff || {};setCond(a, 'root', 2, 10, 0, null);ok(condOn(a, 'root'), 'rooted');const e = T.sceneAct(a, 'strike', '', 'back');ok(typeof e === 'string' && /rooted/i.test(e), 'a rooted hero cannot move: ' + e)}
close(sc);

// the retreat
{const rd = find((x, y) => T_(x, y) === ROAD && box(x, y, 3, (a, b) => !solidAt(a, b)) && T_(x + 2, y) === ROAD);
  ok(rd, 'a road stretch');stand(rd, [[0, 0], [-1, 1], [-1, -1], [-2, 1], [-2, -1]]);const m8 = beast(rd.x + 1, rd.y);
  sc = open('elite', {mob: m8.id, hero: M[0].id});const a = M[0], x0 = a.x, y0 = a.y, want = sc.fp.pos;T.sceneAct(a, 'retreat', '');let g = 0;
  while (!(sc.out || []).includes(a.id) && g++ < 12) {const c = S.agents.find(b => b.id === sc.ids[sc.i]);if (c && c !== a && !sc.acts[c.id]) T.sceneAct(c, 'guard', '');run()}
  ok((sc.out || []).includes(a.id), 'the retreat leaves the fight');const d = Math.max(Math.abs(a.x - x0), Math.abs(a.y - y0));ok(d >= 1 && d <= 3, 'it stands up to three tiles off, in the world: ' + d);
  ok(a.state === 'return', 'and goes on home from there');const x1 = a.x, y1 = a.y;const ended = sc;close(ended);ok(Math.hypot(a.x - x1, a.y - y1) < 3, 'the world goes on from where it got to')}

// an edge, the save, Kragmaw
stand(plain, [[-1, 0], [-1, 1], [-1, -1], [-2, 1], [-2, -1]]);
const m9 = beast(plain.x + 6, plain.y + 6), m10 = beast(plain.x + 6, plain.y + 5);
sc = open('ambush', {mob: m9.id, mobs: [m9.id, m10.id], hero: M[0].id, edge: 'north'});
{ok(sc.fp.pos['f' + m9.id].y <= 1 && sc.fp.pos['f' + m10.id].y <= 1, 'a staged pack comes from the edge the DM named: ' + JSON.stringify(sc.fp.pos['f' + m9.id]));
  ok(Math.floor(m9.y) - sc.fp.oy <= 1, 'and stands there in the world');ok(PT.edgeOf('North') === 'north' && PT.edgeOf('up') === null, 'edges are read');
  const v0 = T.tableView(M[0]).room, snap = JSON.stringify(snapshot());restore(JSON.parse(snap));const sc2 = S.table;ok(sc2 && sc2.fp, 'a save mid-scene keeps the patch');
  const a2 = S.agents.find(a => a.id === M[0].id);ok(T.tableView(a2).room === v0, 'and reads the same ground');sc = sc2;
  for (let i = 0; i < M.length; i++) M[i] = S.agents.find(a => a.id === M[i].id)}
close(sc);

// ---- #1056: a foe in rounds on the open map hits as it does in real time ----
{const RD = await import('../src/sim/tableround.js'), {CLS} = await import('../src/data/classes.js'), {combatStats} = await import('../src/sim/stats.js'), {ABILITIES} = await import('../src/data/bestiary.js');
  const eliteAt = (p, o = {}) => {const m = beast(p.x, p.y);Object.assign(m, {elite: true, name: 'Test Elite', hp: 4000, maxhp: 4000, hpl: 4000, ab: [], abcd: {}, acd: 1}, o);return m};
  const line = [[-1, 0], [-1, 1], [-1, -1], [-2, 1], [-2, -1]], turn = (sc, m) => RD.foeTurn(sc, [m], M.filter(a => a.state !== 'dead'));
  // Defense counts once: the roll is AC, so a blow that lands is not cut by Defense again, on the map; off it, it is.
  stand(plain, line);let m = eliteAt(plain);let sc = open('elite', {mob: m.id, hero: M[0].id});
  ok(sc.fp && RD.blowForce(sc, m, M[0]) > 1 && Math.abs(RD.blowForce(sc, m, M[0]) * (1 - combatStats(M[0]).defense) - 1) < 1e-9, 'on the map Defense does not come off a blow a second time');
  ok(RD.blowForce({}, m, M[0]) === 1, 'off the map the blow is as before');ok(RD.blowForce(sc, S.boss || {kind: 'boss'}, M[0]) === 1, 'and Kragmaw keeps his');ok(RD.blowForce(sc, M[0], m) === 1, 'a blow on a creature is untouched');
  // the swing clock: an elite answers the blades against it, a slow biter sits a round out
  {let n = 0;for (let i = 0; i < 8; i++) n += turn(sc, m).filter(b => b.k === 'attack').length;ok(n === Math.round(8 * RD.TR.ELITE_PACE), 'an elite swings TR.ELITE_PACE a round against five: ' + n + ' in 8 rounds');
    for (const a of M) a.hp = maxHp(a);const L2 = M.slice(0, 2);sc.sw = {};n = 0;for (let i = 0; i < 8; i++) n += RD.foeTurn(sc, [m], L2).filter(b => b.k === 'attack').length;for (const a of M) a.hp = maxHp(a);
    ok(n < 8, 'and less often against two: ' + n + ' in 8 rounds')}
  close(sc);
  stand(plain, line);m = beast(plain.x, plain.y);m.acd = 2;m.ab = [];m.abcd = {};m.hp = m.maxhp = 4000;sc = open('elite', {mob: m.id, hero: M[0].id});
  {const B = [];for (let i = 0; i < 6; i++) B.push(...turn(sc, m));for (const a of M) a.hp = maxHp(a);ok(B.filter(b => b.k === 'attack').length === 3 && B.filter(b => b.k === 'gather').length === 3, 'a slow biter swings every other round, and a beat says so')}
  close(sc);
  // a ready opener fires at once, a trick off cooldown waits, and it takes a swing
  stand(plain, line);m = eliteAt(plain, {ab: ['howl'], abcd: {howl: 0}});sc = open('elite', {mob: m.id, hero: M[0].id});
  {const B = turn(sc, m), t = B.find(b => b.k === 'trick');ok(t && t.text === ABILITIES.howl.name, 'a ready opener fires in the first round: ' + (t && t.res));ok(m.abcd.howl > 0, 'and goes on cooldown');
    const before = m.abcd.howl;turn(sc, m);ok(m.abcd.howl === before - RD.TR.ROUND_S, 'its cooldown runs down a round at a time');
    ok(sc.beats !== undefined && !turn(sc, m).some(b => b.k === 'trick'), 'it does not fire again while cooling');for (const a of M) {a.hp = maxHp(a);if (a.eff) delete a.eff.stun}}
  close(sc);
  // hatch waits for its `when`, then seats kin in the fight, on the ground, on the rolls
  stand(plain, line);m = eliteAt(plain, {ab: ['hatch'], abcd: {hatch: 0}});sc = open('elite', {mob: m.id, hero: M[0].id});
  {ok(!turn(sc, m).some(b => b.k === 'trick'), 'hatch waits until she is hurt');m.hp = m.maxhp * .7;const t = turn(sc, m).find(b => b.k === 'trick');ok(t && t.text === 'Hatch', 'hurt, she hatches kin: ' + (t && t.res));
    const add = S.mobs.find(x => x.add && x.parent === m.id);ok(add && sc.ctx.adds.includes(add.id), 'the kin is in the scene');ok(sc.fp.pos['f' + add.id] && sc.fp.foes.some(r => r.id === add.id), 'and has a tile');
    ok(PT.fieldOf(sc).foes.length === 2, 'the rules read it');const snap = JSON.stringify(snapshot());restore(JSON.parse(snap));sc = S.table;ok(sc && sc.ctx.adds.length === 1, 'a save mid-scene keeps it');
    for (let i = 0; i < M.length; i++) M[i] = S.agents.find(a => a.id === M[i].id);m = S.mobs.find(x => x.id === m.id);const a2 = S.mobs.find(x => x.add && x.parent === m.id);if (a2) a2.alive = false;for (const a of M) a.hp = maxHp(a)}
  close(sc);
  // gore hurls one back on the ground
  stand(plain, [[-1, 0], [-3, 2], [-3, -2], [-3, 3], [-3, -3]]);m = eliteAt(plain, {ab: ['gore'], abcd: {gore: 0}});m.target = M[0];sc = open('elite', {mob: m.id, hero: M[0].id});
  {const p0 = {...sc.fp.pos[M[0].id]}, h0 = M[0].hp, t = turn(sc, m).find(b => b.k === 'trick'), p1 = sc.fp.pos[M[0].id];ok(t && t.text === 'Gore', 'gore fires in rounds: ' + (t && t.res));ok(M[0].hp < h0, 'it hurts');
    ok(/hurled/.test(t.res) ? p1.x !== p0.x || p1.y !== p0.y : true, 'and moves its target when the ground lets it');ok(Math.floor(M[0].x) - sc.fp.ox === p1.x, 'in the world too');for (const a of M) {a.hp = maxHp(a);if (a.eff) delete a.eff.stun}}
  close(sc);
  // the plain heal needs a breath, unless someone lies down
  stand(plain, line);m = eliteAt(plain);sc = open('elite', {mob: m.id, hero: M[0].id});
  {const h = M.find(a => CLS[a.cls].heal), keys = () => T.optionsFor(sc, h).map(o => o.k), low = M.find(a => a !== h);low.hp = Math.round(maxHp(low) * .5);ok(keys().includes('heal'), 'a healer can heal');
    sc.hl = {[h.id]: sc.rd};ok(!keys().includes('heal'), 'not again the next round');sc.rd += RD.TR.HEAL_GAP;ok(keys().includes('heal'), 'and again after TR.HEAL_GAP rounds');sc.rd -= RD.TR.HEAL_GAP;const fp = sc.fp;sc.fp = null;ok(keys().includes('heal'), 'off the map it is ready every round');sc.fp = fp;low.hp = maxHp(low)}
  close(sc);
}


if (S.boss && S.boss.alive) {const b = S.boss, bx = b.x, by = b.y;for (const a of M) {a.state = 'raid';a.target = b;a.hp = maxHp(a)}
  stand({x: b.x, y: b.y}, [[-3, 0], [-3, 1], [-3, -1], [3, 1], [3, -1]]);for (const a of M) a.state = 'raid';
  sc = open('boss', {});ok(sc && sc.fp, 'Kragmaw plays on a patch');ok(b.x === bx && b.y === by, 'the wyrm keeps its place in the world');
  ok(sc.fp.pos.fboss, 'and has a tile');ok(M.every(a => !solidAt(a.x, a.y)), 'the raid stands on open rock');
  const F2 = PT.fieldOf(sc);ok(F2.foes[0].boss && F2.foes[0].reach === PT.FIELD.BOSS_REACH, 'its claw reaches');close(sc);for (const a of M) a.state = 'hunt'}
live(false);

// a forced world repeats
{const me = fileURLToPath(import.meta.url), go = () => spawnSync(process.execPath, [me, '--forced'], {encoding: 'utf8', timeout: 240000}).stdout.trim().split('\n').pop();
  const a = go(), b = go();ok(a && a === b, 'a forced patch world repeats on one seed: ' + a + ' / ' + b);ok(/scenes:[1-9]/.test(a), 'and played scenes on the ground: ' + a)}

console.log(passed + ' passed, ' + fails + ' failed');
if (fails) process.exit(1);
console.log('patchcheck: all checks passed');
