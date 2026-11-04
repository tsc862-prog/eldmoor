// The companion voice (#764): a scripted hero riding with an agent company is voiced by the DM, remembers what it said to each
// listener, never repeats a table row to the same listener in its fill, answers when addressed, keeps to COMP.PER_DAY, the
// #750 quote guard cuts words put in an agent's mouth, hero tools never say it is scripted or DM-voiced, a background
// company keeps the fixed table, and the runner's companion voice answers a call end to end. No model, no network.
// Usage: node scripts/compvoicecheck.mjs
let seed = 0x07640764;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
let clock = 1.9e12; const realNow = Date.now; Date.now = () => clock; // the voice waits in real ms: a fake clock

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp, snapshot, restore, dmAct, setDmSeat} = SIM;
const P = await import('../src/sim/player.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {homeOf} = await import('../src/data/races.js');
const {companyOf, members} = await import('../src/sim/company.js');
const {pull} = await import('../src/sim/levers.js');
const CV = await import('../src/sim/compvoice.js');
const CAMPD = await import('../src/data/camp.js');
const CM = await import('../src/sim/camp.js');
const DA = await import('./dm-agent.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => {a.playRate = []; return P.playerAct(a.id, tool, args || {})};
const park = (x, p, st) => {x.x = p.x; x.y = p.y; x.state = st; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []; x.cmd = null};
const live = () => S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');
let keep = null; const nextDay = () => {S.gameMin = (Math.floor(S.gameMin / 1440) + 1) * 1440 + 600; if (keep && keep.hire) keep.hire.until = S.gameMin + 3 * 1440}; // the hire's paid days never run out here
const quiet = () => {clock += 60000}; // the voice has not polled for a minute: nobody listening
const lastFrom = (a, b) => (a.chat || []).filter(e => e.from === b).slice(-1)[0] || null;

console.log('\nEldmoor compvoicecheck: scripted companions voiced by the DM (#764)\n');
init({fellowship: false}); run(10);
const A = live().find(a => a.fac === 0), town = homeOf(A);
P.markPlayer(A, true);
S.gameMin += 100;
const sword = pull('create_npc', {role: 'sellsword', home: 'town', town: town.name, spot: 'gate', attitude: 'neutral', hours: 168}, {by: 'dm-agent', reason: 'compvoicecheck'}).ret;
park(A, {x: sword.x + 1, y: sword.y}, 'town'); rebuild(); A.gold = 200;
let r = act(A, 'hire', {npc: sword.name, days: 5});
const H = S.agents.find(x => x.hire && x.hire.npc === sword.id), C = companyOf(A);
keep = H;
ok(r.ok && H && companyOf(H) === C, 'a hire rides with the agent: ' + (H && H.name));
ok(CV.voiced(H) && !CV.voiced(A), 'the hire is voiced, the agent never is');
const bg = live().find(b => !b.player && b !== H && b.company != null && !members(companyOf(b)).some(x => x.player));
ok(!bg || !CV.voiced(bg), 'a hero of a company with no agent keeps the fixed table' + (bg ? ' (' + bg.name + ')' : ''));
ok(CV.compLine(bg || A, {to: [A], trigger: 'camp', topic: 'story'}) === null, 'compLine leaves a background or agent speaker to its caller');
ok(!(A.events || []).some(e => /scripted/i.test(String(e.text || ''))), 'the hire news does not say "scripted"');
const sh = (H.x = A.x + 1, H.y = A.y, rebuild());

console.log('fill (no DM listening): no row twice to the same listener, needs, the cap');
const rowsSeen = [], keys = new Set(), all = Object.entries(CAMPD.CAMP_LINES).reduce((n, [, L]) => n + L.length, 0);
const needy = Object.keys(CAMPD.CAMP_NEEDS).length;
let dup = false, needHit = false;
for (let i = 0; i < all - needy; i++) {
  if (i % CV.COMP.PER_DAY === 0) nextDay();
  quiet(); const v = CV.compLine(H, {to: [A], trigger: 'camp', topic: CAMPD.TOPICS[i % CAMPD.TOPICS.length]});
  const e = S.dmLog.find(x => x.kind === 'companion'), row = e && e.detail.row;
  if (keys.has(row)) dup = true; keys.add(row); rowsSeen.push(row); if (CAMPD.CAMP_NEEDS[row]) needHit = true;
  if (i === 0) ok(v && v.said === 'scripted' && e.detail.fill && e.detail.why === 'gone' && e.detail.by === 'scripted', 'a fill is logged as the DM reflex (kind companion, fill, why gone)');
}
ok(!dup, `${all - needy} camp lines to one listener, every row different`);
ok(!needHit, 'rows that need a fight or an earlier camp are left out on a quiet day');
ok((H.cvoice[A.id].said || []).length === CV.COMP.KEEP, 'the companion remembers the last ' + CV.COMP.KEEP + ' lines said to this listener');
nextDay(); quiet(); const first = CV.compLine(H, {to: [A], trigger: 'camp', topic: 'quarrel'});
ok(first && first.said === 'scripted', 'after every row was heard the table starts over for that listener');
for (let i = 1; i < CV.COMP.PER_DAY; i++) CV.compLine(H, {to: [A], trigger: 'camp', topic: 'hope'});
ok(CV.compLine(H, {to: [A], trigger: 'camp', topic: 'hope'}).said === 'silent', 'past COMP.PER_DAY (' + CV.COMP.PER_DAY + ') the companion keeps quiet');
const B2 = live().find(b => b !== A && b !== H && b.fac === A.fac && !b.player);

console.log('the DM voice: companion_call carries the card, the day, the heard lines and the memory; companion_say speaks');
setDmSeat(true); nextDay();
let c = dmAct('companion_call', {budget_s: 8}); ok(c.ok && c.call === null, 'an idle poll: no call');
const v1 = CV.compLine(H, {to: [A], trigger: 'camp', topic: 'story'});
ok(v1.said === 'dm', 'with the voice polling the line waits for the DM');
c = dmAct('companion_call', {budget_s: 8});
const call = c.call;
ok(call && call.companion && call.companion.name === H.name && call.companion.cls === H.cls && /hired/.test(call.companion.rides), 'the card names the companion, its class and how it rides');
ok(call && Array.isArray(call.today) && Array.isArray(call.heard) && call.heard.length > 0, 'the call carries today and the last lines heard (' + (call && call.heard.length) + ')');
ok(call && call.listeners[0].name === A.name && call.listeners[0].you_said_to_them.length === 8, 'the call carries what it already said to ' + A.name);
ok(call && call.seconds_left > 0 && call.seconds_left <= 8, 'with seconds left from pickup');
const said0 = call.listeners[0].you_said_to_them[0].replace(/^D\d+ /, '');
r = dmAct('companion_say', {call: call.call, text: said0});
ok(!r.ok && /already said that/.test(r.error), 'a line it already said to that listener is refused: ' + r.error);
const n0 = (A.chat || []).length;
r = dmAct('companion_say', {call: call.call, text: 'Hold still, the kettle is nearly singing. My knee says rain before dawn.'});
const e1 = lastFrom(A, H);
ok(r.ok && e1 && /kettle/.test(e1.text), 'companion_say: the agent hears the companion');
ok(e1 && e1.comp && e1.dm && e1.by === 'dm-agent', 'the chat entry is tagged for the watcher (comp, dm, by)');
ok(S.dmLog[0].kind === 'companion' && S.dmLog[0].detail.by === 'dm-agent', 'the DM log carries it as kind companion');
r = dmAct('companion_say', {call: call.call, text: 'Again?'}); ok(!r.ok, 'an answered call cannot be answered twice');
ok(dmAct('dm_status').companions && /\/36$/.test(dmAct('dm_status').companions.today), 'dm_status shows companions: ' + JSON.stringify(dmAct('dm_status').companions && dmAct('dm_status').companions.today));

console.log('the quote guard (#750)');
CV.compLine(H, {to: [A], trigger: 'camp', topic: 'worry'}); c = dmAct('companion_call', {});
r = dmAct('companion_say', {call: c.call.call, text: `The fire spits. ${A.name} says: "We ride north at dawn." I do not like the north.`});
const e2 = lastFrom(A, H);
ok(r.ok && r.spoke_for && r.spoke_for.includes(A.name) && e2 && !/ride north at dawn/.test(e2.text) && /do not like the north/.test(e2.text), 'a quote put in the agent\'s mouth is cut, the rest is said');
CV.compLine(H, {to: [A], trigger: 'camp', topic: 'worry'}); c = dmAct('companion_call', {});
r = dmAct('companion_say', {call: c.call.call, text: `${A.name} says: "Follow me."`});
ok(!r.ok && /spoke for/.test(r.error), 'a line that was only a quote for the agent is refused');
clock += 30000; run(.1); ok(!S.compVoice.cur.length && S.dmLog.find(x => x.kind === 'companion').detail.why === 'slow', 'a call the DM let lapse is filled by the reflex (why slow)');

console.log('a reply when addressed');
nextDay(); quiet();
const first0 = H.name.split(' ')[0];
let m = lastFrom(A, H);
r = act(A, 'say', {text: `${first0}, what do you make of the road ahead?`});
let rep = lastFrom(A, H);
ok(r.ok && rep && rep !== m, 'a line that names the companion gets an answer (' + (rep && rep.text) + ')');
ok(S.dmLog.find(x => x.kind === 'companion').detail.trigger === 'reply', 'logged as a reply');
ok(!JSON.stringify(S.dmLog.find(x => x.kind === 'companion').summary).includes('road ahead'), 'the DM log never carries the hero\'s words');
m = lastFrom(A, H); H.x = A.x + 2; H.y = A.y; rebuild();
for (const b of live()) if (b !== A && b !== H && Math.hypot(b.x - A.x, b.y - A.y) <= 4) {b.x += 20}
rebuild(); r = act(A, 'say', {text: 'The wind has turned cold again tonight.'});
rep = lastFrom(A, H); ok(rep && rep !== m, 'any line within 4 tiles with only the two there gets an answer');
if (B2) {park(B2, {x: A.x - 1, y: A.y}, 'town'); B2.hp = maxHp(B2); rebuild(); m = lastFrom(A, H);
  r = act(A, 'say', {text: 'Someone ought to check the water skins soon.'});
  rep = lastFrom(A, H); ok(rep === m, 'with another hero near, an unnamed line is not taken as said to the companion'); B2.x += 30; rebuild()}
setDmSeat(true); dmAct('companion_call', {budget_s: 8});
r = act(A, 'say', {text: `${first0}, keep an eye on the treeline.`});
c = dmAct('companion_call', {});
ok(c.call && c.call.trigger === 'reply' && c.call.their_words && /treeline/.test(c.call.their_words.text) && c.call.their_words.from === A.name, 'with the voice polling, the reply call carries the hero\'s words');
dmAct('companion_say', {call: c.call.call, text: 'Already watching it. Something moved there an hour ago.'});
quiet();
r = act(A, 'talk', {target: H.name, text: 'Are you ready to ride?'});
ok(r.ok && typeof r.answer === 'string' && r.answer.length > 3 && r.who === H.name, 'talk to the companion: it answers (' + r.answer + ')');
for (let i = 0; i < 6; i++) act(A, 'talk', {target: H.name, text: 'And now, friend number ' + i + '?'});
r = act(A, 'talk', {target: H.name, text: 'Still there?'});
ok(r.ok && /said enough for one day/.test(r.answer), 'replies count toward the day\'s lines');

console.log('privacy: hero tools never say the companion is scripted or voiced by the DM');
const outs = ['chat_read', 'party_read', 'status', 'look', 'companions', 'inventory'].map(t => JSON.stringify(act(A, t, {})));
const bad = /scripted|DM voice|dm-agent|companion_call|companion_say|DM agent|by the DM/i;
ok(outs.every(s => !bad.test(s)), 'chat_read, party_read, status, look, companions and inventory carry no such word');
ok(!bad.test(JSON.stringify(P.playerAct(A.id, 'chat_read', {n: 20}))), 'the companion\'s lines read as its own');

console.log('camp: the fire talk of a voiced companion goes through the voice');
nextDay(); quiet(); S.compVoice.day.n = {}; // a fresh budget for the fire
const field = {x: town.gate.x + 14, y: town.gate.y + 3};
park(A, field, 'hunt'); park(H, {x: field.x + 1, y: field.y}, 'hunt'); rebuild();
const camp0 = S.gameMin;
const why = CM.leaderRest(A, 4);
ok(why === null && CM.campOf(A), 'the agent makes camp with its hire' + (why ? ': ' + why : ''));
for (let i = 0; i < 120 && CM.campOf(A); i++) {quiet(); run(.5)}
const campLines = (S.dmLog || []).filter(x => x.kind === 'companion' && x.detail.trigger === 'camp' && x.gameMin >= camp0);
ok(campLines.length > 0, 'the hire spoke at the fire through the voice (' + campLines.length + ')');
ok(!(A.chat || []).some(e => e.from === H && e.trigger === 'party' && !e.comp), 'no fixed-table line from the hire reached the agent');

console.log('save and restore');
const snap = JSON.stringify(snapshot()); restore(JSON.parse(snap));
const H2 = S.agents.find(x => x.id === H.id);
ok(H2 && H2.cvoice && H2.cvoice[A.id] && H2.cvoice[A.id].said.length > 0 && S.compVoice && S.compVoice.day, 'the memory and the day\'s count survive a save');

console.log('the runner\'s companion voice');
{let posted = null, polls = 0;
  const callV = {call: 7, seconds_left: 6, trigger: 'camp', topic: 'song', where: 'Thornvale', time: '22:10',
    companion: {name: 'Bram Holt', cls: 'Warrior', level: 4, home: 'Highgate', traits: ['brave'], rides: 'hired: a sellsword (2 paid days left)', company: 'The Ninth Road'},
    listeners: [{name: 'Wrackish', cls: 'Rogue', level: 4, you_said_to_them: ['D2 Keep your boots out of my side of the fire.']}], today: ['14:02 The Ninth Road slew a boar.'], heard: ['21:50 Wrackish: Quiet night.']};
  const tool = async (base, t, args) => {if (t === 'companion_call') {polls++; return polls === 1 ? {ok: true, call: callV} : {ok: true, call: null}} if (t === 'companion_say') {posted = args; return {ok: true, said: args.text}} return {ok: false}};
  let seenUser = '';
  const adapter = {call: async o => {seenUser = o.user; return {text: JSON.stringify({text: 'The river sings tonight, and so shall I.'}), usage: {in: 10, out: 5, cost: 0}}}};
  const lines = []; Date.now = realNow;
  const v = DA.companionVoice({base: 'x', adapter, model: 'mock', log: l => lines.push(l), tool, pollIdle: 5, waitMs: 0});
  for (let i = 0; i < 50 && !posted; i++) await new Promise(res => setTimeout(res, 10));
  await v.stop();
  ok(posted && posted.call === 7 && /river sings/.test(posted.text), 'the voice answers the call with companion_say');
  ok(/Bram Holt/.test(seenUser) && /Keep your boots/.test(seenUser) && /slew a boar/.test(seenUser) && /Wrackish/.test(seenUser), 'the prompt carries the card, the memory, the day and the listener');
  ok(lines.some(l => /^\[companion\] Bram Holt/.test(l)), 'a [companion] line per call');}

console.log(fail ? `\n${fail} FAILED\n` : '\nall ok\n');
process.exit(fail ? 1 : 0);
