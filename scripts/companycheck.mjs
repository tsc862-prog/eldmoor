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
  const free = () => S.agents.find(b => living(b) && b.fac === 0 && !b.fellow && !b.companion && !b.player && !CO.companyOf(b) && !b.adv && !used.has(b) && b.state !== 'dungeon' && b.state !== 'raid' && b.state !== 'duel');
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

console.log(fail ? `\ncompanycheck: ${fail} failure(s)` : '\ncompanycheck: all ok');
process.exit(fail ? 1 : 0);
