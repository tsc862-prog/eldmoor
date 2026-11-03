// seed_rumour (#637) and bestow (#638): the DM's word in town while it sleeps, and a name for a hero after a deed.
//   rumours  refusals (town or region, length, English, about, who, days), the townsfolk telling it in their own words through a
//            company member's conversation (scripted and the DM's voice), another agent hero's talk and the gate board (list_jobs),
//            once a game day per hero, the lore hook (heard of, with the speaker as source; move_to takes the place), the caps
//            (6 live, 3 a town), the companies' reserved share, lapses (days, a dead foe), hooks lists them, DM log counts tellings
//            without quoting them, save/restore
//   bestow   refusals (dead, English, number, level word, length, proclaimer too far, again within 3 days, 2 a day), the
//            proclaimer heard aloud, the name in look, inspect, status, self, the chronicle, the timeline, a landmark, a reflection
//            moment, the DM's member views, a replacement keeping the old one, the hero refusing it aloud, save/restore
// No model, no network. Usage: npm run rumourcheck.
let seed = 0x5eed7637;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp} = SIM;
const SLT = await import('../src/sim/company.js');
const P = await import('../src/sim/player.js');
const DMA = await import('../src/sim/dmagent.js');
const DR = await import('../src/sim/dmreflex.js');
const T = await import('../src/sim/table.js');
const SV = await import('../src/sim/save.js');
const RU = await import('../src/sim/rumours.js');
const EP = await import('../src/sim/epithet.js');
const {ensureNpcs} = await import('../src/sim/npcs.js');
const {homeOf} = await import('../src/data/races.js');
const {ZONES, CITY, zoneAt, dist} = await import('../src/world/map.js');
const {MOBS} = await import('../src/data/mobs.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});
const dm = (tool, args) => {const r = DMA.dmAct(tool, args || {}); DR.gone(); return r}; // a DM call, then nobody listening: townsfolk answer at once
const fresh = () => {S.levers.day.n = {}; S.levers.day.nf = {}; S.levers.day.rz = {}; DMA.dmState().day.pulls = 0};
const full = p => (p.title ? p.title + ' ' : '') + p.name;
const say = a => (a.chat || []).map(e => e.text).join(' | ');

init({fellowship: false});
for (let i = 0; i < 600; i++) step(1 / 60);
for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
const r0 = SLT.foundSlots(SLT.autoPick(0), {fac: 0, ai: false});
ok(r0.ok, 'founded ' + (SLT.slotted() && SLT.slotted().name));
SLT.setSlotMinds(SLT.slotted(), 'agent');
const M = SLT.slotMembers(SLT.slotted()).map(m => m.hero), [A, B] = M;
T.TABLE.mode = 'off';
DMA.setDmSeat(true); ensureNpcs();
const home = homeOf(A), town = home.name, other = CITY.find(c => c.fac !== A.fac);
const folk = role => S.npcs.find(p => p.town === town && p.role === role);
const inn = folk('innkeeper'), bard = folk('bard'), cap = folk('captain');
ok(inn && bard && cap, `${town} has an innkeeper (${inn && full(inn)}), a bard and a gate captain`);
const putAt = (a, p) => {a.x = p.x + .5; a.y = p.y; a.state = 'town'; a.town = town; a.pq = []; a.hp = maxHp(a); a.target = null; a.dest = null; a.playRate = []};
for (const m of M) putAt(m, {x: home.gate.x, y: home.gate.y});
const H0 = JSON.stringify(S.rumours || null);
ok(!S.rumours, 'no rumour state before the first seeding');

// ---------------------------------------------------------------- seed_rumour: refusals
console.log('\nseed_rumour: refusals');
const rej = (args, re, m) => {const r = dm('seed_rumour', {reason: 'check', ...args}); ok(!r.ok && re.test(r.error), m + ': ' + (r.error || 'ok').slice(0, 110))};
rej({text: 'A drover swears he saw lights on the ridge.'}, /town or region/, 'neither town nor region');
rej({town, region: ZONES[1], text: 'A drover swears he saw lights on the ridge.'}, /town or region/, 'both town and region');
rej({town, text: 'x'.repeat(161)}, /160 at most/, 'over 160 characters');
rej({town, text: 'Говорят, что на хребте видели огни этой ночью.'}, /English/, 'not English');
rej({town, text: 'A drover swears he saw lights on the ridge.', about: 'Nowhere-at-all'}, /about: no place/, 'an about nobody knows');
rej({town, text: 'A drover swears he saw lights on the ridge.', who: 'smith'}, /who/, 'a teller who is not innkeeper, captain or bard');
rej({town, text: 'A drover swears he saw lights on the ridge.', days: 9}, /days/, 'days above 5');
rej({town: 'Nowhereton', text: 'A drover swears he saw lights on the ridge.'}, /no town or region/, 'an unknown town');
ok(!S.rumours || !S.rumours.list.length, 'nothing seeded by a refusal');

// ---------------------------------------------------------------- telling through a member's conversation (scripted)
console.log('\ntelling: a member talks to the innkeeper');
const L = A.lore || (P.playerAct(A.id, 'lore', {}), A.lore);
const zFar = ZONES.findIndex((n, z) => z > 0 && !(A.lore && A.lore.p[n]));
ok(zFar > 0, 'a region ' + A.name + ' has never heard of: ' + ZONES[zFar]);
fresh();
let r = dm('seed_rumour', {town, text: 'They say the ' + ZONES[zFar] + ' roads are quiet this week, and the old shrine there lit again.', about: ZONES[zFar], days: 2, reason: 'a lead for the company'});
ok(r.ok && r.rumour === 1 && r.towns[0] === town && r.tellers.length >= 3, 'seeded: rumour ' + r.rumour + ' in ' + (r.towns || []).join(', ') + ', told by ' + (r.tellers || []).join(', '));
ok(S.dmLog.some(e => e.kind === 'lever' && e.detail && e.detail.lever === 'seed_rumour' && e.detail.result === 'applied'), 'the seeding is in the DM log');
{const h = dm('hooks', {town}); ok(h.rumours && h.rumours.length === 1 && h.rumours[0].about.startsWith(ZONES[zFar]) && h.rumours[0].hours_left === 48, 'hooks lists it as rumours: ' + JSON.stringify(h.rumours))}
putAt(A, inn);
r = act(A, 'talk', {target: inn.name, text: 'Good evening. Any news?'});
const told1 = S.rumours.list[0].told;
ok(r.ok && /lit again/.test(say(A)), 'the innkeeper passes it on in the chat: ' + ((A.chat || []).filter(e => /lit again/.test(e.text)).map(e => e.text)[0] || '(none)'));
ok(/taps|barrel|table in the house/.test(say(A)), 'in the innkeeper\'s own words');
ok(told1 === 1, 'told once (told ' + told1 + ')');
ok(A.lore.p[ZONES[zFar]] && A.lore.p[ZONES[zFar]].how === 'told' && A.lore.p[ZONES[zFar]].from === full(inn), 'the lore hook: ' + ZONES[zFar] + ' heard of, from ' + (A.lore.p[ZONES[zFar]] || {}).from);
{const lv = act(A, 'lore', {about: ZONES[zFar]}); ok(JSON.stringify(lv).includes('heard of it from ' + full(inn)), 'lore names the speaker as the source')}
{const tl = S.dmLog.filter(e => e.detail && e.detail.rumour === 1 && e.detail.told); ok(tl.length === 1 && !JSON.stringify(tl[0].summary).includes('lit again') && !('text' in tl[0].detail), 'the DM log counts the telling, never quotes it')}
ok(!/DM|dungeon master|seeded/i.test(say(A).replace(/[A-Z][a-z]+ DM/g, '')), 'no word of who started it in what the hero heard');
{const mv = act(A, 'move_to', {target: ZONES[zFar], force: 'yes'}); ok(mv.ok, 'move_to takes the region now: ' + (mv.going || mv.error))}
putAt(A, inn);
act(A, 'talk', {target: inn.name, text: 'Anything else going on?'});
ok(S.rumours.list[0].told === 1, 'the same hero hears it once a game day');

// ---------------------------------------------------------------- the gate board (list_jobs), next day
console.log('\nthe gate board');
let lj = act(A, 'list_jobs');
ok(!lj.word_at_the_gate, 'not again at the gate the same day');
S.gameMin += 1440; putAt(A, {x: home.gate.x, y: home.gate.y});
lj = act(A, 'list_jobs');
ok(lj.ok && (lj.word_at_the_gate || []).length === 1 && lj.word_at_the_gate[0].startsWith(full(cap)) && /lit again/.test(lj.word_at_the_gate[0]), 'the next day the captain gives it at the board: ' + (lj.word_at_the_gate || [])[0]);
ok(!act(A, 'list_jobs').word_at_the_gate, 'and only once that day');

// ---------------------------------------------------------------- the DM's voice weaves it in
console.log('\nthe DM\'s voice');
fresh();
let elite = S.mobs.find(m => m.alive && !m.gone && m.elite && m.name);
if (!elite) {elite = S.mobs.find(m => m.alive && !m.gone && m.kind === 'mob'); elite.elite = true; elite.name = 'Grimtooth'; elite.title = 'the Old'} // a named foe for the check
const kind = Object.keys(MOBS)[2], kindName = MOBS[kind].name;
r = dm('seed_rumour', {town, text: 'The bard sings of the ' + MOBS[kind].pl + ' stalking the far roads again.', about: kindName, who: 'bard', days: 1, reason: 'a warning'});
ok(r.ok, 'a bard-only rumour about ' + kindName + (r.ok ? '' : ': ' + r.error));
S.rumours.list[0].heard[B.id] = S.rumours.list[0].heard[A.id]; // B heard the first one already today
putAt(B, bard); DMA.dmAct('npc_call', {}); // the voice is polling
r = act(B, 'talk', {target: bard.name, text: 'What are they singing about?'});
ok(r.ok && r.waiting, 'the conversation waits for the DM\'s voice');
{const c = DMA.dmAct('npc_call', {}); const call = c.call;
  ok(call && (call.word_to_pass_on || []).length === 1 && /stalking/.test(call.word_to_pass_on[0]), 'npc_call carries the word to pass on: ' + JSON.stringify(call && call.word_to_pass_on));
  const before = (B.chat || []).length;
  const ans = DMA.dmAct('npc_say', {npc: String(bard.id), conv: call.conv, text: 'Oh, the song of the ' + MOBS[kind].pl + '. Keep to the lit roads, friend.'});
  ok(ans.ok, 'the DM answers as the bard');
  const after = (B.chat || []).slice(before);
  ok(after.length === 1 && S.rumours.list.find(x => x.who === 'bard').told === 1, 'woven into the answer: counted as told, no second line (' + after.length + ' line)');
  ok(B.lore && B.lore.c[kind] && B.lore.c[kind].from === full(bard), 'the creature goes on the lore, heard of from ' + full(bard))}
DR.gone();
// the innkeeper never tells a bard-only rumour
{const n0 = S.rumours.list.find(x => x.who === 'bard').told; putAt(M[2], inn); act(M[2], 'talk', {target: inn.name, text: 'Evening.'});
  ok(S.rumours.list.find(x => x.who === 'bard').told === n0 && /lit again/.test(say(M[2])), 'who narrows the tellers: the innkeeper passes on only the first')}

// ---------------------------------------------------------------- an agent hero outside a company
console.log('\nan agent hero who is not in a company');
{const C = S.agents.find(a => a.kind === 'hero' && a.state !== 'dead' && a.fac === A.fac && !SLT.inSlots(a));
  C.player = true; C.x = inn.x + .5; C.y = inn.y; C.state = 'town'; C.town = town; C.pq = []; C.playRate = [];
  const t = act(C, 'talk', {target: inn.name});
  ok(t.ok && /lit again/.test(t.answer), C.name + ' hears it in the answer: ' + (t.answer || t.error).slice(0, 140));
  ok(C.lore && C.lore.p[ZONES[zFar]] && C.lore.p[ZONES[zFar]].from === full(inn), 'and learns of ' + ZONES[zFar] + ' from ' + full(inn))}

// ---------------------------------------------------------------- caps and the reserve
console.log('\ncaps and the companies\' reserve');
S.rumours.list = []; fresh();
const T1 = n => 'Word ' + n + ': the ferry at the ford runs late again, and tolls are up.';
for (let i = 0; i < 3; i++) {r = dm('seed_rumour', {town, text: T1(i), reason: 'cap'}); ok(r.ok, 'seeded ' + (i + 1) + ' in ' + town)}
r = dm('seed_rumour', {town, text: T1(9), reason: 'cap'}); ok(!r.ok && /already carries 3/.test(r.error), 'a fourth in one town is refused: ' + r.error);
fresh();
for (let i = 0; i < 3; i++) {r = dm('seed_rumour', {town: other.name, text: T1(10 + i), reason: 'cap'}); ok(r.ok, 'seeded ' + (i + 1) + ' in ' + other.name + (r.ok ? '' : ': ' + r.error))}
const third = CITY.find(c => c.name !== town && c.name !== other.name);
if (third) {r = dm('seed_rumour', {town: third.name, text: T1(20), reason: 'cap'}); ok(!r.ok && /6 rumours already live/.test(r.error), 'a seventh is refused: ' + r.error)}
else ok(RU.liveRumours().length === 6, 'six live rumours (two towns, three each)');
S.rumours.list = []; fresh();
for (let i = 0; i < 3; i++) dm('seed_rumour', {town: other.name, text: T1(30 + i), reason: 'world'});
S.rumours.list = []; // the town cap is checked first; empty it to reach the daily share
r = dm('seed_rumour', {town: other.name, text: T1(40), reason: 'world'});
ok(!r.ok && /kept for/.test(r.error), 'the world share used up: the last seeding is kept for the companies: ' + r.error);
S.rumours.list = [];
r = dm('seed_rumour', {town, text: T1(41), reason: 'the company'}); ok(r.ok, 'a seeding in the company\'s town still goes through (the reserved share)');

// ---------------------------------------------------------------- lapses
console.log('\nlapses');
S.rumours.list = []; fresh();
if (elite && elite.alive) {r = dm('seed_rumour', {town, text: 'They say ' + elite.name + ' was seen near the bridge at dusk.', about: elite.name, reason: 'lapse'});
  ok(r.ok, 'a rumour about ' + elite.name);
  elite.alive = false;
  ok(!RU.liveRumours().some(x => x.about && x.about.name === elite.name) && S.dmLog.some(e => e.detail && e.detail.lapsed && /dead/.test(e.detail.lapsed)), 'the foe dies: it lapses (DM log: ' + (S.dmLog.find(e => e.detail && e.detail.lapsed) || {detail: {}}).detail.lapsed + ')');
  elite.alive = true}
r = dm('seed_rumour', {town, text: T1(50), days: 1, reason: 'lapse'}); ok(r.ok, 'a one-day rumour');
S.gameMin += 1441; ok(!RU.liveRumours().some(x => x.text === T1(50)), 'its day runs out: it lapses');
{const h = dm('hooks', {}); ok(Array.isArray(h.rumours) && !h.rumours.some(x => x.text === T1(50)), 'hooks no longer lists it')}

// ---------------------------------------------------------------- bestow
console.log('\nbestow');
fresh();
const bes = (args, re, m) => {const x = dm('bestow', {why: 'check', ...args}); ok(!x.ok && re.test(x.error), m + ': ' + (x.error || 'ok').slice(0, 110))};
bes({hero: A.name, title: 'W'}, /2-24/, 'too short');
bes({hero: A.name, title: 'Breaker of Bridges and Walls'}, /2-24/, 'too long');
bes({hero: A.name, title: 'the 3rd'}, /number/, 'a number');
bes({hero: A.name, title: 'the Twelfth'.replace('Twelfth', 'Third')}, /number/, 'a number word');
bes({hero: A.name, title: 'the Max Level'}, /level word/, 'a level word');
bes({hero: A.name, title: 'Убийца'}, /English/, 'not English');
const dead = S.agents.find(a => a.kind === 'hero' && a.state === 'dead');
if (dead) bes({hero: String(dead.id), title: 'the Lost'}, /no living hero|no such living/, 'a dead hero');
{const far = S.npcs.find(p => p.town === other.name); bes({hero: A.name, title: 'Wightbane', by: String(far.id)}, /within 7 tiles/, 'a proclaimer too far away')}
putAt(A, inn); putAt(B, {x: inn.x + 1, y: inn.y}); const chat0 = (B.chat || []).length;
r = dm('bestow', {hero: A.name, title: 'Wightbane', why: 'slew the wight-lord at the ford', by: inn.name});
ok(r.ok && r.known_as === A.name + ' Wightbane' && r.by === full(inn), 'bestowed: ' + r.known_as + ', proclaimed by ' + r.by);
ok((B.chat || []).slice(chat0).some(e => e.from && e.from.id === inn.id && /Wightbane/.test(e.text)), 'the proclaimer is heard aloud by those near: "' + ((B.chat || []).slice(chat0).find(e => /Wightbane/.test(e.text)) || {}).text + '"');
ok(!say(A).includes('wight-lord at the ford') && !(A.playEv || []).some(e => e.text.includes('wight-lord at the ford')), 'the why never reaches the hero');
ok(S.dmLog.some(e => e.detail && e.detail.lever === 'bestow' && e.detail.reason === 'slew the wight-lord at the ford'), 'the why is the DM log\'s reason');
{const lk = act(B, 'look'); const me = (lk.heroes || []).find(h => h.id === A.id); ok(me && me.known_as === A.name + ' Wightbane', 'look shows ' + (me && me.known_as))}
{const ins = act(B, 'inspect', {who: A.name}); ok(ins.ok && ins.known_as === A.name + ' Wightbane', 'inspect shows ' + ins.known_as)}
ok(act(A, 'status').known_as === A.name + ' Wightbane', 'status shows it to the hero');
ok(/Wightbane/.test(JSON.stringify(act(A, 'self'))), 'self names it (theirs to use in become)');
ok(S.chronicle.some(e => e.parts.some(p => p === A) && JSON.stringify(e.parts.map(p => p && p.t || (typeof p === 'string' ? p : ''))).includes('Wightbane')), 'the chronicle has the line');
ok((S.timeline || []).some(e => e.kind === 'title' && e.parts.some(p => p === A)), 'the timeline has it (kind title)');
ok(EP.styled(A) === A.name + ' Wightbane', 'every name renderer reads styled(): ' + EP.styled(A));
{const TI = await import('../src/sim/tiers.js'); ok(TI.tiersOf(A).marks.some(m => m.k === 'title' && /Named Wightbane by/.test(m.text)), 'a landmark: ' + (TI.tiersOf(A).marks.find(m => m.k === 'title') || {}).text)}
ok(A.reflect && A.reflect.cur && A.reflect.cur.why.some(w => /name given/.test(w)), 'a reflection moment: ' + (A.reflect && A.reflect.cur && A.reflect.cur.why.join('; ')));
{const fv = dm('fellowship_view'); const m = (fv.fellowship.members || []).find(x => x.id === A.id); ok(m && m.epithet && m.epithet.known_as === A.name + ' Wightbane', 'the DM\'s member view: ' + JSON.stringify(m && m.epithet))}
bes({hero: A.name, title: 'the Unbowed'}, /3 game days/, 'again within 3 game days');
r = dm('bestow', {hero: B.name, title: 'of the Ford', why: 'held the ford'}); ok(r.ok && r.by === 'the narrator', 'without by the narrator says it: ' + r.known_as);
bes({hero: M[2].name, title: 'Stormcaller'}, /per game day/, 'a third in one day');
S.gameMin += 3 * 1440 + 10; fresh();
r = dm('bestow', {hero: A.name, title: 'the Unbowed', why: 'stood alone at the gate'});
ok(r.ok && A.epithet.t === 'the Unbowed' && A.epithet.hist[0].t === 'Wightbane' && EP.styled(A) === A.name + ' the Unbowed', 'after 3 days a new one replaces it; the old stays in the record');

// the hero refuses it aloud
console.log('\nrefusing a name');
putAt(B, {x: home.gate.x, y: home.gate.y}); B.playRate = [];
let sv = act(B, 'say', {text: 'I am glad of the company tonight.'}); ok(sv.ok && !B.epithet.refused, 'an ordinary line refuses nothing');
sv = act(B, 'say', {text: 'Do not call me of the Ford. I held a crossing, nothing more.'});
ok(sv.ok && B.epithet.refused && EP.styled(B) === B.name, 'refused aloud in their own words: the name is no longer shown');
S.gameMin += 3 * 1440 + 10; fresh();
bes({hero: B.name, title: 'the Quiet'}, /refused the name/, 'bestow gives nothing further to a hero who refused');

// ---------------------------------------------------------------- save / restore
console.log('\nsave and restore');
fresh(); S.rumours.list = [];
r = dm('seed_rumour', {region: ZONES[zoneAt(home.gate.x, home.gate.y)], text: 'Wolves have been heard close to the walls at night.', reason: 'save'});
ok(r.ok && r.towns.includes(town), 'a region rumour reaches the towns bordering it: ' + (r.towns || []).join(', '));
const snap = JSON.parse(JSON.stringify(SV.snapshot()));
const before = {r: JSON.stringify(S.rumours), e: JSON.stringify(A.epithet)};
SV.restore(snap);
const A2 = S.agents.find(a => a.id === A.id);
ok(JSON.stringify(S.rumours) === before.r && JSON.stringify(A2.epithet) === before.e && EP.styled(A2) === A.name + ' the Unbowed', 'rumours and names survive a save and restore');
ok(RU.liveRumours().length === 1, 'the restored rumour is live');

// a new world starts clean
init({fellowship: false});
ok(!S.rumours && !S.agents.some(a => a.epithet), 'a new world has no rumours and no names');
ok(H0 === 'null', 'nothing was created before the first seeding');

if (fail) {console.error('\nrumourcheck: ' + fail + ' failed'); process.exit(1)} else console.log('\nrumourcheck: all checks passed');
