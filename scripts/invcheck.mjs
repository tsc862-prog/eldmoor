// Inventory check (issue #124): the pack model, consumables from the USES table, quest items, the
// bag -> inv save migration, supplies in town, giving within the party, the lever, the Table potion and
// determinism. Usage: npm run invcheck   (INVCHECK_SEED to vary the world)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let seed = 0x9e3779b9 ^ (Number(process.env.INVCHECK_SEED) || 124);
const reseed = n => {seed = n >>> 0; Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296}};
reseed(seed);
const {init, step, S, snapshot, restore, maxHp} = await import('../src/sim/index.js');
const INV = await import('../src/sim/inv.js');
const I = await import('../src/data/items.js');
const {makeItem, equip} = await import('../src/sim/gear.js');
const {pull} = await import('../src/sim/levers.js');
const T = await import('../src/sim/table.js');
const {TOOL_NAMES} = await import('../src/data/player-tools.js');
const {SAVE_VERSION} = await import('../src/sim/save.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};

init();
if (process.argv.includes('--fp')) {for (let i = 0; i < 360 * 60; i++) step(1 / 60); console.log(JSON.stringify([S.invStats, S.agents.filter(x => x.kind === 'hero').slice(0, 12).map(x => [x.lvl, x.gold, x.inv ? x.inv.list.length : -1])])); process.exit(0)}
for (let i = 0; i < 600; i++) step(1 / 60);
const live = () => S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');

// ---- the data tables ----
console.log('tables');
ok(Object.keys(I.USES).length >= 8 && Object.values(I.USES).every(u => u.price > 0 && u.flavour && I.useLines(Object.keys(I.USES).find(k => I.USES[k] === u)).length), 'every consumable has a price, flavour and tooltip lines');
ok(['inventory', 'use_item', 'equip', 'drop', 'give'].every(n => TOOL_NAMES.includes(n)), 'agent tools: inventory, use_item, equip, drop, give');
ok(live().every(a => a.inv && Array.isArray(a.inv.list) && !('bag' in a)), 'every hero carries a pack and no bag');

// ---- the pack ----
console.log('the pack');
const a = live().find(x => x.state !== 'town') || live()[0];
a.inv = INV.newInv(); a.gold = 500; a.hp = maxHp(a);
INV.addGood(a, 'Wolf Pelt', 25); ok(INV.count(a, 'Wolf Pelt') === 25 && a.inv.list.length === 2, 'goods stack to 20 and spill into a second slot');
a.inv = INV.newInv(); for (let i = 0; i < 40; i++) INV.addGood(a, 'Grave Dust', 20); ok(INV.used(a) <= INV.capOf(a), 'the pack never holds more stacks than its capacity');
a.inv = INV.newInv(); INV.addQuest(a, 'Cairn-Door Key');
ok(INV.addUse(a, 'Redroot Draught', 3) === 3 && INV.count(a, 'Redroot Draught') === 3, 'consumables stack');
ok(!INV.giveItem(a, live().find(x => x !== a), a.inv.list.findIndex(e => e.kind === 'quest')).ok, 'a quest item cannot be given');
ok(!INV.dropEntry(a, a.inv.list.findIndex(e => e.kind === 'quest')).ok, 'a quest item cannot be dropped');
ok(INV.sellLoot(a).gold === 0 && a.inv.list.some(e => e.kind === 'quest') && INV.count(a, 'Redroot Draught') === 3, 'selling keeps quest items and consumables');
// capacity and the pack item
a.inv = INV.newInv(); for (let i = 0; i < INV.capOf(a); i++) INV.addGear(a, makeItem(a.cls, 'head', 2, 0, {src: 'check'}));
const g0 = a.gold; INV.addGear(a, makeItem(a.cls, 'head', 4, 0)); ok(a.gold > g0 && INV.used(a) === I.INV.BASE, 'a full pack sells the next piece instead of overflowing');
a.inv = INV.newInv(); a.hp = 1; ok(INV.useItem(a, "Wayfarer's Pack").ok === false, 'a pack not carried cannot be used');
INV.addUse(a, "Wayfarer's Pack", 1); ok(INV.useItem(a, "Wayfarer's Pack").ok && INV.capOf(a) === I.INV.BASE + I.USES["Wayfarer's Pack"].slots, "the Wayfarer's Pack adds slots");

// ---- using things ----
console.log('using things');
a.inv = INV.newInv(); a.state = 'hunt'; a.hp = Math.floor(maxHp(a) * .3); INV.addUse(a, 'Redroot Draught', 2); INV.addUse(a, 'Linen Bandage', 1);
let h0 = a.hp; ok(INV.useItem(a, 'Linen Bandage').ok && a.hp > h0, 'a bandage binds wounds out of a fight');
a.state = 'fight'; ok(!INV.useItem(a, 'Linen Bandage').ok, 'a bandage is refused in a fight (and not used up)');
h0 = a.hp; ok(INV.useItem(a, 'Redroot Draught').ok && Math.abs(a.hp - Math.min(maxHp(a), h0 + maxHp(a) * I.USES['Redroot Draught'].heal)) < 1, `a potion heals ${I.USES['Redroot Draught'].heal * 100}% in a fight`);
a.hp = maxHp(a); ok(!INV.useItem(a, 'Redroot Draught').ok && INV.count(a, 'Redroot Draught') === 1, 'a potion is not wasted at full health');
// scripted drinking: below the threshold, once per cooldown
a.state = 'fight'; a.potCd = 0; a.hp = Math.floor(maxHp(a) * .2); INV.fightAid(a, {}); ok(INV.count(a, 'Redroot Draught') === 0 && a.hp > maxHp(a) * .4, 'the scripted hero drinks a potion in a fight below 40% HP');
INV.addUse(a, 'Redroot Draught', 1); a.hp = Math.floor(maxHp(a) * .2); INV.fightAid(a, {}); ok(INV.count(a, 'Redroot Draught') === 1, 'the potion cooldown holds');
// scrolls
INV.addUse(a, 'Scroll of Hearthward', 1); a.potCd = 0; a.state = 'fight'; a.target = null; ok(INV.useItem(a, 'Scroll of Hearthward').ok && a.state === 'return', 'Hearthward sends the reader home');
INV.addUse(a, 'Scroll of the Steadfast Hour', 1); const base = (await import('../src/sim/stats.js')).dmgTaken(a); INV.useItem(a, 'Scroll of the Steadfast Hour');
ok((await import('../src/sim/stats.js')).dmgTaken(a) < base * .8, 'the warding scroll softens blows'); a.wardT = 0;
// antidote
const mob = S.mobs.find(m => m.alive); a.x = mob.x; a.y = mob.y; mob.dots = [{h: a, id: 'venom', rem: 5, dps: 2}]; INV.addUse(a, 'Bogroot Antidote', 1);
ok(INV.venomOn(a) && INV.useItem(a, 'Bogroot Antidote').ok && !INV.venomOn(a), 'an antidote draws venom out'); mob.dots = [];
ok(!INV.useItem(a, 'Bogroot Antidote').ok, 'no antidote left, none used');

// ---- passing gear within the party, wearing spares ----
console.log('gear');
const w = live().find(x => x.cls === 'Warrior' && x.slots), spare = makeItem('Warrior', 'head', Math.min(20, w.lvl + 2), 0, {src: 'check', rare: 0});
w.inv = INV.newInv(); w.slots.head = makeItem('Warrior', 'head', 1, 0, {rare: 0}); INV.addGear(w, spare); INV.autoEquip(w);
ok(w.slots.head === spare && INV.spares(w).length === 1, 'a better spare is worn in town and the old piece is kept to sell');
const high = makeItem('Warrior', 'chest', w.lvl + I.INV.WEAR_OVER + 3, 0, {rare: 0}); INV.addGear(w, high); INV.sellLoot(w);
ok(INV.spares(w).includes(high) && INV.spares(w).length === 1, 'a piece too high to wear yet is kept past the sale');
const mage = live().find(x => x.cls !== 'Warrior' && x.slots); ok(!INV.giveItem(w, mage, w.inv.list.indexOf(high)).ok, 'gear for another class is not given across (and a non-party member is refused)');

// ---- supplies in town ----
console.log('supplies');
const s = live()[0]; s.inv = INV.newInv(); s.gold = 1000; s.lvl = 12; INV.restock(s);
ok(INV.countKind(s, 'potion') >= 3 && INV.has(s, 'Marrowmend Tonic') && s.gold < 1000, `a level 12 hero stocks tonics and spends gold (${INV.countKind(s, 'potion')} potions, ${s.gold}g left)`);
ok(INV.has(s, 'Linen Bandage'), 'and bandages');

// ---- the DM lever ----
console.log('lever');
const lh = live()[1]; lh.inv = INV.newInv();
let r = pull('give_token', {hero: lh.id, token: 'Rookscar Toll-Token'}, {by: 'scripted', reason: 'invcheck'}); ok(r.ok && INV.has(lh, 'Rookscar Toll-Token'), 'give_token puts a quest item in a pack' + (r.ok ? '' : ': ' + r.reason));
r = pull('give_token', {hero: lh.id, token: 'Rookscar Toll-Token'}, {by: 'scripted', reason: 'invcheck'}); ok(!r.ok, 'it is not given twice');
r = pull('take_token', {hero: lh.id, token: 'Rookscar Toll-Token'}, {by: 'scripted', reason: 'invcheck'}); ok(r.ok && !INV.has(lh, 'Rookscar Toll-Token'), 'take_token takes it back');
r = pull('give_token', {hero: lh.id, token: 'Not A Token'}, {by: 'scripted'}); ok(!r.ok, 'an unknown token is refused');

// ---- the Table ----
console.log('the table');
{const {fellows} = await import('../src/sim/fellowship.js'); const F = fellows(); const t = F[0], u = F[1]; for (const x of F) {x.hp = maxHp(x); x.inv = INV.newInv()}
 t.hp = Math.floor(maxHp(t) * .2); INV.addUse(t, 'Redroot Draught', 1); const m = S.mobs.find(x => x.alive); const sc = {kind: 'rescue', ctx: {mob: m.id}, ids: F.map(x => x.id)};
 ok(T.optionsFor(sc, t).some(o => o.k === 'potion'), 'a potion shows among the scene options'); ok(T.reflexFor(sc, t) === 'potion', 'a hurt member holding a potion reflexes to give it');
 ok(!T.optionsFor(sc, u).some(o => o.k === 'potion'), 'a member with no potion has no such option');}

// ---- migration: a v5 save with a bag becomes a pack ----
console.log('save migration');
{const snap = JSON.parse(JSON.stringify(snapshot()));
 snap.version = 5; const m = snap.agents.find(x => x.kind === 'hero' && x.slots);
 for (const x of snap.agents) if (x.kind === 'hero') {delete x.inv; x.bag = []}
 m.bag = ['Wolf Pelt', 'Wolf Pelt', 'Boar Tusk', makeItem(m.cls, 'head', 3, 0, {rare: 0})];
 restore(snap);
 const back = S.agents.find(x => x.id === m.id);
 ok(SAVE_VERSION >= 6 && back.inv && !('bag' in back), `v5 -> v${SAVE_VERSION}: bag becomes inv`);
 ok(INV.count(back, 'Wolf Pelt') === 2 && INV.count(back, 'Boar Tusk') === 1 && INV.spares(back).length === 1 && INV.spares(back)[0].cls === back.cls, 'goods stack and the spare keeps its class');
 ok(S.agents.filter(x => x.kind === 'hero').every(x => x.inv), 'every hero has a pack after the migration');
 const again = JSON.parse(JSON.stringify(snapshot())); restore(again); ok(JSON.stringify(snapshot()) === JSON.stringify(again), 'the pack survives a save round trip');}

// ---- determinism ----
console.log('determinism');
const fp = () => {const c = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fp'], {encoding: 'utf8'}); return c.status === 0 ? c.stdout.trim() : 'ERR ' + c.stderr.slice(0, 300)};
const h1 = fp(), h2 = fp(); ok(h1 === h2 && !h1.startsWith('ERR'), 'two seeded 6-minute runs are identical (' + h1.length + ' chars)');
const fpj = (() => {try {return JSON.parse(h1)} catch (e) {return null}})();
ok(fpj && fpj[0] && fpj[0].bought > 0, 'heroes bought supplies in a seeded 6-minute run (' + JSON.stringify(fpj && fpj[0]) + ')');

console.log(fail ? `\ninvcheck: ${fail} check(s) FAILED` : '\ninvcheck: all checks passed');
process.exit(fail ? 1 : 0);
