// Company check, part two (issue #459, epic #402 slice 22): the apart world end to end. Every section builds a fresh
// world from one seeded New World setup in apart mode (init() resets fully since #507): two pairs and a solo of the
// Concord at Highgate plus a Warband solo at Grimhold, every hero agent-played from the first tick. Then:
//   A  setup v2 apart: the companies, their towns and levels, the runner plan, the same seed builds the same world
//   B  finding each other (#446): a sighting at the gate, a notice on the board, a courier by name once met
//   C  grouping (#442/#443/#444/#500/#516): invite refused out of range, accepted in range (one-sided: no vote), merge
//      toward a solo points at invite, a merge of two companies with a decision scene in each, expel with the target
//      speaking but not voting, leave_party for good
//   D  follow (#445): a solo walks at a company's side without joining; a save keeps it
//   E  the Crypt and the raid per company (#441, no level gate #449/#538): a green pair's crypt proposal warns but is
//      never refused, the draft takes the company whole, only its members sit at the crawl's table; a raid call
//      reserves the company's faction
//   F  the DM per company (#450/#451): one focus per company with the followed one first, a hall job on each company's
//      board, companies_needs, fairness rows, a staged pull for one company
//   G  scenes (#440, #518): two companies due at once each open their own scene, members and foes held (the engaged
//      hold), each resolving on its own; a solo camp and its ambush scene, a
//      death refilled by an arrival scene with the letter, a solo's heir at home with its opening
//   H  save mid-everything and restore: an offer, a follow, a notice and a sighting, a courier on the road, a queued
//      arrival and an open scene all stand
//   I  determinism: the seeded no-company world hashes the same before and after all of the above (init leaves nothing
//      behind); COMPANY_BASELINE_HASH=<hash> asserts it equals a baseline (node scripts/companycheck-apart.mjs --hash prints it)
// Usage: npm run companycheck (runs part one, scripts/companycheck.mjs, then this); alone: node scripts/companycheck-apart.mjs
let seed = 0x5eed459;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const {init, step, S, snapshot, restore, markPlayer, playerAct, applyPreset, defaultSetup, cleanSetup, validateSetup, planRunners, setRunnerLinks, setDmSeat, dmAct} = SIM;
const CO = await import('../src/sim/company.js'), OF = await import('../src/sim/offers.js'), CN = await import('../src/sim/council.js');
const T = await import('../src/sim/table.js'), SG = await import('../src/sim/sightings.js'), FW = await import('../src/sim/follow.js');
const SC = await import('../src/sim/scenes.js'), FO = await import('../src/sim/dmfocus.js'), AR = await import('../src/sim/arrival.js'), CP = await import('../src/sim/camp.js'), HE = await import('../src/sim/heroes.js');
const {homeOf} = await import('../src/data/races.js');
const {CITY, CRYPT, dist} = await import('../src/world/map.js');
const {rebuild} = await import('../src/sim/spatial.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => {a.playRate = []; return playerAct(a.id, tool, args || {})};
const living = a => !!a && a.state !== 'dead';
const byId = id => S.agents.find(b => b.id === id);
const section = t => console.log('\n' + t);
const sf = C => T.sceneFor(C); // a company's own open scene (#518: several may be open at once)
// every hero of L answers its own open scene with option k until none of them sits at one
const playOut = (L, k, line, max = 60 * 60) => {for (let g = 0; g < max; g++) {let any = false;
  for (const a of L) {const sc = SC.sceneOf(a); if (!sc) continue; any = true; if (sc.phase !== 'frame' && !sc.resolved && !sc.acts[a.id]) act(a, 'scene_act', {option: k, ...(line ? {line} : {})})}
  if (!any) return; step(1 / 60)}};
const txt = ps => (ps || []).map(p => typeof p === 'string' ? p : p && (p.t || p.name) || '').join('');

// ---- the setup: two pairs and a solo of the Concord, and a Warband solo at Grimhold (local minds: six seats fit) ----
const LOCAL = {mode: 'agent', provider: 'ollama', model: 'qwen2.5:14b'};
const SETUP = (() => {const s = applyPreset('pairs-and-solo', defaultSetup(4590, 'eldmoor', 0));
  for (const h of s.heroes) h.mind = {...LOCAL};
  s.heroes.push({cls: 'Mage', fac: 1, mind: {...LOCAL}, start: {town: 'Grimhold'}});
  return cleanSetup(s)})();
// the world's hash (as crawlcheck's): levels, xp, places, hp, deaths, gold
const worldHash = () => {let h = Math.round(S.gameMin); for (const a of S.agents) h = (Math.imul(h, 31) + a.lvl * 1000 + Math.round(a.xp) + Math.round(a.x * 10) * 7 + Math.round(a.hp) + a.deaths * 13 + Math.round(a.gold)) | 0; return h};
const plainHash = () => {seed = 0x5eed459; init({fellowship: false}); run(240); return worldHash()};
// a fresh apart world: links off (no host, like npm run sim) unless a section turns them on; the table auto at 1x
function apart() {
  setRunnerLinks(null); setDmSeat(false); T.TABLE.mode = 'auto'; T.TABLE.speed = 1; T.TABLE.drop = null;
  init({setup: SETUP}); delete S.opening; // the session-zero openings need a host; sections that test them plan their own
  const Cs = CO.companies(), by = n => Cs.filter(C => C.ids.length === n);
  const [P1, P2] = by(2), solos = by(1), SoloC = solos.find(C => C.fac === 0), SoloW = solos.find(C => C.fac === 1);
  return {Cs, P1, P2, SoloC, SoloW, solo: CO.members(SoloC)[0], wsolo: CO.members(SoloW)[0]};
}
// put a hero somewhere quiet, out of any routine
const put = (a, x, y, state = 'hunt') => {a.x = x; a.y = y; a.state = state; a.dest = null; a.target = null; a.hidden = false; a.pq = []; rebuild()};

// ---- I (first half): the seeded no-company world, before any apart world was built ----
const H0 = plainHash();
if (process.argv[2] === '--hash') {console.log('HASH ' + H0); process.exit(0)}

// ---- A. setup v2 apart ----
section('A. setup v2 apart: pairs, solos, two towns');
{
  ok(validateSetup(SETUP).length === 0 && SETUP.mode === 'apart', 'the apart setup validates: ' + validateSetup(SETUP).join(' | '));
  const W = apart(), hi = CITY.find(c => c.fac === 0), gr = CITY.find(c => c.fac === 1);
  ok(W.Cs.length === 4 && W.Cs.map(C => C.ids.length).join() === '2,2,1,1', 'four companies: two pairs and two solos (' + W.Cs.map(C => C.ids.length) + ')');
  ok(!SLT.slotted() && W.Cs.every(C => !C.slots), 'no five-place Fellowship');
  ok(S.agents.filter(a => a.player).length === 6 && W.Cs.every(C => CO.members(C).every(a => a.player && a.lvl === 1)), 'six heroes, agent-played from the first tick, level 1');
  ok(W.SoloC.hall === hi.name && W.SoloW.hall === gr.name && dist(W.solo, hi.gate) < 12 && dist(W.wsolo, gr.gate) < 12, 'two solos founded apart in two towns: ' + W.solo.name + ' at ' + W.SoloC.hall + ', ' + W.wsolo.name + ' at ' + W.SoloW.hall);
  ok(W.Cs.every(C => CO.members(C).every(a => a.fac === C.fac)), 'each company is of one faction; the world holds both');
  ok(S.followId === W.Cs[0].id, 'the first company is followed');
  const plan = planRunners(SETUP), co = plan.filter(p => p.kind === 'company'), he = plan.filter(p => p.kind === 'hero');
  ok(co.length === 2 && he.length === 2, 'the runner plan: one company runner per pair, a hero runner per solo (' + plan.map(p => p.kind).join(',') + ')');
  const sig = () => JSON.stringify(CO.companies().map(C => [C.name, C.hall, CO.members(C).map(a => [a.name, a.cls, a.x.toFixed(2)])]));
  const s1 = sig(); apart(); ok(sig() === s1, 'the same seed builds the same apart world');
  const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
  ok(sig() === s1 && CO.companies().length === 4, 'a save of the apart world restores its companies');
}

// ---- B. finding each other: sightings, notices, a courier by name ----
section('B. finding each other (#446)');
{
  const W = apart(), hi = homeOf(W.solo), g = hi.gate, [p1a, p1b] = CO.members(W.P1);
  for (const a of [W.solo, p1a, p1b]) {put(a, g.x, g.y, 'town'); a.townStep = 2; a.gold = 200; a.town = hi.name}
  let r = act(W.solo, 'post_notice', {text: 'A Rogue seeks a company for the road east; ask for ' + W.solo.name + ' at the inn.'});
  ok(r.ok, 'the solo pins a notice on the board in ' + hi.name);
  r = act(p1a, 'list_jobs');
  ok(r.ok && (r.notices || []).some(n => n.from.includes(W.solo.name)), 'a pair member at the board reads it, by name and town');
  r = act(W.wsolo, 'list_jobs');
  ok(!(r.notices || []).some(n => n.from && n.from.includes(W.solo.name)), 'the Warband solo at Grimhold does not');
  act(W.solo, 'move_to', {target: 'east'});
  ok((S.sightings || []).some(s => s.hero === W.solo.id && s.town === hi.name), 'the solo leaving the gate leaves a sighting');
  r = act(p1b, 'list_jobs');
  ok(r.ok && (r.sightings || []).some(t => t.includes(W.solo.name)), 'the gate tells the pair which way the solo went: ' + (r.sightings || [])[0]);
  r = act(p1a, 'send_courier', {to: W.solo.name, text: 'Wait for us at the ford.'});
  ok(!r.ok && /never met/.test(r.error), 'a courier to a hero never met is refused: ' + r.error);
  // they meet: a word in earshot each way
  put(W.solo, g.x + 1, g.y, 'town');
  ok(act(W.solo, 'say', {text: 'Well met. I am ' + W.solo.name + ', bound east.'}).ok && act(p1a, 'say', {text: 'And I am ' + p1a.name + '. We ride east too.'}).ok, 'they speak in earshot');
  run(1);
  put(W.solo, g.x + 40, g.y + 10); put(p1a, g.x, g.y, 'town');
  r = act(p1a, 'send_courier', {to: W.solo.name, text: 'Wait for us at the ford.'});
  ok(r.ok, 'once met, a courier goes by name: ' + JSON.stringify(r).slice(0, 120));
  const post = (W.P1.post || [])[0];
  ok(post && post.to === W.solo.id, 'the courier rides for the solo, paid by the pair');
  let k = 0; while (k++ < 60 && !(W.solo.playEv || []).some(e => /courier finds you/.test(e.text))) {S.gameMin += 30; run(1); put(W.solo, g.x + 40, g.y + 10)}
  ok((W.solo.playEv || []).some(e => /courier finds you with word from/.test(e.text)), 'the courier finds the solo out on the road');
}

// ---- C. grouping: invite, merge with both companies' scenes, expel, leave for good ----
section('C. grouping (#442/#443/#444/#500/#516)');
{
  const W = apart(), g = homeOf(W.solo).gate, sp = {x: g.x + 4, y: g.y + 8};
  const LINK = {}; setRunnerLinks(x => LINK[x.id] || 'none');
  const [p1a, p1b] = CO.members(W.P1), [p2a, p2b] = CO.members(W.P2);
  for (const a of [p1a, p1b, p2a, p2b, W.solo]) {LINK[a.id] = 'connected'; a.partyOk = true}
  const here = () => {[p1a, p1b].forEach((a, i) => put(a, sp.x + i, sp.y)); [p2a, p2b].forEach((a, i) => put(a, sp.x + 3 + i, sp.y + 1))};
  here(); put(W.solo, sp.x + 30, sp.y);
  const lead1 = CN.leaderOfC(W.P1);
  let r = act(lead1, 'invite', {hero_id: W.solo.id});
  ok(!r.ok && /too far/.test(r.error), 'an invite out of range is refused: ' + r.error);
  r = act(lead1, 'propose', {kind: 'merge', company: W.solo.name});
  ok(!r.ok && /rides alone/.test(r.error), 'a merge toward a solo is refused (a solo is invited): ' + r.error);
  put(W.solo, sp.x + 1, sp.y + 1);
  r = act(lead1, 'invite', {hero_id: W.solo.id, text: 'Ride with us east, ' + W.solo.name + '.'});
  ok(r.ok && r.offer, 'in range the pair\'s leader invites the solo, aloud');
  ok(!CN.openProps(W.P1).length && !sf(W.P1), 'an invite is no vote: the other member is not asked');
  r = act(W.solo, 'accept', {offer_id: r.offer});
  ok(r.ok && CO.companyOf(W.solo) === W.P1 && W.P1.ids.length === 3 && !S.companies.includes(W.SoloC), 'the solo accepts alone (one-sided): a company of three, the solo company gone');
  // merge: a decision scene in each company, the proposer's now, the other's queued; both pass
  for (const a of [p1a, p1b, W.solo, p2a, p2b]) for (const b of [p1a, p1b, W.solo, p2a, p2b]) if (a !== b) (a.bonds || (a.bonds = {}))[b.id] = 2;
  here(); put(W.solo, sp.x + 2, sp.y);
  r = act(lead1, 'propose', {kind: 'merge', company: p2a.name, text: 'Five ride safer than three.'});
  ok(r.ok, 'the company of three proposes a merge with the pair');
  const PX = W.P1.props.find(P => P.kind === 'merge' && P.status === 'open'), PY = W.P2.props.find(P => P.kind === 'merge' && P.status === 'open');
  ok(PX && PY && PX.pair === PY.id, 'a paired proposal sits in each company');
  const sX = sf(W.P1), sY = sf(W.P2);
  ok(sX && sX.kind === 'decision' && sX.ctx.prop === PX.id && sY && sY.kind === 'decision' && sY.ctx.prop === PY.id && !W.P2.tableQ, 'a decision scene opens in each company at once, each keyed by its own proposal (#518)');
  const answer = (L, k) => playOut(L, k);
  answer([p1a, p1b, W.solo], 'yes');
  answer([p2a, p2b], 'yes'); run(2);
  const M = CO.companyOf(p1a);
  ok(M && CO.companyOf(p2a) === M && M.ids.length === 5 && PX.status === 'passed' && PY.status === 'passed', 'both passed: one company of five (' + (M && M.name) + ')');
  ok(M.log.some(e => e.kind === 'merge'), 'the merged company\'s log has the merge line');
  // expel: the target speaks but does not vote
  for (const a of CO.members(M)) if (a !== W.solo) {a.bonds[W.solo.id] = -4}
  here(); put(W.solo, sp.x + 2, sp.y);
  const ld = CN.leaderOfC(M);
  r = act(ld, 'propose', {kind: 'expel', hero_id: W.solo.name, text: 'The rogue keeps our purse light.'});
  ok(r.ok, 'the leader proposes to expel ' + W.solo.name);
  const PE = M.props.find(P => P.kind === 'expel' && P.status === 'open');
  ok(PE && !CN.voters(PE).includes(W.solo), 'the target is no voter');
  ok(!SC.sceneOf(W.solo), 'and has no seat at the decision scene');
  r = act(W.solo, 'vote', {proposal_id: PE.id, vote: 'no', reason: 'I paid my share.'});
  ok(!r.ok && /do not vote/.test(r.error), 'the target\'s vote is refused: ' + r.error);
  r = act(W.solo, 'party_say', {text: 'I paid my share, every coin of it.'});
  ok(r.ok && CO.members(M).some(b => b !== W.solo && (b.chat || []).some(e => /every coin/.test(e.text))), 'the target speaks for itself and is heard');
  answer(CO.members(M).filter(a => a !== W.solo), 'yes'); run(2);
  ok(PE.status === 'passed' && CO.isSolo(CO.companyOf(W.solo)) && M.ids.length === 4, 'expelled: ' + W.solo.name + ' rides alone, four ride on');
  // leave for good
  const lv = CO.members(M).find(a => a !== CN.leaderOfC(M));
  here(); for (const a of CO.members(M)) {a.state = 'hunt'; a.target = null} // out of any fight the run gave them
  r = act(lv, 'leave_party', {for_good: true});
  ok(r.ok && CO.isSolo(CO.companyOf(lv)) && M.ids.length === 3 && M.log.some(e => e.kind === 'leave'), lv.name + ' leaves for good: a new solo, three ride on');
  ok(CO.companies().every(C => C.ids.length), 'no empty company is left behind');
}

// ---- D. follow: a solo walks at a pair's side without joining ----
section('D. follow (#445)');
{
  const W = apart(), g = homeOf(W.solo).gate, sp = {x: g.x + 4, y: g.y + 6};
  const [p1a, p1b] = CO.members(W.P1), lead = CN.leaderOfC(W.P1);
  for (const a of [p1a, p1b, W.solo]) {HE.seedLevel(a, 10); a.hp = HE.maxHp(a); a.partyOk = true}
  put(p1a, sp.x, sp.y); put(p1b, sp.x + 1, sp.y); put(W.solo, sp.x + 2, sp.y + 1); run(1);
  put(W.solo, sp.x + 2, sp.y + 1);
  let r = act(W.solo, 'follow', {name: lead.name});
  ok(r.ok && r.following === lead.name && W.solo.pq[0] && W.solo.pq[0].kind === 'follow', 'the solo follows the pair\'s leader by name');
  ok(lead.playEv.some(e => e.text === W.solo.name + ' falls in behind you.'), 'the leader is told');
  W.solo.playActAt = S.gameMin - 1000; // no order for hours: autopilot keeps the follow
  act(lead, 'move_to', {target: Math.round(sp.x + 14) + ',' + Math.round(sp.y + 6), force: 'yes'});
  let cps = 0, lost = 0;
  for (let i = 0; i < 60 * 20; i++) {step(1 / 60); lead.playActAt = S.gameMin; if (i % 10 === 0) {cps++; if (!FW.seesHero(W.solo, lead)) lost++}}
  ok(living(W.solo) && lost / cps < .1, 'the follower keeps the leader in sight (' + lost + '/' + cps + ' checkpoints out of sight)');
  ok(CO.isSolo(CO.companyOf(W.solo)) && W.P1.ids.length === 2 && !CN.openProps(W.P1).length, 'it joined no company and calls no vote');
  restore(JSON.parse(JSON.stringify(snapshot())));
  const s2 = byId(W.solo.id);
  ok(FW.followCmd(s2) && s2.playOrder && s2.playOrder.kind === 'follow', 'a save keeps the follow');
}

// ---- E. the Crypt and the raid per company, no level gate ----
section('E. crypt and raid draft per company (#441, #449/#538)');
{
  const W = apart(), LINK = {}; setRunnerLinks(x => LINK[x.id] || 'none');
  const P = CO.members(W.P1);
  for (const a of P) LINK[a.id] = 'connected';
  if (CRYPT.group) {for (const a of CRYPT.group.mem) {a.state = 'hunt'; a.hidden = false} CRYPT.group = null}
  CRYPT.cd = 1e9; // no background group forms while the company's call is tested
  for (const m of S.mobs) if (m.alive && dist(m, CRYPT) < 14) {m.alive = false; m.gone = true}
  P.forEach((a, i) => {put(a, CRYPT.x + i * .6, CRYPT.y + 1.2); a.partyOk = true}); run(1); P.forEach((a, i) => put(a, CRYPT.x + i * .6, CRYPT.y + 1.2));
  ok(P.every(a => a.lvl < 5), 'the pair is green (levels ' + P.map(a => a.lvl) + ')');
  const ld = CN.leaderOfC(W.P1);
  let r = act(ld, 'propose', {kind: 'crypt'});
  const PC = W.P1.props.find(q => q.kind === 'crypt');
  ok(r.ok && PC, 'a green company\'s crypt proposal is never refused for level');
  ok(PC && /Crypt\. Those who went below were tried blades; you are not\./.test(PC.details), 'the proposal everyone hears carries the warning: ' + (PC && PC.details));
  ok(!W.P2.props || !W.P2.props.some(q => q.kind === 'crypt'), 'the other pair hears nothing of it');
  {let g2 = 0; while (g2++ < 60 * 40 && PC.status === 'open') {const sc = sf(W.P1); if (sc && sc.phase !== 'frame') for (const a of P) if (sc.ids.includes(a.id) && !sc.acts[a.id]) act(a, 'scene_act', {option: 'yes'}); step(1 / 60)}}
  ok(PC.status === 'passed', 'the company votes to go: ' + PC.result);
  const G = CRYPT.group;
  ok(G && G.mem.length === P.length && P.every(a => G.mem.includes(a)) && G.name === W.P1.name, 'the passed call drafts the whole company, whatever its level (' + (G && G.mem.map(a => a.name)) + ')');
  // seasoned for the descent so the crawl can be watched; the draft above was made green
  for (const a of P) {HE.seedLevel(a, 9); a.hp = HE.maxHp(a)}
  const seen = []; let last = null, went = false;
  for (let f = 0; f < 900 * 60 && (CRYPT.group || !went); f++) {
    step(1 / 60); if (CRYPT.group && CRYPT.group.crawl) went = true;
    const sc = sf(W.P1);
    if (sc && sc.kind === 'crawl' && sc.id !== last) {last = sc.id; seen.push(sc.ids.slice())}
    if (sc && sc.kind === 'crawl' && (sc.phase === 'frame' || sc.phase === 'turn')) for (const id of sc.ids) {const a = byId(id); if (living(a) && !sc.acts[id]) T.sceneAct(a, 'strike', 'test')}
  }
  ok(went && seen.length >= 1 && seen.every(ids => ids.every(id => W.P1.ids.includes(id) || P.some(a => a.id === id))), 'the crawl goes room by room at the table, only the company seated (' + seen.length + ' scenes)');
  ok(W.P1.crawl && W.P1.crawl.runs === 1 && !(W.P2.crawl && W.P2.crawl.runs), 'the tally sits on that company alone: ' + JSON.stringify(W.P1.crawl));
  // the raid: a passed call reserves the muster for the company's faction and marks its members
  const Q = CO.members(W.P2); for (const a of Q) LINK[a.id] = 'connected';
  Q.forEach((a, i) => put(a, homeOf(a).gate.x + 3 + i, homeOf(a).gate.y + 3)); S.raidT = 1e9;
  r = act(CN.leaderOfC(W.P2), 'propose', {kind: 'raid', details: 'We ride on Kragmaw'});
  const PR = W.P2.props.find(q => q.kind === 'raid');
  ok(r.ok && PR && /^We ride on Kragmaw\. Those who went to the lair .*you are not\.$/.test(PR.details), 'a green raid call is warned, not refused: ' + (PR && PR.details));
  {let g2 = 0; while (g2++ < 60 * 40 && PR.status === 'open') {const sc = sf(W.P2); if (sc && sc.phase !== 'frame') for (const a of Q) if (sc.ids.includes(a.id) && !sc.acts[a.id]) act(a, 'scene_act', {option: 'yes'}); step(1 / 60)}}
  ok(PR.status === 'passed' && CN.raidReserve() === W.P2.fac && Q.every(a => a.raidOk), 'passed: the raid muster is held for the company (faction ' + CN.raidReserve() + ')');
  // the draft never takes a company piecemeal
  const pool = S.agents.filter(a => living(a) && a.fac === 0 && !a.hidden && ['hunt', 'travel', 'town', 'return'].includes(a.state));
  Q.forEach((a, i) => put(a, CRYPT.x + i * .5, CRYPT.y + 2)); (W.P2.accept || (W.P2.accept = {})).crypt = S.gameMin + 60; // a call it already accepted
  const others = pool.filter(a => !Q.includes(a) && !CO.companyOf(a)).slice(0, 6);
  const draft = CN.unitDraft([others[0], Q[0], ...others.slice(1)], others.concat(Q), 5, 'crypt');
  ok(Q.every(a => draft.includes(a)) && draft.length === 5 && draft.filter(a => !Q.includes(a)).every(a => !CO.companyOf(a)), 'a background draft that reaches one member takes the whole pair, filled up with background heroes (' + draft.map(a => a.name) + ')');
  ok(!draft.some(a => CO.companyOf(a) && CO.companyOf(a) !== W.P2), 'no other company is taken piecemeal');
}

// ---- F. the DM per company: focuses, hall jobs, needs, fairness, a staged pull ----
section('F. the DM per company (#450/#451)');
{
  const W = apart(); run(1);
  const DM = await import('../src/sim/dm.js');
  const fs = FO.focuses();
  ok(fs.length === 4 && fs[0].cid === S.followId, 'one focus per company (' + fs.map(f => f.cid) + ')');
  S.followId = W.SoloW.id;
  ok(FO.focuses()[0].cid === W.SoloW.id && FO.focuses().slice(1).map(f => f.cid).join() === W.Cs.filter(C => C !== W.SoloW).map(C => C.id).join(), 'following the Warband solo puts it first, the rest in id order');
  S.followId = W.Cs[0].id;
  // green companies get no hall job (nothing on a board fits them); seasoned ones each get their own, on their own hall's board
  for (const C of W.Cs) for (const a of CO.members(C)) {const c = CITY.find(t => t.name === C.hall); a.adv = null; put(a, c.gate.x, c.gate.y, 'town')}
  S.adventures = (S.adventures || []).filter(h => h.phase !== 'open'); S.dmHookT = 0; DM.dmTick(1);
  ok(!(S.adventures || []).some(h => h.phase === 'open' && h.ff), 'level 1 companies get no hall job (#450: nothing fits them yet)');
  for (const C of W.Cs) for (const a of CO.members(C)) {HE.seedLevel(a, 6); a.hp = HE.maxHp(a)}
  S.adventures = (S.adventures || []).filter(h => h.phase !== 'open'); S.dmHookT = 0; DM.dmTick(1);
  const jobs = C => (S.adventures || []).filter(h => h.phase === 'open' && h.ff && h.cid === C.id);
  ok(W.Cs.every(C => jobs(C).length === 1 && jobs(C)[0].town === C.hall), 'each company gets one hall job on its own hall\'s board, three sharing Highgate (' + W.Cs.map(C => jobs(C).length + '@' + C.hall) + ')');
  ok(W.Cs.every(C => FO.hallBoard(C).length >= 1 && FO.hallBoard(C).every(j => {const h = S.adventures.find(x => x.id === j.id) || {}; return !h.ff || h.cid === C.id})), 'each company\'s board view lists its own job and no other company\'s');
  ok(W.Cs.every(C => DM.fitsJob(jobs(C)[0], CO.members(C)[0])) && !DM.fitsJob(jobs(W.P1)[0], CO.members(W.P2)[0]), 'a company\'s hall job fits its members, not another company\'s');
  setDmSeat(true);
  const st = dmAct('dm_status'), needs = st.companies_needs || [];
  ok(needs.length === 4 && W.Cs.every(C => needs.some(n => n.id === C.id)) && needs.every(n => n.why), 'dm_status lists every company\'s needs with a reason (' + needs.map(n => n.id + ':' + n.why).join('; ') + ')');
  const fr = FO.fairness();
  ok(fr.rows.length === 4 && W.Cs.every(C => fr.rows.some(r => r.cid === C.id)), 'fairness keeps a row per company');
  // a staged scene for the Warband solo, out in the field
  const zs = homeOf(W.wsolo).gate; put(W.wsolo, zs.x + 5, zs.y + 5);
  const sr = dmAct('stage_scene', {kind: 'mystery', near: 'company:' + W.SoloW.id, frame: 'A cairn of white stones stands where none stood yesterday.', cast: {reveal: 'An old boundary mark, newly raised.'}, reason: 'the lone mage has had nothing yet'});
  ok(sr.ok && S.staged && S.staged.cur && S.staged.cur.company === W.SoloW.id, 'a staged scene can be aimed at one company (company:' + W.SoloW.id + '): ' + (sr.error || 'staged'));
  setDmSeat(false); if (S.staged && S.staged.cur) S.staged.cur.phase = 'done';
  // a game day of the scripted DM: every company is served, none starved
  run(240);
  const by = (S.dmFocus || {}).by || {};
  ok(W.Cs.filter(C => C.ids.length).every(C => by[C.id] >= 1), 'over a game day the scripted DM acts for every company (' + JSON.stringify(by) + ')');
  ok(FO.share() >= .6 && !FO.fairness().starved.length, 'its share for the companies stays high (' + FO.focusStats().share + ') and no company is starved');
}

// ---- G. scenes: two due at once, a solo camp and its ambush, an arrival, a solo's heir ----
section('G. scenes per company (#440/#518/#452/#528)');
{
  const W = apart(), LINK = {}; setRunnerLinks(x => LINK[x.id] || 'none');
  CRYPT.cd = 1e9; S.raidT = 1e9;
  for (const C of W.Cs) for (const a of CO.members(C)) {HE.seedLevel(a, 8); a.hp = HE.maxHp(a); LINK[a.id] = 'connected'}
  const g = homeOf(W.solo).gate, sp = {x: g.x + 6, y: g.y + 10};
  for (const m of S.mobs) if (m.alive && dist(m, sp) < 22) {m.alive = false; m.gone = true}
  const beast = () => {const m = S.mobs.find(q => q.alive && !q.gone && !q.elite && !q.used); m.used = true; m.maxhp = m.hp = 4000; m.cd = 99; m.hit = .001; m.fledOnce = true; m.eff = {}; m.ab = []; return m};
  const fightAt = (a, m, dx) => {put(a, sp.x + dx, sp.y); a.state = 'fight'; a.target = m; m.target = a; m.x = a.x + 1; m.y = a.y; a.hp = Math.round(HE.maxHp(a) * .2); a.eff = {}; a.mcr = {}};
  const close = () => {T.TABLE.mode = 'off'; T.tableHold(0); T.TABLE.mode = 'auto'};
  const [q1] = CO.members(W.P2);
  // two companies due in one tick, neither of them followed: each opens its own scene at once on the live clock, its
  // members and foe held (the engaged hold, #518), and each resolves on its own
  S.followId = W.P1.id;
  const m1 = beast(), m2 = beast(); fightAt(W.solo, m1, 0); fightAt(q1, m2, 4);
  T.tableTick();
  const sA = sf(W.P2), sB = sf(W.SoloC);
  ok(sA && sA.kind === 'rescue' && sB && sB.kind === 'rescue' && sA !== sB && !W.SoloC.tableQ, "two rescues due at once: both companies' scenes open in the same tick");
  ok(sB.ids.join() === String(W.solo.id) && sB.foeAt != null, "the solo's rescue has its foe in the order");
  ok(!T.stopsWorld(sA) && !T.stopsWorld(sB), "neither is the followed company's: both play on the live clock");
  step(1 / 60); const t0 = S.gameMin, at = [W.solo.x, W.solo.y, q1.x, q1.y, m1.x, m1.y, m2.x, m2.y].join(), hp1 = m1.hp;
  ok([W.solo, q1, m1, m2].every(e => SC.held(e)) && !CO.members(W.P1).some(e => SC.held(e)), "the engaged hold: both scenes' members and foes are held, nobody else");
  for (let i = 0; i < 30; i++) step(1 / 60);
  ok(S.gameMin > t0 && [W.solo.x, W.solo.y, q1.x, q1.y, m1.x, m1.y, m2.x, m2.y].join() === at && m1.hp === hp1, 'the world clock runs while the held stand still (no move, no blow)');
  {let k = 0; while (sf(W.SoloC) === sB && k++ < 60 * 30) {if (sB.phase === 'turn' && !sB.acts[W.solo.id]) act(W.solo, 'scene_act', {option: 'strike', line: 'Not today.'}); step(1 / 60)}}
  ok(!sf(W.SoloC) && sf(W.P2) === sA, "the solo's scene resolves on its own; the pair's stays open");
  ok(sB.beats.some(b => b.by === 'foe') && sB.beats.some(b => b.id === W.solo.id && b.by === 'agent'), "the solo's rescue rolled the foe's round too (" + sB.beats.map(b => b.name + '=' + b.k).join(', ') + ')');
  ok(!SC.held(W.solo) && SC.held(q1), 'released from the hold when its own scene ends, the other still held');
  playOut(CO.members(W.P2), 'strike');
  ok(!sf(W.P2) && !SC.held(q1) && sA.beats.some(b => b.id === q1.id), "the pair's scene resolves in its turn");
  close(); for (const a of [W.solo, q1]) {a.state = 'hunt'; a.target = null; a.hp = HE.maxHp(a)} m1.alive = m2.alive = false; m1.gone = m2.gone = true;
  // a solo camp, and its ambush (the camp's roll forced): the scene is the solo's own
  put(W.solo, sp.x, sp.y); W.solo.hp = Math.round(HE.maxHp(W.solo) * .6);
  let r = act(W.solo, 'rest', {hours: 4});
  {let k = 0; while (k++ < 60 * 10 && !(W.SoloC.camp && W.SoloC.camp.phase === 'rest')) step(1 / 60)}
  const camp = W.SoloC.camp;
  ok(r.ok && camp && camp.solo && camp.phase === 'rest' && W.solo.state === 'camp', 'the solo makes camp alone when its agent calls it: ' + (r.error || r.note || 'camped'));
  const P0 = CP.CAMP.AMBUSH_P; CP.CAMP.AMBUSH_P = 1;
  const foesAway = () => {for (const b of S.agents) if (b.kind === 'hero' && b.fac !== W.solo.fac && living(b) && dist(b, W.solo) < 24) {b.x = W.solo.x + (b.x < W.solo.x ? -30 : 30); b.target = null; if (b.state === 'duel') b.state = 'hunt'}}; // a creature comes, not a Warband blade
  {let k = 0; while (k++ < 60 * 60 && !(sf(W.SoloC) && sf(W.SoloC).kind === 'ambush')) {foesAway(); step(1 / 60)}}
  CP.CAMP.AMBUSH_P = P0;
  {const amb = sf(W.SoloC); ok(amb && amb.kind === 'ambush' && /lone camp/.test(txt(amb.frame)), "the ambush at the lone camp opens the solo's own scene: " + (amb && amb.title))}
  ok(!(W.SoloC.camp && W.SoloC.camp.phase) && W.SoloC.log.some(e => e.kind === 'camp'), 'the camp is broken and its log kept');
  playOut([W.solo], 'retreat');
  close(); for (const m of S.mobs) if (m.alive && dist(m, W.solo) < 10) {m.alive = false; m.gone = true}
  // a death refilled by an arrival: the pair's member falls, a letter waits, the recruit arrives in town at the table
  const [d1, d2] = CO.members(W.P1);
  const wr = act(d1, 'remember', {title: 'For whoever comes', text: 'Keep the river road and the priest close.', tags: ['letter']});
  ok(wr.ok && act(d1, 'pin', {id: wr.remembered.id}).ok, d1.name + ' seals a letter for the company');
  for (const a of [d1, d2]) put(a, sp.x + 10, sp.y);
  HE.fall(d1, 'a test of the hardcore rule'); step(1 / 60);
  ok((W.P1.arrivals || []).length === 1 && W.P1.arrivals[0].cls === d1.cls && W.P1.ids.length === 1, 'the fallen member\'s seat waits for an arrival (' + d1.cls + ')');
  run(1); ok(!sf(W.P1), 'no arrival out on the road');
  const hg = homeOf(d2).gate; put(d2, hg.x, hg.y, 'town'); d2.townStep = 1;
  {let k = 0; while (k++ < 60 * 20 && !(sf(W.P1) && sf(W.P1).kind === 'arrival')) {step(1 / 60); if (d2.state !== 'town') put(d2, hg.x, hg.y, 'town')}}
  const asc = sf(W.P1), nh = W.P1.ids.map(byId).find(a => a && a !== d2);
  ok(asc && asc.kind === 'arrival' && asc.company === W.P1.id && nh && !asc.ids.includes(nh.id), 'in town the pair\'s arrival scene opens; the newcomer is voiced, not seated');
  ok(nh && nh.cls === d1.cls && nh.lvl === Math.max(1, d2.lvl - 2) && nh.player && nh.succeeds === d1.id, 'the recruit: same class, two under the lowest (L' + (nh && nh.lvl) + '), agent-played, succeeds the fallen');
  playOut([d2], 'greet', 'Sit. Eat. Then we talk.');
  ok(W.P1.log.some(e => e.kind === 'recruit'), 'the oath is sworn at the table');
  const lt = nh && act(nh, 'recall', {tag: 'letter'});
  ok(lt && lt.ok && lt.notes.some(n => /river road/.test(n.text)), 'the fallen member\'s letter reaches the newcomer');
  // the solo's heir: a live solo falls; the heir starts at home at level 1, a company of one, with its own opening
  const sw = act(W.solo, 'remember', {title: 'To my heir', text: 'The cairn by the ford hides a key.', tags: ['letter']});
  act(W.solo, 'pin', {id: sw.remembered.id});
  put(W.solo, sp.x + 12, sp.y + 4); const fallenName = W.solo.name;
  HE.fall(W.solo, 'a test of the solo\'s fate'); step(1 / 60);
  const heir = S.agents.find(a => a.succeeds === W.solo.id && living(a));
  ok(heir && heir.lvl === 1 && heir.player && heir.cls === W.solo.cls && CO.isSolo(CO.companyOf(heir)) && CO.companyOf(heir) !== W.SoloC, 'the heir: a level-1 ' + (heir && heir.cls) + ', agent-played, a company of one (' + (heir && heir.name) + ')');
  ok(heir && dist(heir, homeOf(heir).gate) < 12, 'it starts at home');
  run(2);
  ok(!sf(CO.companyOf(heir)) && S.opening && S.opening.queue.some(q => q.kind === 'heir' && q.company === CO.companyOf(heir).id), 'its opening waits for a runner to hold the heir (a new hero id)');
  LINK[heir.id] = 'connected';
  {let k = 0; while (k++ < 60 * 5 && !sf(CO.companyOf(heir))) step(1 / 60)}
  const os = sf(CO.companyOf(heir));
  ok(os && os.kind === 'opening' && os.company === CO.companyOf(heir).id && os.ids.join() === String(heir.id) && txt(os.frame).includes(fallenName), 'its short opening names who fell: ' + (os && os.title));
  playOut([heir], 'listen');
  const hl = act(heir, 'recall', {tag: 'letter'});
  ok(hl.ok && hl.notes.some(n => /cairn by the ford/.test(n.text)), 'the solo\'s letter reaches its heir');
  // an heir no runner takes up: its opening is written without a scene once HEIR_WAIT has passed
  put(W.wsolo, homeOf(W.wsolo).gate.x + 8, homeOf(W.wsolo).gate.y + 8);
  HE.fall(W.wsolo, 'a second test'); step(1 / 60);
  const heir2 = S.agents.find(a => a.succeeds === W.wsolo.id && living(a)), H2 = CO.companyOf(heir2);
  run(Math.ceil(AR.ARRIVE.HEIR_WAIT / 6) + 2);
  ok(heir2 && H2 && !(S.opening && S.opening.queue.length) && H2.log.some(e => e.kind === 'session') && !sf(H2), 'with no runner the heir\'s opening is written without a scene after ' + AR.ARRIVE.HEIR_WAIT + ' game minutes');
}

// ---- H. save mid-everything and restore ----
section('H. save mid-everything');
{
  const W = apart(), LINK = {}; setRunnerLinks(x => LINK[x.id] || 'none');
  CRYPT.cd = 1e9; S.raidT = 1e9;
  for (const C of W.Cs) for (const a of CO.members(C)) {HE.seedLevel(a, 8); a.hp = HE.maxHp(a); LINK[a.id] = 'connected'; a.partyOk = true}
  const hi = homeOf(W.solo), g = hi.gate, sp = {x: g.x + 6, y: g.y + 10};
  for (const m of S.mobs) if (m.alive && dist(m, sp) < 25) {m.alive = false; m.gone = true}
  const [p1a, p1b] = CO.members(W.P1), [q1, q2] = CO.members(W.P2), l1 = CN.leaderOfC(W.P1), l2 = CN.leaderOfC(W.P2);
  const fol0 = l1 === p1a ? p1b : p1a, fallen = l2 === q1 ? q2 : q1;
  // a notice and a sighting at Highgate; the solo and the first pair meet there
  for (const a of [W.solo, p1a, p1b]) {put(a, g.x, g.y, 'town'); a.townStep = 2; a.gold = 200; a.town = hi.name}
  act(W.solo, 'post_notice', {text: 'Seeking a company for the east road.'});
  act(W.solo, 'say', {text: 'I am ' + W.solo.name + '.'}); act(p1a, 'say', {text: 'And I am ' + p1a.name + '.'}); run(1);
  act(W.solo, 'move_to', {target: 'east'});
  // a courier on the road to the solo, far off
  put(W.solo, sp.x + 30, sp.y); for (const a of [p1a, p1b]) put(a, g.x, g.y, 'town');
  const cr = act(p1a, 'send_courier', {to: W.solo.name, text: 'Wait at the ford.'});
  // an open offer: the second pair's leader asks the solo face to face
  put(W.solo, sp.x, sp.y); [q1, q2].forEach((a, i) => put(a, sp.x + 1 + i, sp.y + 1));
  const of = act(l2, 'invite', {hero_id: W.solo.id});
  // a follow: a member of the first pair walks behind the solo
  for (const a of [p1a, p1b]) put(a, sp.x - 2, sp.y);
  const fw = act(fol0, 'follow', {name: W.solo.name});
  // a queued arrival: the second pair's other member falls out in the field
  HE.fall(fallen, 'a test of the save'); step(1 / 60);
  // an open scene: the Warband solo at bay
  const m = S.mobs.find(q => q.alive && !q.gone && !q.elite); m.maxhp = m.hp = 4000; m.cd = 99; m.hit = .001; m.fledOnce = true; m.ab = [];
  const wg = homeOf(W.wsolo).gate; put(W.wsolo, wg.x + 6, wg.y + 6); W.wsolo.state = 'fight'; W.wsolo.target = m; m.target = W.wsolo; m.x = W.wsolo.x + 1; m.y = W.wsolo.y; W.wsolo.hp = Math.round(HE.maxHp(W.wsolo) * .2);
  T.tableTick();
  const before = {offer: of.ok && OF.offersTo(W.solo).length, follow: fw.ok && !!FW.followCmd(fol0), courier: cr.ok && (W.P1.post || []).length,
    notice: !!SG.noticeOf(W.solo), sighting: (S.sightings || []).some(s => s.hero === W.solo.id), arrival: (W.P2.arrivals || []).length, scene: sf(W.SoloW) && sf(W.SoloW).kind, sceneCo: sf(W.SoloW) && sf(W.SoloW).company};
  ok(before.offer === 1 && before.follow && before.courier === 1 && before.notice && before.sighting && before.arrival === 1 && before.scene === 'rescue' && before.sceneCo === W.SoloW.id, 'before the save: an offer, a follow, a courier, a notice, a sighting, a queued arrival and an open rescue (' + JSON.stringify(before) + ')');
  const sig = () => JSON.stringify(CO.companies().map(C => [C.id, C.name, C.ids, (C.arrivals || []).map(q => q.cls), (C.post || []).length]));
  const s0 = sig();
  restore(JSON.parse(JSON.stringify(snapshot())));
  const solo = byId(W.solo.id), fol = byId(fol0.id), C2 = CO.companyById(W.P2.id), ws = byId(W.wsolo.id);
  ok(sig() === s0, 'the companies come back as they were (ids, members, arrivals, couriers)');
  ok(OF.offersTo(solo).length === 1 && FW.followCmd(fol) && SG.noticeOf(solo) && (S.sightings || []).some(s => s.hero === solo.id), 'the offer, the follow, the notice and the sighting stand');
  {const rs = sf(CO.companyById(W.SoloW.id)); ok(rs && rs.kind === 'rescue' && T.sceneCompany(rs) === CO.companyById(W.SoloW.id), 'the open rescue stands, keyed to the Warband solo\'s company')}
  // play on: the scene settles, the offer is accepted (within its hour), the courier arrives, the arrival opens in town
  playOut([ws], 'retreat');
  ok(!sf(CO.companyById(W.SoloW.id)), 'the restored scene plays out');
  const l2b = byId(l2.id); put(solo, l2b.x + 1, l2b.y); for (const a of [solo, l2b]) {a.state = 'hunt'; a.target = null}
  const off = OF.offersTo(solo)[0], ac = off && act(solo, 'accept', {offer_id: off.id});
  ok(ac && ac.ok && CO.companyOf(solo) === C2 && C2.ids.length === 2, 'the restored offer is accepted: the solo rides with ' + C2.name + (ac && ac.error ? ' (' + ac.error + ')' : ''));
  {let k = 0; while (k++ < 40 && !(solo.playEv || []).some(e => /courier finds you/.test(e.text))) {S.gameMin += 20; run(1)}}
  ok((solo.playEv || []).some(e => /courier finds you/.test(e.text)), 'the restored courier still finds the solo');
  const lg = homeOf(l2b).gate; for (const a of CO.members(C2)) {put(a, lg.x, lg.y, 'town'); a.townStep = 1}
  {let k = 0; while (k++ < 60 * 20 && !(sf(C2) && sf(C2).kind === 'arrival')) step(1 / 60)}
  ok(sf(C2) && sf(C2).kind === 'arrival', 'the restored arrival opens in town for its company');
  T.TABLE.mode = 'off'; T.tableHold(0); T.TABLE.mode = 'auto';
}

// ---- I. determinism: the seeded no-company world is untouched ----
section('I. the seeded no-company world');
{
  const H1 = plainHash();
  ok(H0 === H1, 'the seeded no-company world hashes the same before and after the apart sections (' + H0 + ')');
  const base = process.env.COMPANY_BASELINE_HASH;
  if (base) ok(String(H1) === String(base), 'and equals the baseline (' + base + ')');
}

console.log(fail ? `\ncompanycheck (apart): ${fail} failure(s)` : '\ncompanycheck (apart): all ok');
process.exit(fail ? 1 : 0);
