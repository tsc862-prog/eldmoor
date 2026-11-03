// Crafting check (issue #258, epic #238): the craft tool through playerAct (refusals that name what is missing: the
// profession, the skill, the materials, the fee, the place; a success that names its maker), crafted gear carrying its
// maker, the skill rising; cooking and brewing at a camp fire (smithing refused there, refused while the company sits at
// its table), a meal's buff in the combat totals and its expiry; give to a companion in reach and refused out of reach;
// the camp supper of a reflex member and the one note to an agent member after the fire's talk; scripted heroes crafting
// in town (buying missing materials, keeping their materials from the sale) and agents never crafting by script;
// a save round trip and determinism.
// Usage: npm run craftcheck   |   node scripts/craftcheck.mjs --hash  (the seeded scripted world hash)
let seed = 0x3a4e5 ^ 11;
const reseed = s => {seed = s};
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, playerAct, snapshot, restore, setRunnerLinks} = SIM;
const hashWorld = () => {let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
  for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(',')); return h};
const run = (f, secs) => {reseed(0x3a4e5 ^ 11); init({fellowship: f}); for (let i = 0; i < secs * 60; i++) step(1 / 60); return hashWorld()};
if (process.argv.includes('--hash')) {for (const f of [false, true]) console.log('hash fellowship=' + f + ': ' + run(f, 600) + ' crafted=' + ((S.craftStats || {}).made || 0)); process.exit(0)}
const {count, invOf, addUse, addGood, sellLoot, spares} = await import('../src/sim/inv.js');
const {skillOf, learn} = await import('../src/sim/professions.js');
const {CRAFT, craftTool, townCraft, campCraft, keepFor, mealOn, recipeKey} = await import('../src/sim/craft.js');
const {combatStats} = await import('../src/sim/stats.js');
const {sellAndShop} = await import('../src/sim/heroes.js');
const {companyOf} = await import('../src/sim/company.js');
const {sceneFor} = await import('../src/sim/table.js');
const {CITY} = await import('../src/world/map.js');
const {USES} = await import('../src/data/items.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const call = (a, t, x) => {a.playRate = []; return playerAct(a.id, t, x || {})};
console.log('\nEldmoor craftcheck\n');

reseed(0x3a4e5 ^ 11); init({fellowship: true});
const F = (await import('../src/sim/company.js')).slotted(), M = F.ids.map(id => S.agents.find(x => x.id === id));
const [a, b] = M;
const home = CITY.find(c => c.fac === a.fac);
const toTown = h => {h.state = 'town'; h.x = home.ah.x; h.y = home.ah.y; h.pq = []; h.target = null};
const field = {x: home.x1 + 20, y: (home.y0 + home.y1) / 2};
a.profs = []; a.gold = 500; invOf(a).list = [];

console.log('refusals');
toTown(a);
let r = call(a, 'craft', {recipe: 'meal-perch'});
ok(!r.ok && /Cooking, which you do not know/.test(r.error) && /Missing materials: River Perch x2/.test(r.error), 'no profession and no materials: both named: ' + r.error);
r = call(a, 'craft', {recipe: 'basket'});
ok(!r.ok && /no recipe called/.test(r.error), 'an unknown recipe is refused with the list');
r = call(a, 'craft', {recipe: 'tonic'});
ok(!r.ok && /Marrowmend Tonic/.test(r.error), 'a recipe by part of what it makes: "tonic" finds Marrowmend Tonic');
learn(a, 'cooking'); learn(a, 'smithing');
r = call(a, 'craft', {recipe: 'Fenmire Eel Stew'});
ok(!r.ok && /needs Cooking 50/.test(r.error) && /you have 1/.test(r.error), 'skill below the band: named with the skill needed: ' + r.error);
addGood(a, 'River Perch', 1);
r = call(a, 'craft', {recipe: 'meal-perch'});
ok(!r.ok && /River Perch x1 \(you carry 1 of 2\)/.test(r.error) && !/Cooking, which/.test(r.error), 'one perch short: only the materials are named');
addGood(a, 'River Perch', 5); a.gold = 0;
r = call(a, 'craft', {recipe: 'meal-perch'});
ok(!r.ok && /fee is 1g/.test(r.error), 'no gold for the fee: refused');
a.gold = 500;
a.state = 'hunt'; a.x = field.x; a.y = field.y;
r = call(a, 'craft', {recipe: 'meal-perch'});
ok(!r.ok && /only in a friendly town/.test(r.error), 'out in the field, no camp: refused');

console.log('\ncrafting in town');
toTown(a);
const g0 = a.gold, s0 = skillOf(a, 'cooking');
r = call(a, 'craft', {recipe: 'perch', count: 2});
ok(r.ok && r.maker === a.name && r.result.includes(a.name + ' made') && count(a, 'Spit-Roast Perch') === 2 && count(a, 'River Perch') === 2, 'craft x2 in town: meals in the pack, perch used, the maker named: ' + r.result);
ok(a.gold === g0 - 2 && skillOf(a, 'cooking') > s0, 'the fee is paid and the skill rises (' + s0 + ' -> ' + skillOf(a, 'cooking') + ')');
addGood(a, 'Tin Ore', 3); addGood(a, 'Wolf Sinew', 1);
r = call(a, 'craft', {recipe: 'forge-tinforged', for: b.name});
const gear = spares(a).find(it => it.maker === a.name);
ok(r.ok && gear && gear.cls === b.cls && gear.src === 'Crafted by ' + a.name && /^Tinforged /.test(gear.name), 'gear for a companion: made for their class, carries its maker: ' + (gear && gear.name + ' / ' + gear.src));
r = call(a, 'craft', {recipe: 'forge-tinforged', for: 'Nobody'});
ok(!r.ok && /neither a companion/.test(r.error), 'for someone unknown is refused');

console.log('\ngive (#182 reach)');
b.x = a.x + 2; b.y = a.y; b.state = 'town';
const gi = invOf(a).list.indexOf(gear);
r = call(a, 'give', {index: gi, to: b.name});
ok(r.ok && spares(b).some(it => it.maker === a.name), 'give the crafted piece to a companion 2 tiles away');
b.x = a.x + 9;
r = call(a, 'give', {item: 'Spit-Roast Perch', to: b.name});
ok(!r.ok && /too far away/.test(r.error) && /walk over/.test(r.error), 'out of reach (9 tiles) refused: ' + r.error);
b.x = a.x + 3; const saveParty = b.party; b.party = null;
r = call(a, 'give', {item: 'Spit-Roast Perch', to: b.name});
ok(r.ok && count(b, 'Spit-Roast Perch') === 1, 'a company mate outside the party still counts as a companion');
b.party = saveParty;

console.log('\nmeals');
a.hp = 1e9; a.hp = combatStats(a).health;
const sp0 = combatStats(a).speed;
const mealIx = () => invOf(a).list.findIndex(e => e.id === 'Spit-Roast Perch');
r = call(a, 'use_item', {index: mealIx()});
ok(r.ok && mealOn(a) && mealOn(a).stat === 'speed', 'eating a crafted meal at full health is allowed: its buff holds: ' + (r.result || r.error));
ok(Math.abs(combatStats(a).speed - sp0 - USES['Spit-Roast Perch'].buff.v) < 1e-9, 'the buff shows in the combat totals (+' + USES['Spit-Roast Perch'].buff.v + ' speed)');
addUse(a, 'Spit-Roast Perch', 1); r = call(a, 'use_item', {index: mealIx()});
ok(!r.ok && /still full/.test(r.error), 'a second meal while the first holds is refused');
const snap = JSON.stringify(snapshot());
S.gameMin += USES['Spit-Roast Perch'].buff.mins + 1;
ok(!mealOn(a) && Math.abs(combatStats(a).speed - sp0) < 1e-9, 'after its game minutes the buff is gone from the totals');

console.log('\ncamp');
const C = companyOf(a);
const mkCamp = (phase, L) => {C.camp = {phase, why: 'rest', hours: 4, x: field.x, y: field.y, zone: 0, ids: L.map(h => h.id), start: Math.round(S.gameMin) - 60, restAt: Math.round(S.gameMin), nextRoll: 1e9, nextTalk: 1e9, nextBond: 1e9, watchIdx: 0, watcher: L[0].id, stats: {camps: 1, watches: 0, visitors: 0, spotted: 0, caught: 0, talks: 0, quarrels: 0}};
  L.forEach((h, i) => {h.state = 'camp'; h.camp = i; h.x = field.x + i * .3; h.y = field.y; h.pq = []; h.target = null})};
mkCamp('rest', [a, b]);
addGood(a, 'River Perch', 2); addGood(a, 'Tin Ore', 3); addGood(a, 'Wolf Sinew', 1);
r = call(a, 'craft', {recipe: 'meal-perch'});
ok(r.ok && /at the camp fire/.test(r.result), 'cooking at the camp fire: ' + (r.result || r.error));
r = call(a, 'craft', {recipe: 'forge-tinforged'});
ok(!r.ok && /needs a workshop/.test(r.error), 'smithing at the camp fire is refused (a workshop): ' + r.error);
S.table = {kind: 'fireside', ids: [a.id, b.id], company: C.id};
r = craftTool(a, {recipe: 'meal-perch'}, {inTown: false});
ok(!r.ok && /sits at the table/.test(r.why), 'refused while the talk round the fire is under way');
S.table = null;
// a reflex member cooks at supper; an agent member is told once, after the fire's talk
b.profs = []; learn(b, 'alchemy'); invOf(b).list = []; addGood(b, 'Redroot Leaf', 4); b.gold = 50;
const before = count(b, 'Redroot Draught');
mkCamp('gather', [a, b]); C.camp.start = Math.round(S.gameMin) - 100; // past GATHER_MAX: it settles to rest on the next tick
addGood(a, 'River Perch', 2); setRunnerLinks(h => h === a ? 'connected' : 'none'); delete C.fireQ; if (C.fire) C.fire.last = -1e9; a.playEv = [];
step(1 / 60);
ok(C.camp && C.camp.phase === 'rest', 'the camp settles to rest');
ok(count(b, 'Redroot Draught') === before + 1 && count(b, 'Redroot Leaf') === 2, 'supper: the reflex member (no runner) brews a draught from its own herbs');
step(1 / 60); const fs = sceneFor(C);
ok(fs && fs.kind === 'fireside' && !(a.playEv || []).some(e => /cook or brew/.test(e.text)), 'the talk round the fire opens first (a fireside scene), and no crafting note while it runs');
if (S.table === fs) S.table = null; if (S.tables) delete S.tables[C.id]; delete C.fireQ; step(1 / 60);
const notes = (a.playEv || []).filter(e => /cook or brew/.test(e.text));
ok(notes.length === 1 && /meal-perch/.test(notes[0].text), 'once the talk is over the agent member is told what it can cook: ' + (notes[0] && notes[0].text));
step(1 / 60);
ok((a.playEv || []).filter(e => /cook or brew/.test(e.text)).length === 1, 'only once a camp');
ok(count(a, 'Spit-Roast Perch') >= 1 && !mealOn(a), 'the agent member\'s own meals are not eaten for it at supper');
setRunnerLinks(null); C.camp.phase = null; for (const h of [a, b]) {h.state = 'hunt'; h.camp = undefined}

console.log('\nscripted heroes');
const bg = S.agents.find(x => x.kind === 'hero' && !x.player && x.state !== 'dead');
bg.lvl = 6; bg.profs = [{id: 'herbalism', skill: 10}]; bg.gold = 300; invOf(bg).list = [];
toTown(bg); addGood(bg, 'Redroot Leaf', 1);
const sk = keepFor(bg);
ok(sk === null, 'no crafting trade yet: nothing held back from the sale');
const made0 = (S.craftStats || {}).made || 0;
sellAndShop(bg);
ok(bg.profs.some(p => p.id === 'alchemy' || p.id === 'scribing'), 'a level-6 herbalist takes up the crafting trade that uses its herbs: ' + bg.profs.map(p => p.id).join(', '));
const made1 = (S.craftStats || {}).made || 0;
ok(made1 > made0, 'and crafts in town, buying the herbs it lacks at the auction house (' + (made1 - made0) + ' made)');
ok(bg.gold >= CRAFT.KEEP, 'it keeps at least ' + CRAFT.KEEP + 'g');
const ck = bg.profs.find(p => p.id === 'alchemy') ? 'Redroot Leaf' : 'Rushpulp';
invOf(bg).list = []; addGood(bg, ck, 4); addGood(bg, 'Wolf Pelt', 2);
const hold = keepFor(bg), sold = sellLoot(bg, hold);
ok(count(bg, ck) === 4 && count(bg, 'Wolf Pelt') === 0 && sold.goods === 2, 'the sale keeps its materials and sells the rest');
const ag = M[2]; ag.lvl = 8; ag.profs = [{id: 'herbalism', skill: 10}]; ag.gold = 300; invOf(ag).list = []; toTown(ag); addGood(ag, 'Redroot Leaf', 4);
ok(townCraft(ag) === 0 && !ag.profs.some(p => p.id === 'alchemy') && campCraft(ag) === 0, 'an agent-played hero never learns or crafts by script');
ok(recipeKey('Redroot Draught').r.id === 'draught-redroot', 'recipes resolve by what they make');

console.log('\nsmith (issue #13)');
{const {SMITH, smithCost, townSmith} = await import('../src/sim/craft.js');
 const s = M[3]; s.player = true; s.lvl = 10; s.gold = 2000; toTown(s);
 const w = s.slots.main || (s.slots.main = {name: 'Test Blade', ilvl: 8, slot: 'main', quality: 'plain', cls: s.cls, damage: 5});
 w.epic = false; w.ilvl = 8; w.up = 0; w.quality = 'plain'; w.cls = s.cls;
 let r = call(s, 'smith', {item: 'main'});
 ok(r.ok && w.ilvl === 9 && w.up === 1 && s.gold < 2000, 'the smith tempers a worn piece one level: ' + (r.result || r.error));
 ok(!call(s, 'smith', {item: 'main', do: 'repair'}).ok, 'repair is refused (gear does not wear)');
 w.ilvl = s.lvl + SMITH.OVER; ok(!call(s, 'smith', {item: 'main'}).ok, 'never above the level cap');
 w.ilvl = 8; w.up = SMITH.MAX_UP; ok(!call(s, 'smith', {item: 'main'}).ok, 'at most ' + SMITH.MAX_UP + ' tempers per piece');
 w.up = 0; s.gold = 3; ok(!call(s, 'smith', {item: 'main'}).ok, 'refused without the gold');
 ok(smithCost({ilvl: 8, quality: 'rare', up: 0}) > smithCost({ilvl: 8, quality: 'plain', up: 0}), 'finer pieces cost more');
 s.gold = 2000; s.x = field.x; s.y = field.y; s.state = 'hunt'; ok(!call(s, 'smith', {item: 'main'}).ok, 'refused out in the field');
 s.slots.trinket = {name: 'Test Relic', ilvl: s.lvl + 3, slot: 'trinket', quality: 'epic', epic: true, cls: s.cls}; toTown(s);
 ok(!call(s, 'smith', {item: 'trinket'}).ok, 'epics are refused (they grow with their bearer)');
 const sc = M[4]; sc.player = false; sc.lvl = 10; sc.gold = 1500; for (const k of ['head', 'chest']) sc.slots[k] = {name: 'Test ' + k, ilvl: 7, slot: k, quality: 'plain', cls: sc.cls, armor: 5}; const before = sc.gold;
 const n = townSmith(sc); ok(n > 0 && sc.gold < before && sc.gold >= SMITH.KEEP, 'a scripted hero with spare gold tempers (' + n + ' tempers, ' + (before - sc.gold) + 'g)');
 sc.gold = 100; ok(townSmith(sc) === 0, 'and not without gold to spare');
 const ag2 = M[2]; ag2.player = true; ag2.gold = 5000; ok(townSmith(ag2) === 0, 'never by script for an agent-played hero');}

console.log('\nsave');
restore(JSON.parse(snap));
const a2 = S.agents.find(x => x.id === a.id);
ok(a2 && mealOn(a2) && spares(S.agents.find(x => x.id === b.id) || {}).some(it => it.maker === a.name), 'a meal\'s buff and a crafted piece\'s maker survive a save round trip');

console.log('\ndeterminism');
const h1 = run(false, 240), c1 = (S.craftStats || {}).made || 0, h2 = run(false, 240);
ok(h1 === h2, 'a seeded scripted world repeats (' + h1 + ', ' + c1 + ' crafted)');
console.log(fail ? '\n' + fail + ' check(s) FAILED' : '\nAll craft checks passed');
process.exit(fail ? 1 : 0);
