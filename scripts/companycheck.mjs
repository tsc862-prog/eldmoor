// Company check (epic #402): the grouping verbs of issue #442 on a seeded world with no Fellowship at the start.
// invite out of range is refused; in range it is said aloud (earshot hears it, a far hero does not) and the agent
// invitee gets a must-answer event; decline (a tool) closes it; an unanswered offer lapses and nobody is forced;
// accept forms a company of two from two solos (one `join` line, the joiner's solo log folded in); a scripted invitee
// answers by its traits with no sim RNG and rides as a companion (never leads, follows by reflex); join_party toward an
// agent hero asks its company's leader; refusals for a leader of a company of 2+, the cap of 8, the 5-mind cap and the
// Fellowship; a company with no agent left lets its companions go; offers and companions survive a save.
// Usage: npm run companycheck
let seed = 0x5eed442;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, markPlayer, playerAct, found, autoPick} = SIM;
const CO = await import('../src/sim/company.js'), OF = await import('../src/sim/offers.js'), CN = await import('../src/sim/council.js');
const {paceCheck, paceBrief} = await import('../src/sim/pace.js');
const {companyNote} = await import('./pacing.mjs');
const {homeOf} = await import('../src/data/races.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {leaveParty} = await import('../src/sim/party.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => {a.playRate = []; return playerAct(a.id, tool, args || {})};
const living = a => a && a.state !== 'dead';

init({fellowship: false}); run(120);
// heroes of one faction, placed in a quiet field outside town so the town routine does not move them between calls
const g = homeOf(S.agents.find(a => a.fac === 0)).gate, spot = {x: g.x + 3, y: g.y + 6};
const pool = () => S.agents.filter(a => living(a) && !a.companion && a.fac === 0 && !a.player && !a.adv && !a.fellow && a.state !== 'dungeon' && a.state !== 'raid');
const place = (a, dx, dy) => {a.x = spot.x + dx; a.y = spot.y + dy; a.state = 'hunt'; a.dest = null; a.target = null; a.hidden = false; rebuild()};
const used = new Set(), take = () => {const a = pool().find(b => !used.has(b)); used.add(a); if (a.party) leaveParty(a); return a};
const A = take(); markPlayer(A, true); place(A, 0, 0);
const B = take(); markPlayer(B, true); place(B, 20, 0);
const near = take(); place(near, 1, 2); const far = take(); place(far, 0, 20);
ok(CO.companyOf(A) && CO.isSolo(CO.companyOf(A)) && CO.isSolo(CO.companyOf(B)), 'two agent heroes, each a solo company');

// ---- invite out of range, then in range: said aloud, heard in earshot only, a must-answer event ----
let r = act(A, 'invite', {hero_id: B.id});
ok(!r.ok && /too far/.test(r.error), 'invite out of range is refused: ' + r.error);
place(B, 2, 0);
const nearChat = (near.chat || []).length, farChat = (far.chat || []).length;
r = act(A, 'invite', {name: B.name, text: 'Ride with me to the river, friend.'});
ok(r.ok && r.offer && r.heard_by >= 1, 'invite in range is made and said aloud (heard by ' + r.heard_by + ')');
ok((near.chat || []).length > nearChat && near.chat[near.chat.length - 1].text.includes('river'), 'a hero in earshot hears the invite');
ok((far.chat || []).length === farChat, 'a hero far away does not hear it');
const w = paceCheck(B.id, {wake: 'now'});
ok(w && w.wake === 'now' && /asks you to ride/.test(w.why), 'the agent invitee gets an urgent event: ' + (w && w.why));
const br = paceBrief(B.id).brief;
ok(br.offers && br.offers.length === 1 && br.offers[0].from === A.name, 'the state header lists the offer');
ok(/Offers to ride together/.test(companyNote(br)), 'the runner prompt names the offer');
ok(!act(A, 'invite', {hero_id: B.id}).ok, 'a second invite while one is open is refused');
const back = act(B, 'invite', {hero_id: A.id});
ok(!back.ok && /already asked you/.test(back.error), 'inviting back points at accept: ' + back.error);

// ---- decline is a tool; an unanswered offer lapses and nobody is forced ----
r = act(B, 'decline', {offer_id: br.offers[0].id, text: 'Not today, I have my own road.'});
ok(r.ok && OF.offersTo(B).length === 0, 'decline closes the offer');
ok(A.playEv.some(e => /declines your offer/.test(e.text) && /own road/.test(e.text)), 'the inviter hears the declining line');
ok(CO.isSolo(CO.companyOf(A)) && CO.isSolo(CO.companyOf(B)), 'nobody joined');
r = act(A, 'invite', {hero_id: B.id}); ok(r.ok, 'a fresh invite');
const t0 = S.gameMin; while (S.gameMin < t0 + 65) {step(1 / 60); place(A, 0, 0); place(B, 2, 0)}
ok(OF.offersTo(B).length === 0 && CO.isSolo(CO.companyOf(B)), 'an unanswered offer lapses after an hour; the invitee is not forced');
ok(A.playEv.some(e => /did not answer/.test(e.text)), 'the inviter learns the offer lapsed');
r = act(B, 'accept', {offer_id: r.offer});
ok(!r.ok, 'a lapsed offer cannot be accepted: ' + r.error);

// ---- accept: two solos become one company; one join line; the joiner's solo log folds in ----
CO.campaign(CO.companyOf(B), 'note', B.name + ' rode alone for a while.');
const oldB = CO.companyOf(B), cid = CO.companyOf(A).id;
r = act(A, 'invite', {hero_id: B.id});
place(B, 30, 0); const tooFar = act(B, 'accept', {offer_id: r.offer}); place(B, 2, 0);
ok(!tooFar.ok && /walked on/.test(tooFar.error), 'accept needs the inviter near: ' + tooFar.error);
r = act(B, 'accept', {offer_id: r.offer});
const C = CO.companyOf(A);
ok(r.ok && C.id === cid && CO.companyOf(B) === C && C.ids.length === 2, 'accept: ' + B.name + ' joins ' + C.name + ' (the inviter\'s company keeps its id)');
ok(!S.companies.includes(oldB), 'the joiner\'s solo company is gone');
ok(C.log.filter(e => e.kind === 'join').length === 1, 'one join line in the company log');
ok(C.log.some(e => e.folded === oldB.id && /rode alone/.test(e.parts.join(''))), 'the joiner\'s solo log is folded in');
ok(A.playEv.some(e => /accepts/.test(e.text)), 'the inviter is told');
run(2);
const P = S.parties.find(p => p.company === C.id);
ok(P && P.mem.includes(A) && P.mem.includes(B), 'the company walks as one party');

// ---- scripted invitees: traits decide, a hash of the ids; no sim RNG ----
const cands = pool().filter(b => !used.has(b)); for (const b of cands) {if (b.party) leaveParty(b)} // level and traits set below; the hash of the ids decides
const yes = cands.find(b => {const t = b.traits, l = b.lvl; b.traits = ['Loyal']; b.lvl = A.lvl; const j = OF.scriptedAnswer(A, b, C).join; if (!j) {b.traits = t; b.lvl = l} return j});
const lone = cands.find(b => b !== yes); used.add(yes); used.add(lone);
ok(yes && lone, 'scripted candidates found');
lone.traits = ['Loner']; place(lone, -2, 0); place(yes, 0, 2);
const before = seed;
r = act(A, 'invite', {hero_id: lone.id});
ok(r.ok && r.joined === false && /loner/.test(r.why) && r.answer, 'a loner declines with a line: ' + r.answer);
const ans1 = OF.scriptedAnswer(A, yes, C), ans2 = OF.scriptedAnswer(A, yes, C);
r = act(A, 'invite', {hero_id: yes.id});
ok(seed === before, 'scripted answers draw no sim RNG');
ok(ans1.join === ans2.join && r.ok && r.joined === true, 'a sociable hero near your level joins: ' + r.answer);
ok(yes.companion === C.id && CO.companyOf(yes) === C && !yes.player, 'the scripted hero rides as a companion (reflex-played, not an agent)');
yes.lvl = A.lvl + 3; run(3); place(yes, 0, 2); run(1);
ok(CN.leaderOfC(C) !== yes && S.parties.find(p => p.company === C.id).leader !== yes, 'a companion never leads, even at a higher level');
const cb = paceBrief(A.id).brief.company;
ok(cb && cb.size === 3 && cb.with_you.some(n => /companion/.test(n)), 'the company card lists the companion');

// ---- join_party toward an agent hero asks its company's leader ----
const D = take(); markPlayer(D, true); place(D, 1, -1);
r = act(D, 'join_party', {hero_id: B.id});
ok(r.ok && r.offer && r.asked === CN.leaderOfC(C).name, 'join_party toward an agent member asks the leader (' + r.asked + ')');
const lead = CN.leaderOfC(C);
ok(OF.offersTo(lead).some(o => o.kind === 'ask' && o.from === D.id), 'the leader holds the ask');
r = act(lead, 'accept', {offer_id: r.offer});
ok(r.ok && CO.companyOf(D) === C && C.ids.length === 4, 'the leader lets them in');

// ---- companions (#443): the company as the hero knows it, then leave_party for good ----
{
  const far3 = take(); markPlayer(far3, true); place(far3, 0, 40); CO.joinCompany(C, far3); far3.partyOk = true;
  place(A, 0, 0); place(far3, 0, 5); run(1); place(far3, 0, 40); run(1);
  const cv = act(A, 'companions');
  ok(cv.ok && cv.riders.length === C.ids.length - 1 && cv.riders.every(x => x.at), 'companions lists every rider with an at-line');
  const fr3 = cv.riders.find(x => x.name === far3.name);
  ok(fr3 && /^last seen near /.test(fr3.at), 'a far companion is last seen near a place: ' + (fr3 && fr3.at));
  ok(cv.riders.some(x => x.at === 'beside you'), 'a near companion is beside you');
  const dump = JSON.stringify(cv);
  ok(!/"x":|"y":|hp|mind|player|\d+\.\d+,\s*\d+\.\d+/.test(dump.replace(/earshot.*/, '')) && !dump.includes(far3.x.toFixed(1)), 'no coordinates, HP or minds in companions');
  ok(cv.earshot && cv.earshot.ok, 'earshot is folded in');
  const sizeBefore = C.ids.length, fb = (far3.bonds && far3.bonds[A.id]) || 0, ab = (A.bonds && A.bonds[far3.id]) || 0;
  const chatBefore = C.log.length;
  place(far3, 2, 2); far3.state = 'hunt';
  r = act(far3, 'leave_party', {for_good: true});
  const sc2 = CO.companyOf(far3);
  ok(r.ok && sc2 && sc2 !== C && CO.isSolo(sc2) && C.ids.length === sizeBefore - 1 && !C.ids.includes(far3.id), 'leave for good makes a new solo and the old company never empties');
  ok(C.log.some(e => e.kind === 'leave' && e.parts.some(p => p === far3 || p.name === far3.name) && C.log.length > chatBefore - 1), 'the old company log gets a leave line');
  ok(((A.bonds && A.bonds[far3.id]) || 0) === Math.max(-10, ab - CN.COUNCIL.BOND_COST) && ((far3.bonds && far3.bonds[A.id]) || 0) === Math.max(-10, fb - CN.COUNCIL.BOND_COST), 'bonds cost COUNCIL.BOND_COST both ways');
  ok(!far3.party || far3.party.company !== C.id, 'the leaver is out of the company party');
  const solo = act(far3, 'companions');
  ok(solo.ok && solo.alone, 'a solo is told it rides alone');
  const again = act(far3, 'leave_party', {for_good: true});
  ok(!again.ok && /ride alone already/.test(again.error), 'and is a solo now: ' + again.error);
  ok((await import('../src/sim/reach.js')).AWAY.KINDS.includes('leave'), 'AWAY.KINDS knows leave');
  // a member apart records a leave for when it rejoins (reach.js witness)
  const wv = CO.members(C).find(b => b.player && b !== A);
  wv.apartSince = Math.round(S.gameMin); wv.missed = [];
  (await import('../src/sim/reach.js')).witness('leave', 'Zed left the company for good.', C);
  ok(wv.missed.some(m => m.k === 'leave'), 'a member apart records the leave for when it rejoins'); delete wv.apartSince; delete wv.missed;
  for (const b of CO.members(C)) {b.state = 'hunt'; b.target = null; b.dest = null}
  markPlayer(far3, false); CO.dissolveCompany(CO.companyOf(far3)); used.delete(far3); far3.state = 'hunt'; far3.target = null; far3.dest = null; place(far3, 15, 15);
}

// ---- refusals: a leader of a company of 2+, a member of one, the Fellowship ----
const E = take(); markPlayer(E, true); place(E, 3, 3);
r = act(E, 'invite', {hero_id: lead.id});
ok(!r.ok && /leads/.test(r.error), 'inviting the leader of a company of 2+ is refused: ' + r.error);
const nonLead = CO.members(C).find(b => b.player && b !== lead);
r = act(E, 'invite', {hero_id: nonLead.id});
ok(!r.ok && /rides with/.test(r.error), 'inviting a member of a company of 2+ is refused: ' + r.error);
r = act(E, 'join_party', {hero_id: yes.id});
ok(r.ok && r.asked === lead.name, 'join_party toward a companion asks its company\'s leader');
act(lead, 'decline', {offer_id: r.offer});

// ---- caps: 5 minds, 8 heroes ----
const M2 = [], M3 = [];
for (let i = 0; i < 2; i++) {const x = take(); markPlayer(x, true); place(x, -1, -1 - i); M2.push(x)}
for (const x of M2) {CO.joinCompany(C, x); x.partyOk = true}
ok(CO.minds(C).length === 5, 'the company has 5 minds');
r = act(lead, 'invite', {hero_id: E.id});
ok(!r.ok && /5 who choose their own road/.test(r.error), 'a sixth mind is refused: ' + r.error);
while (C.ids.length < CO.PARTY.MAX) {const x = take(); x.companion = C.id; CO.joinCompany(C, x); M3.push(x)}
const last = take(); place(last, 0, 1);
r = act(lead, 'invite', {hero_id: last.id});
ok(!r.ok && /holds 8/.test(r.error), 'a ninth hero is refused: ' + r.error);
const other = S.agents.find(b => living(b) && b.fac === 1); place(other, 1, 1);
r = act(E, 'invite', {hero_id: other.id});
ok(!r.ok && /one faction/.test(r.error), 'the other faction is refused: ' + r.error);

// ---- a save keeps offers and companions ----
r = act(E, 'invite', {hero_id: last.id}); // E is a solo: the scripted answer comes at once either way
const F2 = take(); markPlayer(F2, true); place(F2, 4, 3); const op = act(E, 'invite', {hero_id: F2.id});
ok(op.ok && op.offer, 'an open offer before the save');
const snap = JSON.parse(JSON.stringify(snapshot()));
restore(snap);
const C2 = S.companies.find(c => c.id === C.id), yes2 = S.agents.find(b => b.id === yes.id), F2b = S.agents.find(b => b.id === F2.id);
ok(C2 && C2.ids.length === CO.PARTY.MAX && CO.companyOf(yes2) === C2 && yes2.companion === C2.id, 'after restore the company and its companion stand');
ok(OF.offersTo(F2b).length === 1, 'after restore the offer stands');

// ---- a company with no agent left lets its companions go ----
const G = S.agents.find(b => b.id === E.id), comp = CO.companyOf(G);
if (comp && comp.ids.length > 1) {
  markPlayer(G, false); run(1);
  const gone = comp.ids.length === 0 && S.agents.filter(b => b.companion === comp.id).length === 0;
  ok(gone, 'a company with no agent left lets its companions go');
} else {
  const H = S.agents.find(b => b.id === E.id), sc = pool().find(b => !b.traits.includes('Loner'));
  const CH = CO.companyOf(H); sc.companion = CH.id; CO.joinCompany(CH, sc);
  markPlayer(H, false); run(1);
  ok(sc.companion == null && CO.companyOf(sc) === null, 'a company with no agent left lets its companions go');
}

// ---- expel and merge (#444) ----
{
  const sp2 = {x: spot.x + 30, y: spot.y};
  const put = (a, dx, dy) => {a.x = sp2.x + dx; a.y = sp2.y + dy; a.state = 'hunt'; a.dest = null; a.target = null; a.hidden = false; rebuild()};
  let FACN = 0;
  const free = () => S.agents.find(b => living(b) && b.fac === FACN && !b.fellow && !b.companion && !b.player && !CO.companyOf(b) && !b.adv && !used.has(b) && b.state !== 'dungeon' && b.state !== 'raid' && b.state !== 'duel');
  const grab = () => {const a = free(); used.add(a); if (a.party) leaveParty(a); return a};
  const agent = () => {const a = grab(); markPlayer(a, true); a.partyOk = true; return a};
  const comp = (...L) => {const r = CO.foundCompany(L); if (!r.ok) throw new Error(r.error); return r.company};
  const bump = (a, b, v) => {(a.bonds || (a.bonds = {}))[b.id] = v};
  const prop = (a, args) => act(a, 'propose', args);
  // expel: refused in a company of two; target must be near; the target does not vote
  const [E1, E2, E3] = [agent(), agent(), agent()];
  for (const [i, h] of [E1, E2, E3].entries()) put(h, i, 0);
  const CE = comp(E1, E2);
  r = prop(E1, {kind: 'expel', hero_id: E2.name});
  ok(!r.ok && /leave instead/.test(r.error), 'expel in a company of two is refused: ' + r.error);
  CO.joinCompany(CE, E3);
  put(E3, 0, 40);
  r = prop(E1, {kind: 'expel', hero_id: E3.name});
  ok(!r.ok && /too far/.test(r.error), 'expel of a target out of range is refused: ' + r.error);
  put(E3, 2, 0);
  r = prop(E1, {kind: 'expel', hero_id: E1.name});
  ok(!r.ok && /yourself/.test(r.error), 'expel of yourself is refused: ' + r.error);
  r = prop(E1, {kind: 'expel'});
  ok(!r.ok && /Name the companion/.test(r.error), 'expel with no name is refused: ' + r.error);
  bump(E1, E3, -3); bump(E2, E3, -3); bump(E3, E1, 2); bump(E3, E2, 2);
  r = prop(E1, {kind: 'expel', hero_id: E3.name});
  ok(r.ok && r.proposal, 'expel is proposed: ' + JSON.stringify(r).slice(0, 120));
  const PE = CE.props[0];
  ok(PE.kind === 'expel' && PE.target === E3.id && !CN.voters(PE).includes(E3) && !PE.votes[E3.id], 'the target is not a voter and has no vote');
  ok((E3.events || E3.news || []).length >= 0, 'the target hears of it');
  if (PE.status === 'open') {const m = CN.castVote(E3, PE.id, 'no'); ok(typeof m === 'string' && /do not vote/.test(m), 'the target cannot vote: ' + m); run(2)}
  ok(PE.status === 'passed' && /leaves/.test(PE.result), 'expel passed: ' + PE.result);
  ok(CO.companyOf(E3) !== CE && CO.isSolo(CO.companyOf(E3)) && CE.ids.length === 2, 'the target rides alone, the company keeps two');
  ok((E1.bonds[E3.id] === -6 && E3.bonds[E1.id] === -1) || (E1.bonds[E3.id] < -3 && E3.bonds[E1.id] < 2), 'bonds fall on both sides');
  ok(CE.log.some(e => e.kind === 'expel'), 'the company log has an expel line');

  // merge: refusals
  const mk = (n, extra) => {const L = []; for (let i = 0; i < n; i++) L.push(agent()); return L};
  const [X1, X2] = [E1, E2], [Y1, Y2] = mk(2);
  put(X1, 0, 5); put(X2, 1, 5); put(Y1, 4, 5); put(Y2, 5, 5);
  const CX = CE, CY = comp(Y1, Y2);
  const solo = E3; put(solo, 3, 3);
  r = prop(X1, {kind: 'merge', company: solo.name});
  ok(!r.ok && /rides alone/.test(r.error), 'merge toward a solo is refused: ' + r.error);
  const foe = S.agents.find(b => living(b) && b.fac === 1 && !b.fellow && b.state !== 'dungeon' && b.state !== 'raid'); markPlayer(foe, true); put(foe, 4, 7);
  const foeB = S.agents.find(b => living(b) && b.fac === 1 && b !== foe && !b.fellow && b.state !== 'dungeon' && b.state !== 'raid'); markPlayer(foeB, true); put(foeB, 5, 7);
  const CF = comp(foe, foeB);
  r = prop(X1, {kind: 'merge', company: foe.name});
  ok(!r.ok && /faction/.test(r.error), 'merge across factions is refused: ' + r.error);
  put(Y1, 0, 40);
  r = prop(X1, {kind: 'merge', company: Y1.name});
  ok(!r.ok && /shouting range/.test(r.error), 'merge with leaders out of range is refused: ' + r.error);
  put(Y1, 4, 5);
  // a failing pair: a grudge says no; both fail, nobody moves
  bump(Y1, X1, -4);
  r = prop(X1, {kind: 'merge', company: Y1.name});
  ok(r.ok, 'merge proposed in both companies: ' + JSON.stringify(r).slice(0, 100));
  run(2);
  const PX = CX.props.find(P => P.kind === 'merge'), PY = CY.props.find(P => P.kind === 'merge');
  ok(PX && PY && PX.pair === PY.id && PY.pair === PX.id, 'the two proposals are linked by a pair id');
  ok(PX.status === 'failed' && PY.status === 'failed', 'either failing fails both: ' + PX.status + '/' + PY.status);
  ok(CX.ids.length === 2 && CY.ids.length === 2 && CO.companyOf(X1) === CX, 'no one moved when the merge failed');
  // a passing pair
  bump(Y1, X1, 1);
  r = prop(X1, {kind: 'merge', company: Y1.name});
  ok(r.ok, 'merge proposed again: ' + JSON.stringify(r).slice(0, 100));
  run(2);
  const merged = CO.companyOf(X1);
  ok(merged && CO.companyOf(Y1) === merged && merged.ids.length === 4, 'both passing: one company of four');
  ok(merged.id === Math.min(CX.id, CY.id) && S.companies.every(c => c.id !== Math.max(CX.id, CY.id) || c === merged), 'the older id keeps the company (a tie in size)');
  ok(merged.log.some(e => e.kind === 'merge') && merged.log.some(e => e.folded), 'the log has a merge line and the other log folded in');

  // merge: the caps refuse it (5 minds, 8 heroes) (#500)
  FACN = 1;
  let caps;
  {
    const mA = [agent(), agent(), agent()], mB = [agent(), agent(), agent()];
    [...mA, ...mB].forEach((h, i) => put(h, -20 + (i % 3), 10 + (i < 3 ? 0 : 3)));
    const CMA = comp(...mA), CMB = comp(...mB);
    r = prop(mA[0], {kind: 'merge', company: mB[0].name});
    ok(!r.ok && /choose their own road/.test(r.error), 'merge over the 5-mind cap is refused: ' + r.error);
    ok(CMA.ids.length === 3 && CMB.ids.length === 3 && !(CMA.props || []).length, 'nothing opened, nobody moved');
    const cs = [];
    for (let i = 0; i < 5; i++) cs.push(grab());
    cs.forEach((h, i) => put(h, -20 + i, 4));
    for (const c of cs) {c.companion = CMA.id; CO.joinCompany(CMA, c)}
    ok(CMA.ids.length === 8, 'a company of eight is built: ' + CMA.ids.length);
    r = prop(mA[0], {kind: 'merge', company: mB[0].name});
    ok(!r.ok && /at most 8/.test(r.error), 'merge over the 8-hero cap is refused: ' + r.error);
    caps = {mB, cs, CMB};
  }
  // merge: a companion of the smaller company is re-pointed at the merged company (#500)
  {
    const {mB, cs, CMB} = caps;
    const ws = mB, [z1, z2, zc] = [cs[0], cs[1], cs[2]];
    for (const h of [z1, z2, zc]) {CO.leaveCompany(h); delete h.companion}
    for (const h of [z1, z2]) {markPlayer(h, true); h.partyOk = true}
    [...ws, z1, z2, zc].forEach((h, i) => put(h, 25 + (i % 5), 10 + Math.floor(i / 5) * 3));
    const zs = [z1, z2], CW = CMB, CZ = comp(z1, z2);
    zc.companion = CZ.id; CO.joinCompany(CZ, zc);
    bump(ws[0], zs[0], 1); bump(zs[0], ws[0], 1);
    r = prop(zs[0], {kind: 'merge', company: ws[0].name});
    ok(r.ok, 'companion merge proposed: ' + JSON.stringify(r).slice(0, 100));
    const PZ = CZ.props.find(P => P.kind === 'merge'), PW = CW.props.find(P => P.kind === 'merge');
    ok(PZ && PW && PZ.pair === PW.id, 'a paired proposal sits in each company');
    run(2);
    const M2 = CO.companyOf(zs[0]);
    ok(CO.companyOf(ws[0]) === M2 && M2.ids.length === 6, 'one company of six');
    ok(zc.companion === M2.id && CO.companyOf(zc) === M2, 'the companion is re-pointed at the merged company: ' + zc.companion + ' vs ' + M2.id);
    ok(CN.leaderOfC(M2) !== zc, 'the companion still does not lead');
  }
}
// ---- elites scale to the company that meets them (#502) ----
{
  const T = await import('../src/sim/table.js');
  const f = (n, avg, lvl) => T.eliteFactor(n, avg, lvl);
  ok(f(5, 10, 10).hp === 1 && f(5, 10, 10).hit === 1, 'a full five meets an elite as written');
  ok(f(1, 10, 10).hp < f(2, 10, 10).hp && f(2, 10, 10).hp < f(4, 10, 10).hp && f(4, 10, 10).hp < 1, 'a solo and a pair meet it scaled down, a smaller company more');
  ok(f(2, 8, 13).hp < f(2, 8, 9).hp, 'an elite far over the company level is cut more');
  const heroes = S.agents.filter(h => living(h)).slice(0, 5);
  const mk = () => {const m = S.mobs.find(x => x.alive && !x.gone); m.elite = true; m.maxhp = m.hp = 1000; m.hit = 1; m.lvl = heroes[0].lvl; delete m.scaled; return m};
  let m = mk(); T.scaleElite({id: 99}, heroes.slice(0, 2), {mob: m.id});
  ok(m.scaled && m.maxhp < 1000 && m.hp === m.maxhp && m.hit < 1, 'a pair elite is scaled down: ' + m.maxhp + ' hp, hit ' + m.hit.toFixed(2));
  const pair = m.maxhp; T.scaleElite({id: 99}, heroes.slice(0, 1), {mob: m.id});
  ok(m.maxhp === pair, 'scaled once only');
  m = mk(); T.scaleElite({id: 99}, heroes.slice(0, 1), {mob: m.id});
  ok(m.maxhp < pair, 'a solo meets it lighter than a pair: ' + m.maxhp);
  m = mk(); T.scaleElite({id: 99, slots: true}, heroes.slice(0, 2), {mob: m.id});
  ok(m.maxhp === 1000 && !m.scaled, 'the five-slot company is never scaled');
}
// ---- the Fellowship keeps its roster ----
const fr = found(autoPick(1), {ai: false});
ok(fr.ok, 'a Fellowship founded');
const FM = CO.members(S.fellowship)[0], out = S.agents.find(b => living(b) && b.fac === 1 && !b.fellow && b.state !== 'dungeon');
out.x = FM.x + 1; out.y = FM.y; out.state = 'hunt';
r = act(FM, 'invite', {hero_id: out.id});
ok(!r.ok && /Fellowship/.test(r.error), 'the Fellowship takes no one in by invitation: ' + r.error);
r = act(FM, 'leave_party', {for_good: true});
ok(!r.ok && /Fellowship/.test(r.error), 'a Fellowship member cannot leave for good: ' + r.error);
r = act(FM, 'propose', {kind: 'merge', company: out.name});
ok(!r.ok, 'a Fellowship member cannot propose a merge: ' + r.error);
r = act(FM, 'propose', {kind: 'expel', hero_id: CO.members(S.fellowship)[1].name});
ok(!r.ok, 'a Fellowship member cannot propose an expel: ' + r.error);

// ---- follow (#445): walk at a hero's side without joining; lost them; autopilot keeps a standing follow ----
{
  init({fellowship: false}); run(120); // a fresh world (init resets since #507): the sections above used up the free heroes
  const FW = await import('../src/sim/follow.js'), {dist} = await import('../src/world/map.js'), {W: MW, H: MH} = await import('../src/world/tiles.js');
  const freeOf = a => living(a) && !a.adv && !a.fellow && !a.player && a.companion == null && !CO.companyOf(a) && a.state !== 'dungeon' && a.state !== 'raid';
  const FAC0 = [0, 1].sort((x, y) => S.agents.filter(a => a.fac === y && freeOf(a)).length - S.agents.filter(a => a.fac === x && freeOf(a)).length)[0]; // the earlier sections used up one side's free heroes
  const fg = homeOf(S.agents.find(a => a.fac === FAC0)).gate, at = {x: fg.x + 4, y: fg.y + 4};
  const cl = (v, m) => Math.max(1, Math.min(m - 2, v));
  const put = (a, dx, dy) => {a.x = cl(at.x + dx, MW); a.y = cl(at.y + dy, MH); a.state = 'hunt'; a.dest = null; a.target = null; a.hidden = false; a.pq = []; rebuild()};
  const side = S.agents.filter(a => a.fac === FAC0 && freeOf(a)).sort((x, y) => y.lvl - x.lvl || x.id - y.id);
  const L = side[0], F = side[1], X = side[2];
  const HZ = await import('../src/sim/heroes.js');
  for (const a of [L, F, X]) {if (a.party) leaveParty(a); markPlayer(a, true); HZ.seedLevel(a, 12); a.hp = HZ.maxHp(a)} // sturdy enough for the fields by the gate
  put(L, 0, 0); put(F, 2, 0); put(X, 3, 1);
  // refusals
  put(L, 30, 0); r = act(F, 'follow', {hero_id: L.id}); put(L, 0, 0);
  ok(!r.ok && /not in sight/.test(r.error), 'follow refuses a hero out of sight: ' + r.error);
  const foe = S.agents.find(b => living(b) && b.fac !== FAC0 && b.state !== 'dungeon' && b.state !== 'raid'), fs = {x: foe.x, y: foe.y};
  foe.x = F.x + 1; foe.y = F.y + 1; rebuild(); r = act(F, 'follow', {hero_id: foe.id}); foe.x = fs.x; foe.y = fs.y; rebuild();
  ok(!r.ok && /other side/.test(r.error), 'another faction outside a town is refused: ' + r.error);
  r = act(F, 'follow', {name: F.name}); ok(!r.ok, 'following yourself is refused');
  {
    const comp = S.agents.find(b => living(b) && b.fac === FAC0 && !b.player && !b.fellow && b.companion == null && !CO.companyOf(b) && b.state !== 'dungeon' && b.state !== 'raid' && b !== L && b !== F && b !== X);
    if (comp.party) leaveParty(comp); const CX = CO.companyOf(X); comp.companion = CX.id; CO.joinCompany(CX, comp);
    X.partyOk = true; put(comp, 3, 2); run(1); put(X, 3, 1); put(comp, 3, 2); put(L, 0, 0); put(F, 2, 0);
    const rx = act(X, 'follow', {hero_id: L.id});
    ok(!rx.ok && /lead your company/.test(rx.error || ''), 'a leader of a company of 2+ is refused: ' + (rx.error || 'went through'));
    X.pq = [];
  }
  // follow by name: the followed hero is told, look lists it
  r = act(F, 'follow', {name: L.name.split(' ')[0]});
  ok(r.ok && r.following === L.name && F.pq[0].kind === 'follow', 'follow by name goes through: ' + (r.note || r.error));
  ok(L.playEv.some(e => e.text === F.name + ' falls in behind you.' && !e.w), 'the followed hero gets a soft event');
  const lk = act(L, 'look'); ok((lk.walks_with_you || []).some(t => t.startsWith(F.name)), 'look lists the follower as walking with you');
  ok(/following/.test(act(F, 'look').following || ''), 'the follower\'s look says whom it follows');
  const fb = paceBrief(F.id).brief.follow, lb = paceBrief(L.id).brief.follow;
  ok(fb && /following/.test(fb.following) && lb && lb.followed_by.includes(F.name), 'the state headers carry the follow line both ways');
  const {followNote} = await import('./pacing.mjs');
  ok(/You are following/.test(followNote(paceBrief(F.id).brief)) && /Walking with you/.test(followNote(paceBrief(L.id).brief)), 'the runner prompt names it');
  // a long walk: the follower keeps pace on autopilot (no order for hours), never joins, votes or shouts
  const way = [[18, 8], [4, 16], [20, 2], [0, 10], [14, 14]].map(([dx, dy]) => cl(at.x + dx, MW) + ',' + cl(at.y + dy, MH));
  let wi = 0, cps = 0, lost = 0;
  F.playActAt = S.gameMin - 1000;
  const partyLines = () => S.agents.reduce((n, b) => n + (b.chat || []).filter(e => e.from === F && e.party).length, 0), pl0 = partyLines();
  act(L, 'move_to', {target: way[wi++ % way.length], force: 'yes'});
  for (let i = 0; i < 60 * 60; i++) {
    step(1 / 60); L.playActAt = S.gameMin;
    if (!living(L) || !living(F)) break;
    if (!(L.pq && L.pq.length) && L.state !== 'fight') act(L, 'move_to', {target: way[wi++ % way.length], force: 'yes'});
    if (i % 10 === 0) {cps++; if (!FW.seesHero(F, L)) lost++}
  }
  ok(living(L) && living(F), 'both lived through the walk');
  ok(cps > 300 && lost / cps < .05, 'autopilot keeps pace: out of sight at ' + lost + '/' + cps + ' checkpoints (' + Math.round(lost / cps * 1000) / 10 + '%), legs walked ' + wi);
  ok(F.pq[0] && F.pq[0].kind === 'follow', 'the follow order still stands after an hour of game time');
  ok(!F.party && CO.isSolo(CO.companyOf(F)) && !CO.companyOf(L).ids.includes(F.id), 'the follower joined no party or company');
  ok(partyLines() === pl0 && !CN.openProps(CO.companyOf(L)).length, 'no party shout or vote from the follower');
  // autopilot keeps a standing follow: a reflex took the command away, the hero is in sight
  put(L, 0, 0); put(F, 2, 0); F.playActAt = S.gameMin - 1000; run(1);
  ok(F.pq[0] && F.pq[0].kind === 'follow' && F.pq[0].auto, 'autopilot falls in behind them again (standing order)');
  // a save mid-follow
  restore(JSON.parse(JSON.stringify(snapshot())));
  const L2 = S.agents.find(b => b.id === L.id), F2 = S.agents.find(b => b.id === F.id);
  ok(F2.pq[0] && F2.pq[0].kind === 'follow' && F2.playOrder && F2.playOrder.kind === 'follow', 'a save keeps the follow');
  // lost them: walk to the last seen spot, then stop and say so
  run(1);
  const seenAt = {x: L2.x, y: L2.y}, away = () => {L2.x = cl(seenAt.x + (seenAt.x > MW / 2 ? -40 : 40), MW); L2.y = seenAt.y; L2.pq = []; L2.state = 'hunt'; L2.target = null; L2.playActAt = S.gameMin};
  away(); rebuild();
  const n0 = F2.playEvN; let k = 0;
  while (FW.followCmd(F2) && k++ < 60 * 30) {step(1 / 60); away()}
  const le = F2.playEv.find(e => e.n > n0 && /lost sight of/.test(e.text));
  ok(le && le.w === 2, 'lost them is an urgent event: ' + (le && le.text));
  ok(le && /near [A-Z]/.test(le.text) && !/\d+(\.\d+)?\s*,\s*\d+/.test(le.text), 'it names a place, never coordinates');
  ok(dist(F2, seenAt) < 1.5, 'the follower walked to the last seen spot first (' + Math.round(dist(F2, seenAt) * 10) / 10 + ' tiles off)');
  ok(!F2.pq.length && !F2.playOrder, 'the follow order is over (autopilot will not take it up)');
  ok(L2.playEv.some(e => e.text === F2.name + ' has fallen behind.'), 'the followed hero is told the follower fell behind');
  // hours: the follow ends when they run out; another order ends it at once
  put(L2, 0, 0); put(F2, 2, 0); r = act(F2, 'follow', {hero_id: L2.id, hours: 1}); ok(r.ok && r.hours === 1, 'follow for an hour');
  const t1 = S.gameMin; while (S.gameMin < t1 + 62) {step(1 / 60); L2.playActAt = S.gameMin}
  ok(!FW.followCmd(F2) && F2.playEv.some(e => /hour you gave are up/.test(e.text)), 'the follow ends when the hours run out');
  put(L2, 0, 0); put(F2, 2, 0); act(F2, 'follow', {hero_id: L2.id}); r = act(F2, 'rest', {minutes: 30});
  ok(r.ok && !FW.followCmd(F2) && !(F2.playOrder && F2.playOrder.kind === 'follow'), 'another order ends the follow and its standing order');
  // the Crypt: a hero gone below is out of sight; the follower goes to the stair, then stops
  put(L2, 0, 0); put(F2, 2, 0); act(F2, 'follow', {hero_id: L2.id}); run(1); L2.hidden = true; k = 0;
  while (FW.followCmd(F2) && k++ < 60 * 20) {step(1 / 60); L2.hidden = true; L2.playActAt = S.gameMin}
  ok(!FW.followCmd(F2) && F2.playEv.filter(e => /lost sight of/.test(e.text)).length >= 2, 'a hero gone hidden is lost after the last seen spot');
  L2.hidden = false;
}

// ---- scripted recruiting never takes a company hero (#510) ----
{
  init({fellowship: false}); run(120);
  const {seekParty} = await import('../src/sim/party.js');
  const hs = S.agents.filter(b => living(b) && !b.fellow && !b.companion && !b.player && b.company == null);
console.log('POOL',hs.length,[...new Set(hs.map(b=>b.fac+homeOf(b).name))]);
  const hm = homeOf(hs.find(b => hs.filter(c => homeOf(c) === homeOf(b) && c.fac === b.fac).length >= 3)); const grp = hs.filter(b => homeOf(b) === hm && b.fac === hs.find(c => homeOf(c) === hm).fac);
  const seeker = grp[0], solo = grp[1], other = grp[2];
  for (const b of [seeker, solo, other]) {if (b.party) leaveParty(b); b.state = 'town'; b.lvl = seeker.lvl; b.linger = 0; b.traits = b.traits}
  markPlayer(solo, true);
  ok(CO.companyOf(solo), 'the solo is in a company');
  const before = S.parties.length; let tries = 0;
  for (let i = 0; i < 30 && !seeker.party; i++, tries++) {if (!solo.party) {} seekParty(seeker)}
  ok(!solo.party && !(seeker.party && seeker.party.mem.includes(solo)), 'a company solo near a forming scripted party is never recruited');
  if (seeker.party) leaveParty(seeker);
}

console.log(fail ? `\ncompanycheck: ${fail} failure(s)` : '\ncompanycheck: all ok');
process.exit(fail ? 1 : 0);
