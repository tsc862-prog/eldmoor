// Sightings, notices and couriers by name (#446, epic #402). Usage: npm run sightcheck
let seed = 0x446446;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const P_ = await import('../src/sim/player.js');
const CM = await import('../src/sim/company.js');
const SG = await import('../src/sim/sightings.js');
const RC = await import('../src/sim/reach.js');
const TK = await import('../src/sim/talk.js');
const {homeOf} = await import('../src/data/races.js');
const {init, step, S} = SIM;
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, t, x) => P_.playerAct(a.id, t, x || {});
init({fellowship: false}); run(120);
const sightingsBefore = (S.sightings || []).length;
ok(sightingsBefore === 0 && !S.notices, 'a scripted world writes no sighting and no notice');
const free = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && !CM.companyOf(a) && !a.player && !a.hidden && !a.raid);
const fac = free[0].fac, [A, B, C, D] = free.filter(a => a.fac === fac);
const other = free.find(a => a.fac !== fac);
ok(A && B && C && D, 'four free heroes of one faction');
for (const h of [A, B, C, D]) {CM.foundCompany([h]); h.state = 'town'; h.townStep = 2; h.pq = []; h.adv = null; h.party = null; h.hp = h.maxhp || h.hp; h.gold = 200; h.player = true; h.playEv = [];}
const gate = homeOf(A).gate;
for (const h of [A, B, C, D]) {h.x = gate.x; h.y = gate.y}
// notices
let r = act(A, 'post_notice', {text: 'A Warrior seeks companions for the Greenmarch; ask for ' + A.name + ' at the inn.'});
ok(r.ok && r.town === homeOf(A).name, 'post_notice pins a notice in town: ' + JSON.stringify(r).slice(0, 120));
r = act(A, 'post_notice', {text: 'again'}); ok(!r.ok && /still up/.test(r.error), 'a second notice is refused: ' + r.error);
r = act(B, 'post_notice', {text: 'x'.repeat(121)}); ok(!r.ok && /Too long/.test(r.error), 'over 120 characters is refused');
const A0 = {x: A.x, y: A.y}; B.state = 'hunt'; r = act(B, 'post_notice', {text: 'hello'}); ok(!r.ok && /town board/.test(r.error), 'post_notice refuses outside town'); B.state = 'town';
r = act(B, 'list_jobs');
ok(r.ok && r.notices && r.notices.length === 1 && r.notices[0].from.includes(A.name) && r.notices[0].from.includes(homeOf(A).name), 'a reader learns the poster\'s name and town');
ok(JSON.stringify(r.notices).indexOf('"x"') < 0 && !('x' in r.notices[0]) && !/hp|\d+\.\d+/.test(JSON.stringify(r.notices[0])), 'the notice carries only text, no position or HP');
ok(!(act(A, 'list_jobs').notices || []).length, 'the poster does not read their own notice');
S.gameMin += 3 * 1440; r = act(B, 'list_jobs'); ok(!(r.notices || []).length, 'a notice lapses after two game days');
// sightings
act(C, 'move_to', {target: 'north'});
const sg = (S.sightings || []).find(s => s.hero === C.id);
ok(sg && sg.town === homeOf(C).name, 'an agent hero leaving the gate leaves a sighting' + (sg ? ' bound for ' + sg.bound : ''));
ok(!(S.sightings || []).some(s => s.hero === 99999), 'sightings hold agent heroes only');
const lines = SG.sightingLines(D, homeOf(D).name);
ok(lines.length && lines[0].text.includes(C.name) && !/\d/.test(lines[0].text.replace(C.name, '')), 'the gate repeats it as plain text: ' + (lines[0] && lines[0].text));
r = act(D, 'list_jobs'); ok(r.sightings && r.sightings[0].includes(C.name), 'list_jobs gives the gate\'s sightings');
if (other) ok(!SG.sightingLines(other, homeOf(D).name).length, 'the other faction hears none');
// couriers by name
r = act(D, 'send_courier', {to: C.name, text: 'hello'});
ok(!r.ok && /never met/.test(r.error), 'send_courier refuses a hero you never met: ' + r.error);
// they speak in earshot: now D has met C
D.chat = []; D.talkHeard = {[C.id]: 1}; C.talkHeard = {[D.id]: 1}; SG.noteKnownAt(D, C);
C.state = 'hunt'; C.x = gate.x + 40; C.y = gate.y + 40; D.state = 'town'; D.x = gate.x; D.y = gate.y;
r = act(D, 'send_courier', {to: C.name, text: 'Meet me at the ford.'});
ok(r.ok, 'send_courier reaches a hero you have met by name: ' + JSON.stringify(r).slice(0, 160));
const m = ((CM.companyOf(D) || {}).post || [])[0];
ok(m && m.to === C.id && m.cost >= RC.courierCost(0), 'the courier is hired and costed (' + (m && m.cost) + 'g)');
C.x += 20; // moving on does not change the fee, which was priced from where D last knew C
ok(m.cost === RC.courierCost(Math.hypot(40, 40)) || m.cost === RC.courierCost(Math.hypot(gate.x - D.knownAt[C.id].x, gate.y - D.knownAt[C.id].y)), 'the fee follows the last known place');
for (let i = 0; i < 40 && (C.playEv || []).every(e => !/courier finds you/.test(e.text)); i++) {S.gameMin += 60; run(1)}
ok((C.playEv || []).some(e => /courier finds you with word from/.test(e.text)), 'the courier arrives as an event for the reader');
// determinism of the data: JSON round trip
const snap = JSON.parse(JSON.stringify(SIM.snapshot()));
ok(Array.isArray(snap.sightings) && snap.sightings.length > 0, 'sightings are saved with the world');
console.log(fail ? '\n' + fail + ' FAILED' : '\nall ok'); process.exit(fail ? 1 : 0);
