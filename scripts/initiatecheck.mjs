// Companies initiate the Crypt and raids (issue #826): the world engine never asks a company. With a host that reports runner
// links no background muster opens a vote, an event or a scene for a company, and no company member is in a pool until its own
// vote passed. The leader's propose still goes (the whole company, together); a solo has go_crypt and join_raid; a world with no
// host (npm run sim, the seeded checks) keeps the reflex draft, because a reflex company has no mind to initiate. askCompany is
// the one door for a question someone in the world puts to a company.
// Usage: npm run initiatecheck (also runs itself in every other world); ELDMOOR_WORLD=<id> npm run initiatecheck for one
let seed = 0x5eed826;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, markPlayer, playerAct, setRunnerLinks, setReflexAck} = SIM;
const CO = await import('../src/sim/company.js'), CN = await import('../src/sim/council.js'), T = await import('../src/sim/table.js');
const {homeOf} = await import('../src/data/races.js');
const {CRYPT, CRYPTS, LAIR, dist} = await import('../src/world/map.js');
const {cryptOfCtx} = await import('../src/sim/crypts.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {maxHp} = await import('../src/sim/heroes.js');
const {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const section = t => console.log('\n' + t);
const act = (a, tool, args) => {a.playRate = []; return playerAct(a.id, tool, args || {})};
const living = a => !!a && a.state !== 'dead';
const txt = ps => (ps || []).map(p => typeof p === 'string' ? p : p && (p.t || p.name) || '').join('');
const logOf = C => (C.log || []).map(e => txt(e.parts)).join('\n');
const events = a => (a.playEv || []).map(e => e.text || e.t || String(e)).join('\n');
const put = (a, x, y, st = 'hunt') => {a.x = x; a.y = y; a.state = st; a.hidden = false; a.target = null; a.dest = null; a.pq = []; a.moving = false; a.hp = maxHp(a); a.raid = false; a.adv = null};
// A world may have several dungeons (#891) and a background group answers the one that fits its heroes, not the first: read them all.
const groupOf = f => CRYPTS.map(D => D.group).find(g => g && (f == null || g.fac === f)) || null;
const clearGroups = () => {for (const D of CRYPTS) D.group = null};
const SAFE = () => {for (const m of S.mobs || []) m.alive = false; rebuild()};
// a faction's heroes in town at raid level, so both musters have all they want
const field = f => {for (const a of S.agents) if (a.fac === f && living(a)) {const c = homeOf(a); put(a, c.gate.x, c.gate.y - 1, 'town'); a.lvl = 15; a.gear = 12; a.townStep = 2; a.wait = 9}};
// Only the company (and whoever it hired) is fielded: with several dungeons the faction's other heroes would fill every one before the draft reached the company, which says nothing of the draft.
const fieldCo = F => {for (const a of CO.members(F)) if (living(a)) {const c = homeOf(a); put(a, c.gate.x, c.gate.y - 1, 'town'); a.lvl = 15; a.gear = 12; a.townStep = 2; a.wait = 9}};
const company = () => CO.slotted();
const fresh = o => {setRunnerLinks(null); setReflexAck(null); T.TABLE.mode = 'auto'; T.TABLE.speed = 1; T.TABLE.drop = null; init(o); delete S.opening; S.boss.alive = true;
  clearGroups()};
// Force both musters to look, step by step, for s simulated seconds; `each` runs after every step. The world stays free of scenes it did not ask for.
const muster = (f, s, each) => {for (let k = 0; k < s * 60; k++) {if (!(k % 60)) {field(f); for (const D of CRYPTS) D.cd = 0; S.raidT = 0; S.raidOn[f] = false; for (const D of CRYPTS) if (D.group && !D.group.mem.some(CO.companyOf)) {for (const a of D.group.mem) {a.state = 'hunt'; a.hidden = false} D.group = null}} step(1 / 60); if (each) each(k)}};

// ---- A. a background muster never opens a vote for an agent company ----
for (const [label, link, ack] of [['live runners', () => 'connected', null], ['runners gone, the owner resumed: reflexes play them', () => 'none', () => true]]) {
  section('A. a background muster, ' + label);
  fresh({}); setRunnerLinks(link); if (ack) setReflexAck(ack);
  const F = company(), M = CO.members(F), f = F.fac; let group = 0, raid = 0, took = 0, asked = 0, scene = 0;
  for (const a of M) a.playEv = [];
  muster(f, 240, () => {
    if (groupOf(f)) group++;
    if (S.raidOn[f]) raid++;
    if (CRYPTS.some(D => D.group && D.group.mem.some(a => M.includes(a))) || M.some(a => a.raid)) took++;
    if ((F.props || []).some(P => P.kind === 'crypt' || P.kind === 'raid')) asked++;
    if (T.sceneFor(F) && T.sceneFor(F).kind === 'decision') scene++});
  ok(group > 0 && raid > 0, 'the background still musters for both (' + group + ' Crypt, ' + raid + ' raid steps)');
  ok(!took, 'no company member is in a Crypt group or a raid');
  ok(!asked && !scene, 'no proposal and no decision scene opens');
  ok(!/call to|came, but|forming|musters to raid/i.test(logOf(F)), 'the company log has no "call came" line');
  ok(!M.some(a => /forming|do we|musters/i.test(events(a))), 'no event tells a member a group is forming');
}

// ---- B. a leader's own proposal still works ----
section('B. the leader proposes');
{
  fresh({}); setRunnerLinks(() => 'connected');
  const F = company(), M = CO.members(F), L = CN.leaderOfC(F); T.TABLE.mode = 'off'; SAFE();
  M.forEach((a, i) => {put(a, CRYPT.x + i * .4, CRYPT.y + 3); a.lvl = 10});
  M[4].x += 40; let r = act(L, 'propose', {kind: 'crypt'});
  ok(!r.ok && /whole Fellowship/.test(JSON.stringify(r)), 'a Crypt vote needs everyone together: ' + r.error);
  M[4].x -= 40; CRYPT.cd = 9999;
  r = act(L, 'propose', {kind: 'crypt'}); const P = F.props.find(q => q.kind === 'crypt');
  ok(r.ok && P && P.src === 'member' && /go down into/.test(P.details) && !/forming|call/i.test(P.details), 'the vote reads as the proposer\'s: ' + (P && P.details));
  for (const a of M) if (P.status === 'open' && !P.votes[a.id]) act(a, 'vote', {proposal_id: P.id, vote: 'yes', reason: 'Down.'});
  ok(P.status === 'passed' && CRYPT.group && M.every(a => CRYPT.group.mem.includes(a) && a.cryptOk), 'it passes and the whole company sets out (' + P.result + ')');
  for (let k = 0; k < 120; k++) step(1 / 60);
  ok(M.every(a => a.state === 'dungeon'), 'nobody is thrown back out of the group');
  // the raid: the vote reserves the muster, and the muster takes them even though the pools leave companies out
  if (!LAIR) { // a map with no lair (Hollin, #1013): a raid is refused in words, nothing musters
    fresh({}); setRunnerLinks(() => 'connected'); const Lx = CN.leaderOfC(company()); T.TABLE.mode = 'off';
    const rx = act(Lx, 'propose', {kind: 'raid'});
    ok(!rx.ok && /nothing here to raid/.test(rx.error), 'a raid is refused where no great beast keeps a lair: ' + rx.error);
  } else {
  fresh({}); setRunnerLinks(() => 'connected');
  const G = company(), N = CO.members(G), Lg = CN.leaderOfC(G), f = G.fac; T.TABLE.mode = 'off'; field(f);
  const c = homeOf(Lg); N.forEach((a, i) => put(a, c.gate.x + i * .4, c.gate.y + 2)); S.raidT = 1e9;
  r = act(Lg, 'propose', {kind: 'raid'}); const Q = G.props.find(q => q.kind === 'raid');
  for (const a of N) if (Q.status === 'open' && !Q.votes[a.id]) act(a, 'vote', {proposal_id: Q.id, vote: 'yes', reason: 'Ride.'});
  ok(Q.status === 'passed' && CN.raidReserve() === f, 'the raid vote passes and holds the muster');
  S.raidT = 0; for (let k = 0; k < 60 * 30 && !S.raidOn[f]; k++) {SAFE(); step(1 / 60)}
  ok(S.raidOn[f] && N.every(a => a.raid && a.raidOk), 'the muster takes the whole company');
  ok(/as they voted/.test(logOf(G)) && !/call/i.test(logOf(G)), 'the log says it was their vote');
  for (let k = 0; k < 120; k++) step(1 / 60);
  ok(N.every(a => a.state === 'raid' || !living(a)), 'they stay in the raid');
  // a vote that never mustered lapses with word, so the faction's reserve does not idle on
  fresh({}); setRunnerLinks(() => 'connected');
  const H = company(), Lh = CN.leaderOfC(H), hm = CO.members(H); T.TABLE.mode = 'off'; const hc = homeOf(Lh); hm.forEach((a, i) => put(a, hc.gate.x + i * .4, hc.gate.y + 2)); S.raidT = 1e9;
  act(Lh, 'propose', {kind: 'raid'}); const R = H.props.find(q => q.kind === 'raid');
  for (const a of hm) if (R.status === 'open' && !R.votes[a.id]) act(a, 'vote', {proposal_id: R.id, vote: 'yes', reason: 'Ride.'});
  H.accept.raid = S.gameMin - 1; step(1 / 60);
  ok(CN.raidReserve() < 0 && !(H.wait && H.wait.raid) && /never came together/.test(logOf(H)), 'a raid vote that lapses frees the muster and says so');
  }
}

// ---- C. a solo's direct orders ----
section('C. a solo: go_crypt, join_raid');
{
  const solo = lvl => {fresh({fellowship: false}); setRunnerLinks(() => 'connected'); T.TABLE.mode = 'off'; SAFE();
    const a = S.agents.find(b => living(b) && b.fac === 0); markPlayer(a, true); a.lvl = lvl; put(a, CRYPT.x + 3, CRYPT.y + 4); step(1 / 60); return a};
  let a = solo(12);
  ok(CO.isSolo(CO.companyOf(a)), 'a marked hero rides as a company of one');
  let r = act(a, 'propose', {kind: 'crypt'});
  ok(!r.ok && /go_crypt/.test(r.error), 'propose names the solo\'s road: ' + r.error);
  CRYPT.cd = 9999; r = act(a, 'go_crypt', {force: 'yes'});
  ok(r.ok && a.pq.some(c => c.kind === 'crypt'), 'go_crypt takes: ' + JSON.stringify(r).slice(0, 120));
  for (let k = 0; k < 60 * 60 && !a.hidden && living(a); k++) {SAFE(); step(1 / 60)}
  ok(a.hidden && CRYPT.group && CRYPT.group.mem.length === 1 && CRYPT.group.mem[0] === a && a.cryptOk, 'it walks to the mouth and goes down, a group of one');
  // Table on: the crawl runs for it
  a = solo(12); T.TABLE.mode = 'auto'; CRYPT.cd = 9999; act(a, 'go_crypt', {force: 'yes'});
  for (let k = 0; k < 60 * 60 && !(CRYPT.group && CRYPT.group.crawl); k++) {SAFE(); step(1 / 60); const sc = T.sceneFor(CO.companyOf(a)); if (sc && sc.phase === 'turn' && !sc.acts[a.id]) T.sceneAct(a, sc.kind === 'site' ? Object.keys(sc.opts || {})[0] || 'a' : 'strike', '')}
  ok(CRYPT.group && CRYPT.group.crawl && CRYPT.group.crawl.crew === 1, 'with the Table on it crawls room by room, a crew of one');
  // green: no level keeps it out, it is warned
  a = solo(1); r = act(a, 'go_crypt', {force: 'yes'});
  ok(r.ok && /tried blades/.test(r.warning || ''), 'no level gate, a warning: ' + r.warning);
  // a group inside: it waits at the mouth, and a new order calls that off
  a = solo(12); const bg = S.agents.filter(b => living(b) && b.fac === 0 && b !== a).slice(0, 4), D = await import('../src/sim/dungeon.js');
  D.musterCrypt(bg, 0, null, 'Hollow Cleavers'); CRYPT.group.phase = 'inside'; CRYPT.group.t = 1e6; for (const b of bg) b.hidden = true;
  act(a, 'go_crypt', {force: 'yes'});
  for (let k = 0; k < 60 * 30 && !(CO.companyOf(a).wait && CO.companyOf(a).wait.crypt); k++) {SAFE(); step(1 / 60)}
  ok(CO.companyOf(a).wait && CO.companyOf(a).wait.crypt && a.pq.some(c => c.kind === 'crypt'), 'a group inside: it waits at the mouth, the Crypt held for it');
  act(a, 'rest', {}); step(1 / 60);
  ok(!(CO.companyOf(a).wait && CO.companyOf(a).wait.crypt), 'a new order calls the wait off');
  // join yes: falls in with a gathering group by its own choice
  a = solo(12); const bg2 = S.agents.filter(b => living(b) && b.fac === 0 && b !== a).slice(0, 3); bg2.forEach((b, i) => put(b, CRYPT.x + i * .3, CRYPT.y + 1));
  D.musterCrypt(bg2, 0, null, 'Hollow Cleavers'); CRYPT.group.t = 1e6; const same = CRYPT.group; put(bg2[0], bg2[0].x + 9, bg2[0].y, 'dungeon');
  act(a, 'go_crypt', {join: 'yes', force: 'yes'});
  for (let k = 0; k < 60 * 30 && a.state !== 'dungeon'; k++) {SAFE(); step(1 / 60)}
  ok(CRYPT.group === same && same.mem.includes(a) && a.cryptOk && same.mem.length === 4, 'join yes: it falls in with the gathering group');
  // without join a gathering group steps aside, as for any company
  a = solo(12); const bg3 = S.agents.filter(b => living(b) && b.fac === 0 && b !== a).slice(0, 3);
  D.musterCrypt(bg3, 0, null, 'Hollow Cleavers'); CRYPT.group.t = 1e6; act(a, 'go_crypt', {force: 'yes'});
  for (let k = 0; k < 60 * 30 && a.state !== 'dungeon'; k++) {SAFE(); step(1 / 60)}
  ok(CRYPT.group && CRYPT.group.mem.length === 1 && CRYPT.group.mem[0] === a, 'without join the gathering group gives way to it');
  // the musters leave it out
  a = solo(15); const b0 = a; b0.playEv = []; const f = a.fac; CRYPT.group = null;
  let inPool = 0; for (let k = 0; k < 60 * 120; k++) {if (!(k % 60)) {put(a, a.x, a.y); CRYPT.cd = 0; S.raidT = 0; S.raidOn[f] = false} step(1 / 60); if (a.raid || a.state === 'dungeon') inPool++; if (CRYPT.group && !CRYPT.group.mem.includes(a)) CRYPT.group = null}
  ok(!inPool && !/Stepped back|Turned down/.test(events(a)), 'no muster takes a solo: the guard is never reached');
  // join_raid
  a = solo(15); S.raidOn[a.fac] = false; S.raidT = 1e9; r = act(a, 'join_raid');
  if (!LAIR) {a = solo(15); r = act(a, 'join_raid'); ok(!r.ok && /nothing here to raid/.test(r.error), 'join_raid is refused where no great beast keeps a lair: ' + r.error)} else {
  ok(!r.ok && /read_chronicle/.test(r.error), 'join_raid with no muster out: ' + r.error);
  S.raidOn[a.fac] = true; const bgR = S.agents.filter(b => living(b) && b.fac === a.fac && b !== a).slice(0, 2); bgR.forEach((b, i) => {b.raid = true; b.raidIdx = i; b.state = 'raid'})
  r = act(a, 'join_raid');
  ok(r.ok && a.raid && a.raidOk && a.state === 'raid', 'join_raid falls in with the muster');
  const d0 = dist(a, LAIR); for (let k = 0; k < 120; k++) step(1 / 60);
  ok(a.raid && a.state === 'raid' && dist(a, LAIR) < d0, 'it rides for the lair and stays in the raid');
  }
  // a company of two does not get the solo's orders
  fresh({}); setRunnerLinks(() => 'connected'); const m = CN.leaderOfC(company());
  ok(/propose/.test(act(m, 'go_crypt').error) && /propose/.test(act(m, 'join_raid').error), 'a company member is sent to propose');
}

// ---- D. a reflex-only world keeps the old draft (no host: npm run sim, the seeded checks) ----
section('D. no host: the reflex draft');
{
  fresh({}); T.TABLE.mode = 'off'; const F = company(), M = CO.members(F), f = F.fac; let went = false, P = null;
  for (let k = 0; k < 60 * 300 && !went; k++) {if (!(k % 60)) {fieldCo(F); for (const D of CRYPTS) D.cd = 0} step(1 / 60); P = P || (F.props || []).find(q => q.kind === 'crypt'); went = CRYPTS.some(D => D.group && M.every(a => D.group.mem.includes(a)))}
  ok(went && P && P.src === 'call', 'the company votes by reflex and goes whole: ' + (P && P.details));
}

// ---- E. the seam: a question put to a company by someone in the world ----
section('E. askCompany: src and caller');
{
  fresh({}); setRunnerLinks(() => 'connected'); const F = company(), M = CO.members(F), L = CN.leaderOfC(F); SAFE(); const c = homeOf(L); M.forEach((a, i) => {put(a, c.gate.x + i * .4, c.gate.y + 2); a.playEv = []});
  const P = CN.askCompany(F, 'crypt', {src: 'dm', caller: 'Captain Haldra', details: 'The Crypt has taken another band; will your company go down?'});
  ok(P && P.src === 'dm' && P.caller === 'Captain Haldra' && !P.votes[L.id], 'it opens the proposal with src and caller, the leader\'s vote left to its agent');
  ok(M.every(a => /Captain Haldra asks you/.test(events(a))), 'every member hears who asks');
  const sc = T.sceneFor(F);
  ok(sc && sc.kind === 'decision' && /Captain Haldra/.test(txt(sc.frame)), 'the decision scene names the caller: ' + (sc && txt(sc.frame)));
  ok(CN.cryptReserved(cryptOfCtx(P)), 'the dungeon asked about is reserved as for any open vote');
  ok(typeof CN.askCompany(F, 'job', {}) === 'string', 'only the Crypt or a raid');
}

// ---- F. a world with no others: a company can still raid alone ----
section('F. others none');
{
  fresh({others: 'none'}); setRunnerLinks(() => 'connected'); T.TABLE.mode = 'off'; const F = company(), M = CO.members(F), L = CN.leaderOfC(F), f = F.fac, c = homeOf(L);
  M.forEach((a, i) => {put(a, c.gate.x + i * .4, c.gate.y + 2); a.lvl = 14; a.gear = 12}); S.raidT = 1e9;
  if (!LAIR) {const rx = act(L, 'propose', {kind: 'raid'}); ok(!rx.ok && /nothing here to raid/.test(rx.error), 'no lair, no raid, even for a company alone: ' + rx.error)} else {
  act(L, 'propose', {kind: 'raid'}); const P = F.props.find(q => q.kind === 'raid');
  for (const a of M) if (P.status === 'open' && !P.votes[a.id]) act(a, 'vote', {proposal_id: P.id, vote: 'yes', reason: 'Alone, then.'});
  S.raidT = 0; for (let k = 0; k < 60 * 30 && !S.raidOn[f]; k++) {SAFE(); step(1 / 60)}
  ok(S.raidOn[f] && M.every(a => a.raid), 'five alone at 14 muster on their own vote');
  }
  fresh({others: 'none'}); setRunnerLinks(() => 'connected'); const G = company(), N = CO.members(G); for (const a of N) a.lvl = 15;
  for (let k = 0; k < 60 * 120; k++) {if (!(k % 60)) {CRYPT.cd = 0; S.raidT = 0} step(1 / 60)}
  ok(!(G.props || []).some(q => q.kind === 'crypt' || q.kind === 'raid'), 'and nothing asks them to');
}

// ---- G. the words ----
section('G. the words');
{
  const row = n => PLAYER_TOOLS.find(t => t.name === n);
  ok(/go down into a dungeon together/.test(row('propose').desc) && /muster the company against Kragmaw/.test(row('propose').desc), 'propose reads as the company\'s own choice');
  ok(!/answer a call|raid muster/.test(row('propose').desc) && /someone in the world asked/.test(row('propose').desc), 'and does not rule out being asked');
  ok(row('go_crypt') && row('join_raid'), 'the solo\'s orders are tools');
}

setRunnerLinks(null); setReflexAck(null);
// every other world in the table, in a child each (scripts/worlds.mjs); a run with ELDMOOR_WORLD set is one of those
if (!process.env.ELDMOOR_WORLD) { const {runWorlds} = await import('./worlds.mjs'); fail += runWorlds('initiatecheck'); }
if (fail) {console.error('\ninitiatecheck: ' + fail + ' failure(s)'); process.exit(1)}
console.log('\ninitiatecheck: all checks passed');
process.exit(0);
