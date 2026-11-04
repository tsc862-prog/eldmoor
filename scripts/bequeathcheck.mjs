// A hero's will (#631): bequeath {to, item|gold, words}. Writing, updating and revoking a will; items and gold to a
// companion near (at once) and far (held in C.estate until they rest); gear of another class sold for the heir; a heir
// who fell or left gets nothing; being downed and brought back opens nothing, only the final death (fall) does; the
// refusals; save and restore of the will and the estate; the will private to its writer until it executes.
// Usage: node scripts/bequeathcheck.mjs
let seed = 0x5eed631;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const {init, S, snapshot, restore} = await import('../src/sim/index.js');
const {agentDie, slay, maxHp} = await import('../src/sim/heroes.js');
const {foundCompany, companyOf, leaveCompany} = await import('../src/sim/company.js');
const {invOf, addUse, addQuest, count} = await import('../src/sim/inv.js');
const {WILL, estateTick, willOf} = await import('../src/sim/will.js');
const {tiersOf} = await import('../src/sim/tiers.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {CITY} = await import('../src/world/map.js');
const P = await import('../src/sim/player.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor bequeathcheck\n');
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});
const FIELD = {x: 40, y: 25};
const town = CITY[0];

// A quiet world: no mobs, no recruits; four heroes of one faction in the field, three of them a company of agents.
function world() {
  seed = 0x5eed631; init({fellowship: false});
  for (const m of S.mobs) {m.alive = false; m.respawn = 1e9; m.target = null}
  for (const a of S.agents) {a.state = 'town'; a.townStep = 0; a.wait = 1e9; a.x = 5; a.y = 5; a.party = null; a.guild = null; delete a.company}
  S.companies = []; S.recruits.length = 0;
  const f0 = S.agents.filter(x => x.fac === 0);
  const H = f0.slice(0, 4).map((a, i) => {a.state = 'hunt'; a.x = FIELD.x + i * .5; a.y = FIELD.y; a.hp = maxHp(a); a.player = true; a.gold = 100; return a});
  const r = foundCompany(H.slice(0, 3)); return {H, C: r.company}}
const gear = (cls, name) => ({name, slot: 'main', ilvl: 4, zone: 1, cls, epic: false, quality: 'common', damage: 3});
const mob = a => {const m = S.mobs[0]; m.alive = true; m.hp = m.maxhp; m.x = a.x + 2; m.y = a.y; m.target = null; m.cd = 1e9; return m};
const events = a => (a.playEv || []).map(e => e.text).join(' | ');

// 1. Writing, updating, listing, privacy and revoking
let {H: [A, B, Cc, X], C} = world();
ok(C && companyOf(A) === C && companyOf(B) === C && !companyOf(X), 'a company of three agents, a fourth hero outside it');
A.slots.main = gear(A.cls, 'Oathkeeper Blade');
let r = act(A, 'bequeath', {to: B.name, item: 'Oathkeeper', words: 'Keep it sharp, and keep them alive.'});
ok(r.ok && willOf(A).length === 1 && willOf(A)[0].to === B.id && willOf(A)[0].item === 'Oathkeeper Blade', 'a worn piece left to a companion by part of its name');
ok(JSON.stringify(act(A, 'status').will || []).includes('Keep it sharp') && JSON.stringify(act(A, 'self').will || []).includes('Oathkeeper Blade'), 'status and self list the will with its words');
ok(!JSON.stringify(act(B, 'status')).includes('Keep it sharp') && !JSON.stringify(act(B, 'inspect', {who: A.name})).includes('Oathkeeper Blade') && !JSON.stringify(act(B, 'companions')).includes('Keep it sharp'), 'the heir does not learn of it (status, inspect, companions)');
r = act(A, 'bequeath', {to: Cc.name, item: 'Oathkeeper Blade'});
ok(r.ok && willOf(A).length === 1 && willOf(A)[0].to === Cc.id && !willOf(A)[0].words, 'naming the item again changes the heir (one bequest per item)');
r = act(A, 'bequeath', {to: B.name, gold: 30, words: 'For the inn.'});
ok(r.ok && willOf(A).length === 2, 'a sum of gold beside it');
r = act(A, 'bequeath', {to: B.name, gold: 40});
ok(r.ok && willOf(A).filter(b => b.gold != null).length === 1 && willOf(A).find(b => b.gold != null).gold === 40, 'a second sum to the same companion replaces the first');
{const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap); A = S.agents.find(x => x.id === A.id); B = S.agents.find(x => x.id === B.id); Cc = S.agents.find(x => x.id === Cc.id); X = S.agents.find(x => x.id === X.id); C = companyOf(A);
  ok(willOf(A).length === 2 && willOf(A)[0].item === 'Oathkeeper Blade' && willOf(A)[1].gold === 40, 'save and restore keep the will')}
r = act(A, 'bequeath', {to: 'nobody', item: 'Oathkeeper'});
ok(r.ok && willOf(A).length === 1 && willOf(A)[0].gold === 40, 'to "nobody" with an item revokes that bequest');
r = act(A, 'bequeath', {to: 'nobody'});
ok(r.ok && !A.will && willOf(A).length === 0, 'to "nobody" with neither tears up the whole will');

// 2. Refusals
addQuest(A, 'Sealed Writ', 7); addUse(A, 'Redroot Draught', 3);
const refused = (args, re, m) => {const x = act(A, 'bequeath', args); ok(!x.ok && re.test(x.error || ''), m + (x.ok ? ' (accepted)' : ': ' + x.error))};
refused({to: X.name, item: 'Redroot Draught'}, /not a living companion/, 'a hero outside the company is refused');
refused({to: A.name, item: 'Redroot Draught'}, /not yourself/, 'yourself is refused');
refused({to: 'Nobody Atall', gold: 5}, /not a living companion/, 'an unknown name is refused');
refused({to: B.name, item: 'Sealed Writ'}, /bound to its bearer/, 'a quest item is refused');
refused({to: B.name, item: 'Moonstone Crown'}, /carry nothing called/, 'a thing not carried is refused');
refused({to: B.name, gold: 500}, /You hold 100 gold/, 'more gold than you hold is refused');
refused({to: B.name, gold: 0}, /above zero/, 'zero gold is refused');
refused({to: B.name, item: 'Redroot Draught', gold: 5}, /not both/, 'an item and gold at once are refused');
refused({to: B.name}, /Bequeath what/, 'no item and no gold is refused');
refused({to: B.name, gold: 5, words: 'x'.repeat(WILL.WORDS + 1)}, /a will holds 120/, 'words past 120 characters are refused');
refused({to: B.name, gold: 5, words: '我的剑留给你，好好保管它，朋友'}, /English/, 'words not in English are refused');
refused({to: 'nobody'}, /no will to revoke/, 'revoking an empty will is refused');
refused({}, /to whom/, 'no heir named is refused');
{const x = P.playerAct(X.id, 'bequeath', {to: A.name, gold: 5}); ok(!x.ok && /no companion/.test(x.error || ''), 'a hero with no company to name anyone in is refused')}
{X.player = false; const x = P.playerAct(X.id, 'bequeath', {to: A.name, gold: 5}); ok(!x.ok && !X.will, 'a scripted hero makes no will'); X.player = true}

// 3. Downed and brought back: the will stays sealed. Then the final death: near at once, far held until rest.
({H: [A, B, Cc, X], C} = world());
A.slots.main = gear(A.cls, 'Oathkeeper Blade'); B.cls = A.cls; addUse(A, 'Redroot Draught', 2);
A.gold = 100; const bGold = B.gold, cGold = Cc.gold;
ok(act(A, 'bequeath', {to: B.name, item: 'Oathkeeper Blade', words: 'Keep it sharp.'}).ok && act(A, 'bequeath', {to: B.name, item: 'Redroot', words: 'Drink before you need to.'}).ok
  && act(A, 'bequeath', {to: Cc.name, gold: 60, words: 'Buy the first round.'}).ok, 'A leaves B the blade and the draughts, C sixty gold');
Cc.x = FIELD.x + 30; Cc.y = FIELD.y; // C far afield
const m = mob(A); rebuild(); A.hp = -5; agentDie(A, m);
ok(A.state === 'downed' && willOf(A).length === 3 && !(B.received || []).length && !(C.estate || []).length, 'downed: the will is not opened');
A.hp = 10; (await import('../src/sim/downed.js')).downedStep(A, .1);
ok(A.state !== 'downed' && A.state !== 'dead' && willOf(A).length === 3 && !(B.received || []).length, 'brought back: the will still sealed, nothing handed over');
rebuild(); A.hp = -5; slay(A, m);
ok(A.state === 'dead' && !A.will && Array.isArray(A.willDone) && A.willDone.length === 3, 'the final death (slay -> fall) opens the will');
ok(invOf(B).list.some(e => e.name === 'Oathkeeper Blade') && !A.slots.main, 'B, beside A, has the blade at once (taken from the fallen hand)');
ok(count(B, 'Redroot Draught') >= 2 && count(A, 'Redroot Draught') === 0, 'and the whole stack of draughts');
ok(/will names you: you receive Oathkeeper Blade: "Keep it sharp\."/.test(events(B)) && (B.playEv || []).some(e => e.u && e.w === 2 && /Oathkeeper/.test(e.text)), 'B hears it at once: an urgent event with the words');
ok(tiersOf(B).marks.some(x => x.k === 'will' && /Received Oathkeeper Blade from /.test(x.text)), 'a landmark "Received ... from ..." for B');
ok((B.received || []).length === 2 && B.received[0].from === A.name, 'B\'s received list (the Life view reads it)');
ok(C.estate && C.estate.length === 1 && C.estate[0].to === Cc.id && C.estate[0].thing.gold === 60 && Cc.gold === cGold, 'C, far away, gets nothing yet: sixty gold held in the estate');
estateTick();
ok(C.estate && C.estate.length === 1, 'still held while C hunts in the field');
// save and restore with the estate pending
{const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
  const C2 = S.companies.find(x => x.id === C.id), c2 = S.agents.find(x => x.id === Cc.id), a2 = S.agents.find(x => x.id === A.id);
  ok(C2 && C2.estate && C2.estate.length === 1 && a2.willDone.length === 3, 'save and restore keep the estate and the executed will');
  c2.x = (town.x0 + town.x1) / 2; c2.y = (town.y0 + town.y1) / 2; c2.state = 'town'; estateTick();
  ok(!C2.estate && c2.gold === cGold + 60 && /A letter from .+ comes with 60 gold: "Buy the first round\."/.test(events(c2)), 'C rests in town: the gold arrives with the words as a letter');
  ({H: [A, B, Cc, X], C} = {H: [a2, null, c2, null], C: C2})}

// 4. Gear of another class is sold for the heir; a heir who fell or left gets nothing
({H: [A, B, Cc, X], C} = world());
const other = ['Warrior', 'Mage', 'Priest', 'Rogue', 'Hunter', 'Skald'].find(k => k !== B.cls);
invOf(A).list.push(gear(other, 'Foreign Staff')); A.gold = 100;
const b0 = B.gold;
ok(act(A, 'bequeath', {to: B.name, item: 'Foreign Staff'}).ok && act(A, 'bequeath', {to: Cc.name, gold: 20}).ok, 'A leaves B a piece made for a ' + other + ', C twenty gold');
Cc.state = 'dead'; // C falls first
rebuild(); A.hp = -maxHp(A) - 5; agentDie(A, mob(A));
ok(A.state === 'dead' && !invOf(B).list.some(e => e.name === 'Foreign Staff') && B.gold === b0 + 8 && /made for a .+; sold for you: 8 gold/.test(events(B)), 'the piece does not fit B\'s class: sold for B (8 gold)');
ok(A.willDone.some(w => w.to === Cc.name && w.how === 'lapsed' && /fallen/.test(w.why)) && !(C.estate || []).length, 'C fell before A: that bequest lapses');
({H: [A, B, Cc, X], C} = world());
A.gold = 100; ok(act(A, 'bequeath', {to: B.name, gold: 25}).ok && act(A, 'bequeath', {to: Cc.name, gold: 25}).ok, 'A leaves B and C twenty-five gold each');
const bb = B.gold; B.x = FIELD.x + 40; leaveCompany(Cc);
ok(companyOf(Cc) !== C, 'C leaves the company');
rebuild(); A.hp = -maxHp(A) - 5; agentDie(A, mob(A));
ok(A.willDone.some(w => w.to === Cc.name && w.how === 'lapsed' && /no longer of the company/.test(w.why)), 'C left the company: nothing goes outside it');
ok(C.estate && C.estate.length === 1 && C.estate[0].to === B.id, 'B, far, has twenty-five gold held');
B.state = 'dead'; estateTick();
ok(!C.estate && B.gold === bb, 'B falls before resting: the held bequest lapses');

// 5. A camp's rest delivers a held bequest; the scripted world never makes a will
({H: [A, B, Cc, X], C} = world());
A.gold = 50; ok(act(A, 'bequeath', {to: B.name, gold: 50, words: 'Light a fire for me.'}).ok, 'A leaves B fifty gold');
B.x = FIELD.x + 30; rebuild(); A.hp = -maxHp(A) - 5; agentDie(A, mob(A));
const bg = B.gold; B.state = 'camp'; C.camp = {phase: 'gather', ids: [B.id, Cc.id]}; estateTick();
ok(C.estate && B.gold === bg, 'gathering at camp is not yet resting');
C.camp.phase = 'rest'; estateTick();
ok(!C.estate && B.gold === bg + 50 && /Light a fire for me/.test(events(B)), 'the camp settles to rest: the letter and the gold arrive');
C.camp = null; B.state = 'hunt';
{seed = 0x5eed631; init({fellowship: false}); const {step} = await import('../src/sim/index.js'); for (let i = 0; i < 1200; i++) step(1 / 20);
  ok(S.agents.every(a => !a.will && !a.willDone && !a.received) , 'a minute of a scripted world: no will anywhere')}

console.log(fail ? `\nbequeathcheck: ${fail} FAILED\n` : '\nbequeathcheck: all ok\n');
process.exit(fail ? 1 : 0);
