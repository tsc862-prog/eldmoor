// Rest and camp check (issue #64): the Fellowship makes camp at night, rests, posts watches, talks,
// breaks camp; a camp ambush opens a Table scene at 1x; a save taken mid-camp restores; two seeded
// runs match; background heroes never camp. Usage: npm run campcheck
let seed = 0x5eed64;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const P_ = await import('../src/sim/player.js');
const {init, step, S, found, autoPick, snapshot, restore, TABLE, fellowshipMembers} = SIM;
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

TABLE.speed = 1;
init({fellowship: false}); run(1200); // the old start (#111): this check founds its own Fellowship
ok(found(autoPick(0), {ai: false}).ok, 'Fellowship founded');
let camps = 0, prev = null, sawRest = false, mid = null, maxCamped = 0, bg = 0, dmCamp = 0; // DM log camp lines seen while it ran (the log is capped: an early one may scroll out by the end)
for (let i = 0; i < 8 * 240 * 60; i++) {
  step(1 / 60);
  const g = S.fellowship.camp, ph = g && g.phase;
  if (ph === 'gather' && prev !== 'gather') camps++;
  if (ph === 'rest') {sawRest = true; if (!mid && g.stats.watches >= 1) mid = snapshot()}
  prev = ph; if (S.dmLog && S.dmLog[0] && S.dmLog[0].kind === 'camp') dmCamp = 1;
  const L = fellowshipMembers().map(m => m.hero), n = S.agents.filter(a => a.state === 'camp').length;
  maxCamped = Math.max(maxCamped, n);
  if (S.agents.some(a => a.state === 'camp' && !L.includes(a))) bg++;
}
const st = S.fellowship.camp.stats;
ok(camps >= 3 && sawRest, `the Fellowship made camp ${camps} times in 8 days (${JSON.stringify(st)})`);
ok(maxCamped <= 5 && bg === 0, 'only Fellowship members ever camp (max ' + maxCamped + ')');
ok(st.watches >= 3 && st.talks >= 5, 'watches posted and campfire talk happened');
ok(S.fellowship.log.some(e => e.kind === 'camp') && (dmCamp || (S.dmLog || []).some(e => e.kind === 'camp')), 'camp events in the campaign log and the DM log');
ok(S.fellowship.tableStats && S.fellowship.tableStats.scenes >= (st.spotted + st.caught - 1), 'camp ambushes opened Table scenes (' + (S.fellowship.tableStats ? S.fellowship.tableStats.scenes : 0) + ')');
ok(!S.agents.some(a => a.state === 'camp') || (S.fellowship.camp.phase && true), 'no hero is left stuck in camp');
ok(mid && mid.fellowship.camp.phase === 'rest', 'a snapshot was taken mid-camp');
restore(JSON.parse(JSON.stringify(mid)));
const g2 = S.fellowship.camp, L2 = fellowshipMembers().map(m => m.hero);
ok(g2.phase === 'rest' && L2.filter(a => a.state === 'camp').length === g2.ids.length, 'restored camp keeps its sleepers');
run(40 * 60 / 60 * 2);
ok(S.agents.every(a => a.state !== 'camp' || (S.fellowship.camp.ids || []).includes(a.id)), 'after restore every sleeper belongs to the camp');

// ---- #178: status text, break_camp vote, leader break, rest {hours}, wake events ----
const CAMPM = await import('../src/sim/camp.js'), CO = await import('../src/sim/council.js');
const {zoneFor, zonePoint} = await import('../src/world/map.js'), {homeOf} = await import('../src/data/races.js');
const members = () => fellowshipMembers().map(m => m.hero).filter(a => a && a.state !== 'dead');
const gather = () => {
  let n = 0; while (S.fellowship.camp && S.fellowship.camp.phase && n++ < 40) run(30);
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
for (let i = 0; i < 40 && S.fellowship.camp.phase !== 'rest'; i++) run(10);
const g3 = S.fellowship.camp;
ok(g3 && g3.phase === 'rest' && g3.why === 'rest' && g3.hours === 3, 'a set-time camp is resting');
const sleepers = M.filter(a => CAMPM.asleep(a)), watcher = M.find(a => a.id === g3.watcher);
ok(watcher && sleepers.length === M.length - 1, 'one on watch, the rest asleep');
ok(/^Asleep by the fire · resting until \d\d:\d\d · \d+ h( \d+ m)? left/.test(sleepers[0].playDoing || ''), 'sleeper doing: ' + sleepers[0].playDoing);
ok(/^On watch \(until \d\d:\d\d\)/.test(watcher.playDoing || ''), 'watcher doing: ' + watcher.playDoing);
const cv = P_.playerAct(sleepers[0].id, 'status', {});
ok(cv.camp && cv.camp.asleep && cv.camp.on_watch && cv.camp.asleep_names.length === M.length - 1, 'agent status carries the camp: ' + JSON.stringify(cv.camp && cv.camp.status));
ok(/Camp: resting until .* on watch: .* asleep: /.test(CAMPM.campSummary() || ''), 'Fellowship panel line: ' + CAMPM.campSummary());
const PA = await import('../src/sim/pace.js');
sleepers[0].playEv.push({n: 900, t: '00:00', text: 'a party line', e: 0, w: 1}); // soft
ok(PA.paceCheck(sleepers[0].id, {since: S.gameMin - 9999, minutes: 5}) === null, 'a sleeper gets no soft or heartbeat turn');
ok(PA.paceCheck(watcher.id, {since: S.gameMin - 9999, minutes: 5}) !== null, 'the watcher still gets its heartbeat');
// the vote
const asker = sleepers[0];
ok(typeof CO.propose(asker, 'break_camp', 'We are rested.', {vote: 'yes'}) !== 'string', 'break_camp can be proposed');
for (const a of M) if (a !== asker) CO.castVote(a, CO.openProps()[0] ? CO.openProps()[0].id : 0, 'yes', 'on we go', 'agent');
ok(!S.fellowship.camp.phase && M.every(a => a.state !== 'camp'), 'a passed break_camp vote breaks the camp early');
ok(M.every(a => a.playEv.some(e => /Camp is broken/.test(e.text) && e.w === 2)), 'every member got a turn-starting event when camp broke');
ok(M.every(a => !a.playDoing || !/Asleep|On watch/.test(a.playDoing)), 'camp doing text cleared');
// leader break
({L: M, lead: LD} = gather());
ok(CAMPM.leaderRest(LD, 4) === null, 'second camp');
for (let i = 0; i < 40 && S.fellowship.camp.phase !== 'rest'; i++) run(10);
ok(typeof CAMPM.leaderBreak(M.find(a => a !== LD)) === 'string', 'only the leader breaks camp outright');
ok(CAMPM.leaderBreak(LD) === null && !S.fellowship.camp.phase, 'the leader breaks camp');
// ---- #400: orders refused at camp say how to go on; a second break_camp is a yes; vote refusals name the open one ----
{const RL = await import('../src/sim/runlink.js');
({L: M, lead: LD} = gather());
ok(CAMPM.leaderRest(LD, 4) === null, '#400 camp');
for (let i = 0; i < 40 && S.fellowship.camp.phase !== 'rest'; i++) run(10);
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
for (const a of M) for (const P of CO.openProps()) if (!P.votes[a.id]) {const v = act(a, 'vote', {proposal_id: P.id, vote: P.kind === 'break_camp' ? 'yes' : 'no'}); if (!v.ok) console.log('    vote', a.name, P.id, v.error.slice(0, 120))}
for (let i = 0; i < 60 && (S.table || S.fellowship.camp.phase); i++) run(1); // the votes are counted at the table (an all-at-once decision scene)
ok(BP.status === 'passed' && !S.fellowship.camp.phase && M.every(a => a.state !== 'camp'), 'the seconded break_camp passed and broke camp');
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
for (let i = 0; i < 40 && S.fellowship.camp.phase !== 'rest'; i++) run(10);
const t0 = S.gameMin; for (let i = 0; i < 60 && S.fellowship.camp.phase; i++) run(10);
CAMPM.CAMP.AMBUSH_P = ambushP;
ok(!S.fellowship.camp.phase && S.gameMin - t0 < 90 && S.gameMin - t0 >= 50, 'a one-hour rest ends on time (' + Math.round(S.gameMin - t0) + ' game min)');
ok(M.every(a => a.playEv.some(e => /Camp is broken/.test(e.text))), 'wake event after a timed rest too');
ok(typeof CO.propose(M[0], 'break_camp', 'x') === 'string', 'break_camp refused with no camp');
for (const a of M) a.player = false;
console.log(fail ? fail + ' check(s) FAILED' : 'campcheck passed');
process.exit(fail ? 1 : 0);
