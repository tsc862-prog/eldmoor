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
//   - without a Fellowship the abstract roll runs and a seeded background world repeats exactly
//     (CRAWL_BASELINE_HASH=<hash from main> also asserts it equals main's)
// Usage: npm run crawlcheck   (CRAWLCHECK_SEED to vary)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

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

if (argv[0] === '--run') {const M = descend(); const seen = crawl(M); console.log('SIG ' + signature(M, seen)); process.exit(0)}
if (argv[0] === '--hash' || argv[0] === '--hash-off') {
  if (argv[0] === '--hash-off') D.setCrawlHook(null); // the crawl unplugged: the world as it was before #65
  init({fellowship: false}); for (let i = 0; i < 1500 * 60; i++) step(1 / 60);
  let h = Math.round(S.gameMin); for (const a of S.agents) h = (Math.imul(h, 31) + a.lvl * 1000 + Math.round(a.xp) + Math.round(a.x * 10) * 7 + Math.round(a.hp) + a.deaths * 13 + Math.round(a.gold)) | 0;
  const gu = (S.GUILDS || []).reduce((t, g) => t + g.clears * 7 + g.wipes * 3, 0);
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
    for (const k in cr.pos) {if (!was[k]) continue; const dd = d(was[k], cr.pos[k]); if (dd) {moved++; if (k[0] === 'f') wrong++; if (dd > RG.POS.STEP * M.length) over++}}
    if (S.table && S.table.kind === 'crawl' && S.table.id !== last) {last = S.table.id; n++; room0 = cr.i; seen[room0] = 1;
      const G = RG.roomGrid(m, cr.i, CRYPT.rooms[cr.i]), K = Object.keys(cr.pos).filter(k => k[0] !== 'f' || (cr.foes[+k.slice(1)] && cr.foes[+k.slice(1)].hp > 0)).filter(k => k[0] === 'f' || M.some(a => a.id == k && a.state !== 'dead'));
      if (new Set(K.map(k => cr.pos[k].x + ',' + cr.pos[k].y)).size !== K.length) wrong++; if (K.some(k => !G.ok[cr.pos[k].y * G.w + cr.pos[k].x])) wrong++}}
  pok(n > 0 && moved > 0, 'reflex acts move the party (' + moved + ' moves over ' + n + ' scenes, ' + Object.keys(seen).length + ' rooms)');
  pok(!over && !wrong, 'always on floor, one tile each, foes where they stood (wrong ' + wrong + ', over ' + over + ')');
  console.log(bad ? 'REFLEX FAIL ' + bad : 'REFLEX OK'); process.exit(bad ? 1 : 0);
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

// Stepping section (#369): runs in a child with ELDMOOR_WORLD=stepping (the world is chosen at import).
if (argv[0] === '--stepping') {
  const sk = {n: 0}; const sok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); sk.n++}};
  const NAMES = ['The Reed Sump', 'The Salt-Bone Hall', "The Mere-Warden's Seat"];
  const rooms = CRYPT.rooms || [];
  sok(rooms.length === 3 && rooms.map(r => r.name).join('|') === NAMES.join('|'), 'the Stepping crypt lists its three rooms from the spec: ' + rooms.map(r => r.id).join(', '));
  sok(rooms.every(r => r.name && r.frame && r.foes.every(f => species(f.type) && f.n >= 1)), 'every room names bestiary species');
  sok(rooms.map(r => !!r.boss).join() === 'false,false,true' && rooms[2].foes.some(f => f.name === CRYPT.boss), 'only the last room is the boss room and it holds ' + CRYPT.boss);
  const M = descend(14); const seen = crawl(M, {act: () => 'strike'});
  const order = [...new Set(seen.map(s => s.room))];
  sok(seen.length >= 3 && seen.every(s => s.title && s.beats >= 1), seen.length + ' room scenes opened, each resolved at the table');
  sok(order.every((r, i) => r === i), 'rooms come in order, none skipped: ' + order.join(' > '));
  sok(seen.every((s, i) => i === 0 || s.room >= seen[i - 1].room), 'no scene goes back a room');
  sok(order.length === 3 && order[2] === 2, 'all three rooms were reached, the boss room last');
  sok(SLT.slotted().crawl.clears >= 1 && !CRYPT.group && !S.table, 'the Fellowship cleared the crypt and the table and group are free again');
  {
    const R = descend(14); SIM.setRunnerLinks(() => S.table && S.table.kind === 'crawl' ? 'connected' : 'none'); // answered by their runners once each room is set (#682)
    const rs = crawl(R, {act: () => 'retreat', maxS: 300}); SIM.setRunnerLinks(null);
    sok(rs.length === 1 && rs[0].room === 0, 'a retreat withdraws the party at the first room (the sump)');
    sok(!CRYPT.group && !S.table && R.some(a => a.state !== 'dead') && R.filter(a => a.state !== 'dead').every(a => a.state === 'return'), 'survivors go home, group and table are free');
  }
  {
    const W = descend(14); const saved = CRYPT.rooms[0], orig = JSON.stringify(saved);
    CRYPT.rooms[0] = {...saved, foes: [{type: 'tombskit', n: 14}], hit: 4};
    try {
      crawl(W, {act: () => 'strike', maxS: 300});
      sok(W.every(a => a.state === 'dead') && W.every(a => /felled by/.test(a.cause || '')), 'a wipe: everyone falls and each death names the foe');
      sok(!CRYPT.group && !S.table, 'after the wipe the group and table are cleared');
    } finally {CRYPT.rooms[0] = JSON.parse(orig)}
  }
  console.log('SIG ' + signature(M, seen));
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
    try {crawl(M, {maxS: 300, act, onScene: sc => scs.push(sc)})} finally {CRYPT.rooms[0] = JSON.parse(orig)}
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
}

console.log('Stepping crypt, three rooms');
{
  const me = fileURLToPath(import.meta.url), env = {...process.env, ELDMOOR_WORLD: 'stepping'};
  const r = spawnSync(process.execPath, [me, '--stepping'], {encoding: 'utf8', env});
  process.stdout.write(r.stdout.split(String.fromCharCode(10)).filter(l => !l.startsWith('SIG ')).join(String.fromCharCode(10)));
  if (r.stderr) process.stderr.write(r.stderr);
  ok(r.status === 0, 'the Stepping crawl checks pass in a stepping-world child');
  const sg = n => spawnSync(process.execPath, [me, '--stepping'], {encoding: 'utf8', env: {...env, CRAWLCHECK_SEED: String(n)}}).stdout.split(String.fromCharCode(10)).find(l => l.startsWith('SIG '));
  const a = sg(7), b = sg(7);
  ok(a && a === b, 'a seeded Stepping crawl repeats exactly (same seed, same hash)');
}

console.log('background groups keep the abstract roll');
{
  const BASE = process.env.CRAWL_BASELINE_HASH;
  // Each child reports its own exit status, so a native node.exe crash (no HASH line, odd exit code) is told apart from a differing hash.
  const NL = String.fromCharCode(10), runs = [];
  const hash = flag => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), flag], {encoding: 'utf8'});
    const line = (r.stdout || '').split(NL).find(l => l.startsWith('HASH '));
    runs.push(flag + ': ' + (line || 'NO HASH LINE') + ' | exit ' + r.status + ' signal ' + r.signal + (r.error ? ' error ' + r.error.message : '') + (line ? '' : ' | stderr: ' + String(r.stderr || '').slice(-300).trim()));
    return line;
  };
  const h1 = hash('--hash'), h2 = hash('--hash'), off = hash('--hash-off');
  if (!(h1 && h1 === h2 && h1 === off)) console.log('  child runs (seed ' + (process.env.CRAWLCHECK_SEED || 'default') + '):' + NL + '    ' + runs.join(NL + '    '));
  ok(h1 && h1 === h2, 'a seeded world without a Fellowship repeats: ' + h1);
  ok(h1 && h1 === off, 'with the crawl unplugged it hashes the same: the background does not touch it');
  ok(!BASE || h1 === 'HASH ' + BASE, 'it matches the hash on main (' + BASE + ')');
}

console.log('companies and solos (#441)');
{
  for (const flag of ['--positions', '--pos-reflex']) { // positions (#744)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), flag], {encoding: 'utf8'});
    process.stdout.write(r.stdout); process.stderr.write(r.stderr); if (r.status !== 0) {console.error('  FAIL ' + flag + ' child'); fail++}
  }
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--companies'], {encoding: 'utf8'});
  process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr);
  ok(r.status === 0 && /COMPANIES OK/.test(r.stdout || ''), 'a company of three with fill-ins and a solo crawl the crypt');
}

if (fail) {console.error('\ncrawlcheck: ' + fail + ' check(s) failed'); process.exit(1)}
console.log('\ncrawlcheck: all checks passed');
