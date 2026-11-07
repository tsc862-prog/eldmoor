// Hero tool challenge (#633): an honour duel to yield (or first blood) among one faction, played at the table.
//   refusals (another faction, a fight, a scene open, camp, the Crypt, a hurt or far hero, a scripted caller), an agent's
//   accept and decline, the duel scene in rounds (two actors, initiative, the banner), first blood, the yield at 30%, no
//   downing and no death, honour, bonds, stances, landmarks and the chronicle after, the per-day and same-pair limits, a
//   lapse, a scripted answer, Thornvale's first blood only, a beaten leader yields the lead, Watch mode (fought at once),
//   privacy of the results, and a save/restore mid-duel. No model, no network. Usage: node scripts/challengecheck.mjs
let seed = 0x06330633;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const SLT = await import('../src/sim/company.js');
const T = await import('../src/sim/table.js');
const {DUEL} = await import('../src/sim/challenge.js');
const {leaderOfC} = await import('../src/sim/council.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {CRYPT, zoneFor, zonePoint, zoneAt, dist} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');
const {sceneHead} = await import('../src/core/scenehead.js');
const {allScenes} = await import('../src/sim/scenes.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => {a.playRate = []; return P.playerAct(a.id, tool, args || {})};
const share = a => a.hp / maxHp(a);
const heal = L => {for (const x of L) x.hp = maxHp(x)};
const duel = () => allScenes().find(sc => sc.kind === 'duel') || null;
// Play an open duel: each agent's turn answered by pick(a, sc) (default strike), until it closes. Returns the scene.
function play(pick = () => 'strike', onRound) {
  let sc = duel(), last = sc, f = 0, rd = 0;
  while (sc && f++ < 60 * 600) {
    if (sc.phase === 'turn' && (!sc.wk || sc.wk.done)) {const a = S.agents.find(x => x.id === sc.ids[sc.i]);
      if (a && a.player && !sc.acts[a.id]) act(a, 'scene_act', {option: pick(a, sc)})}
    if ((sc.rd || 1) !== rd) {rd = sc.rd || 1; if (onRound) onRound(sc)}
    step(1 / 60); sc = duel(); if (sc) last = sc}
  return last}

console.log('\nEldmoor challengecheck: honour duels (#633)\n');
init({fellowship: false}); run(20);
for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
SLT.foundSlots(SLT.autoPick(0), {fac: 0, ai: false}); SIM.setRunnerLinks(() => 'connected');
T.TABLE.speed = 1; T.TABLE.mode = 'auto';
const F = SLT.slotted(), M = SLT.slotMembers(F).map(m => m.hero), [A, B, C, D, E] = M;
const home = homeOf(A).gate, spot = zonePoint(zoneFor(8, home), null, home);
ok(zoneAt(spot.x, spot.y) >= 1, 'the field is outside the vale');
const clear = () => {for (const m of S.mobs) if (m.alive && dist(m, spot) < 20) {m.alive = false; m.gone = true}
  for (const x of S.agents) if (x.fac !== 0 && x.state !== 'dead' && dist(x, spot) < 20) {x.x = 2; x.y = 2}};
const placeAll = () => {clear(); M.forEach((x, i) => {x.x = spot.x + (i % 3) * .8; x.y = spot.y + Math.floor(i / 3) * .8; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.pq = []; x.cmd = null}); heal(M); rebuild()};
placeAll();
const scripted = S.agents.find(x => x.kind === 'hero' && x.fac === 0 && !x.player && x.state !== 'dead' && !SLT.companyOf(x));
const foe = S.agents.find(x => x.kind === 'hero' && x.fac === 1 && x.state !== 'dead');

console.log('refusals:');
let r = act(A, 'challenge', {}); ok(!r.ok && /Challenge whom/.test(r.error), r.error);
foe.x = A.x + 1; foe.y = A.y; foe.state = 'hunt'; foe.hidden = false; rebuild();
r = act(A, 'challenge', {hero: foe.name}); ok(!r.ok && /not of your faction/.test(r.error), r.error); foe.x = 2; foe.y = 2; rebuild();
r = act(A, 'challenge', {hero: A.name}); ok(!r.ok && /yourself/.test(r.error), r.error);
r = act(A, 'challenge', {hero: B.name, to: 'death'}); ok(!r.ok && /first blood/.test(r.error), r.error);
A.state = 'fight'; r = act(A, 'challenge', {hero: B.name}); ok(!r.ok && /fight/.test(r.error), r.error); A.state = 'hunt';
B.state = 'camp'; r = act(A, 'challenge', {hero: B.name}); ok(!r.ok && /camped/.test(r.error), r.error); B.state = 'hunt';
CRYPT.group = {mem: [B], phase: 'inside'}; r = act(A, 'challenge', {hero: B.name}); ok(!r.ok && /down in/.test(r.error), r.error); CRYPT.group = null;
S.table = {id: 999, company: F.id, kind: 'check', ids: [B.id], phase: 'turn', ctx: {}, beats: [], acts: {}};
r = act(A, 'challenge', {hero: B.name}); ok(!r.ok && /scene/.test(r.error), r.error); S.table = null;
B.hp = Math.floor(maxHp(B) * .45); r = act(A, 'challenge', {hero: B.name}); ok(!r.ok && /half/.test(r.error), r.error); heal([B]);
B.x = A.x + 9; rebuild(); r = act(A, 'challenge', {hero: B.name}); ok(!r.ok && /tiles away/.test(r.error), r.error); placeAll();
r = P.playerAct(scripted.id, 'challenge', {hero: A.name}); ok(!r.ok && /not agent-played/.test(r.error), 'a scripted hero never issues one');
ok(!S.challenges && !duel(), 'a refusal leaves no challenge and no scene');

console.log('accept, the duel in rounds:');
const hon0 = {[A.id]: A.honor, [B.id]: B.honor}, bond0 = (A.bonds && A.bonds[B.id]) || 0;
r = act(A, 'challenge', {hero: B.name, to: 'yield', text: 'Settle it, then. Blades out.'});
ok(r.ok && r.answer === 'waiting' && r.mode === 'yield' && S.challenges.length === 1, 'issued to an agent: it waits for the answer');
ok((B.playEv || []).some(e => /challenges you to an honour duel/.test(e.text)), 'the challenged agent is told (a must-answer event)');
ok((B.chat || []).some(e => /Settle it/.test(e.text)), 'the challenge is said aloud and heard');
r = act(B, 'answer_challenge', {}); ok(!r.ok && /accept or decline/.test(r.error), 'answer_challenge with no answer tells the challenge');
const snapPend = JSON.parse(JSON.stringify(snapshot())); ok(snapPend.challenges && snapPend.challenges.length === 1, 'a pending challenge is saved');
r = act(B, 'answer_challenge', {answer: 'accept', text: 'Gladly.'});
let sc = duel();
ok(r.ok && r.answer === 'accepted' && sc && sc.ids.length === 2 && sc.ids.includes(A.id) && sc.ids.includes(B.id), 'accepted: a duel scene with the two duellists only');
ok(!S.challenges, 'the challenge is answered');
ok([C, D, E].some(x => (x.playEv || []).some(e => /fight an honour duel/.test(e.text))), 'the company present is told to watch');
const ban = T.bannerOf(sc); ok(ban && ban.kind === 'duel' && /honour duel/.test(ban.title) && /^Duel · /.test(sceneHead(ban.kind, ban.title).head), 'the Table banner shows the duel: ' + (ban && sceneHead(ban.kind, ban.title).head));
const s1 = play((a, s) => (s.rd || 1) === 1 ? 'guard' : 'strike');
const fin = s1.ctx, A1 = S.agents.find(x => x.id === A.id), B1 = S.agents.find(x => x.id === B.id);
ok(!duel() && fin.done && fin.end, 'the duel ends: ' + fin.end + ' (' + s1.summary + ')');
ok(s1.beats.some(b => b.rd === 2), 'it went past round 1 (both guarded in round 1)');
ok(s1.beats.filter(b => b.k === 'strike').every(b => b.roll), 'every strike carries its roll for the banner');
ok([A1, B1].every(x => x.state !== 'dead' && x.state !== 'downed' && share(x) >= DUEL.FLOOR - 1e-9), 'no one downed or dead; HP floor held: ' + [A1, B1].map(x => Math.round(share(x) * 100) + '%').join(', '));
if (fin.end !== 'draw') {const W = S.agents.find(x => x.id === fin.win), L = S.agents.find(x => x.id === fin.lose);
  ok(W.honor === hon0[W.id] + 1 && L.honor === hon0[L.id], 'honour +1 to the winner only');
  ok(W.duelRec[L.id].w === 1 && L.duelRec[W.id].l === 1, 'wins and losses kept');
  ok(/beat them/.test(W.memory.events[L.id]) && /beat me/.test(L.memory.events[W.id]), 'both stances say who won');
  ok(W.tiers.marks.some(m => m.k === 'duel') && L.tiers.marks.some(m => m.k === 'duel'), 'a landmark for both');
  if (fin.end === 'yield') ok(share(L) <= DUEL.YIELD + 1e-9 || s1.beats.some(b => b.k === 'yield'), 'the loser yielded at 30%')}
ok(((A1.bonds && A1.bonds[B.id]) || 0) > bond0, 'a bond event between the two');
ok(S.chronicle.some(e => e.parts.some(p => typeof p === 'string' && /honour duel/.test(p))), 'a chronicle line');

console.log('yield at 30%:');
S.gameMin += 1440; placeAll(); const lv = C.lvl;
r = act(C, 'challenge', {hero: D.name, to: 'yield'}); const r2 = act(D, 'answer_challenge', {answer: 'accept'});
sc = duel(); ok(!!sc, 'a second duel opens' + (sc ? '' : ': ' + JSON.stringify([r, r2])));
C.lvl = 60; C.hp = maxHp(C); D.hp = Math.ceil(maxHp(D) * .3) + 2; B.x += 30; // the company forms up in the field now (#1048), and its healer would tend the loser the moment it is over
sc = play(a => a === D ? 'guard' : 'strike'); C.lvl = lv; C.hp = Math.min(C.hp, maxHp(C));
ok(sc.ctx.end === 'yield' && sc.ctx.lose === D.id && share(D) <= DUEL.YIELD + 1e-9 && D.state !== 'downed' && D.state !== 'dead', 'a duellist at 30% yields, never downed: ' + Math.round(share(D) * 100) + '% (' + sc.summary + ')');

console.log('first blood:');
placeAll(); r = act(E, 'challenge', {hero: C.name, to: 'first blood'}); act(C, 'answer_challenge', {answer: 'accept'});
sc = play();
const hits = sc.beats.filter(b => b.roll && b.roll.hit);
ok(sc.ctx.end === 'blood' ? hits.length === 1 && sc.beats.indexOf(hits[0]) === sc.beats.length - 1 : sc.ctx.end === 'draw' || sc.ctx.end === 'points', 'first blood ends at the first hit: ' + sc.ctx.end + ' (' + sc.summary + ')');

console.log('decline, limits, lapse:');
placeAll();
const pair0 = act(C, 'challenge', {hero: E.name}); ok(!pair0.ok && /let it rest/.test(pair0.error), 'the same pair too soon: ' + pair0.error);
r = act(E, 'challenge', {hero: D.name}); ok(r.ok && r.answer === 'waiting', 'E challenges D');
const h0 = E.honor; r = act(D, 'answer_challenge', {answer: 'decline', text: 'Not today, friend.'});
ok(r.ok && r.answer === 'declined' && !duel() && !S.challenges, 'declined: no duel');
ok((E.chat || []).some(e => /Not today, friend/.test(e.text)) && (A.chat || []).some(e => /Not today, friend/.test(e.text)), 'the decline is heard by those near');
ok(/turned down/.test(E.memory.events[D.id]) && E.honor === h0, 'a note in the challenger\'s stance; it costs the challenger nothing');
r = act(E, 'challenge', {hero: A.name}); ok(!r.ok && /2 challenges today/.test(r.error), 'a third today (E challenged C and D): ' + r.error);
r = act(B, 'challenge', {hero: C.name}); ok(r.ok && r.answer === 'waiting', 'B challenges C, who stays silent');
r = act(D, 'challenge', {hero: C.name}); ok(!r.ok && /already stands/.test(r.error), 'one challenge at a time: ' + r.error);
for (let i = 0; i < 60 * 12 && S.challenges; i++) step(1 / 60);
ok(!S.challenges && /unanswered/.test(B.memory.events[C.id]), 'after an hour it lapses');

console.log('a scripted hero answers at once:');
let answers = [], accepted = null;
for (let day = 0; day < 8 && !accepted; day++) {
  S.gameMin += 1440; placeAll(); scripted.x = E.x + 1; scripted.y = E.y; scripted.state = 'hunt'; scripted.hidden = false; scripted.lvl = E.lvl; scripted.hp = maxHp(scripted); scripted.honor = 100; rebuild();
  r = act(E, 'challenge', {hero: scripted.name}); answers.push(r.answer); if (r.answer === 'accepted') accepted = r}
ok(answers.every(x => x === 'accepted' || x === 'declined') && !S.challenges, 'answered at once, by boldness and honour: ' + answers.join(', '));
if (accepted) {sc = duel() ? play() : null; ok(scripted.state !== 'dead' && scripted.state !== 'downed', 'the scripted duellist plays by reflex and stands: ' + (sc ? sc.summary : accepted.result))}
else ok(false, 'a scripted hero never accepted in 8 days');

console.log('Thornvale: first blood only:');
placeAll(); const vale = homeOf(A).gate; D.x = vale.x; D.y = vale.y + 2; B.x = vale.x + 1; B.y = vale.y + 2; D.state = B.state = 'travel'; rebuild();
ok(zoneAt(D.x, D.y) < 1, 'D stands in the vale');
r = act(D, 'challenge', {hero: B.name, to: 'yield'}); ok(r.ok && r.mode === 'first blood' && /first blood/.test(r.note || ''), 'to yield becomes first blood: ' + r.note);
act(B, 'answer_challenge', {answer: 'decline'});

console.log('a beaten leader yields the lead:');
S.gameMin += 1440; for (const x of M) {const g = homeOf(x).gate; x.x = g.x; x.y = g.y; x.state = 'town'; x.party = null} S.parties = S.parties.filter(p => p.company !== F.id);
for (let i = 0; i < 600 && !SLT.slotParty(F); i++) step(1 / 60);
placeAll(); const Pt = SLT.slotParty(F), lead = leaderOfC(F), W = M.find(x => x !== lead);
ok(!!Pt && Pt.mem.includes(lead) && Pt.mem.includes(W), 'the Fellowship rides as one party led by ' + lead.name);
r = act(W, 'challenge', {hero: lead.name}); act(lead, 'answer_challenge', {answer: 'accept'});
sc = play(a => a === lead ? 'yield' : 'guard');
ok(sc.ctx.win === W.id && leaderOfC(F) === W && Pt.leader === W, 'the leader yields and ' + W.name + ' leads: ' + sc.summary);

console.log('Watch mode: fought at once:');
S.gameMin += 1440; placeAll(); T.TABLE.mode = 'off';
r = act(A, 'challenge', {hero: E.name, to: 'yield'}); r = act(E, 'answer_challenge', {answer: 'accept'});
ok(r.ok && r.answer === 'accepted' && !duel() && /accepts\. .+\./.test(r.result), 'no scene; the result at once: ' + r.result);
ok([A, E].every(x => x.state !== 'dead' && x.state !== 'downed' && share(x) >= DUEL.FLOOR - 1e-9), 'still no one downed');
T.TABLE.mode = 'auto';

console.log('privacy:');
const secret = 'zx-secret-' + Date.now(); B.memory.events[A.id] = secret;
S.gameMin += 1440; placeAll(); B.memory.events[A.id] = secret;
const out = [act(A, 'challenge', {hero: B.name}), act(B, 'answer_challenge', {}), act(B, 'answer_challenge', {answer: 'decline'})];
ok(!JSON.stringify(out).includes(secret) && !JSON.stringify(A.playEv || []).includes(secret), 'results and events never carry another hero\'s stance or memories');

console.log('save/restore mid-duel:');
S.gameMin += 1440; placeAll();
act(C, 'challenge', {hero: E.name, to: 'yield'}); act(E, 'answer_challenge', {answer: 'accept'});
let saved = null, restoredOk = false;
const s9 = play((a, s) => (s.rd || 1) === 1 ? 'guard' : 'strike', s => {
  if ((s.rd || 1) === 2 && !saved) {saved = JSON.stringify(snapshot()); restore(JSON.parse(saved)); const s2 = duel(); restoredOk = !!s2 && s2.kind === 'duel' && s2.ctx.mode === 'yield' && s2.ids.length === 2}});
ok(restoredOk, 'saved and restored in round 2: the duel resumes');
ok(!duel() && s9.ctx.done && s9.beats.some(b => b.rd === 2), 'and ends after the restore: ' + s9.summary);
ok(S.agents.filter(x => x.id === C.id || x.id === E.id).every(x => x.state !== 'dead' && x.state !== 'downed'), 'no one downed');
const s0 = JSON.stringify(snapshot()); restore(JSON.parse(s0)); ok(JSON.stringify(snapshot()) === s0, 'the round trip is identical');

console.log(fail ? `\nchallengecheck: ${fail} FAILED` : '\nchallengecheck: all ok');
process.exit(fail ? 1 : 0);
