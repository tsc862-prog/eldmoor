// The DM's call_to lever (issue #826), run as a child by scripts/dmcheck.mjs (or alone: node scripts/callto-test.mjs).
// The world engine never asks a company to the Crypt or a raid; the DM may. A call spoken by a person or the narrator opens the
// usual vote, named as theirs, and the vote stays the members'. The caps and the no that holds for two game days, the pile-on
// rule and the other refusals, the companies' reserve, a decline, an accepted call going down, a raid, a solo's question
// (accept, decline, silence, its own order), what the DM is told, a `when`, a save and restore, no dice. Prints CALLTO OK.
let seed = 0x8260c411, rolls = 0;
Math.random = () => {rolls++; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, markPlayer, playerAct, setRunnerLinks, setReflexAck, snapshot, restore, dmAct, setDmSeat} = SIM;
const CO = await import('../src/sim/company.js'), CN = await import('../src/sim/council.js'), T = await import('../src/sim/table.js');
const {CALL, callFor, callBrief} = await import('../src/sim/callto.js');
const {paceBrief} = await import('../src/sim/pace.js');
const {wakeLevel} = await import('../src/sim/notify.js');
const {askedNote} = await import('../scripts/pacing.mjs');
const {whenTick} = await import('../src/sim/dmwhen.js');
const {DM_TOOLS} = await import('../src/data/dm-tools.js');
const {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
const {LEVERS} = await import('../src/sim/levers.js');
const {CITY, CRYPT, ZONES, dist} = await import('../src/world/map.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {maxHp} = await import('../src/sim/heroes.js');
const {ensureNpcs} = await import('../src/sim/npcs.js');
const {homeOf} = await import('../src/data/races.js');

let fails = 0;
const ok = (c, msg, extra) => {if (c) console.log('  ok   ' + msg); else {fails++; console.log('  FAIL ' + msg + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : ''))}};
const section = t => console.log('\n' + t);
const SECRET = 'because-the-dm-wants-them-below';
const act = (a, tool, args) => {a.playRate = []; return playerAct(a.id, tool, args || {})};
const SAFE = () => {for (const m of S.mobs || []) m.alive = false; rebuild()};
const put = (a, x, y, st = 'hunt') => {a.x = x; a.y = y; a.state = st; a.hidden = false; a.target = null; a.dest = null; a.pq = []; a.moving = false; a.hp = maxHp(a); a.raid = false; a.adv = null};
const newDay = () => {S.gameMin = (Math.floor(S.gameMin / 1440) + 1) * 1440 + 480; if (S.dmAgent.day) S.dmAgent.day.pulls = 0};
const call = (a = {}) => dmAct('call_to', {kind: 'crypt', reason: 'Call ' + SECRET, ...a});
const fresh = (o = {}) => {setRunnerLinks(null); setReflexAck(null); T.TABLE.mode = 'off'; T.TABLE.speed = 1; T.TABLE.drop = null; init(o); delete S.opening; S.boss.alive = true; CRYPT.group = null; CRYPT.cd = 9999; setRunnerLinks(() => 'connected'); setDmSeat(true); SAFE()};
const events = a => (a.playEv || []).map(e => e.text).join('\n');
const chat = a => (a.chat || []).map(e => (e.from && e.from.name || '') + ': ' + e.text).join('\n');
const dmLogText = () => JSON.stringify(S.dmLog);
const lastLine = re => S.dmLog.find(e => re.test(JSON.stringify(e.summary || e)));
// the company in the field, all together, away from any town
const fieldUp = (M) => M.forEach((a, i) => {a.lvl = 10; put(a, CRYPT.x + 4 + i * .4, CRYPT.y + 4)});
// the company at its hall's gate, beside the captain
const townUp = (F, M) => {ensureNpcs(); const c = CITY.find(x => x.name === F.hall), cap = S.npcs.find(p => p.town === c.name && p.role === 'captain');
  M.forEach((a, i) => {a.lvl = 10; put(a, cap.x + .4 + i * .3, cap.y + .5, 'town'); a.town = c.name}); return {c, cap}};
const voteAll = (P, v) => {for (const a of CO.members(CO.companyById(CO.companyOf(S.agents.find(x => x.id === P.by)).id))) if (P.status === 'open' && !P.votes[a.id]) act(a, 'vote', {proposal_id: P.id, vote: v, reason: v === 'yes' ? 'We go.' : 'Not now.'})};
const dmProp = (F, kind = 'crypt') => (F.props || []).find(P => P.kind === kind && P.src === 'dm');

section('the tools');
ok(DM_TOOLS.some(t => t.name === 'call_to' && t.act && !t.args.reason.optional && t.args.company.optional && t.args.by.optional), 'call_to is a DM tool and a reason is required');
ok(LEVERS.call_to && LEVERS.call_to.limits.perDay === CALL.ALL_DAY, 'and a lever with a daily limit');
ok(PLAYER_TOOLS.some(t => t.name === 'answer_call' && t.act), 'answer_call is a hero tool');

section('A. asked by a person');
{fresh(); const F = CO.slotted(), M = CO.members(F), L = CN.leaderOfC(F), {cap} = townUp(F, M); T.TABLE.mode = 'auto';
  for (const a of M) {a.playEv = []; a.chat = []}
  const nums = () => JSON.stringify(M.map(m => [m.id, m.hp, m.xp, m.lvl, m.gold])), n0 = nums();
  const line = 'The dead walk out of the Crypt at night. Will you go down and shut its door?';
  const r = call({by: cap.name, text: line}), P = dmProp(F), who = (cap.title ? cap.title + ' ' : '') + cap.name;
  ok(r.ok && P && P.status === 'open', 'the call opens a proposal' + (r.ok ? '' : ': ' + r.error), r);
  ok(P && P.src === 'dm' && P.caller === who && P.details.startsWith(line), 'named as the caller\'s, in the DM\'s words: ' + (P && P.caller));
  ok(P && !Object.keys(P.votes).length, 'nobody has voted: the leader\'s vote stays its agent\'s');
  ok(chat(L).includes(line) && (L.chat.at(-1).from.id === cap.id), 'the leader heard it, spoken by the person');
  ok(M.every(a => events(a).includes(who + ' asks you to') && /vote\(/.test(events(a))), 'every member hears the ask and is asked to vote');
  ok(cap.bubble && cap.bubble.text === line, 'the speech shows over the person');
  const sc = T.sceneFor(F); ok(sc && sc.kind === 'decision' && JSON.stringify(sc).includes(cap.name), 'the decision scene names the caller, never a group forming');
  ok(!/forming/i.test(JSON.stringify(P)), 'the proposal says nothing of a group forming');
  ok(nums() === n0, 'no hero\'s numbers change');
  ok(S.dmAgent.day.pulls === 1, 'it counts as one lever pull');
  const e = S.dmLog.find(x => x.kind === 'lever' && x.detail.lever === 'call_to');
  ok(e && e.detail.by === 'dm-agent' && e.detail.result === 'applied' && e.detail.reason.includes(SECRET), 'in the DM log with its reason');
  ok(!(JSON.stringify(M.map(m => [m.playEv, m.chat])) + JSON.stringify(P) + JSON.stringify(F.calls)).includes(SECRET), 'no hero, no proposal and no company record carries the reason');
  ok(S.dmFocus && S.dmFocus.fellow >= 1, 'it counts as an act for the company');
}

section('B. the default voice: the gate captain, the narrator');
{fresh(); const F = CO.slotted(), M = CO.members(F), {cap} = townUp(F, M);
  let r = call({}), P = dmProp(F); ok(r.ok && P && P.caller.includes(cap.name), 'in town, near the gate, the captain asks: ' + (P && P.caller));
  ok(P && P.details.includes(CRYPT.name), 'with a plain line of its own: ' + (P && P.details));
  fresh(); const G = CO.slotted(), N = CO.members(G), L = CN.leaderOfC(G); fieldUp(N); for (const a of N) {a.playEv = []; a.chat = []}
  r = call({kind: 'crypt', company: 'fellowship'}); P = dmProp(G);
  ok(r.ok && P && P.caller === 'The narrator', 'out in the field the narrator asks', r);
  ok(L.chat.at(-1).from.name === 'The Narrator' && events(N[1]).includes('The narrator asks you to'), 'and the company hears the narrator');
  fresh(); const H = CO.slotted(), O = CO.members(H), far = townUp(H, O); fieldUp(O);
  r = call({by: far.cap.name}); ok(!r.ok && /not within 7 tiles/.test(r.error), 'a person out of earshot is refused: ' + r.error);
  r = call({by: 'Nobody Atall'}); ok(!r.ok && /no person called/.test(r.error), 'nobody by that name: ' + r.error);
  r = call({company: 'The Nameless'}); ok(!r.ok && /no company called/.test(r.error), 'no such company: ' + r.error);
  r = call({kind: 'picnic'}); ok(!r.ok, 'an unknown kind is refused: ' + r.error);
  r = dmAct('call_to', {kind: 'crypt'}); ok(!r.ok && /reason/.test(r.error), 'a reason is required: ' + r.error);
  r = call({text: 'Здравствуйте друзья, идите вниз'}); ok(!r.ok && /English/.test(r.error), 'the words must be English: ' + r.error);
  r = call({company: O[2].name}); ok(r.ok, 'a member\'s name finds the company' + (r.ok ? '' : ': ' + r.error));
}

section('C. the caps, a decline and the wait after it');
{fresh(); const F = CO.slotted(), M = CO.members(F); fieldUp(M);
  let r = call(); const P = dmProp(F); ok(r.ok, 'a call goes');
  newDay(); r = call(); ok(!r.ok && /vote is open|has not answered/.test(r.error), 'not while their vote is open, even on a new day: ' + r.error);
  voteAll(P, 'no'); ok(P.status === 'failed', 'the members say no: ' + P.result);
  ok(F.calls.last.answer === 'declined' && lastLine(/declined the call/), 'the DM log says so');
  ok(/Not asked again for 2 game days/.test(JSON.stringify(lastLine(/declined the call/).summary)), 'and for how long');
  const v = dmAct('dm_status').fellowship_needs.last_call; ok(v && v.answer === 'declined' && v.not_again_for_hours > 0 && v.kind === 'crypt', 'last_call tells the DM', v);
  r = call(); ok(!r.ok && /declined your last call/.test(r.error) && !r.usage, 'asked again too soon: ' + r.error);
  ok(S.dmLog.some(e => e.kind === 'lever' && /declined your last call/.test(JSON.stringify(e.detail))), 'the refusal is in the DM log');
  newDay(); r = call({kind: 'raid'}); ok(!r.ok && /declined/.test(r.error), 'a raid call waits out the same no: ' + r.error);
  newDay(); r = call(); ok(r.ok, 'after two game days it may go' + (r.ok ? '' : ': ' + r.error));
  voteAll(dmProp(F), 'yes'); F.wait = null; if (CRYPT.group) {for (const a of M) put(a, a.x, a.y); CRYPT.group = null}
  r = call(); ok(!r.ok && /limit: 1 call/.test(r.error), 'one a company a game day: ' + r.error);
}

section('D. an accepted call goes down, and a raid');
{fresh(); const F = CO.slotted(), M = CO.members(F); fieldUp(M); M.forEach(a => {a.x = CRYPT.x + .5; a.y = CRYPT.y + 1});
  call({text: 'Go down, if you will.'}); const P = dmProp(F); voteAll(P, 'yes');
  ok(P.status === 'passed' && CRYPT.group && M.every(a => CRYPT.group.mem.includes(a) && a.cryptOk), 'the company votes yes and sets out together: ' + P.result);
  ok(F.calls.last.answer === 'accepted' && lastLine(/answered the call/), 'the DM log has their yes');
  for (let k = 0; k < 120; k++) step(1 / 60);
  ok(M.every(a => a.state === 'dungeon'), 'nobody is thrown back out of the group');
  const r = call(); ok(!r.ok, 'no call while they are in the Crypt: ' + r.error);
  // a raid: the vote holds the muster, as a raid vote of their own does
  fresh(); const G = CO.slotted(), N = CO.members(G), f = G.fac; fieldUp(N); S.raidT = 1e9;
  const r2 = call({kind: 'raid'}), Q = dmProp(G, 'raid'); ok(r2.ok && Q && CN.raidReserve() === f, 'a raid call holds the muster while they vote');
  voteAll(Q, 'yes'); ok(Q.status === 'passed' && G.accept.raid > S.gameMin && N.every(a => a.raidOk), 'and a yes is their own passed vote');
  // the proposal holds the company in the field even with one too far to hear: the absent hear of it on rejoining
  fresh(); const H = CO.slotted(), O = CO.members(H); fieldUp(O); O[4].x += 40; const r3 = call(), R = dmProp(H);
  ok(r3.ok && R && R.absent && R.absent.includes(O[4].id), 'a member too far away is absent from the vote, as in any vote');
}

section('E. refusals: pile-on, fight, scene, wait, Kragmaw dead');
{fresh(); const F = CO.slotted(), M = CO.members(F); fieldUp(M);
  M[1].hp = Math.floor(maxHp(M[1]) * .2); let r = call();
  ok(!r.ok && /does not pile on/.test(r.error) && !dmProp(F), 'a member badly hurt in the field: ' + r.error);
  ok(S.dmLog.some(e => e.kind === 'lever' && /pile on/.test(JSON.stringify(e.detail))), 'in the DM log');
  ok(!F.calls, 'nothing is written on the company');
  M[1].hp = maxHp(M[1]); M[1].state = 'town'; M[1].hp = 1; r = call(); ok(r.ok, 'hurt in town is no pile-on' + (r.ok ? '' : ': ' + r.error));
  fresh(); const G = CO.slotted(), N = CO.members(G); fieldUp(N);
  N[2].state = 'fight'; r = call(); ok(!r.ok && /in a fight/.test(r.error), 'in a fight: ' + r.error); N[2].state = 'hunt';
  N[3].raid = true; r = call(); ok(!r.ok && /in a raid/.test(r.error), 'in a raid: ' + r.error); N[3].raid = false;
  S.boss.alive = false; r = call({kind: 'raid'}); ok(!r.ok && /not in its lair/.test(r.error), 'Kragmaw dead: ' + r.error); S.boss.alive = true;
  G.wait = {crypt: S.gameMin + 100}; r = call(); ok(!r.ok && /already set/.test(r.error), 'a wait standing: ' + r.error); G.wait = null;
  CN.propose(CN.leaderOfC(G), 'raid', '', {}); r = call(); ok(!r.ok && /vote is open/.test(r.error), 'their own vote open: ' + r.error);
  fresh(); const H = CO.slotted(), O = CO.members(H); fieldUp(O); T.TABLE.mode = 'auto'; CN.propose(CN.leaderOfC(H), 'other', 'Rest a while', {}); r = call();
  ok(T.sceneFor(H) && !r.ok && /scene/.test(r.error), 'a scene open: ' + r.error);
}

// a world of solos: the reserve and the DM's reads
const soloWorld = n => {fresh({fellowship: false}); const L = S.agents.filter(b => b.state !== 'dead' && b.fac === 0).slice(0, n); for (const a of L) markPlayer(a, true); step(1 / 60); SAFE();
  L.forEach((a, i) => {a.lvl = 12; put(a, CRYPT.x + 6 + i * 2, CRYPT.y + 6); a.playEv = []; a.chat = []}); return L};

section('F. a solo is asked');
{let [a] = soloWorld(1); const C = CO.companyOf(a); let r = call({company: a.name, text: 'Will you go down, alone if you must?'});
  ok(r.ok && !(C.props || []).length, 'no vote: a solo has nobody to vote with');
  ok(/asks you/.test(events(a)) && /answer_call/.test(events(a)) && chat(a).includes('Will you go down'), 'it hears the question and how to answer');
  ok(a.playEv.some(e => /asks you/.test(e.text) && wakeLevel(e) === 3), 'the question starts its turn at once');
  ok(callFor(a) && callBrief(a).line.includes('Will you go down'), 'the question stands');
  const b = paceBrief(a.id).brief; ok(b.asked && /answer_call/.test(askedNote(b)), 'the turn header names it: ' + askedNote(b).trim().slice(0, 110));
  r = act(a, 'answer_call', {answer: 'maybe', line: 'We shall see.'}); ok(!r.ok && /accept or decline/.test(r.error), 'an answer is yes or no: ' + r.error);
  r = act(a, 'answer_call', {answer: 'accept'}); ok(!r.ok && /aloud/.test(r.error), 'it must be said aloud: ' + r.error);
  r = act(a, 'answer_call', {answer: 'accept', line: 'I will go down, and God help the dead.'});
  ok(r.ok && r.answered === 'accepted' && a.pq.some(c => c.kind === 'crypt'), 'a yes is its go_crypt', r);
  ok(a.chat.some(e => e.text.includes('I will go down')), 'said aloud');
  ok(C.calls.last.answer === 'accepted' && lastLine(/answered the call/), 'the DM log has its yes');
  ok(!callFor(a) && !paceBrief(a.id).brief.asked, 'the header goes quiet');
  r = act(a, 'answer_call', {answer: 'decline', line: 'No.'}); ok(!r.ok && /Nobody is waiting/.test(r.error), 'nothing left to answer: ' + r.error);
  // a no aloud
  [a] = soloWorld(1); let D = CO.companyOf(a); call({company: a.name}); r = act(a, 'answer_call', {answer: 'decline', line: 'Not for all the gold in the vaults.'});
  ok(r.ok && r.answered === 'declined' && !a.pq.length && D.calls.last.answer === 'declined', 'a no is a no');
  newDay(); r = call({company: a.name}); ok(!r.ok && /declined/.test(r.error), 'and holds: ' + r.error);
  // silence
  [a] = soloWorld(1); D = CO.companyOf(a); call({company: a.name}); S.gameMin += CALL.ANSWER_MIN + 1;
  ok(!callFor(a) && D.calls.last.answer === 'unanswered' && lastLine(/never answered/), 'silence lapses as a no, in the DM log');
  r = act(a, 'answer_call', {answer: 'accept', line: 'Too late?'}); ok(!r.ok, 'a late answer finds nobody waiting');
  // its own order
  [a] = soloWorld(1); D = CO.companyOf(a); call({company: a.name}); r = act(a, 'go_crypt', {force: 'yes'});
  ok(r.ok && D.calls.last.answer === 'accepted', 'going by its own order answers it');
  // a raid call needs a muster to fall in with
  [a] = soloWorld(1); D = CO.companyOf(a); S.raidOn[a.fac] = false; r = call({company: a.name, kind: 'raid'}); ok(!r.ok && /muster that is out/.test(r.error), 'no muster out: ' + r.error);
  S.raidOn[a.fac] = true; r = call({company: a.name, kind: 'raid'}); ok(r.ok, 'with one out the call goes');
  r = act(a, 'answer_call', {answer: 'accept', line: 'Then I ride with them.'}); ok(r.ok && a.raid && a.state === 'raid' && D.calls.last.answer === 'accepted', 'a yes is its join_raid');
  // the question reaches the place: a hero who never heard of the Crypt can walk there
  [a] = soloWorld(1); if (a.lore && a.lore.p) delete a.lore.p[CRYPT.name]; call({company: a.name, text: 'There is a hole in the moor where the dead come up.'}); r = act(a, 'answer_call', {answer: 'accept', line: 'Show me the road.'}); ok(r.ok, 'the ask teaches the place' + (r.ok ? '' : ': ' + r.error));
  // a member of a company has nothing to answer
  fresh(); const m = CO.members(CO.slotted())[0]; r = act(m, 'answer_call', {answer: 'accept', line: 'Aye.'}); ok(!r.ok && /vote/.test(r.error), 'a company answers with vote: ' + r.error);
}

section('G. the companies\' reserve');
{const L = soloWorld(3), [x, y, z] = L; S.followId = CO.companyOf(x).id; const fs = [x, y, z].map(CO.companyOf);
  S.dmFocus = {acts: 9, fellow: 9, day: {d: -1, acts: 0, fellow: 0}, last: {[fs[0].id]: Math.round(S.gameMin), [fs[1].id]: Math.round(S.gameMin) - 10, [fs[2].id]: Math.round(S.gameMin) - 3000}, by: {}};
  // use the world's share of the lever (2 of 3) on the followed company and one more, so only the reserve is left
  S.levers.day = {d: Math.floor(S.gameMin / 1440), n: {call_to: CALL.ALL_DAY - 1}, rz: {}, nf: {}};
  S.gameMin += 0; const r = call({company: y.name});
  ok(!r.ok && /kept for/.test(r.error), 'with only the reserve left, a company just served gives way to a starved one: ' + r.error);
  const r2 = call({company: z.name}); ok(r2.ok, 'and the starved company gets the reserve' + (r2.ok ? '' : ': ' + r2.error));
  S.levers.day.n.call_to = CALL.ALL_DAY; const r3 = call({company: x.name}); ok(!r3.ok && /limit: 3 call_to per game day/.test(r3.error), 'the lever\'s own limit: ' + r3.error);
  S.levers.day.n.call_to = 0; S.dmAgent.day.pulls = 8; const r4 = call({company: x.name}); ok(!r4.ok && /levers today/.test(r4.error), 'the DM\'s day of pulls binds it too: ' + r4.error);
}

section('H. what the DM is told');
{fresh(); const F = CO.slotted(), M = CO.members(F); fieldUp(M); const other = S.agents.filter(b => b.fac === F.fac && !M.includes(b)).slice(0, 3); const items = () => dmAct('dm_status').fellowship_needs.items.join('\n');
  ok(/stands free/.test(items()), 'the Crypt stands free, when nothing else is pending');
  CRYPT.group = {fac: F.fac, mem: other, phase: 'gather', t: 30};
  ok(/background group .* gathers at/.test(items()) && /not theirs/.test(items()), 'a group gathers: the DM knows, and that it is the DM\'s to pass on');
  ok(!M.some(a => /gathers|forming/.test(events(a))), 'no hero hears it');
  CRYPT.group = null; S.raidOn[F.fac] = true; ok(/muster is out/.test(items()), 'a muster is out'); S.raidOn[F.fac] = false;
  const [a, b] = soloWorld(2); const v = () => dmAct('dm_status').companies_needs; call({company: a.name});
  const row = v().find(r => r.id === CO.companyOf(a).id), row2 = v().find(r => r.id === CO.companyOf(b).id);
  ok(row.last_call && row.last_call.answer === 'open' && row.last_call.by === 'The narrator', 'companies_needs carries last_call', row.last_call);
  ok(!row2.last_call, 'only for the company called');
}

section('I. a when fires it; save and restore; no dice');
{fresh(); const F = CO.slotted(), M = CO.members(F); fieldUp(M); const z = ZONES[1];
  let r = dmAct('when', {trigger: 'after_hours', on: {h: 1}, action: 'call_to', args: {kind: 'crypt', company: 'The Nameless'}, reason: 'later'}); ok(!r.ok && /no company called/.test(r.error), 'a when checks the company when set: ' + r.error);
  r = dmAct('when', {trigger: 'after_hours', on: {h: 1}, action: 'call_to', args: {kind: 'crypt', company: 'fellowship', text: 'The hour has come: will you go down?'}, reason: 'Later ' + SECRET});
  ok(r.ok, 'a when can hold a call' + (r.ok ? '' : ': ' + r.error), r);
  S.gameMin += 70; whenTick(); const P = dmProp(F);
  ok(P && P.details.startsWith('The hour has come'), 'and it fires through the same tool', S.dmAgent.when);
  void z;
  const s = JSON.stringify(snapshot()); ok(s.includes('"calls"'), 'the call is saved with the company');
  restore(JSON.parse(s)); const G = CO.slotted(); ok(G.calls && G.calls.last.answer === 'open', 'and restored');
  voteAll(dmProp(G), 'no'); ok(G.calls.last.answer === 'declined', 'its answer still lands after a restore');
  fresh(); const H = CO.slotted(); fieldUp(CO.members(H)); const n0 = rolls; const r2 = call(); ok(r2.ok && rolls === n0, 'a call rolls no dice (' + (rolls - n0) + ')');
  r = dmAct('pull_lever', {lever: 'call_to', params: {kind: 'raid', company: 'fellowship'}, reason: 'by the lever'}); ok(!r.ok && /limit|vote/.test(r.error), 'pull_lever reaches the same rules: ' + r.error);
  fresh(); const J = CO.slotted(); fieldUp(CO.members(J)); r = dmAct('pull_lever', {lever: 'call_to', params: {kind: 'crypt', company: 'fellowship'}, reason: 'by the lever'}); ok(r.ok && dmProp(J), 'and pull_lever works' + (r.ok ? '' : ': ' + r.error));
}

void homeOf; void dist; void dmLogText;
console.log(fails ? 'CALLTO FAILED: ' + fails : 'CALLTO OK');
process.exit(fails ? 1 : 0);
