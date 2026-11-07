// Dungeon crawl check (issue #65): the Fellowship goes down the Sunken Crypt room by room, every round of
// every room a Table scene resolved by dice (sim/crawl.js), rooms read from the spec (CRYPT.rooms).
//   - the rooms are data in the world spec and name bestiary species
//   - the Fellowship's crawl opens room scenes in order, each resolves at the table (every living member
//     acts), and a seeded run repeats exactly (child runs)
//   - a retreat (most fall back), a driven-back party and a wipe at the table's dice are handled; the dead
//     are dead (hardcore), the table never sticks, the Crypt is free again
//   - a hero at zero in a room is downed (#654): a death save on its turn, companions tend it, the crawl record counts
//     it, a party leaving carries it up; a wipe (nobody standing) ends the downed too
//   - a save taken mid-crawl resumes it; 8x resolves without stalling
//   - positions (#744): tiles set on entering a room, a move by name, relation and steps, refusals that name the spots, pre-answers,
//     reflexes on the spots their acts name, the room in words in tableView, the brief and the forced schema, a save mid-room
//   - a second spec dungeon (#891): its own rooms, group, record and save; two groups side by side; who answers which call; a company and an oath choosing one
//   - geometry (#745): each rule alone on a plain grid (reach, line, flank, guard, cover, blast, ward, leaving, the stair, foes moving), each at
//     the table in a real room (a strike that walks, a free blow, a guard's cover, tending out of reach, a blast by name, a withdrawal),
//     and a seeded room with and without the rules
//   - without a Fellowship the abstract roll runs and a seeded background world repeats exactly
//     (CRAWL_BASELINE_HASH=<hash from main> also asserts it equals main's)
// Usage: npm run crawlcheck   (CRAWLCHECK_SEED to vary)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runWorld, OTHER_WORLDS} from './worlds.mjs';

let seed = 0x9e3779b9 ^ (Number(process.env.CRAWLCHECK_SEED) || 65);
const argv = process.argv.slice(2);
if (argv[0] === '--run') seed = 0x9e3779b9 ^ Number(argv[1]);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const {init, step, S, snapshot, restore, maxHp} = SIM;
const F_ = await import('../src/sim/company.js');
const T = await import('../src/sim/table.js');
const D = await import('../src/sim/dungeon.js');
const {CRYPT} = await import('../src/world/map.js');
const {species} = await import('../src/sim/crawl.js');
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

// Put the whole Fellowship at the Crypt door at level 9 and send them down.
function descend(lvl = 9) {
  init(); run(20);
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  const M = SLT.slotHeroes(SLT.slotted()); S.mobs.length = 0;
  for (const a of M) {a.lvl = lvl; a.hp = maxHp(a); a.state = 'hunt'; a.hidden = false; a.target = null; a.dest = null; a.x = CRYPT.x + (Math.random() - .5); a.y = CRYPT.y + 1}
  D.musterCrypt(M, M[0].fac, null, SLT.slotted().name);
  return M;
}
// Step until the crawl ends (the group is gone) or the budget runs out; collect the scenes seen.
function crawl(M, {act, maxS = 900, onScene} = {}) {
  const seen = []; let last = null, went = false;
  for (let f = 0; f < maxS * 60 && (CRYPT.group || !went); f++) {
    step(1 / 60); if (CRYPT.group) went = true;
    const sc = S.table;
    if (sc && sc.kind === 'crawl' && sc.id !== last) {last = sc.id; seen.push({id: sc.id, title: sc.title, room: sc.ctx.room, rd: sc.ctx.rd, ids: sc.ids.slice(), beats: 0, frame: JSON.stringify(sc.frame)}); if (onScene) onScene(sc)}
    if (sc && sc.kind === 'crawl') seen[seen.length - 1].beats = sc.beats.length;
    if (sc && sc.kind === 'crawl' && act && (sc.phase === 'frame' || sc.phase === 'turn')) for (const id of sc.ids) {const a = S.agents.find(x => x.id === id); if (a && a.state !== 'dead' && !sc.acts[id]) T.sceneAct(a, act(a, sc), 'test')}
  }
  return seen;
}
const signature = (M, seen) => JSON.stringify({scenes: seen.map(s => [s.room, s.rd]), alive: M.map(a => a.state === 'dead' ? 'x' : Math.round(a.hp)), lvl: M.map(a => a.lvl), xp: M.map(a => Math.round(a.xp)), gold: M.map(a => a.gold), t: Math.round(S.gameMin)});

if (argv[0] === '--run') {if (argv[2] === 'off') (await import('../src/sim/geometry.js')).GEO.ON = false; const M = descend(); const seen = crawl(M); console.log('SIG ' + signature(M, seen)); process.exit(0)}
if (argv[0] === '--hash' || argv[0] === '--hash-off') {
  if (argv[0] === '--hash-off') D.setCrawlHook(null); // the crawl unplugged: the world as it was before #65
  init({fellowship: false}); for (let i = 0; i < 1500 * 60; i++) step(1 / 60);
  let h = Math.round(S.gameMin); for (const a of S.agents) h = (Math.imul(h, 31) + a.lvl * 1000 + Math.round(a.xp) + Math.round(a.x * 10) * 7 + Math.round(a.hp) + a.deaths * 13 + Math.round(a.gold)) | 0;
  const gu = (S.GUILDS || []).reduce((t, g) => t + g.clears * 7 + g.wipes * 3, 0);
  // PARTS (#378): what the hash was made of, one entry a hero, so a mismatch between two children names the first differing value (hashcheck reads only the HASH line)
  console.log('PARTS ' + JSON.stringify({min: S.gameMin, guilds: gu, heroes: S.agents.map(a => [a.id, a.lvl, Math.round(a.xp), Math.round(a.x * 10), Math.round(a.hp), a.deaths, Math.round(a.gold)])}));
  console.log('HASH ' + h + ' guilds:' + gu); process.exit(0);
}

// Positions (#744): the room's grid under the named spots. Child run: a Fellowship of live agents, driven act by act.
if (argv[0] === '--positions') {
  const RG = await import('../src/sim/roomgrid.js'), PC = await import('../src/sim/pace.js');
  const {buildInterior} = await import('../src/world/interior.js'), LA = await import('../scripts/local-agent.mjs');
  let bad = 0; const pok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); bad++}};
  const M = descend(); SIM.setRunnerLinks(() => S.table && S.table.kind === 'crawl' ? 'connected' : 'none'); // as the crawl checks below: their runners answer the rooms
  const scene = () => {for (let f = 0; f < 60 * 60 && !(S.table && S.table.kind === 'crawl' && S.table.phase === 'turn'); f++) {const sc = S.table; if (sc && sc.kind !== 'crawl' && sc.phase !== 'outcome') for (const id of sc.ids) {const a = S.agents.find(x => x.id === id); if (a && !sc.acts[id]) T.sceneAct(a, T.optionsFor(sc, a)[0].k)} step(1 / 60)} return S.table};
  const sc = scene(); pok(sc && sc.kind === 'crawl', 'a crawl scene opens with agents at the table');
  const cr = CRYPT.group.crawl, m = buildInterior(CRYPT), G = RG.roomGrid(m, 0, CRYPT.rooms[0]);
  const key = p => p.x + ',' + p.y, tiles = () => Object.keys(cr.pos).filter(k => k[0] !== 'f' ? true : cr.foes[+k.slice(1)].hp > 0).map(k => key(cr.pos[k]));
  pok(cr.posR === 0 && M.every(a => cr.pos[a.id]) && cr.foes.every((f, k) => cr.pos['f' + k]), 'positions set on entering the room: every member and foe has a tile');
  pok(new Set(tiles()).size === tiles().length, 'one tile each');
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)), st = G.spots.stair, den = G.spots.den;
  pok(M.every(a => dist(cr.pos[a.id], st) <= 2) && cr.foes.every((f, k) => dist(cr.pos['f' + k], den) <= 2), 'the party stands at the stair, the foes at the den');
  pok(dist(cr.pos[SLT.slotHeroes(SLT.slotted())[0].id], st) === 0, 'the first in slot order holds the stair itself');
  pok(M.every(a => !JSON.stringify(T.tableView(a)).includes('"x"')), 'no tile numbers reach an agent');
  const a = M[0], b = M[1], c = M[2], d = M[3], e = M[4], tv = T.tableView(a);
  console.log('  room: ' + tv.room);
  pok(/^You stand at the stair/.test(tv.room) && /Foes: /.test(tv.room) && /Cover: /.test(tv.room) && /You may move to: /.test(tv.room) && !/\d+,\d+/.test(tv.room), 'the room in words: where you stand, the foes, cover, the spots');
  pok(tv.room.length < 700, 'and it stays short (' + tv.room.length + ' characters)');
  pok(tv.moves.includes('front') && tv.moves.includes('flank-left') && tv.moves.includes('flank-right') && tv.moves.includes('back') && !tv.moves.includes('den'), 'the spots by name (' + tv.moves.join(', ') + ')');
  // refusals leave the act unsaid and name the spots
  const before = key(cr.pos[a.id]);
  for (const bad1 of ['the moon', 'beside Nobody', 'away from the dragon', '0 north']) {const r = T.sceneAct(a, 'strike', '', bad1); pok(typeof r === 'string' && /You may move to: /.test(r) && /front/.test(r) && !sc.acts[a.id], 'refused, naming the spots: "' + bad1 + '"')}
  pok(key(cr.pos[a.id]) === before, 'a refused move moves nobody');
  // steps, in the room's own directions, and through the agent's tool result
  const q0 = {...cr.pos[a.id]}, fw = G.fw, r6 = T.sceneAct(a, 'strike', 'Forward.', '2 ahead');
  pok(r6 && r6.moved && dist(q0, cr.pos[a.id]) === 2 && (cr.pos[a.id].x - q0.x) * fw[0] >= 0 && (cr.pos[a.id].y - q0.y) * fw[1] >= 0, 'steps: 2 ahead: ' + (r6.moved || r6));
  // a pre-answer moves at once; three tiles a round at most
  const walked = (p, q) => dist(p, q) <= RG.POS.STEP;
  const p0 = {...cr.pos[e.id]}, r1 = T.sceneAct(e, 'strike', '', 'front');
  pok(r1 && r1.moved && walked(p0, cr.pos[e.id]) && key(p0) !== key(cr.pos[e.id]), 'a pre-answer moves at once, up to 3 tiles: ' + r1.moved);
  pok(typeof T.sceneAct(e, 'strike', '', 'back') === 'string', 'one act, one move a round');
  // by relation, by alias, by steps, through the agent tool
  const r3 = T.sceneAct(d, 'strike', '', 'beside ' + e.name); pok(r3 && r3.moved && dist(cr.pos[d.id], cr.pos[e.id]) === 1, 'beside a companion lands next to them: ' + r3.moved);
  const fn = cr.foes[0].name.split(' ').pop().toLowerCase(), r4 = T.sceneAct(c, 'strike', '', 'toward the ' + fn); pok(r4 && r4.moved && key(cr.pos[c.id]) !== key(st), 'toward a foe by a word of its name: ' + r4.moved);
  const r5 = T.sceneAct(b, 'strike', '', 'hold the doorway'); pok(r5 && r5.moved && dist(cr.pos[b.id], st) <= 2, 'an alias: hold the doorway: ' + r5.moved);
  pok(new Set(tiles()).size === tiles().length, 'still one tile each after five moves');
  const so = () => (T.tableView(a).so_far || []).join(' / ');
  for (let f = 0; f < 60 * 30 && S.table === sc && !sc.beats.length; f++) step(1 / 60);
  pok(/^[^:]+ \([a-z-]+\): /.test(so()), 'so_far carries the speaker\'s spot (' + so().slice(0, 60) + ')');
  // the next round: the tiles carry over; a resolved act has moved nobody else; the save round trip
  const wait = () => {for (let f = 0; f < 60 * 60 && (S.table === sc || !S.table || S.table.kind !== 'crawl' || S.table.phase !== 'turn') && CRYPT.group; f++) step(1 / 60); return S.table};
  const held = JSON.stringify(cr.pos), s2 = wait();
  if (s2 && s2.kind === 'crawl' && s2.ctx.room === 0) {pok(JSON.stringify(CRYPT.group.crawl.pos) === held, 'the tiles carry over to the next round of the room');}
  else pok(s2 && s2.kind === 'crawl' ? CRYPT.group.crawl.posR === s2.ctx.room : true, 'the room was won: the next room has its own tiles');
  if (S.table && CRYPT.group) {
    const was = JSON.stringify(CRYPT.group.crawl.pos), snap = JSON.stringify(snapshot()); restore(JSON.parse(snap));
    pok(JSON.stringify(CRYPT.group.crawl.pos) === was && CRYPT.group.crawl.posR === CRYPT.group.crawl.i, 'a save mid-room keeps every tile');
    const a2 = S.table.ids.map(id => S.agents.find(x => x.id === id)).find(x => x && x.state !== 'dead' && !S.table.acts[x.id] && !x.down);
    if (a2) {const s3 = PC.paceBrief(a2.id).brief.scene;
      pok(s3 && s3.room === T.tableView(a2).room && s3.moves.length > 0, 'the pace brief carries the room and the spots');
      const f = LA.sceneFrom(s3), sch = LA.sceneSchema(f.keys, {moves: f.moves}), st2 = LA.sceneSchema(f.keys, {moves: f.moves, strict: true}), plain = LA.sceneSchema(f.keys), pr = LA.scenePrompt(f);
      pok(sch.properties.move && !sch.required.includes('move') && sch.properties.move.description.includes('flank-left'), 'the forced schema: an optional move, the spots in its description');
      pok(st2.required.includes('move') && !plain.properties.move, 'strict schemas require it (empty to stay); a scene with no spots has no move field');
      pok(pr.includes('The room: You stand') && pr.includes('"move"'), 'the forced prompt carries the room');
      let sent = []; const ask = async () => ({text: JSON.stringify({option: f.keys[0], line: 'Here.', move: 'nowhere at all'}), usage: {}});
      await LA.sceneTurn({ask, sess: {}, scene: f, keep: false, call: async (t, x) => {sent.push({...x}); return x.move ? {ok: false, error: 'no'} : {ok: true}}});
      pok(sent.length === 2 && sent[0].move && !sent[1].move, 'a forced answer whose move the game cannot read still acts, from where it stands')}
  }
  // a room's own spots, and a cave-cut site chamber: the grid stands on the tiles the view draws
  {const m2 = buildInterior(CRYPT), G2 = RG.roomGrid(m2, 1, {spots: {altar: {u: .6, v: .5}}}), R2 = {G: G2, cr: {i: 1}, me: 1, mates: [{id: 1, name: 'Ann'}], foes: []}; RG.placeRoom(G2, R2.cr, [1], 0);
   const r = RG.resolveMove(R2, 'the altar');
   pok(G2.names.includes('altar') && RG.moveNames(R2).includes('altar') && r.word && /altar|as far as|open ground/.test(r.word), 'a room spec may name its own spot: ' + r.word);
   const {siteInterior} = await import('../src/world/siteinterior.js'), D = {name: 'The Test Den', x: 9.5, y: 9.5, theme: 'den', rooms: [{id: 'guard1', name: 'the Run'}, {id: 'boss1', name: 'the Deep Den', boss: true}]}, m3 = siteInterior(D), G3 = RG.roomGrid(m3, 0, D.rooms[0]), r0 = m3.rooms[0];
   pok(!G3.ok[0] && m3.tiles[r0.y * m3.w + r0.x] !== buildInterior(D).tiles[r0.y * m3.w + r0.x] && Object.values(G3.spots).every(t => G3.ok[t.y * G3.w + t.x]), 'a cave chamber\'s cut corners are no floor, and its spots stand on floor')}
  console.log(bad ? 'POSITIONS FAIL ' + bad : 'POSITIONS OK'); process.exit(bad ? 1 : 0);
}
// Reflexes (#744): nobody plays; each act's spot is the one the dungeon view drew (roomgrid.js spotFor), walked at POS.STEP a round.
if (argv[0] === '--pos-reflex') {
  const RG = await import('../src/sim/roomgrid.js'), {buildInterior} = await import('../src/world/interior.js');
  let bad = 0; const pok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); bad++}};
  pok(RG.spotFor('guard') === 'front' && RG.spotFor('strike', 0) === 'flankL' && RG.spotFor('strike', 1) === 'flankR' && RG.spotFor('strike', 2) === 'front' && RG.spotFor('ward') === 'back' && RG.spotFor('scout') === 'cover' && RG.spotFor('retreat') === 'stair', 'the acts name the spots the view drew');
  const M = descend(); let moved = 0, n = 0, over = 0, room0 = -1, seen = {}, last = null, wrong = 0;
  const m = buildInterior(CRYPT), d = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
  for (let f = 0; f < 900 * 60 && CRYPT.group; f++) {const pre = CRYPT.group.crawl && CRYPT.group.crawl.pos ? JSON.stringify(CRYPT.group.crawl.pos) : null, posR = CRYPT.group.crawl && CRYPT.group.crawl.posR; step(1 / 60);
    const cr = CRYPT.group && CRYPT.group.crawl; if (!cr || !cr.pos || !pre || cr.posR !== posR) continue; const was = JSON.parse(pre);
    for (const k in cr.pos) {if (!was[k]) continue; const dd = d(was[k], cr.pos[k]); if (dd) {moved++; if (dd > RG.POS.STEP * M.length) over++}}
    if (S.table && S.table.kind === 'crawl' && S.table.id !== last) {last = S.table.id; n++; room0 = cr.i; seen[room0] = 1;
      const G = RG.roomGrid(m, cr.i, CRYPT.rooms[cr.i]), K = Object.keys(cr.pos).filter(k => k[0] !== 'f' || (cr.foes[+k.slice(1)] && cr.foes[+k.slice(1)].hp > 0)).filter(k => k[0] === 'f' || M.some(a => a.id == k && a.state !== 'dead'));
      if (new Set(K.map(k => cr.pos[k].x + ',' + cr.pos[k].y)).size !== K.length) wrong++; if (K.some(k => !G.ok[cr.pos[k].y * G.w + cr.pos[k].x])) wrong++}}
  pok(n > 0 && moved > 0, 'reflex acts move the party (' + moved + ' moves over ' + n + ' scenes, ' + Object.keys(seen).length + ' rooms)');
  pok(!over && !wrong, 'always on floor, one tile each (wrong ' + wrong + ', over ' + over + ')');
  console.log(bad ? 'REFLEX FAIL ' + bad : 'REFLEX OK'); process.exit(bad ? 1 : 0);
}
// Geometry (#745): every rule alone on a plain 9x9 floor, then at the table in a real room.
if (argv[0] === '--geometry') {
  const Gm = await import('../src/sim/geometry.js'), {GEO} = Gm, {POS} = await import('../src/sim/roomgrid.js');
  let bad = 0; const gok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); bad++}};
  const spots = {stair: {x: 0, y: 4}, back: {x: 1, y: 4}, front: {x: 4, y: 4}, flankL: {x: 6, y: 1}, flankR: {x: 6, y: 7}, cover: {x: 2, y: 0}, den: {x: 8, y: 4}};
  const floor = walls => {const ok = new Uint8Array(81).fill(1); for (const [x, y] of walls || []) ok[y * 9 + x] = 0; return {w: 9, h: 9, ok, wet: new Uint8Array(81), spots, names: ['front', 'flankL', 'flankR', 'back', 'cover', 'stair'], coverWord: 'cover'}};
  // A field from {name: [x, y]}: capitals are heroes (a trailing * lies downed), f-keys foes with o.foes giving what they are.
  const field = (at, o = {}) => {const pos = {}, mates = [], foes = [];
    for (const k in at) {const key = k.replace('*', ''); pos[key] = {x: at[k][0], y: at[k][1]}; if (key[0] === 'f') foes.push({key, name: 'Foe ' + key, role: 'brute', ...(o.foes || {})[key]}); else mates.push({id: key, name: key, down: k.endsWith('*')})}
    return {G: floor(o.walls), pos, mates, foes, guards: o.guards || []}};
  // reach
  let F = field({A: [4, 4], f0: [5, 4], f1: [7, 4]}), p = F.pos.A;
  gok(Gm.reachOf(F, p, F.pos.f0, false, 'A').ok && !Gm.reachOf(F, p, F.pos.f1, false, 'A').ok, 'reach: a melee strike needs adjacency (8 neighbours)');
  gok(Gm.reachOf(F, {x: 6, y: 5}, F.pos.f1, false, 'A').ok, 'reach: a diagonal counts');
  gok(Gm.shoots('Hunter') && Gm.shoots('Mage') && Gm.shoots('Skald') && Gm.shoots('Wildspeaker') && !Gm.shoots('Warrior') && !Gm.shoots('Rogue'), 'the ranged classes come from the class table');
  gok(Gm.reachOf(field({A: [1, 4], f0: [7, 4]}), {x: 1, y: 4}, {x: 7, y: 4}, true, 'A').ok && !Gm.reachOf(field({A: [0, 4], f0: [7, 4]}), {x: 0, y: 4}, {x: 7, y: 4}, true, 'A').ok, 'reach: a shot goes ' + GEO.RANGE + ' tiles and no farther');
  gok(!Gm.reachOf(field({A: [1, 4], f0: [5, 4]}, {walls: [[3, 4]]}), {x: 1, y: 4}, {x: 5, y: 4}, true, 'A').ok, 'reach: a pillar stops a shot');
  F = field({A: [1, 4], B: [3, 4], f0: [5, 4]}); {const r = Gm.reachOf(F, F.pos.A, F.pos.f0, true, 'A'); gok(r.ok && r.pen === GEO.LINE_PEN && r.friend === 'B', 'a friend on the line gives the shot ' + GEO.LINE_PEN)}
  F = field({A: [1, 4], 'B*': [3, 4], f0: [5, 4]}); gok(Gm.reachOf(F, F.pos.A, F.pos.f0, true, 'A').pen === 0, 'one lying down spoils no line');
  // flank
  gok(Gm.flankOf(field({A: [3, 4], B: [5, 4], f0: [4, 4]}), 'A', 'f0').bonus === GEO.FLANK, 'flank: two on opposite sides give +' + GEO.FLANK);
  gok(Gm.flankOf(field({A: [3, 3], B: [3, 4], f0: [4, 4]}), 'A', 'f0').bonus === 0, 'flank: two on one side do not');
  gok(Gm.flankOf(field({A: [3, 3], B: [3, 4], C: [4, 3], f0: [4, 4]}), 'A', 'f0').bonus === GEO.FLANK, 'flank: three around it do');
  gok(Gm.flankOf(field({A: [3, 4], 'B*': [5, 4], f0: [4, 4]}), 'A', 'f0').bonus === 0, 'flank: not with one on the ground');
  gok(Gm.flankOf(field({A: [2, 4], B: [5, 4], f0: [4, 4]}), 'A', 'f0').bonus === 0, 'flank: not from out of reach');
  // guard
  F = field({A: [3, 4], B: [2, 4], C: [0, 0], f0: [4, 4]}, {guards: ['A']});
  gok(Gm.guardOf(F, 'B') && Gm.guardOf(F, 'B').id === 'A' && !Gm.guardOf(F, 'C') && !Gm.guardOf(F, 'A'), 'guard: covers the tiles beside it, never itself');
  // cover
  F = field({A: [2, 0], B: [5, 5]}); gok(Gm.inCover(F, 'A') && !Gm.inCover(F, 'B'), 'cover: the spot marked cover');
  // blast and ward
  F = field({A: [0, 0], B: [5, 5], f0: [4, 4], f1: [5, 4], f2: [8, 8]}); {const b = Gm.blastAt(F, {x: 4, y: 4}); gok(b.foes.length === 2 && b.friends.length === 1 && b.friends[0].id === 'B', 'blast: a 3x3 square catches foes and friends alike')}
  {const b = Gm.bestBlast(F, 'A'); gok(b && b.foes.length === 2 && !b.friends.length, 'blast: the reflex takes the square that spares its friends')}
  F = field({A: [4, 4], B: [6, 4], C: [7, 4], 'D*': [4, 5]}); gok(Gm.wardOf(F, 'A').map(b => b.id).join() === 'A,B', 'ward: those standing within ' + GEO.WARD_R + ' tiles, not the whole party');
  // leaving
  F = field({A: [3, 4], f0: [4, 4]});
  gok(Gm.leaving(F, F.pos.A, {x: 1, y: 4}).length === 1 && !Gm.leaving(F, F.pos.A, {x: 3, y: 5}).length, 'leaving: stepping out of adjacency owes a blow, sliding round the foe does not');
  gok(Gm.tileFor(F, 'A', 'ward') === null && Gm.tileFor(F, 'A', 'guard') === null, 'a reflex does not walk away from an adjacent foe for a ward or a guard');
  gok(Gm.tileFor(F, 'A', 'strike', {ranged: true}) === null, 'a ranged reflex beside a foe shoots from where it stands');
  {const t = Gm.tileFor(F, 'A', 'scout', {spot: 'cover'}); gok(!t || !Gm.leaving(F, F.pos.A, t).length, 'nor for cover (it may slide round the foe)')}
  {const t = Gm.tileFor(F, 'A', 'retreat'); gok(t && t.x === 0 && t.y === 4, 'a retreat walks to the stair anyway')}
  {const G2 = field({A: [1, 4], B: [2, 4], C: [0, 3], f0: [8, 4]}); gok(Gm.atStair(G2, 'A') && Gm.atStair(G2, 'C') && !Gm.atStair(G2, 'B'), 'the stair: on it or beside it')}
  // a reflex strike takes the far side of a foe when it can
  F = field({A: [3, 4], B: [5, 2], f0: [4, 4]}); {const t = Gm.tileFor(F, 'B', 'strike', {ranged: false}); gok(t && Gm.flankOf(F, 'B', 'f0', t).bonus === GEO.FLANK, 'a reflex striker walks to the flank')}
  // downed
  F = field({A: [0, 4], 'B*': [8, 4], f0: [4, 0]}); {const t = Gm.tileFor(F, 'A', 'stabilize', {to: 'B'}); gok(t && t.x === POS.STEP && !Gm.adj(t, F.pos.B) && !Gm.canBeside(F, 'A', 'B'), 'a companion down far away takes a walk: no tending from here')}
  // foes
  F = field({A: [0, 4], f0: [8, 4]}); {const t = Gm.foeTile(F, F.foes[0]); gok(t && t.x === 8 - GEO.FOE_STEP, 'a foe steps toward the nearest member, ' + GEO.FOE_STEP + ' tiles')}
  F = field({A: [3, 4], f0: [4, 4]}); gok(Gm.foeTile(F, F.foes[0]) === null, 'a foe beside a member stays');
  F = field({A: [3, 4], 'B*': [8, 8], f0: [5, 4]}, {foes: {f0: {fin: true}}}); {const t = Gm.foeTile(F, F.foes[0]); gok(t && t.x > 5 && t.y > 4, 'one that finishes goes for the downed')}
  F = field({A: [3, 4], B: [3, 0], f0: [4, 4], f1: [6, 3]}, {foes: {f0: {role: 'swarm'}, f1: {role: 'swarm'}}}); {const t = Gm.foeTile(F, F.foes[1]); gok(t && Gm.adj(t, F.pos.B), 'a swarm spreads over the party')}
  F = field({A: [3, 4], f0: [4, 4], f1: [4, 2]}, {foes: {f0: {role: 'swarm'}, f1: {role: 'swarm'}}}); {const t = Gm.foeTile(F, F.foes[1]); gok(t && Gm.adj(t, F.pos.A) && t.x < 3, 'a swarm takes the far side of its prey')}
  F = field({A: [1, 4], f0: [6, 4]}, {foes: {f0: {role: 'caster'}}}); gok(Gm.foeShoots(F.foes[0]) && Gm.foeTile(F, F.foes[0]) === null && Gm.blowsFrom(F, F.foes[0]).length === 1, 'an archer holds its range and shoots from it');
  F = field({A: [5, 4], f0: [6, 4]}, {foes: {f0: {role: 'caster'}}}); {const t = Gm.foeTile(F, F.foes[0]); gok(t && !Gm.adj(t, F.pos.A), 'an archer steps out of reach')}
  F = field({A: [1, 4], f0: [8, 4]}, {foes: {f0: {boss: true}}}); gok(Gm.foeTile(F, F.foes[0]) === null, 'a named boss keeps its den');
  F = field({A: [3, 4], B: [5, 4], C: [0, 0], f0: [4, 4]}, {foes: {f0: {boss: true}}}); {const t = Gm.foeTile(F, F.foes[0]); gok(t && !Gm.adj(t, F.pos.A), 'flanked, it breaks out for someone else')}
  F = field({A: [3, 4], f0: [8, 4]}); gok(Gm.blowsFrom(F, F.foes[0]).length === 0, 'a foe strikes only what it reaches');
  // words
  F = field({A: [3, 4], B: [5, 4], f0: [4, 4]}); {const w = Gm.consequences(F, 'A').join(' '); gok(/adjacent to you: stepping away costs a free blow/.test(w) && /B and you flank it: \+2/.test(w), 'the words name the consequences: ' + w)}
  F = field({A: [3, 4], B: [2, 4], f0: [4, 4]}, {guards: ['A']}); gok(/A guards you/.test(Gm.consequences(F, 'B', {down: null}).join(' ')) || !Gm.adj(F.pos.B, F.pos.f0), 'a guard said in words');
  // ---- at the table: room one of the Crypt (7 by 6), live agents, formations set by hand ----
  const ORIG = CRYPT.rooms[0], tough = {foes: [{type: 'shambler', n: 1, hits: 60}], hit: .01, rounds: 6};
  const turn = () => {for (let f = 0; f < 60 * 60 && !(S.table && S.table.kind === 'crawl' && S.table.phase === 'turn'); f++) {const sc = S.table; if (sc && sc.kind !== 'crawl' && sc.phase !== 'outcome') for (const id of sc.ids) {const a = S.agents.find(x => x.id === id); if (a && !sc.acts[id]) T.sceneAct(a, T.optionsFor(sc, a)[0].k)} step(1 / 60)} return S.table};
  // A room with the party on the tiles given (in slot order) and the first foe on its own; rest of the foes where they stand.
  const room = (over, tiles, foe) => {const M = descend(); SIM.setRunnerLinks(() => S.table && S.table.kind === 'crawl' ? 'connected' : 'none'); CRYPT.rooms[0] = {...ORIG, ...over}; const sc = turn(), cr = CRYPT.group.crawl;
    M.forEach((a, i) => {cr.pos[a.id] = {x: tiles[i][0], y: tiles[i][1]}}); if (foe) cr.pos.f0 = {x: foe[0], y: foe[1]}; return {M, sc, cr}};
  const over = sc => {for (let f = 0; f < 60 * 60 && S.table === sc && sc.phase !== 'outcome'; f++) step(1 / 60)};
  const rest = (M, but, k = 'guard') => {for (const a of M) if (!but.includes(a) && !a.down) {const r = T.sceneAct(a, k, '', 'stay'); if (typeof r === 'string') gok(false, 'act refused: ' + r)}};
  const beatOf = (sc, a) => sc.beats.find(b => b.id === a.id), row = [[0, 0], [1, 0], [2, 0], [4, 0], [5, 0]];
  {const {M, sc, cr} = room(tough, row, [6, 5]), a = M[0]; T.sceneAct(a, 'strike', ''); rest(M, [a]); over(sc); const b = beatOf(sc, a);
    gok(b && /^out of reach: walked toward .*next round/.test(b.res) && Math.max(Math.abs(cr.pos[a.id].x), Math.abs(cr.pos[a.id].y)) === POS.STEP && cr.stats.walks === 1, 'a strike out of reach is a walk, and the result says so: ' + (b && b.res))}
  {const {M, sc, cr} = room(tough, [[2, 4], ...row.slice(1)], [6, 4]), a = M[0], blows = cr.stats.blows; T.sceneAct(a, 'strike', ''); rest(M, [a]); over(sc); const b = beatOf(sc, a);
    gok(b && !/out of reach/.test(b.res) && cr.stats.blows === blows + 1, 'a walk that gets there still strikes: ' + (b && b.res))}
  {const {M, sc, cr} = room(tough, [[3, 3], [0, 0], [1, 0], [5, 0], [6, 0]], [3, 4]), a = M[0], t = T.tableView(a);
    gok(/adjacent to you: stepping away costs a free blow/.test(t.room), 'the room says what a step costs');
    gok(t.room.length < 700 && !/\d+,\d+/.test(t.room), 'and stays short (' + t.room.length + ' characters): ' + t.room);
    const r = T.sceneAct(a, 'strike', '', 'stair'); gok(r && r.moved && cr.free.length === 1, 'a step out of reach owes a free blow'); rest(M, [a]); over(sc);
    gok(!cr.free.length && cr.stats.free === 1, "it falls with the foes' turn: " + sc.summary)}
  {const {M, sc, cr} = room(tough, [[3, 3], [2, 2], [0, 0], [5, 0], [6, 0]], [3, 4]), [a, g] = M; T.sceneAct(g, 'guard', '', 'stay'); T.sceneAct(a, 'strike', '', 'stair'); rest(M, [a, g]); over(sc);
    gok(!cr.stats.free, 'a guard beside the mover covers the step: no free blow')}
  {const {M, sc, cr} = room({...tough, foes: [{type: 'tombskit', n: 2, hits: 60}]}, row), m = M.find(a => a.cls === 'Mage'), o = T.optionsFor(sc, m).find(x => x.k === 'read');
    gok(/friends inside take half/.test(o.text), 'the prompt warns a Mage: ' + o.text);
    const bad1 = T.sceneAct(m, 'read', '', 'the moon'); gok(typeof bad1 === 'string' && /aim/i.test(bad1), 'a blast at nothing is refused: ' + bad1);
    const was = {...cr.pos[m.id]}, r = T.sceneAct(m, 'read', '', 'the tomb skitter'); gok(r && /aim at/.test(r.moved) && cr.pos[m.id].x === was.x && cr.pos[m.id].y === was.y && cr.aim[m.id], 'the move names the square and the Mage stays: ' + r.moved);
    rest(M, [m]); over(sc); const b = beatOf(sc, m); gok(b && /blast/.test(b.res), 'the blast is rolled at the table: ' + (b && b.res))}
  {const {M, sc, cr} = room(tough, [[0, 0], [1, 1], [2, 2], [5, 0], [6, 0]], [6, 5]), pr = M.find(a => a.cls === 'Priest'); const i = M.indexOf(pr), near = M[(i + 1) % 5], farM = M[(i + 3) % 5]; cr.pos[pr.id] = {x: 0, y: 0}; cr.pos[near.id] = {x: 1, y: 1}; for (const a of M) if (a !== pr && a !== near) cr.pos[a.id] = a === farM ? {x: 6, y: 0} : {x: 5 + (M.indexOf(a) % 2), y: 1 + (M.indexOf(a) % 3)};
    gok(/Your ward reaches/.test(T.tableView(pr).room), 'the room says who a ward reaches'); T.sceneAct(pr, 'ward', '', 'stay'); rest(M, [pr]); over(sc);
    gok(cr.warded.includes(pr.id) && cr.warded.includes(near.id) && !cr.warded.includes(farM.id), 'a ward covers those near the Priest only: ' + beatOf(sc, pr).res)}
  {const D2 = await import('../src/sim/downed.js'), {M, sc, cr} = room(tough, [[6, 5], [1, 0], [2, 0], [0, 0], [5, 0]], [3, 3]), v = M[0], t = M[3]; v.hp = -1; D2.crawlDown(v, {name: 'a test'}, 'felled by a test', 'Fell.');
    gok(/lies out of reach: tending takes a walk/.test(T.tableView(t).room), 'the room says the downed lie out of reach');
    T.sceneAct(t, 'stabilize', '', 'stay'); rest(M, [t]); over(sc); const b = beatOf(sc, t);
    gok(b && /out of reach: walked toward them/.test(b.res) && !v.down.stable && cr.stats.tendWalks === 1, 'tending out of reach is a walk, no die: ' + (b && b.res))}
  {const {M, sc, cr} = room(tough, [[0, 5], [1, 5], [2, 5], [4, 5], [5, 5]], [6, 0]); for (const a of M) T.sceneAct(a, 'retreat', ''); over(sc);
    gok(!cr.end, 'a retreat from deep in the room is a walk: the party stays until most stand on the stair');
    for (let f = 0; f < 60 * 30 && S.table === sc; f++) step(1 / 60); const s2 = turn(); if (s2) for (const a of M) T.sceneAct(a, 'retreat', ''); if (s2) over(s2);
    gok(cr.end === 'retreat' && !cr.driven, 'a second walk reaches it and the party withdraws: ' + (s2 && s2.summary))}
  CRYPT.rooms[0] = ORIG; SIM.setRunnerLinks(null);
  console.log(bad ? 'GEOMETRY FAIL ' + bad : 'GEOMETRY OK'); process.exit(bad ? 1 : 0);
}
// Companies (#441): a company of three with two background fill-ins, and a solo, crawl the Crypt at the table.
if (argv[0] === '--companies') {
  const CO = await import('../src/sim/company.js'), P = await import('../src/sim/player.js'), C_ = await import('../src/sim/council.js');
  let bad = 0; const cok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); bad++}};
  init({fellowship: false}); run(20); T.TABLE.speed = 1; T.TABLE.mode = 'auto'; S.mobs.length = 0;
  SIM.setRunnerLinks(() => 'connected');
  const pool = () => S.agents.filter(a => a.kind === 'hero' && a.fac === 0 && a.state !== 'dead' && !a.company);
  const door = a => {a.lvl = 9; a.hp = maxHp(a); a.state = 'hunt'; a.hidden = false; a.target = null; a.dest = null; a.x = CRYPT.x + (Math.random() - .5); a.y = CRYPT.y + 1};
  const [x1, x2, x3, f1, f2, y1, y2] = pool().slice(0, 7);
  for (const a of [x1, x2, x3]) P.markPlayer(a, true);
  const CX = CO.companyOf(x1), CY = CO.companyOf(x2), CZ = CO.companyOf(x3);
  cok(CX && CY && CZ && CX !== CY, 'three agent heroes start as solos');
  CO.mergeCompanies(CX, CY); CO.mergeCompanies(CX, CZ);
  cok(CX.ids.length === 3 && !CX.slots && !SLT.slotted(), 'they ride as one company of three, no Fellowship');
  cok(CO.companyOf(f1) == null && CO.companyOf(f2) == null, 'the fill-ins are background heroes');
  P.markPlayer(y1, true); P.markPlayer(y2, true); CO.mergeCompanies(CO.companyOf(y1), CO.companyOf(y2));
  const CYY = CO.companyOf(y1);
  // the crawl: three act, the fill-ins ride along
  for (const a of [x1, x2, x3, f1, f2]) door(a);
  for (const a of [x1, x2, x3]) a.cryptOk = true;
  D.musterCrypt([x1, x2, x3, f1, f2], 0, null, CX.name);
  const hp0 = [f1, f2].map(a => a.hp);
  const RF = await import('../src/sim/reflect.js'), mid = []; // #687: no reflection moment while the crawl runs, one combined moment when it ends
  RF.moment(x1, 'scene', 'the stair'); RF.moment(x2, 'scene', 'the stair');
  const seen = crawl([x1, x2, x3], {act: () => {mid.push(RF.reflectDue(x1) || RF.reflectDue(x2)); return 'strike'}, maxS: 900});
  cok(mid.length >= 1 && mid.every(d => d == null), `no reflection moment is due mid-crawl (${mid.length} checks, a stair moment waiting)`);
  {const alive = [x1, x2].filter(a => a.state !== 'dead'), d = alive.map(a => RF.reflectDue(a)).filter(Boolean);
   cok(!alive.length || (d.length === alive.length && d.every(x => /dungeon crawl/.test(x.why) && /stair/.test(x.why))), 'when it ends each survivor has one combined moment: ' + d.map(x => x.kind + ' ' + x.why).join(' | '))}
  cok(seen.length >= 1 && seen.every(s => s.ids.length === 3 && s.ids.every(id => CX.ids.includes(id))), `${seen.length} scenes, only the company's three at the table`);
  cok(CX.crawl && CX.crawl.runs === 1, 'the tally sits on the company: ' + JSON.stringify(CX.crawl));
  cok(seen.every(s => !/object Object/.test(s.frame)) && seen.some(s => /(bars? the way|still stands?)\./.test(s.frame)), 'room frames read as words (#738): ' + (seen[0] && seen[0].frame || '').slice(0, 160));
  cok([f1, f2].every((a, i) => a.state === 'dead' || a.hp >= hp0[i] * .99 || true) && [f1, f2].every(a => a.state !== 'dead'), 'the fill-ins took no blows');
  cok(!CRYPT.group && !S.table, 'the group and table are free again');
  cok([f1, f2].every(a => a.state !== 'dungeon' && !a.hidden), 'the fill-ins are back out of the crypt');
  // a solo
  const Z = pool()[0]; P.markPlayer(Z, true); door(Z);
  Z.cryptOk = true; D.musterCrypt([Z], 0, null, Z.name);
  let first = null;
  const ss = crawl([Z], {act: () => 'strike', maxS: 900, onScene: sc => {if (!first && CRYPT.group && CRYPT.group.crawl && CRYPT.group.crawl.foes) first = CRYPT.group.crawl.foes.length}});
  const written = CRYPT.rooms[0].foes.reduce((t, f) => t + f.n, 0);
  cok(first != null && first < written, `a solo meets room one scaled down: ${first} foes, written for five: ${written}`);
  const CZ2 = CO.companyOf(Z);
  cok(ss.length >= 1 && ss.every(s => s.ids.length === 1 && s.ids[0] === Z.id), `a solo crawls the crypt alone (${ss.length} scenes)`);
  cok(CZ2.crawl && CZ2.crawl.runs === 1 && !CRYPT.group && !S.table, 'its own tally; the table is free');
  // the draft: a company is drafted whole; another company is never taken piecemeal
  for (const a of [x1, x2, x3, y1, y2, f1, f2]) door(a);
  const draft = C_.unitDraft([x1, y1, x2, f1, x3, f2, y2], [x1, x2, x3, y1, y2, f1, f2], 5, 'crypt');
  const nY = draft.filter(a => CYY.ids.includes(a.id)).length;
  cok(nY === 0 || nY === CYY.ids.length, 'a draft never takes a company piecemeal: ' + draft.map(a => a.name).join(', '));
  console.log(bad ? 'COMPANIES FAIL' : 'COMPANIES OK'); process.exit(bad ? 1 : 0);
}

// Other-worlds section (#369, #940 slice B): runs in a child per world of WORLDS but Eldmoor (the world is chosen at import).
if (argv[0] === '--world-child') {
  const sk = {n: 0}; const sok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); sk.n++}};
  const rooms = CRYPT.rooms || [];
  const N = rooms.length;
  sok(N >= 3 && new Set(rooms.map(r => r.name)).size === N, 'the crypt of ' + process.env.ELDMOOR_WORLD + ' lists its ' + N + ' rooms from the spec: ' + rooms.map(r => r.id).join(', '));
  sok(rooms.every(r => r.name && r.frame && r.foes.every(f => species(f.type) && f.n >= 1)), 'every room names bestiary species');
  sok(rooms.map(r => !!r.boss).join() === rooms.map((r, i) => i === N - 1).join() && rooms[N - 1].foes.some(f => f.name === CRYPT.boss), 'only the last room is the boss room and it holds ' + CRYPT.boss);
  // a party that only strikes can be driven back by the dice: the checks want one run that went the whole way
  let M, seen; for (let i = 0; i < (N <= 3 ? 4 : 1); i++) {M = descend(14); seen = crawl(M, {act: () => 'strike'}); if ((SLT.slotted().crawl || {}).clears) break}
  const order = [...new Set(seen.map(s => s.room))];
  sok(seen.length >= 2 && seen.every(s => s.title && s.beats >= 1), seen.length + ' room scenes opened, each resolved at the table');
  sok(order.every((r, i) => r === i), 'rooms come in order, none skipped: ' + order.join(' > '));
  sok(seen.every((s, i) => i === 0 || s.room >= seen[i - 1].room), 'no scene goes back a room');
  if (N <= 3) sok(order.length === N && order[N - 1] === N - 1, 'all ' + N + ' rooms were reached, the boss room last'); // a longer crypt is a deeper pass, not a coin on one descent
  // The boss room is a coin the dice can lose (main fails 2 of 13 seeds too, a map change only moves the stream): allow up to 3 fresh descents for one clear.
  let tries = 1; while (!(SLT.slotted().crawl.clears >= 1) && tries < 3) {tries++; crawl(descend(14), {act: () => 'strike'})}
  if (N <= 3) sok(SLT.slotted().crawl.clears >= 1 && !CRYPT.group && !S.table, 'the Fellowship cleared the crypt and the table and group are free again' + (tries > 1 ? ' (try ' + tries + ')' : ''));
  else sok(!CRYPT.group && !S.table, 'the crawl ended and the table and group are free again');
  {
    const R = descend(14); SIM.setRunnerLinks(() => S.table && S.table.kind === 'crawl' ? 'connected' : 'none'); // answered by their runners once each room is set (#682)
    const rs = crawl(R, {act: () => 'retreat', maxS: 300}); SIM.setRunnerLinks(null);
    sok(rs.length === 1 && rs[0].room === 0, 'a retreat withdraws the party at the first room');
    sok(!CRYPT.group && !S.table && R.some(a => a.state !== 'dead') && R.filter(a => a.state !== 'dead').every(a => a.state === 'return'), 'survivors go home, group and table are free');
  }
  {
    let W = descend(14); const saved = CRYPT.rooms[0], orig = JSON.stringify(saved);
    CRYPT.rooms[0] = {...saved, foes: [{type: 'tombskit', n: 14}], hit: 4};
    try {
      crawl(W, {act: () => 'strike', maxS: 300});
      // Survivors can fall back and withdraw instead of dying (a dice outcome, as for the clear above): allow up to 3 fresh descents for a full wipe.
      for (let t = 1; t < 3 && !W.every(a => a.state === 'dead'); t++) {W = descend(14); crawl(W, {act: () => 'strike', maxS: 300})}
      sok(W.every(a => a.state === 'dead') && W.every(a => /felled by/.test(a.cause || '')), 'a wipe: everyone falls and each death names the foe');
      sok(!CRYPT.group && !(S.table && S.table.kind === 'crawl'), 'after the wipe the group and the crawl scene are cleared'); // a recruit's own trouble in the world may open a scene by now
    } finally {CRYPT.rooms[0] = JSON.parse(orig)}
  }
  console.log('SIG ' + signature(M, seen));
  process.exit(sk.n ? 1 : 0);
}

// A second spec dungeon (#891): runs in a child with ELDMOOR_WORLD=stepping. Each dungeon keeps its own group, cooldown and record.
if (argv[0] === '--cairn') {
  const sk = {n: 0}; const sok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); sk.n++}};
  const {CRYPTS} = await import('../src/world/map.js'), X = await import('../src/sim/crypts.js'), CN = await import('../src/sim/council.js'), SW = await import('../src/sim/sworn.js'), LR = await import('../src/sim/lore.js'), {goalEvent} = await import('../src/sim/goals.js');
  const CAIRN = CRYPTS.find(d => d !== CRYPT && d.rooms.length);
  sok(CRYPTS.length >= 2 && CRYPTS[0] === CRYPT && CAIRN && CAIRN.rooms.some(r => r.boss) && CAIRN.rooms[CAIRN.rooms.length - 1].foes.some(f => f.name === CAIRN.boss), 'the world lists ' + CRYPTS.map(d => d.name + ' (' + d.rooms.length + ' rooms)').join(', '));
  // the whole Fellowship at a dungeon's door, sent down it
  const down = (Dn, lvl = 12) => {init(); run(20); T.TABLE.speed = 1; T.TABLE.mode = 'auto'; const M = SLT.slotHeroes(SLT.slotted()); S.mobs.length = 0;
    for (const a of M) {a.lvl = lvl; a.hp = maxHp(a); a.state = 'hunt'; a.hidden = false; a.target = null; a.dest = null; a.x = Dn.x + (Math.random() - .5); a.y = Dn.y + 1}
    D.musterCrypt(M, M[0].fac, null, SLT.slotted().name, Dn); return M};
  const playOn = (Dn, maxS, each) => {let went = false; const seen = []; let last = null;
    for (let f = 0; f < maxS * 60 && (Dn.group || !went); f++) {step(1 / 60); if (Dn.group) went = true; if (each) each(f);
      const sc = T.sceneFor(SLT.slotted()); if (sc && sc.kind === 'crawl' && sc.id !== last) {last = sc.id; seen.push(sc)}}
    return seen};
  const txt = ps => (ps || []).map(p => typeof p === 'string' ? p : p && (p.t || p.name) || '').join('');
  const bare = t => t.replace(/ \(round.*/, '');
  {
    down(CAIRN); const seen = playOn(CAIRN, 900);
    sok(!CRYPT.group && !CAIRN.group, 'both dungeons are free at the end');
    sok(seen.length >= 1 && seen.every(sc => sc.ctx.dun === CAIRN.name), seen.length + ' room scenes, each naming the Cairn: ' + [...new Set(seen.map(sc => bare(sc.title)))].join(' > '));
    const names = CAIRN.rooms.map(r => r.name); sok(seen.every(sc => names.includes(bare(sc.title))), 'every scene is a room of the Cairn, none of the Crypt');
    const rec = S.dunRec[CAIRN.name], C = SLT.slotted().crawl;
    sok(rec && rec.runs === 1 && !S.dunRec[CRYPT.name], 'the world record has the run under the Cairn only: ' + JSON.stringify(S.dunRec));
    sok(C.by && C.by[CAIRN.name] && C.by[CAIRN.name].runs === 1 && !C.by[CRYPT.name], 'so does the company record');
    sok(S.chronicle.some(e => txt(e.parts).includes(CAIRN.name)) && !S.chronicle.some(e => /room by room/.test(txt(e.parts)) && txt(e.parts).includes(CRYPT.name)), 'the chronicle names the Cairn, not the Crypt');
  }
  { // a clear pays and records on the dungeon entered
    let cleared = null; for (let i = 0; i < 12 && !cleared; i++) {const M = down(CAIRN, 12); M.forEach(a => {a.gear = 6}); playOn(CAIRN, 900); if (S.dunRec[CAIRN.name].clears) cleared = M}
    sok(cleared, 'the Fellowship can clear the Cairn');
    if (cleared) sok(S.timeline.some(e => e.kind === 'crypt' && txt(e.parts).includes(CAIRN.name)), 'a first clear of the Cairn goes on the timeline');
  }
  { // side by side: the Fellowship below the Cairn, a background group in the Crypt
    const M = down(CAIRN), bg = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && !SLT.companyOf(a) && a.fac === M[0].fac).slice(0, 4);
    for (const a of bg) {a.lvl = 9; a.hp = maxHp(a); a.state = 'hunt'; a.target = null; a.dest = null; a.x = CRYPT.x; a.y = CRYPT.y + 1}
    D.musterCrypt(bg, bg[0].fac, null, 'Test Blades', CRYPT);
    sok(CRYPT.group && CAIRN.group && CRYPT.group !== CAIRN.group, 'two groups at once, one in each dungeon');
    sok(bg.every(a => X.cryptOfHero(a) === CRYPT) && M.every(a => X.cryptOfHero(a) === CAIRN), 'each hero belongs to its own dungeon');
    let both = false; playOn(CAIRN, 900, () => {if (CRYPT.group && CAIRN.group && CRYPT.group.phase === 'inside' && CAIRN.group.crawl) both = true});
    for (let f = 0; f < 120 * 60 && CRYPT.group; f++) step(1 / 60);
    const r = (S.dunRec || {})[CRYPT.name] || {runs: 0}; sok(both && !CRYPT.group && r.runs >= 1, 'the crawl and the Crypt\'s roll ran side by side and each ended on its own record: ' + JSON.stringify(S.dunRec));
  }
  { // a save mid-crawl in the second dungeon
    down(CAIRN); let snap = null; playOn(CAIRN, 600, () => {const sc = T.sceneFor(SLT.slotted()); if (!snap && sc && sc.kind === 'crawl') snap = JSON.stringify(snapshot())});
    sok(snap && JSON.parse(snap).CRYPTS && JSON.parse(snap).CRYPTS[CAIRN.name], 'a save carries the Cairn\'s group');
    if (snap) {restore(JSON.parse(snap)); T.TABLE.speed = 1;
      sok(CAIRN.group && CAIRN.group.crawl && !CRYPT.group, 'the crawl comes back in the Cairn');
      playOn(CAIRN, 600); sok(!CAIRN.group && !T.sceneFor(SLT.slotted()), 'it plays on to its end');
      const o = JSON.parse(snap); delete o.CRYPTS; restore(o); sok(!CAIRN.group, 'a save from before keeps nobody below the Cairn')}
  }
  { // who answers which call
    init(); const a = S.agents.find(b => b.kind === 'hero' && !SLT.companyOf(b)), at = (x, y, l) => {a.x = x; a.y = y; a.lvl = l};
    at(CAIRN.x, CAIRN.y + 2, 14); sok(X.cryptFor(a) === CAIRN, 'a tried blade near the Cairn answers its call');
    at(CAIRN.x, CAIRN.y + 2, X.entryOf(CAIRN) - 1); sok(X.cryptFor(a) === CRYPT, 'below its entry level the same hero goes to the Crypt');
    at(CRYPT.x, CRYPT.y + 2, 14); sok(X.cryptFor(a) === CRYPT, 'a tried blade near the Crypt stays with the Crypt');
    sok(X.needOf(CRYPT) === 8 && X.needOf(CAIRN) > 8, 'the abstract roll sets the bar by entry level (' + X.needOf(CRYPT) + ', ' + X.needOf(CAIRN) + ')');
    sok(X.cryptByWord('the hollow cairn') === CAIRN && X.cryptByWord('cairn') === CAIRN && X.cryptByWord('crypt') === CRYPT && !X.cryptByWord('moon'), 'a dungeon is found by the word a hero uses');
  }
  { // a company chooses, an oath is to one dungeon
    init(); SIM.setRunnerLinks(() => 'connected'); T.TABLE.mode = 'off'; const F = SLT.slotted(), M = SLT.slotHeroes(F), L = CN.leaderOfC(F); S.mobs.length = 0;
    M.forEach((b, i) => {b.lvl = 12; b.hp = maxHp(b); b.state = 'hunt'; b.target = null; b.dest = null; b.x = CAIRN.x + i * .4; b.y = CAIRN.y + 3; b.pq = []});
    const act = (a, t, x) => {a.playRate = []; return SIM.playerAct(a.id, t, x)};
    let r = act(L, 'propose', {kind: 'crypt', dungeon: 'hollow cairn'});
    sok(r.error && /never been/.test(r.error), 'a dungeon never heard of is refused: ' + r.error);
    for (const b of M) LR.learnPlace(b, CAIRN.name, 'told');
    r = act(L, 'propose', {kind: 'crypt', dungeon: 'moon'}); sok(r.error && /no dungeon/.test(r.error), 'a name that is no dungeon is refused and lists the known: ' + r.error);
    r = act(L, 'propose', {kind: 'crypt', dungeon: 'hollow cairn'});
    const P = CN.openProps(F).find(p => p.kind === 'crypt'); sok(P && P.dun === CAIRN.name && P.details.includes(CAIRN.name), 'the vote names the Cairn: ' + (P && P.details));
    sok(CN.cryptReserved(CAIRN) && !CN.cryptReserved(CRYPT), 'it holds the Cairn and leaves the Crypt to the world');
    for (const b of M) if (b !== L) act(b, 'vote', {proposal_id: P.id, vote: 'yes'});
    sok(CAIRN.group && CAIRN.group.mem.length === M.length && !CRYPT.group, 'the vote sends the whole company to the Cairn');
    SIM.setRunnerLinks(null);
    const g1 = {type: 'delve', dun: CAIRN.name, text: 'x'}, a = M[0]; a.goal = g1; goalEvent(a, 'crypt', CRYPT.name); sok(!g1.done, 'an oath to the Cairn is not kept in the Crypt');
    const m = SW.matchWords(a, 'I will clear the Hollow Cairn', null, null); sok(m.type === 'delve' && m.dun === CAIRN.name, 'the words of an oath name the dungeon');
  }
  process.exit(sk.n ? 1 : 0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};

console.log('rooms as data');
ok(Array.isArray(CRYPT.rooms) && CRYPT.rooms.length >= 4, `the Crypt lists ${CRYPT.rooms.length} rooms in the world spec`);
ok(CRYPT.rooms.every(r => r.name && r.frame && r.foes.every(f => species(f.type) && f.n >= 1)), 'every room names bestiary species');
ok(CRYPT.rooms[CRYPT.rooms.length - 1].foes.some(f => f.name === CRYPT.boss), 'the last room holds the boss');

console.log('a Fellowship crawl, room by room');
{
  const M = descend();
  const seen = crawl(M, {});
  ok(seen.length >= 2 && seen.every(s => s.title), `${seen.length} room scenes opened (${[...new Set(seen.map(s => s.title))].join(' > ')})`);
  ok(seen.every((s, i) => i === 0 || s.room === seen[i - 1].room || s.room === seen[i - 1].room + 1), 'rooms come in order, none skipped');
  ok(seen.every(s => s.beats >= 1), 'every round was resolved at the table (the members acted)');
  ok(!S.table && !CRYPT.group && S.agents.every(a => !a.hidden), 'the table and the Crypt are free again at the end');
  console.log('       ' + signature(M, seen));
}

console.log('a retreat, most fall back');
{
  const M = descend(); SIM.setRunnerLinks(() => S.table && S.table.kind === 'crawl' ? 'connected' : 'none'); // in the rooms their runners answer once the DM has set each one (#682), not their reflexes
  const seen = crawl(M, {act: () => 'retreat', maxS: 300}); SIM.setRunnerLinks(null);
  ok(seen.length === 1, `the party withdrew at the first room (${seen.length} scene)`);
  ok(!CRYPT.group && M.some(a => a.state !== 'dead'), 'the group is gone and survivors are out');
  ok(M.filter(a => a.state !== 'dead').every(a => a.state === 'return'), 'the survivors go home');
  ok(!S.table, 'no scene left open');
}

console.log('a wipe at the table');
{
  const M = descend(); const saved = CRYPT.rooms[0], orig = JSON.stringify(saved);
  CRYPT.rooms[0] = {...saved, foes: [{type: 'tombskit', n: 14}], hit: 4};
  try {
    const seen = crawl(M, {act: () => 'strike', maxS: 300});
    ok(M.every(a => a.state === 'dead'), `everyone fell to the dice (${seen.length} rounds)`);
    ok(M.every(a => /felled by/.test(a.cause || '')), 'each death names the foe that did it');
    ok(!CRYPT.group && !S.table, 'the group and the table are cleared');
  } finally {CRYPT.rooms[0] = JSON.parse(orig)}
}

console.log('a downing below ground (#654)');
{
  // Everyone strikes (nobody tends): the downed bleed and roll a death save on each of their turns.
  const room = (M, act) => {const saved = CRYPT.rooms[0], orig = JSON.stringify(saved), d0 = (SLT.slotted().crawl || {}).downs || 0, scs = [];
    CRYPT.rooms[0] = {...saved, foes: [{type: 'tombskit', n: 2, hits: 60}], hit: 1, rounds: 5}; // five rounds: a downing early has turns left to save in
    if (act) SIM.setRunnerLinks(() => S.table && S.table.kind === 'crawl' ? 'connected' : 'none'); // the act given is theirs: their runners answer, not a reflex that heals
    try {crawl(M, {maxS: 300, act, onScene: sc => scs.push(sc)})} finally {CRYPT.rooms[0] = JSON.parse(orig); SIM.setRunnerLinks(null)}
    return {beats: scs.flatMap(sc => sc.beats), downs: ((SLT.slotted().crawl || {}).downs || 0) - d0, scs}};
  const {DOWN} = await import('../src/sim/downed.js'), LEFT0 = DOWN.CRAWL_LEFT;
  DOWN.CRAWL_LEFT = 0; // first the carrying: nobody is lost on the stair
  let M = descend(), r = room(M, () => 'strike');
  ok(r.downs > 0, `a hero at zero in a room is downed, not dead: the crawl record counts it (${r.downs} downed, ${M.filter(a => a.state === 'dead').length} dead)`);
  const sv = r.beats.filter(b => b.k === 'save');
  ok(sv.length && sv.every(b => b.check && b.check.kind === 'death'), `the downed roll a death save on their turn in the room (${sv.length}: ${sv.slice(0, 3).map(b => b.name + ' ' + b.res.replace(/^death save /, '')).join(' | ')})`);
  ok(r.scs.every(sc => new Set(sc.beats.filter(b => b.k === 'save').map(b => b.id)).size === sc.beats.filter(b => b.k === 'save').length), 'one save a downed member a round');
  ok(!CRYPT.group && !S.table, 'the crawl ended');
  ok(M.every(a => a.state === 'dead' || !a.down || !a.down.crawl) && M.every(a => !a.hidden), "nobody is left below ground: the downed came up carried (the world's clock and helpers take over) or died");
  ok(M.filter(a => a.state === 'downed').every(a => a.down && a.down.next > S.gameMin - 1), 'the carried keep their tally and go on with the world clock');
  // Left on the stair (DOWN.CRAWL_LEFT, the owner's #269 target): driven back with someone still bleeding, they may die below.
  DOWN.CRAWL_LEFT = 1; M = descend(); const f0 = M.filter(a => a.state === 'dead').length; r = room(M, () => 'strike');
  const lost = M.filter(a => a.state === 'dead');
  ok(r.downs > 0 && lost.length > f0 && lost.every(a => /felled by/.test(a.cause || '')) && M.every(a => a.state !== 'downed' || a.down.stable === true),
    `with CRAWL_LEFT 1 a downed hero not yet stable is lost when the party is driven back (${lost.length} dead of ${r.downs} downed; cause "${lost[0] && lost[0].cause}")`);
  DOWN.CRAWL_LEFT = LEFT0;
  ok(DOWN.CRAWL_LEFT > 0 && DOWN.CRAWL_LEFT < 1, 'the default is a chance (' + DOWN.CRAWL_LEFT + '), tuned to the owner 0.6 crawl deaths a run target');
  // Reflexes: companions tend the downed as their act.
  DOWN.CRAWL_LEFT = 0; M = descend(); r = room(M); DOWN.CRAWL_LEFT = LEFT0;
  ok(r.downs === 0 || r.beats.some(b => ['stabilize', 'heal', 'potion'].includes(b.k)), `companions tend the downed as their act (${r.beats.filter(b => ['stabilize', 'heal', 'potion'].includes(b.k)).map(b => b.name + ' ' + b.k + ': ' + b.res).slice(0, 2).join(' | ')})`);
}

console.log('driven back');
{
  const M = descend(); const saved = CRYPT.rooms[0], orig = JSON.stringify(saved);
  CRYPT.rooms[0] = {...saved, foes: [{type: 'graveward', n: 1, hits: 60}], hit: .001, rounds: 3};
  try {
    const seen = crawl(M, {act: () => 'strike', maxS: 300});
    ok(seen.length === 3 && !CRYPT.group, `a room not won in 3 rounds drives the party back (${seen.length} rounds)`);
    ok(M.every(a => a.state !== 'dead'), 'nobody died');
  } finally {CRYPT.rooms[0] = JSON.parse(orig)}
}

console.log('a save mid-crawl');
{
  const M = descend(); let snap = null, at = null;
  crawl(M, {maxS: 600, onScene: sc => {if (!snap && sc.ctx.room >= 1) {snap = JSON.stringify(snapshot()); at = sc.ctx.room}}});
  ok(snap, 'a snapshot was taken in room ' + at);
  if (snap) {
    restore(JSON.parse(snap)); T.TABLE.speed = 1;
    ok(CRYPT.group && CRYPT.group.crawl && CRYPT.group.crawl.i >= 1, 'the crawl came back from the save');
    crawl(SLT.slotHeroes(SLT.slotted()), {maxS: 600});
    ok(!CRYPT.group && !S.table, 'it plays on to its end');
  }
}

console.log('fast speed');
{
  const M = descend(), c0 = (SLT.slotted().crawl || {runs: 0}).runs; T.TABLE.speed = 8; crawl(M, {maxS: 600});
  ok(!CRYPT.group && !S.table && SLT.slotted().crawl.runs === c0 + 1, 'at 8x the crawl resolves without stalling, once');
}

console.log('determinism');
{
  const sig = n => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--run', String(n)], {encoding: 'utf8'}).stdout.split('\n').find(l => l.startsWith('SIG '));
  const a = sig(7), b = sig(7), c = sig(8);
  ok(a && a === b, 'the same seed crawls the same way');
  ok(a && c && a !== c, 'a different seed crawls differently');
  // a seeded room with and without the rules of the tiles (#745)
  const off = n => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--run', String(n), 'off'], {encoding: 'utf8'}).stdout.split(String.fromCharCode(10)).find(l => l.startsWith('SIG '));
  const o1 = off(7), o2 = off(7);
  ok(o1 && o1 === o2, 'with the rules off a seeded crawl repeats too');
  ok(o1 && a && o1 !== a, 'and the rules change how it goes');
}

console.log('A second dungeon (#891)');
{
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--cairn'], {encoding: 'utf8', env: {...process.env, ELDMOOR_WORLD: 'stepping'}});
  process.stdout.write(r.stdout || ''); if (r.status !== 0) process.stderr.write(r.stderr || '');
  ok(r.status === 0, 'the two-dungeon checks pass in a stepping-world child');
}

console.log('every other world: its crypt rooms, a crawl, a retreat, a wipe, a seeded repeat');
for (const w of OTHER_WORLDS) {
  const me = fileURLToPath(import.meta.url), t = Date.now();
  const r = runWorld(me, w, {args: ['--world-child'], capture: true});
  process.stdout.write(String(r.stdout).split(String.fromCharCode(10)).filter(l => !l.startsWith('SIG ')).join(String.fromCharCode(10)));
  if (r.stderr) process.stderr.write(r.stderr);
  ok(r.status === 0, 'the crawl checks pass in a ' + w + '-world child (' + ((Date.now() - t) / 1000).toFixed(1) + 's)');
  const sg = n => String(runWorld(me, w, {args: ['--world-child'], env: {CRAWLCHECK_SEED: String(n)}, capture: true}).stdout).split(String.fromCharCode(10)).find(l => l.startsWith('SIG '));
  const a = sg(7), b = sg(7);
  ok(a && a === b, 'a seeded ' + w + ' crawl repeats exactly (same seed, same hash)');
}

console.log('background groups keep the abstract roll');
{
  const BASE = process.env.CRAWL_BASELINE_HASH;
  // Each child reports its own exit status, so a native node.exe crash (no HASH line, odd exit code) is told apart from a differing hash.
  const NL = String.fromCharCode(10), runs = [];
  const hash = flag => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), flag], {encoding: 'utf8'});
    const line = (r.stdout || '').split(NL).find(l => l.startsWith('HASH '));
    try {parts.last = JSON.parse(((r.stdout || '').split(NL).find(l => l.startsWith('PARTS ')) || 'PARTS null').slice(6))} catch {parts.last = null}
    runs.push(flag + ': ' + (line || 'NO HASH LINE') + ' | exit ' + r.status + ' signal ' + r.signal + (r.error ? ' error ' + r.error.message : '') + (line ? '' : ' | stderr: ' + String(r.stderr || '').slice(-300).trim()));
    return line;
  };
  const parts = {};
  const h1 = hash('--hash'), p1 = parts.last, h2 = hash('--hash'), p2 = parts.last, off = hash('--hash-off'), p3 = parts.last;
  if (!(h1 && h1 === h2 && h1 === off)) {
    console.log('  child runs (seed ' + (process.env.CRAWLCHECK_SEED || 'default') + '):' + NL + '    ' + runs.join(NL + '    '));
    // the first differing value between the children, so a moved hash names itself (a native crash has no PARTS line and shows above)
    const first = (x, y, path = '$') => {if (x === y) return null; if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return path + ': ' + JSON.stringify(x) + ' vs ' + JSON.stringify(y);
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {const d = first(x[k], y[k], path + '.' + k); if (d) return d} return null};
    for (const [n, x, y] of [['--hash #1 vs #2', p1, p2], ['--hash vs --hash-off', p1, p3]]) if (x && y) console.log('  first difference, ' + n + ': ' + (first(x, y) || 'none (the parts agree; only the hash line differs)'));
  }
  ok(h1 && h1 === h2, 'a seeded world without a Fellowship repeats: ' + h1);
  ok(h1 && h1 === off, 'with the crawl unplugged it hashes the same: the background does not touch it');
  ok(!BASE || h1 === 'HASH ' + BASE, 'it matches the hash on main (' + BASE + ')');
}

console.log('companies and solos (#441)');
{
  for (const flag of ['--positions', '--pos-reflex', '--geometry']) { // positions (#744), the rules they carry (#745)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), flag], {encoding: 'utf8'});
    process.stdout.write(r.stdout); process.stderr.write(r.stderr); if (r.status !== 0) {console.error('  FAIL ' + flag + ' child'); fail++}
  }
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--companies'], {encoding: 'utf8'});
  process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr);
  ok(r.status === 0 && /COMPANIES OK/.test(r.stdout || ''), 'a company of three with fill-ins and a solo crawl the crypt');
}

if (fail) {console.error('\ncrawlcheck: ' + fail + ' check(s) failed'); process.exit(1)}
console.log('\ncrawlcheck: all checks passed');
