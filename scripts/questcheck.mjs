// Quest log check: several quests per hero (board, DM, oaths), one in focus (src/sim/questlog.js).
//   - the scripted world is unchanged: reading the log changes nothing, a seeded run is the same with or without it,
//     and no scripted hero ever holds a second job;
//   - an agent hero takes two jobs without dropping its kill quest, focuses one (the DM leads it), switches focus
//     (the first is set aside: its foes go, the hero heads for the other's scene), turns to its kill quest (the
//     adventure waits), abandons one, cannot abandon its oath, hits the cap;
//   - a job the DM agent posted is tagged dm / 'DM agent' in the watcher's log and shows as a plain job to the hero;
//   - a staged scene at the table is listed while it lasts and lands in the done list;
//   - a held adventure is taken up again when its hero comes near its scene; a taken job goes cold;
//   - the pace brief names the focus and the count of others; save/restore; an old save without a log.
// Usage: npm run questcheck
let seed = 0x9e3779b9 ^ (Number(process.env.QUESTCHECK_SEED) || 211);
const rand = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
Math.random = rand;

const {init, step, S, snapshot, restore, maxHp, questLog} = await import('../src/sim/index.js');
const {createHash} = await import('node:crypto');
const P = await import('../src/sim/player.js');
const {pull} = await import('../src/sim/levers.js');
const {homeOf} = await import('../src/data/races.js');
const {MOBS} = await import('../src/data/mobs.js');
const {huntZone, turnIn} = await import('../src/sim/heroes.js');
const {bountiesAt} = await import('../src/sim/dm.js');
const {ADVENTURES} = await import('../src/data/adventures.js');
const {QL, questTick, jobDone} = await import('../src/sim/questlog.js');
// 'Quest completed' wakes (sim/wakes.js, w=2) posted to a hero since event number n
const doneWakes = (h, n) => (h.playEv || []).filter(e => e.n > n && /^Quest completed/.test(e.text) && e.w === 2);
const {paceBrief} = await import('../src/sim/pace.js');
const {TOOL_NAMES} = await import('../src/data/player-tools.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const r3 = v => Math.round(v * 1000) / 1000;
const worldHash = () => createHash('sha256').update(JSON.stringify({
  m: r3(S.gameMin), a: S.agents.map(a => [a.id, a.lvl, r3(a.xp), r3(a.x), r3(a.y), r3(a.hp), a.state, a.gold, a.kills, a.adv]),
  mobs: S.mobs.map(m => [m.id, m.alive ? 1 : 0, r3(m.x), r3(m.y)]), adv: (S.adventures || []).map(h => [h.id, h.phase, h.idx]), c: S.chronicle.length, u: S.uid,
})).digest('hex').slice(0, 16);

console.log('\nEldmoor questcheck: the quest log\n');

// ---- 1. the scripted world is unchanged ----
// Each world runs in its own process (init() fills the one S): with the log read every half second, and without.
if (process.argv[2] === '--world') {
  seed = 0x9e3779b9 ^ 4242; init({fellowship: false});
  const read = process.argv[3] === '1';
  for (let i = 0; i < 8 * 3600; i++) {step(1 / 60); if (read && i % 30 === 0) for (const x of S.agents) questLog(x)}
  console.log(JSON.stringify({hash: worldHash(), held: (S.adventures || []).filter(v => v.held != null || v.phase === 'taken').length, logs: S.agents.filter(x => x.qlog).length,
    one: S.agents.every(x => (S.adventures || []).filter(v => v.phase === 'active' && v.mem.includes(x.id)).length <= 1)}));
  process.exit(0);
}
{const {execFileSync} = await import('node:child_process'), {fileURLToPath} = await import('node:url');
  const me = fileURLToPath(import.meta.url), w = k => JSON.parse(execFileSync(process.execPath, [me, '--world', k], {encoding: 'utf8', maxBuffer: 1 << 24}).trim().split(/\n/).pop());
  const x = w('0'), y = w('1');
  ok(x.hash === y.hash, `a seeded scripted world (no Fellowship, 8 min) is the same whether the log is read or not (${x.hash})`);
  ok(x.held === 0 && x.one, 'no scripted hero holds a second job (no taken or held jobs, at most one adventure each)');
  ok(x.logs > 0, `finished quests are recorded for scripted heroes too (${x.logs} logs), without dice`)}

// ---- 2. an agent hero ----
Math.random = rand; seed = 0x9e3779b9 ^ 211;
init({fellowship: false}); run(2);
const a = S.agents.find(x => x.fac === 0 && x.state === 'town' && !x.party) || S.agents.find(x => x.fac === 0);
a.lvl = 8; a.hp = maxHp(a); a.gold = 200; a.party = null;
P.markPlayer(a, true); delete a.goal.offered; // an oath held from before (#800): the own-oath section below starts from a thread
const call = (tool, args) => {const h = S.agents.find(x => x.id === a.id); h.playRate = []; return P.playerAct(a.id, tool, args || {})}; // the rate limit is playcheck's
for (const t of ['quests', 'take_quest', 'focus_quest', 'abandon_quest']) ok(TOOL_NAMES.includes(t), `tool ${t} is listed`);
const c = homeOf(a);
// a walk home so the hero is in town
a.x = c.ah.x; a.y = c.ah.y; a.state = 'town'; a.pq = [];
const solo = Object.keys(ADVENTURES).filter(k => k !== 'fallen' && ADVENTURES[k].size[0] === 1 && (ADVENTURES[k].lvl || 0) <= 8);
const tplA = solo[0], tplB = solo[1] || solo[0], tplC = solo[2] || solo[0];
const post = (tpl, by) => {for (let i = S.adventures.length - 1; i >= 0; i--) {const h = S.adventures[i]; if (h.phase === 'open' && h.town === c.name && h.for == null && S.adventures.filter(x => x.phase === 'open' && x.town === c.name).length > 5) S.adventures.splice(i, 1)} return pull('post_hook', {town: c.name, tpl, src: by === 'dm-agent' ? 'dm' : 'request'}, {by, reason: 'SECRET-REASON-quests'})};
const hA = post(tplA, 'scripted').ret, hB = post(tplB, 'dm-agent').ret;
ok(hA && hB && hB.by === 'dm-agent' && !hA.by, `two jobs posted: #${hA && hA.id} by the board, #${hB && hB.id} by the DM agent`);

// #67: no hero is handed a kill quest; the gate captain's bounty is taken with turn_in (a choice)
ok(!a.quest || a.quest.bounty != null, 'nobody is handed a kill quest: a hero holds a bounty only if it took one (#67)');
a.quest = null;
let r = call('turn_in'); ok(r.ok && r.new_bounty && a.quest && a.quest.bounty != null && a.quest.have === 0, `turn_in with no bounty takes the gate captain's: ${r.new_bounty || r.error}`);
r = call('turn_in'); ok(!r.ok && /not done/.test(r.error), 'turn_in on an unfinished bounty is refused');
ok(S.bounties.some(b => b.id === a.quest.bounty), 'the bounty stays posted on the board for others');
ok((call('list_jobs').bounties || []).some(b => b.yours), 'list_jobs shows the posted bounties, this one marked yours');
r = call('quests');
const kill0 = r.active.find(q => q.kind === 'quest');
ok(r.ok && kill0 && kill0.focus, `quests: the kill quest is the focus at first (${kill0 && kill0.title})`);
ok(r.active.some(q => q.kind === 'oath'), 'quests: the oath is listed');
r = call('take_quest', {id: 'job:' + hA.id}); ok(r.ok && hA.phase === 'taken' && hA.taker === a.id, `take_quest job:${hA.id}: ${r.took || r.error}`);
r = call('take_quest', {id: String(hB.id)}); ok(r.ok && hB.phase === 'taken', `take_quest ${hB.id} (a bare number): ${r.took || r.error}`);
ok(a.quest && !a.adv, 'taking jobs dropped nothing: the kill quest stays, no adventure started');
r = call('take_quest', {id: 'job:' + hA.id}); ok(!r.ok, 'taking a job twice is refused');
let L = questLog(a);
const qA = L.active.find(q => q.id === 'job:' + hA.id), qB = L.active.find(q => q.id === 'job:' + hB.id);
ok(qA && qA.status === 'held' && qA.kind === 'board' && qB && qB.status === 'held', 'both jobs are held in the log');
ok(qB && qB.kind === 'dm' && qB.from === 'DM agent', `the DM agent's job is tagged dm / ${qB && qB.from} for the watcher`);
const seenB = call('quests').active.find(q => q.id === 'job:' + hB.id), view = JSON.stringify(call('quests'));
ok(seenB && seenB.kind === 'job' && !('from' in seenB) && !/DM agent|scripted DM|SECRET-REASON/.test(view), 'the hero sees it as a plain job: no maker, no reason');
ok(['id', 'kind', 'title', 'giver', 'where', 'objective', 'progress', 'reward', 'status', 'focus', 'started', 'ends', 'from'].every(k => k in qA), 'Q has every field of the read API');

// focus A: the DM leads it
r = call('focus_quest', {id: 'job:' + hA.id}); ok(r.ok && a.adv === hA.id && hA.phase === 'active', `focus_quest A: ${r.focus || r.error}`);
ok(a.state === 'travel', `the hero sets out on it (${a.state})`);
run(3);
// focus B: A is set aside where it stands
const advA = S.adventures.find(v => v.id === hA.id);
if (a.state === 'fight' || a.state === 'town' || a.state === 'return') {a.state = 'hunt'; a.target = null; a.pq = []}
r = call('focus_quest', {id: 'job:' + hB.id}); ok(r.ok && a.adv === hB.id && advA.held === a.id && advA.phase === 'active', `focus_quest B sets A aside: ${r.focus || r.error}`);
ok(advA.foes.length === 0, 'the set-aside adventure has no foes left in the world');
L = questLog(a); ok(L.focus === 'job:' + hB.id && L.active[0].id === 'job:' + hB.id && L.active.find(q => q.id === 'job:' + hA.id).status === 'held', 'the log: B in focus, A held');
const advB = S.adventures.find(v => v.id === hB.id), scB = advB.scenes[advB.idx].at;
const d0 = scB ? Math.hypot(a.x - scB.x, a.y - scB.y) : 0; run(2);
const d1 = scB ? Math.hypot(a.x - scB.x, a.y - scB.y) : 0;
ok(!scB || d1 < d0 || advB.idx > 0 || advB.phase !== 'active', `focus switches behaviour: the hero heads for B's scene (${d0.toFixed(1)} -> ${d1.toFixed(1)} tiles)`);
const bf = paceBrief(a.id).brief;
ok(bf.quest && bf.quest.focus && bf.quest.others >= 2, `pace brief: focus "${bf.quest && bf.quest.focus}" and ${bf.quest && bf.quest.others} others`);

// focus the kill quest: B waits too
if (['fight', 'duel', 'assist'].includes(a.state)) {a.state = 'hunt'; a.target = null}
const killId = questLog(a).active.find(q => q.id.startsWith('kill:')).id;
r = call('focus_quest', {id: killId}); ok(r.ok && !a.adv && advB.held === a.id && questLog(a).focus === killId, `focus the kill quest: ${r.set_aside || r.error} set aside`);

// oaths cannot be set down
delete a.goal.offered; delete a.goal.aside; const oath = questLog(a).active.find(q => q.kind === 'oath');
r = call('abandon_quest', {id: oath.id}); ok(!r.ok && /oath/i.test(r.error), 'abandon_quest on an oath is refused');

// abandon B (held): it ends, logged as abandoned with the hero's reason
const nB = a.playEvN || 0;
r = call('abandon_quest', {id: 'job:' + hB.id, reason: 'the road is too long'});
ok(r.ok && advB.phase === 'done' && advB.why === 'abandoned', `abandon_quest B: ${r.abandoned || r.error}`);
ok(doneWakes(a, nB).length === 0, 'an abandoned job wakes nobody');
const dB = questLog(a).done.find(q => q.id === 'job:' + hB.id);
ok(dB && dB.status === 'abandoned' && /too long/.test(dB.objective), `done list: B abandoned (${dB && dB.objective})`);

// a taken job given back goes on the board again; the cap
a.x = c.ah.x; a.y = c.ah.y; a.state = 'town'; a.pq = [];
const hC = post(tplC, 'scripted').ret;
r = call('take_quest', {id: hC.id}); ok(r.ok, 'take a third job');
r = call('abandon_quest', {id: hC.id}); ok(r.ok && hC.phase === 'open' && !hC.taker, 'abandoning a taken job puts it back on the board');
let took = 0, capped = null;
for (let i = 0; i < QL.MAX + 1; i++) {const h = post(solo[i % solo.length], 'scripted'); if (!h.ok) break; r = call('take_quest', {id: h.ret.id}); if (r.ok) took++; else {capped = r.error; break}}
ok(capped && /hold/.test(capped) && questLog(a).active.filter(q => q.kind !== 'oath').length === QL.MAX, `the cap: ${QL.MAX} held, then "${capped}"`);

// ---- save / restore ----
const before = JSON.stringify(questLog(a));
const snap = JSON.parse(JSON.stringify(snapshot()));
restore(snap);
const a2 = S.agents.find(x => x.id === a.id);
ok(JSON.stringify(questLog(a2)) === before, 'save/restore: the quest log comes back the same');

// ---- an old save (no log, an adventure under way): its adventure is the focus ----
{const b = S.agents.find(x => x.adv && !x.player) || null;
  if (b) {delete b.qlog; const Lb = questLog(b); ok(Lb.focus === 'job:' + b.adv && Lb.active[0].focus, 'an old save: the running adventure is the focus, nothing to migrate')}
  else {const c2 = S.agents.find(x => !x.player && x.quest); if (c2) {delete c2.qlog; delete c2.quest.at; const Lc = questLog(c2); ok(Lc.focus === 'kill:' + c2.quest.type + ':0', 'an old save: the kill quest is the focus')}}}

// ---- an old save holding a kill quest from the quest giver (#67): it loads, finishes and is paid as before ----
{const b = S.agents.find(x => !x.player && x.state !== 'dead' && !x.adv && x.id !== a.id);
  const type = Object.keys(MOBS).find(k => MOBS[k].z === huntZone(b)) || Object.keys(MOBS)[0];
  b.quest = {type, need: 5, have: 5}; delete b.qlog; // the old shape: no at, no bounty
  const snapO = JSON.parse(JSON.stringify(snapshot())); delete snapO.bounties; restore(snapO);
  const b2 = S.agents.find(x => x.id === b.id), g0 = b2.gold, x0 = b2.xp + b2.lvl * 1e6;
  ok(b2.quest && b2.quest.type === type && !S.bounties, 'an old save (no bounty board) restores with its kill quest');
  turnIn(b2);
  ok(!b2.quest && b2.gold > g0 && b2.xp + b2.lvl * 1e6 > x0 && questLog(b2).done.some(q => q.id === 'kill:' + type + ':0' && q.status === 'done'), 'the old kill quest is handed in and paid, and no new one is handed out');
  ok(bountiesAt(homeOf(b2)).length > 0, 'the board is posted lazily for an old save')}

// ---- a held adventure is taken up again near its place ----
{const b = S.agents.find(x => x.id === a.id);
  b.x = c.ah.x; b.y = c.ah.y; b.state = 'town'; b.pq = [];
  for (const q of questLog(b).active) if (q.status === 'held') call('abandon_quest', {id: q.id});
  const h = post(tplA, 'scripted').ret; call('take_quest', {id: h.id}); r = call('focus_quest', {id: h.id});
  run(1);
  const adv = S.adventures.find(v => v.id === h.id);
  if (['fight', 'duel', 'assist'].includes(b.state)) {b.state = 'hunt'; b.target = null}
  call('focus_quest', {id: questLog(b).active.find(q => q.id.startsWith('kill:')).id});
  ok(adv.held === b.id && !b.adv, 'set an adventure aside');
  const sc = adv.scenes[adv.idx].at || {x: b.x, y: b.y};
  b.x = sc.x + 2; b.y = sc.y; b.state = 'hunt'; b.pq = []; questTick();
  ok(b.adv === adv.id && adv.held == null && questLog(b).focus === 'job:' + adv.id, 'coming near its scene takes it up again');
  // a taken job goes cold
  b.x = c.ah.x; b.y = c.ah.y; b.state = 'town'; b.pq = [];
  const h2 = post(tplB, 'scripted').ret; call('take_quest', {id: h2.id}); h2.until = S.gameMin - 1; questTick();
  ok(!S.adventures.includes(h2) && questLog(b).done.some(q => q.id === 'job:' + h2.id && q.status === 'expired'), 'a taken job left too long goes cold (expired)')}

// ---- a staged scene at the table ----
{const b = S.agents.find(x => x.id === a.id), prevT = S.table, prevG = S.staged;
  S.staged = {cur: {id: 99, kind: 'meeting', title: 'The Hooded Stranger', z: 1, reason: 'SECRET-REASON-stage', phase: 'open'}, past: []};
  S.table = {ctx: {staged: 99}, ids: [b.id], at: Math.round(S.gameMin), phase: 'turn'};
  questTick(); let Lb = questLog(b), sq = Lb.active.find(q => q.id === 'scene:99');
  ok(sq && sq.kind === 'dm' && sq.from === 'DM agent' && !/SECRET/.test(JSON.stringify(Lb)), 'a staged scene at the table is listed (dm, DM agent), never its reason');
  S.table = null; S.staged.cur = null; questTick(); Lb = questLog(b);
  ok(!Lb.active.some(q => q.id === 'scene:99') && Lb.done.some(q => q.id === 'scene:99' && q.status === 'done'), 'when it ends it lands in the done list');
  S.table = prevT; S.staged = prevG}

// ---- finished quests: a kill quest handed in, an oath kept ----
{const b = S.agents.find(x => x.id === a.id);
  b.x = c.ah.x; b.y = c.ah.y; b.state = 'town'; b.pq = [];
  if (!b.quest) call('turn_in'); b.quest.have = b.quest.need; const nT = b.playEvN || 0; const t = questLog(b).active.find(q => q.id.startsWith('kill:')).title;
  r = call('turn_in'); ok(r.ok && questLog(b).done.some(q => q.id.startsWith('kill:') && q.status === 'done' && q.title === t), `turn_in: "${t}" in the done list`);
  ok(doneWakes(b, nT).length === 1, 'turn_in wakes the agent once (no second wake from the quest log)');
  const nO = b.playEvN || 0;
  const n0 = questLog(b).done.length;
  if (b.goal) delete b.goal.offered; // a thread sworn (#800): kept below
  if (b.goal && b.goal.type === 'hoard') {b.gold = b.goal.need + 1} else {b.goal = {type: 'hoard', tier: 0, text: 'Hold 1 gold at once', need: 1, progress: 0, done: false, at: 0}; b.gold = 5}
  run(1); ok(questLog(b).done.length > n0 && questLog(b).done.some(q => q.kind === 'oath' && q.status === 'done'), 'a kept oath lands in the done list');
  ok(doneWakes(b, nO).length === 1 && !/\dg\)/.test(doneWakes(b, nO)[0].text), `a kept oath wakes the agent once: "${(doneWakes(b, nO)[0] || {}).text}"`);
  // a held job that ends well wakes its hero once, with its pay
  const v = {id: 9901, phase: 'done', tpl: 'deliver', title: 'A Letter for Nowhere', held: b.id, mem: [b.id], scenes: [{type: 'travel'}], idx: 1, z: 0, data: {}, outcome: 'success', paid: {[b.id]: 37}, started: S.gameMin - 60};
  const nH = b.playEvN || 0; jobDone(b, v); const w = doneWakes(b, nH);
  ok(w.length === 1 && /A Letter for Nowhere \(37g\)/.test(w[0].text), `a held job finished: one wake "${w[0] && w[0].text}"`);
  const nF = b.playEvN || 0; jobDone(b, {...v, id: 9902, outcome: 'failure', why: 'expired'}); ok(doneWakes(b, nF).length === 0, 'a job that went cold wakes nobody');
  const s0 = S.agents.find(x => !x.player && x.kind === 'hero'), nS = s0.playEvN || 0; jobDone(s0, {...v, id: 9903, held: null, mem: [s0.id]}); ok((s0.playEvN || 0) === nS, 'a scripted hero gets no wake')}

// ---- 7. sworn vows (#526) ----
{
  const me = () => S.agents.find(x => x.id === a.id);
  if (me().goal) delete me().goal.offered; // holds an oath, so what it swears here is a vow beside it (#800)
  const {goalEvent} = await import('../src/sim/goals.js');
  const {openThreads} = await import('../src/sim/company.js');
  const {ELITES} = await import('../src/data/mobs.js');
  for (const t of ['swear_oath', 'renounce_oath']) ok(TOOL_NAMES.includes(t), `tool ${t} is listed`);
  const o0 = S.agents.find(x => x.id !== a.id && x.fac === me().fac && x.state !== 'dead'), ob = () => S.agents.find(x => x.id === o0.id); P.markPlayer(ob(), true); ob().x = me().x + 1; ob().y = me().y; ob().state = 'town'; ob().pq = []; run(1); me().x = ob().x - 1; me().y = ob().y; run(1);
  me().bonds = {...(me().bonds || {}), [ob().id]: 12}; ob().bonds = {...(ob().bonds || {}), [a.id]: 12};
  let r = call('swear_oath', {kind: 'slay'}); ok(!r.ok && /needs an about/.test(r.error), 'a slay vow needs a target');
  r = call('swear_oath', {kind: 'reach', about: 'Nowhereland'}); ok(!r.ok && /No such place/.test(r.error), 'a reach vow needs a real place');
  const oN = ob().playEvN || 0;
  const foe = ELITES[0];
  r = call('swear_oath', {kind: 'slay', about: foe.name, text: 'I will have the head of ' + foe.name + '.'});
  ok(r.ok && me().vow && me().vow.kind === 'slay' && r.heard_by.includes(ob().name), `swear_oath: sworn, heard by ${r.heard_by}`);
  ok((ob().playEv || []).some(e => e.n > oN && /swears/.test(e.text)), 'a witness in earshot is told');
  r = call('swear_oath', {text: 'Another', kind: 'vow'}); ok(!r.ok && /Keep or renounce/.test(r.error), 'a second vow is refused while one stands');
  let ql = call('quests'); ok(ql.active.some(q => q.id === me().vow.id && q.kind === 'oath'), 'the vow is an oath in the quest log');
  ok(questLog(me()).active.some(q => q.id === me().vow.id && q.from === 'sworn vow'), 'the watcher log marks it a sworn vow');
  ok(/head of/.test(JSON.stringify(call('self'))) && call('self').sworn_vow, 'self shows the vow under wants');
  ok(call('status').vow, 'status shows the vow');
  r = call('abandon_quest', {id: me().vow.id}); ok(!r.ok && /renounce_oath/.test(r.error), 'abandon_quest points to renounce_oath');
  ok(openThreads({ids: [a.id], plans: [], log: [], seq: 0}).some(t => t.kind === 'oath' && t.parts.some(p => /head of/.test(p.t || ''))), 'the DM sees the vow as an open thread');
  const m0 = me().tiers ? me().tiers.marks.length : 0;
  // kept
  const nK = me().playEvN || 0, vid = me().vow.id;
  goalEvent(me(), 'kill', {name: 'Somebody Else', elite: true, type: 'wolf'}); ok(me().vow, 'another kill does not keep it');
  goalEvent(me(), 'kill', {name: foe.name, elite: true, type: 'wolf'});
  ok(!me().vow && questLog(me()).done.some(q => q.id === vid && q.status === 'done'), 'slaying the named foe keeps the vow (done list)');
  ok((me().tiers.marks || []).some(m => /Kept the vow/.test(m.text)), 'a landmark: kept the vow');
  ok((me().playEv || []).some(e => e.n > nK && /kept your vow/.test(e.text)), 'the agent is told it kept its vow');
  ok(me().reflect && (me().reflect.cur || (me().reflect.log || []).length || me().reflect.ev), 'a reflection moment is due');
  // reach
  r = call('swear_oath', {kind: 'reach', about: c.name}); ok(!r.ok && /do not know/.test(r.error), 'a place not yet known is refused'); (await import('../src/sim/lore.js')).learnPlace(me(), c.name, 'told');
  r = call('swear_oath', {kind: 'reach', about: c.name}); ok(r.ok, 'reach vow sworn '+(r.error||'')); run(1);
  ok(!me().vow && questLog(me()).done.some(q => /reach/i.test(q.title) && q.status === 'done'), 'reaching the place keeps it');
  // recover
  r = call('swear_oath', {kind: 'recover', about: 'The Moonglass Ring'}); ok(r.ok, 'recover vow sworn');
  goalEvent(me(), 'epic', 'The Moonglass Ring'); ok(!me().vow, 'looting the epic keeps it');
  // free vow lapses kept at the end of its term; a slay vow expires
  r = call('swear_oath', {text: 'I will not drink again.', days: 1}); ok(r.ok && r.term_days === 1, 'a free vow with a one day term');
  S.gameMin += 1500; run(1); ok(!me().vow && questLog(me()).done.some(q => /not drink/.test(q.title) && q.status === 'done'), 'a free vow held to the end of its term is kept');
  r = call('swear_oath', {kind: 'slay', about: foe.name, days: 1}); S.gameMin += 1500; run(1);
  ok(!me().vow && questLog(me()).done.some(q => q.title.includes(foe.name) && q.status === 'expired') && !me().vowBroke, 'a slay vow past its term is expired, not broken');
  // renounce: costs
  r = call('swear_oath', {text: 'I will never leave this company.', kind: 'vow'}); ok(r.ok, 'a vow sworn before a witness');
  const b0 = me().bonds[ob().id], nR = ob().playEvN || 0, ch0 = S.chronicle.length;
  r = call('renounce_oath', {reason: 'It was too much to ask'});
  ok(r.ok && !me().vow, 'renounce_oath: the vow is given up');
  ok((me().bonds[ob().id] || 0) < b0, `the witness cools (${b0} -> ${me().bonds[ob().id] || 0})`);
  ok((me().tiers.marks || []).some(m => /Broke their word/.test(m.text)), 'a landmark: broke their word');
  ok(S.chronicle.length > ch0, 'a Chronicle line');
  ok((ob().playEv || []).some(e => e.n > nR && /broken the vow/.test(e.text)), 'witnesses are told');
  ok(questLog(me()).done.some(q => q.status === 'abandoned' && /leave this company/.test(q.title)), 'the done list shows it abandoned');
  ok(openThreads({ids: [a.id], plans: [], log: [], seq: 0}).some(t => t.kind === 'broken'), 'the DM sees the broken word as a thread');
  const keptGoal = me().goal; me().goal = null; r = call('renounce_oath'); ok(!r.ok && /no sworn vow/.test(r.error), 'renounce with no vow is refused'); me().goal = keptGoal;
  // protect: a companion's fall breaks it
  const {foundCompany} = await import('../src/sim/company.js');
  const fc = foundCompany([me(), ob()]); r = call('swear_oath', {kind: 'protect', about: ob().name});
  ok(r.ok && me().vow.kind === 'protect', `a protect vow for a companion (${fc.ok})`);
  const sv = JSON.parse(JSON.stringify(snapshot())); ok(sv.agents.find(x => x.id === a.id).vow, 'the vow is saved with the hero');
  ob().state = 'dead'; run(1); ok(!me().vow && me().vowBroke && me().vowBroke.how === 'failed', 'the companion fell: the vow failed');
  // scripted heroes hold no vows and are not touched
  ok(S.agents.filter(x => !x.player).every(x => !x.vow), 'no scripted hero holds a vow');
}


// ---- own oaths (#800): the past is given, the oath is chosen ----
{console.log('\nown oaths');
  const O = await import('../src/sim/oath.js'), W = await import('../src/sim/sworn.js'), {goalEvent} = await import('../src/sim/goals.js'), {openThreads, foundCompany} = await import('../src/sim/company.js');
  const {reflectDone, reflectDue} = await import('../src/sim/reflect.js'), {ELITES} = await import('../src/data/mobs.js'), {DG_EPICS} = await import('../src/data/items.js'), {ZONES} = await import('../src/world/map.js');
  const words = ps => (ps || []).map(p => typeof p === 'string' ? p : p && (p.name || p.t) || '').join('');
  Math.random = rand; seed = 0x9e3779b9 ^ 800; init({fellowship: false}); run(2);
  const free = S.agents.filter(x => x.fac === 0 && !x.party), [h, c, o] = free, oldSave = free[3], scr = free[4];
  const say = (x, t, g) => {x.playRate = []; return P.playerAct(x.id, t, g || {})};
  const put = x => {x.state = 'town'; x.x = homeOf(x).gate.x; x.y = homeOf(x).gate.y; x.hidden = false; x.pq = []};
  ok(!scr.goal.offered && O.swornOf(scr) === scr.goal, 'a scripted hero reads as it always did: its goal is its oath');
  const rolled = {...h.goal}; for (const x of [h, c, o]) {P.markPlayer(x, true); put(x)}
  ok(h.goal.offered && h.goal.text === rolled.text && !O.swornOf(h), 'agent-played: the rolled goal is an offered thread');
  let L = questLog(h); const th = L.offered.find(q => q.kind === 'oath');
  ok(th && th.status === 'offered' && th.sworn === false && th.title === O.threadText(h) && !L.active.some(q => q.kind === 'oath'), 'the quest log shows it offered, not held: ' + th.title);
  ok(P.playerAct(h.id, 'quests').offered.some(q => q.kind === 'thread' && q.sworn === false), 'the quests tool calls it a thread');
  ok(P.playerAct(h.id, "status").thread === O.threadText(h) && P.playerAct(h.id, "status").oath === null, 'status: a thread, no oath');
  // a hero who never swears: no nagging, one offer only
  ok(paceBrief(h.id).brief.thread, 'the header names it while the offer stands');
  S.gameMin = Math.floor(S.gameMin / 1440) * 1440 + 1300; h.playEvN = 99; h.playActAt = S.gameMin; run(0.05);
  const due = reflectDue(h), rb = paceBrief(h.id).brief.reflect;
  ok(due && rb && rb.thread === O.threadText(h), 'the first dusk asks once more');
  ok(reflectDone(h, due.id, 0).ok && h.goal.quiet && h.goal.offered, 'answered or not, that was the last time');
  ok(!paceBrief(h.id).brief.thread && !O.askOpen(h) && O.threadOf(h), 'the header stops naming it; it stays in the hero\'s own log');
  S.gameMin += 1440; h.playEvN = 199; h.playActAt = S.gameMin; run(0.05); ok(!(paceBrief(h.id).brief.reflect || {}).thread, 'no second dusk asks');
  // a thread that comes true unsworn: no oath was kept
  {const n0 = (h.playEv || []).length, c0 = S.chronicle.length, d0 = questLog(h).done.length, g0 = h.goal; h.goal = {...g0, type: 'hoard', need: 1, text: 'Bank 1 gold'}; h.gold = 50; run(1);
   ok(h.goal.offered && h.goal.aside && !O.threadOf(h) && questLog(h).done.length === d0, 'a thread that came true unsworn ends in silence, and the next is read by nobody');
   ok(!S.chronicle.slice(0, S.chronicle.length - c0).some(e => /oath/i.test(words(e.parts))), 'the Chronicle says no oath was kept')}
  // sworn later, from nothing
  let r = say(h, 'swear_oath', {text: 'I will stand in ' + ZONES[1] + ' before I die.'});
  ok(r.ok && r.oath && h.goal.kind === 'reach' && !h.vow, 'with no oath and no term, swear_oath is the oath: matched to a place');
  r = say(h, 'swear_oath', {text: 'And not drink till then.', days: 3}); ok(r.ok && h.vow && !r.oath, 'with an oath held, a vow beside it');
  h.x = S.agents[0].x; const keptBefore = h.oathKept; h.goal.about.zone = 0; h.goal.about.x = h.x; {const {zoneAt} = await import('../src/world/map.js'); h.goal.about.zone = zoneAt(h.x, h.y)} run(1);
  ok(h.oathKept && h.oathKept !== keptBefore && O.swornOf(h) === null && questLog(h).done.some(q => q.kind === 'oath' && q.status === 'done'), 'a place reached keeps the oath');
  ok(S.timeline.some(e => e.kind === 'oath' && /kept the oath/.test(words(e.parts))), 'kept, in the timeline');
  // matching
  const E = ELITES[0], ep = DG_EPICS[0];
  ok(W.matchWords(c, 'I will slay ' + E.name + ' for my sister.').type === 'avenge' && W.matchWords(c, 'I will slay ' + E.name + '.').target === E.name, 'words naming an elite are held to it');
  ok(W.matchWords(c, 'The ' + ep + ' comes home with me.').type === 'heirloomCrypt', 'words naming an epic are held to it');
  ok(W.matchWords(c, 'I will never again be cold.').kind === 'vow', 'anything else is kept as words');
  r = say(c, 'swear_oath', {text: 'I will slay ' + E.name + ' for my sister.'}); ok(r.ok && c.goal.type === 'avenge' && c.goal.text.includes('sister'), 'the hero\'s text is the oath');
  ok(openThreads({ids: [c.id]}).some(t => t.kind === 'oath') && !openThreads({ids: [o.id]}).some(t => t.kind === 'oath'), 'open threads list only the sworn');
  goalEvent(c, 'kill', {elite: true, name: E.name}); ok(c.oathKept && /sister/.test(c.oathKept.text) && (c.goal === null || !O.swornOf(c)), 'the game sees it kept');
  ok(S.chronicle.some(e => /kept the oath/.test(words(e.parts))) && !S.chronicle.some(e => /A new oath/.test(words(e.parts)) && e.parts.some(p => p && p.id === c.id)), 'kept in their words, and no new oath is rolled in their name');
  // what the game cannot track: kept as words; only the hero can say it is done
  r = say(o, 'swear_oath', {text: 'I will never again be cold.'});
  ok(r.ok && W.wordsOnly(o.goal) && /keep_oath/.test(r.note), 'untrackable words stand as an oath');
  run(1); ok(O.swornOf(o), 'the game never calls them kept');
  ok(!say(c, 'keep_oath', {how: 'done'}).ok, 'keep_oath with no oath is refused');
  r = say(o, 'keep_oath', {how: 'The fire is mine now and I am warm.'}); ok(r.ok && !O.swornOf(o) && o.oathKept && questLog(o).done.some(q => q.status === 'done' && q.kind === 'oath'), 'the hero says it is done, aloud');
  // renouncing, with witnesses, and an owner pin
  put(o); put(c); c.x = o.x; c.y = o.y; o.bonds = {[c.id]: 5}; c.bonds = {[o.id]: 5};
  r = say(o, 'swear_oath', {text: 'My sword is for this road alone.'}); ok(r.ok && r.heard_by.includes(c.name) && o.goal.sworn.heard.includes(c.id), 'sworn before a witness');
  o.persona = o.persona || {}; o.persona.pins = {oath: true};
  r = say(o, 'renounce_oath', {why: 'no'}); ok(!r.ok && /fixed/.test(r.error), 'a pinned oath cannot be renounced');
  o.persona.pins = {}; const nc = (c.playEv || []).length;
  ok(!say(o, 'abandon_quest', {id: questLog(o).active.find(q => q.kind === 'oath').id}).ok, 'abandon_quest still refuses it');
  r = say(o, 'renounce_oath', {why: 'The road changed me'});
  ok(r.ok && !o.goal && o.vowBroke.how === 'renounced' && (o.bonds[c.id] || 0) < 5 && (c.playEv || []).slice(nc).some(e => /broken the oath/.test(e.text)), 'renounced: the word broken, bonds cooled, the witness told');
  ok(S.chronicle.some(e => /broke their word/.test(words(e.parts))) && (o.tiers.marks || []).some(m => /Broke their word/.test(m.text)), 'a Chronicle line and a landmark');
  // an older save: agent heroes with oaths from before keep them
  {oldSave.player = true; delete oldSave.goal.offered; (S.playerHeroes = S.playerHeroes || []).push(oldSave.id); const sv = JSON.parse(JSON.stringify(snapshot())); restore(sv);
   const b = S.agents.find(x => x.id === oldSave.id); ok(O.swornOf(b) && !b.goal.offered && questLog(b).active.some(q => q.kind === 'oath' && q.sworn), 'an older save: an agent hero\'s oath stays sworn');
   P.markPlayer(b, true); ok(!b.goal.offered, 'marking it again takes nothing away');
   const n = {...b.goal}; b.playRate = []; ok(P.playerAct(b.id, 'renounce_oath', {}).ok && !b.goal, 'and it can be renounced: ' + n.text)}
  // a recruit and a hand-back
  {const z = S.agents.find(x => !x.player && x.kind === 'hero' && x.state !== 'dead' && !x.party); P.markPlayer(z, true); ok(z.goal.offered && O.askOpen(z), 'a recruit made agent-played starts with an open offer');
   P.markPlayer(z, false); ok(!z.goal.offered && O.swornOf(z) === z.goal, 'handed back to the scripted rules, it is an oath again')}
  {const p0 = S.agents.find(x => x.state !== 'dead' && x.kind === 'hero' && !x.player && x.goal); const s1 = JSON.stringify(p0.goal); P.markPlayer(p0, true); const sv = JSON.parse(JSON.stringify(snapshot())); restore(sv); const q = S.agents.find(x => x.id === p0.id); ok(q.goal.offered && O.threadOf(q), 'an offered thread survives a save'); ok(s1.length > 0, 'its goal is the same goal')}
}

// ---- goods jobs (#720): board and DM jobs that ask for crafted or gathered goods ----
{console.log('\ngoods jobs');
  const {SUPPLY, SUPPLY_KEYS} = await import('../src/data/adventures.js');
  const SP = await import('../src/sim/supply.js');
  const {learn, gainSkill} = await import('../src/sim/professions.js');
  const {addUse, addGood, count, invOf} = await import('../src/sim/inv.js');
  Math.random = rand; seed = 0x9e3779b9 ^ 720;
  init({fellowship: false}); run(2);
  const h = S.agents.find(x => x.fac === 0 && x.state === 'town' && !x.party) || S.agents.find(x => x.fac === 0);
  const hc = homeOf(h); h.lvl = 8; h.hp = maxHp(h); h.gold = 100; h.party = null; P.markPlayer(h, true);
  h.x = hc.ah.x; h.y = hc.ah.y; h.state = 'town'; h.pq = [];
  const hcall = (tool, args) => {h.playRate = []; return P.playerAct(h.id, tool, args || {})};
  const by = {by: 'dm-agent', reason: 'the chapel is short of draughts'};
  ok(SUPPLY_KEYS.length >= 8 && SUPPLY_KEYS.every(k => !ADVENTURES[k]), 'goods job templates are kept apart from the adventure templates (' + SUPPLY_KEYS.length + ')');
  const advBefore = (S.adventures || []).length;
  let rr = pull('post_hook', {town: hc.name, tpl: 'draughts', reward: 'generous'}, by); const j1 = rr.ret;
  ok(rr.ok && j1 && j1.phase === 'open' && j1.by === 'dm-agent' && S.supply.includes(j1) && (S.adventures || []).length === advBefore, 'post_hook with a goods tpl posts a goods job (by the DM agent), not an adventure: ' + (j1 && SP.textOf(j1)));
  ok(j1.want.kind === 'craft' && j1.want.id === 'Redroot Draught' && j1.want.n >= 3 && j1.want.n <= 4 && j1.gold > 0, 'it asks for ' + j1.want.n + ' ' + j1.want.id + ' and pays ' + j1.gold + 'g');
  pull('post_hook', {town: hc.name, tpl: 'ore'}, by); rr = pull('post_hook', {town: hc.name, tpl: 'perch'}, by);
  ok(!rr.ok && /goods jobs/.test(JSON.stringify(rr)), 'a board holds at most ' + SP.SUP.BOARD_MAX + ' goods jobs: ' + (rr.reason || rr.error || ''));
  const wd = pull('withdraw_hook', {hook: S.supply.find(x => x.tpl === 'ore').id}, by); ok(wd.ok && !S.supply.some(x => x.tpl === 'ore'), 'withdraw_hook takes a goods job down');
  let r = hcall('list_jobs'); const gj = (r.jobs || []).find(x => x.goods && x.id === j1.id);
  ok(gj && /Redroot Draught/.test(gj.wants) && /g/.test(gj.pays) && gj.giver, 'list_jobs shows the goods job with what it wants and pays: ' + (gj && gj.wants));
  ok(!JSON.stringify(gj).match(/dm-agent|DM agent|scripted/i), 'the hero is not told who posted it');
  r = hcall('turn_in'); ok(!r.filled, 'turn_in with an empty pack fills nothing');
  r = hcall('take_quest', {id: 'supply:' + j1.id}); ok(r.ok && j1.phase === 'taken' && j1.taker === h.id && r.wants, 'take_quest supply:' + j1.id + ': ' + (r.took || r.error));
  const q1 = hcall('quests').active.find(x => x.id === 'supply:' + j1.id);
  ok(q1 && q1.kind === 'job' && /bring \d Redroot Draught/.test(q1.objective) && q1.progress === '0/' + j1.want.n && q1.giver, 'quests lists it: ' + (q1 && q1.objective));
  ok(questLog(h).active.find(x => x.id === 'supply:' + j1.id).kind === 'dm', 'the watcher sees it as a DM job');
  addUse(h, 'Redroot Draught', j1.want.n - 1); r = hcall('turn_in'); ok(!r.filled && j1.phase === 'taken', 'one short: nothing is handed in');
  addUse(h, 'Redroot Draught', 1); const g0 = h.gold, hon0 = h.honor || 0; r = hcall('turn_in');
  ok(r.ok && r.filled && h.gold === g0 + j1.gold && (h.honor || 0) === hon0 + 1 && count(h, 'Redroot Draught') === 0 && !S.supply.includes(j1), 'turn_in hands the goods in and is paid ' + j1.gold + 'g, a line of honor: ' + (r.filled || r.error));
  ok(questLog(h).done.some(x => x.id === 'supply:' + j1.id && x.status === 'done' && x.progress.have === j1.want.n), 'the quest log keeps it as done');
  ok(S.supplyStats.filled === 1 && S.supplyStats.taken === 1 && S.supplyStats.gold === j1.gold, 'the counters: one posted job taken, filled, paid');
  // crafted gear: a Wolfhide Cowl made by the hero is recognised by its pattern
  const j2 = pull('post_hook', {town: hc.name, tpl: 'cowl'}, by).ret; ok(j2 && j2.want.id === 'Wolfhide Cowl' && j2.want.n === 1 && /^A /.test(SP.textOf(j2)), 'a gear job: ' + SP.textOf(j2));
  learn(h, 'leatherworking'); gainSkill(h, 'leatherworking', 5); addGood(h, 'Wolf Pelt', 2); addGood(h, 'Wolf Sinew', 2); h.gold = 100;
  const cr = hcall('craft', {recipe: 'cure-wolfhide'}); ok(cr.ok, 'the hero crafts a Wolfhide Cowl: ' + (cr.result || cr.why || cr.error));
  const g1 = h.gold; r = hcall('turn_in'); ok(r.ok && r.filled && h.gold === g1 + j2.gold && !invOf(h).list.some(e => e.craft === 'Wolfhide Cowl') && !S.supply.includes(j2), 'the cowl is handed in from the pack and paid');
  // gathered goods, filled without taking the job first
  const j3 = pull('post_hook', {town: hc.name, tpl: 'ore'}, by).ret; addGood(h, 'Tin Ore', j3.want.n); const g2 = h.gold; r = hcall('turn_in');
  ok(r.ok && r.filled && h.gold === g2 + j3.gold && !S.supply.includes(j3), 'a gathered-goods job is filled straight from the pack: ' + (r.filled || r.error));
  // a job for another company is not this hero's
  const j4 = pull('post_hook', {town: hc.name, tpl: 'herbs'}, by).ret; j4.ff = 1; j4.cid = 99999; addGood(h, 'Redroot Leaf', j4.want.n);
  r = hcall('turn_in'); ok(!r.filled && S.supply.includes(j4), 'a hall job reserved to another company is not filled by this hero');
  r = hcall('take_quest', {id: j4.id}); ok(!r.ok, 'nor taken by it: ' + r.error); j4.ff = 0; j4.cid = null;
  // abandon, then expiry
  r = hcall('take_quest', {id: j4.id}); ok(r.ok, 'take it once it is open to all'); r = hcall('abandon_quest', {id: 'supply:' + j4.id}); ok(r.ok && j4.phase === 'open' && !j4.taker, 'abandon_quest puts it back on the board');
  hcall('take_quest', {id: j4.id}); S.gameMin += 4 * 1440; run(1);
  ok(!S.supply.includes(j4) && questLog(h).done.some(x => x.id === 'supply:' + j4.id && x.status === 'expired') && S.supplyStats.expired >= 1, 'a taken job that is not filled goes cold: expired in the log');
  const j5 = pull('post_hook', {town: hc.name, tpl: 'sinew'}, by).ret; S.gameMin += 3 * 1440; run(1); ok(!S.supply.includes(j5), 'an open job comes down after its time');
  // save and restore with a taken job
  const j6 = pull('post_hook', {town: hc.name, tpl: 'meals'}, by).ret; hcall('take_quest', {id: j6.id}); const snap = JSON.parse(JSON.stringify(snapshot()));
  ok(snap.supply && snap.supply.some(x => x.id === j6.id && x.phase === 'taken'), 'the goods job is in the save');
  restore(snap); const h2 = S.agents.find(x => x.id === h.id), j6b = (S.supply || []).find(x => x.id === j6.id);
  ok(j6b && j6b.taker === h.id && questLog(h2).active.some(x => x.id === 'supply:' + j6.id), 'after restore the hero still holds it');
  addUse(h2, 'Spit-Roast Perch', j6b.want.n); h2.playRate = []; r = P.playerAct(h2.id, 'turn_in', {}); ok(r.ok && r.filled, 'and fills it after restore');
  // scripted heroes: the board asks, a hero of the town who holds the trade answers from its pack, no dice
  const sh = S.agents.find(x => !x.player && x.fac === 0 && x.state !== 'dead' && homeOf(x) === hc);
  learn(sh, 'alchemy'); gainSkill(sh, 'alchemy', 30); sh.state = 'town'; S.supply.length = 0; delete S.supplyAt;
  const plan = SP.supplyPlan(hc, null); ok(plan && SUPPLY[plan.tpl].prof === 'alchemy' && !plan.ff, 'the scripted DM plans a job for a town hero who holds the trade: ' + (plan && plan.tpl));
  const pj = SP.postSupply(hc, 'draughts', {}); sh.gold = 50; addUse(sh, 'Redroot Draught', pj.want.n); const sg0 = sh.gold;
  ok(SP.supplyVisit(sh) >= 1 && !S.supply.includes(pj) && sh.gold === sg0 + pj.gold, 'a scripted hero in town fills it from its pack before the sale (' + pj.gold + 'g)');
  // the Fellowship first: a member with a trade is offered a hall job reserved to its company
  Math.random = rand; seed = 0x9e3779b9 ^ 721; init({}); run(2);
  const F = (await import('../src/sim/dmfocus.js')).focus(), fm = F && F.members[0];
  if (fm) {learn(fm, 'alchemy'); gainSkill(fm, 'alchemy', 30); S.supply = []; delete S.supplyAt; run(30);
    const ffj = (S.supply || []).find(x => x.ff);
    ok(ffj && ffj.cid === F.cid && SUPPLY[ffj.tpl].prof === 'alchemy', 'the scripted DM posts a Fellowship-first goods job for a member who holds a trade: ' + (ffj && SP.textOf(ffj)));
    ok(ffj && SP.mayHave(fm, ffj) && !SP.mayHave({id: 1e9, company: null}, ffj), "it is the company's: a member may have it, a stranger may not")}
  else ok(false, 'a Fellowship founded');
}

console.log(fail ? `\n${fail} check(s) FAILED\n` : '\nAll quest log checks passed.\n');
process.exit(fail ? 1 : 0);
