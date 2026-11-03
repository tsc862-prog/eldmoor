// Free actions ruled by the DM (issue #522): the hero tool attempt, the DM's ruling_call / ruling_answer, the scripted ruling
// (the DM's reflex) when nobody listens or the DM stays silent, refused effects (level, HP, gold), the hourly limit, an
// attempt inside a Table scene, and the channels rule (the DM's note never reaches a hero). No model, no network.
// Usage: node scripts/attemptcheck.mjs
let seed = 0x0522aced, forced = null;
const lcg = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
Math.random = () => forced != null ? forced : lcg(); // forced: .999 rolls a 20, 0 rolls a 1
let fake = null; const realNow = Date.now; Date.now = () => fake != null ? fake : realNow(); // the DM's wait, without real waiting

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp, dmAct, setDmSeat} = SIM;
const P = await import('../src/sim/player.js');
const R = await import('../src/sim/ruling.js');
const T = await import('../src/sim/table.js');
const CO = await import('../src/sim/company.js');
const {LANDMARKS, dist} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const act = (a, tool, args) => {a.playRate = []; return P.playerAct(a.id, tool, args || {})};
const J = v => {const seen = new WeakSet(); return JSON.stringify(v, (k, x) => {if (x && typeof x === 'object') {if (seen.has(x)) return; seen.add(x)} return x}) || ''};
const at = (x, s) => J(x).includes(s);

console.log('\nEldmoor attemptcheck: free actions ruled by the DM (#522)\n');
init({fellowship: false}); for (let i = 0; i < 20 * 60; i++) step(1 / 60);
ok(S.rulings === undefined, 'a scripted world never touches the ruling state');
CO.foundSlots(CO.autoPick(0), {fac: 0, ai: false}); SIM.setRunnerLinks(() => 'connected');
const M = CO.slotMembers(CO.slotted()).map(m => m.hero), A = M[0], B = M[1];
const home = homeOf(A);
const place = (x, p) => {x.x = p.x; x.y = p.y; x.state = 'town'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []};
for (const x of M) place(x, home.spots.square);
const fresh = a => {a.attempts = []};

console.log('no DM listening: the scripted ruling answers at once');
setDmSeat(false);
let r = act(A, 'attempt', {what: 'I search the well for a loose stone.'});
ok(r.ok && (r.outcome === 'success' || r.outcome === 'failure') && /Perception d20/.test(r.roll), 'ruled at once by keyword (search -> Perception): ' + r.outcome + ', ' + r.roll);
ok((A.chat || []).some(e => e.ruling && e.text === r.ruling), 'the ruling line is heard by the hero (chat)');
ok((B.chat || []).some(e => e.ruling) && (B.chat || []).some(e => e.trigger === 'attempt' && e.from === A), 'a companion in earshot hears the attempt and the ruling');
ok((A.playEv || []).some(e => /The DM rules on your attempt/.test(e.text) && e.w === 2), 'an event that starts the agent\'s turn');
ok(S.dmLog.some(e => e.detail && e.detail.ruling && e.detail.by === 'scripted' && e.detail.fill && e.detail.why === 'gone'), 'DM log: scripted fill, why gone');
ok((A.playLog || []).some(e => e.tool === 'attempt'), 'the Agent tab shows the attempt');
ok(R.keywordSkill('I pick the lock') === 'traps' && R.keywordSkill('I climb the wall') === 'athletics' && R.keywordSkill('I bargain with the reeve') === 'persuasion'
  && R.keywordSkill('I listen at the door') === 'traps' && R.keywordSkill('I listen closely') === 'perception' && R.keywordSkill('I hum a tune') === 'athletics', 'keyword skills (door/lock, climb, bargain, listen, else might)');

console.log('refusals and the hourly limit');
fresh(A);
ok(!act(A, 'attempt', {}).ok, 'empty: refused');
ok(/Too long/.test(act(A, 'attempt', {what: 'x'.repeat(301)}).error), 'too long: refused');
ok(/English/.test(act(A, 'attempt', {what: 'Я открываю дверь ключом и слушаю'}).error), 'not English: refused');
A.hidden = true; ok(/reach/.test(act(A, 'attempt', {what: 'I listen.'}).error), 'hidden: refused'); A.hidden = false;
A.state = 'fight'; ok(/fight/.test(act(A, 'attempt', {what: 'I kick sand.'}).error), 'in a fight: refused'); A.state = 'town';
fresh(A); for (let i = 0; i < 3; i++) act(A, 'attempt', {what: 'I try the door, number ' + i + '.'});
r = act(A, 'attempt', {what: 'I try the door once more.'});
ok(!r.ok && /3 things this game hour/.test(r.error), 'a fourth in one game hour: refused');
fresh(A);

console.log('the DM rules (ruling_call / ruling_answer)');
setDmSeat(true); fake = 1e12;
ok(dmAct('ruling_call', {budget_s: 10}).call === null, 'nothing waits');
const lm = LANDMARKS[0].name;
r = act(A, 'attempt', {what: 'I study the old milestone for marks.', at: 'milestone'});
ok(r.ok && r.call && /weighs/.test(r.ruling), 'the attempt waits for the DM (the voice polled): call ' + r.call);
let c = dmAct('ruling_call', {budget_s: 10});
ok(c.call && c.call.call === r.call && c.call.attempt.what.includes('milestone') && c.call.legal.effects.includes('reveal') && c.call.seconds_left > 9, 'ruling_call: the attempt, the hero in words, legal effects, 10 s');
ok(!at(c.call.hero, '"hp"') && !at(c.call.hero, '"lvl"'), 'the call carries a level band and health in words');
const st = dmAct('dm_status'); ok(st.rulings && st.rulings.waiting === 1, 'dm_status lists the waiting ruling');
let a2 = dmAct('ruling_answer', {call: r.call, skill: 'lore', dc: 'fair', effects: ['level:+1'], text: 'It glows.'});
ok(!a2.ok && /bounded set/.test(a2.error) && /level/.test(a2.error), 'a level effect: refused');
ok(S.dmLog.some(e => e.detail && e.detail.ruling && e.detail.forbidden), 'the refusal is in the DM log, marked forbidden');
ok(!dmAct('ruling_answer', {call: r.call, skill: 'lore', dc: 'fair', fail_effects: ['wound:50'], text: 'It glows.'}).ok, 'a wound over 15%: refused');
ok(!dmAct('ruling_answer', {call: r.call, skill: 'lore', dc: 'fair', effects: ['heal:20'], text: 'It glows.'}).ok, 'a heal: refused');
ok(!dmAct('ruling_answer', {call: r.call, skill: 'lore', dc: 'fair', effects: ['item:give:gold'], text: 'It glows.'}).ok, 'gold: refused');
ok(!dmAct('ruling_answer', {call: r.call, skill: 'magic', dc: 'fair', text: 'It glows.'}).ok, 'an unknown skill: refused');
ok(!dmAct('ruling_answer', {call: r.call, skill: 'lore', dc: 'impossible', text: 'It glows.'}).ok, 'an unknown DC: refused');
forced = .999; const hp0 = A.hp;
a2 = dmAct('ruling_answer', {call: r.call, skill: 'Cunning', dc: 'hard', effects: ['reveal:place:' + lm, 'reveal:fact:The milestone points to a buried road', 'boon:d6'], fail_effects: ['wound:10'],
  text: 'Under the moss: an arrow, and a name.', fail_text: 'Moss and nothing.', note: 'SECRET-NOTE-522 the hidden road'});
forced = null;
ok(a2.ok && a2.outcome === 'success' && /Traps d20 20/.test(a2.roll), 'a natural 20 succeeds (Cunning reads as Traps): ' + a2.roll);
ok(A.lore && A.lore.p[lm], 'reveal:place: ' + lm + ' is known');
ok(at(A.memories, 'buried road'), 'reveal:fact: a note the hero keeps');
ok(A.boon && A.boon.die === 'd6' && A.hp === hp0, 'boon set, no wound on a success');
ok((A.chat || []).some(e => e.ruling && /an arrow, and a name/.test(e.text)), 'the hero hears the DM\'s text');
ok(S.dmLog.some(e => e.detail && e.detail.ruling && e.detail.by === 'dm-agent' && e.detail.pass), 'DM log: the ruling with the DM AGENT tag');
ok(!at(A.playEv, 'SECRET-NOTE') && !at(A.chat, 'SECRET-NOTE') && !at(A.playLog, 'SECRET-NOTE') && !at(B.chat, 'SECRET-NOTE') && !at(A.memories, 'SECRET-NOTE'), 'channels: the DM\'s note never reaches a hero');
ok(at(S.dmLog, 'SECRET-NOTE'), 'the note is in the DM log');
ok(!dmAct('ruling_answer', {call: r.call, skill: 'lore', dc: 'fair', text: 'Again.'}).ok, 'a second answer to a ruled call: refused');

console.log('a failure: the wound never takes a hero below 10%');
fresh(A); A.hp = Math.round(maxHp(A) * .14);
r = act(A, 'attempt', {what: 'I leap the gap between the roofs.'}); c = dmAct('ruling_call', {budget_s: 10});
forced = 0; a2 = dmAct('ruling_answer', {call: r.call, skill: 'athletics', dc: 'easy', effects: ['none'], fail_effects: ['wound:15', 'condition:exposed:30'], text: 'You land it.', fail_text: 'You fall short and land hard.'}); forced = null;
ok(a2.ok && a2.outcome === 'failure', 'a natural 1 fails even at easy (the boon was spent on it)');
ok(A.hp >= maxHp(A) * .1 - .5 && A.hp < maxHp(A) * .14, 'wound:15 at 14% HP stops at the 10% floor (' + Math.round(A.hp / maxHp(A) * 100) + '%)');
ok(A.eff && A.eff.taken && A.eff.taken.v > 1, 'condition exposed');
ok(!A.boon, 'the boon was used on this attempt');
A.hp = maxHp(A);

console.log('the DM silent: the scripted ruling fills after the bounded wait');
fresh(A); dmAct('ruling_call', {budget_s: 4});
r = act(A, 'attempt', {what: 'I bargain with the gate guard for a cheaper toll.'});
ok(r.call, 'waiting for the DM');
fake += 2000; step(1 / 60); ok(S.rulings.cur.some(x => x.id === r.call && x.state === 'wait'), 'still waiting inside its 4 s');
fake += 2500; step(1 / 60); ok(S.rulings.cur.some(x => x.id === r.call && x.state === 'wait'), 'never picked up: still waiting past its 4 s (the pickup allowance, #680)');
fake += 4000; step(1 / 60); ok(!S.rulings.cur.some(x => x.id === r.call), 'filled at 4 s + the 4 s pickup cap');
ok(S.dmLog.some(e => e.detail && e.detail.ruling && e.detail.call === r.call && e.detail.by === 'scripted' && e.detail.why === 'slow' && e.detail.late === 'late pickup' && e.detail.skill === 'persuasion'), 'scripted fill logged: why slow, late pickup, persuasion by keyword');
a2 = dmAct('ruling_answer', {call: r.call, skill: 'persuasion', dc: 'fair', text: 'Late.'});
ok(!a2.ok && /scripted DM filled it/.test(a2.error), 'a late answer is refused: ' + a2.error);
console.log('the budget starts at pickup (#680)');
fresh(A); dmAct('ruling_call', {budget_s: 4}); fake += 100;
r = act(A, 'attempt', {what: 'I read the old milestone by touch.'});
fake += 1500; step(1 / 60); c = dmAct('ruling_call', {budget_s: 4});
ok(c.call && c.call.seconds_left >= 3.9, 'picked up 1.5 s late: the full 4 s left (' + (c.call && c.call.seconds_left) + ')');
fake += 3500; step(1 / 60); ok(S.rulings.cur.some(x => x.id === r.call && x.state === 'wait'), '5 s after the attempt (3.5 s after pickup): still waiting');
a2 = dmAct('ruling_answer', {call: r.call, skill: 'lore', dc: 'fair', text: 'The letters are older than the road.'}); ok(a2.ok, 'answered 3.5 s after pickup: accepted');
fresh(A); dmAct('ruling_call', {budget_s: 4}); r = act(A, 'attempt', {what: 'I count the guards on the wall.'});
fake += 3000; step(1 / 60); dmAct('ruling_call', {budget_s: 4}); fake += 4200; step(1 / 60);
ok(!S.rulings.cur.some(x => x.id === r.call), 'picked up and silent: filled at its deadline');
ok(S.dmLog.some(e => e.detail && e.detail.ruling && e.detail.call === r.call && e.detail.late === 'no answer in time'), 'scripted fill logged: no answer in time');
fresh(A); dmAct('ruling_call'); r = act(A, 'attempt', {what: 'I listen at the shutters.'}); setDmSeat(false);
step(1 / 60); ok(!S.rulings.cur.some(x => x.id === r.call), 'the seat closing fills a waiting ruling at once');

console.log('an attempt in a Table scene');
setDmSeat(true); T.TABLE.speed = 1; T.TABLE.mode = 'auto'; fresh(A); fresh(B);
const sc = T.openScene('check', 'The rope bridge', ['A rope bridge sways over the gorge.'], {}, CO.companyOf(A));
ok(sc && sc.ids.includes(A.id), 'a check scene is open');
const tv = P.playerAct(A.id, 'look', {}); ok(at(T.tableView(A).options, 'attempt ='), 'the member\'s options include attempt');
ok(/scene_act/.test(act(A, 'attempt', {what: 'I test the ropes.'}).error), 'the attempt tool points to scene_act inside a scene');
dmAct('ruling_call', {budget_s: 10});
const sa = act(A, 'scene_act', {option: 'attempt', line: 'I tie my belt to the guide rope and test each plank.'});
ok(sa.ok !== false, 'scene_act attempt accepted');
ok(/line/.test(String(act(B, 'scene_act', {option: 'attempt'}).error || '')), 'scene_act attempt without a line: refused');
for (const x of M) if (x !== A && !sc.acts[x.id]) act(x, 'scene_act', {option: 'steady'});
c = dmAct('ruling_call', {budget_s: 10});
ok(c.call && c.call.where.table_scene === 'The rope bridge' && !c.call.legal.effects.includes('move'), 'ruling_call names the scene; move is not legal at the table');
for (let i = 0; i < 30; i++) step(1 / 60);
ok(S.table === sc && !sc.beats.some(b => b.k === 'attempt'), 'the table waits while the DM weighs it');
forced = .999; a2 = dmAct('ruling_answer', {call: c.call.call, skill: 'athletics', dc: 'fair', effects: ['reveal:fact:The third plank is rotten'], text: 'The rope holds; the third plank does not.'});
ok(a2.ok && /turn at the table/.test(a2.note), 'ruled; it plays on the member\'s turn');
let k = 0; while (S.table === sc && k++ < 600) step(1 / 60); forced = null;
const beat = sc.beats.find(b => b.k === 'attempt');
ok(beat && /success/.test(beat.res) && beat.line.includes('belt'), 'the beat: ' + (beat && beat.res));
ok((A.chat || []).some(e => e.ruling && /third plank/.test(e.text)), 'the table hears the ruling');
ok(S.dmLog.some(e => e.detail && e.detail.ruling && e.detail.by === 'dm-agent' && e.detail.pass), 'logged with the DM AGENT tag');
// the same at 8x: no wait, the scripted ruling
T.TABLE.speed = 8; fresh(A);
const sc2 = T.openScene('check', 'The ford', ['A cold ford.'], {}, CO.companyOf(A));
if (sc2) {act(A, 'scene_act', {option: 'attempt', line: 'I wade across with a pole to feel the bottom.'}); for (const x of M) if (x !== A && !sc2.acts[x.id]) act(x, 'scene_act', {option: 'steady'});
  k = 0; while ((S.table === sc2) && k++ < 600) step(1 / 60);
  const b2 = sc2.beats.find(b => b.k === 'attempt'); ok(b2 && /(success|failure)/.test(b2.res), 'at 8x the scripted ruling plays it at once: ' + (b2 && b2.res))}
else ok(true, 'at 8x (scene resolved inside openScene)');
T.TABLE.speed = 1;

console.log('the ruling voice (scripts/dm-agent.mjs) with a mock model');
{const DA = await import('./dm-agent.mjs'); fake = null; setDmSeat(true); fresh(A); A.state = 'town';
  let asked = null; const adapter = {call: async o => {asked = o; return {text: J({skill: 'persuasion', dc: 'fair', effects: [{kind: 'reveal', target: 'fact', value: 'The reeve owes the miller money'}, {kind: 'none', target: '', value: ''}], fail_effects: [{kind: 'none', target: '', value: ''}], text: 'The reeve grunts and waves you through.', fail_text: 'The reeve laughs.', note: 'voice note'}), usage: {in: 500, out: 60, cost: .0001}}}};
  const lines = [], tool = async (b, t, args) => dmAct(t, args), V = DA.rulingVoice({base: 'x', adapter, model: 'mock', log: l => lines.push(l), tool, pollIdle: 20, pollHot: 10, budgetS: 10});
  await new Promise(res => setTimeout(res, 60));
  r = act(A, 'attempt', {what: 'I offer the reeve a token instead of the toll.'});
  for (let i = 0; i < 100 && !lines.some(l => l.startsWith('[ruling]')); i++) {await new Promise(res => setTimeout(res, 20)); step(1 / 60)}
  await V.stop();
  ok(asked && asked.schema.properties.skill.enum.includes('persuasion') && asked.schema.properties.effects.items.properties.kind.enum.includes('reveal') && /offer the reeve/.test(asked.user), 'one structured call: enums for skill and effect kinds, the attempt in the prompt');
  ok(lines.some(l => /\[ruling\] .*persuasion fair -> (success|failure)/.test(l)), 'answered through ruling_answer: ' + lines.find(l => l.startsWith('[ruling]')));
  ok(S.dmLog.some(e => e.detail && e.detail.ruling && e.detail.call === r.call && e.detail.by === 'dm-agent'), 'logged as the DM agent ruling');
  ok(DA.effectList([{kind: 'none', target: '', value: ''}]).join() === 'none' && DA.effectList([{kind: 'wound', target: '5', value: ''}]).join() === 'wound:5', 'effect objects become the game strings')}

console.log('lapsed: a hero gone');
fresh(B); setDmSeat(true); dmAct('ruling_call', {budget_s: 10}); r = act(B, 'attempt', {what: 'I look for tracks.'}); B.state = 'dead';
a2 = dmAct('ruling_answer', {call: r.call, skill: 'tracking', dc: 'fair', text: 'Tracks.'}); ok(!a2.ok && /lapses/.test(a2.error), 'the dead hero\'s attempt lapses');

console.log('\n' + (fail ? fail + ' FAILED' : 'all ok'));
process.exit(fail ? 1 : 0);
