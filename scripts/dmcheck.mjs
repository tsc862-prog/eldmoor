// The DM agent check (issue #66, part 1). No API key and no Ollama needed: mock agents only.
//   1. The DM tools in the sim: a closed seat answers nothing; reads work and roll no dice; notes are
//      kept (add, edit, remove, caps); a lever pull goes through the registry with by 'dm-agent' and a
//      DM log entry; refusals past the lever's limits, past the agent's daily cap, for named_foe, and
//      for piling danger onto a badly hurt Fellowship member; no lever touches a hero's numbers.
//   2. Notes, the seat and its day counts survive snapshot -> JSON -> restore.
//   3. Silence never stalls the world: with the seat open and no runner (or a runner that never
//      calls) a seeded world runs exactly like one without the seat (two child runs, hashed).
//   4. Over HTTP (attachPlay + the headless backend): /play/health reports the seat; one claimed DM
//      seat (a second runner is refused, a closed seat refuses claims); the MCP server at
//      /mcp?role=dm lists the DM tools and none of the hero tools; /play/dm and MCP calls work.
//   1b. Staged scenes (issue #132): every refusal of stage_scene (kind, reason, frame, cast, place, town,
//      not a member, far above the party, a creature not of that region, meeting without a want, bad role,
//      a badly hurt member before a fight or trap, an open scene or vote, one at a time, per day), all in
//      the DM log tagged dm-agent; dm_status and table_call with nothing staged. In part 4 the runner's table
//      voice (scripts/dm-agent.mjs tableVoice, mock model) answers a staged meeting's calls over /play/dm.
//   1c. NPC conversations (issue #170): a member's talk opens a conversation; a mock DM answers a greeting
//      with each follow-up (trade then buy/sell with the person, rumour with a map marker, job on the board,
//      blessing, leave, combat as a staged ambush), a silent seat is answered by the scripted DM at once, a
//      polled-but-silent DM after the budget, a multi-exchange conversation closes after CONV.EXCHANGES, a hostile
//      follow-up is refused while a member is badly hurt, the person's record (mood, warmth, hostile, notes) is
//      readable and saved, and npc_call never carries a member's private notes. In part 4 the runner's talk voice
//      (scripts/dm-agent.mjs talkVoice, mock model) answers a conversation over /play/dm.
//   5. The runner end to end: `npm run dm -- --provider ollama` against a mock Ollama and a headless
//      world opened with --dm: it claims the seat, reads, writes a note, pulls a lever, gets one
//      refused, prints a cost line per turn and keeps its session in logs/agents/dm.json (resumed next run).
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let seed = 0x9e3779b9 ^ (Number(process.env.DMCHECK_SEED) || 66);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const sim = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, dmAct, setDmSeat, dmSeatOn} = sim;
const {DMA, pileOn} = await import('../src/sim/dmagent.js');
const {DM_TOOLS} = await import('../src/data/dm-tools.js');
const {attachPlay} = await import('./relay-mcp.mjs');
const {localBackend} = await import('./play-headless.mjs');
const {maxHp} = await import('../src/sim/heroes.js');
const {fellows} = await import('../src/sim/fellowship.js');
const {ZONES, ZPTS, zoneAt} = await import('../src/world/map.js');
// a spot well inside its region (not within 11 tiles of a border): a staged cast lands 6-10 tiles away, and over a border it would stand in ground far above a level-2 party, which changes which refusal comes first
const innerPoint = (zonePoint, zoneAt, z, home) => {let p; for (let i = 0; i < 300; i++) {p = zonePoint(z, null, home); if ([[11, 0], [-11, 0], [0, 11], [0, -11]].every(([dx, dy]) => zoneAt(p.x + dx, p.y + dy) === z)) return p} return p};

const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

// ---- determinism child: a seeded world, the seat open (silent) or not, hashed ----
if (process.argv[2] === '--hash') {
  init({fellowship: false}); if (process.argv[3] === 'seat') setDmSeat(true);
  run(150);
  if (process.argv[3] === 'seat') dmAct('dm_status'); // a read in the middle changes nothing either
  run(30);
  let h = Math.round(S.gameMin); for (const a of S.agents) h = (Math.imul(h, 31) + a.lvl * 1000 + Math.round(a.xp) + Math.round(a.x * 10) * 7 + Math.round(a.hp)) | 0;
  for (const m of S.mobs) h = (Math.imul(h, 17) + Math.round(m.x * 10) + m.lvl) | 0;
  console.log('HASH ' + h); process.exit(0);
}

// ---- session zero child (issue #437): the opening framed by the DM agent's call, or by the scripted DM with the seat closed ----
if (process.argv[2] === '--opening') {
  const A = await import('../src/sim/arrival.js'), T = await import('../src/sim/table.js'), F_ = await import('../src/sim/fellowship.js'), PL = await import('../src/sim/player.js');
  const closed = process.argv[3] === 'closed';
  init({fellowship: false}); run(10);
  F_.found(F_.autoPick(0), {fac: 0, ai: false}); setDmSeat(!closed); sim.setRunnerLinks(() => 'none'); T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  if (!closed) {const D = S.dmAgent; D.notes.plans.push({id: 9001, title: 'The Lanterns', text: 'PREMISE-PLANTED the road lights are failing.', tags: ['premise'], pin: true}, {id: 9002, title: 'Opening beats', text: 'Day 1: a dark shrine.', tags: ['openings']})}
  A.planOpening(); step(1 / 60); const sc = S.table;
  let call = null, k = 0; while (S.table && S.table.phase === 'frame' && k++ < 600) {if (!closed) dmAct('table_call'); step(1 / 60)}
  if (!closed) {const t = dmAct('table_call'); call = t.call; if (call) dmAct('table_answer', {call: call.id, text: 'The hall smells of wet wool and lamp oil.'})}
  k = 0; while (S.table && k++ < 60 * 60) step(1 / 60);
  const heard = F_.fellows().map(a => (a.chat || []).map(e => e.text).join(' | ')).join(' || '), tools = JSON.stringify(F_.fellows().map(a => [PL.playerAct(a.id, 'status'), PL.playerAct(a.id, 'look')]));
  console.log('OPENING ' + JSON.stringify({kind: sc && sc.kind, title: sc && sc.title, call: call && call.kind, premise: !!(call && /PREMISE-PLANTED/.test(call.about)), by: sc && sc.calls ? sc.calls.map(c => c.by) : [], dmLine: /wet wool/.test(heard), scripted: sc && sc.calls && sc.calls[0] && sc.calls[0].by === 'scripted' && heard.includes(sc.calls[0].text.slice(0, 30)), leak: heard.includes('PREMISE-PLANTED') || tools.includes('PREMISE-PLANTED'), summary: sc && sc.summary}));
  process.exit(0);
}

// ---- Fellowship-first child (issue #165): a seeded world with a Fellowship, the scripted DM alone, the share printed ----
if (process.argv[2] === '--focus') {
  init({fac: 0}); run(1500);
  const {focusStats} = await import('../src/sim/dmfocus.js');
  console.log('FOCUS ' + JSON.stringify(focusStats()) + ' H ' + Math.round(S.gameMin) + ' ' + S.agents.length + ' ' + (S.dmLog || []).length);
  process.exit(0);
}

// ---- Fellowship bounty child (issue #325): a bounty in the Fellowship's region becomes their job first ----
if (process.argv[2] === '--ffbounty') {
  init({fac: 0}); run(120);
  const DM = await import('../src/sim/dm.js'), FO = await import('../src/sim/dmfocus.js'), {huntZone} = await import('../src/sim/heroes.js');
  const {MOBS} = await import('../src/data/mobs.js');
  const {onLog} = await import('../src/sim/chronicle.js'), {chronicleFocus} = await import('../src/sim/fellowship.js'), {CITY} = await import('../src/world/map.js');
  const heard = []; onLog(e => heard.push(e)); // Chronicle lines (#351): a Fellowship hall posting writes one, others none
  const hallLines = () => heard.filter(e => e.parts.some(p => typeof p === 'string' && /hall board:/.test(p)));
  const out = {}, fo = FO.focus(), c = fo && fo.town, P = (S.parties || []).find(p => p.fellow);
  if (!c || !P) {console.log('FFB ' + JSON.stringify({setup: false})); process.exit(0)}
  const L = P.leader, mem = [L, ...P.mem.filter(b => b !== L && b.state !== 'dead')];
  for (const b of fellows()) {b.lvl = Math.max(b.lvl, 8); b.adv = null; b.state = 'town'; b.x = c.gate.x; b.y = c.gate.y}
  const clearHall = () => {S.adventures = S.adventures.filter(h => !(h.phase === 'open' && h.town === c.name && (h.ff || h.for != null)))};
  // 1. the gate: no job for them on the board, a bounty posted for the region they set out for
  clearHall(); const z = P.zone != null ? P.zone : huntZone(L);
  let b = DM.bountiesAt(c).find(x => x.z === z);
  if (!b) {S.bounties.push({id: ++S.uid, town: c.name, z, type: Object.keys(MOBS).find(k => MOBS[k].z === z), need: 6, giver: 'the gate captain', born: S.gameMin, until: S.gameMin + 2000}); b = S.bounties[S.bounties.length - 1]}
  const bg = S.agents.find(a => !a.fellow && a.state !== 'dead' && a.lvl >= 8 && !a.party) || S.agents.find(a => !a.fellow && a.state !== 'dead');
  out.left = DM.fellowBounty(L, c, z);
  const adv = L.adv != null ? S.adventures.find(v => v.id === L.adv) : null;
  out.ff = !!(adv && adv.ff); out.fromBounty = !!(adv && adv.data && adv.data.bounty === b.id && adv.z === b.z);
  out.whole = adv ? adv.mem.length : 0; out.party = mem.length;
  out.bountyStays = S.bounties.some(x => x.id === b.id);
  out.bgTake = adv ? DM.fitsJob({...adv, phase: 'open', for: null}, bg) : null; // a background hero cannot take a Fellowship job
  out.bgName = bg && bg.name;
  out.gateLines = hallLines().length;
  // 2. the hall board: full of background jobs, nothing for them; the next refresh posts one on top
  for (const m of mem) m.adv = null; S.adventures = S.adventures.filter(v => v !== adv); clearHall();
  while (S.adventures.filter(h => h.phase === 'open' && h.town === c.name && h.for == null).length < DM.K.HOOKS) DM.postHook(c, 'deliver', 'request', {});
  out.boardBefore = S.adventures.filter(h => h.phase === 'open' && h.town === c.name).length;
  const others = CITY.filter(x => x !== c); S.adventures = S.adventures.filter(h => !(h.phase === 'open' && others.some(x => x.name === h.town))); // their boards post too
  heard.length = 0; const ids0 = new Set(S.adventures.map(h => h.id));
  S.dmHookT = 0; DM.dmTick(1);
  const posted = S.adventures.filter(h => h.phase === 'open' && !ids0.has(h.id));
  out.postedFF = posted.filter(h => h.ff).length; out.postedOther = posted.filter(h => !h.ff).length;
  const hl = hallLines(); out.hallLines = hl.length;
  out.lineNames = hl.every(e => e.parts.some(p => p && p.kind === 'hero' && fo.ids.has(p.id)) && e.parts.some(p => p && p.t === c.name));
  out.lineKept = hl.every(e => chronicleFocus(e)); out.lineNoDm = hl.every(e => !/DM|dungeon master/i.test(e.parts.map(p => typeof p === 'string' ? p : p && (p.t || p.name) || '').join('')));
  out.lineText = hl.length ? hl[0].parts.map(p => typeof p === 'string' ? p : p && (p.t || p.name) || '').join('') : '';
  const ff = S.adventures.filter(h => h.phase === 'open' && h.town === c.name && h.ff);
  out.refillFF = ff.length; out.refillTpl = ff.map(h => h.tpl + (h.data && h.data.bounty ? '(bounty)' : h.data && h.data.eliteId != null ? '(elite)' : '')).join(',');
  out.fitsWhole = ff.some(h => DM.fitsJob(h, L));
  console.log('FFB ' + JSON.stringify(out)); process.exit(0);
}

// ---- solo-sized jobs child (issue #447): boards keep one job for a single hero while an agent solo exists ----
if (process.argv[2] === '--solo') {
  const withSolo = process.argv[3] !== 'none', lvl = Number(process.argv[4]) || 6;
  init({fellowship: false}); run(60);
  const DM = await import('../src/sim/dm.js'), {CITY, REGIONS} = await import('../src/world/map.js'), {markPlayer} = await import('../src/sim/player.js');
  const {soloFor} = await import('../src/sim/company.js'), ADV = await import('../src/data/adventures.js');
  const out = {};
  let solo = null;
  if (withSolo) {
    solo = S.agents.find(a => a.kind === 'hero' && a.fac === 0 && a.state !== 'dead' && !a.party && !a.company);
    solo.lvl = lvl; solo.adv = null; markPlayer(solo, true); out.company = !!soloFor(solo);
  }
  S.adventures = []; S.dmHookT = 0; DM.dmTick(1);
  const open = S.adventures.filter(h => h.phase === 'open'), mine = CITY.filter(c => solo && c.fac === solo.fac);
  const soloJobs = open.filter(h => h.solo);
  out.total = soloJobs.length; out.boards = mine.length > 0 && mine.every(c => soloJobs.some(h => h.town === c.name));
  out.otherFac = soloJobs.some(h => !mine.some(c => c.name === h.town));
  out.solos = soloJobs.every(h => ADV.ADVENTURES[h.tpl].size[0] <= 1);
  out.band = soloJobs.every(h => ADV.ADVENTURES[h.tpl].lvl <= lvl && (h.zone == null || REGIONS[h.zone].band[0] <= lvl));
  out.fits = solo ? soloJobs.every(h => DM.fitsJob(h, solo)) : null;
  out.payMul = soloJobs.length ? soloJobs.every(h => h.data.payMul === DM.K.SOLO_PAY && DM.K.SOLO_PAY < 1) : null;
  const n1 = soloJobs.length; S.dmHookT = 0; DM.dmTick(1); out.again = S.adventures.filter(h => h.phase === 'open' && h.solo).length === n1;
  console.log('SOLO ' + JSON.stringify(out)); process.exit(0);
}

// ---- every company a thread (issue #450): the Fellowship, a Concord pair and a Warband solo; hall jobs, needs order, orders ----
// Builds the extra companies in a seeded Fellowship world: two Concord heroes as a pair (hall Highgate, the Fellowship's too)
// and one Warband hero riding alone (hall Grimhold).
async function addCompanies() {
  const {markPlayer} = await import('../src/sim/player.js'), CO = await import('../src/sim/company.js');
  const free = fac => S.agents.filter(a => a.kind === 'hero' && a.fac === fac && !['dead', 'dungeon', 'raid'].includes(a.state) && !a.hidden && !a.party && !a.company && !a.fellow);
  const [p1, p2] = free(0), s1 = free(1)[0];
  for (const a of [p1, p2, s1]) {a.lvl = Math.max(a.lvl, 6); a.adv = null; markPlayer(a, true)}
  const pair = CO.companyOf(p1); CO.leaveCompany(p2); CO.joinCompany(pair, p2); pair.name = 'the Ashen Pair';
  return {pair, solo: CO.companyOf(s1), five: S.fellowship, p1, p2, s1, CO};
}
if (process.argv[2] === '--companies') {
  init({fac: 0}); run(120);
  const DM = await import('../src/sim/dm.js'), FO = await import('../src/sim/dmfocus.js'), {CITY} = await import('../src/world/map.js'), DA = await import('./dm-agent.mjs');
  const {pair, solo, five, p1, s1, CO} = await addCompanies(), out = {};
  out.made = !!(pair && solo && five && pair.ids.length === 2 && solo.ids.length === 1 && pair.hall !== solo.hall);
  const fs = FO.focuses(); out.focuses = fs.map(f => f.cid).join(','); out.followedFirst = fs[0] && fs[0].company === CO.followed();
  out.shim = FO.focus() && FO.focus().company === five;
  // 1. hall boards: every company idle in town at its hall, the boards emptied of hall jobs; one refresh posts one per company
  for (const C of [five, pair, solo]) for (const a of CO.members(C)) {const c = CITY.find(t => t.name === C.hall); a.adv = null; a.state = 'town'; a.x = c.gate.x; a.y = c.gate.y; a.lvl = Math.max(a.lvl, 6)}
  S.adventures = S.adventures.filter(h => h.phase !== 'open');
  S.dmHookT = 0; DM.dmTick(1);
  const ffs = S.adventures.filter(h => h.phase === 'open' && h.ff);
  const jobOf = C => ffs.filter(h => h.cid === C.id);
  out.hallJobs = [five, pair, solo].map(C => jobOf(C).length).join(',');
  out.onHall = [five, pair, solo].every(C => jobOf(C).every(h => h.town === C.hall));
  out.hallHooks = [five, pair, solo].every(C => {const f = FO.focusOf(C), L = FO.hallHooks(C.hall, f).map(h => h.id); return jobOf(C).every(h => L.includes(h.id)) && L.every(id => {const h = S.adventures.find(x => x.id === id); return !h.ff || h.cid === C.id})});
  const sj = jobOf(solo)[0], pj = jobOf(pair)[0];
  out.soloFits = !!(sj && DM.fitsJob(sj, s1)); out.pairFits = !!(pj && DM.fitsJob(pj, p1));
  const bg = S.agents.find(a => a.kind === 'hero' && a.fac === 1 && a.state !== 'dead' && !a.company && a.lvl >= 6);
  out.bgRefused = !!(sj && bg && !DM.fitsJob(sj, bg)); out.fiveRefused = !!(pj && !DM.fitsJob(pj, CO.members(five)[0]));
  S.dmHookT = 0; DM.dmTick(1); out.again = [five, pair, solo].map(C => S.adventures.filter(h => h.phase === 'open' && h.ff && h.cid === C.id).length).join(',');
  // 2. the share: a hall posting for the pair touches the pair alone, and stamps its last DM action
  const e = (S.dmLog || []).find(x => x.kind === 'hooks' && x.detail && x.detail.added && x.detail.added[0] && x.detail.added[0].cid === pair.id);
  out.pairId = pair.id; out.touches = e ? FO.touchesWhich(e).join(',') : 'none'; out.pairStamped = S.dmFocus.last && S.dmFocus.last[pair.id] != null && S.dmFocus && S.dmFocus.by && S.dmFocus.by[pair.id] >= 1;
  console.log('COMPANIES ' + JSON.stringify(out)); process.exit(0);
}
// The scripted DM with three companies over 150 game hours: the share of its actions that concern some company.
if (process.argv[2] === '--focus-companies') {
  init({fac: 0}); run(60); await addCompanies(); run(1440);
  const {focusStats} = await import('../src/sim/dmfocus.js'), F = S.dmFocus || {};
  console.log('FOCUS ' + JSON.stringify(focusStats()) + ' BY ' + JSON.stringify(F.by || {}) + ' H ' + Math.round(S.gameMin));
  process.exit(0);
}
// companies_needs, neediest first: one case per rule, plus the signature, the view and the standing orders
if (process.argv[2] === '--needs') {
  init({fac: 0}); run(120); setDmSeat(true);
  const {CITY} = await import('../src/world/map.js'), DA = await import('./dm-agent.mjs'), DAG = await import('../src/sim/dmagent.js');
  const {pair, solo, five, p1, s1, CO} = await addCompanies(), out = {};
  S.followId = five.id; S.table = null;
  const calm = () => {for (const C of [five, pair, solo]) {C.props = []; for (const a of CO.members(C)) {const c = CITY.find(t => t.name === C.hall); a.adv = null; a.state = 'town'; a.x = c.gate.x; a.y = c.gate.y; a.hp = maxHp(a)}}
    S.adventures = S.adventures.filter(h => h.phase !== 'active')};
  const order = () => {const st = dmAct('dm_status'); return (st.companies_needs || []).map(r => r.id === five.id ? 'F' : r.id === pair.id ? 'P' : r.id === solo.id ? 'S' : '?').join('')};
  const why = () => (dmAct('dm_status').companies_needs || [])[0].why;
  calm(); const now = Math.round(S.gameMin), T = (S.dmFocus || (S.dmFocus = {acts: 0, fellow: 0, day: {d: -1, acts: 0, fellow: 0}})).last || (S.dmFocus.last = {});
  // size: every company touched at the same minute -> the solo, the pair, then the five
  T[five.id] = T[pair.id] = T[solo.id] = now; out.size = order();
  // longest since the DM touched them: the five 9h ago, the pair 3h, the solo just now
  T[five.id] = now - 540; T[pair.id] = now - 180; out.longest = order(); out.longestWhy = why();
  // never touched counts as the longest
  delete T[pair.id]; out.never = order();
  // hurt in the field outranks time: the solo, touched just now, is out and badly hurt
  T[pair.id] = now - 180; s1.state = 'hunt'; s1.x += 6; s1.hp = Math.round(maxHp(s1) * .2); out.hurt = order(); out.hurtWhy = why();
  // a pending vote outranks hurt: the pair has an open proposal
  pair.props = [{id: 1, kind: 'other', details: 'test', status: 'open', votes: {}}]; out.vote = order(); out.voteWhy = why();
  // the followed company comes first only when it must choose: the five's own vote; without one it waits its turn
  five.props = [{id: 1, kind: 'other', details: 'test', status: 'open', votes: {}}]; out.followed = order(); out.followedWhy = why();
  pair.props = []; S.followId = pair.id; out.notFollowed = order();
  S.followId = five.id; calm();
  // the signature joins one per company, and a solo's move alone changes it
  const sig1 = dmAct('dm_status').fellowship_change; s1.state = 'hunt'; s1.x += 8; const sig2 = dmAct('dm_status').fellowship_change;
  out.sig = typeof sig1 === 'string' && sig1.split('|').length > 8 && sig1 !== sig2 && sig1.includes(solo.id + ':');
  calm();
  // the view and the standing orders
  const v = dmAct('companies_view');
  out.view = v.ok && v.companies.length === 3 && v.companies.every(c => c.members.every(m => !('persona' in m) && !('memory_recent' in m))) && v.needs_order.length === 3;
  const st = dmAct('dm_status');
  out.first = typeof st.companies_first === 'string' && /Every company is a thread/.test(st.companies_first);
  const sys = DA.dmSystemPrompt(st);
  out.orders = sys.includes(DA.DM_COMPANY_ORDERS) && /a solo\'s road gets a hook before the five get a third/.test(DA.DM_COMPANY_ORDERS) && /longest without you/.test(DA.DM_COMPANY_ORDERS)
    && DA.withDmCompanyOrders('old prompt').includes(DA.DM_COMPANY_ORDERS) && DA.withDmCompanyOrders(sys) === sys;
  const tp = DA.dmTurnPrompt(2, {...st, day: 3, part: 'day'});
  out.prompt = /Companies, neediest first: /.test(tp) && tp.includes(s1.name) && /Fellowship first:/.test(tp);
  // pile-on reaches every company's members, not only the Fellowship's
  s1.state = 'hunt'; s1.hp = Math.round(maxHp(s1) * .2);
  const pile = pileOn('mark_dangerous', {at: {x: Math.round(s1.x), y: Math.round(s1.y)}, radius: 3});
  out.pile = typeof pile === 'string' && pile.includes(s1.name) && /riding alone/.test(pile);
  console.log('NEEDS ' + JSON.stringify(out)); process.exit(0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor dmcheck: the DM as an agent, part 1 (mock agents)\n');

// ---------------------------------------------------------------- 1. the DM tools in the sim
console.log('the DM tools');
init({fac: 0}); run(60);
ok(!!S.fellowship, `a world with a Fellowship (${S.fellowship && S.fellowship.name})`);
let r = dmAct('dm_status');
ok(r.ok === false && r.offline && /seat is closed/.test(r.error) && !S.dmAgent, 'a closed seat answers nothing and leaves no state');
setDmSeat(true);
ok(dmSeatOn() && S.dmLog[0].kind === 'agent', 'opening the seat is logged in the DM log');
const nums = () => S.agents.map(a => [a.id, a.lvl, Math.round(a.xp), a.state === 'dead' ? 0 : 1].join(':')).join(',');
const rng0 = seed, n0 = nums();
for (const t of ['dm_status', 'read_timeline', 'read_chronicle', 'read_dm_log', 'fellowship_view', 'npcs', 'regions', 'hooks', 'levers', 'notes_read']) {r = dmAct(t, {n: 5}); ok(r.ok, `${t} reads (${JSON.stringify(r).length} chars)`)}
r = dmAct('heroes_near', {near: S.fellowship.hall || 'Highgate'}); ok(r.ok && Array.isArray(r.heroes), `heroes_near ${r.place}: ${r.heroes && r.heroes.length} heroes`);
ok(dmAct('heroes_near', {near: 'Nowhere-at-all'}).ok === false, 'heroes_near refuses an unknown place');
{ // issue #427: hooks and npcs read a region as well as a town
  const {CITY} = await import('../src/world/map.js');
  const tc = CITY[0], tz = zoneAt(tc.gate.x, tc.gate.y), rn = ZONES[tz], logN = S.dmLog.length, log0 = S.dmLog[0], notesN = JSON.stringify(S.dmAgent && S.dmAgent.notes);
  const hk = dmAct('hooks', {region: rn.toUpperCase()}), all = dmAct('hooks');
  const want = all.open_jobs.filter(j => CITY.some(c => c.name === j.town && zoneAt(c.gate.x, c.gate.y) === tz) || j.region === rn).map(j => j.id).sort().join();
  ok(hk.ok && hk.scope && hk.scope.region === rn && hk.scope.towns.includes(tc.name) && hk.open_jobs.map(j => j.id).sort().join() === want,
    `hooks {region: ${rn}} lists the jobs of its towns (${hk.scope && hk.scope.towns.join(', ')}): ${hk.open_jobs && hk.open_jobs.length} of ${all.open_jobs.length}`);
  const np = dmAct('npcs', {region: rn});
  ok(np.ok && np.townsfolk.length > 0 && np.townsfolk.every(n => np.scope.towns.includes(n.town)) && np.wanderers.every(w => np.scope.towns.includes(w.where) || w.where === rn),
    `npcs {region: ${rn}}: ${np.townsfolk && np.townsfolk.length} townsfolk and ${np.wanderers && np.wanderers.length} wanderers there`);
  const wz = ZONES.findIndex((n, i) => !CITY.some(c => zoneAt(c.gate.x, c.gate.y) === i));
  if (wz >= 0) {
    const wn = dmAct('npcs', {region: ZONES[wz]}), wh = dmAct('hooks', {region: ZONES[wz]});
    ok(wn.ok && wn.townsfolk.length === 0 && wn.scope.towns.length === 0 && wh.ok && wh.open_jobs.every(j => j.region === ZONES[wz]),
      `a region with no town (${ZONES[wz]}) reads no townsfolk and only the jobs that lead into it (${wh.open_jobs.length})`);
  }
  const asTown = dmAct('hooks', {town: rn});
  ok(asTown.ok && /is a region, not a town/.test(asTown.note) && asTown.scope.region === rn, 'a town value that names a region is read as the region, with a note');
  ok(dmAct('npcs', {town: tc.name.toLowerCase()}).scope.town === tc.name, 'a town still reads as the town');
  const bad = dmAct('npcs', {region: 'Lowmarkia'}), bad2 = dmAct('hooks', {town: 'Lowmarkia'});
  ok(!bad.ok && ZONES.every(z => bad.error.includes(z)) && CITY.every(c => bad.error.includes(c.name)) && !bad2.ok && /town or region/.test(bad2.error),
    'an unknown name refuses with the regions and towns it can read');
  ok(S.dmLog.length === logN && S.dmLog[0] === log0 && JSON.stringify(S.dmAgent && S.dmAgent.notes) === notesN, 'region reads write no DM log entry and no note');
}
ok(seed === rng0 && nums() === n0, 'reads roll no dice and change no hero');
const fv = dmAct('fellowship_view').fellowship;
ok(fv && fv.members.length === 5 && fv.members.every(m => m.empty || ('persona' in m && 'memory_recent' in m)) && Array.isArray(fv.open_threads), 'fellowship_view: five members with persona, memories and open threads');
ok(dmAct('levers').levers.every(l => l.name !== 'named_foe'), 'the lever menu leaves out named_foe (the scripted DM\'s, inside scenes)');

// notes
r = dmAct('notes_write', {section: 'threads', op: 'add', text: 'Who robbed the Mirefen wagon?', about: 'Mirefen road'});
const nid = r.note && r.note.id;
ok(r.ok && nid, 'notes_write add');
ok(dmAct('notes_write', {section: 'secrets', op: 'add', text: 'The innkeeper sold the route.'}).ok && /a secret/.test(JSON.stringify(S.dmLog[0].summary)), 'a secret is logged without its text in the summary');
ok(dmAct('notes_write', {section: 'threads', op: 'edit', id: nid, text: 'Who robbed the wagon, and why the innkeeper smiles.'}).ok, 'notes_write edit');
ok(dmAct('notes_write', {section: 'plans', op: 'add', text: 'Fog on the marsh road for a day.'}).ok, 'notes_write add (plans)');
ok(dmAct('notes_write', {section: 'gossip', op: 'add', text: 'x'}).ok === false && dmAct('notes_write', {section: 'threads', op: 'remove', id: 9999}).ok === false, 'bad sections and unknown ids are refused');
ok(dmAct('notes_write', {section: 'threads', op: 'add', text: 'x'.repeat(900)}).note.text.length === DMA.NOTE_MAX, `notes are capped at ${DMA.NOTE_MAX} characters`);
const nr = dmAct('notes_read').notes;
ok(nr.threads.length === 2 && nr.secrets.length === 1 && nr.plans.length === 1, 'notes_read returns every section');

// levers
const z = 1, pulls0 = (S.dmLog || []).filter(e => e.kind === 'lever').length;
r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[z], kind: 'fogbound', strength: 1, hours: 12}, reason: 'the marsh closes in'});
ok(r.ok && S.conditions.some(c => c.z === z && c.kind === 'fogbound'), `pull_lever set_condition: fog over ${ZONES[z]}`);
const le = S.dmLog.find(e => e.kind === 'lever');
ok(le.detail.by === 'dm-agent' && le.detail.reason === 'the marsh closes in' && S.levers.active.some(x => x.by === 'dm-agent'), 'the pull is in the DM log with by dm-agent and its reason');
r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[z], kind: 'bandits'}, reason: 'again'});
ok(r.ok === false && /already has a condition/.test(r.error), 'a second condition in the region is refused by the lever: ' + r.error);
r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[2], kind: 'festival'}, reason: 'a fair'});
r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[3] || ZONES[0], kind: 'festival'}, reason: 'another fair'});
ok(r.ok === false && /limit|already/.test(r.error), 'past the lever\'s limits a pull is refused: ' + r.error);
ok(dmAct('pull_lever', {lever: 'named_foe', params: {}, reason: 'x'}).ok === false, 'named_foe is refused to the agent');
ok(dmAct('pull_lever', {lever: 'set_condition', params: {region: 1}, reason: ''}).ok === false, 'a pull without a reason is refused');
ok(dmAct('pull_lever', {lever: 'kill_hero', params: {}, reason: 'x'}).ok === false, 'an unknown lever is refused');
ok(dmAct('pull_lever', {lever: 'set_condition', params: '{not json', reason: 'x'}).ok === false, 'params that are not an object are refused');
// errors that carry the fix (issue #401): the lever's contract, the lever names, a lever called as a tool
{const pulls1 = S.dmAgent.day.pulls;
  r = dmAct('pull_lever', {lever: 'kill_hero', params: {}, reason: 'x'}); ok(/levers: .*set_condition.*post_hook|levers: .*post_hook.*set_condition/.test(r.error), 'an unknown lever lists the lever names: ' + r.error.slice(0, 90));
  r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[4] || ZONES[0]}, reason: 'fog'});
  ok(r.ok === false && /kind is required/.test(r.error) && /set_condition takes params: region \(a region: .*\), kind \(/.test(r.error) && r.usage, 'a pull shaped wrong names the lever\'s params and legal values: ' + r.error.slice(0, 160));
  r = dmAct('pull_lever', {lever: 'set_condition', params: {region: 1}, reason: ''}); ok(/reason is required/.test(r.error) && /pull_lever \{"lever":"set_condition"/.test(r.error), 'a pull without a reason says how to call it');
  r = dmAct('pull_lever', {lever: 'set_condition', region: ZONES[4] || ZONES[0], kind: 'no-such-weather', reason: 'fog'});
  ok(r.ok === false && /kind must be one of/.test(r.error), 'lever params given beside lever and reason are read as params (the refusal is about the value, not a missing key)');
  r = dmAct('pull_lever', {lever: 'mark_dangerous', params: {x: -5, y: -5}, reason: 'x,y given flat'});
  ok(r.ok === false && !/at is required/.test(r.error), 'a point given as x,y is read as the lever\'s point: ' + r.error.slice(0, 80));
  S.dmAgent.day.pulls = pulls1;
  r = dmAct('set_condition', {region: 'x'}); ok(r.ok === false && /pull_lever \{"lever":"set_condition"/.test(r.error) && /set_condition takes params: region/.test(r.error), 'a lever name called as a tool points to pull_lever with its params: ' + r.error.slice(0, 120));
  r = dmAct('create_npc', {role: 'hermit'}); ok(r.ok === false && /pull_lever \{"lever":"create_npc"/.test(r.error) && /Or call place_person \(flat arguments\): place_person takes: role/.test(r.error), 'a lever with a flat tool (create_npc) points to pull_lever and to place_person');
  r = dmAct('create_npc_placeholder', {}); ok(r.ok === false && /looks like the lever create_npc/.test(r.error), 'a made-up tool that contains a lever name points to that lever');
  r = dmAct('fly', {}); ok(r.ok === false && /Tools: dm_status/.test(r.error) && /go through pull_lever/.test(r.error), 'an unknown DM tool lists the tools');}
// pile-on: a badly hurt Fellowship member out in the field
const hurt = fellows()[0], hz = zoneAt(hurt.x, hurt.y);
hurt.state = 'hunt'; hurt.hp = maxHp(hurt) * .2;
const pile = pileOn('mark_dangerous', {at: {x: hurt.x + 1, y: hurt.y}});
r = dmAct('pull_lever', {lever: 'mark_dangerous', params: {at: {x: Math.round(hurt.x) + 1, y: Math.round(hurt.y)}}, reason: 'more wolves'});
ok(!!pile && r.ok === false && /does not pile on/.test(r.error), `danger next to ${hurt.name} at 20% HP is refused`);
ok(!!pileOn('set_condition', {region: hz, kind: 'migration'}) && !pileOn('set_condition', {region: hz, kind: 'festival'}), 'a danger condition over the region of the hurt member piles on; a festival does not');
ok(!!pileOn('start_event', {region: hz, kind: 'migration'}) && !pileOn('start_event', {region: hz, kind: 'festival'}) && !pileOn('start_event', {region: hz, kind: 'plague'}), 'a world event that runs as a danger condition (migration, invasion once it exists) piles on; festival and plague do not');
hurt.hp = maxHp(hurt);
ok(!pileOn('mark_dangerous', {at: {x: hurt.x + 1, y: hurt.y}}) && hz != null, 'once healed, the same pull is no longer a pile-on');
// the agent's own daily cap
S.dmAgent.day.pulls = DMA.PULLS_PER_DAY;
r = dmAct('pull_lever', {lever: 'price_shock', params: {good: Object.keys((await import('../src/data/items.js')).GOODS)[0], direction: 'up'}, reason: 'a hard winter'});
ok(r.ok === false && /pulled \d+ levers today/.test(r.error), 'past the DM agent\'s daily cap a pull is refused');
ok((S.dmLog || []).filter(e => e.kind === 'lever').length > pulls0 + 4 && S.dmLog.filter(e => e.kind === 'lever' && e.detail.by === 'dm-agent' && /rejected/.test(e.detail.result)).length >= 4, 'refusals are logged too, tagged dm-agent');
ok(nums() === n0, 'no hero\'s level, XP or life changed through the DM tools');
r = dmAct('log_intent', {text: 'The wagon thread will pull the party toward Mirefen.'});
ok(r.ok && S.dmLog[0].kind === 'agent' && S.dmLog[0].detail.intent, 'log_intent writes a DM agent line');
ok(dmAct('fly').ok === false, 'unknown DM tools are refused');

// world events (issue #352): dm_status and levers show what runs and whether start_event is open today; pulls and refusals carry their reason
{S.dmAgent.day.pulls = 0;
  let we = dmAct('dm_status').world_events;
  ok(we && Array.isArray(we.running) && we.running.length === 0 && we.open_today === true && we.kinds.includes('festival') && we.kinds.includes('plague') && Array.isArray(we.fellowship_regions) && /Fellowship first/.test(we.note || ''),
    'dm_status world_events: nothing running, start_event open today, its kinds and the Fellowship\'s regions');
  ok(JSON.stringify(dmAct('levers').world_events) === JSON.stringify(we), 'levers carries the same world_events');
  const zc = S.conditions[0].z, zf = ZONES.findIndex((n, i) => !S.conditions.some(c => c.z === i));
  const evReason = 'the harvest fair draws the Fellowship\'s old friends to market';
  r = dmAct('pull_lever', {lever: 'start_event', params: {kind: 'festival', region: ZONES[zc]}, reason: 'a fair where fog already lies'});
  const ref0 = S.dmLog[0];
  ok(r.ok === false && /already has a condition/.test(r.error) && ref0.kind === 'lever' && ref0.detail.lever === 'start_event' && ref0.detail.by === 'dm-agent' && /rejected: .*already has a condition/.test(ref0.detail.result) && ref0.detail.reason === 'a fair where fog already lies',
    'a start_event over a region with a condition is refused, the refusal and the reason in the DM log: ' + r.error);
  ok(zf >= 0, 'a region with no condition for the event');
  r = dmAct('pull_lever', {lever: 'start_event', params: {kind: 'festival', region: ZONES[zf]}, reason: evReason});
  const ev = S.dmLog.find(e => e.kind === 'lever' && e.detail.lever === 'start_event' && e.detail.result === 'applied');
  ok(r.ok && S.conditions.some(c => c.z === zf && c.kind === 'festival') && ev && ev.detail.by === 'dm-agent' && ev.detail.reason === evReason && ev.detail.params.kind === 'festival' && ev.detail.region === ZONES[zf],
    `start_event: a festival in ${ZONES[zf]}, logged with its kind, region and reason` + (r.ok ? '' : ': ' + r.error));
  we = dmAct('dm_status').world_events;
  ok(we.running.length === 1 && we.running[0].kind === 'festival' && we.running[0].region === ZONES[zf] && we.running[0].days_left === 3 && we.running[0].reason === evReason && we.running[0].by === 'dm-agent',
    'dm_status lists the running event: kind, region, days left and reason ' + JSON.stringify(we.running[0]));
  ok(we.open_today === false && /already running/.test(we.why_not) && we.regions_with_a_condition.some(x => x.startsWith(ZONES[zf])), 'start_event is closed while one runs, and says why: ' + we.why_not);
  const zp = ZONES.findIndex((n, i) => !S.conditions.some(c => c.z === i));
  r = dmAct('pull_lever', {lever: 'start_event', params: {kind: 'plague', region: ZONES[zp >= 0 ? zp : 0]}, reason: 'a second event the same day'});
  ok(r.ok === false && /limit/.test(r.error) && S.dmLog[0].detail.lever === 'start_event' && /rejected: limit/.test(S.dmLog[0].detail.result) && S.dmLog[0].detail.reason === 'a second event the same day',
    'a second world event is refused over the limit, with the refusal in the DM log: ' + r.error);
  const seenO = new WeakSet(), heard = JSON.stringify([S.chronicle, S.timeline, fellows().map(a => a.chat || [])], (k, v) => v && typeof v === 'object' ? (seenO.has(v) ? undefined : (seenO.add(v), v)) : v);
  ok(!heard.includes(evReason), 'the event\'s reason stays in the DM log: not in the chronicle, the timeline or any member\'s chat');
  const DAe = await import('./dm-agent.mjs'), sys = DAe.dmSystemPrompt(dmAct('dm_status'));
  ok(/World events \(start_event/.test(sys) && /Fellowship comes first here too: consider one only when nothing is pending for them/.test(DAe.DM_EVENT_ORDERS) && /fellowship_regions/.test(DAe.DM_EVENT_ORDERS)
    && DAe.withDmEventOrders('old prompt').includes(DAe.DM_EVENT_ORDERS) && DAe.withDmEventOrders(sys) === sys, 'the standing orders put the Fellowship first for world events (and reach an older session once)');
  // end the event so the checks below see the world they expect
  {const {LEVERS} = await import('../src/sim/levers.js'), rec = S.levers.active.find(x => x.name === 'start_event'); S.levers.active.splice(S.levers.active.indexOf(rec), 1); LEVERS.start_event.expire(rec); // what expiry does, without a tick
    ok(!S.levers.active.some(x => x.name === 'start_event') && !S.conditions.some(c => c.z === zf && c.kind === 'festival') && dmAct('dm_status').world_events.running.length === 0, 'an ended event leaves world_events and its region');}
}

// ---------------------------------------------------------------- 1a. flat lever tools (issue #413)
console.log('flat lever tools: post_hook, place_person, mark_place');
{const {zoneFor, zonePoint, CITY, LANDMARKS} = await import('../src/world/map.js'), {homeOf} = await import('../src/data/races.js'), {focus, reserveOf} = await import('../src/sim/dmfocus.js'), {LEVERS} = await import('../src/sim/levers.js');
  const L = fellows(), home = homeOf(L[0]).gate, spot = innerPoint(zonePoint, zoneAt, zoneFor(Math.max(1, L[0].lvl), home), home);
  L.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x)});
  S.dmAgent.day.pulls = 0; const n1 = nums(), cap0 = S.dmAgent.day.pulls, hall = S.fellowship.hall || CITY[0].name;
  const T = DM_TOOLS.filter(t => ['post_hook', 'place_person', 'mark_place'].includes(t.name));
  ok(T.length === 3 && T.every(t => t.act && t.desc.length < 600 && /pull_lever/.test(t.desc) && t.args.reason && !t.args.reason.optional), 'the three flat tools are listed, under 600 characters, name pull_lever and need a reason');
  const lastLever = () => S.dmLog.find(e => e.kind === 'lever');
  // post_hook
  r = dmAct('post_hook', {town: hall, tpl: 'rescue', giver: 'captain', reward: 'generous', reason: 'a lost drover on their road'});
  const hk = r.ok && S.adventures.find(h => h.id === r.effect.hook), e1 = lastLever();
  ok(r.ok && r.lever === 'post_hook' && hk && hk.town === hall && hk.by === 'dm-agent' && e1.detail.lever === 'post_hook' && e1.detail.by === 'dm-agent' && e1.detail.reason === 'a lost drover on their road' && e1.detail.result === 'applied' && S.dmAgent.day.pulls === cap0 + 1,
    'post_hook posts through the lever: on ' + hall + '\'s board, by dm-agent, the reason in the DM log, one pull counted' + (r.ok ? '' : ': ' + r.error));
  r = dmAct('post_hook', {town: 'fellowship', tpl: 'hunt', reason: 'a beast near their camp'});
  ok(r.ok && S.adventures.some(h => h.id === r.effect.hook && CITY.some(c => c.name === h.town)), 'post_hook town "fellowship" takes the nearest board' + (r.ok ? '' : ': ' + r.error));
  r = dmAct('post_hook', {town: hall, reason: 'no template'});
  const viaPull = dmAct('pull_lever', {lever: 'post_hook', params: {town: hall}, reason: 'no template'});
  ok(r.ok === false && /^Refused: tpl is required/.test(r.error) && /post_hook takes: town/.test(r.error) && /post_hook takes params: town/.test(r.error) && r.usage,
    'post_hook without tpl is refused by the lever, with its own and the lever\'s contract: ' + r.error.slice(0, 120));
  ok(viaPull.ok === false && r.error.split('. ')[0] === viaPull.error.split('. ')[0], 'the refusal is the one pull_lever gives: ' + viaPull.error.split('. ')[0]);
  ok(lastLever().detail.result === 'rejected: tpl is required' && lastLever().detail.by === 'dm-agent', 'the refusal is in the DM log, tagged dm-agent');
  r = dmAct('post_hook', {town: 'Nowhere-at-all', tpl: 'rescue', reason: 'x'});
  ok(r.ok === false && /town: unknown place/.test(r.error) && /town takes "fellowship"/.test(r.error), 'post_hook at an unknown town names what town takes: ' + r.error.slice(0, 100));
  r = dmAct('post_hook', {town: hall, tpl: 'rescue', place: 'the moon', reason: 'x'});
  ok(r.ok === false && /place: no place or person/.test(r.error), 'post_hook about an unknown place is refused');
  // place_person
  r = dmAct('place_person', {role: 'hermit', near: 'fellowship', name: 'Odo', want: 'someone to read the stones at the old cairn', attitude: 'wary', reason: 'a lead for their oath'});
  const w = r.ok && S.wanderers.find(x => x.id === r.npc), e2 = lastLever();
  ok(r.ok && r.lever === 'create_npc' && w && w.homeKind === 'camp' && w.name === 'Odo' && w.attitude === 'wary' && w.want === 'someone to read the stones at the old cairn' && Math.hypot(w.x - L[0].x, w.y - L[0].y) < 8 && e2.detail.lever === 'create_npc' && e2.detail.reason === 'a lead for their oath',
    'place_person near the Fellowship camps a person by them, with their want, through create_npc' + (r.ok ? ' (' + r.person + ' ' + r.where + ')' : ': ' + r.error));
  const other = (CITY.find(c => c.name !== hall) || CITY[0]).name; S.levers.cd = {}; // the towns may share a region with the camp above: its cooldown is the lever's
  r = dmAct('place_person', {role: 'minstrel', near: other, spot: 'inn', reason: 'songs of the road'});
  const w2 = r.ok && S.wanderers.find(x => x.id === r.npc);
  ok(r.ok && w2 && w2.homeKind === 'town' && w2.town === other, 'place_person near a town gives a town home' + (r.ok ? '' : ': ' + r.error));
  r = dmAct('place_person', {role: 'hermit', near: 'Nowhere-at-all', reason: 'x'});
  ok(r.ok === false && /unknown place/.test(r.error) && /create_npc needs town for a town home, or at: a point/.test(r.error) && /near takes "fellowship"/.test(r.error), 'place_person at an unknown place says what create_npc needed and what near takes: ' + r.error.slice(0, 120));
  r = dmAct('place_person', {role: 'wizard', near: 'fellowship', reason: 'x'});
  ok(r.ok === false && /role must be one of/.test(r.error) && /create_npc takes params: role/.test(r.error), 'place_person with a bad role is refused by the lever with its contract');
  r = dmAct('place_person', {role: 'hermit', near: 'fellowship'});
  ok(r.ok === false && /reason is required/.test(r.error), 'place_person without a reason is refused');
  // mark_place
  r = dmAct('mark_place', {kind: 'shrine', near: 'fellowship', name: 'the lantern stone', reason: 'something for their scout to read'});
  const pl = r.ok && S.places.find(p => p.id === r.effect.place), e3 = lastLever();
  ok(r.ok && pl && pl.name === 'the lantern stone' && pl.kind === 'shrine' && Math.hypot(pl.x - L[0].x, pl.y - L[0].y) < 8 && e3.detail.lever === 'mark_place' && e3.detail.reason === 'something for their scout to read',
    'mark_place near the Fellowship puts a shrine on open ground by them' + (r.ok ? ' at ' + r.at.x + ',' + r.at.y : ': ' + r.error));
  const zl = zoneAt(pl.x, pl.y);
  r = dmAct('mark_place', {kind: 'ruin', near: 'the lantern stone', reason: 'a second marker in that region'});
  const pv = dmAct('pull_lever', {lever: 'mark_place', params: {kind: 'ruin', at: {x: pl.x + 4, y: pl.y}}, reason: 'a second marker in that region'});
  ok(r.ok === false && /^Refused: cooldown/.test(r.error) && pv.ok === false && /^Refused: cooldown/.test(pv.error) && !r.usage, 'a second mark_place in ' + ZONES[zl] + ' meets the lever\'s cooldown, as pull_lever does: ' + r.error);
  r = dmAct('mark_place', {kind: 'ruin', near: '0,0', reason: 'off the map'});
  ok(r.ok === false && /no open ground at 0,0/.test(r.error) && /mark_place needs at: a point/.test(r.error), 'mark_place on bad ground says what the lever needed: ' + r.error.slice(0, 100));
  r = dmAct('mark_place', {near: LANDMARKS[0].name, reason: 'no kind'});
  ok(r.ok === false && /kind is required/.test(r.error) && /mark_place takes params: kind/.test(r.error), 'mark_place without a kind is refused by the lever with its contract');
  // the turn record names the levers
  const tr = S.dmAgent.turns[0];
  ok(tr.levers.some(x => x.name === 'post_hook' && x.ok) && tr.levers.some(x => x.name === 'create_npc' && x.ok) && tr.levers.some(x => x.name === 'mark_place' && x.ok), 'the DM turn record lists the flat pulls by lever');
  // the Fellowship's reserved share: world pulls of create_npc far from them stop short of the daily limit
  {const fo = focus(), lim = LEVERS.create_npc.limits.perDay, far = ZONES.map((n, i) => i).filter(i => !fo.zones.has(i) && ZPTS[i] && ZPTS[i].length);
    let got = null, made = 0; S.levers.day.n.create_npc = 0; S.levers.day.nf = {}; // a fresh day for create_npc
    for (let i = 0; i < lim + 2 && far.length; i++) {const z = far[i % far.length]; S.dmAgent.day.pulls = 0; S.levers.cd = {}; // cooldowns waved through, so the daily share is what stops it
      r = dmAct('place_person', {role: 'drover', near: ZONES[z], reason: 'a drover far off'}); if (r.ok) made++; else if (/kept for the Fellowship/.test(r.error)) {got = r; break}}
    ok(!!got && /^Refused: limit/.test(got.error) && !got.usage, 'the Fellowship\'s reserved share holds for place_person far from them (' + made + ' made, limit ' + lim + ', reserve ' + reserveOf(lim) + '): ' + (got ? got.error : 'never refused'));}
  // the DM agent's own daily cap
  S.dmAgent.day.pulls = DMA.PULLS_PER_DAY;
  for (const [t, a] of [['post_hook', {town: hall, tpl: 'deliver', reason: 'cap'}], ['place_person', {role: 'peddler', near: hall, reason: 'cap'}], ['mark_place', {kind: 'cairn_door', near: LANDMARKS[0].name, reason: 'cap'}]]) {
    r = dmAct(t, a); ok(r.ok === false && /pulled \d+ levers today/.test(r.error), t + ' past DMA.PULLS_PER_DAY is refused: ' + r.error.slice(0, 80));}
  S.dmAgent.day.pulls = 0;
  // issue #467: the place shapes a local model sends ({"x":..} objects, stringified or not, [x,y], "Town,dx,dy") land a marker
  {const gate = (CITY.find(c => c.name === hall) || CITY[0]).gate, tn = (CITY.find(c => c.name === hall) || CITY[0]).name, sx = Math.round(spot.x), sy = Math.round(spot.y);
    const fresh = () => {S.dmAgent.day.pulls = 0; S.levers.cd = {}; S.levers.day.n.mark_place = 0; S.levers.day.n.create_npc = 0; S.levers.day.nf = {}; S.levers.day.rz = {}};
    const shapes = [{x: sx, y: sy}, JSON.stringify({x: sx, y: sy}), `[${sx}, ${sy}]`, `(${sx},${sy})`, `${tn},${+(sx - gate.x).toFixed(1)},${+(sy - gate.y).toFixed(1)}`, `${tn}, ${+(sx - gate.x).toFixed(1)}, ${+(sy - gate.y).toFixed(1)}`];
    for (const near of shapes) {fresh(); r = dmAct('mark_place', {kind: 'cairn_door', near, reason: 'a shape test'});
      const p = r.ok && S.places.find(q => q.id === r.effect.place);
      ok(r.ok && p && Math.hypot(p.x - sx, p.y - sy) < 4.5, 'mark_place near ' + JSON.stringify(near) + ' lands by ' + sx + ',' + sy + (r.ok ? ' (at ' + r.at.x + ',' + r.at.y + ')' : ': ' + r.error));
      if (p) S.places = S.places.filter(q => q !== p)}
    fresh(); r = dmAct('place_person', {role: 'hermit', near: {x: sx, y: sy}, reason: 'a shape test'});
    ok(r.ok && Math.hypot(r.at.x - sx, r.at.y - sy) < 6, 'place_person takes a point object too' + (r.ok ? '' : ': ' + r.error));
    if (r.ok) {S.wanderers = S.wanderers.filter(x => x.id !== r.npc); S.levers.active = S.levers.active.filter(x => x.id !== r.id)} // later checks count the active people
    fresh(); r = dmAct('mark_place', {kind: 'ruin', near: tn + ',20,-15', reason: 'the live shape'});
    ok(r.ok || /no open ground/.test(r.error), '"' + tn + ',20,-15" is read as a spot off ' + tn + ' (kept on the map), not an unknown place: ' + (r.ok ? 'at ' + r.at.x + ',' + r.at.y : r.error.slice(0, 100)));
    if (r.ok) S.places = S.places.filter(q => q.id !== r.effect.place);
    fresh(); r = dmAct('mark_place', {kind: 'ruin', near: '{"x":-5,"y":0}', reason: 'an offset with no town'});
    ok(r.ok === false && /no open ground at -5,0/.test(r.error) && /<town>,dx,dy/.test(r.error), 'a point off the map says how to write an offset: ' + r.error.slice(0, 140));
    fresh(); r = dmAct('mark_place', {kind: 'ruin', near: tn + ',400,400', reason: 'far off'});
    ok(r.ok === false && /off the map as an offset from/.test(r.error), 'an offset far past the edge is refused with the map size: ' + r.error.slice(0, 120));
    fresh()}
  ok(nums() === n1, 'no hero\'s level, XP or life changed through the flat tools');
}

// ---------------------------------------------------------------- 1b. staged scenes: the rules of the seat (issue #132)
console.log('staged scenes: refusals');
{const ST = await import('../src/sim/staged.js'), T = await import('../src/sim/table.js'), {zoneFor, zonePoint} = await import('../src/world/map.js'), {homeOf} = await import('../src/data/races.js');
  const L = fellows(), home = homeOf(L[0]).gate, spot = innerPoint(zonePoint, zoneAt, zoneFor(Math.max(1, L[0].lvl), home), home);
  L.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x)});
  T.TABLE.mode = 'off'; // nothing opens on its own while the refusals are tried
  const frame = 'Mist lies on the road, and something moves in it.', st = (a) => dmAct('stage_scene', {kind: 'mystery', near: 'fellowship', frame, cast: {}, reason: 'test', ...a});
  const no = (a, re, m) => {const x = st(a); ok(x.ok === false && re.test(x.error), m + ': ' + (x.error || 'staged!').replace(/^Refused: /, ''))};
  const n0 = S.dmLog.filter(e => /Staged scene refused/.test(e.summary.map(p => typeof p === 'string' ? p : p && p.t || '').join(''))).length;
  no({kind: 'dragon'}, /kind must be one of/, 'an unknown kind');
  no({reason: ''}, /reason is required/, 'no reason');
  no({frame: 'Mist.'}, /frame/, 'no real frame');
  no({cast: [1, 2]}, /cast must be an object/, 'a cast that is not an object');
  no({near: 'Nowhere-at-all'}, /unknown place/, 'an unknown place');
  // the refusals carry the fix (issue #401): the legal places, the call's contract; a landmark is a place
  {const {LANDMARKS} = await import('../src/world/map.js');
    no({near: 'Nowhere-at-all'}, new RegExp('a member \\(' + L[0].name + '.*a landmark \\(' + LANDMARKS[0].name + '.*or a region \\(' + ZONES[0]), 'an unknown place lists members, landmarks and regions');
    no({near: 'Nowhere-at-all'}, /stage_scene takes: kind \(elite\|ambush/, 'and the call\'s contract');
    no({reason: ''}, /reason \(one sentence/, 'a missing reason names the call\'s contract');
    const lm = LANDMARKS[LANDMARKS.length - 1], pl = st({kind: 'elite', preview: 'true', near: lm.name.replace(/^The /, ''), frame: undefined});
    ok(pl.ok && pl.preview, `a landmark is a place to stage near ("${lm.name.replace(/^The /, '')}"): ` + (pl.cast || pl.error))}
  no({near: CITYN()}, /not inside/, 'inside a town');
  const stranger = S.agents.find(a => !a.fellow && a.state !== 'dead');
  no({near: stranger.name}, /only the Fellowship/, 'a hero outside the Fellowship');
  no({kind: 'elite', cast: {level: Math.max(...L.map(a => a.lvl)) + 6}}, /far above the party/, 'a foe far above the party\'s level');
  no({kind: 'elite', cast: {foe: 'Cinder Wyrm'}}, /lives in/, 'a creature that does not live there');
  no({kind: 'meeting', cast: {role: 'drover'}}, /needs cast.want/, 'a meeting with no want');
  const pvw = st({kind: 'elite', preview: 'true', frame: undefined, reason: undefined});
  ok(pvw.ok && pvw.preview && /^a named /.test(pvw.cast), 'stage_scene preview returns the cast without staging: ' + (pvw.cast || pvw.error));
  no({kind: 'elite', frame: 'A band of armed men blocks the road, their leader shouting threats.'}, /does not fit the cast\. Your elite is a named/, 'a frame of people over a creature (the refusal names the cast)');
  no({kind: 'ambush'}, /does not fit the cast\. Your ambush is a pack of \d+/, 'a frame that names none of the creatures');
  no({kind: 'meeting', cast: {role: 'king', want: 'x'}}, /role must be one of/, 'a role no wanderer has');
  L[1].hp = maxHp(L[1]) * .2;
  no({kind: 'ambush'}, /badly hurt/, `an ambush while ${L[1].name} is at 20% HP in the field`);
  no({kind: 'trap'}, /badly hurt/, 'a trap too');
  L[1].hp = maxHp(L[1]);
  S.table = {id: 0, kind: 'check', ids: [], ctx: {}, calls: null}; no({}, /Table scene is open/, 'while a Table scene is open'); S.table = null;
  const P0 = {id: 999, status: 'open', kind: 'other', votes: {}, by: L[0].id, details: 'x'}; (S.fellowship.props || (S.fellowship.props = [])).push(P0);
  no({}, /vote is open/, 'while a party vote is open'); P0.status = 'failed';
  const okR = st({}); ok(okR.ok && okR.staged, `a mystery is staged: ${okR.title} ${okR.where}`);
  no({kind: 'meeting', cast: {role: 'drover', want: 'a hand'}}, /one at a time/, 'a second one while the first waits');
  S.staged.cur.phase = 'done'; S.staged.day.n = ST.STAGE.PER_DAY;
  no({}, /staged scenes today/, `past ${ST.STAGE.PER_DAY} a day`);
  S.staged.day.n = 0;
  ok(S.dmLog.filter(e => /Staged scene refused/.test(e.summary.map(p => typeof p === 'string' ? p : p && p.t || '').join('')) && e.detail.by === 'dm-agent').length === n0 + 22, 'every refusal is in the DM log, tagged dm-agent');
  ok(S.dmLog.some(e => e.kind === 'frame' && e.detail.by === 'dm-agent' && e.detail.staged === okR.staged && e.detail.reason === 'test'), 'the staging is in the DM log with its reason');
  const ds = dmAct('dm_status'); ok(ds.ok && ds.staged && /\/3$/.test(ds.staged.today), `dm_status shows the day's staged scenes (${ds.staged && ds.staged.today})`);
  const tc = dmAct('table_call'); ok(tc.ok && tc.call === null && tc.scene === null, 'table_call with nothing at the table: no call');
  ok(dmAct('table_answer', {call: 1, text: 'x'}).ok === false, 'table_answer with nothing at the table is refused');
  T.TABLE.mode = 'auto'}
function CITYN() {return S.agents.length && (S.fellowship.hall || 'Highgate')}

// ---------------------------------------------------------------- 1b2. staged scenes in a setting (issue #431, slice 2)
console.log('staged scenes: settings and towns');
{const ST = await import('../src/sim/staged.js'), T = await import('../src/sim/table.js'), {SETTING_IDS} = await import('../src/data/settings.js'), {CITY} = await import('../src/world/map.js');
  const L = fellows(), F = S.fellowship, hall = CITY.find(c => c.name === F.hall) || CITY.find(c => c.fac === F.fac), enemy = CITY.find(c => c.fac !== F.fac);
  T.TABLE.mode = 'off'; S.staged.cur = null; S.staged.day.n = 0; S.staged.day.nw = 0; S.table = null;
  const meet = (a) => dmAct('stage_scene', {kind: 'meeting', frame: 'A woman in a grey shawl waits with a cup she has not touched.', cast: {role: 'stranger', want: 'news of her brother'}, reason: 'settings test', ...a});
  const no = (a, re, m) => {const x = meet(a); ok(x.ok === false && re.test(x.error), m + ': ' + (x.error || 'staged!').replace(/^Refused: /, '').slice(0, 160))};
  no({near: 'fellowship', setting: 'throne room'}, new RegExp('unknown setting "throne room"; setting takes one of: ' + SETTING_IDS.join('.*')), 'an unknown setting is refused with every valid one');
  no({at: 'Nowhere-town'}, /unknown town in at .*at takes a town \(/, 'an unknown town in at is refused with the towns');
  no({at: 'the barbican in ' + hall.name}, new RegExp('no building "barbican" in ' + hall.name + '.*inn'), 'an unknown building is refused with the town\'s buildings');
  if (enemy) no({at: enemy.name}, /enemy town/, 'a town of the other faction is refused');
  ok(ST.settingOf('Ship\'s hold').id === 'hold' && ST.settingOf('a tavern back room').id === 'tavern' && ST.settingOf('interrogation').id === 'cell' && ST.settingOf('').id === undefined, 'a setting is read from its key, its name or a plain word');
  ok(ST.atOf(hall.name + ' forge').spot === 'smith' && ST.atOf('the inn in ' + hall.name).spot === 'inn' && ST.atOf(hall.name).spot === null, 'at reads a town alone or a building in it');
  // outdoor kinds ignore it, with a note
  const pv = dmAct('stage_scene', {kind: 'elite', near: 'fellowship', preview: 'true', reason: 'x', setting: 'house'});
  ok(pv.ok && /setting was ignored/.test(pv.setting_note || ''), 'an elite ignores setting, with a note: ' + (pv.setting_note || pv.error));
  const pv2 = dmAct('stage_scene', {kind: 'mystery', near: 'fellowship', preview: 'true', reason: 'x', setting: 'chapel', at: hall.name});
  ok(pv2.ok && /both were ignored/.test(pv2.note || '') && !pv2.setting, 'a mystery ignores setting and at, with a note: ' + (pv2.note || pv2.error));
  // the whole Fellowship in town: near "fellowship" points to at
  L.forEach(x => {x.state = 'town'; x.town = hall.name; x.x = hall.spots.square.x; x.y = hall.spots.square.y; x.hidden = false; x.target = null; x.dest = null});
  no({near: 'fellowship'}, /whole Fellowship is in town.*pass at/, 'a meeting near the Fellowship when all are in town points to at');
  // set in town with a named room: the person waits at the building; the scene opens in that room when a member is in town
  L.forEach(x => {x.x = hall.gate.x + 25; x.y = hall.gate.y; x.state = 'hunt'});
  const r = meet({at: 'the chapel in ' + hall.name, setting: 'chapel'});
  ok(r.ok && r.setting === 'chapel' && r.where === 'A chapel in ' + hall.name && !r.setting_picked && r.waits_until_h === ST.STAGE.TOWN_WAIT_MIN / 60, 'a meeting is staged in a town, in a chapel: ' + (r.where || r.error));
  const w = S.wanderers.find(x => x.staged === r.staged);
  ok(w && w.town === hall.name && Math.hypot(w.x - hall.spots.chapel.x, w.y - hall.spots.chapel.y) < .01, 'the person waits at the chapel in ' + hall.name);
  ok(dmAct('dm_status').staged.cur.setting === 'chapel', 'dm_status names the staged scene\'s setting');
  T.TABLE.mode = 'auto'; T.tableTick(); ok(!S.table, 'nobody of the Fellowship is in town: the scene waits');
  L[0].x = hall.spots.square.x; L[0].y = hall.spots.square.y; L[0].state = 'town'; T.tableTick();
  ok(S.table && S.table.kind === 'meeting' && S.table.ctx.setting === 'chapel' && S.table.ctx.town === hall.name && S.table.ids.includes(L[0].id), 'a member in town opens the scene in that setting (ctx.setting, ctx.town)');
  S.table = null; T.tableTick(); S.table = null; S.staged.cur.phase = 'done';
  const drop = () => {const gone = S.wanderers.filter(x => x.staged != null && x.staged >= r.staged); S.levers.active = S.levers.active.filter(a => !gone.some(g => g.lever === a.id)); S.wanderers = S.wanderers.filter(x => !gone.includes(x))};
  drop(); // the people lever keeps 6 at most
  // no setting named: the game picks one that fits (a meeting with no words for a room: the tavern back room, at the inn)
  S.staged.day.n = 0; S.staged.day.nw = 0; for (const k in S.levers.cd) if (k.startsWith('create_npc')) delete S.levers.cd[k]; L[0].x = hall.gate.x + 25; L[0].state = 'hunt';
  const r2 = meet({at: hall.name, title: 'A quiet word'});
  const w2 = r2.ok && S.wanderers.find(x => x.staged === r2.staged);
  ok(r2.ok && r2.setting === 'tavern' && r2.setting_picked && w2 && Math.hypot(w2.x - hall.spots.inn.x, w2.y - hall.spots.inn.y) < .01, 'with no setting the game picks a fitting one (a meeting: the tavern back room, at the inn): ' + (r2.where || r2.error));
  ok(ST.fitSetting('social', {frame: 'The prisoner is brought up in chains for questioning.'}) === 'cell' && ST.fitSetting('social', {}) === 'house' && ST.fitSetting('meeting', {spot: 'chapel'}) === 'chapel', 'the scripted pick: the building, then the words, then the kind');
  if (r2.ok) S.staged.cur.phase = 'done';
  const ds = dmAct('dm_status').staged;
  ok(SETTING_IDS.every(k => ds.settings[k]) && /setting/.test(ds.settings_note) && /at \(a town/.test(ds.settings_note), 'dm_status lists the settings and how to set a scene in a town');
  drop(); S.staged.day.n = 0; S.staged.day.nw = 0; for (const k in S.levers.cd) if (k.startsWith('create_npc')) delete S.levers.cd[k];
  L.forEach(x => {x.state = 'hunt'; x.hp = maxHp(x)})}

// ---------------------------------------------------------------- 1c. NPC conversations (issue #170)
console.log('NPC conversations');
{const TK = await import('../src/sim/talk.js'), P = await import('../src/sim/player.js'), F_ = await import('../src/sim/fellowship.js');
  const {homeOf} = await import('../src/data/races.js'), {SLOTS} = await import('../src/data/items.js');
  const L = fellows(), A = L[0], B = L[1], c0 = homeOf(A);
  F_.setMinds('agent'); for (const x of L) x.hp = maxHp(x);
  const npc = role => S.npcs.find(p => p.town === c0.name && p.role === role);
  const beside = (a, p, dx = 1) => {a.state = 'town'; a.town = c0.name; a.x = p.x + dx; a.y = p.y; a.pq = []; a.target = null; a.dest = null; a.hidden = false};
  const away = () => {for (const x of L) {x.x = c0.gate.x + 30; x.y = c0.gate.y}};
  const act = (a, tool, args) => {a.playRate = []; return P.playerAct(a.id, tool, args || {})};
  const clear = () => {TK.CONV.PER_DAY = 99; for (const c of (S.talks ? S.talks.cur.slice() : [])) {c.state = 'done'; S.talks.cur.splice(S.talks.cur.indexOf(c), 1)} for (const p of S.npcs) {delete p.snub; delete p.trade}};
  const secret = 'QZXjournal' + Math.floor(Math.random() * 1e9).toString(36) + 'Q';
  P.playerAct(A.id, 'journal_write', {text: 'Private: ' + secret}); P.playerAct(A.id, 'remember', {title: 'mine', text: 'Private memory ' + secret});
  // a silent seat: the DM agent is not polling, so the scripted DM answers at once from the role
  away(); clear(); const qm = npc('quartermaster'); beside(A, qm); setDmSeat(false); // nobody in the seat
  let r = act(A, 'talk', {target: 'quartermaster', text: 'Good day. What do you have for the road?'});
  ok(r.ok && r.answer && !r.waiting && r.follow_up === '[trade opened]', `a silent seat: the scripted DM answers at once, ${qm.title} opens their stock ("${r.answer}")`);
  ok(/^You read .*: they want |^You listen to .*, but cannot tell what they really want\.$/.test(r.read || '') && S.dmLog.some(e => e.kind === 'talk' && e.detail.skill === 'empathy'), `the member reads the person (Empathy on Insight): "${r.read}"`);
  ok(qm.trade && qm.mood && typeof qm.warmth === 'number', `the person's record: mood ${qm.mood}, warmth ${qm.warmth}`);
  setDmSeat(true);
  A.x = c0.gate.x + 8; A.y = c0.gate.y; A.state = 'hunt'; A.gold = 200;
  r = act(A, 'buy', {npc: qm.name, item: 'Linen Bandage', count: 2});
  ok(r.ok === false && /too far/.test(r.error), 'buying from them out of reach is refused');
  beside(A, qm); A.state = 'hunt'; // standing by them, but not "in town": the trade goes through the person
  r = act(A, 'buy', {npc: qm.name, item: 'Linen Bandage', count: 2}); ok(r.ok && /Linen Bandage x2/.test(r.bought), `buy {npc} from the person: ${r.bought} for ${r.cost}g`);
  const invM = await import('../src/sim/inv.js'); invM.addGood(A, Object.keys((await import('../src/data/items.js')).GOODS)[0], 2);
  r = act(A, 'sell', {npc: qm.name}); ok(r.ok && r.gold_gained > 0, `sell {npc} to the person: ${r.sold} item(s) for ${r.gold_gained}g`);
  ok(S.dmLog.some(e => e.kind === 'talk' && e.detail.trade), 'the trade is in the DM log');
  // the DM agent listening: the member's line waits for it; npc_call carries what it needs and nothing private
  away(); clear(); const smith = npc('smith'); beside(A, smith);
  dmAct('npc_call'); r = act(A, 'talk', {target: smith.name, text: 'Can you mend this blade by nightfall?'});
  ok(r.ok && r.waiting && !r.answer, 'with the DM voice polling, the member\'s line waits for the DM');
  let call = dmAct('npc_call'); const cl = call.call;
  ok(cl && cl.npc.name === smith.title + ' ' + smith.name && cl.member.name === A.name && cl.line === 'Can you mend this blade by nightfall?' && cl.offers.includes('trade') && cl.npc.want && cl.so_far.length,
    `npc_call: ${cl && cl.npc.name}, ${cl && cl.npc.role}, wants "${cl && cl.npc.want}", offers ${cl && cl.offers.join('/')}`);
  ok(typeof cl.member.read_them === 'boolean', `the DM sees whether the member read them (read_them ${cl.member.read_them})`);
  ok(!JSON.stringify(call).includes(secret) && !JSON.stringify(dmAct('dm_status')).includes(secret), 'npc_call and dm_status never carry a member\'s journal or memories');
  ok(dmAct('dm_status').conversations.some(c => c.waiting && c.conv === cl.conv), 'dm_status lists the waiting conversation');
  const npcSay0 = S.dmAgent.day.npc || 0;
  r = dmAct('npc_say', {npc: String(smith.id), conv: cl.conv, text: 'By nightfall, if you pay for the charcoal.', warmth: 1, remember: 'Promised the tank a mended blade by nightfall.'});
  ok(r.ok && r.answered && (S.dmAgent.day.npc || 0) === npcSay0, 'npc_say {conv} answers the member (outside the 16 npc_say lines a day)');
  step(1 / 60); ok((A.chat || []).some(e => e.talk === cl.conv && /charcoal/.test(e.text)) && A.playEv.some(e => /charcoal/.test(e.text) && e.w === 2), 'the member hears the answer in the game (chat, and an event that wakes them at once)');
  r = dmAct('npc_offer', {npc: String(smith.id), kind: 'trade'}); ok(r.ok && r.mark === '[trade opened]', 'npc_offer trade: [trade opened]');
  ok((A.chat || []).some(e => e.talk === cl.conv && e.mark === '[trade opened]'), 'the mark sits on the person\'s line (for the chat panel)');
  r = dmAct('npc_offer', {npc: String(smith.id), kind: 'rumour', about: 'x'}); ok(r.ok === false && /one follow-up per exchange/.test(r.error), 'a second follow-up in the same exchange is refused');
  ok(dmAct('npcs', {town: c0.name}).townsfolk.some(n => n.id === smith.id && n.fellowship && n.fellowship.notes.some(t => /nightfall/.test(t))), 'npcs shows the person\'s record of the Fellowship (the promise)');
  // more exchanges: a rumour with a map marker, then a job, then the conversation closes
  act(A, 'say', {text: 'What do you hear from the roads?'}); call = dmAct('npc_call');
  const region = S.fellowship && (await import('../src/world/map.js')).ZONES[1];
  r = dmAct('npc_offer', {npc: String(smith.id), conv: call.call.conv, kind: 'rumour', text: 'Ore carts stopped coming from the hills.', about: 'The ore road is blocked by something big; the carters will not go.', region});
  ok(r.ok && r.mark === '[rumour]' && (r.place == null || S.places.some(q => q.id === r.place)), `npc_offer rumour (with text as the answer): ${r.hint}`);
  ok(A.playEv.some(e => /\[rumour\]/.test(e.text)) && (A.memory && A.memory.recent.some(m => /ore road/.test(m.text))), 'the lead reaches the member as an event and in their memory');
  act(A, 'say', {text: 'Is there work for us?'}); call = dmAct('npc_call');
  const jobs0 = (S.adventures || []).filter(h => h.phase === 'open' && h.for === A.id).length;
  r = dmAct('npc_offer', {npc: String(smith.id), conv: call.call.conv, kind: 'job', text: 'Bring back what the carters lost and I will pay.', tpl: 'relic'});
  ok(r.ok && r.mark === '[job posted]' && (S.adventures || []).filter(h => h.phase === 'open' && h.for === A.id).length === jobs0 + 1, `npc_offer job: ${r.hint}`);
  // a job needs an answer (#407): it opens a talk scene; the DM agent voices the person's reply to the company's choice
  ok(r.table && S.table && S.table.kind === 'talk' && S.table.ctx.why === 'offer', 'the job offered opens a talk scene at the table (#407)');
  {let f = 0; while (S.table && f++ < 60 * 60) step(1 / 60)}
  call = dmAct('npc_call'); ok(!S.table && call.call && /at the table/.test(call.call.line || ''), `the DM is asked to voice the answer: ${call.call && call.call.line}`);
  dmAct('npc_say', {conv: call.call.conv, text: 'Good. Then go.'});
  act(A, 'say', {text: 'Then we are agreed.'}); call = dmAct('npc_call');
  r = dmAct('npc_say', {conv: call.call.conv, text: 'Agreed. Go.'}); // conv alone names the person (issue #401)
  ok(r.ok && r.ended && !TK.convWith(smith), `after ${TK.CONV.EXCHANGES} exchanges the conversation ends (${r.ended})`);
  ok(S.talks.past[0] && S.talks.past[0].offers.join() === 'trade,rumour,job', 'the past conversation keeps its follow-ups');
  // a polled but silent DM: the scripted DM answers after the budget
  away(); clear(); const inn = npc('innkeeper'); beside(A, inn); TK.CONV.VOICE_MS = 60;
  dmAct('npc_call'); r = act(A, 'talk', {target: 'innkeeper', text: 'Any news?'});
  ok(r.waiting, 'the DM is polling: the line waits');
  const tw = Date.now(); while (Date.now() - tw < 90) {} step(1 / 60);
  ok(S.talks.stats.late >= 1 && (A.chat || []).some(e => e.talk && e.from.id === inn.id && e.by === 'scripted'), 'past the budget the scripted DM answers for them (late counted)');
  TK.CONV.VOICE_MS = 8000;
  {away(); clear(); const bd = npc('bard'); beside(A, bd); dmAct('npc_call', {budget_s: 20}); act(A, 'talk', {target: 'bard', text: 'A song?'});
    const cw = TK.convWith(bd); ok(cw && cw.wait && cw.wait.ms === 20000, 'a slower voice asks for a longer wait (npc_call budget_s 20 -> 20 s)');
    dmAct('npc_call', {budget_s: 999}); clear(); act(A, 'talk', {target: 'bard', text: 'Another?'}); const cx = TK.convWith(bd); ok(cx && cx.wait && cx.wait.ms === TK.CONV.VOICE_MAX, `held to at most ${TK.CONV.VOICE_MAX / 1000} s`); clear()}
  // blessing (priests and hermits only), leave
  away(); clear(); const pr = npc('priest'); beside(A, pr); dmAct('npc_call');
  act(A, 'talk', {target: 'priest', text: 'Will you bless us before the road?'}); call = dmAct('npc_call'); A.blessed = 0;
  ok(call.call.offers.includes('blessing'), 'a priest may bless');
  r = dmAct('npc_offer', {npc: String(pr.id), kind: 'blessing', text: 'Kneel, then.'}); ok(r.ok && A.blessed === 1, 'npc_offer blessing: the member is blessed');
  act(A, 'say', {text: 'One more thing, father.'}); dmAct('npc_call');
  r = dmAct('npc_offer', {npc: String(pr.id), kind: 'leave', text: 'Another time.'});
  ok(r.ok && r.mark === '[leaves]' && !TK.convWith(pr), 'npc_offer leave ends it');
  r = act(A, 'talk', {target: 'priest', text: 'Wait!'}); ok(r.ok && r.ended && /turns away/.test(r.answer), 'and they will not talk to that member for a while');
  // combat: refused while a member near is badly hurt; then a staged ambush, and the person turns hostile
  away(); clear(); const capt = npc('captain'); beside(A, capt); beside(B, capt, 1.6); dmAct('npc_call');
  act(A, 'talk', {target: 'captain', text: 'Your gate tax is robbery.'}); call = dmAct('npc_call');
  B.hp = maxHp(B) * .2; const cc = dmAct('npc_call').call;
  ok(!cc.offers.includes('combat'), 'combat is not among the legal follow-ups while a member near is badly hurt');
  r = dmAct('npc_offer', {npc: String(capt.id), kind: 'combat', text: 'Guards! Take them!'});
  ok(r.ok === false && /badly hurt/.test(r.error) && !(A.chat || []).some(e => /Take them/.test(e.text)), 'a hostile follow-up is refused while a member is badly hurt (and the line is not spoken)');
  B.hp = maxHp(B); if (S.staged) {S.staged.day.n = 0; if (S.staged.cur) S.staged.cur.phase = 'done'}
  r = dmAct('npc_offer', {npc: String(capt.id), kind: 'combat', text: 'Then pay in blood.', frame: 'At a whistle, beasts break from the brush outside the gate and bar the way.'});
  ok(r.ok && r.mark === '[combat]' && S.staged.cur && S.staged.cur.kind === 'ambush' && capt.hostile && capt.mood === 'hostile' && /outside the .* gate/.test(r.hint),
    'npc_offer combat in town stages an ambush outside the gate; the person is hostile (mood hostile, hostile true)' + (r.ok ? '' : ': ' + r.error));
  if (S.staged && S.staged.cur) S.staged.cur.phase = 'done';
  // background heroes stay silent: a non-member agent hero's talk keeps the old greeting
  const bg = S.agents.find(a => !a.fellow && a.state !== 'dead' && a.fac === A.fac);
  if (bg) {P.markPlayer(bg, true); beside(bg, smith, -1); const n0 = S.talks.stats.opened; r = P.playerAct(bg.id, 'talk', {target: 'smith'});
    ok(r.ok && S.talks.stats.opened === n0 && !r.waiting, 'a background hero\'s talk opens no conversation (the old greeting)'); P.markPlayer(bg, false)}
  // no style cap on what the DM says (owner): long lines pass whole, up to a technical ceiling
  {const long = 'The rain has not stopped for three days and the ford is running high. '.repeat(9).trim(); beside(A, smith);
    const nr = dmAct('narrate', {text: long, near: A.name}), ns = dmAct('npc_say', {npc: String(smith.id), text: long});
    ok(nr.ok && nr.narrated === long && ns.ok && ns.said === long && long.length > 600, `narrate and npc_say keep a ${long.length}-character line whole`);
    ok(dmAct('npc_say', {npc: String(smith.id), text: 'x'.repeat(5000)}).said.length === DMA.NPC_SAY_MAX, `with a technical ceiling of ${DMA.NPC_SAY_MAX} characters`)}
  // names as models write them (issue #401): spaces dropped, a near miss names the closest people
  {const squeezed = (smith.title + smith.name).replace(/\s+/g, ''), ns = dmAct('npc_say', {npc: squeezed, text: 'Mind the forge.'});
    ok(ns.ok && ns.who === smith.title + ' ' + smith.name, `npc_say finds "${squeezed}" ignoring spaces`);
    const miss = dmAct('npc_say', {npc: smith.name.slice(0, -1) + 'q', text: 'x'});
    ok(miss.ok === false && /Did you mean .*\(id /.test(miss.error) && miss.did_you_mean.some(p => p.id === smith.id), 'a near miss names the closest people with ids: ' + miss.error.slice(0, 120));
    const none = dmAct('npc_say', {text: 'x'}); ok(none.ok === false && /npc is required/.test(none.error) && /conv alone/.test(none.error), 'no npc and no conv says what npc takes')}
  // saved with the world
  const snapT = JSON.parse(JSON.stringify(snapshot())); restore(snapT);
  const cap2 = S.npcs.find(p => p.id === capt.id), sm2 = S.npcs.find(p => p.id === smith.id);
  ok(sm2.fmem && sm2.fmem.notes.length && typeof sm2.warmth === 'number' && S.talks && S.talks.past.length, 'the people\'s records and the conversations survive snapshot -> JSON -> restore');
  if (cap2.hostile) ok(cap2.mood === 'hostile', 'a hostile person stays hostile after a reload');
  away(); clear()}

// ---------------------------------------------------------------- 2. save and restore
console.log('save and restore');
const before = JSON.stringify(S.dmAgent.notes), day0 = S.dmAgent.day.pulls;
const snap = JSON.parse(JSON.stringify(snapshot()));
setDmSeat(false); S.dmAgent.notes.threads = []; run(5);
ok(!dmSeatOn(), 'the seat closed and the notes scribbled over');
restore(snap);
ok(dmSeatOn() && JSON.stringify(S.dmAgent.notes) === before && S.dmAgent.day.pulls === day0 && S.dmAgent.world, 'notes, the open seat and the day\'s counts survive snapshot -> JSON -> restore');
ok(dmAct('notes_read', {section: 'threads'}).notes.threads.length === 2, 'notes_read works on the restored world');
run(10);
ok(S.gameMin > snap.gameMin, 'the restored world runs on');

// the per-turn record (issue #181): saved with the world, old saves load
console.log('the per-turn record');
{
  const D = S.dmAgent, T0 = D.turns;
  ok(Array.isArray(T0) && T0.length >= 1 && T0[0].calls > 0, `every call lands in a turn (${T0 && T0.length} turn, ${T0 && T0[0].calls} calls)`);
  const open = T0[0];
  ok(open.open && open.levers.length + open.notes.length > 0 && open.reads.dm_status >= 1 && open.tools.notes_write && open.day >= 1 && /^\d\d:\d\d$/.test(open.t) && open.gm0 <= open.gm1, 'a turn holds its day, clock, tools with ok/bad, reads, notes and levers');
  ok(open.levers.some(l => !l.ok) && open.errors > 0, 'a refused lever shows as refused in the turn');
  const n0 = T0.length;
  r = dmAct('turn_end', {turn: 3, model: 'claude-sonnet-5-5', provider: 'anthropic', cost: 0.0123456789, seconds: 14.26, tokensIn: 9000, tokensOut: 400});
  ok(r.ok && !D.turns[0].open && D.turns[0].cost === 0.012346 && D.turns[0].model === 'claude-sonnet-5-5' && D.turns[0].seconds === 14.3 && D.turns[0].turn === 3 && D.turns.length === n0, 'turn_end closes the turn with the runner cost, model and seconds');
  ok(dmAct('turn_end', {cost: -5, seconds: 'x', model: 'm'.repeat(200)}).ok && D.turns.length === n0 + 1 && D.turns[0].cost === undefined && D.turns[0].model.length <= 60, 'a bad number is dropped, a turn with no calls still gets its entry');
  dmAct('dm_status'); dmAct('log_intent', {text: 'next turn'});
  ok(D.turns.length === n0 + 2 && D.turns[0].open && D.turns[0].id === D.turns[1].id + 1, 'the next call opens a new turn');
  ok(!DM_TOOLS.some(t => t.name === 'turn_end'), 'turn_end is not a tool the agent can call');
  for (let i = 0; i < DMA.TURNS_KEEP + 5; i++) {dmAct('turn_end', {}); dmAct('dm_status')}
  ok(D.turns.length === DMA.TURNS_KEEP, `the record is a ring of ${DMA.TURNS_KEEP}`);
  const snapR = JSON.parse(JSON.stringify(snapshot())); const keep = JSON.stringify(D.turns); D.turns = []; restore(snapR);
  ok(JSON.stringify(S.dmAgent.turns) === keep, 'the turn record survives snapshot -> JSON -> restore');
  const old = JSON.parse(JSON.stringify(snapshot())); delete old.dmAgent.turns; delete old.dmAgent.tseq; delete old.dmAgent.tv; restore(old);
  ok(S.dmAgent.turns === undefined && dmAct('dm_status').ok && S.dmAgent.turns.length === 1 && S.dmAgent.turns[0].calls === 1, 'an older save with no record loads and starts one');
  // the relay hands the runner's turn report to the game
  const seen = []; const srv = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
  const bk = localBackend(); const turns = [];
  attachPlay(srv, {backend: {...bk, dmCall: (t, a) => (t === 'turn_end' ? turns.push(a) : 0, bk.dmCall(t, a))}, log: () => {}, behavior: {turn: x => seen.push(x), call: () => {}, event: () => {}}});
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const U = `http://127.0.0.1:${srv.address().port}`;
  const p2 = (path, body) => fetch(U + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(async x => ({status: x.status, ...(await x.json())}));
  await p2('/play/claim', {role: 'dm', runner: 'rt:1', provider: 'anthropic', model: 'claude-sonnet-5-5'});
  const bad = await p2('/play/behavior/turn', {role: 'dm', runner: 'rt:2', rec: {turn: 1, cost: 1}});
  ok(bad.status === 409 && !turns.length, 'only the runner holding the seat reports a turn to the game');
  const good = await p2('/play/behavior/turn', {role: 'dm', runner: 'rt:1', rec: {turn: 7, cost: 0.02, seconds: 9, tokensIn: 100, tokensOut: 20, tools: [{name: 'dm_status', ok: true}]}});
  ok(good.status === 200 && turns.length === 1 && turns[0].cost === 0.02 && turns[0].model === 'claude-sonnet-5-5' && S.dmAgent.turns[0].turn === 7 && S.dmAgent.turns[0].cost === 0.02, 'the relay passes the turn report (cost, model, seconds) to the game and the turn record shows it');
  await new Promise(res => srv.close(res));
}
// leaks: the record is DM-only
{
  const src = f => readFileSync(join(ROOT, f), 'utf8');
  ok(!['src/sim/player.js', 'src/sim/notify.js', 'src/sim/brain.js', 'src/data/player-tools.js', 'src/sim/persona.js', 'src/sim/memory.js'].some(f => existsSync(join(ROOT, f)) && /dmAgent\.turns|dmTurnLog|turn_end/.test(src(f))), 'no hero-side module reads the DM turn record');
}

// ---------------------------------------------------------------- 2b. the Fellowship first (issue #165)
console.log('the Fellowship first');
{const FO = await import('../src/sim/dmfocus.js'), ST = await import('../src/sim/staged.js'), {pull} = await import('../src/sim/levers.js'), DA = await import('./dm-agent.mjs');
  const fo = FO.focus();
  ok(!!fo && fo.ids.size >= 1 && fo.town && fo.zones.size >= 1, 'the DM knows the Fellowship: hall town and the regions it rides');
  r = dmAct('dm_status');
  const keys = Object.keys(r);
  ok(r.ok && typeof r.fellowship_first === 'string' && keys.indexOf('fellowship_needs') >= 0 && keys.indexOf('fellowship_needs') < keys.indexOf('table') && keys.indexOf('fellowship_needs') < keys.indexOf('adventures'), 'dm_status lists the Fellowship first: fellowship_first and fellowship_needs come before the world');
  const n = r.fellowship_needs;
  ok(n && typeof n.summary === 'string' && n.summary.length > 10 && Array.isArray(n.items) && 'quiet' in n && n.share_of_dm_actions, 'fellowship_needs: a short summary, the items (threads, scenes, hurt members) and the share of DM actions so far: ' + (n && n.summary));
  ok(typeof r.fellowship_change === 'string' && r.fellowship_change.length > 0, 'fellowship_change is a signature of their situation (' + r.fellowship_change + ')');
  const sig0 = r.fellowship_change; S.fellowship.past.push({id: -1, name: 'Test'});
  ok(dmAct('dm_status').fellowship_change !== sig0, 'a fallen member changes the signature'); S.fellowship.past.pop();
  // the runner's bounded, event-driven cadence
  const st = {ok: true, day: 3, gameMin: 4000, fellowship_change: 'b'};
  ok(DA.eventDue(st, {sig: 'a', gm: 3000}, {day: 3, n: 0}) === true, 'cadence: a changed situation makes an extra turn due');
  ok(!DA.eventDue({...st, fellowship_change: 'a'}, {sig: 'a', gm: 3000}, {}) && !DA.eventDue(st, {sig: 'a', gm: 3000}, {day: 3, n: DA.EVENT_MAX}) && !DA.eventDue(st, {sig: 'a', gm: 3950}, {}) && !DA.eventDue(st, {sig: null, gm: 3000}, {}), 'cadence: nothing new, the day cap and the minimum gap each hold it back');
  ok(/Fellowship first:/.test(DA.dmTurnPrompt(2, {...r, day: 3, part: 'day'})) && /The Fellowship comes first/.test(DA.dmSystemPrompt(r)) && /The Fellowship comes first/.test(DA.withDmFellowshipOrders('old prompt')), 'the standing orders and every turn prompt start with the Fellowship');
  {const {WANDER_ROLES} = await import('../src/data/npcs.js'), sysC = DA.dmSystemPrompt(r), C = DA.DM_CALL_ORDERS;
    ok(sysC.includes(C) && DA.withDmCallOrders('old prompt').includes(C) && DA.withDmCallOrders(sysC) === sysC
      && WANDER_ROLES.every(w => C.includes(w.id)) && /stage_scene needs kind, near, frame and reason/.test(C) && /never two together/.test(C) && /npc_say and npc_offer always need npc/.test(C) && /whole Fellowship is in town/.test(C),
      'the standing orders spell out whole calls, exact places and people, and no staging in town (#388), and reach an older session once');}
  // the reserved share of the daily limits
  const far = ZONES.map((_, z) => z).find(z => !fo.zones.has(z) && (ZPTS[z] || []).length);
  const md = p => Math.min(...fo.members.map(m => Math.hypot(m.x - p.x, m.y - p.y))), zp = ZPTS[far].slice().sort((p, q) => md(q) - md(p))[0], L0 = S.levers; // the point farthest from every member (the company may be spread, camp rest) L0.day.d = -1;
  const fn = z => pull('mark_cleared', {at: {x: zp.x, y: zp.y}, r: 3, hours: 4}, {by: 'scripted', reason: 'test'});
  S.levers.day = {d: Math.floor(S.gameMin / 1440), n: {mark_cleared: 4}, rz: {}, nf: {mark_cleared: 4}};
  const rf = fn();
  ok(!rf.ok && /kept for the Fellowship/.test(rf.reason), 'the world cannot use the reserved share of a daily limit: ' + (rf.reason || 'pulled'));
  S.levers.day = {d: Math.floor(S.gameMin / 1440), n: {}, rz: {}, nf: {}}; S.levers.cd = {};
  const ra = fn();
  ok(ra.ok && S.levers.day.nf.mark_cleared === 1, 'a world pull below the reserve still goes through and is counted (' + (ra.reason || 'ok') + ')');
  const near = fo.members[0], pn = {x: Math.round(near.x), y: Math.round(near.y)};
  ok(FO.pullTouches('mark_cleared', {at: pn}, zoneAt(pn.x, pn.y), fo) && !FO.pullTouches('mark_cleared', {at: zp}, far, fo), 'a pull at the side of a member concerns the Fellowship; one in a far region does not');
  const G = ST.stagedState(); G.cur = null; G.day = {d: Math.floor(S.gameMin / 1440), n: 2, nw: 2};
  const stg = dmAct('stage_scene', {kind: 'mystery', near: Math.round(zp.x) + ',' + Math.round(zp.y), frame: 'A cairn stands crooked on the far moor, a lantern burning in it.', reason: 'test the reserve'});
  ok(stg.ok === false && /kept for the Fellowship|spot|outside|tile|ground|far/.test(stg.error), 'a staged scene far from the Fellowship cannot take the last slot of the day: ' + stg.error);
  G.day = {d: -1, n: 0, nw: 0}; G.cur = null;
}
{ // the scripted DM, alone, with a Fellowship: most of what it does concerns them, and it is deterministic
  // one seeded world is a single draw (a small change to hero dice moves the share by 15 points), so pool three seeds
  const focusRun = sd => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--focus'], {cwd: ROOT, encoding: 'utf8', env: {...process.env, DMCHECK_SEED: String(sd)}});
  const runs = [66, 1, 2].map(sd => ({sd, r: focusRun(sd)})), parsed = runs.map(({sd, r}) => {
    const line = (r.stdout || '').trim().split(/\r?\n/).pop(), m = /^FOCUS (\{.*\}) H/.exec(line);
    return {sd, st: m ? JSON.parse(m[1]) : null, line: line || r.stderr.slice(-300)};
  });
  const good = parsed.filter(p => p.st), acts = good.reduce((t, p) => t + p.st.acts, 0), fel = good.reduce((t, p) => t + p.st.fellow, 0), share = acts ? fel / acts : 0;
  ok(good.length === parsed.length && acts >= 18 && share > 0.5,
    'with a Fellowship, most DM actions concern it (pooled over seeds 66, 1, 2): ' + fel + ' of ' + acts + ' (' + Math.round(share * 100) + '%); ' + parsed.map(p => p.st ? 'seed ' + p.sd + ' ' + p.st.fellow + '/' + p.st.acts + ' (' + Math.round(p.st.share * 100) + '%)' : 'seed ' + p.sd + ' ' + p.line).join(', '));
  const run1 = runs[0].r, run2 = focusRun(66);
  ok((run2.stdout || '').trim() === (run1.stdout || '').trim(), 'the scripted DM is deterministic under the same seed (same actions, same share)');
}

{ // every company a thread (issue #450): hall jobs per company, companies_needs neediest first, the standing orders, the share
  const kid = (arg, tag) => {const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), arg], {cwd: ROOT, encoding: 'utf8'}), l = (r.stdout || '').trim().split(/\r?\n/).pop(), m2 = new RegExp('^' + tag + ' (\\{.*\\})').exec(l); return m2 ? JSON.parse(m2[1]) : {err: l || (r.stderr || '').slice(-400)}};
  const c = kid('--companies', 'COMPANIES');
  ok(!c.err && c.made && c.followedFirst && c.shim && c.focuses.split(',').length === 3, 'focuses(): one record per company, the followed company first; focus() still names the Fellowship (' + (c.err || c.focuses) + ')');
  ok(c.hallJobs === '1,1,1' && c.onHall && c.hallHooks, 'the scripted DM posts one hall job per company on its own hall board, h.cid set, hallHooks shows each its own (' + (c.err || c.hallJobs) + ')');
  ok(c.soloFits && c.pairFits && c.bgRefused && c.fiveRefused, 'a company\'s hall job fits that company whatever its size (a solo too) and nobody else');
  ok(c.again === '1,1,1', 'the next refresh posts no second job for a company that has one (' + c.again + ')');
  ok(c.touches === String(c.pairId) && c.pairStamped, 'a hall posting for the pair concerns the pair alone, and stamps its last DM action (' + c.touches + ')');
  const n = kid('--needs', 'NEEDS');
  ok(!n.err && n.size === 'SPF', 'companies_needs: with equal time since the DM, the smaller first (a solo is the most fragile): ' + (n.err || n.size));
  ok(n.longest === 'FPS' && n.longestWhy === 'longest without you' && n.never === 'PFS', 'companies_needs: then the company longest without a DM action first, never touched the longest: ' + n.longest + ' / ' + n.never);
  ok(n.hurt === 'SFP' && /hurt/.test(n.hurtWhy), 'companies_needs: members badly hurt in the field outrank time: ' + n.hurt);
  ok(n.vote === 'PSF' && /pending/.test(n.voteWhy), 'companies_needs: a pending scene or vote outranks the hurt: ' + n.vote);
  ok(n.followed === 'FPS' && /must choose/.test(n.followedWhy) && n.notFollowed === 'FSP', 'companies_needs: the followed company first only when it must choose (' + n.followed + '; not followed: ' + n.notFollowed + ')');
  ok(n.sig, 'fellowship_change is one signature per company joined with |, and a solo\'s move alone changes it');
  ok(n.view && n.first, 'companies_view lists every company (no persona or memories); dm_status says every company is a thread');
  ok(n.orders && n.prompt, 'the standing orders: every company a thread, the one longest without you first, a solo\'s road gets a hook before the five get a third (and reach an older session once); the turn prompt names the companies');
  ok(n.pile, 'the DM does not pile on a badly hurt solo either');
  const fr = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--focus-companies'], {cwd: ROOT, encoding: 'utf8'}), fl = (fr.stdout || '').trim().split(/\r?\n/).pop(), fm = /^FOCUS (\{.*\}) BY (\{.*\}) H/.exec(fl || '');
  const fst = fm ? JSON.parse(fm[1]) : null, by = fm ? JSON.parse(fm[2]) : {};
  ok(fst && fst.acts >= 18 && fst.share >= 0.6 && Object.keys(by).length >= 3, 'with three companies over 150 game hours, at least 60% of the scripted DM\'s actions concern some company, each of them touched: ' + (fm ? fst.fellow + '/' + fst.acts + ' (' + Math.round(fst.share * 100) + '%) by ' + JSON.stringify(by) : fl || (fr.stderr || '').slice(-300)));
}

{ // solo-sized jobs (issue #447): only while an agent solo exists, band-checked, paid less
  const soloRun = a => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--solo', ...a], {cwd: ROOT, encoding: 'utf8'});
  const get = a => {const r = soloRun(a), l = (r.stdout || '').trim().split(/\r?\n/).pop(), m2 = /^SOLO (\{.*\})$/.exec(l); return m2 ? JSON.parse(m2[1]) : {err: l || (r.stderr || '').slice(-300)}};
  const s6 = get(['solo', '6']), s4 = get(['solo', '4']), none = get(['none']), low = get(['solo', '2']);
  ok(!s6.err && s6.company && s6.total >= 1 && s6.boards, 'with an agent company of one, every board of its faction keeps a solo-sized job (' + JSON.stringify(s6) + ')');
  ok(!s6.otherFac && s6.solos && s6.again, 'solo jobs stay on the faction boards of the solo, size 1, and are not posted twice');
  ok(s6.band && s6.fits && s4.band && s4.fits, 'a solo never sees a job above its level (level 6 and level 4), and every posted solo job fits it');
  ok(s6.payMul === true, 'solo pay is lower: the job carries a payMul below 1 (a party of five is paid per head at the template rate)');
  ok(!none.err && none.total === 0, 'with no agent solo in the world, no solo job is posted (the together world is untouched)');
  ok(!low.err && low.total === 0, 'a solo below the adventure level (MIN_LVL) is offered none');
}

{ // a bounty in the Fellowship's region: the scripted DM makes it their job first (issue #325)
  const r1 = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--ffbounty'], {cwd: ROOT, encoding: 'utf8', env: {...process.env}}), line = (r1.stdout || '').trim().split(/\r?\n/).pop();
  const m = /^FFB (\{.*\})$/.exec(line || ''), f = m ? JSON.parse(m[1]) : null;
  ok(f && f.left && f.ff && f.fromBounty, 'a Fellowship leader at the gate with a bounty posted for its region gets a Fellowship hook (h.ff) on that bounty first and sets out on it' + (f ? '' : ': ' + (line || r1.stderr.slice(-300))));
  ok(f && f.whole === f.party && f.party > 3, 'the Fellowship job takes the whole party (' + (f && f.whole) + ' of ' + (f && f.party) + '), past the background size cap of 3');
  ok(f && f.bountyStays, 'the bounty stays posted for the other heroes');
  ok(f && f.bgTake === false, 'a background hero cannot take a Fellowship job (' + (f && f.bgName) + ')');
  ok(f && f.gateLines === 1, 'the bounty job at the gate writes one Chronicle hall-board line (#351): ' + (f && f.gateLines));
  ok(f && f.hallLines === f.postedFF && f.hallLines >= 1 && f.postedOther >= 1, 'a Fellowship posting writes one Chronicle line each, other boards none (' + (f && f.hallLines) + ' lines, ' + (f && f.postedFF) + ' ff, ' + (f && f.postedOther) + ' other)');
  ok(f && f.lineNames && f.lineKept && f.lineNoDm, 'the line names the town and a member, the Fellowship-only view keeps it, and it never names the DM: ' + (f && f.lineText));
  ok(f && f.refillFF >= 1 && f.fitsWhole, 'a full hall board gets a Fellowship job on top at the next refresh, one the whole party fits (' + (f && f.refillTpl) + ', board ' + (f && f.boardBefore) + ')');
}

// ---------------------------------------------------------------- 3. silence never stalls the world
console.log('silence');
const hashOf = arg => {const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--hash', arg], {cwd: ROOT, encoding: 'utf8', env: {...process.env}}); return (p.stdout || '').trim() || p.stderr};
const h1 = hashOf('none'), h2 = hashOf('seat');
ok(/^HASH -?\d+$/.test(h1) && h1 === h2, `a seeded world runs the same with the seat open and nobody in it (${h1})`);

// ---------------------------------------------------------------- 4. over HTTP and MCP
console.log('relay routes');
const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
const play = attachPlay(server, {backend: localBackend(), log: () => {}});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const B = `http://127.0.0.1:${server.address().port}`;
const post2 = (base, path, body) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(async x => ({status: x.status, ...(await x.json())}));
const post = (path, body, headers = {}) => fetch(B + path, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)}).then(async x => ({status: x.status, ...(await x.json())}));
let h = await (await fetch(B + '/play/health')).json();
ok(h.dm && h.dm.seat === true && h.dm.link === 'none' && !h.dm.claimed, '/play/health reports the open DM seat, no runner');
r = await post('/play/claim', {role: 'dm', runner: 'test:1', provider: 'anthropic', model: 'claude-sonnet-5-5'});
ok(r.status === 200 && r.dm.claimed, 'a runner claims the DM seat');
r = await post('/play/claim', {role: 'dm', runner: 'test:2'});
ok(r.status === 409 && /One DM at a time/.test(r.error), 'a second DM runner is refused');
h = await (await fetch(B + '/play/health')).json();
ok(h.dm.link === 'waiting' && h.dm.runner && h.dm.runner.model === 'claude-sonnet-5-5', `the seat's link is waiting with the runner's mind (${h.dm.runner && h.dm.runner.model})`);
r = await post('/play/dm', {tool: 'dm_status', runner: 'test:1'});
ok(r.ok && r.day >= 1, 'POST /play/dm dm_status');
ok((await post('/play/dm', {tool: 'dm_status', runner: 'test:2'})).status === 409, 'a held DM seat answers only its own runner (issue #123)');
ok((await post('/play/dm', {tool: 'dm_status', runner: 'test:1', hero: 1})).status === 403, 'a call naming a hero gets no DM tools');
ok((await post('/play/dm', {tool: 'look'})).status === 400, 'hero tools are not DM tools');
ok((await post('/play/call', {tool: 'dm_status'})).status === 400, 'DM tools are not hero tools');
h = await (await fetch(B + '/play/health')).json();
ok(h.dm.link === 'connected', 'after a call the seat shows connected');
{const {Client} = await import('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport} = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const c = new Client({name: 'dmcheck', version: '1.0.0'});
  await c.connect(new StreamableHTTPClientTransport(new URL(B + '/mcp?role=dm'), {requestInit: {headers: {'X-Eldmoor-Role': 'dm', 'X-Eldmoor-Runner': 'test:1'}}}));
  const tools = (await c.listTools()).tools.map(t => t.name);
  ok(tools.includes('pull_lever') && tools.includes('notes_write') && !tools.includes('look') && !tools.includes('move_to'), `MCP /mcp?role=dm lists ${tools.length} DM tools and no hero tools`);
  ok(['stage_scene', 'table_call', 'table_answer'].every(t => tools.includes(t)), 'and the staged-scene tools (stage_scene, table_call, table_answer)');
  const res = await c.callTool({name: 'notes_write', arguments: {section: 'characters', op: 'add', text: 'Merel the gate captain, owes the party.'}});
  ok(/"ok":true/.test(res.content[0].text) && S.dmAgent.notes.characters.length === 1, 'an MCP notes_write lands in the world');
  const res2 = await c.callTool({name: 'pull_lever', arguments: {lever: 'mark_place', params: {kind: 'shrine', at: {x: 1, y: 1}}, reason: 'test'}});
  ok(/"ok":false/.test(res2.content[0].text), 'an MCP lever pull with an illegal spot is refused, not thrown');
  await c.close()}
// the runner's table voice (issue #132): a mock model answers the calls of a staged scene over /play/dm
{const {tableVoice} = await import('./dm-agent.mjs'), T = await import('../src/sim/table.js'), {zoneFor, zonePoint} = await import('../src/world/map.js'), {homeOf} = await import('../src/data/races.js');
  const L = fellows(), home = homeOf(L[0]).gate, spot = innerPoint(zonePoint, zoneAt, zoneFor(Math.max(1, L[0].lvl), home), home);
  L.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x)});
  if (S.levers) {S.levers.cd = {}; S.levers.day = {d: -1, n: {}, rz: {}}} if (S.staged) {S.staged.day.n = 0; if (S.staged.cur) S.staged.cur.phase = 'done'}
  T.TABLE.mode = 'auto'; T.TABLE.speed = 1; S.table = null;
  const st = await post('/play/dm', {tool: 'stage_scene', runner: 'test:1', args: {kind: 'meeting', near: 'fellowship', frame: 'A drover sits on a milestone, his ox lame beside him.', cast: {role: 'drover', want: 'a hand getting the ox to the ford', voice: 'tired, kind'}, reason: 'runner test'}});
  ok(st.ok, 'stage_scene over /play/dm' + (st.ok ? '' : ': ' + st.error));
  const asked = [];
  const adapter = {call: async ({user, schema}) => {asked.push(user); const e = schema.properties.pick.enum; return {text: JSON.stringify({text: 'Mock line ' + asked.length + ': the ox lows.', pick: e[e.length - 1]}), usage: {in: 300, out: 20, cost: 0}}}};
  const lines = [], v = tableVoice({base: B, adapter, model: 'mock', log: s => lines.push(s), pollIdle: 5, pollHot: 5, tool: (b, tool, args) => post('/play/dm', {tool, args, runner: 'test:1'})});
  let sc = null; const t0 = Date.now();
  while (Date.now() - t0 < 30000) {step(1 / 60); if (S.table && S.table.ctx.staged != null) sc = S.table; if (sc && !S.table && S.staged.cur.phase === 'done') break; await new Promise(res => setTimeout(res, 1))}
  await v.stop();
  const calls = sc ? sc.calls : [], mine = calls.filter(c => c.by === 'dm-agent');
  ok(sc && calls.length && mine.length >= Math.ceil(calls.length / 2), `the table voice answered ${mine.length} of ${calls.length} calls in ${((Date.now() - t0) / 1000).toFixed(1)} s (the scripted DM filled ${calls.length - mine.length})`);
  ok(asked.length && /Call \d+ \(voice/.test(asked[0]) && /drover/i.test(asked[0]), 'its prompt carries the scene and the call');
  ok(lines.some(l => /^\[table\] call \d+ /.test(l)), 'a log line per call: ' + (lines[0] || ''));
  ok(fellows().some(a => (a.chat || []).some(e => /^Mock line/.test(e.text))), 'the members hear the DM\'s lines in the game')

  {const wid = S.staged.cur && S.staged.cur.cast.npc; ok(wid != null && S.talks && (S.talks.cur.some(c => c.npc === wid) || S.talks.past.some(c => c.npc === wid)), 'the staged meeting leaves the way open for words (a conversation with the drover)')}}
// the talk voice answers a member's words over /play/dm (issue #170)
{const {talkVoice} = await import('./dm-agent.mjs'), TK = await import('../src/sim/talk.js'), P = await import('../src/sim/player.js'), {homeOf} = await import('../src/data/races.js');
  const A = fellows()[0], c0 = homeOf(A), qm = S.npcs.find(p => p.town === c0.name && p.role === 'quartermaster');
  for (const c of (S.talks ? S.talks.cur.slice() : [])) {c.state = 'done'; S.talks.cur.splice(S.talks.cur.indexOf(c), 1)} delete qm.snub;
  for (const x of fellows()) {x.x = c0.gate.x + 30; x.y = c0.gate.y}
  A.state = 'town'; A.x = qm.x + 1; A.y = qm.y; A.pq = []; A.hidden = false;
  const asked = [], lines = [];
  const adapter = {call: async ({user, schema}) => {asked.push(user); return {text: JSON.stringify({text: 'Mock: salt pork and rope, friend, at honest weight.', offer: schema.properties.offer.enum.includes('trade') ? 'trade' : 'none', about: '', region: '', warmth: '1', remember: 'Sold them rope.'}), usage: {in: 400, out: 30, cost: 0}}}};
  const v = talkVoice({base: B, adapter, model: 'mock', log: s => lines.push(s), pollIdle: 5, pollHot: 5, tool: (b, tool, args) => post('/play/dm', {tool, args, runner: 'test:1'})});
  await new Promise(res => setTimeout(res, 50));
  const r0 = P.playerAct(A.id, 'talk', {target: 'quartermaster', text: 'Have you rope and salt pork?'});
  const t0 = Date.now(); while (Date.now() - t0 < 10000 && !(A.chat || []).some(e => /^Mock: salt pork/.test(e.text))) {step(1 / 60); await new Promise(res => setTimeout(res, 2))}
  await v.stop();
  ok(r0.waiting && (A.chat || []).some(e => /^Mock: salt pork/.test(e.text) && e.by === 'dm-agent' && e.mark === '[trade opened]'), `the talk voice answered as ${qm.title} ${qm.name} with a trade in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  ok(asked.length && /rope and salt pork/.test(asked[0]) && /You want:/.test(asked[0]), 'its prompt carries the person and the member\'s line');
  ok(lines.some(l => /^\[talk\] /.test(l)), 'a log line per answer: ' + (lines[0] || ''))}
r = await post('/play/release', {role: 'dm', runner: 'test:1'});
setDmSeat(false);
r = await post('/play/claim', {role: 'dm', runner: 'test:3'});
ok(r.status === 404 && /seat is closed/.test(r.error), 'a closed seat refuses claims');
ok((await post('/play/dm', {tool: 'dm_status'})).offline === true, 'and answers no DM tool');
server.close();

// ---------------------------------------------------------------- 4b. the browser bridge answers the DM seat
console.log('the browser bridge (src/ui/player-bridge.js)');
{
  const srv = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
  attachPlay(srv, {log: () => {}}); // the browser backend (WebSocket), as the real relay
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const PB = `http://127.0.0.1:${srv.address().port}`;
  const {WebSocket: WsClient} = await import('ws');
  globalThis.WebSocket = class extends WsClient {constructor(u) {super(u, {origin: 'http://localhost:5173'})}};
  globalThis.localStorage = {getItem: k => k === 'eldmoor.playUrl' ? `ws://127.0.0.1:${srv.address().port}/play` : null};
  const BR = await import('../src/ui/player-bridge.js');
  sim.disbandFellowship(); // #148: Fellowship members are always agent-played; this part needs a world with no agent hero
  for (const a of S.agents) if (a.player) BR.agentOff(a);
  ok(BR.dmLink() === 'off' && BR.bridgeStatus() === 'off', 'seat closed, no agent hero: the page stays off the relay');
  BR.dmSeatSet(true);
  const until = async (f, ms = 5000) => {const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50)); return f()};
  ok(await until(() => BR.bridgeStatus() === 'connected'), 'opening the seat connects the page to the relay');
  let hh = null; await until(() => false, 300); hh = await (await fetch(PB + '/play/health')).json();
  ok(hh.connected && hh.dm && hh.dm.seat === true && hh.heroes.length === 0, 'the relay sees the open DM seat and no agent hero');
  const cl = await post2(PB, '/play/claim', {role: 'dm', runner: 'page-test:1', provider: 'ollama', model: 'mock-dm:1b'});
  const rr = await post2(PB, '/play/dm', {tool: 'notes_write', args: {section: 'threads', op: 'add', text: 'Asked through the page.'}, runner: 'page-test:1'});
  ok(cl.status === 200 && rr.ok && S.dmAgent.notes.threads.some(n => n.text === 'Asked through the page.'), 'a DM call through the relay is answered by the page\'s world');
  ok(await until(() => BR.dmLink() === 'connected' && BR.dmRunnerTag() === 'mock-dm:1b · local'), `the page sees the DM runner's link and mind (${BR.dmLink()}, ${BR.dmRunnerTag()})`);
  BR.dmSeatSet(false);
  ok(await until(() => BR.bridgeStatus() === 'off'), 'closing the seat (no agent hero) disconnects the page');
  const off = await post2(PB, '/play/dm', {tool: 'dm_status', runner: 'page-test:1'});
  ok(off.ok === false && off.offline, 'and the relay says the game is not connected');
  srv.close(); setDmSeat(true);
}

// ---------------------------------------------------------------- 5. the runner, end to end (mock Ollama)
console.log('npm run dm -- --provider ollama (mock Ollama, headless world with --dm)');
const plan = [['dm_status', {}], ['notes_write', {section: 'plans', op: 'add', text: 'A pilgrim road through the fog.'}],
  ['pull_lever', {lever: 'set_condition', params: {region: 0, kind: 'festival', strength: 1, hours: 6}, reason: 'a harvest fair to lift spirits'}],
  ['pull_lever', {lever: 'set_condition', params: {region: 0, kind: 'bandits'}, reason: 'too soon'}]];
const seen = [];
const mock = http.createServer((req, res) => {
  const send = (code, o) => {res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(o))};
  if (req.url === '/api/tags') return send(200, {models: [{name: 'mock-dm:1b', model: 'mock-dm:1b'}, {name: 'mock-loop:1b', model: 'mock-loop:1b'}]});
  if (req.url !== '/api/chat') return send(404, {error: 'not found'});
  let b = ''; req.on('data', c => b += c); req.on('end', () => {const body = JSON.parse(b); seen.push(body);
    const msgs = body.messages, last = msgs.map((m, i) => m.role === 'user' ? i : -1).filter(i => i >= 0).pop(), n = msgs.slice(last + 1).filter(m => m.role === 'assistant').length;
    const done = {done: true, done_reason: 'stop', prompt_eval_count: 1200, eval_count: 30, model: body.model};
    if (body.model === 'mock-loop:1b' && body.tools) return send(200, {...done, message: {role: 'assistant', content: '', tool_calls: [{function: {name: 'regions', arguments: {}}}]}}); // a model that never stops calling
    if (n >= plan.length) return send(200, {...done, message: {role: 'assistant', content: 'The DM set a fair in motion and noted the pilgrim road.'}});
    const [name, args] = plan[n]; send(200, {...done, message: {role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]}})});
});
await new Promise(res => mock.listen(0, '127.0.0.1', res));
const OLLAMA = `http://127.0.0.1:${mock.address().port}`;
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-dmcheck-'));
const childEnv = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OLLAMA_URL: OLLAMA, RELAY_VERBOSE: '', AGENT_MIN_GAP: '0'};
const kids = [];
function start(args, ready) {
  const p = spawn(process.execPath, args, {cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']}); kids.push(p); let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const done = new Promise(r => p.on('exit', code => r(code)));
  const until = ready ? new Promise((res, rej) => {const t = setInterval(() => {if (ready.test(out)) {clearInterval(t); res()}}, 100); setTimeout(() => {clearInterval(t); rej(new Error('timeout waiting for ' + ready + '\n' + out))}, 90000)}) : null;
  return {p, done, until, out: () => out};
}
const port = 18100 + Math.floor(Math.random() * 500), BASE = `http://127.0.0.1:${port}`;
try {
  const world = start(['scripts/play-headless.mjs', '--port', String(port), '--dm', '--agents', '0', '--quiet', '--speed', '4', '--world', join(tmp, 'world.json')], /^\[play\] headless world at /m);
  await world.until;
  h = await (await fetch(BASE + '/play/health')).json();
  ok(h.dm && h.dm.seat && h.heroes.length === 0, 'play-headless --dm --agents 0: the DM seat open, no agent hero');
  const dm = start(['scripts/dm-agent.mjs', '--url', BASE, '--provider', 'ollama', '--model', 'mock-dm:1b', '--max-turns', '2', '--cadence', '5', '--ollama-url', OLLAMA, '--claude-concurrency', '1']);
  const watch = start(['-e', `setTimeout(async()=>{const h=await (await fetch('${BASE}/play/health')).json();console.log(JSON.stringify(h.dm))},2500)`]);
  await watch.done;
  const live = JSON.parse(watch.out().trim().split('\n').pop() || '{}');
  ok(live.claimed && live.runner && live.runner.provider === 'ollama' && live.runner.model === 'mock-dm:1b', `while it runs, the seat is claimed and tagged ${live.runner && live.runner.model}`);
  const code = await dm.done, out = dm.out();
  ok(code === 0, 'the DM runner exits cleanly after --max-turns' + (code === 0 ? '' : '\n' + out.slice(-1500)));
  ok(/DM seat taken \| local model mock-dm:1b/.test(out) && /> dm_status\(\)/.test(out) && /> notes_write\(/.test(out) && /> pull_lever\(/.test(out), 'it reads, writes a note and pulls levers through the DM tools');
  ok(/"lever":"set_condition"/.test(out) && /Refused: /.test(out), 'one pull lands, one is refused (the region already has a condition, or the day\'s limit)');
  ok((out.match(/\[turn \d\] mock-dm:1b \(local\) \| 4 tool calls.*tokens in \d+ \/ out \d+ \| \$0 \(local\)/g) || []).length === 2, 'two turns, each with a cost line');
  ok(/next turn in|waiting/.test(out), 'between turns it waits for its cadence');
  const f = join(tmp, 'agents', 'dm.json'), sess = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  ok(sess && sess.turns === 2 && sess.runner.provider === 'ollama' && sess.world && sess.local && sess.local.history.length > 0, 'logs/agents/dm.json keeps the world tag, runner settings, turns and the conversation');
  const again = start(['scripts/dm-agent.mjs', '--url', BASE, '--max-turns', '1', '--cadence', '5', '--ollama-url', OLLAMA]);
  const c2 = await again.done, o2 = again.out(), s2 = JSON.parse(readFileSync(f, 'utf8'));
  ok(c2 === 0 && /resuming/.test(o2) && /mock-dm:1b/.test(o2) && s2.turns === 3, 'the next run resumes the saved session and settings (no flags)' + (c2 === 0 ? '' : '\n' + o2.slice(-1200)));
  h = await (await fetch(BASE + '/play/health')).json();
  ok(!h.dm.claimed, 'the runner let go of the seat on exit');
  const sizes = [...new Set(seen.map(b => b.options && b.options.num_ctx))];
  ok(seen.length && sizes.length === 1 && sizes[0] === 16384, `every DM loop request asks one num_ctx (${sizes.join(', ')}; issue #221)`);
  world.p.kill();
  // the DM's prep before the table opens (issue #437): a resumed world (Continue) held for a short prep with --wait-ready
  {const P2 = port + 1, B2 = `http://127.0.0.1:${P2}`, wf = join(tmp, 'world-prep.json');
    writeFileSync(wf, JSON.stringify(snapshot())); // the world of this check, saved: a Continue
    const w2 = start(['scripts/play-headless.mjs', '--port', String(P2), '--dm', '--agents', '0', '--quiet', '--speed', '4', '--wait-ready', '--resume', '--world', wf], /^\[play\] headless world at /m);
    await w2.until;
    const d2 = start(['scripts/dm-agent.mjs', '--url', B2, '--provider', 'ollama', '--model', 'mock-dm:1b', '--max-turns', '1', '--cadence', '5', '--ollama-url', OLLAMA, '--new']);
    const c3 = await d2.done, o3 = d2.out(), wo = w2.out();
    ok(c3 === 0 && /preparing the table \(resume\): at most 10 calls/.test(o3) && /prep over: done/.test(o3), 'Continue: the DM runner takes the short prep (half the calls) and ends it with prep_done' + (c3 === 0 ? '' : '\n' + o3.slice(-1500)));
    ok(/the DM prepares the table \(resume/.test(wo) && /the DM's prep is over \(done/.test(wo), 'play-headless --wait-ready holds the world for the prep and runs once it is over');
    const d3 = start(['scripts/dm-agent.mjs', '--url', B2, '--provider', 'ollama', '--model', 'mock-loop:1b', '--max-turns', '1', '--cadence', '5', '--ollama-url', OLLAMA, '--new']);
    const c4 = await d3.done, o4 = d3.out(), wo2 = w2.out();
    ok(c4 === 0 && /preparing the table \(resume\)/.test(o4) && /the DM's prep is over \(calls: 10 calls/.test(wo2), 'a DM runner started again gets a short prep too; a model that loops on calls is stopped by the call cap' + (c4 === 0 ? '' : '\n' + o4.slice(-1500)));
    w2.p.kill();
    const w3 = start(['scripts/play-headless.mjs', '--port', String(P2 + 1), '--agents', '0', '--dm', '--quiet', '--speed', '4', '--resume', '--world', wf], /^\[play\] headless world at /m);
    await w3.until;
    const d4 = start(['scripts/dm-agent.mjs', '--url', `http://127.0.0.1:${P2 + 1}`, '--provider', 'ollama', '--model', 'mock-dm:1b', '--max-turns', '1', '--cadence', '5', '--ollama-url', OLLAMA, '--new']);
    const c5 = await d4.done, o5 = d4.out();
    ok(c5 === 0 && !/preparing the table/.test(o5) && !/prepares the table/.test(w3.out()), 'no host holding the world for it (no --wait-ready): no prep, the runner goes straight to its turn');
    w3.p.kill()}
  // session zero framed: by the DM agent's call (the premise in its call only), or by the scripted DM with the seat closed
  {const run1 = arg => {const ch = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--opening', arg], {encoding: 'utf8'}); if (ch.stderr) process.stderr.write(ch.stderr); const l = (ch.stdout || '').split('\n').find(x => x.startsWith('OPENING ')); return l ? JSON.parse(l.slice(8)) : {}};
    const o = run1('seat'), c = run1('closed');
    ok(o.kind === 'opening' && /^SESSION ZERO/.test(o.title) && o.call === 'frame' && o.premise && o.dmLine && o.by[0] === 'dm-agent', 'session zero: the DM agent frames the opening (its call carries the campaign premise)');
    ok(!o.leak && !c.leak, 'the premise reaches no hero tool or chat; only what the DM says at the table');
    ok(c.kind === 'opening' && c.by[0] === 'scripted' && c.scripted && /Before them|board is bare/.test(c.summary || ''), 'with the seat closed the scripted DM frames it from the hall, the day and the first board job')}
} catch (e) {ok(false, 'runner section: ' + (e.message || e))}
for (const k of kids) try {k.kill()} catch {}
mock.close();
try {rmSync(tmp, {recursive: true, force: true})} catch {}

console.log(fail ? `\n${fail} check(s) FAILED` : '\nall DM agent checks passed');
process.exit(fail ? 1 : 0);
