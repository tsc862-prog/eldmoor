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
P.markPlayer(a, true);
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
const oath = questLog(a).active.find(q => q.kind === 'oath');
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
  r = call('renounce_oath'); ok(!r.ok && /no sworn vow/.test(r.error), 'renounce with no vow is refused');
  // protect: a companion's fall breaks it
  const {foundCompany} = await import('../src/sim/company.js');
  const fc = foundCompany([me(), ob()]); r = call('swear_oath', {kind: 'protect', about: ob().name});
  ok(r.ok && me().vow.kind === 'protect', `a protect vow for a companion (${fc.ok})`);
  const sv = JSON.parse(JSON.stringify(snapshot())); ok(sv.agents.find(x => x.id === a.id).vow, 'the vow is saved with the hero');
  ob().state = 'dead'; run(1); ok(!me().vow && me().vowBroke && me().vowBroke.how === 'failed', 'the companion fell: the vow failed');
  // scripted heroes hold no vows and are not touched
  ok(S.agents.filter(x => !x.player).every(x => !x.vow), 'no scripted hero holds a vow');
}

console.log(fail ? `\n${fail} check(s) FAILED\n` : '\nAll quest log checks passed.\n');
process.exit(fail ? 1 : 0);
