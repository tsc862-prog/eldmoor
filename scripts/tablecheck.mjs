// Fellowship phase B check (issue #68): Table mode, the council and the party as one unit, with
// mock agents (no model, no network). Five members, all agent-played (#148): one whose runner answers,
// one whose runner is connected but silent, three with no runner (mock link states, sim/runlink.js).
//   - a rescue scene at 1x pauses the world and waits for the silent but connected agent (nudged, no
//     reflex) until it answers; reflex only for members with no runner; a runner gone holds the table
//     until the owner resumes; a live agent that never answers falls to reflex after TABLE.liveMs;
//     a save taken mid-scene resumes the scene
//   - at 3x a scene with agents to decide holds and asks the host for 1x (TABLE.drop); a host that never
//     drops resolves it after TABLE.dropS; a reflex-only table resolves at once
//   - proposals: a decision scene that waits for the silent agent's vote; outside a scene the vote holds
//     past PROP_MIN for a live agent (HOLD_MIN, with notices) and for an absent runner until the owner
//     resumes; all votes in; at 3x a proposal drops to 1x and becomes a scene
//   - lead_to: the leader leads, the party follows (the silent agent too)
//   - the Crypt: the Fellowship is drafted all together or not at all; an agent party is asked
//     first (a proposal) and goes together when it votes yes
//   - staged scenes (issue #132, a child with a fresh world): the DM agent stages each kind (elite,
//     ambush, meeting, trap, mystery, social); the cast meets the party and a paused scene opens;
//     a mock DM answers every at-the-table call; a silent DM is filled by the scripted DM after
//     its budget (then at once); no runner = no wait; 3x resolves at once; a save mid-scene; expiry
//   - without a Fellowship, two seeded runs are identical (determinism)
// Usage: npm run tablecheck   (TABLECHECK_SEED to vary the world)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

let seed = 0x9e3779b9 ^ (Number(process.env.TABLECHECK_SEED) || 68);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const F_ = await import('../src/sim/fellowship.js');
const T = await import('../src/sim/table.js');
const TRD = await import('../src/sim/tableround.js');
const C = await import('../src/sim/council.js');
const {CRYPT, ZONES, zoneFor, zonePoint, dist} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');
const {score} = await import('../src/sim/abilities.js');

// ---- determinism child: a seeded world without a Fellowship, hashed ----
if (process.argv[2] === '--hash') {
  init({fellowship: false}); for (let i = 0; i < 180 * 60; i++) step(1 / 60);
  let h = Math.round(S.gameMin); for (const a of S.agents) h = (Math.imul(h, 31) + a.lvl * 1000 + Math.round(a.xp) + Math.round(a.x * 10) * 7 + Math.round(a.hp)) | 0;
  console.log('HASH ' + h + ' table:' + (S.table ? 1 : 0) + ' fellowship:' + (S.fellowship ? 1 : 0)); process.exit(0);
}

// ---- determinism child with a split Fellowship (#182): shouts, a meeting plan and a courier, hashed ----
if (process.argv[2] === '--hash-talk') {
  init(); for (let i = 0; i < 60 * 60; i++) step(1 / 60);
  const L = F_.fellows(), a = L[0], b = L[L.length - 1], g = homeOf(a).gate;
  for (const x of L) {x.x = g.x; x.y = g.y - 1; x.state = 'town'} b.x = g.x < 40 ? g.x + 30 : g.x - 30; a.gold = 100;
  C.makeMeeting(a, 'the ford', 4); P.playerAct(a.id, 'send_courier', {to: b.name, text: 'Come to the ford.'}); C.partySay(a, 'Onward.');
  for (let i = 0; i < 120 * 60; i++) step(1 / 60);
  let h = Math.round(S.gameMin); for (const x of S.agents) h = (Math.imul(h, 31) + x.lvl * 1000 + Math.round(x.xp) + Math.round(x.x * 10) * 7 + Math.round(x.hp) + (x.chat || []).length) | 0;
  const Fs = S.fellowship; console.log('HASH ' + h + ' plans:' + (Fs.plans || []).map(p => p.status).join(',') + ' post:' + (Fs.post || []).length); process.exit(0);
}

// ---- the answer-order child (everyone at once): a staged trap, all five agents answer, forward or reverse ----
if (process.argv[2] === '--simul') {
  const {dmAct, setDmSeat} = SIM, rev = process.argv[3] === 'rev';
  init({fellowship: false}); for (let i = 0; i < 30 * 60; i++) step(1 / 60);
  for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
  F_.found(F_.autoPick(0), {fac: 0, ai: false}); setDmSeat(true); SIM.setRunnerLinks(() => 'connected');
  const M = F_.fellowshipMembers().map(m => m.hero), home = homeOf(M[0]).gate, spot = zonePoint(zoneFor(8, home), null, home);
  for (const m of S.mobs) if (m.alive && dist(m, spot) < 16) {m.alive = false; m.gone = true}
  M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = Math.round(maxHp(x) * (.5 + i * .1)); x.pq = []});
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  const r = dmAct('stage_scene', {kind: 'trap', near: 'fellowship', frame: 'Fresh earth across the path, raked too smooth.', cast: {trap: 'spikes'}, reason: 'order'});
  let f = 0; while (!(S.table && S.table.phase === 'turn') && f++ < 60 * 120) step(1 / 60);
  const sc = S.table; if (!r.ok || !sc) {console.log('NO SCENE ' + (r.error || '')); process.exit(1)}
  const pick = ['spot', 'disarm', 'round', 'spot', 'disarm'], ids = rev ? sc.ids.slice().reverse() : sc.ids.slice();
  for (const id of ids) {for (let k = 0; k < 20; k++) step(1 / 60); P.playerAct(id, 'scene_act', {option: pick[sc.ids.indexOf(id)]})}
  while (S.table && f++ < 60 * 240) step(1 / 60);
  console.log('ORDER ' + JSON.stringify(sc.beats.map(b => [b.id, b.k, b.by, b.res])) + ' ' + sc.summary + ' hp:' + M.map(x => Math.round(x.hp)).join(','));
  process.exit(0);
}

// ---- the combat-rounds answer-order child (#276): five live agents answer each round, forward or reverse ----
if (process.argv[2] === '--rounds') {
  const rev = process.argv[3] === 'rev';
  init({fellowship: false}); for (let i = 0; i < 30 * 60; i++) step(1 / 60);
  for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
  F_.found(F_.autoPick(0), {fac: 0, ai: false}); SIM.setRunnerLinks(() => 'connected');
  const M = F_.fellowshipMembers().map(m => m.hero), home = homeOf(M[0]).gate, spot = zonePoint(zoneFor(8, home), null, home);
  for (const m of S.mobs) if (m.alive && dist(m, spot) < 16) {m.alive = false; m.gone = true}
  M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'fight'; x.hidden = false; x.dest = null; x.hp = Math.round(maxHp(x) * (.6 + i * .1)); x.pq = []});
  const q = S.mobs.find(x => x.alive && !x.gone && !x.elite); q.x = spot.x + 1; q.y = spot.y; q.lvl = 9; q.maxhp = 2000; q.hp = 2000; q.cd = 99; q.fledOnce = true; q.target = M[0]; M.forEach(x => {x.target = q});
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  if (process.argv[3] === 'fall') { // one member alone in reach at 1 HP, a hard-hitting foe that goes first
    M.slice(1).forEach(x => {x.x = spot.x + 40}); q.lvl = 12; q.hit = 50; const lone = M[0]; lone.hp = 1;
    const sf = T.openScene('elite', 'Fall test', ['A brute.'], {mob: q.id}); sf.foeAt = 0; let g = 0;
    while (S.table && g++ < 60 * 120) {const c = S.table; if (c.phase === 'turn' && !c.acts[lone.id] && lone.state !== 'dead') P.playerAct(lone.id, 'scene_act', {option: 'strike'}); step(1 / 60)}
    const good = !S.table && lone.state === 'dead' && (sf.fell || []).includes(lone.id) && / fell./.test(sf.summary) && sf.rd <= TRD.TR.ROUNDS;
    console.log((good ? 'FALL ok' : 'FALL bad') + ' (round ' + sf.rd + '): ' + sf.summary); process.exit(0);
  }
  const sc = T.openScene('elite', 'Order test', ['A brute.'], {mob: q.id}); let f = 0;
  while (S.table && f++ < 60 * 240) {const c = S.table;
    if (c.phase === 'turn') {const ids = rev ? c.ids.slice().reverse() : c.ids.slice(); for (const id of ids) if (!c.acts[id]) P.playerAct(id, 'scene_act', {option: 'strike'})}
    step(1 / 60)}
  console.log('ROUNDS ' + JSON.stringify(sc.beats.map(b => [b.id, b.rd, b.k, b.by, b.res])) + ' ' + sc.summary + ' hp:' + M.map(x => Math.round(x.hp)).join(',') + ' foe:' + Math.round(q.hp));
  process.exit(0);
}

// ---- parley and conditions (#296), in a child with a fresh world: node scripts/tablecheck.mjs --parley ----
// The dice are the world's seeded LCG (Math.random above); forceNext(v) rewinds it so the very next roll is v, which lets
// the check pin a natural 20 or a natural 1 on a parley or a save without stubbing the game.
if (process.argv[2] === '--parley') {
  const {MOBS} = await import('../src/data/mobs.js'), E = await import('../src/sim/eff.js'), MV = await import('../src/sim/moves.js'), {MOVES, MOVE_CONDS} = await import('../src/data/moves.js');
  let fail = 0; const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
  const inv = (() => {let a = 1664525n, m = 1n << 32n, [r0, r1, s0, s1] = [a, m, 1n, 0n]; while (r1) {const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]} return ((s0 % m) + m) % m})();
  const forceNext = v => {const t = BigInt(Math.min(4294967295, Math.floor(v * 4294967296))); seed = Number((((t - 1013904223n) % (1n << 32n) + (1n << 32n)) * inv) % (1n << 32n))};
  const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
  init({fellowship: false}); run(30);
  for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
  F_.found(F_.autoPick(0), {fac: 0, ai: false}); SIM.setRunnerLinks(() => 'connected');
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  let M = F_.fellowshipMembers().map(m => m.hero); const home = homeOf(M[0]).gate, spot = zonePoint(zoneFor(8, home), null, home);
  const byId = id => S.agents.find(x => x.id === id);
  for (const m of S.mobs) if (m.alive && dist(m, spot) < 16) {m.alive = false; m.gone = true}
  const fam = m => TRD.canParley(m);
  const pick = want => S.mobs.find(m => m.alive && !m.gone && !m.elite && !m.used && (want === 'talker' ? fam(m) : !fam(m)));
  const setup = (q, opt = {}) => {q.used = true; M = M.map(x => byId(x.id));
    M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'fight'; x.hidden = false; x.dest = null; x.hp = maxHp(x); x.pq = []; x.target = q; x.eff = {}; x.mcr = {}});
    q.x = spot.x + 1; q.y = spot.y; q.lvl = opt.lvl || 9; q.maxhp = 4000; q.hp = opt.hp || 4000; q.cd = 99; q.fledOnce = true; q.hit = .001; q.target = M[0]; q.eff = {}; q.ab = opt.ab || []; // tricks only where a case asks for them
    S.fellowship.tableSeen = {}; const sc = T.openScene('elite', 'Talk test', ['A rough voice from the brush.'], {mob: q.id}); sc.foeAt = sc.ids.length; return sc};
  const toTurns = () => {let g = 0; while (S.table && S.table.phase === 'frame' && g++ < 600) step(1 / 60)};
  const strikeAll = () => {const c = S.table; if (c && c.phase === 'turn') for (const id of c.ids) if (!c.acts[id]) P.playerAct(id, 'scene_act', {option: 'strike'})};
  const finish = (maxS = 60) => {let g = 0; while (S.table && g++ < 60 * maxS) {strikeAll(); step(1 / 60)}};
  const tableText = () => {const e = S.dmLog.filter(x => x.kind === 'table')[0]; return e ? e.summary.join('') : ''};

  // (a) parley is a legal action on an intelligent foe only, offered once a fight
  const talker = pick('talker'), beast = pick('beast');
  ok(talker && beast, `a talker (${talker && MOBS[talker.type].name}) and a beast (${beast && MOBS[beast.type].name}) to test with`);
  let sc = setup(beast); toTurns();
  ok(!T.optionsFor(sc, M[0]).some(o => o.k === 'parley'), 'a beast cannot be talked to: no parley option');
  T.TABLE.mode = 'off'; T.tableHold(0); T.TABLE.mode = 'auto'; ok(!S.table, 'the beast scene closes');
  sc = setup(talker); toTurns();
  const spk = byId(sc.ids[0]), o1 = T.optionsFor(sc, spk).find(o => o.k === 'parley'), tv = P.playerAct(spk.id, 'status', {}).table;
  ok(o1 && /^Talk .+ down \((persuasion|intimidation), once a fight\)$/.test(o1.text) && tv && tv.options.some(s => /^parley = /.test(s)), `parley is offered against ${MOBS[talker.type].name}: ${o1 && o1.text}`);
  // (b) the legal action through scene_act: its result agrees with its dice, in the beat, the banner and the DM log
  const ans = P.playerAct(spk.id, 'scene_act', {option: 'parley', line: 'Put it down and walk away.'});
  ok(ans && !ans.error, 'scene_act parley is accepted');
  step(1 / 60); const pb = sc.beats.find(b => b.k === 'parley'), ck = pb && pb.check;
  const want = ck && (ck.die === 20 || (ck.hit && ck.total - ck.vs >= 5) ? 'yield' : ck.hit ? 'flee' : 'hold');
  ok(pb && ck && ck.kind === 'parley' && ck.result === want && ck.total === ck.die + ck.mod && /^(persuasion|intimidation) d20 \d+[+-]\d+=\d+ vs DC \d+/.test(pb.res) && !pb.roll,
    `the parley is a dice line with its check as data: ${pb && pb.res} -> ${ck && ck.result}`);
  ok(T.bannerOf() && /Talk .+ down/.test(T.bannerOf().last || ''), `the banner shows it: ${T.bannerOf() && T.bannerOf().last}`);
  finish(); ok(!S.table && /parleys with .+ \((persuasion|intimidation) d20 \d+[+-]\d+ vs DC \d+\): it /.test(tableText()), `the DM log has it: ${(tableText().match(/[^:;.]*parleys with[^;.]*/) || [''])[0]}`);
  // (c) a natural 20 on the tongue: it yields, the scene ends, it leaves the party be
  const t2 = pick('talker'); sc = setup(t2); toTurns(); let s2 = byId(sc.ids[0]);
  forceNext(.999); const r20 = TRD.parley(sc, s2, [t2], M);
  ok(/d20 20/.test(r20) && sc.end === 'yield' && t2.target === null && t2.spared > S.gameMin && M.every(x => x.target !== t2), `a natural 20: ${r20}`);
  finish();
  ok(!S.table && new RegExp('yields and breaks off at ' + s2.name + "'s words").test(sc.summary), `the scene ends on it: ${sc.summary}`);
  run(5); ok(t2.target === null && M.every(x => byId(x.id).target !== t2), 'the spared foe does not pick the fight up again');
  // (d) a natural 1: it holds, turns on the speaker, the fight goes on, and that member cannot parley again this fight
  const t3 = pick('talker'); sc = setup(t3); toTurns(); s2 = byId(sc.ids[0]);
  forceNext(0); const r1 = TRD.parley(sc, s2, [t3], M);
  ok(/d20 1[^0-9]/.test(r1) && !sc.end && t3.target === s2 && !T.optionsFor(sc, s2).some(o => o.k === 'parley') && T.optionsFor(sc, byId(sc.ids[1])).some(o => o.k === 'parley'), `a natural 1: ${r1}`);
  T.TABLE.mode = 'off'; T.tableHold(0); T.TABLE.mode = 'auto';

  // (e) a move lays a condition at the Table on a failed save (the move's own save), never in real time
  let mvr = null; for (const x of M) for (const id of MV.movesOf(x)) if (MOVE_CONDS[id] && !mvr) mvr = {x, id};
  ok(mvr, `a member with a condition move (${mvr && mvr.x.name}: ${mvr && MOVES[mvr.id].name})`);
  if (mvr) {const tg = pick('beast'); tg.used = true; tg.x = spot.x + 1; tg.y = spot.y; tg.lvl = 1; tg.maxhp = 4000; tg.hp = 4000; tg.eff = {}; mvr.x.x = spot.x; mvr.x.y = spot.y; mvr.x.state = 'fight'; mvr.x.target = tg;
    const st = MOVES[mvr.id].save.stat, keep = mvr.x.abil[st]; mvr.x.abil[st] = 40; mvr.x.mcr = {}; mvr.x.mcd = {};
    const rr = MV.useMove(mvr.x, mvr.id, tg, {mode: 'round', mates: M}), c = MOVE_CONDS[mvr.id];
    ok(rr.ok && E.condOn(tg, c) && tg.eff[c].dc >= 21 && tg.eff[c].by === mvr.x.id, `${MOVES[mvr.id].name} at the Table leaves the foe ${c} (${rr.text})`);
    E.clearRounds(tg); mvr.x.mcr = {}; mvr.x.mcd = {};
    const rs = MV.useMove(mvr.x, mvr.id, tg, {mode: 'sec', mates: M});
    ok(rs.ok && !E.condsOf(tg).length, `in real time it leaves none (${rs.text})`);
    mvr.x.abil[st] = keep; mvr.x.mcd = {}; mvr.x.mcr = {}}

  // (f) four conditions across rounds, a save and restore mid-scene, and all of them gone with the scene
  const t4 = pick('beast'); sc = setup(t4, {lvl: 20}); const [X, Y, Z, W] = sc.ids.map(byId);
  E.setCond(X, 'poison', 2, 99, 5, t4.id); E.setCond(Y, 'stun', 1, 99, 0, t4.id); E.setCond(Z, 'root', 2, 99, 0, t4.id); E.setCond(t4, 'root', 2, 99, 0, X.id);
  W.eff.taken = {v: .7, u: 0, r: 3};
  const bn = T.bannerOf(), tvx = P.playerAct(X.id, 'status', {}).table;
  ok(bn.conds[X.id].includes('poison') && bn.conds[Y.id].includes('stun') && bn.conds[Z.id].includes('root') && bn.conds[W.id].includes('ward') && bn.foe.conds.includes('root'), `the banner has each condition as data: ${JSON.stringify(bn.conds)} foe ${JSON.stringify(bn.foe.conds)}`);
  ok(tvx && tvx.your_conditions.includes('poisoned') && tvx.foe.conditions.includes('rooted'), `a member reads them in words: ${tvx && tvx.your_conditions} / foe ${tvx && tvx.foe.conditions}`);
  ok(!T.optionsFor(sc, Z).some(o => o.k === 'retreat') && T.optionsFor(sc, X).some(o => o.k === 'retreat'), 'a rooted member cannot fall back');
  toTurns(); let g = 0; const hp0 = X.hp;
  while (S.table && S.table.rd === 1 && g++ < 60 * 60) {strikeAll(); step(1 / 60)}
  const r1b = sc.beats.filter(b => (b.rd || 1) === 1), yb = r1b.filter(b => b.id === Y.id);
  const stunB = yb.find(b => b.k === 'stunned' || b.k === 'unstun');
  ok(stunB && /^save d20 \d+[+-]\d+=\d+ vs DC 99: (held|shaken off)$/.test(stunB.res) && stunB.check && stunB.check.kind === 'save' && (stunB.k === 'unstun' || !yb.some(b => b.k === 'strike')) && !E.condOn(Y, 'stun'),
    `the stun is checked on ${Y.name}'s turn: ${stunB && stunB.text} (${stunB && stunB.res})`);
  const fa = r1b.filter(b => b.by === 'foe' && b.k === 'attack');
  ok(fa.length && fa.every(b => b.roll && b.roll.mod === TRD.hitOf(t4) - TRD.COND.ROOT_HIT), `a rooted foe strikes ${TRD.COND.ROOT_HIT} worse (mod ${fa[0] && fa[0].roll.mod} for hit ${TRD.hitOf(t4)})`);
  const pz = r1b.find(b => b.k === 'poison' && b.id === X.id), ps = r1b.find(b => b.k === 'poison' && b.id === X.id && b.check);
  ok(S.table && S.table.rd === 2 && pz && pz.res === '5 damage' && ps && /^save d20/.test(ps.res), `round 1 ends: the poison bites ${X.name} (${pz && pz.res}) and is saved against (${ps && ps.res})`);
  ok(r1b.some(b => b.k === 'root' && b.id === Z.id && b.check) && r1b.some(b => b.k === 'root' && b.id === 'foe' && b.check), 'rooted member and rooted foe save at the end of the round');
  ok(['poison', 'root'].every(c => !E.condOn(X, c) || X.eff.poison.r === 1) && (!E.condOn(Z, 'root') || Z.eff.root.r === 1) && (!E.condOn(t4, 'root') || t4.eff.root.r === 1) && W.eff.taken.r === 2, 'what holds runs down a round (the ward with it)');
  const was = JSON.stringify([X.eff, Z.eff, t4.eff, W.eff]), sid = sc.id;
  const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
  const sc2 = S.table, X2 = byId(X.id), Z2 = byId(Z.id), W2 = byId(W.id), t42 = S.mobs.find(m => m.id === t4.id);
  ok(sc2 && sc2.id === sid && sc2.rd === 2 && JSON.stringify([X2.eff, Z2.eff, t42.eff, W2.eff]) === was, 'a save mid-scene keeps the round and every condition');
  M = M.map(x => byId(x.id)); finish();
  ok(!S.table && sc2.phase !== 'turn' && [...M, t42].every(e => !E.condsOf(e).length && !['stun', 'root', 'poison'].some(k => e.eff && e.eff[k])), `the scene ends (${sc2.rd} rounds) and every condition ends with it: ${sc2.summary}`);
  ok(/still poisoned|purges the poison/.test(tableText()) && /save d20/.test(tableText()), 'the DM log has the saves');

  // (g) a creature's trick lays its condition when the blow lands (venom), with a save, at most once every TRICK_GAP rounds
  const t5 = pick('beast'); sc = setup(t5, {lvl: 20, ab: ['venom']}); toTurns(); finish();
  const trick = sc.beats.filter(b => b.by === 'foe' && /poisons |shrugs off its Venom/.test(b.res || ''));
  const landed = sc.beats.filter(b => b.by === 'foe' && /: hit for/.test(b.res || '')).length;
  ok(landed === 0 || (trick.length >= 1 && trick.length <= Math.ceil(sc.rd / TRD.COND.TRICK_GAP) && trick.every(b => /save d20 \d+[+-]\d+=\d+ vs DC \d+/.test(b.res))), `venom: ${trick.length} trick(s) in ${sc.rd} rounds, ${landed} blows landed: ${trick[0] && trick[0].res}`);
  console.log('PARLEY ' + (fail ? 'FAIL ' + fail : 'OK'));
  process.exit(fail ? 1 : 0);
}

// ---- an item from the pack as a round's act (#360), in a child with a fresh world: node scripts/tablecheck.mjs --use ----
if (process.argv[2] === '--use') {
  const E = await import('../src/sim/eff.js'), INV = await import('../src/sim/inv.js'), {actionLog} = await import('../src/sim/actlog.js');
  let fail = 0; const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
  const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
  init({fellowship: false}); run(30);
  for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
  F_.found(F_.autoPick(0), {fac: 0, ai: false}); SIM.setRunnerLinks(() => 'connected');
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  let M = F_.fellowshipMembers().map(m => m.hero); const home = homeOf(M[0]).gate, spot = zonePoint(zoneFor(8, home), null, home);
  const byId = id => S.agents.find(x => x.id === id);
  for (const m of S.mobs) if (m.alive && dist(m, spot) < 16) {m.alive = false; m.gone = true}
  const setup = () => {const q = S.mobs.find(m => m.alive && !m.gone && !m.elite && !m.used && !TRD.canParley(m)); q.used = true; M = M.map(x => byId(x.id));
    M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'fight'; x.hidden = false; x.dest = null; x.hp = maxHp(x); x.pq = []; x.target = q; x.eff = {}; x.mcr = {}; x.wardT = 0; x.potCd = 0; x.inv = {list: []}});
    q.x = spot.x + 1; q.y = spot.y; q.lvl = 9; q.maxhp = 4000; q.hp = 4000; q.cd = 99; q.fledOnce = true; q.hit = .001; q.target = M[0]; q.eff = {}; q.ab = [];
    S.fellowship.tableSeen = {}; const sc = T.openScene('elite', 'Pack test', ['Something stirs in the reeds.'], {mob: q.id}); sc.foeAt = sc.ids.length;
    let g = 0; while (S.table && S.table.phase === 'frame' && g++ < 600) step(1 / 60); return sc};
  const close = () => {T.TABLE.mode = 'off'; T.tableHold(0); T.TABLE.mode = 'auto'};
  const uses = (sc, a) => T.optionsFor(sc, a).filter(o => o.k.startsWith('use:'));
  const tableText = () => {const e = S.dmLog.filter(x => x.kind === 'table')[0]; return e ? e.summary.join('') : ''};

  // (a) nothing usable in a fight (an empty pack, or only bandages, rations, a torch), and a potion with nobody hurt: no option
  let sc = setup(); const A = byId(sc.ids[0]);
  ok(!uses(sc, A).length, 'an empty pack offers no use option');
  INV.addUse(A, 'Linen Bandage', 2); INV.addUse(A, 'Trail Ration', 1); INV.addUse(A, 'Pitch Torch', 1); INV.addUse(A, 'Redroot Draught', 1);
  ok(!uses(sc, A).length, `bandages, rations, a torch and a potion with nobody hurt: nothing to use (${T.optionsFor(sc, A).map(o => o.k).join(', ')})`);
  // (b) hurt: the potion is offered by name (status too); scene_act takes the item's name; drunk once, logged, on the banner and in the DM log
  A.hp = Math.round(maxHp(A) * .5); const o = uses(sc, A), tv = P.playerAct(A.id, 'status', {}).table;
  ok(o.length === 1 && o[0].k === 'use:redroot-draught' && /^Use Redroot Draught on yourself \(50%; heals 35%\)$/.test(o[0].text) && tv && tv.options.some(s => /^use:redroot-draught = Use Redroot Draught/.test(s)), `a hurt member is offered its potion: ${o[0] && o[0].k} = ${o[0] && o[0].text}`);
  const ans = P.playerAct(A.id, 'scene_act', {option: 'use:Redroot Draught', line: 'One swallow.'});
  ok(ans && !ans.error, 'scene_act use:<item name> is accepted' + (ans && ans.error ? ': ' + ans.error : ''));
  const hp0 = A.hp; let g = 0; while (S.table && !sc.beats.some(b => b.id === A.id) && g++ < 600) step(1 / 60);
  const ub = sc.beats.find(b => b.id === A.id);
  ok(ub && ub.k === 'use:redroot-draught' && ub.use && ub.use.item === 'Redroot Draught' && ub.use.ok && ub.use.healed > 0 && /^Drank Redroot Draught: \+\d+ health/.test(ub.res) && !ub.roll, `the beat names the item and its effect: ${ub && ub.text} (${ub && ub.res})`);
  ok(INV.count(A, 'Redroot Draught') === 0 && A.hp > hp0 && INV.count(A, 'Linen Bandage') === 2, `used once and gone from the pack (+${Math.round(A.hp - hp0)} health)`);
  const il = actionLog(A, {kinds: ['item']}); ok(il.length && il[il.length - 1].name === 'Redroot Draught', 'the action log has the item');
  const bl = T.bannerOf(); ok(sc.beats[sc.beats.length - 1] === ub && bl && /^.+: Use Redroot Draught on yourself .*\(Drank Redroot Draught: \+\d+ health\.\)$/.test(bl.last || ''), `the banner line names it: ${bl && bl.last}`);
  ok(!uses(sc, A).length, 'nothing left to use: the option is gone');
  let k = 0; while (S.table && k++ < 60 * 60) {const c = S.table; if (c.phase === 'turn') for (const id of c.ids) if (!c.acts[id]) P.playerAct(id, 'scene_act', {option: 'strike'}); step(1 / 60)}
  ok(!S.table && new RegExp(A.name + ' uses Redroot Draught \\(\\+\\d+ health\\)').test(tableText()), `the DM log has it: ${(tableText().match(/[^:;.]*uses Redroot[^;.]*/) || [''])[0]}`);
  // (c) a companion's potion for the hurt member; a bare 'use' takes the first item offered
  sc = setup(); const [C, D] = sc.ids.map(byId); INV.addUse(D, 'Redroot Draught', 2); C.hp = Math.round(maxHp(C) * .3);
  const pty = C.party, dty = D.party; D.party = null; ok(!uses(sc, D).length, 'out of one party: no potion for the other'); C.party = D.party = pty || {id: 'usecheck', mem: [C, D]};
  const od = uses(sc, D); ok(od.length === 1 && new RegExp('^Use Redroot Draught on ' + C.name + ' \\(30%').test(od[0].text), `a full-health member offers its potion to the hurt one: ${od[0] && od[0].text}`);
  const bare = P.playerAct(D.id, 'scene_act', {option: 'use'}); ok(bare && !bare.error && sc.acts[D.id] && sc.acts[D.id].k === 'use:redroot-draught', 'a bare use picks the item offered');
  const c0 = C.hp, r1 = TRD.useInRound(sc, D, 'use:redroot-draught', C); ok(C.hp > c0 && INV.count(D, 'Redroot Draught') === 1 && /^Gave Redroot Draught to /.test(r1), `given across the table: ${r1}`);
  C.party = pty; D.party = dty;
  close();
  // (d) an antidote for the round's poison, a warding scroll while no ward holds, a recall scroll out of the fight (not when rooted)
  sc = setup(); const [X, Y, Z] = sc.ids.map(byId);
  INV.addUse(X, 'Bogroot Antidote', 1); ok(!uses(sc, X).length, 'an antidote with no poison: not offered');
  E.setCond(X, 'poison', 2, 99, 5, null); const ox = uses(sc, X); ok(ox.length === 1 && ox[0].k === 'use:bogroot-antidote', `poisoned: the antidote is offered (${ox[0] && ox[0].text})`);
  const rx = TRD.useInRound(sc, X, 'use:bogroot-antidote', null); ok(!E.condOn(X, 'poison') && INV.count(X, 'Bogroot Antidote') === 0 && sc.ru && sc.ru.item === 'Bogroot Antidote', `the poison is drawn out: ${rx}`);
  INV.addUse(Y, 'Scroll of the Steadfast Hour', 1); ok(uses(sc, Y).length === 1, `a warding scroll is offered: ${uses(sc, Y)[0] && uses(sc, Y)[0].text}`);
  const ry = TRD.useInRound(sc, Y, 'use:scroll-of-the-steadfast-hour', null); ok(Y.wardT > 0 && INV.count(Y, 'Scroll of the Steadfast Hour') === 0, `the ward holds: ${ry}`);
  INV.addUse(Y, 'Scroll of the Steadfast Hour', 1); ok(!uses(sc, Y).length, 'a second ward is not offered while one holds');
  INV.addUse(Z, 'Scroll of Hearthward', 1); E.setCond(Z, 'root', 2, 99, 0, null); ok(!uses(sc, Z).length, 'rooted: no recall scroll');
  E.endCond(Z, 'root'); ok(uses(sc, Z).length === 1, 'free again: the recall scroll is offered');
  const rz = TRD.useInRound(sc, Z, 'use:scroll-of-hearthward', null); ok(Z.state === 'return' && (sc.out || []).includes(Z.id) && INV.count(Z, 'Scroll of Hearthward') === 0, `read out of the fight: ${rz}`);
  close();
  console.log('USE ' + (fail ? 'FAIL ' + fail : 'OK'));
  process.exit(fail ? 1 : 0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});

// ---- staged scenes (issue #132), in a child with a fresh world: node scripts/tablecheck.mjs --staged ----
if (process.argv[2] === '--staged') {
  const {dmAct, setDmSeat} = SIM;
  const ST = await import('../src/sim/staged.js');
  init({fellowship: false}); run(30);
  for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
  F_.found(F_.autoPick(0), {fac: 0, ai: false}); setDmSeat(true);
  const M = F_.fellowshipMembers().map(m => m.hero), A = M[0];
  // #148: every member is agent-played; with no runner link they all play by reflex (A's answers come from play() below).
  // A camp (the world's, not the DM's) may fall in a scene's window: its DM-log lines are not the DM's to tag.
  const home = homeOf(A).gate, zone = zoneFor(8, home), spot = zonePoint(zone, null, home);
  const place = () => M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []});
  const fresh = () => {if (CRYPT.group) {for (const a of CRYPT.group.mem) {a.state = 'hunt'; a.hidden = false} CRYPT.group = null} CRYPT.cd = 1e6; if (S.table && S.table.ctx && S.table.ctx.staged == null) S.table = null; // a Crypt crawl the Fellowship wandered into is left, so the staged scene can open
   place(); if (S.staged) S.staged.day.n = 0; if (S.levers) {S.levers.cd = {}; S.levers.day = {d: -1, n: {}, rz: {}}} // the people lever's own limits are not under test here
    for (const m of S.mobs) if (dist(m, spot) < 30) {m.alive = false; m.gone = true}}; // an earlier staged pack the rounds left standing goes too (#276)
  // Kinds the world's own scripted DM, camps and adventures write untagged while the scene plays (their mix drifts with the seed and MOBS COUNTS, #287).
  // Anything else the staged scene causes (frame, payoff, agent, table, talk, ...) must carry the by tag.
  const UNTAGGED_KINDS = ['lever', 'camp', 'hooks', 'pick', 'roll', 'branch', 'complication'];
  const tag = e => e.detail && (e.detail.by === 'dm-agent' || e.detail.by === 'scripted');
  // mock DM: 'answer' answers every call at once, 'silent' polls but never answers, 'away' never polls
  const play = (mode, maxS = 120) => {let f = 0, opened = null, maxPause = 0;
    while (f < 60 * maxS) {const g = S.gameMin; step(1 / 60); f++;
      if (S.table && S.table.ctx.staged != null) {opened = opened || S.table; if (S.table.pause && S.table.phase !== 'frame' && S.gameMin !== g) maxPause = 1;
        if (mode !== 'away') {const t = dmAct('table_call'); if (mode === 'answer' && t.call) {const c = t.call; dmAct('table_answer', {call: c.id, text: 'DM line ' + c.id + ': the ' + c.kind + ' lands hard.', ...(c.legal ? {pick: c.legal[c.legal.length - 1]} : {})})}}
        if (A.player && !S.table.acts[A.id] && S.table.phase === 'turn') {const st = act(A, 'status'); const o = st.table && st.table.options; if (o && o.length) act(A, 'scene_act', {option: o[0].split(' = ')[0], line: 'On my word.'})}}
      if (!S.table && S.staged.cur.phase === 'done') break}
    return {opened, secs: f / 60, maxPause}};
  console.log('staged scenes (issue #132)');
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  const CAST = {meeting: {role: 'drover', name: 'Hesk', want: 'find my lost ox before the frost', voice: 'slow and worried', choices: {help: 'Promise Hesk to find the ox'}},
    social: {role: 'sellsword', want: 'a toll for the ford', attitude: 'wary', reveal: 'The toll goes to the Rookscar crew.'}, trap: {trap: 'spikes'},
    mystery: {place: 'shrine', reveal: 'The shrine remembers a drowned king.'}, elite: {name: 'Old Greyjaw', title: 'the Hungry', choices: {strike: 'Go for the throat'}}, ambush: {}};
  for (const kind of ST.STAGE_KINDS) {
    fresh(); const log0 = S.dmLogSeq, hp0 = M.map(x => x.hp);
    const r = dmAct('stage_scene', {kind, near: 'fellowship', frame: 'The road narrows between thorn banks, and something waits for them.', cast: CAST[kind], reason: 'tablecheck ' + kind});
    ok(r.ok && r.staged, `stage_scene ${kind}: ${r.title || r.error} ${r.where || ''}${r.level ? ' (level ' + r.level + ', party ' + r.party_level + ')' : ''}`);
    if (!r.ok) continue;
    const {opened: sc, secs, maxPause} = play('answer');
    ok(sc && sc.kind === kind && sc.ctx.staged === r.staged && sc.pause, `the cast met the party and a ${kind} scene opened at the table (${secs.toFixed(1)} s), world paused`);
    if (!sc) continue;
    ok(!maxPause, 'the world clock stood still through the scene');
    ok((A.chat || []).some(e => e.from.kind === 'dm' && /thorn banks/.test(e.text)), 'the frame reached the members as narration');
    const calls = sc.calls || [];
    if (T.PLAY[kind] === 'all') ok(calls.length === 3 && calls.filter(c => c.kind === 'outcome').length === 1 && calls.find(c => c.kind === 'outcome').beat === 'all' && calls.every(c => c.done && c.by === 'dm-agent'), `${calls.length} DM calls (voice, one combined outcome after everyone answered, one complication), all answered by the mock DM`);
    else ok(calls.length >= sc.ids.length + 2 && calls.every(c => c.done) && calls.filter(c => c.by === 'dm-agent').length === calls.length, `${calls.length} DM calls (voice, an outcome per member, one complication), all answered by the mock DM`);
    const comp = calls.find(c => c.kind === 'complication');
    ok(comp && ST.COMPLICATIONS[kind].includes(comp.pick), `the complication is one of the legal set: ${comp && comp.pick}`);
    ok(sc.beats.length === sc.ids.length || ['elite', 'ambush'].includes(kind), `every member acted (${sc.beats.map(b => b.name + '=' + b.k + '(' + b.by + ')').join(', ')})`);
    if (CAST[kind].choices) ok(sc.beats.some(b => Object.values(CAST[kind].choices).includes(b.text)), 'the DM\'s own label for a legal action shows at the table');
    if (kind === 'meeting' || kind === 'social') ok((A.chat || []).some(e => e.from.kind === 'npc' && /^DM line/.test(e.text)), 'the voice call is said by the person, in the game');
    if (kind === 'meeting') {const hr = sc.beats.filter(b => b.k === 'hear');
      ok(hr.every(b => /^(understood |listened, but missed what )/.test(b.res || '')) && S.dmLog.filter(e => e.id > log0 && e.kind === 'roll' && e.detail.act === 'hear').every(e => e.detail.skill === 'empathy'),
        `hearing someone out is an Empathy check worded as what they caught or missed (${hr.map(b => b.name + ': ' + b.res).join('; ') || 'nobody chose to hear'})`);
      ok(!/\b(success|failure)\b/.test(sc.summary || '') && (/understood|listened but missed|their word|watches them/.test(sc.summary || '')), 'the meeting\'s summary reads plainly: ' + sc.summary)}
    const mine = S.dmLog.filter(e => e.id > log0);
    ok(mine.some(e => e.kind === 'frame' && tag(e)) && mine.some(e => e.kind === 'payoff' && tag(e)) && mine.every(e => tag(e) || UNTAGGED_KINDS.includes(e.kind)), `DM log: ${mine.length} entries, every one tagged (${[...new Set(mine.map(e => e.kind))].join(', ')})`);
    if (!['elite', 'ambush'].includes(kind)) ok(mine.some(e => e.kind === 'roll' && e.detail.d20 >= 1 && e.detail.dc), 'the dice decide: d20 rolls against a DC are logged');
    ok(M.every(x => x.state !== 'dead') && (kind !== 'trap' || M.every((x, i) => x.hp >= Math.min(hp0[i], Math.ceil(maxHp(x) * ST.STAGE.TRAP_FLOOR)))), 'nobody died; a trap never takes anyone below ' + ST.STAGE.TRAP_FLOOR * 100 + '% HP');
    ok(S.staged.cur.phase === 'done' && S.staged.cur.result, `the staged scene ends: ${S.staged.cur.result}`);
    for (const id of S.staged.cur.cast.mobs) {const m = S.mobs.find(x => x.id === id); if (m && m.alive) {m.alive = false; m.gone = true}}
    run(1);
  }
  // the frame must fit the cast (issue #211)
  fresh();
  const pv = dmAct('stage_scene', {kind: 'ambush', near: 'fellowship', preview: 'true'});
  ok(pv.ok && pv.preview && /^a pack of \d+ /.test(pv.cast) && pv.creatures.length >= 2 && !pv.people, `preview shows the cast without a frame or reason: ${pv.cast || pv.error}`);
  ok(!S.staged.cur || S.staged.cur.phase === 'done', 'a preview stages nothing (no scene, no foes, no daily count)');
  const mobs0 = S.mobs.length, n0 = S.staged.day.n;
  const misfit = dmAct('stage_scene', {kind: 'ambush', near: 'fellowship', frame: 'A group of armed men blocks the road ahead, their leader shouting threats.', cast: {}, reason: 'misfit'});
  ok(misfit.ok === false && /does not fit the cast/.test(misfit.error) && misfit.error.includes(pv.cast) && /men/.test(misfit.error), `armed men over a pack of beasts is refused, naming the cast: ${misfit.error}`);
  ok(S.mobs.length === mobs0 && S.staged.day.n === n0, 'a refused misfit spawns nothing and costs no scene');
  ok(dmAct('stage_scene', {kind: 'ambush', near: 'fellowship', frame: 'The road is quiet and empty, and the brush is still.', cast: {}, reason: 'misfit'}).ok === false, 'a frame that never names what comes is refused too');
  const fam = pv.creatures[0].replace(/ \(L\d+\)$/, ''), word = fam.split(' ').pop().toLowerCase();
  const good = dmAct('stage_scene', {kind: 'ambush', near: 'fellowship', frame: `Something snorts in the brush; a ${word} breaks cover, and more behind it, with a pack leader shouldering through.`, cast: {}, reason: 'fits'});
  ok(good.ok && good.cast.length === pv.creatures.length && good.cast.every((c, i) => c.includes(pv.creatures[i].replace(/ \(L\d+\)$/, ''))), `a fitting frame (a family word, "pack leader" allowed) is accepted and builds the previewed cast (${good.cast && good.cast.length} foes)`);
  for (const id of S.staged.cur.cast.mobs) {const m = S.mobs.find(x => x.id === id); if (m) {m.alive = false; m.gone = true}}
  S.staged.cur.phase = 'done'; S.staged.day.n = 0; fresh();
  ok(ST.STAGE.WANT_MAX === 160, 'STAGE.WANT_MAX is a real constant (160, as place_person caps a want)');
  {const lw = dmAct('stage_scene', {kind: 'meeting', near: 'fellowship', frame: 'A pilgrim sits by a cairn, mending a sandal.', cast: {role: 'hermit', want: 'company as far as the ford '.repeat(12)}, reason: 'want cap'});
   const cw = S.staged.cur && S.staged.cur.cast && S.staged.cur.cast.want;
   ok(!lw.ok || (cw && cw.length <= ST.STAGE.WANT_MAX), `a long want is capped at ${ST.STAGE.WANT_MAX}: ${cw ? cw.length : lw.error}`);
   if (S.staged.cur) S.staged.cur.phase = 'done'; fresh()}
  const ev = dmAct('stage_scene', {kind: 'elite', near: 'fellowship', preview: 'true'});
  ok(ev.ok && /^a named /.test(ev.cast), `elite preview: ${ev.cast}`);
  ok(dmAct('stage_scene', {kind: 'elite', near: 'fellowship', frame: 'A bandit captain steps out of the thorns, sword drawn.', cast: {}, reason: 'misfit'}).ok === false, 'an elite framed as a bandit captain is refused');
  ok(dmAct('stage_scene', {kind: 'meeting', near: 'fellowship', preview: 'true'}).preview, 'preview of a kind with no creature cast just says so');
  const cn = dmAct('stage_scene', {kind: 'elite', near: 'fellowship', frame: 'Old Greyjaw stalks out of the thorns, lame and hungry.', cast: {name: 'Old Greyjaw'}, reason: 'named'});
  ok(cn.ok, 'an elite framed by its own given name is accepted' + (cn.ok ? '' : ': ' + cn.error));
  if (cn.ok) {for (const id of S.staged.cur.cast.mobs) {const m = S.mobs.find(x => x.id === id); if (m) {m.alive = false; m.gone = true}} S.staged.cur.phase = 'done'; S.staged.day.n = 0}
  // a silent DM (polls, never answers): each call waits its budget, then the scripted DM; after MISS_MAX misses, at once
  fresh(); T.TABLE.dmMs = 1500;
  let r = dmAct('stage_scene', {kind: 'mystery', near: A.name, frame: 'A ring of old stones stands in the bracken, humming faintly.', cast: {}, reason: 'silent DM'});
  let p = play('silent');
  let calls = p.opened ? p.opened.calls : [];
  ok(r.ok && p.opened && calls.length && calls.every(c => c.done && c.by === 'scripted'), `a silent DM: every call filled by the scripted DM (${calls.length})`);
  ok(p.opened && p.opened.dmMiss === ST.STAGE.MISS_MAX, `it waited for ${ST.STAGE.MISS_MAX} calls, then stopped waiting`);
  ok(p.secs <= T.TABLE.frameS + T.TABLE.outcomeS + ST.STAGE.MISS_MAX * T.TABLE.dmMs / 1000 + T.TABLE.turnMs / 1000 + 25, `the scene still ended (${p.secs.toFixed(1)} s, walk included)`);
  // nobody listening at all: no wait
  fresh(); const poll0 = ST.STAGE.POLL_MS; ST.STAGE.POLL_MS = 0; // as if the last poll were long ago
  r = dmAct('stage_scene', {kind: 'social', near: A.name, frame: 'A toll-keeper leans on a pike across the track.', cast: {role: 'sellsword', want: 'two silver for the ford'}, reason: 'no runner'});
  const t0 = Date.now(); p = play('away');
  ok(r.ok && p.opened && p.opened.calls.every(c => c.by === 'scripted') && !p.opened.dmMiss && p.secs < 30, `no runner listening: the scripted DM fills at once (scene over after ${p.secs.toFixed(1)} s game-step time)`);
  ST.STAGE.POLL_MS = poll0;
  T.TABLE.dmMs = 6000;
  // late and illegal answers
  ok(dmAct('table_answer', {call: 1, text: 'x'}).ok === false, 'an answer with no staged scene at the table is refused');
  // at 3x: no pause, everything resolved at once, scripted
  fresh(); T.TABLE.speed = 3;
  r = dmAct('stage_scene', {kind: 'trap', near: A.name, frame: 'Fresh earth across the path, raked too smooth.', cast: {trap: 'gas'}, reason: 'fast'});
  p = play('answer'); const pay = S.dmLog.find(e => e.kind === 'payoff' && e.detail.staged === r.staged);
  ok(r.ok && !p.opened && pay && pay.detail.calls.length && pay.detail.calls.every(c => c.by === 'scripted'), 'at 3x the staged scene resolves in one step (never paused) with the scripted DM in every slot');
  T.TABLE.speed = 1;
  // a save mid-scene, with a pending call
  fresh();
  r = dmAct('stage_scene', {kind: 'meeting', near: A.name, frame: 'A pilgrim sits by a cairn, mending a sandal.', cast: {role: 'hermit', want: 'company as far as the ford'}, reason: 'save'});
  let f = 0; while (f++ < 60 * 60 && !(S.table && S.table.calls && S.table.calls.some(c => !c.done))) {step(1 / 60); dmAct('table_call')}
  const pend = S.table && S.table.calls.find(c => !c.done);
  ok(!!pend, `a call is waiting (${pend && pend.kind})`);
  const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
  ok(S.table && S.table.ctx.staged === r.staged && S.staged.cur.phase === 'open', 'a save mid-scene restores the staged scene and its calls');
  const bad = dmAct('table_answer', {call: 999, text: 'x'}), c1 = dmAct('table_call').call;
  ok(bad.ok === false && c1 && dmAct('table_answer', {call: c1.id, text: 'The pilgrim looks up and smiles.'}).ok && dmAct('table_answer', {call: c1.id, text: 'again'}).ok === false, 'unknown and repeated answers are refused; the pending one is taken');
  p = play('away');
  ok(!S.table && S.staged.cur.phase === 'done', 'the restored scene runs to its end');
  // expiry: a cast that never meets the party gives up
  fresh(); const far = M.map(x => ({x: x.x, y: x.y}));
  r = {ok: false}; for (const [dx, dy] of [[12, 0], [-12, 0], [0, 12], [0, -12], [9, 9], [-9, -9]]) {if (r.ok) break; r = dmAct('stage_scene', {kind: 'ambush', near: Math.round(spot.x + dx) + ',' + Math.round(spot.y + dy), frame: 'A pack watches the road from the hedges.', cast: {}, reason: 'never met'})} // the roster (every class added) moves the spot: try a few offsets
  if (!r.ok) r = dmAct('stage_scene', {kind: 'mystery', near: ZONES[zone], frame: 'A pack watches the road from the hedges.', cast: {}, reason: 'never met'});
  // hold the live members: the save test above restored the world, so M holds the heroes from before the restore
  for (const x of F_.fellowshipMembers().map(m => m.hero)) {const c = homeOf(x); x.state = 'town'; x.townStep = 2; x.wait = 9e9; x.target = null; x.dest = null; x.x = c.gate.x; x.y = c.gate.y - 1}
  T.TABLE.speed = 8; const g0 = S.gameMin; while (S.gameMin - g0 < ST.STAGE.WAIT_MIN + 30) step(1 / 60);
  ok(r.ok && S.staged.cur.phase === 'done' && S.staged.cur.result === 'expired' && S.dmLog.some(e => e.kind === 'abandon' && tag(e)), `a cast nobody meets gives up after ${ST.STAGE.WAIT_MIN / 60} game hours (logged)`);
  ok(S.staged.cur.cast.mobs.every(id => {const m = S.mobs.find(x => x.id === id); return !m || m.gone}), 'and its foes leave the map');
  console.log('STAGED ' + (fail ? 'FAIL ' + fail : 'OK'));
  process.exit(fail ? 1 : 0);
}

console.log('\nEldmoor tablecheck: Table mode, the council and the party as one unit (mock agents)\n');
init({fellowship: false}); run(60); // the old start (#111): this check founds its own Fellowship
for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
const r0 = F_.found(F_.autoPick(0), {fac: 0, ai: false});
ok(r0.ok && F_.fellows().length === 5, `founded ${S.fellowship && S.fellowship.name} with ${F_.fellows().length} members`);
const M = F_.fellowshipMembers().map(m => m.hero);
const [A, B, ...rest] = M; // A answers, B is silent but its runner holds it; the rest have no runner (#148)
// #148: the Fellowship is always agent-played; whether a decision waits is the runner's link (the relay's claims).
const LINK = {}, link = (x, k) => {LINK[x.id] = k}; SIM.setRunnerLinks(x => LINK[x.id] || 'none');
const unasked = new Set(); SIM.setReflexAck(x => !unasked.has(x.id)); // the page's alert: not answered yet for these (else Resume)
link(A, 'connected'); link(B, 'waiting');
ok(M.every(x => x.player && x.fellowAgent) && S.fellowship.minds === 'agent', 'every member is agent-played from founding (#148)');
ok(!F_.setMinds('off') && !F_.setMinds('relay') && !P.markPlayer(rest[0], false) && rest[0].player, 'no scripted or relay mode: setMinds refuses them, a member cannot be unmarked');
ok(SIM.agentLive(A) && SIM.agentLive(B) && rest.every(x => !SIM.agentLive(x) && SIM.reflexMay(x)), `links: ${A.name} connected (answers), ${B.name} waiting (silent); ${rest.map(x => x.name).join(', ')} no runner`);

// Put the whole party in the field around a monster.
const zone = zoneFor(8, homeOf(A).gate);
let spot = zonePoint(zone, null, homeOf(A).gate);
{const {campSpot} = await import('../src/sim/camp.js'); // the field spot must have camp-safe ground within reach, wherever the seed drops it (#287)
 for (let i = 0; i < 60 && !campSpot(spot.x, spot.y); i++) spot = zonePoint(zone, null, homeOf(A).gate)}
const place = () => {M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []})};
const mobNear = () => {const m = S.mobs.filter(m => m.alive && !m.gone && !m.elite).sort((p, q) => dist(p, spot) - dist(q, spot))[0]; m.x = spot.x + 1; m.y = spot.y; m.hp = m.maxhp; return m};
const startFight = (x, m) => {x.state = 'fight'; x.target = m; m.target = x; x.hp = maxHp(x) * .24; m.maxhp *= 20; m.hp = m.maxhp; m.cd = 99; m.hit = .001}; // a tough foe whose blow barely scratches (#276: it acts at the table), so no one dies or flees mid-test
const stepUntil = (cond, maxS) => {let f = 0, moved = 0; while (!cond() && f < 60 * maxS) {const g = S.gameMin; step(1 / 60); f++; if (S.table && S.gameMin !== g) moved = 1} return {secs: f / 60, moved}};

// ---- 1. a rescue scene at 1x: the table waits for a silent but connected agent ----
// Sections 1-2 test the turn flow in one round (TR.ROUNDS 1); section 2b plays the combat rounds (#276).
const ROUNDS0 = TRD.TR.ROUNDS; TRD.TR.ROUNDS = 1;
T.TABLE.speed = 1; T.TABLE.turnMs = 7000; T.TABLE.mode = 'auto';
place(); let m = mobNear(); const victim = rest[0]; startFight(victim, m);
T.tableTick(); // the trigger rules (step() runs them after the heroes move)
let sc = S.table;
ok(sc && sc.kind === 'rescue' && sc.pause, `a member at ${Math.round(victim.hp / maxHp(victim) * 100)}% opens a rescue scene (${sc && sc.title}), world paused`);
ok(sc && sc.ids.length === 5 && sc.ids.every((id, i) => i === 0 || score(S.agents.find(x => x.id === sc.ids[i - 1]), 'reflex') >= score(S.agents.find(x => x.id === id), 'reflex')), 'initiative order follows Reflex (with gear)');
const evA = (A.playEv || []).slice(-3).map(e => e.text).join(' | ');
ok(/TABLE \(rescue\)/.test(evA) && (A.playEv || []).some(e => e.w === 3), 'the agent gets a must-answer table event with its options');
let st = act(A, 'status');
ok(st.ok && st.table && st.table.options && st.table.options.length >= 2, `status shows the table: ${st.table && st.table.options.join('; ')}`);
let w = act(A, 'scene_act', {option: 'strike', line: 'Hold on, I am coming!'});
ok(w.ok && w.chose === 'strike', 'the answering agent locks in strike before its turn');
ok(!act(A, 'scene_act', {option: 'retreat'}).ok, 'a second act in the same scene is refused');
ok(!act(B, 'scene_act', {option: 'dance'}).ok, 'an option the scene does not offer is refused');
const g0 = S.gameMin;
let p1 = stepUntil(() => !S.table, 30);
ok(S.table && S.table.phase === 'turn' && S.table.ids[S.table.i] === B.id && p1.moved === 0, `30 s on, the table still waits for ${B.name}'s silent but connected agent (no reflex, the world clock still)`);
ok((B.playEv || []).some(e => /Still your turn/.test(e.text) && e.w === 3), 'the waiting agent was nudged again (must-answer)');
ok(/is thinking/.test((T.bannerOf() || {}).line || ''), `the banner: ${(T.bannerOf() || {}).line}`);
ok(act(B, 'scene_act', {option: st.table.options.map(o => o.split(' = ')[0]).includes('heal') ? 'heal' : 'strike', line: 'Sorry, I am here.'}).ok, 'the slow agent answers at last');
p1 = stepUntil(() => !S.table, 20);
ok(!S.table && p1.moved === 0, `then the scene resolves (${p1.secs.toFixed(1)} s more), the world clock still until then`);
const beats = sc.beats, bA = beats.find(b => b.id === A.id), bB = beats.find(b => b.id === B.id);
ok(bA && bA.by === 'agent' && bA.k === 'strike' && bB && bB.by === 'agent' && rest.every(x => (beats.find(b => b.id === x.id) || {}).by === 'reflex'), `turns: ${beats.map(b => b.name + '=' + b.k + '(' + b.by + ')').join(', ')} (reflex only for members with no runner)`);
ok(S.fellowship.log.some(e => e.kind === 'table'), 'the outcome is in the campaign log');
step(1 / 60); ok(S.gameMin > g0, 'the world runs on after the scene');

// ---- 1a. a runner gone: the table waits for the owner; Resume lets the reflexes act ----
link(B, 'none'); unasked.add(B.id);
place(); m = mobNear(); startFight(rest[1], m); S.fellowship.tableSeen = {}; T.tableTick(); act(A, 'scene_act', {option: 'strike'});
ok(S.table && SIM.ownerHeld(B) && !SIM.reflexMay(B), `${B.name}'s runner is gone and the owner has not answered: held`);
p1 = stepUntil(() => !S.table, 60); const atB = S.table && S.table.ids[S.table.i] === B.id;
ok(S.table && atB && SIM.decisionsWaiting().some(d => d.a === B && /turn at the table/.test(d.what)) && /no runner/.test(T.bannerOf().line), `the table holds at ${B.name}'s turn and names it for the alert: ${T.bannerOf() && T.bannerOf().line}`);
unasked.delete(B.id); p1 = stepUntil(() => !S.table, 20);
ok(!S.table && (S.table === null), `the owner resumes: ${B.name}'s reflexes act and the scene ends (${p1.secs.toFixed(1)} s)`);
link(B, 'waiting');

// ---- 1c. a live agent that never answers: reflex after TABLE.liveMs, with a notice ----
T.TABLE.liveMs = 4000;
place(); m = mobNear(); startFight(rest[1], m); S.fellowship.tableSeen = {}; T.tableTick(); act(A, 'scene_act', {option: 'strike'});
p1 = stepUntil(() => !S.table, 60);
ok(!S.table && p1.secs <= T.TABLE.frameS + T.TABLE.outcomeS + T.TABLE.liveMs / 1000 + 1 && (B.playEv || []).some(e => /table waited/.test(e.text)), `a silent agent's turn falls to reflex after ${T.TABLE.liveMs / 1000} s, with a notice (${p1.secs.toFixed(1)} s)`);
T.TABLE.liveMs = 120000;

// ---- 1b. a save mid-scene ----
place(); m = mobNear(); startFight(rest[1], m); S.fellowship.tableSeen = {}; T.tableTick();
ok(S.table && S.table.pause, 'a second rescue scene opens');
act(A, 'scene_act', {option: 'strike'}); act(B, 'scene_act', {option: 'strike'});
const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
ok(S.table && S.table.kind === 'rescue', 'a save taken mid-scene restores the scene');
p1 = stepUntil(() => !S.table, 40);
ok(!S.table, `the restored scene resolves (${p1.secs.toFixed(1)} s)`);
const RA = S.agents.find(x => x.id === A.id), RB = S.agents.find(x => x.id === B.id), Rrest = rest.map(x => S.agents.find(y => y.id === x.id));
let RM = [RA, RB, ...Rrest];

// ---- 2. at 3x: a Fellowship decision drops the world to 1x; reflex-only tables still resolve at once ----
T.TABLE.speed = 3;
const field3 = () => RM.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y; x.state = 'hunt'; x.hidden = false; x.target = null; x.hp = maxHp(x); x.pq = []});
field3(); m = S.mobs.filter(q => q.alive && !q.gone && !q.elite)[3]; m.x = spot.x + 1; m.y = spot.y; startFight(Rrest[2], m);
T.TABLE.drop = null; S.fellowship.tableSeen = {}; T.tableTick(); let g1 = S.gameMin; step(1 / 60);
ok(S.table && S.table.pause && T.TABLE.drop && S.gameMin === g1, `at 3x with agents to decide, the scene holds and asks the host for 1x (${T.TABLE.drop && T.TABLE.drop.reason})`);
T.TABLE.speed = 1; T.TABLE.drop = null; act(RA, 'scene_act', {option: 'strike'}); act(RB, 'scene_act', {option: 'strike'}); // the host drops to 1x; the agents answer
p1 = stepUntil(() => !S.table, 30);
ok(!S.table && S.table === null && S.fellowship.log.some(e => e.kind === 'table'), `at 1x the agents' scene runs as usual (${p1.secs.toFixed(1)} s)`);
T.TABLE.speed = 3; field3(); m = S.mobs.filter(q => q.alive && !q.gone && !q.elite)[4]; m.x = spot.x + 1; m.y = spot.y; startFight(Rrest[2], m);
S.fellowship.tableSeen = {}; T.tableTick(); p1 = stepUntil(() => !S.table, 30);
ok(!S.table && p1.secs <= T.TABLE.dropS + .2, `a host that never drops: the scene resolves after ${T.TABLE.dropS} world seconds anyway (${p1.secs.toFixed(1)} s, never hangs)`);
link(RA, 'none'); link(RB, 'none');
field3(); m = S.mobs.filter(q => q.alive && !q.gone && !q.elite)[5]; m.x = spot.x + 1; m.y = spot.y; startFight(Rrest[2], m);
const n0 = S.fellowship.log.filter(e => e.kind === 'table').length; g1 = S.gameMin; T.TABLE.drop = null;
S.fellowship.tableSeen = {}; T.tableTick(); step(1 / 60);
ok(!S.table && !T.TABLE.drop && S.fellowship.log.filter(e => e.kind === 'table').length === n0 + 1 && S.gameMin > g1, 'at 3x with no runner anywhere (reflexes only) the scene resolves in the same step, the clock running');
link(RA, 'connected'); link(RB, 'waiting');

// ---- 2b. combat rounds (#276): the foe takes its turn, every blow shows its d20, the scene ends on a fall ----
TRD.TR.ROUNDS = ROUNDS0; T.TABLE.speed = 1; T.TABLE.drop = null;
{const fieldR = () => {field3(); RM.forEach(x => {x.state = 'fight'})};
 const foeAt = (lvl, hpMul) => {const q = S.mobs.filter(x => x.alive && !x.gone && !x.elite && !x.staged).sort((p, r) => dist(p, spot) - dist(r, spot))[0]; q.x = spot.x + 1; q.y = spot.y; q.lvl = lvl; q.maxhp = Math.round((25 + lvl * 16) * hpMul); q.hp = q.maxhp; q.cd = 99; q.fledOnce = true; q.ab = []; return q}; // no creature tricks: conditions have their own section (#296)
 const elite = q => {for (const x of RM) {x.target = q} q.target = RM[0]; S.fellowship.tableSeen = {}; return T.openScene('elite', 'A test of rounds', ['Something big comes out of the brush.'], {mob: q.id})};
 const rollRe = /^d20 \d+\+\d+=\d+ vs AC \d+/;
 const lastTable = () => {const e = S.fellowship.log.filter(x => x.kind === 'table').pop(); return e ? e.parts.map(p => typeof p === 'string' ? p : p && p.t || '').join('') : ''};
 // (a) everyone by reflex, a foe that lasts: three rounds, the foe in each, cooldowns down by one a round
 for (const x of RM) link(x, 'none');
 fieldR(); let q = foeAt(8, 40); RM.forEach(x => {x.mcr = Object.assign(x.mcr || {}, {zz_test: 9})});
 const hp0 = RM.map(x => x.hp), d0 = S.dmLogSeq; let scR = elite(q);
 ok(scR && scR.rd === 1 && Number.isInteger(scR.foeAt) && scR.foeAt >= 0 && scR.foeAt <= scR.ids.length, `a combat scene opens in round 1 with the foe in the initiative order (place ${scR && scR.foeAt} of ${scR && scR.ids.length + 1})`);
 const tv = act(RM[0], 'status').table, bf = T.bannerOf().foe;
 ok(bf && bf.id === q.id && bf.name && bf.hp === q.hp && bf.maxhp === q.maxhp && bf.target === RM[0].id && bf.pack === 1, `the banner gets the foe as data (#285): ${JSON.stringify(bf)}`);
 ok(tv && tv.foe && tv.foe.name === bf.name && /^[a-z ]+$/.test(tv.foe.looks), `a member sees the foe by name and look, no numbers: ${JSON.stringify(tv && tv.foe)}`);
 ok(tv && Array.isArray(tv.initiative) && tv.initiative.some(n => /\(foe\)$/.test(n)) && /^1 of up to/.test(tv.round || ''), `the member sees the round and the order with the foe: ${tv && tv.initiative && tv.initiative.join(', ')}`);
 p1 = stepUntil(() => !S.table, 30);
 const fb = scR.beats.filter(b => b.by === 'foe'), mb = scR.beats.filter(b => b.by !== 'foe');
 ok(!S.table && scR.rd === TRD.TR.ROUNDS && [1, 2, 3].every(r => fb.some(b => b.rd === r)), `the foe takes a turn in each of ${scR.rd} rounds (${fb.length} foe beats)`);
 const r1 = scR.beats.filter(b => b.rd === 1), fi = r1.findIndex(b => b.by === 'foe');
 ok(fi === Math.min(scR.foeAt, r1.length - 1), `in round 1 the foe acts at its place in the order (${fi})`);
 ok(fb.filter(b => b.k === 'attack').every(b => rollRe.test(b.res)) && mb.filter(b => b.k === 'strike' && !/closing in/.test(b.res)).every(b => rollRe.test(b.res)), `every attack shows its roll: ${fb[0] && fb[0].res}; ${(mb.find(b => b.k === 'strike') || {}).res}`);
 // structured roll data on every rolled beat (#285), the same roll the text gives
 const rolled = scR.beats.filter(b => rollRe.test(b.res || ''));
 const same = b => {const r = b.roll, m = /^d20 (\d+)\+(\d+)=(\d+) vs AC (\d+)/.exec(b.res); return r && r.die === +m[1] && r.mod === +m[2] && r.total === +m[3] && r.vs === +m[4] && r.hit === !/: missed/.test(b.res) && r.crit === (r.die === 20) && typeof r.target === 'string' && r.target && (r.hit ? r.dmg >= 0 : r.dmg === 0)};
 ok(rolled.length && rolled.every(same) && scR.beats.every(b => !b.roll || rollRe.test(b.res)), `every rolled beat carries {die, mod, total, vs, hit, crit, dmg, target} matching its text (${rolled.length}): ${JSON.stringify(rolled[0] && rolled[0].roll)}`);
 const dl = S.dmLog.filter(e => e.id > d0 && e.kind === 'table');
 const dt = dl[0] ? dl[0].summary.join('') : '', dr = dl[0] ? dl[0].detail.rolls : [];
 ok(dl.length === 1 && dr.every(r => r.d20 == null || (r.d20 >= 1 && r.d20 <= 20 && r.ac >= 10)) && [1, 2, 3].every(n => dt.includes('round ' + n + ': ')) && dr.filter(r => r.d20 != null).length === scR.beats.filter(b => rollRe.test(b.res || '')).length,
   `the DM log has the scene's entry with every roll, a sentence a round (${dr.length} rolls): ${dt.slice(0, 140)}`);
 ok(RM.every(x => x.mcr.zz_test === 9 - scR.rd), `round cooldowns count down once a round (9 -> ${RM[0].mcr.zz_test})`);
 const hit = fb.filter(b => /: hit for/.test(b.res)).length;
 ok(hit === 0 || RM.some((x, i) => x.hp < hp0[i]), `HP carries from round to round (${hit} foe blows landed)`);
 ok(/\(3 rounds\.\)/.test(scR.summary) && /the foe struck \d+ times?/.test(lastTable()), `the outcome: ${scR.summary}`);
 RM.forEach(x => {delete x.mcr.zz_test});
 // (b) the foe falls: the scene ends in the round it goes down, with today's outcome text
 fieldR(); q = foeAt(8, .02); q.hp = 1; scR = elite(q); scR.pl = RM.map(x => x.id); /* each member has already parleyed (#296 once a fight): a reflex member would talk a 1 HP foe down, and this asserts the strike */ p1 = stepUntil(() => !S.table, 30);
 ok(!S.table && scR.rd === 1 && !q.alive && /^The foe is down\./.test(scR.summary), `a foe at 1 HP falls in round 1 and the scene ends: ${scR.summary}`);
 // (c) a member falls (a child, so the main party keeps its five): the scene ends on the fall
 const fc = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--rounds', 'fall'], {encoding: 'utf8'}), lfc = (fc.stdout || '').trim().split('\n').pop(); if (fc.stderr) process.stderr.write(fc.stderr);
 ok(/^FALL ok/.test(lfc), 'a member who falls ends the fight: ' + lfc);
 const RL = RM;
 // (d) a silent agent: its reflex acts after the wait in round 1, and it is not waited for again in the later rounds
 T.TABLE.liveMs = 1500; const quiet = RL[0]; link(quiet, 'waiting'); fieldR(); q = foeAt(8, 40); q.hit = .001; scR = elite(q);
 p1 = stepUntil(() => !S.table, 30);
 const qb = scR.beats.filter(b => b.id === quiet.id);
 ok(!S.table && qb.length === scR.rd && qb.every(b => b.by === 'reflex') && p1.secs <= T.TABLE.frameS + T.TABLE.outcomeS + T.TABLE.liveMs / 1000 + 1 && (quiet.playEv || []).some(e => /table waited/.test(e.text)), `a silent agent gets a reflex each round, waited for once (${p1.secs.toFixed(1)} s for ${scR.rd} rounds)`);
 T.TABLE.liveMs = 120000; link(quiet, 'none');
 // (e) at 3x with reflexes only: every round resolves in one step
 T.TABLE.speed = 3; fieldR(); q = foeAt(8, 40); q.hit = .001; scR = elite(q);
 ok(!S.table && scR.rd === TRD.TR.ROUNDS && scR.beats.filter(b => b.by === 'foe').length >= scR.rd && scR.phase === 'outcome', `at 3x the whole fight (${scR.rd} rounds) resolves at once with a summary: ${scR.summary}`);
 T.TABLE.speed = 1;
 // (g) the watcher's step mode (#285): hold after each round until Next round; auto after stepS; 3x and instant never hold
 T.TABLE.step = 'hold'; fieldR(); q = foeAt(8, 40); q.hit = .001; scR = elite(q);
 const held = () => !!(S.table && T.bannerOf() && T.bannerOf().hold);
 p1 = stepUntil(held, 30); const g0 = S.gameMin, b1 = scR.beats.length;
 ok(held() && scR.rd === 1 && /Round 1 is done/.test(T.bannerOf().line) && !T.bannerOf().hold.auto, `hold: the scene waits after round 1 (${T.bannerOf() && T.bannerOf().line})`);
 stepUntil(() => false, 10);
 ok(held() && scR.rd === 1 && S.gameMin === g0 && scR.beats.length === b1, `hold: 10 s later the world and the round have not moved (game min ${S.gameMin})`);
 ok(T.stepNext() && !T.stepNext(), 'Next round releases the hold once');
 p1 = stepUntil(held, 30);
 ok(held() && scR.rd === 2 && scR.beats.some(b => b.rd === 2), `hold: round 2 plays and holds again (${scR.beats.filter(b => b.rd === 2).length} beats)`);
 T.TABLE.step = 'auto'; T.TABLE.stepS = 1; const a0 = S.gameMin;
 p1 = stepUntil(() => !S.table, 30);
 ok(!S.table && scR.rd === TRD.TR.ROUNDS && S.gameMin > a0, `auto: the held round goes on after ${T.TABLE.stepS} s and the fight ends after round ${scR.rd} (${p1.secs.toFixed(1)} s)`);
 T.TABLE.step = 'hold'; T.TABLE.speed = 3; fieldR(); q = foeAt(8, 40); q.hit = .001; scR = elite(q);
 ok(!S.table && scR.rd === TRD.TR.ROUNDS, `at 3x step mode never holds: ${scR.rd} rounds at once`);
 T.TABLE.speed = 1; T.TABLE.step = 'off'; T.TABLE.stepS = 4;
 // (f) the order agents answer in never changes the rolls (a child, twice)
 const me3 = fileURLToPath(import.meta.url), rf = spawnSync(process.execPath, [me3, '--rounds', 'fwd'], {encoding: 'utf8'}), rr = spawnSync(process.execPath, [me3, '--rounds', 'rev'], {encoding: 'utf8'});
 const lf3 = (rf.stdout || '').trim().split('\n').pop(), lr3 = (rr.stdout || '').trim().split('\n').pop(); if (rf.stderr) process.stderr.write(rf.stderr);
 ok(/^ROUNDS \[\[/.test(lf3) && lf3 === lr3, `combat rounds answered in initiative order and in reverse give the same rolls: ${lf3.slice(0, 160)}`);
}
link(RA, 'connected'); link(RB, 'waiting');

// ---- 2c. parley and conditions (#296): a fresh world in a child ----
{const ch = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--parley'], {encoding: 'utf8'});
  process.stdout.write(ch.stdout || ''); if (ch.stderr) process.stderr.write(ch.stderr);
  ok(ch.status === 0 && /PARLEY OK/.test(ch.stdout || ''), 'parley and conditions: a legal action on talkers only, its dice in the banner and the DM log, a 20 yields, a 1 holds; four conditions across rounds, a save mid-scene, all gone with the scene')}

// ---- 2d. an item from the pack as a round's act (#360): a fresh world in a child ----
{const ch = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--use'], {encoding: 'utf8'});
  if (ch.status !== 0) process.stderr.write((ch.stdout || '') + (ch.stderr || ''));
  ok(ch.status === 0 && /USE OK/.test(ch.stdout || ''), 'a potion or scroll from the pack in a Table round: offered only when it would do something, used once, named in the beat, the banner, the action log and the DM log')}

// ---- 3. proposals (in town, where nothing attacks) ----
T.TABLE.speed = 1;
const toTown = () => RM.forEach(x => {const c = homeOf(x); x.state = 'town'; x.townStep = 2; x.wait = 9; x.x = c.gate.x; x.y = c.gate.y - 1; x.target = null; x.pq = []; x.hp = maxHp(x)});
toTown();
let pr = act(RA, 'propose', {kind: 'other', details: 'Camp by the water tonight'});
ok(pr.ok && S.table && S.table.kind === 'decision', `a proposal at 1x becomes a decision scene (${pr.proposal})`);
const pid = Number(String(pr.proposal).match(/#(\d+)/)[1]);
p1 = stepUntil(() => !S.table, 20);
ok(S.table && C.propById(pid).status === 'open', 'the decision scene waits for the silent agent\'s vote');
ok(act(RB, 'vote', {proposal_id: pid, vote: 'no', reason: 'The water is cold.'}).ok, 'it votes with the vote tool, at its own pace');
p1 = stepUntil(() => !S.table, 20);
let PP = C.propById(pid);
ok(PP && PP.status !== 'open' && Object.keys(PP.votes).length === 5 && PP.votes[RB.id].by === 'agent' && PP.votes[RB.id].v === 'no' && PP.votes[RA.id].by === 'agent' && Rrest.every(x => PP.votes[x.id].by === 'reflex'), `the table voted (${PP && PP.result}); reflex only for members with no runner`);
ok(S.fellowship.log.some(e => e.kind === 'council' && /settles it/.test(e.parts.map(p => typeof p === 'string' ? p : '').join(''))), 'the leader settles it in the campaign log');
// outside a scene (Watch mode): the vote holds past PROP_MIN for a live agent while the world runs on
T.TABLE.mode = 'off';
pr = act(RA, 'propose', {kind: 'split', details: 'Each of us hunts alone until dusk'});
const pid2 = Number(String(pr.proposal).match(/#(\d+)/)[1]);
ok(pr.ok && !S.table && Object.keys(C.propById(pid2).votes).length === 4 && !C.propById(pid2).votes[RB.id], 'outside a scene the members with no runner vote at once by reflex; the agent\'s vote is waited for');
ok((RB.playEv || []).some(e => /waits for your vote/.test(e.text) && e.w === 3), 'the waiting agent is nudged at once (a must-answer event for its pacing)');
let g2 = S.gameMin; while (C.propById(pid2).status === 'open' && S.gameMin - g2 < C.COUNCIL.PROP_MIN + 60) step(1 / 60);
ok(C.propById(pid2).status === 'open' && S.gameMin - g2 >= C.COUNCIL.PROP_MIN + 59 && (RB.playEv || []).some(e => /still waits for you/.test(e.text)), `past PROP_MIN the vote still waits for a live agent, with a notice (the world ran on ${Math.round(S.gameMin - g2)} game minutes)`);
while (C.propById(pid2).status === 'open' && S.gameMin - g2 < C.COUNCIL.PROP_MIN + C.COUNCIL.HOLD_MIN + 30) step(1 / 60);
PP = C.propById(pid2);
ok(PP.status !== 'open' && /waited for/.test(PP.result) && PP.votes[RB.id].by === 'reflex', `after HOLD_MIN more it settles by reflex: ${PP.result}`);
link(RB, 'none'); unasked.add(RB.id);
pr = act(RA, 'propose', {kind: 'other', details: 'Buy rope in town'});
const pid3 = Number(String(pr.proposal).match(/#(\d+)/)[1]);
g2 = S.gameMin; while (S.gameMin - g2 < C.COUNCIL.PROP_MIN + C.COUNCIL.HOLD_MIN + 30) step(1 / 60);
ok(C.propById(pid3).status === 'open' && SIM.decisionsWaiting().some(d => d.a === RB && /vote/.test(d.what)), 'a runner gone and the owner not asked: the vote holds (and names the member for the alert)');
unasked.delete(RB.id); step(1 / 60); PP = C.propById(pid3);
ok(PP.status !== 'open' && PP.votes[RB.id].by === 'reflex', `the owner resumes: its reflexes vote at once (${PP.result})`);
link(RB, 'waiting');
pr = act(RA, 'propose', {kind: 'other', details: 'Mend the nets'});
const pid4 = Number(String(pr.proposal).match(/#(\d+)/)[1]);
const v = act(RB, 'vote', {proposal_id: pid4, vote: 'no', reason: 'We have rope.'});
PP = C.propById(pid4);
ok(v.ok && PP.status !== 'open' && /everyone voted/.test(PP.result), `all votes in settles it at once: ${PP.result}`);
ok(!act(RB, 'vote', {proposal_id: pid4, vote: 'yes'}).ok, 'a settled proposal takes no more votes');
{const live = F_.fellows(); RM = RM.map(x => x.state === 'dead' ? (live.find(y => !RM.includes(y) && y.state !== 'dead') || x) : x); for (let i = 0; i < Rrest.length; i++) Rrest[i] = RM[i + 2]} // a member who fell while the world ran on is replaced by the recruit who took the place
RM.forEach((x, i) => {x.x = RA.x + (i % 3) * .5; x.y = RA.y}); // in shouting range (#182)
ok(act(RA, 'party_say', {text: 'Rope it is, then.'}).ok && Rrest.every(x => (x.chat || []).some(e => e.party && e.text === 'Rope it is, then.')), 'party_say reaches every member');
ok(act(RB, 'party_read', {n: 5}).lines.some(l => /Rope it is/.test(l)), 'party_read shows it');
// at 3x with Table on, a proposal drops the world to 1x and becomes a decision scene
T.TABLE.mode = 'auto'; T.TABLE.speed = 3; T.TABLE.drop = null;
pr = act(RA, 'propose', {kind: 'other', details: 'Sing on the road'});
ok(pr.ok && S.table && S.table.kind === 'decision' && S.table.pause && T.TABLE.drop, 'at 3x a proposal asks the host for 1x and opens a decision scene (never auto-resolved)');
{const pid5 = Number(String(pr.proposal).match(/#(\d+)/)[1]); T.TABLE.speed = 1; T.TABLE.drop = null; act(RB, 'vote', {proposal_id: pid5, vote: 'yes'});
 stepUntil(() => C.propById(pid5).status !== 'open', 20); PP = C.propById(pid5);
 ok(PP.status !== 'open' && PP.votes[RB.id].by === 'agent', `and resolves once the agents have voted (${PP.result})`);
 for (let k = 0; k < 600 && S.table; k++) {for (const x of [RA, RB]) if (S.table && !S.table.acts[x.id] && S.table.ids.includes(x.id)) {const o = act(x, 'status').table; if (o && o.options) act(x, 'scene_act', {option: o.options[0].split(' = ')[0]})} step(1 / 60)}} // let any scene that followed end

// ---- 3b. everyone answers at once (owner request): votes, checks, choices and staged talk scenes ----
console.log('everyone answers at once');
{const CP = await import('../src/sim/camp.js');
 ok(['decision', 'check', 'choice', 'meeting', 'social', 'trap', 'mystery'].every(k => T.PLAY[k] === 'all') && ['elite', 'ambush', 'boss', 'rescue', 'site', 'room'].every(k => T.PLAY[k] === 'turns'), 'the kind table: votes, checks, choices and talk/trap/mystery scenes at once; combat and the Crypt in turns');
 T.TABLE.mode = 'off'; T.TABLE.speed = 1; for (const x of RM) link(x, 'waiting');
 for (const P of C.openProps()) P.status = 'failed'; delete S.fellowship.wait;
 const fieldAll = () => {for (const m of S.mobs) if (m.alive && !m.gone && dist(m, spot) < 16) {m.alive = false; m.gone = true}
   RM.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []; x.splitUntil = 0; x.playEv = []})};
 for (const p of S.parties.slice()) if (p.fellow) {for (const b of p.mem) b.party = null; S.parties.splice(S.parties.indexOf(p), 1)}
 CP.breakCampNow('test'); fieldAll(); const lead = C.leaderOfF(); // a camp the world made on its own (game time ran in the sections above) is broken first
 const rc = CP.leaderRest(lead, 4); run(1);
 ok(!rc && CP.campOf(), 'the leader makes camp in the field' + (rc ? ': ' + rc : ''));
 T.TABLE.mode = 'auto'; for (const x of RM) x.playEv = [];
 const pb = act(lead, 'propose', {kind: 'break_camp', details: 'Break camp and ride on'});
 const sc = S.table, others = RM.filter(x => x !== lead);
 ok(pb.ok && sc && sc.kind === 'decision' && sc.all && sc.ids.length === 5, `a break_camp vote opens a scene where everyone answers (${sc && sc.ids.length} at the table)`);
 ok(others.every(x => (x.playEv || []).some(e => /Everyone answers at once/.test(e.text) && e.w === 3)), 'all four other members got the scene at the same moment, as a must-answer event');
 ok(others.every(x => {const t = act(x, 'status').table; return t && t.your_turn && t.everyone_answers}), 'your_turn is true for every member who has not answered');
 const PACE = await import('../src/sim/pace.js');
 ok(others.every(x => {const b = PACE.paceBrief(x.id).brief.scene; return b && b.your_turn && b.keys.join() === 'yes,no'}), 'the pace brief carries the scene (yes/no) with your_turn for each of them');
 const [o1, o2, o3, o4] = others;
 run(2); act(o3, 'scene_act', {option: 'yes', line: 'Dawn is up.'}); run(1); act(o1, 'scene_act', {option: 'yes'}); act(o2, 'scene_act', {option: 'no'});
 const bl = (T.bannerOf() || {}).line || '';
 ok(S.table === sc && bl.startsWith('4/5 answered · waiting for ' + o4.name) && T.bannerOf().all, `the banner counts the answers: "${bl}"`);
 ok(act(o1, 'wait', {minutes: 5}).ok, 'a member who has answered may wait');
 const w4 = act(o4, 'wait', {minutes: 5});
 ok(!w4.ok && /your turn at the table/.test(w4.error), 'the one who has not answered may not');
 ok(SIM.decisionsWaiting().some(d => d.a === o4 && /answer at the table/.test(d.what)) && !SIM.decisionsWaiting().some(d => d.a === o1), 'the runner-stop alert would name only the member still to answer');
 run(5); ok(S.table === sc && C.propById(sc.ctx.prop).status === 'open', 'the table holds for the last answer');
 act(o4, 'scene_act', {option: 'yes'}); step(1 / 60);
 const PB = C.propById(sc.ctx.prop);
 ok(PB.status === 'passed' && sc.beats.map(b => b.id).join() === sc.ids.join() && sc.beats.every(b => b.by === 'agent'), `the last answer resolves it at once, in slot order (${PB.result})`);
 ok(!CP.campOf(), 'the camp breaks');
 stepUntil(() => !S.table, 10);

 // a silent but connected member's reflex comes after the live wait, side by side (not summed)
 T.TABLE.liveMs = 4000; fieldAll();
 const sc2 = T.openScene('check', 'A rope bridge', ['The DM calls for a roll.'], {anchor: RA.id});
 act(RA, 'scene_act', {option: 'press'});
 const p2 = stepUntil(() => !S.table, 30), silent = RM.filter(x => x !== RA);
 ok(!S.table && p2.secs <= T.TABLE.frameS + T.TABLE.outcomeS + T.TABLE.liveMs / 1000 + 1, `four silent agents: each waits ${T.TABLE.liveMs / 1000} s at once, and the scene ends in ${p2.secs.toFixed(1)} s (not ${4 * T.TABLE.liveMs / 1000} s)`);
 ok(silent.every(x => (sc2.beats.find(b => b.id === x.id) || {}).by === 'reflex' && (x.playEv || []).some(e => /table waited/.test(e.text))) && sc2.beats.find(b => b.id === RA.id).by === 'agent', 'their reflexes act, each with a notice; the answer that came stands');
 T.TABLE.liveMs = 120000;

 // presence (#182): a member out of shouting range is not asked
 fieldAll(); const far = RM[4]; far.x = spot.x < 40 ? spot.x + 30 : spot.x - 30;
 const sc3 = T.openScene('check', 'A cold ford', ['The water runs fast.'], {anchor: RA.id});
 ok(sc3 && sc3.ids.length === 4 && !sc3.ids.includes(far.id) && !(far.playEv || []).some(e => /TABLE/.test(e.text)) && !act(far, 'status').table, `${far.name}, out of range, is not at the table and not asked`);
 for (const x of RM) if (x !== far) act(x, 'scene_act', {option: 'steady'});
 stepUntil(() => !S.table, 10);
 ok(!S.table && sc3.beats.length === 4, 'the four present answer and it resolves');

 // combat stays in turns
 fieldAll(); m = mobNear(); startFight(RM[2], m); S.fellowship.tableSeen = {}; T.tableTick();
 const sc4 = S.table, first = sc4 && RM.find(x => x.id === sc4.ids[0]), second = sc4 && RM.find(x => x.id === sc4.ids[1]);
 run(2);
 ok(sc4 && sc4.kind === 'rescue' && !sc4.all && act(first, 'status').table.your_turn && !act(second, 'status').table.your_turn && act(second, 'wait', {minutes: 5}).ok, 'a rescue scene stays in initiative order: only the first is on turn, the next may wait');
 for (const x of RM) link(x, 'none'); stepUntil(() => !S.table, 10); link(RA, 'connected'); link(RB, 'waiting');
 ok(!S.table, 'it plays out');

 // the order answers arrive in never changes the outcome (a child, twice, on a trap scene with dice)
 const me2 = fileURLToPath(import.meta.url), fw = spawnSync(process.execPath, [me2, '--simul', 'fwd'], {encoding: 'utf8'}), rv = spawnSync(process.execPath, [me2, '--simul', 'rev'], {encoding: 'utf8'});
 const lf = (fw.stdout || '').trim().split('\n').pop(), lr = (rv.stdout || '').trim().split('\n').pop(); if (fw.stderr) process.stderr.write(fw.stderr);
 ok(/^ORDER \[\[/.test(lf) && lf === lr, `answers in slot order and in reverse give the same scene: ${lf.slice(0, 160)}`);
}

// ---- 4. lead_to ----
T.TABLE.mode = 'off'; T.TABLE.speed = 1;
const hall = homeOf(RA);
RM.forEach(x => {x.x = hall.gate.x; x.y = hall.gate.y - 1; x.state = 'town'; x.townStep = 2; x.wait = 0; x.target = null; x.hp = maxHp(x); x.pq = []; delete x.splitUntil});
RA.lvl = 9; for (const p of S.parties.slice()) if (p.fellow) {for (const b of p.mem) b.party = null; S.parties.splice(S.parties.indexOf(p), 1)}
delete S.fellowship.wait; // a Crypt order waiting from the section above (cryptHold) would send them down at the gate: this check is about the muster
run(1);
const FP = F_.fellowParty();
ok(FP && FP.leader === RA, `the Fellowship musters with ${RA.name} leading (${FP && FP.mem.length} in the party)`);
(await import('../src/sim/lore.js')).hear(RA, 'They say Mirefen lies past the river.', 'a townsperson'); // the leader has heard of it (#188)
ok(!act(RB, 'lead_to', {target: 'Mirefen'}).ok, 'only the leader may lead');
const ld = act(RA, 'lead_to', {target: 'Mirefen'});
ok(ld.ok, `lead_to: ${ld.leading || ld.error}`);
// followers fall in behind; a fight or a full bag can still send the party home later, so take the best moment
let near = [], outT = 0, farD = 0, rbFollowed = false; // the leader may reach Mirefen and turn home later: judge by the farthest point
for (let t = 0; t < 90; t++) {run(1); if (RB.state === 'follow' || RB.state === 'fight') rbFollowed = true; farD = Math.max(farD, dist(RA, hall.gate)); const nn = RM.filter(x => x !== RA && dist(x, RA) < 8).map(x => x.name); if (dist(RA, hall.gate) > 10 && nn.length > near.length) {near = nn; outT = t + 1}}
ok(farD > 8, `the leader left ${hall.name} (${farD.toFixed(1)} tiles out at most)`);
// the silent agent may still be finishing its town round when the leader sets out (a random plan step), so it counts if it was close at some moment or fell in behind them later (it did follow)
ok(near.length >= 3 && (near.includes(RB.name) || rbFollowed), `the party follows, the silent agent too: ${near.join(', ')} within 8 tiles after ${outT} s`);
const bond0 = (RA.bonds || {})[RB.id] || 0;
const lp = act(RB, 'leave_party');
ok(lp.ok && RB.splitUntil && !RB.party, 'leave_party splits a member off (for a while)');
ok(((RA.bonds || {})[RB.id] || 0) === Math.max(-10, bond0 - C.COUNCIL.BOND_COST), `splitting off costs bonds (${bond0} -> ${(RA.bonds || {})[RB.id]})`);
act(RB, 'join_party', {hero_id: RA.id});

// ---- 4b. talking takes presence (issue #182): shouting range, councils, plans, couriers, catching up ----
console.log('talking takes presence');
{const R = await import('../src/sim/reach.js'), PACE = await import('../src/sim/pace.js');
 T.TABLE.mode = 'off'; T.TABLE.speed = 1; for (const x of RM) link(x, 'connected');
 for (const p of S.parties.slice()) if (p.fellow) {for (const b of p.mem) b.party = null; S.parties.splice(S.parties.indexOf(p), 1)}
 const gate = homeOf(RA).gate, farX = gate.x < 40 ? gate.x + 30 : gate.x - 30;
 const gather = () => {RM.forEach((x, i) => {x.x = gate.x + i * .5; x.y = gate.y - 1; x.state = 'town'; x.townStep = 2; x.wait = 99; x.hidden = false; x.target = null; x.pq = []; x.hp = maxHp(x); x.splitUntil = 0; delete x.apartSince; delete x.missed; delete x.catchUp; x.chat = []; x.playEv = []})};
 const awayB = () => {RB.x = farX; RB.y = gate.y - 1};
 const mem = RM.filter(x => x !== RB);
 // shouting range
 gather(); awayB();
 let q = act(RA, 'party_say', {text: 'Hold the ford!'});
 ok(q.ok && !q.heard_by.includes(RB.name) && q.too_far.includes(RB.name) && mem.filter(x => x !== RA).every(x => q.heard_by.includes(x.name)), `party_say: ${q.note}`);
 ok(!(RB.chat || []).some(e => e.text === 'Hold the ford!') && mem.filter(x => x !== RA).every(x => x.chat.some(e => e.party && e.text === 'Hold the ford!')), 'the far member hears nothing; those in range do');
 ok(C.COUNCIL.SHOUT === 12 && C.COUNCIL.HEAR === 7, 'one shout constant (12), earshot stays 7');
 gather(); RM.forEach((x, i) => {x.x = 5 + i * 20; x.y = 10 + (i % 2) * 20});
 q = act(RA, 'party_say', {text: 'Anyone?'});
 ok(q.ok && q.heard_by.length === 0 && /No one is near/.test(q.note), 'a shout nobody can hear says so (' + q.note + ')');
 // councils need presence
 gather(); awayB(); delete S.fellowship.wait; for (const P of C.openProps()) P.status = 'failed';
 let pq = act(RA, 'propose', {kind: 'other', details: 'Rest at the ford'});
 const PP = C.propById(Number(String(pq.proposal).match(/#(\d+)/)[1]));
 ok(pq.ok && PP.absent && PP.absent.includes(RB.id), 'a proposal made while split reaches only the members in range');
 const vb = act(RB, 'vote', {proposal_id: PP.id, vote: 'yes'});
 ok(!vb.ok && /too far/.test(JSON.stringify(vb)), 'the absent member cannot vote');
 for (const x of mem) if (!PP.votes[x.id] && PP.status === 'open') act(x, 'vote', {proposal_id: PP.id, vote: 'yes', reason: 'ok'});
 ok(PP.status !== 'open' && !PP.votes[RB.id] && /Passed 4-0/.test(PP.result), 'a vote counts only the members present, and settles without the absent one: ' + PP.result);
 const cq = act(RA, 'propose', {kind: 'crypt', details: 'Down we go'});
 ok(!cq.ok && /whole Fellowship together/.test(JSON.stringify(cq)), 'a Crypt call needs everyone together');
 // meeting plans
 gather(); awayB(); for (const x of RM) x.memories = null;
 const pl = C.makeMeeting(RA, 'the ford at Mirefen', 6);
 ok(!pl.error && !pl.who.includes(RB.id) && pl.who.length === 4, 'a meeting plan is recorded for those who heard it (' + (pl.whoNames || pl.error) + ')');
 ok(F_.openThreads().some(t => t.kind === 'meeting') && RA.chat.some(e => /meet again at the ford/.test(e.text)), 'it is an open thread and a party line');
 const hasNote = x => (x.memories && x.memories.notes || []).some(n => (n.tags || []).includes('plan'));
 ok(hasNote(RA) && hasNote(mem[1]) && !hasNote(RB), 'a memory (#155) for everyone present, none for the absent member');
 ok(!(RB.chat || []).some(e => /ford at Mirefen/.test(e.text)), 'the absent member got no word of it');
 // couriers
 gather(); awayB(); RA.gold = 100; RA.state = 'town';
 const sc2 = act(RA, 'send_courier', {to: RB.name, text: 'Meet me at the ford.'});
 ok(sc2.ok && sc2.cost > 0 && RA.gold === 100 - sc2.cost && sc2.arrives_in_hours > 1, `a paid courier is hired at the gate: ${sc2.cost}g, ${sc2.arrives_in_hours} h (${sc2.error || ''})`);
 ok(!act(RA, 'send_courier', {to: RM[2].name, text: 'Hi'}).ok, 'no courier to someone who can hear you');
 RA.state = 'hunt'; ok(!act(RA, 'send_courier', {to: RB.name, text: 'x'}).ok, 'couriers are hired in town only'); RA.state = 'town';
 C.councilTick(); ok(!(RB.chat || []).some(e => e.courier), 'nothing arrives at once');
 const due = S.fellowship.post[0].due, gm0 = S.gameMin; S.gameMin = due - 1; C.councilTick(); ok(!(RB.chat || []).some(e => e.courier), 'nor before the delay');
 S.gameMin = due + 1; C.councilTick();
 ok((RB.chat || []).some(e => e.courier && e.text === 'Meet me at the ford.') && (RB.playEv || []).some(e => /courier finds you/.test(e.text)) && S.fellowship.post.length === 0, 'the message arrives after its delay, as an event and a chat line');
 // catching up after an absence: no facts until a companion says them
 gather(); for (const x of RM) {x.chat = []; x.playEv = []}
 C.councilTick(); awayB(); C.councilTick();
 ok(RB.apartSince != null, 'a member out of range is tracked as apart');
 F_.campaign('scene', 'The Fellowship fought off an ambush at the ford.'); F_.campaign('npc', 'Old Hesk warned them of the fen.');
 S.gameMin += 180; C.councilTick(); RB.x = RA.x + 1; RB.y = RA.y; RB.chat = []; RB.playEv = []; for (const x of RM) if (x !== RB) x.playEv = [];
 C.councilTick();
 const tellEv = [].concat(...mem.map(x => x.playEv)).filter(e => /is back after 3 hours/.test(e.text));
 ok(tellEv.length === 1 && /ambush at the ford/.test(tellEv[0].text) && /Old Hesk/.test(tellEv[0].text) && /Catch them up/.test(tellEv[0].text), 'one present member is told what was missed and asked to say it');
 ok(RB.playEv.some(e => /back with the company/.test(e.text)) && !RB.playEv.some(e => /ambush|Hesk/.test(e.text)) && !RB.chat.length, 'the returner is told only to ask: no facts reach it');
 C.councilTick(); C.councilTick(); ok(RM.reduce((n, x) => n + x.playEv.filter(e => /is back after|back with the company/.test(e.text)).length, 0) === 2, 'the briefing fires once');
 ok(!PACE.paceBrief(RB.id).brief.warning, 'no warning yet');
 S.gameMin += 40; ok(/not been told/.test(PACE.paceBrief(RB.id).brief.warning || '') && /not been told/.test(act(RB, 'status').warning || ''), 'unspoken for a while, the returner\'s turn header says it has not been told');
 act(RA, 'party_say', {text: 'You missed an ambush at the ford, and Old Hesk warned us of the fen.'});
 ok(!PACE.paceBrief(RB.id).brief.warning && RB.chat.some(e => /ambush at the ford/.test(e.text)), 'once a companion speaks, the returner hears it in game and the warning goes');
 for (const x of RM) {x.splitUntil = 0; x.chat = []}
}

// ---- 5. the Crypt: all together or not at all ----
T.TABLE.mode = 'off'; T.TABLE.speed = 1; // outside Table mode: the Crypt call is a proposal the agents answer with vote
const reset = () => {if (CRYPT.group) for (const a of CRYPT.group.mem) {a.state = 'hunt'; a.hidden = false} CRYPT.group = null; CRYPT.cd = 0};
// everyone of the faction safe in town (in the Crypt pool, and nothing attacks them there)
const field = () => {for (const a of S.agents) if (a.fac === 0 && a.state !== 'dead') {const c = homeOf(a); a.lvl = a.fellow ? 8 : 6; a.state = 'town'; a.townStep = 2; a.wait = 9; a.x = c.gate.x; a.y = c.gate.y - 1; a.target = null; a.pq = []; a.hidden = false; a.raid = false; a.hp = maxHp(a)}};
for (const x of RM) link(x, 'none');
ok(RM.every(x => x.player && SIM.reflexMay(x)), 'no runner holds any member: their reflexes play them and vote (#148)');
field(); const others = S.agents.filter(a => a.fac === 0 && !a.fellow && a.state !== 'dead').slice(0, 2); for (const a of others) a.lvl = 8;
let formed = null; for (let k = 0; k < 400 && !formed; k++) {reset(); field(); for (const a of others) a.lvl = 8; S.dmLogSeq = S.dmLogSeq; step(1 / 60); const g = CRYPT.group; if (g && g.fac === 0) formed = g.mem.slice();}
ok(formed && F_.fellows().every(a => formed.includes(a)), `a Crypt call drafts the whole Fellowship together (${formed && formed.map(a => a.name + (a.fellow ? '*' : '')).join(', ')})`);
reset(); field(); for (const a of others) a.lvl = 8; RM[4].lvl = 6; // one member cannot go
let split = false; for (let k = 0; k < 400; k++) {reset(); field(); for (const a of others) a.lvl = 8; RM[4].lvl = 6; step(1 / 60); const g = CRYPT.group; if (g && g.mem.some(a => a.fellow)) {split = true; break}}
ok(!split, 'with one member unable to go, none of them is drafted');
ok(S.fellowship.log.some(e => e.kind === 'council' && /not all of/.test(e.parts.map(p => typeof p === 'string' ? p : '').join(''))), 'the log says they stayed together');
// an agent party is asked, not drafted
for (const x of RM) link(x, 'waiting'); reset(); field(); for (const a of others) a.lvl = 8; S.fellowship.cool = {};
let prop = null; for (let k = 0; k < 400 && !prop; k++) {reset(); field(); for (const a of others) a.lvl = 8; step(1 / 60); prop = C.openProps().find(q => q.kind === 'crypt'); if (CRYPT.group && CRYPT.group.mem.some(a => a.fellow)) break}
ok(prop && !(CRYPT.group && CRYPT.group.mem.some(a => a.fellow)), `an agent-played Fellowship gets a proposal instead of a draft: "${prop && prop.details}"`);
reset(); field();
for (const a of F_.fellows()) if (!prop.votes[a.id]) act(a, 'vote', {proposal_id: prop.id, vote: 'yes', reason: 'Together.'});
ok(prop.status === 'passed' && CRYPT.group && F_.fellows().every(a => CRYPT.group.mem.includes(a) && a.cryptOk), `they vote yes and set out together (${prop.result})`);
step(1 / 60); step(1 / 60);
ok(F_.fellows().every(a => a.state === 'dungeon'), 'agent members stay in the Crypt group (not turned down as an unasked draft)');

// ---- 5c. priority (#135): a gathering group steps aside; a group inside means we go next, the cooldown waived ----
{const D = await import('../src/sim/dungeon.js');
 reset(); field(); for (const x of RM) link(x, 'none'); S.fellowship.cool = {}; S.fellowship.wait = {};
 const bg = S.agents.filter(a => a.fac === 0 && !a.fellow && a.state !== 'dead').slice(0, 4); for (const a of bg) a.lvl = 8;
 const voteCrypt = () => {const q = C.propose(C.leaderOfF(), 'crypt', 'Down we go.', {vote: 'yes'}); for (const a of F_.fellows()) if (q.status === 'open' && !q.votes[a.id]) C.castVote(a, q.id, 'yes', '', 'agent'); return q};
 D.musterCrypt(bg, 0, null, 'Hollow Cleavers'); const before = CRYPT.group;
 const q1 = voteCrypt();
 ok(q1.status === 'passed' && CRYPT.group && CRYPT.group !== before && F_.fellows().every(a => CRYPT.group.mem.includes(a)) && bg.every(a => !CRYPT.group.mem.includes(a) && a.state === 'hunt'), `a gathering group steps aside and the Fellowship takes the Crypt (${q1.result})`);
 reset(); field(); for (const a of bg) a.lvl = 8; S.fellowship.cool = {}; S.fellowship.wait = {};
 D.musterCrypt(bg, 0, null, 'Hollow Cleavers'); CRYPT.group.phase = 'inside'; CRYPT.group.t = 400; for (const a of bg) a.hidden = true;
 const q2 = voteCrypt();
 ok(q2.status === 'passed' && /another group is inside/.test(q2.result) && S.fellowship.wait.crypt > S.gameMin, `a passed vote is not dropped while a group is inside (${q2.result})`);
 CRYPT.cd = 9999; CRYPT.group.t = 0.01; field(); for (const a of bg) {a.state = 'dungeon'; a.hidden = true}
 for (let k = 0; k < 20 && !(CRYPT.group && CRYPT.group.mem.some(a => a.fellow)); k++) {step(1 / 60); field()}
 ok(CRYPT.group && F_.fellows().every(a => CRYPT.group.mem.includes(a)) && !S.fellowship.wait.crypt, 'when they come out the Fellowship goes next, cooldown waived');
 reset(); S.fellowship.wait = {}; CRYPT.cd = 0;
}
// ---- 5b. staged scenes (issue #132): a fresh world in a child ----
{const ch = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--staged'], {encoding: 'utf8', env: {...process.env}});
  process.stdout.write(ch.stdout || ''); if (ch.stderr) process.stderr.write(ch.stderr);
  ok(ch.status === 0 && /STAGED OK/.test(ch.stdout || ''), 'staged scenes: every kind with a mock DM, a silent DM, no runner, 3x, a save mid-scene, expiry')}

// ---- 6. determinism without a Fellowship ----
const me = fileURLToPath(import.meta.url), h1 = spawnSync(process.execPath, [me, '--hash'], {encoding: 'utf8'}).stdout.trim(), h2 = spawnSync(process.execPath, [me, '--hash'], {encoding: 'utf8'}).stdout.trim();
ok(/^HASH -?\d+ table:0 fellowship:0$/.test(h1) && h1 === h2, `no Fellowship: two seeded 3-minute runs are identical (${h1})`);
{const t1 = spawnSync(process.execPath, [me, '--hash-talk'], {encoding: 'utf8'}), t2 = spawnSync(process.execPath, [me, '--hash-talk'], {encoding: 'utf8'});
  const x1 = (t1.stdout || '').trim().split('\n').pop(), x2 = (t2.stdout || '').trim().split('\n').pop(); if (t1.stderr) process.stderr.write(t1.stderr);
  ok(/^HASH -?\d+ plans:\w+ post:0$/.test(x1) && x1 === x2, `a split Fellowship (shouts, a plan, a courier): two seeded runs are identical (${x1})`)}

console.log(fail ? `\n${fail} check(s) FAILED\n` : '\nAll table checks passed.\n');
process.exit(fail ? 1 : 0);
