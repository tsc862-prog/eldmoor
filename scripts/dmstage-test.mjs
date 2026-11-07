// The DM on stage (issue #1017), run as a child by scripts/dmcheck.mjs (or alone: node scripts/dmstage-test.mjs). One part for each
// cause found in the owner's session: (1) the table voice took a new scene's call 1 for one it had already answered; (2) only a few
// scene kinds asked the DM at all; (3) the orders told the seat to prepare and keep quiet, and three event turns were gone by
// mid-morning; (4) nothing spoke between turns; (5) names from the DM's notes were refused with no way on. No model, no network:
// the voices run in process against a mock adapter on the real game. Prints STAGE OK.
let seed = 0x1017;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const sim = await import('../src/sim/index.js');
const {init, step, S, dmAct, setDmSeat} = sim;
const T = await import('../src/sim/table.js');
const C = await import('../src/sim/council.js');
const SLT = await import('../src/sim/company.js');
const N = await import('../src/sim/narrvoice.js');
const {DMA} = await import('../src/sim/dmagent.js');
const {ZONES, CITY, LANDMARKS, zoneAt} = await import('../src/world/map.js');
const {maxHp} = await import('../src/sim/heroes.js');
const {hearWake} = await import('../src/sim/player.js');
const {sceneFor} = T;
const D = await import('./dm-agent.mjs');
const {hostDm} = await import('../src/sim/player-host.js');

let fails = 0;
const ok = (c, msg, extra) => {if (c) console.log('  ok   ' + msg); else {fails++; console.log('  FAIL ' + msg + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : ''))}};
const nap = ms => new Promise(r => setTimeout(r, ms));
const tool = (b, t, a) => Promise.resolve(dmAct(t, a));
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
init({fac: 0}); run(20);
const F0 = SLT.slotted() || (SLT.foundSlots(SLT.autoPick(0), {fac: 0}), SLT.slotted());
SLT.setSlotMinds(F0, 'agent');
const heroes = () => SLT.slotHeroes(F0);
const pin = () => {for (const a of heroes()) a.hp = maxHp(a)};
T.TABLE.mode = 'auto'; T.TABLE.speed = 1;

// ---- a world nobody listens to asks nothing ----
{setDmSeat(true); const sc = T.openScene('check', 'Silent check', ['The DM calls for a roll.'], {anchor: heroes()[0].id}, F0);
  for (let i = 0; i < 400 && sceneFor(F0); i++) step(1 / 60);
  ok(sc && !sc.calls && !sc.gf, 'no table voice listening: a scene asks the DM nothing (a world with no runner plays as before)', sc && {calls: sc.calls, gf: sc.gf});
  S.gameMin += 3; for (let i = 0; i < 200; i++) step(1 / 60);
  ok(!S.narrVoice, 'no narrator voice listening: the tick writes nothing')}

// ---- table frames: every scene, every time ----
const asked = [], lines = [];
const adapter = {call: async ({user, schema}) => {asked.push(user); const e = schema.properties.pick && schema.properties.pick.enum; return {text: JSON.stringify({text: 'Rain ticks on the stones ' + asked.length + '.', pick: e ? e[e.length - 1] : ''}), usage: {in: 300, out: 20, cost: 0}}}};
const voice = D.tableVoice({base: '', adapter, model: 'mock', log: s => lines.push(s), pollIdle: 2, pollHot: 2, waitMs: 0, tool});
await nap(20);
async function scene(open) {pin(); const sc = open(); if (!sc) return null; const t0 = Date.now(); while (sceneFor(F0) && Date.now() - t0 < 12000) {step(1 / 60); pin(); await nap(1)} return sc}
const mob = () => {const a = heroes()[0], m = S.mobs.find(x => x.alive && !x.gone && !x.elite && x.kind === 'mob'); m.x = a.x + 1; m.y = a.y; m.target = a; m.hp = 1; return m};
const a1 = await scene(() => T.openScene('check', 'First check', ['The DM calls for a roll.'], {anchor: heroes()[0].id}, F0));
const a2 = await scene(() => T.openScene('check', 'Second check', ['The DM calls for another.'], {anchor: heroes()[0].id}, F0));
ok(a1 && a2 && a1.calls && a2.calls && a1.calls[0].id === a2.calls[0].id, 'two scenes in a row each ask call 1 (the ids start over in a scene)', a2 && a2.calls);
ok(a1.calls[0].by === 'dm-agent' && a2.calls[0].by === 'dm-agent', 'the voice answers both: a new scene\'s call 1 is not taken for the last one', a2.calls);
const a3 = await scene(() => T.openScene('ambush', 'Ambush at camp', ['A wolf comes out of the dark.'], {mob: mob().id, anchor: heroes()[0].id}, F0));
ok(a3 && a3.calls && a3.calls[0].by === 'dm-agent', 'an ambush at camp gets the DM\'s frame', a3 && {calls: a3.calls, kind: a3.kind});
ok(asked.some(u => /Cast: /.test(u) && /Foes: /.test(u)), 'the frame names the foe as its cast, so the voice invents no one');
const p = C.propose(heroes()[0], 'other', 'Rest here tonight'); let vote = sceneFor(F0);
{const t0 = Date.now(); while (sceneFor(F0) && Date.now() - t0 < 12000) {step(1 / 60); pin(); await nap(1)}}
ok(vote && vote.kind === 'decision' && vote.calls && vote.calls[0].by === 'dm-agent', 'a vote gets the DM\'s frame', vote && {k: vote.kind, c: vote.calls, p: typeof p === 'string' ? p : p.status});
ok(heroes().some(a => (a.chat || []).some(e => /^Rain ticks/.test(e.text) && e.from && e.from.kind === 'dm')), 'the members hear it as the narrator');
{const sc = await scene(() => T.openScene('check', 'Still true', ['The line that stands.'], {anchor: heroes()[0].id}, F0)), w = sc.calls[0];
  ok(/The line that stands/.test(w.about) && w.kind === 'voice', 'the game\'s own line stays the ground truth: the DM\'s words follow it')}
await voice.stop();
// a voice that polled but stays silent: the members wait its budget at most, the game's line stands and the fill is logged
{const sc = T.openScene('check', 'A silent voice', ['Only the game speaks.'], {anchor: heroes()[0].id}, F0); dmAct('table_call', {}); const was = T.TABLE.frameMs; T.TABLE.frameMs = 100;
  for (let i = 0; i < 2000 && sceneFor(F0); i++) {if (i % 10 === 0) dmAct('table_call', {}); step(1 / 60); pin()} T.TABLE.frameMs = was;
  ok(!sceneFor(F0) && sc.calls[0].by === 'scripted' && !sc.calls[0].text, 'a voice that never answers leaves the game\'s line, and the scene goes on', sc.calls);
  ok(S.dmLog.some(e => e.detail && e.detail.fill && e.detail.scene === 'check'), 'the fill is in the DM log')}
// a call waiting at one company's table is not hidden by another company's scene with nothing to ask
{const {setSceneKind} = T, A = await import('../src/sim/arrival.js'), idle = {id: 77, company: 99, kind: 'fireside', ids: [], calls: [{id: 1, done: true}], ctx: {}, beats: []}, wait = {id: 78, company: 98, kind: 'fireside', ids: [], calls: [{id: 1, done: false, kind: 'frame', t: 0, about: 'x'}], ctx: {}, beats: [], pause: true};
  const was = S.tables; S.tables = {98: idle, 99: wait}; ok(A.ourScene() === wait, 'a scene whose call waits comes before another company\'s fire that asks nothing', {got: A.ourScene() && A.ourScene().id}); S.tables = was}

// ---- orders and cadence ----
{const st = {fellowship: {name: 'F', members: []}, ok: true, day: 2, time: '10:00', part: 'morning', gameMin: 3480, your_lines_today: {narrate: '3/12', npc_say: '0/16'}, speak_to: {near: 'Gormar', where: 'Wendmouth', people: [{id: 7, name: 'Old Ansk', role: 'hermit'}]}};
  const sys = D.dmSystemPrompt(st), t = D.dmTurnPrompt(4, st);
  ok(/Speak every turn/.test(sys) && !/preparation between scenes, not running/.test(sys) && !/Speak sparingly/.test(sys) && !/one act or nothing/.test(sys), 'the standing orders make speaking the default act');
  ok(/End this turn with something they can hear: narrate \{near: "Gormar"/.test(t) && /Old Ansk \(npc 7\)/.test(t) && /Wendmouth/.test(t), 'every turn prompt ends in the line to speak, who it reaches and who may say it', t);
  ok(/npc_say/.test(D.dmTurnPrompt(4, {...st, your_lines_today: {narrate: '12/12'}})), 'with the day\'s narration spent the prompt turns to a person near them');
  const old = 'Your job in this seat is preparation between scenes, not running them: read what happened.\n- You speak. Speak sparingly: a few lines a day, about what can be seen and heard, never what a hero thinks or must do.\n- While a scene you staged is at the table, a fast voice of yours answers.\n- If dm_status shows a Table scene or an open vote, read only and end the turn.\nA quiet turn is: hear, then one act or nothing.\nEach turn: dm_status (read fellowship_needs first), hear.';
  const n = D.withDmStageOrders(old);
  ok(/Speak every turn/.test(n) && !/sparingly|not running them|one act or nothing|read only and end/.test(n) && D.withDmStageOrders(n) === n, 'a resumed session has its old orders replaced, not merely added to');
  ok(D.eventDue({ok: true, day: 3, gameMin: 4000, fellowship_change: 'b'}, {sig: 'a', gm: 3000}, {day: 3, n: 3}), 'a fourth event turn is due: the DM is not gone by mid-morning');
  ok(/regions and survey/.test(D.prepPrompt({prep: {kind: 'opening'}, fellowship_needs: null})), 'the first prep reads the map before it posts')}

// ---- the narrator's voice ----
const say = [], narrAdapter = {call: async ({user}) => {say.push(user); return {text: JSON.stringify({text: /Tess said aloud/.test(user) ? '' : 'Mist lifts off the water ' + say.length + '.'}), usage: {in: 500, out: 30, cost: 0}}}};
const nl = [], nv = D.narratorVoice({base: '', adapter: narrAdapter, model: 'mock', log: s => nl.push(s), pollIdle: 2, waitMs: 0, tool});
const lead = () => {const p = S.parties.find(x => x.company === F0.id); return p && p.leader || heroes()[0]};
const tick = async (min = 3) => {S.gameMin += min; N.narrTick(); await nap(25)};
const fresh = () => {if (S.narrVoice) {S.narrVoice.day = {d: -1, n: 0, by: {}}; for (const k in S.narrVoice.co) S.narrVoice.co[k].last = -1e9} if (S.dmAgent) S.dmAgent.day = {...S.dmAgent.day, narr: 0}};
await nap(20);
for (const a of heroes()) {a.state = 'hunt'; a.hidden = false}
const goTo = (town, z) => {const a = lead(); for (const b of heroes()) if (town) {b.state = 'town'; b.town = town.name; b.x = town.gate.x; b.y = town.gate.y} else {b.state = 'hunt'; b.town = null}};
S.gameMin = Math.floor(S.gameMin / 1440) * 1440 + 12 * 60; await tick();
ok(S.narrVoice && Object.keys(S.narrVoice.co).length > 0 && S.narrVoice.cur.length === 0, 'the voice starts from what is true now: no arrival for where they already stand', S.narrVoice);
fresh(); goTo(CITY[0]); await tick(); await nap(30);
ok(nl.some(l => /^\[narrator\] town: "Mist/.test(l)), 'walking into a town is a line', nl);
const heard = heroes().filter(a => (a.chat || []).some(e => /^Mist lifts/.test(e.text) && e.from && e.from.kind === 'dm'));
ok(heard.length === heroes().length, 'the company hears it as the narrator', heard.length);
{const e = heroes()[0].chat.find(x => /^Mist lifts/.test(x.text)); ok(e.quiet && hearWake(heroes()[0], e) === 0, 'a voice line is news for the next turn, never a turn of its own (a hero turn costs more than the line)');
  ok(hearWake(heroes()[0], {from: {kind: 'dm'}}) === 1, 'the DM\'s own narrate still wakes after the gap')}
ok(S.dmAgent.day.narr === 1 && S.dmLog.some(e => e.detail && e.detail.moment === 'town' && e.detail.by === 'dm-agent'), 'it counts against narrate\'s daily cap and is in the DM log', S.dmAgent.day);
ok(/walk into/.test(say[0]) && new RegExp(CITY[0].name).test(say[0]), 'its prompt carries the moment and the place', say[0]);
await tick(5); ok(say.length === 1, 'no second line inside the gap');
// a line among the company is answered by silence; said to the world it is answered; a shout is never a moment
goTo(null); fresh(); const a0 = lead(); a0.x = CITY[0].gate.x + 30; await tick(); const n0 = S.narrVoice.stats.spoke;
{const T2 = await import('../src/sim/talk.js'); a0.name0 = a0.name; const was = a0.name; a0.name = 'Tess'; a0.chat = a0.chat || []; a0.chat.push({text: 'x', party: true}); T2.noteSaid(a0, 'Shouted to the company', []); ok(!S.narrVoice.cur.some(m => m.kind === 'spoke'), 'a party shout is not a moment');
  a0.chat.pop(); S.narrVoice.co[F0.id].last = -1e9; T2.noteSaid(a0, 'Keep the line, lads', []); await nap(40); a0.name = was; delete a0.name0;
  ok(S.narrVoice.stats.silent >= 1 && S.narrVoice.stats.spoke === n0, 'a line not meant for the world may be answered with silence, and costs nothing of the day\'s lines', S.narrVoice.stats)}
// the cap: the voice leaves the DM's own lines room, and a line that speaks for a member is cut
{fresh(); const N2 = S.narrVoice; N2.day = {d: Math.floor(S.gameMin / 1440), n: N.NAR.PER_DAY, by: {}}; goTo(CITY[1] || CITY[0]); S.narrVoice.co[F0.id].town = null; const n1 = say.length; await tick();
  ok(say.length === n1 && N.NAR.PER_DAY < DMA.NARRATE_PER_DAY, 'past its share the voice is quiet; the rest of the day\'s lines stay for the DM\'s turns and whens')}
{fresh(); const name = heroes()[0].name; const r = N.narrSay({call: 1}, () => ({ok: true})); ok(r.ok === false, 'a line for no moment is refused');
  S.narrVoice.cur.push({id: 9001, kind: 'dawn', cid: F0.id, what: 'x', real: Date.now(), ms: 8000, gm: 0});
  const q = dmAct('narrator_say', {call: 9001, text: `The rain eases. ${name} says, "Move out, all of you."`});
  ok(q.ok && q.spoke_for && q.spoke_for.includes(name) && !/Move out/.test(q.said), 'the voice never speaks for a member: its line goes through the #750 cut', q)}
{fresh(); S.narrVoice.co[F0.id].town = null; goTo(CITY[0]); const sc = T.openScene('check', 'At the table', ['A roll.'], {anchor: heroes()[0].id}, F0), n2 = S.narrVoice.stats.asked; await tick();
  ok(S.narrVoice.stats.asked === n2, 'no moment at an open table: it has its own voice'); for (let i = 0; i < 600 && sceneFor(F0); i++) {step(1 / 60); pin()}}
{fresh(); const m = {id: 9002, kind: 'dawn', cid: F0.id, what: 'x', real: Date.now() - N.NAR.PICKUP_MS - 1000, ms: 8000, gm: 0}; const l0 = S.narrVoice.stats.late, h0 = S.dmAgent.day.narr; S.narrVoice.cur = [m]; N.narrTick(); ok(S.narrVoice.stats.late === l0 + 1 && !S.narrVoice.cur.includes(m) && S.dmAgent.day.narr === h0, 'a late moment is dropped, never filled', S.narrVoice.stats)}
await nv.stop();
ok(JSON.stringify(S.narrVoice).length < 8000, 'the voice\'s state stays small and is plain data');

// ---- names ----
{S.levers = S.levers || {}; if (S.levers.day) S.levers.day = {d: -1, n: {}, rz: {}, nf: {}}; if (S.dmAgent) S.dmAgent.day.pulls = 0;
  const town = CITY[0].name;
  let r = dmAct('post_hook', {town, tpl: 'investigate', place: 'the Cold Forge', reason: 'r'});
  ok(r.ok === false && /Real names near the companies: /.test(r.error) && /mark_place \{kind, near, name: "the Cold Forge"/.test(r.error), 'a place not on the map is refused with real names and the way to put it there', r.error);
  r = dmAct('seed_rumour', {town, text: 'They say the hollow road is watched.', about: 'Nowhere Hall', reason: 'r'});
  ok(r.ok === false && /Real names near the companies: /.test(r.error), 'seed_rumour: the same', r.error);
  const E = (await import('../src/data/mobs.js')).ELITES[0]; for (const m of S.mobs) if (m.elite && m.name === E.name) m.gone = true;
  r = dmAct('seed_rumour', {town, text: 'They say the old wolf walks again.', about: E.name, reason: 'r'});
  ok(r.ok, 'a named foe of the world is a legal about even out of sight (Greymane was refused live)', r);
  r = dmAct('mark_place', {kind: 'ruin', near: 'fellowship', name: 'The Drowned Post', reason: 'r'}); ok(r.ok, 'mark_place', r);
  const nm = 'drowned post';
  r = dmAct('post_hook', {town, tpl: 'investigate', place: nm, reason: 'r'}); ok(r.ok, 'post_hook takes the marked name, with or without "the"', r);
  r = dmAct('narrate', {near: nm, text: 'A bell tolls from the water.'}); ok(r.ok, 'narrate takes it', r);
  r = dmAct('narrate', {near: LANDMARKS[0].name, text: 'A bell tolls.'}); ok(r.ok, 'narrate takes a landmark', r);
  r = dmAct('seed_rumour', {town, text: 'They say the post was not always drowned.', about: nm, reason: 'r'}); ok(r.ok, 'seed_rumour takes it', r);
  r = dmAct('when', {trigger: 'near_place', on: {place: nm}, action: 'narrate', args: {text: 'x', near: '{who}'}, reason: 'r'}); ok(r.ok, 'when takes it', r);
  r = dmAct('narrate', {near: 'the Glass Hollow', text: 'x'}); ok(r.ok === false && /Real names/.test(r.error), 'narrate at a place that is not there names real ones', r.error);
  {const L = heroes(); for (const b of L) b.hidden = true; const s0 = dmAct('dm_status', {}); ok(!s0.speak_to, 'below ground nobody is named as the line\'s target: narrate near a hidden hero would be refused'); for (const b of L) b.hidden = false}
  const st = dmAct('dm_status', {}); ok(st.map_names && st.map_names.near_the_companies.length > 3 && st.map_names.near_the_companies.includes('The Drowned Post') && st.speak_to && st.speak_to.near, 'dm_status names what is on the map and who a line reaches', {m: st.map_names, s: st.speak_to})}

console.log(fails ? `STAGE FAIL ${fails}` : 'STAGE OK');
process.exit(fails ? 1 : 0);
