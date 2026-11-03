// Rest and camp check (issue #64): the Fellowship makes camp at night, rests, posts watches, talks,
// breaks camp; a camp ambush opens a Table scene at 1x; a save taken mid-camp restores; two seeded
// runs match; background heroes never camp. Usage: npm run campcheck
let seed = 0x5eed64;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const P_ = await import('../src/sim/player.js');
const {init, step, S, found, autoPick, snapshot, restore, TABLE, fellowshipMembers} = SIM;
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

TABLE.speed = 1;
init({fellowship: false}); run(1200); // the old start (#111): this check founds its own Fellowship
ok(SLT.foundSlots(SLT.autoPick(0), {ai: false}).ok, 'Fellowship founded');
let camps = 0, prev = null, sawRest = false, mid = null, maxCamped = 0, bg = 0, dmCamp = 0; // DM log camp lines seen while it ran (the log is capped: an early one may scroll out by the end)
for (let i = 0; i < 8 * 240 * 60; i++) {
  step(1 / 60);
  const g = SLT.slotted().camp, ph = g && g.phase;
  if (ph === 'gather' && prev !== 'gather') camps++;
  if (ph === 'rest') {sawRest = true; if (!mid && g.stats.watches >= 1) mid = snapshot()}
  prev = ph; if (S.dmLog && S.dmLog[0] && S.dmLog[0].kind === 'camp') dmCamp = 1;
  const L = SLT.slotMembers(SLT.slotted()).map(m => m.hero), n = S.agents.filter(a => a.state === 'camp').length;
  maxCamped = Math.max(maxCamped, n);
  if (S.agents.some(a => a.state === 'camp' && !L.includes(a))) bg++;
}
const st = SLT.slotted().camp.stats;
ok(camps >= 3 && sawRest, `the Fellowship made camp ${camps} times in 8 days (${JSON.stringify(st)})`);
ok(maxCamped <= 5 && bg === 0, 'only Fellowship members ever camp (max ' + maxCamped + ')');
ok(st.watches >= 3 && st.talks >= 5, 'watches posted and campfire talk happened');
ok(SLT.slotted().log.some(e => e.kind === 'camp') && (dmCamp || (S.dmLog || []).some(e => e.kind === 'camp')), 'camp events in the campaign log and the DM log');
ok(SLT.slotted().tableStats && SLT.slotted().tableStats.scenes >= (st.spotted + st.caught - 1), 'camp ambushes opened Table scenes (' + (SLT.slotted().tableStats ? SLT.slotted().tableStats.scenes : 0) + ')');
ok(!S.agents.some(a => a.state === 'camp') || (SLT.slotted().camp.phase && true), 'no hero is left stuck in camp');
ok(mid && mid.companies.find(c => c.slots).camp.phase === 'rest', 'a snapshot was taken mid-camp'); // saves carry companies (#438)
restore(JSON.parse(JSON.stringify(mid)));
const g2 = SLT.slotted().camp, L2 = SLT.slotMembers(SLT.slotted()).map(m => m.hero);
ok(g2.phase === 'rest' && L2.filter(a => a.state === 'camp').length === g2.ids.length, 'restored camp keeps its sleepers');
run(40 * 60 / 60 * 2);
ok(S.agents.every(a => a.state !== 'camp' || (SLT.slotted().camp.ids || []).includes(a.id)), 'after restore every sleeper belongs to the camp');

// ---- #178: status text, break_camp vote, leader break, rest {hours}, wake events ----
const CAMPM = await import('../src/sim/camp.js'), CO = await import('../src/sim/council.js');
const {zoneFor, zonePoint} = await import('../src/world/map.js'), {homeOf} = await import('../src/data/races.js');
const members = () => SLT.slotMembers(SLT.slotted()).map(m => m.hero).filter(a => a && a.state !== 'dead');
const gather = () => {
  let n = 0; while (SLT.slotted().camp && SLT.slotted().camp.phase && n++ < 40) run(30);
  for (let n = 0; n < 60 && members().some(a => a.hidden || a.adv || a.raid); n++) run(10); // wait out a crypt run or a raid in progress (the check assumes the company is out on the road)
  S.table = null; const L = members(), lead = CO.leaderOfF();
  {const g = homeOf(lead).gate, p = zonePoint(zoneFor(3, g), null, g); lead.x = p.x; lead.y = p.y} // out in quiet home fields: camp ground is never in or by a town, the lair or the Crypt
  for (const a of L) {a.x = lead.x; a.y = lead.y; a.state = 'hunt'; a.adv = null; a.dest = null; a.hp = Math.round(a.maxhp || a.hp); a.splitUntil = 0; a.player = true; a.playEv = []}
  return {L, lead};
};
let {L: M, lead: LD} = gather();
ok(M.length >= 3, 'members to camp (' + M.length + ')');
ok(typeof CAMPM.leaderRest(M.find(a => a !== LD), 2) === 'string', 'rest {hours} by a non-leader is refused');
const err = CAMPM.leaderRest(LD, 3);
ok(err === null, 'leader rest {hours} makes camp: ' + err);
for (let i = 0; i < 40 && SLT.slotted().camp.phase !== 'rest'; i++) run(10);
const g3 = SLT.slotted().camp;
ok(g3 && g3.phase === 'rest' && g3.why === 'rest' && g3.hours === 3, 'a set-time camp is resting');
const sleepers = M.filter(a => CAMPM.asleep(a)), watcher = M.find(a => a.id === g3.watcher);
ok(watcher && sleepers.length === M.length - 1, 'one on watch, the rest asleep');
ok(/^Asleep by the fire · resting until \d\d:\d\d · \d+ h( \d+ m)? left/.test(sleepers[0].playDoing || ''), 'sleeper doing: ' + sleepers[0].playDoing);
ok(/^On watch \(until \d\d:\d\d\)/.test(watcher.playDoing || ''), 'watcher doing: ' + watcher.playDoing);
const cv = P_.playerAct(sleepers[0].id, 'status', {});
ok(cv.camp && cv.camp.asleep && cv.camp.on_watch && cv.camp.asleep_names.length === M.length - 1, 'agent status carries the camp: ' + JSON.stringify(cv.camp && cv.camp.status));
ok(/Camp: resting until .* on watch: .* asleep: /.test(CAMPM.campSummary() || ''), 'Fellowship panel line: ' + CAMPM.campSummary());
{ // a camp with no watch times (staged / hand-made) never prints NaN (#475)
  const keep = {restAt: g3.restAt, watchIdx: g3.watchIdx}; delete g3.restAt; delete g3.watchIdx;
  const sm = CAMPM.campSummary() || '', vw = CAMPM.campView(sleepers[0]);
  ok(/on watch: \S+ .{1,3} asleep/.test(sm) && !/NaN|until \d\d:\d\d\)/.test(sm), 'no watch times: summary omits the watch end: ' + sm);
  ok(vw && vw.on_watch === watcher.name && !/NaN/.test(JSON.stringify(vw)), 'no watch times: campView has no NaN: ' + (vw && vw.on_watch));
  g3.restAt = keep.restAt; g3.watchIdx = keep.watchIdx;
}
const PA = await import('../src/sim/pace.js');
sleepers[0].playEv.push({n: 900, t: '00:00', text: 'a party line', e: 0, w: 1}); // soft
ok(PA.paceCheck(sleepers[0].id, {since: S.gameMin - 9999, minutes: 5}) === null, 'a sleeper gets no soft or heartbeat turn');
ok(PA.paceCheck(watcher.id, {since: S.gameMin - 9999, minutes: 5}) !== null, 'the watcher still gets its heartbeat');
// the vote
const asker = sleepers[0];
ok(typeof CO.propose(asker, 'break_camp', 'We are rested.', {vote: 'yes'}) !== 'string', 'break_camp can be proposed');
for (const a of M) if (a !== asker) CO.castVote(a, CO.openProps()[0] ? CO.openProps()[0].id : 0, 'yes', 'on we go', 'agent');
ok(!SLT.slotted().camp.phase && M.every(a => a.state !== 'camp'), 'a passed break_camp vote breaks the camp early');
ok(M.every(a => a.playEv.some(e => /Camp is broken/.test(e.text) && e.w === 2)), 'every member got a turn-starting event when camp broke');
ok(M.every(a => !a.playDoing || !/Asleep|On watch/.test(a.playDoing)), 'camp doing text cleared');
// leader break
({L: M, lead: LD} = gather());
ok(CAMPM.leaderRest(LD, 4) === null, 'second camp');
for (let i = 0; i < 40 && SLT.slotted().camp.phase !== 'rest'; i++) run(10);
ok(typeof CAMPM.leaderBreak(M.find(a => a !== LD)) === 'string', 'only the leader breaks camp outright');
ok(CAMPM.leaderBreak(LD) === null && !SLT.slotted().camp.phase, 'the leader breaks camp');
// ---- #400: orders refused at camp say how to go on; a second break_camp is a yes; vote refusals name the open one ----
{const RL = await import('../src/sim/runlink.js');
({L: M, lead: LD} = gather());
ok(CAMPM.leaderRest(LD, 4) === null, '#400 camp');
for (let i = 0; i < 40 && SLT.slotted().camp.phase !== 'rest'; i++) run(10);
RL.setRunnerLinks(a => 'connected'); // live agents: their votes wait, so the proposal stays open
const others = M.filter(a => a !== LD), [m1, m2] = others, act = (a, t, x) => P_.playerAct(a.id, t, x || {});
let r = act(m1, 'move_to', {target: 'home'});
ok(!r.ok && /camped \(.*leader: .*propose \{kind:'break_camp'\}.*or wait/.test(r.error), 'move_to at camp names the way on: ' + r.error);
r = act(LD, 'move_to', {target: 'home'});
ok(!r.ok && /You lead: break_camp to move on now/.test(r.error), 'the leader is told to break_camp: ' + r.error);
r = act(LD, 'lead_to', {target: 'home'});
ok(!r.ok && /break_camp/.test(r.error), 'lead_to at camp names break_camp: ' + r.error);
r = act(m1, 'rest', {minutes: 60});
ok(r.ok && /You rest at camp/.test(r.camp), 'rest at camp is ok: ' + r.camp);
r = act(m1, 'rest', {hours: 2});
ok(r.ok && /You rest at camp/.test(r.camp), 'rest {hours} at camp is ok too');
r = act(m1, 'vote', {proposal_id: 999, vote: 'yes'});
ok(!r.ok && /No proposal 999\. No proposal is open; put one to the party with propose/.test(r.error), 'vote on a missing proposal says none is open');
r = act(m1, 'break_camp');
const BP = CO.openProps().find(P => P.kind === 'break_camp');
ok(r.ok && BP && BP.votes[m1.id] && BP.votes[m1.id].v === 'yes' && /went to the vote/.test(r.note), 'a non-leader break_camp becomes the proposal: ' + r.note);
r = act(m2, 'propose', {kind: 'break_camp', details: 'On we go'});
ok(r.ok && /counted on the open proposal/.test(r.your_vote) && BP.votes[m2.id] && BP.votes[m2.id].v === 'yes' && CO.openProps().filter(P => P.kind === 'break_camp').length === 1, 'a second break_camp proposal is a yes vote on the open one');
r = act(m2, 'propose', {kind: 'break_camp'});
ok(r.ok && /already said yes/.test(r.your_vote), 'a third call from the same member is still ok');
r = act(m1, 'move_to', {target: 'home'});
ok(!r.ok && r.error.includes('vote(' + BP.id + ', yes)'), 'with one open, move_to points at the vote: ' + r.error);
r = act(m1, 'vote', {proposal_id: 999, vote: 'yes'});
ok(!r.ok && r.error.includes('Open now: #' + BP.id + ' (break_camp'), 'vote on a missing proposal names the open one: ' + r.error);
r = act(m1, 'vote', {proposal_id: BP.id, vote: 'maybe'});
ok(!r.ok && /vote\(\d+, yes\|no/.test(r.error), 'a bad vote word names the call');
ok(act(m1, 'propose', {kind: 'other', details: 'Sing a song'}).ok, 'an other proposal');
r = act(m2, 'propose', {kind: 'other', details: 'Tell a tale'});
ok(!r.ok && /is already open\. Vote on it with vote\(\d+, yes\|no\), or wait for it to settle \(about \d+ game min\)/.test(r.error), 'a duplicate kind names the open proposal: ' + r.error);
for (let i = 0; i < 1200 && S.table && S.table.wk && !S.table.wk.done; i++) step(1 / 60); // the vote's scene is set first; then the members may answer (#682)
for (const a of M) for (const P of CO.openProps()) if (!P.votes[a.id]) {const v = act(a, 'vote', {proposal_id: P.id, vote: P.kind === 'break_camp' ? 'yes' : 'no'}); if (!v.ok) console.log('    vote', a.name, P.id, v.error.slice(0, 120))}
for (let i = 0; i < 60 && (S.table || SLT.slotted().camp.phase); i++) run(1); // the votes are counted at the table (an all-at-once decision scene)
ok(BP.status === 'passed' && !SLT.slotted().camp.phase && M.every(a => a.state !== 'camp'), 'the seconded break_camp passed and broke camp');
r = act(m1, 'vote', {proposal_id: BP.id, vote: 'yes'});
ok(!r.ok && /already passed .*nothing to vote on\. No proposal is open/.test(r.error), 'a vote on a settled proposal says so: ' + r.error);
r = act(m1, 'propose', {kind: 'break_camp'});
ok(!r.ok && /not camped\. Go on with move_to/.test(r.error), 'no camp to break names move_to: ' + r.error);
RL.setRunnerLinks(null);}
// a set-time camp ends by itself
({L: M, lead: LD} = gather());
ok(CAMPM.leaderRest(LD, 1) === null, 'third camp, one hour');
// No visitor this hour: an ambush breaks camp early by design (covered above), and whether the watch's roll comes up
// in this hour depends on how the seeded dice fell earlier in the run, which any sim change upstream shifts (#347).
const ambushP = CAMPM.CAMP.AMBUSH_P; CAMPM.CAMP.AMBUSH_P = -1;
for (let i = 0; i < 40 && SLT.slotted().camp.phase !== 'rest'; i++) run(10);
const t0 = S.gameMin; for (let i = 0; i < 60 && SLT.slotted().camp.phase; i++) run(10);
CAMPM.CAMP.AMBUSH_P = ambushP;
ok(!SLT.slotted().camp.phase && S.gameMin - t0 < 90 && S.gameMin - t0 >= 50, 'a one-hour rest ends on time (' + Math.round(S.gameMin - t0) + ' game min)');
ok(M.every(a => a.playEv.some(e => /Camp is broken/.test(e.text))), 'wake event after a timed rest too');
ok(typeof CO.propose(M[0], 'break_camp', 'x') === 'string', 'break_camp refused with no camp');

// ---- #439 (epic #402): council, reach and camp for a company of any size; solo rules ----
{const CM = await import('../src/sim/company.js'), RL = await import('../src/sim/runlink.js'), {dist} = await import('../src/world/map.js');
  ({L: M, lead: LD} = gather());
  const F = SLT.slotted(), act = (a, t, x) => P_.playerAct(a.id, t, x || {});
  const free = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && a.fac === F.fac && !CM.companyOf(a) && !a.player && !a.hidden && !a.raid);
  const [A, B, Z] = free;
  ok(A && B && Z, 'three free heroes of the faction for a pair and a solo');
  // out of any background party and its adventure first (SIM has no leaveParty: a hero left in a scripted party rode its
  // leader's job, and that job's rolls opened the pair's own Table scene, pausing the world under the solo's camp)
  const {leaveParty} = await import('../src/sim/party.js');
  const field = (L, at) => {for (const a of L) {if (a.party) leaveParty(a); for (const v of S.adventures || []) if (v.phase === 'active' && v.mem && v.mem.includes(a.id)) v.mem = v.mem.filter(id => id !== a.id); a.x = at.x; a.y = at.y; a.state = 'hunt'; a.adv = null; a.dest = null; a.target = null; a.pq = []; a.hp = Math.round(a.maxhp || a.hp); a.splitUntil = 0; a.player = true; a.playEv = []}};
  field([A, B, Z], LD); A.lvl = Math.max(A.lvl, B.lvl + 1); // A leads the pair (highest level, no party)
  const pair = CM.foundCompany([A, B]).company, solo = CM.foundCompany([Z]).company;
  ok(pair && solo && pair.ids.length === 2 && CM.isSolo(solo), 'a company of two and a company of one');
  ok(CO.leaderOfC(pair) === A && CO.leaderFor(Z) === Z, 'the pair\'s leader is its highest level; a solo leads itself');
  // a company of 2 votes; the leader breaks the tie
  RL.setRunnerLinks(a => 'connected'); // live agents: votes wait for them
  let P = CO.propose(A, 'other', 'Cross the river at dawn', {vote: 'yes'});
  ok(P && P.id && P.status === 'open' && CO.voters(P).length === 2 && CO.openProps(pair).includes(P) && !CO.openProps(F).includes(P), 'the pair\'s proposal is theirs alone (#' + P.id + ')');
  ok(S.table && S.table.kind === 'decision' && S.table.company === pair.id && S.table.ids.length === 2, 'the pair\'s vote opens its own Table scene, both at the table (#440)');
  const set = () => {if (S.table) {S.table.phase = 'turn'; delete S.table.wk}}; // the DM has set the scene and its members are woken (#682)
  const settle = async () => {const T = await import('../src/sim/table.js'); if (!S.table) return; const m0 = TABLE.mode; TABLE.mode = 'off'; T.tableHold(0); TABLE.mode = m0}; // the table resolves the vote now (both answered), with no world time passing
  ok(Object.keys(F.props || {}).length === 0 || !(F.props || []).some(Q => Q.id === P.id), 'proposal ids are unique across companies');
  let r = act(M[0], 'vote', {proposal_id: P.id, vote: 'no'});
  ok(!r.ok && /No proposal/.test(r.error), 'a Fellowship member cannot vote on another company\'s proposal: ' + r.error);
  set(); r = act(B, 'vote', {proposal_id: P.id, vote: 'no', reason: 'too cold'}); await settle();
  ok(r.ok && P.status === 'passed' && /1-1, .*breaking the tie/.test(P.result) && P.result.includes(A.name), 'a company of 2 votes and the leader breaks the tie: ' + P.result);
  ok(pair.log.some(e => e.kind === 'council'), 'the vote is in the pair\'s own campaign log');
  P = CO.propose(B, 'other', 'Rest a day', {vote: 'yes'}); set(); act(A, 'vote', {proposal_id: P.id, vote: 'no'}); await settle();
  ok(P.status === 'failed' && /1-1/.test(P.result), 'the leader\'s no breaks a tie the other way: ' + P.result);
  // a solo cannot propose; it decides
  for (const k of ['job', 'crypt', 'split', 'other']) {const x = CO.propose(Z, k, 'x'); ok(x === CO.SOLO, 'a solo\'s ' + k + ' proposal is refused: ' + x)}
  r = act(Z, 'propose', {kind: 'job', details: 'the wolves'});
  ok(!r.ok && /You ride alone: decide and act/.test(r.error), 'the propose tool tells a solo to decide: ' + r.error);
  r = act(Z, 'vote', {proposal_id: 1, vote: 'yes'});
  ok(!r.ok && /You ride alone/.test(r.error), 'a solo has nothing to vote on');
  ok(act(Z, 'send_courier', {to: A.name, text: 'hello'}).ok === false, 'a solo has no companion to send a courier to');
  // reach: the pair's shout is their channel; the Fellowship member beside them does not hear it as party talk
  M[0].x = A.x; M[0].y = A.y; M[0].chat = []; B.chat = [];
  CO.partySay(A, 'Keep close.');
  ok((B.chat || []).some(e => e.party && e.text === 'Keep close.') && (M[0].chat || []).every(e => !e.party || e.heard.indexOf(M[0].name) < 0), 'party_say is the company\'s channel; a stranger in earshot only overhears');
  B.x = A.x + 40; B.y = A.y; ok(CO.shoutHearers(A).far.includes(B), 'out of range: the pair is apart'); B.x = A.x; B.y = A.y;
  // two companies camp at once, in the same place: two fires
  const ambushP2 = CAMPM.CAMP.AMBUSH_P; CAMPM.CAMP.AMBUSH_P = -1;
  const FR = await import('../src/sim/fireside.js'); FR.FIRE.ON = false; // live agents at these camps: no talk round the fire here (#571, tablecheck --fireside)
  ok(CAMPM.leaderRest(LD, 4) === null, 'the Fellowship makes camp');
  ok(CAMPM.leaderRest(B, 2) !== null && CAMPM.leaderRest(A, 2) === null, 'the pair makes its own camp (its leader calls it) beside them');
  for (let i = 0; i < 40 && !(F.camp.phase === 'rest' && pair.camp.phase === 'rest'); i++) run(10);
  ok(F.camp.phase === 'rest' && pair.camp.phase === 'rest' && F.camp !== pair.camp && pair.camp.ids.length === 2 && dist(F.camp, pair.camp) < 3, 'two companies in one place each light their own fire');
  ok(M.every(a => a.state === 'camp') && A.state === 'camp' && B.state === 'camp' && CAMPM.campOf(A) === pair.camp && CAMPM.campOf(M[0]) === F.camp, 'each sleeper belongs to its own camp');
  ok(CAMPM.minCamp(F) === 3 && CAMPM.minCamp(pair) === 2 && CAMPM.minCamp(solo) === 1, 'MIN_CAMP is min(3, the company\'s places)');
  ok(CAMPM.leaderBreak(A) === null && !pair.camp.phase && F.camp.phase === 'rest' && M.every(a => a.state === 'camp'), 'the pair breaks its camp; the Fellowship sleeps on');
  ok(CAMPM.leaderBreak(LD) === null && !F.camp.phase, 'then the Fellowship breaks its own');
  // a one-person camp: slower mending, sleeps every other watch, an ambush in its sleep finds it unroused
  Z.x = LD.x; Z.y = LD.y; Z.state = 'hunt';
  r = act(Z, 'rest', {hours: 3});
  ok(r.ok && solo.camp && solo.camp.phase && solo.camp.solo === 1, 'rest {hours} makes a solo camp: ' + JSON.stringify(r));
  for (let i = 0; i < 40 && solo.camp.phase !== 'rest'; i++) run(10);
  const mh = SIM.maxHp ? SIM.maxHp(Z) : Z.maxhp; Z.hp = Math.round(mh * .2); const h0 = Z.hp; step(1 / 60);
  const got = Z.hp - h0, want = mh * CAMPM.CAMP.CAMP_HEAL * CAMPM.CAMP.SOLO_HEAL / 60;
  ok(Math.abs(got - want) < 1e-6, 'a one-person camp heals at SOLO_HEAL of CAMP_HEAL (' + got.toFixed(3) + ' vs ' + want.toFixed(3) + ' a tick)');
  const g = solo.camp;
  ok(g.watcher === Z.id && !CAMPM.asleep(Z) && /keeps watch alone/.test(solo.log[0] && solo.log[0].parts.map(p => p.name || p).join('') || ''), 'first watch: the solo keeps it itself');
  g.restAt = S.gameMin - CAMPM.CAMP.WATCH_MIN - 1; run(1);
  ok(g.watchIdx % 2 === 1 && CAMPM.asleep(Z) && CAMPM.campView(Z).asleep, 'second watch: the solo sleeps, no one watching');
  r = act(Z, 'move_to', {target: 'home'});
  ok(!r.ok && /camped alone .*break_camp to move on now/.test(r.error), 'a camped solo is told to break_camp: ' + r.error);
  await settle(); // another company's scene the world opened meanwhile (an enemy hero's ambush on the Fellowship) would hold the world through this step
  CAMPM.CAMP.AMBUSH_P = 2; g.nextRoll = S.gameMin; const c0 = g.stats.caught; Z.hp = mh; step(1 / 60);
  ok(g.stats.caught === c0 + 1 && !g.phase, 'an ambush on the sleeping solo finds it unroused (the same Perception roll, no dice added)');
  ok(S.table && S.table.kind === 'ambush' && S.table.company === solo.id && S.table.ids.join() === String(Z.id), 'the ambush at the solo\'s camp is its own Table scene (#440)');
  await settle();
  CAMPM.CAMP.AMBUSH_P = ambushP2; for (const m of S.mobs) if (m.target === Z) m.target = null; Z.state = 'hunt'; Z.target = null;
  // break_camp works for a solo leader
  Z.hp = mh; ok(act(Z, 'rest', {hours: 2}).ok, 'a second solo camp');
  CAMPM.CAMP.AMBUSH_P = -1; for (let i = 0; i < 40 && solo.camp.phase !== 'rest'; i++) run(10); CAMPM.CAMP.AMBUSH_P = ambushP2;
  r = act(Z, 'break_camp');
  ok(r.ok && r.broke_camp && !solo.camp.phase && Z.state !== 'camp', 'break_camp works for a solo leader: ' + JSON.stringify(r));
  RL.setRunnerLinks(null);
  for (const a of [A, B, Z]) {CM.leaveCompany(a); a.player = false}
  ok(!CM.companyById(pair.id) && !CM.companyById(solo.id), 'test companies dissolved');}
for (const a of M) a.player = false;
console.log(fail ? fail + ' check(s) FAILED' : 'campcheck passed');
process.exit(fail ? 1 : 0);
