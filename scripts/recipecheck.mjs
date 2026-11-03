// Recipe check (issue #256, epic #238): the one recipe table src/data/recipes.js. Every input is a GOODS or MATERIALS
// id, every output resolves (USES or CRAFT_GEAR) and has a use, each crafting profession has recipes across the skill
// bands, prices are sane (a consumable costs no more than it sells for, gear fees scale with item level), every
// material has a source (a node kind or a creature drop), crafted rows never reach a shop or a drop, and the table
// is data only (the seeded scripted world hash is printed with --hash, same recipe as wakecheck).
// Usage: npm run recipecheck   |   node scripts/recipecheck.mjs --hash
let seed = 0x3a4e5 ^ 11;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S} = SIM;
if (process.argv.includes('--hash')) {
  for (const f of [false, true]) {
    init({fellowship: f}); for (let i = 0; i < 600 * 60; i++) step(1 / 60);
    let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
    for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(','));
    console.log('hash fellowship=' + f + ': ' + h + ' deaths=' + S.stats?.deaths);
  }
  process.exit(0);
}
const {RECIPES, RECIPE_BY_ID, recipesOf, recipesFor} = await import('../src/data/recipes.js');
const {GOODS, MATERIALS, USES, CRAFT_GEAR, SLOTS, price} = await import('../src/data/items.js');
const {PROF, PROF_IDS} = await import('../src/data/professions.js');
const {MAT_DROPS} = await import('../src/data/bestiary.js');
const {MOBS} = await import('../src/data/mobs.js');
const {skillBand} = await import('../src/sim/professions.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor recipecheck\n');
const crafts = PROF_IDS.filter(i => PROF[i].kind === 'craft');
ok(crafts.length === 5, 'five crafting professions');
ok(RECIPES.length === 15 && new Set(RECIPES.map(r => r.id)).size === 15, 'fifteen recipes with unique ids');
ok(crafts.every(p => recipesOf(p).length === 3), 'three recipes per crafting profession');
ok(RECIPES.every(r => crafts.includes(r.prof)), 'every recipe belongs to a crafting profession');
ok(RECIPES.every(r => Number.isInteger(r.band) && r.band >= 0 && r.band <= 4), 'every band is 0-4');
ok(crafts.every(p => recipesOf(p).some(r => r.band === 0)), 'every profession has a recipe a beginner (band 0) can make');
ok(crafts.every(p => recipesOf(p).some(r => r.band >= 3)), 'every profession has an expert recipe (band 3 or more)');
ok(crafts.every(p => new Set(recipesOf(p).map(r => r.band)).size === 3), 'the three recipes of a profession sit in three different bands');
ok(crafts.every(p => recipesFor(p, skillBand(1)).length >= 1 && recipesFor(p, skillBand(100)).length === 3), 'skill 1 can craft, skill 100 can craft all');
const inputOk = i => (GOODS[i.id] || MATERIALS[i.id]) && Number.isInteger(i.n) && i.n >= 1 && i.n <= 6;
ok(RECIPES.every(r => r.inputs.length >= 1 && r.inputs.length <= 3 && r.inputs.every(inputOk)), 'every input is a GOODS or MATERIALS id with a count of 1-6');
ok(RECIPES.every(r => Number.isInteger(r.gold) && r.gold >= 1), 'every recipe costs gold (a sink)');
const outOk = o => (o.kind === 'use' && USES[o.id]) || (o.kind === 'gear' && CRAFT_GEAR[o.id]);
ok(RECIPES.every(r => outOk(r.out) && Number.isInteger(r.out.n) && r.out.n >= 1), 'every output resolves in USES or CRAFT_GEAR');
const gearUse = g => SLOTS.includes(CRAFT_GEAR[g].slot) && ['fine', 'rare'].includes(CRAFT_GEAR[g].quality) && CRAFT_GEAR[g].material && CRAFT_GEAR[g].ilvl >= 1;
ok(Object.keys(CRAFT_GEAR).every(gearUse), 'crafted gear patterns name a real slot, quality and material');
ok(Object.keys(CRAFT_GEAR).every(g => RECIPES.some(r => r.out.id === g)), 'every crafted gear pattern is the output of a recipe (it has a use)');
const used = new Set(RECIPES.filter(r => r.out.kind === 'use').map(r => r.out.id));
const craftOnly = Object.keys(USES).filter(k => USES[k].craft);
ok(craftOnly.every(k => used.has(k)), 'every crafted-only consumable is made by a recipe');
ok(craftOnly.every(k => USES[k].drop === 0 && USES[k].flavour && USES[k].price > 0), 'crafted-only rows never drop, have flavour and a price');
ok(craftOnly.filter(k => USES[k].kind === 'potion').every(k => !USES[k].tier), 'crafted potions stay out of the shop potion ladder (tier 0)');
ok(Object.keys(USES).filter(k => USES[k].buff).every(k => USES[k].craft && USES[k].kind === 'ration' && USES[k].buff.v > 0 && USES[k].buff.v <= .1 && USES[k].buff.mins <= 240), 'camp meal buffs are small and short');
// prices
const cost = r => r.inputs.reduce((t, i) => t + i.n * (GOODS[i.id] || MATERIALS[i.id]).base, 0) + r.gold;
for (const r of RECIPES.filter(r => r.out.kind === 'use')) {
  const v = USES[r.out.id].price * r.out.n, c = cost(r);
  ok(c <= v && c >= v * .25, r.id + ': inputs and fee ' + c + 'g against ' + v + 'g at the shop price (not above, not under a quarter)');
}
for (const r of RECIPES.filter(r => r.out.kind === 'gear')) {
  const g = CRAFT_GEAR[r.out.id], c = cost(r);
  ok(r.gold >= g.ilvl * 5 && c <= g.ilvl * 25, r.id + ': fee ' + r.gold + 'g is at least 5g per item level, total ' + c + 'g stays under 25g per item level');
}
const caps = [6, 11, 16, 21];
ok(RECIPES.filter(r => r.out.kind === 'gear').every(r => CRAFT_GEAR[r.out.id].ilvl <= caps[Math.min(3, r.band)]), 'crafted gear item level stays within its band (no power spike)');
ok(RECIPES.filter(r => r.out.kind === 'gear').every(r => CRAFT_GEAR[r.out.id].quality === 'fine' || r.band >= 3), 'rare gear only from the top bands');
// materials
const kinds = ['herb', 'ore', 'hide', 'fish'];
ok(Object.values(MATERIALS).every(m => kinds.includes(m.kind) && m.band >= 0 && m.band <= 3 && m.base >= 1), 'every material has a node kind (herb, ore, hide, fish) and a band');
ok(kinds.every(k => Object.values(MATERIALS).some(m => m.kind === k)), 'every node kind yields at least one material');
ok(Object.keys(MATERIALS).every(m => RECIPES.some(r => r.inputs.some(i => i.id === m))), 'every material is used by a recipe');
ok(Object.keys(MAT_DROPS).every(k => MOBS[k] && MATERIALS[MAT_DROPS[k].id] && MAT_DROPS[k].p > 0 && MAT_DROPS[k].p <= .4), 'creature material drops name a real creature and material, chance at most 40%');
ok(Object.keys(MATERIALS).every(n => price(n) >= 1 && price(n) <= MATERIALS[n].base * 1.8), 'material prices go through price() and are sane');
const dearest = Math.max(...Object.keys(GOODS).map(n => GOODS[n].base));
ok(Object.keys(MATERIALS).every(n => MATERIALS[n].base <= dearest), 'no material is dearer than the dearest trade good');
ok(!Object.keys(GOODS).some(n => MATERIALS[n]) && !Object.keys(MATERIALS).some(n => USES[n]), 'material, trade good and consumable names do not collide');
ok(RECIPE_BY_ID['forge-ashsteel'].prof === 'smithing', 'the smith (#13) reads this same table');
console.log(fail ? '\n' + fail + ' check(s) FAILED' : '\nAll recipe checks passed');
process.exit(fail ? 1 : 0);
