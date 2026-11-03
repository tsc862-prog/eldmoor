// Hero tool hire (#634): a sellsword, drover or guide rides as a scripted companion for gold a day.
//   hire (price, days, the hero made, outside the slots and the start gate), refusals, follow/fight, never votes or leads,
//   a guide's words, days up, dismiss, death (mourned, not replaced, wary town), the DM's hire offer, the Fellowship, the
//   cap, save/restore. No model, no network. Usage: node scripts/hirecheck.mjs
let seed = 0x06340634;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp, snapshot, restore} = SIM;
const P = await import('../src/sim/player.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {ZONES} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');
const {companyOf, members, slotted, inSlots, slotKeyOf} = await import('../src/sim/company.js');
const {voters, leaderOfC} = await import('../src/sim/council.js');
const {placesView} = await import('../src/sim/lore.js');
const TK = await import('../src/sim/talk.js');
const {HIRE, guideWords} = await import('../src/sim/hire.js');
const {fall} = await import('../src/sim/heroes.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => {a.playRate = []; return P.playerAct(a.id, tool, args || {})};
const J = v => JSON.stringify(v);
const park = (x, p, st) => {x.x = p.x; x.y = p.y; x.state = st; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []; x.cmd = null};
const live = () => S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const beside = (a, p) => {park(a, {x: p.x + 1, y: p.y}, 'town'); rebuild()};
const {pull} = await import('../src/sim/levers.js');
const place = (role, town, spot = 'gate') => {S.gameMin += 100; const r = pull('create_npc', {role, home: 'town', town, spot, attitude: 'neutral', hours: 168}, {by: 'dm-agent', reason: 'hirecheck'}); return r.ok ? r.ret : null};
const hurry = h => {for (let i = 0; i < 4000 && !h.hire.done; i++) step(1 / 30)};

console.log('\nEldmoor hirecheck: hire (#634)\n');
init({fellowship: false}); run(10);
const A = live().find(a => a.fac === 0), c = homeOf(A);
P.markPlayer(A, true);
const sword = place('sellsword', c.name);
ok(!!sword, 'the town has a sellsword: ' + (sword && sword.name));
const priest = (S.npcs || []).find(p => p.town === c.name && p.role === 'priest');
const scripted = S.agents.find(x => x.kind === 'hero' && !x.player && x.state !== 'dead' && x !== A);

console.log('refusals:');
beside(A, sword); A.gold = 100;
let r = act(A, 'hire', {}); ok(!r.ok && /Hire whom/.test(r.error), r.error);
r = act(A, 'hire', {npc: sword.name, days: 0}); ok(!r.ok && /days is 1 to 5/.test(r.error), r.error);
r = act(A, 'hire', {npc: sword.name, days: 6}); ok(!r.ok, 'six days refused');
priest.x = A.x + 1; priest.y = A.y; r = act(A, 'hire', {npc: priest.name}); ok(!r.ok && /does not hire out/.test(r.error), r.error);
r = act(A, 'hire', {npc: 'nobody at all'}); ok(!r.ok && /No one called/.test(r.error), r.error);
A.gold = 3; r = act(A, 'hire', {npc: sword.name, days: 2}); ok(!r.ok && /hold 3 gold/.test(r.error), r.error); A.gold = 100;
A.state = 'fight'; r = act(A, 'hire', {npc: sword.name}); ok(!r.ok && /fight/.test(r.error), r.error); A.state = 'town';
sword.attitude = 'hostile'; r = act(A, 'hire', {npc: sword.name}); ok(!r.ok && /does not like you/.test(r.error), r.error); sword.attitude = 'neutral';
S.hireWary = {[c.name]: S.gameMin + 1000}; r = act(A, 'hire', {npc: sword.name}); ok(!r.ok && /wary/.test(r.error), r.error); S.hireWary = {};
ok(A.gold === 100, 'a refusal costs nothing');
r = P.playerAct(scripted.id, 'hire', {npc: sword.name}); ok(!r.ok, 'a scripted hero does not hire');

console.log('hire:');
const lvl = A.lvl, hs0 = S.agents.length, rec0 = S.recruits.length;
r = act(A, 'hire', {npc: sword.name, days: 2});
const price = (HIRE.BASE + lvl) * 2;
ok(r.ok && r.paid === price && r.days === 2 && A.gold === 100 - price, `2 days cost ${price}: ${r.ok ? 'ok' : r.error}`);
const H = S.agents.find(x => x.hire && x.hire.npc === sword.id), C = companyOf(A);
ok(H && H.name === sword.name && !H.player && H.companion === C.id && C.ids.includes(H.id), 'a scripted companion with the person name rides in the company');
ok(H.lvl === Math.max(1, Math.min(...members(C).map(b => b.lvl))), 'at the lowest level of the company: ' + H.lvl);
ok(!inSlots(H) && !slotted(), 'outside the slots');
ok(!(S.wanderers || []).includes(sword) && S.hireAway.length === 1 && sword.hired === H.id, 'the person leaves the town while hired');
ok(!H.player && !P.seatList, 'not agent-played, so no seat for the start gate');
r = act(A, 'hire', {npc: sword.name}); ok(!r.ok, 'a second hire of the same person is refused');
ok((act(A, 'companions', {}).riders || []).some(x => /hired/.test(x.rides_as || '')), 'companions names the hire');
ok(leaderOfC(C) === A, 'never leads');
ok(voters({company: C.id, absent: [], kind: 'other'}).every(b => !b.hire), 'never votes (voters skip hires)');
ok(S.agents.length === hs0 + 1 && S.recruits.length === rec0, 'one hero made, no recruit queued');

console.log('follow and fight:');
S.mobs.length = 0; const field = {x: 40, y: 25};
park(A, field, 'hunt'); park(H, field, 'hunt'); H.x += 1; rebuild();
run(5);
ok(dist2(A, H) < 15 || H.state === 'town', `the hire stays with the leader (${dist2(A, H).toFixed(1)} tiles, ${H.state})`);
ok(H.hp > 0 && H.state !== 'dead', 'and fights by the scripted rules');

console.log('guide:');
init({fellowship: false}); run(5);
const G = live().find(a => a.fac === 0); P.markPlayer(G, true);
const dr = place('drover', homeOf(G).name, 'square');
G.gold = 200; beside(G, dr);
r = act(G, 'hire', {npc: dr.name, days: 1}); ok(r.ok, 'a drover is a guide: ' + (r.error || r.role));
const guide = S.agents.find(x => x.hire);
ok(guide && guide.hire.role === 'guide' && guide.cls === 'Hunter', 'a Hunter guide');
ok(placesView(G).some(x => x.startsWith(ZONES[guide.hire.zone])), 'places lists the guide region: ' + ZONES[guide.hire.zone]);
const far = ZONES.length - 1, gw = guideWords(G, far);
ok(gw && gw.includes(guide.name), 'the guide words join the danger warning: ' + (gw || '').slice(0, 50));
ok(!guideWords(S.agents.find(x => x !== G && x.kind === 'hero' && !x.player), far), 'a hero without a guide hears nothing extra');

console.log('days up, dismiss, death:');
S.gameMin = guide.hire.until + 1; run(2);
ok(guide.hire.over && guide.hire.end === 'days', 'days up ends the hire');
hurry(guide);
ok(guide.hire.done && !S.agents.includes(guide) && dr.hired == null && (S.wanderers || []).includes(dr) && dr.hmem && dr.hmem[G.id] && dr.hmem[G.id].hireEnd === 'days', 'walked home: a townsperson again, remembering the company');
G.gold = 100; beside(G, dr);
r = act(G, 'dismiss', {}); ok(!r.ok && /no hire/.test(r.error), r.error);
r = act(G, 'hire', {npc: dr.name, days: 3}); ok(r.ok, 're-hired');
const g2 = S.agents.find(x => x.hire && !x.hire.over);
r = act(G, 'dismiss', {npc: g2.name}); ok(r.ok && g2.hire.over && g2.hire.end === 'dismissed', 'dismiss pays off: ' + (r.note || r.error));
hurry(g2);
ok(g2.hire.done && (S.wanderers || []).includes(dr), 'and they are home');
G.gold = 100; beside(G, dr);
r = act(G, 'hire', {npc: dr.name, days: 2}); const g3 = S.agents.find(x => x.hire && !x.hire.over);
const rec1 = S.recruits.length;
fall(g3, 'a test blade'); run(1);
ok(g3.state === 'dead' && g3.hire.mourned && S.recruits.length === rec1, 'a hire that falls is dead and not replaced');
ok(!(S.wanderers || []).includes(dr) && S.hireWary && S.hireWary[dr.town] > S.gameMin, 'the town mourns: the person is gone and its sellswords are wary');

console.log('save and restore:');
init({fellowship: false}); run(5);
const B = live().find(a => a.fac === 0); P.markPlayer(B, true);
const sw = place('sellsword', homeOf(B).name); B.gold = 100; beside(B, sw);
r = act(B, 'hire', {npc: sw.name, days: 1}); ok(r.ok, 'hired before the save');
const hid = S.agents.find(x => x.hire).id;
const snap = JSON.parse(J(snapshot())); restore(snap);
const H2 = S.agents.find(x => x.id === hid), B2 = S.agents.find(x => x.id === B.id);
ok(H2 && H2.hire && H2.companion === companyOf(B2).id && S.hireAway.length === 1 && S.hireAway[0].p.name === sw.name, 'the hire and the person away survive a save');
S.gameMin = H2.hire.until + 1; run(2);
ok(H2.hire.over, 'and the days still run out after a restore');

console.log('the DM offer, the Fellowship and the cap:');
init(); run(10);
const F = slotted(), members5 = members(F), L = members5[0];
const sw2 = place('sellsword', homeOf(L).name);
for (const m of members5) {m.x = sw2.x + 1; m.y = sw2.y; m.state = 'town'}
rebuild(); L.gold = 500;
const tr = TK.talkTo(L, sw2, 'Need coin?'); ok(!tr.error, 'a conversation opens: ' + J(tr).slice(0, 60));
const cv = TK.convWith(sw2);
ok(cv && TK.legalOffers(cv, sw2).includes('hire'), 'hire is a legal follow-up for a sellsword');
const pri = (S.npcs || []).find(p => p.role === 'priest'); ok(!TK.legalOffers(cv, pri).includes('hire'), 'but not for a priest');
cv.offerEx = -1; const off = TK.offer(cv, sw2, 'hire', {price: 9}, 'dm-agent', L);
ok(off.ok && off.mark === '[hire]' && sw2.hireOffer.price === 9, 'the DM offers: ' + (off.hint || off.error));
S.table = null; S.tables = []; r = act(L, 'hire', {npc: sw2.name, days: 2}); ok(r.ok && r.wage === 9 && r.paid === 18, 'the offered price is charged: ' + (r.error || r.wage));
const FH = S.agents.find(x => x.hire && x.hire.npc === sw2.id);
ok(FH && companyOf(FH) === F && slotKeyOf(FH) === undefined && F.ids.length === 6, 'the Fellowship takes a hire outside its slots ' + (FH ? [companyOf(FH) === F, inSlots(FH), F.ids.length].join() : 'none'));
run(30); ok(true, 'the Fellowship world steps on with a hire (no throw)');
const fill = [];
while (F.ids.length < 8) {const h = S.agents.find(x => x.state !== 'dead' && x.company == null && !x.player && x.fac === F.fac && !fill.includes(x)); if (!h) break; fill.push(h); F.ids.push(h.id); h.company = F.id; h.companion = F.id}
const dr2 = place('drover', homeOf(L).name, 'square'); dr2.x = L.x; dr2.y = L.y; rebuild(); L.state = 'town';
r = act(L, 'hire', {npc: dr2.name}); ok(!r.ok && /holds 8|most a company/.test(r.error), 'a company of 8 refuses: ' + r.error);


// ---- the Fellowship with a hire: scenes, the crawl, the draft, lead_to, fireside, arrival, the start gate ----
const T = await import('../src/sim/table.js');
const D = await import('../src/sim/dungeon.js');
const COUNCIL = await import('../src/sim/council.js');
const HOST = await import('../src/sim/player-host.js');
const {CRYPT, dist} = await import('../src/world/map.js');
const {slotHeroes, slotParty} = await import('../src/sim/company.js');
// A fresh Fellowship (live agents: runner links on) with a sellsword hired, everyone beside it in town.
function fw(links = true) {
  init(); run(20); T.TABLE.speed = 1; T.TABLE.mode = 'auto'; S.mobs.length = 0;
  if (links) SIM.setRunnerLinks(() => 'connected');
  const F = slotted(), M = slotHeroes(F), L = M[0], hd = homeOf(L);
  const sw = place('sellsword', hd.name);
  for (const a of M) {a.lvl = 9; a.hp = maxHp(a); a.x = sw.x + 1; a.y = sw.y; a.state = 'town'; a.hidden = false; a.target = null; a.dest = null; a.pq = []}
  rebuild(); L.gold = 400;
  const r = act(L, 'hire', {npc: sw.name, days: 4});
  return {F, M, L, sw, r, H: S.agents.find(x => x.hire && !x.hire.over)};
}
const answerAll = (sc, pick) => {for (const id of sc.ids) {const a = S.agents.find(x => x.id === id); if (a && a.state !== 'dead' && !sc.acts[id] && a.player) T.sceneAct(a, pick(sc, a), 'test')}};
const pickFor = (sc, a) => {const rf = T.reflexFor(sc, a); return (rf && (rf.opt || rf.k)) || rf || 'strike'};

console.log('Fellowship with a hire, Table scenes:');
{
  const {F, M, L, H, r} = fw(); ok(r.ok && H && !inSlots(H) && slotKeyOf(H) === undefined, 'a hire rides with the Fellowship and holds no place: ' + (r.error || ''));
  for (const a of M.concat([H])) {a.x = L.x; a.y = L.y; a.state = 'hunt'}
  const sc = T.openScene('check', 'A narrow ford', ['The water runs high.'], {anchor: L.id});
  ok(sc && !sc.ids.includes(H.id), 'an everyone-at-once scene does not seat the hire (' + (sc && sc.ids.length) + ' seated)');
  ok(T.tableView(H) === null, 'the hire has no scene view');
  const v = T.tableView(L); ok(v && !(v.waiting_on || []).includes(H.name) && /\/5$/.test(String(v.answered || '0/5')), 'answered counts the five and waiting_on never names the hire: ' + (v && v.answered) + ' ' + J(v && v.waiting_on));
  let g = 0; while (S.table === sc && g++ < 60 * 200) {if (sc.phase === 'turn' || sc.phase === 'frame') answerAll(sc, pickFor); step(1 / 60)}
  ok(S.table !== sc, 'the scene resolves with the five answering (the hire never waited on)');
  ok(!(sc.beats || []).some(b => b.by === H.id || b.id === H.id), 'no beat is the hire');
}
console.log('Fellowship with a hire, a Crypt crawl:');
{
  const {F, M, H} = fw();
  for (const a of M.concat([H])) {a.hp = maxHp(a); a.state = 'hunt'; a.hidden = false; a.target = null; a.dest = null; a.x = CRYPT.x + (Math.random() - .5); a.y = CRYPT.y + 1}
  for (const a of M) a.cryptOk = true;
  D.musterCrypt(M.concat([H]), F.fac, null, F.name);
  let went = false, hireSeated = false, scenes = 0, last = null, threw = null;
  try {
    for (let f = 0; f < 1500 * 60 && (CRYPT.group || !went); f++) {
      step(1 / 60); if (CRYPT.group) went = true;
      const sc = S.table;
      if (sc && sc.id !== last) {last = sc.id; scenes++}
      if (sc && sc.ids.includes(H.id)) hireSeated = true;
      if (sc && (sc.phase === 'frame' || sc.phase === 'turn')) answerAll(sc, pickFor);
    }
  } catch (e) {threw = e}
  ok(!threw, 'the crawl runs without a throw' + (threw ? ': ' + threw.stack.split('\n').slice(0, 3).join(' | ') : ''));
  ok(went && !CRYPT.group && !S.table, 'the group and the table are free at the end');
  const cr = F.crawl || {};
  ok(cr.runs >= 1 && [cr.runs, cr.clears, cr.deaths, cr.rooms].every(Number.isFinite) && cr.deaths <= 6, 'the record is sane: ' + J({runs: cr.runs, clears: cr.clears, driven: cr.driven, wipes: cr.wipes, deaths: cr.deaths, rooms: cr.rooms}));
  ok(!hireSeated && scenes >= 1, 'room scenes opened (' + scenes + ') and none seated the hire');
  ok(H.state !== 'dungeon' && (H.state === 'dead' || !H.hidden), 'the hire is out of the Crypt, alive or fallen: ' + H.state);
}
console.log('Fellowship with a hire, the draft and lead_to:');
{
  const {F, M, L, H} = fw();
  const door = {x: CRYPT.x, y: CRYPT.y + 3};
  for (const a of M) {a.x = door.x + (M.indexOf(a) % 3) * .4; a.y = door.y; a.state = 'hunt'; a.hp = maxHp(a); a.hidden = false}
  H.x = door.x + 35; H.y = door.y; H.state = 'fight'; rebuild();
  F.wait = {crypt: S.gameMin + 600};
  let g = 0; while (!CRYPT.group && g++ < 60 * 60) step(1 / 60);
  ok(CRYPT.group && M.every(a => CRYPT.group.mem.includes(a)), 'the call goes with the five, the far and busy hire does not hold it');
  g = 0; while (CRYPT.group && CRYPT.group.phase === 'gather' && g++ < 60 * 120) step(1 / 60);
  ok(CRYPT.group && CRYPT.group.phase === 'inside' && M.every(a => CRYPT.group.mem.includes(a)), 'the five go in; the hire is ' + (CRYPT.group && CRYPT.group.mem.includes(H) ? 'with them' : 'left out'));
}
{
  const {F, M, L, H} = fw(false);
  for (const a of M.concat([H])) {a.x = L.x; a.y = L.y; a.state = 'hunt'; a.hidden = false}
  run(5);
  const P_ = slotParty(F); ok(P_ && P_.mem.includes(H), 'the hire is in the Fellowship party');
  const n = COUNCIL.followLead(P_.leader, 'the ford'); ok(n >= 3 && P_.dest && P_.dest.label === 'the ford', 'lead_to moves the party (' + n + ' heard it)');
  H.x = P_.leader.x + 3; run(5); ok(dist(H, P_.leader) < 20 && H.state !== 'dead', 'the hire rides along');
}
console.log('Fellowship with a hire, fireside, arrival, the start gate:');
{
  const {F, M, L, H} = fw();
  for (const a of M.concat([H])) {a.x = L.x; a.y = L.y; a.state = 'town'}
  F.fireQ = {mode: 'debrief', at: Math.round(S.gameMin), title: 'a hard fight', anchor: L.id};
  let g = 0; while (!S.table && g++ < 60 * 10) step(1 / 60);
  ok(!S.table || !S.table.ids.includes(H.id), 'fireside and debrief never seat the hire' + (S.table ? ' (' + S.table.kind + ', ' + S.table.ids.length + ' seated)' : ' (no scene opened)'));
  S.table = null; S.tables = [];
  const dead = M[2]; fall(dead, 'a test'); let seenSc = null; g = 0;
  while (g++ < 60 * 200) {step(1 / 60); const sc = S.table; if (sc && sc.kind === 'arrival') {seenSc = sc; break}}
  ok(!seenSc || !seenSc.ids.includes(H.id), 'an arrival scene does not seat the hire' + (seenSc ? '' : ' (none opened in this fixture)'));
  const seats = S.agents.filter(a => a.player && a.state !== 'dead').map(a => HOST.seatInfo(a).id);
  ok(!seats.includes(H.id) && !H.player, 'seatInfo and the start gate list no seat for the hire');
}

console.log('a placed person away on hire keeps its DM clock paused:');
{
  init({fellowship: false}); run(5);
  const B = live().find(a => a.fac === 0); P.markPlayer(B, true);
  const sw = place('sellsword', homeOf(B).name); B.gold = 100; beside(B, sw);
  const rec = S.levers.active.find(x => x.id === sw.lever), left0 = rec.until - S.gameMin;
  const r1 = act(B, 'hire', {npc: sw.name, days: 1}); ok(r1.ok, 'hired a placed person');
  run(120);
  ok(Math.abs((rec.until - S.gameMin) - left0) < 2, 'the placement clock did not run while away: ' + Math.round(rec.until - S.gameMin) + ' of ' + Math.round(left0) + ' left');
  const h1 = S.agents.find(x => x.hire); h1.hire.until = S.gameMin + 1; run(2); hurry(h1);
  ok(h1.hire.done && (S.wanderers || []).includes(sw), 'back, and the person is still placed');
  const before = rec.until - S.gameMin; run(30);
  ok(rec.until - S.gameMin < before - 100, 'and the clock runs again after the return');
}

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
