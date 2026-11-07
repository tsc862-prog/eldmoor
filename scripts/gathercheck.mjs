// Gathering check (issue #257, epic #238): the agent tools recipes, learn_profession, unlearn_profession, nodes and
// gather through playerAct (refusals that say what to do), a gather that walks to a node, works it, puts a material in
// the pack, raises the skill and spends the node; a spent or out-of-sight node refused; materials selling at the
// auction house; scripted heroes taking up a trade and gathering at a low rate (never an agent-played hero);
// determinism and a save round trip.
// Usage: npm run gathercheck   |   node scripts/gathercheck.mjs --hash  (the seeded scripted world hash)
let seed = 0x3a4e5 ^ 11;
const reseed = s => {seed = s};
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, markPlayer, playerAct, snapshot, restore} = SIM;
const hashWorld = () => {let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
  for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(',')); return h};
if (process.argv.includes('--short')) {
  reseed(0x3a4e5 ^ 11); init({fellowship: false}); const b = S.agents.find(x => x.fac === 1 && x.state !== 'dead'); SIM.markPlayer(b, true);
  for (let i = 0; i < 10 * 60 * 60; i++) step(1 / 60);
  console.log(hashWorld() + ' ' + ((S.gatherStats || {}).got || 0)); process.exit(0);
}
if (process.argv.includes('--hash')) {
  for (const f of [false, true]) {reseed(0x3a4e5 ^ 11); init({fellowship: f}); for (let i = 0; i < 600 * 60; i++) step(1 / 60);
    console.log('hash fellowship=' + f + ': ' + hashWorld())}
  process.exit(0);
}
const {NODES, nodeById, readyAt} = await import('../src/sim/nodes.js');
const {MATERIALS, price} = await import('../src/data/items.js');
const {GATHER, yieldOf} = await import('../src/sim/gather.js');
const {count, invOf, sellLoot} = await import('../src/sim/inv.js');
const {skillOf} = await import('../src/sim/professions.js');
const {homeOf} = await import('../src/sim/party.js').catch(() => ({}));
const {CITY, dist} = await import('../src/world/map.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const call = (a, t, x) => {a.playRate = []; return playerAct(a.id, t, x || {})}; // the check is not about the hourly action limit
console.log('\nEldmoor gathercheck\n');

reseed(0x3a4e5 ^ 11); init({fellowship: false});
const a = S.agents.find(x => x.fac === 0 && x.state !== 'dead');
markPlayer(a, true); a.profs = [];
const home = CITY.find(c => c.fac === a.fac);
const toTown = () => {a.state = 'town'; a.x = home.ah.x; a.y = home.ah.y; a.pq = []; a.target = null};
const toField = (x, y) => {a.state = 'hunt'; a.x = x; a.y = y; a.pq = []; a.target = null; a.dest = null};
// keep the test hero out of harm's way: nothing hunts it while it gathers
const calm = () => {for (const m of S.mobs) if (dist(m, a) < 20) {m.target = null} a.hp = 1e6};

console.log('tools');
let r = call(a, 'recipes');
ok(r.ok && r.professions.length === 0 && /learn_profession/.test(r.hint) && r.learnable.length === 9, 'recipes with no profession: a hint and nine learnable');
r = call(a, 'recipes', {profession: 'Smithing'});
ok(r.ok && r.recipes[0].kind === 'crafting' && r.recipes[0].recipes.every(x => /learn it first/.test(x.you)), 'recipes for a profession not held (smithing): its recipes, "learn it first"');
r = call(a, 'recipes', {profession: 'basketry'});
ok(!r.ok && /no profession called/.test(r.error), 'recipes for an unknown profession is refused');
toField(NODES[0].x, NODES[0].y);
r = call(a, 'learn_profession', {id: 'herbalism'});
ok(!r.ok && /Trainers teach in town/.test(r.error), 'learn_profession out of town is refused: ' + r.error);
toTown();
r = call(a, 'learn_profession', {id: 'Herbalism'});
ok(r.ok && r.learned === 'Herbalism' && skillOf(a, 'herbalism') === 1, 'learn_profession by name in town: skill 1');
r = call(a, 'learn_profession', {id: 'herbalism'});
ok(!r.ok && /already know Herbalism/.test(r.error), 'a duplicate is refused');
r = call(a, 'learn_profession', {id: 'miner'});
ok(r.ok && r.learned === 'Mining', 'learn_profession by alias ("miner")');
r = call(a, 'learn_profession', {id: 'fishing'});
ok(!r.ok && /already hold 2 professions/.test(r.error) && /unlearn_profession/.test(r.error), 'a third is refused with the way on: ' + r.error);
r = call(a, 'learn_profession', {id: 'knitting'});
ok(!r.ok && /no profession called/.test(r.error) && /herbalism/.test(r.error), 'an unknown profession is refused with the list');
r = call(a, 'unlearn_profession', {id: 'mining'});
ok(r.ok && r.unlearned === 'Mining' && !a.profs.some(p => p.id === 'mining'), 'unlearn_profession frees the slot');
r = call(a, 'unlearn_profession', {id: 'mining'});
ok(!r.ok && /do not know Mining/.test(r.error) && /Herbalism/.test(r.error), 'unlearning one not held is refused, naming yours');
ok(call(a, 'learn_profession', {id: 'mining'}).ok, 'learn mining again');
r = call(a, 'recipes');
ok(r.ok && r.professions.length === 2 && r.professions[0].can_gather.includes('Redroot Leaf') && /2\/2/.test(r.slots) && typeof r.learnable === 'string', 'recipes: both professions, what herbalism gathers, slots 2/2');
r = call(a, 'gather');
ok(!r.ok && /inside the walls/.test(r.error), 'gather in town is refused');
r = call(a, 'nodes');
ok(r.ok && !r.nodes.length && /inside the walls/.test(r.note), 'nodes in town: none, and why');

console.log('gathering');
const herb = NODES.find(n => n.kind === 'herb' && n.band === 0);
ok(!!herb, 'a band-0 herb patch: ' + (herb && herb.id));
toField(herb.x + 3, herb.y); calm();
r = call(a, 'nodes');
ok(r.ok && r.nodes.some(n => n.node === herb.id && n.state === 'ready' && /you can work it/.test(n.you)), 'nodes lists the patch in sight, ready, workable');
r = call(a, 'nodes', {kind: 'sand'});
ok(!r.ok && /herb, ore, hide or fish/.test(r.error), 'nodes with a bad kind is refused');
const mat = yieldOf(herb), had = count(a, mat);
let got = false, tries = 0, sk0 = skillOf(a, 'herbalism');
while (!got && tries < 8) {
  tries++; calm();
  r = call(a, 'gather', {node: herb.id});
  if (!r.ok) {console.error('    ' + r.error); break}
  if (tries === 1) ok(r.material === mat && /game minutes/.test(r.takes), 'gather is queued: ' + r.gathering + ', ' + r.takes);
  let t0 = S.gameMin;
  for (let i = 0; i < 60 * 60 && (a.pq || []).some(c => c.kind === 'gather'); i++) {calm(); step(1 / 60)}
  ok(!(a.pq || []).length, 'try ' + tries + ' finished after ' + Math.round(S.gameMin - t0) + ' game minutes (at least ' + GATHER.MIN + ')');
  got = count(a, mat) > had;
  if (S.gameMin - t0 < GATHER.MIN) fail++;
}
ok(got && dist(a, herb) <= GATHER.REACH + .01, 'the hero walked to the patch and picked ' + mat + ' (x' + (count(a, mat) - had) + ')');
ok(skillOf(a, 'herbalism') > sk0 || (a.profs.find(p => p.id === 'herbalism').skill > sk0), 'herbalism skill rose');
ok(readyAt(herb) > S.gameMin, 'the patch is spent until it grows back');
r = call(a, 'gather', {node: herb.id});
ok(!r.ok && /spent/.test(r.error) && /grows back/.test(r.error), 'a spent patch is refused: ' + r.error);
const far = NODES.find(n => n.kind === 'herb' && dist(n, a) > 30);
r = call(a, 'gather', {node: far.id});
ok(!r.ok && /out of sight/.test(r.error), 'a patch out of sight is refused: ' + r.error);
const hide = NODES.find(n => n.kind === 'hide' && n.band === 0);
toField(hide.x + 1, hide.y); calm();
r = call(a, 'gather', {node: 'hide'});
ok(!r.ok && /Skinning/.test(r.error) && /learn_profession/.test(r.error) && /unlearn_profession/.test(r.error), 'a game trail without skinning: refused, how to learn it');
const hard = NODES.find(n => n.kind === 'ore' && n.band === 3);
toField(hard.x + 1, hard.y); calm();
r = call(a, 'gather', {node: hard.id});
ok(!r.ok && /Too hard/.test(r.error) && /Mining 50/.test(r.error), 'an expert vein is too hard for a novice: ' + r.error);
r = call(a, 'gather', {node: 'basket'});
ok(!r.ok && /not a gathering spot/.test(r.error), 'gather of nonsense is refused');

console.log('selling');
toTown();
const sup = MATERIALS[mat].supply, n0 = count(a, mat), g0 = a.gold;
r = call(a, 'inventory');
ok(r.ok && r.items.some(e => e.item.startsWith(mat) && /crafting material/.test(e.item)), 'inventory shows the material with its price');
const sold = sellLoot(a);
ok(count(a, mat) === 0 && sold.gold >= n0 * price(mat) * .5 && MATERIALS[mat].supply > sup, 'sell: the material goes to the auction house (+' + sold.gold + 'g, supply ' + sup.toFixed(1) + ' -> ' + MATERIALS[mat].supply.toFixed(1) + ')');

console.log('scripted heroes');
reseed(0x3a4e5 ^ 11); init({fellowship: false});
const ag = S.agents.find(x => x.fac === 1 && x.state !== 'dead'); markPlayer(ag, true); ag.profs = [];
for (let i = 0; i < 20 * 60 * 60; i++) step(1 / 60);
const st = S.gatherStats || {};
const days = S.gameMin / 1440, living = S.agents.filter(x => x.state !== 'dead' && !x.player).length;
ok(st.learned > 0 && S.agents.some(x => !x.player && (x.profs || []).length), 'scripted heroes take up a trade (' + st.learned + ')');
ok(st.got > 0 && st.units > 0, 'scripted heroes gather (' + st.tries + ' tries, ' + st.got + ' hauls, ' + st.units + ' units in ' + days.toFixed(1) + ' game days)');
ok(st.tries / Math.max(1, living) / days < 4, 'at a low rate: ' + (st.tries / Math.max(1, living) / days).toFixed(2) + ' tries a hero a game day');
ok(!(ag.profs || []).length && !ag.gathering, 'an agent-played hero is never given a trade or sent gathering by script');
ok(Object.keys(st.byKind || {}).length >= 3, 'several kinds gathered: ' + JSON.stringify(st.byKind));
// determinism: two fresh processes (module tables such as GOODS supply are rolled once per process)
const {execFileSync} = await import('node:child_process');
const run = () => execFileSync(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--short'], {encoding: 'utf8'}).trim();
const h1 = run(), h2 = run();
ok(h1 === h2 && /^\d+ \d+$/.test(h1), 'the seeded world repeats (hash, hauls: ' + h1 + ')');
console.log('save');
const someone = S.agents.find(x => (x.profs || []).length);
const snap = JSON.parse(JSON.stringify(snapshot())), before = JSON.stringify(someone.profs);
MATERIALS['Tin Ore'].supply = 99;
restore(snap);
const back = S.agents.find(x => x.id === someone.id);
ok(back && JSON.stringify(back.profs) === before, 'professions survive a save round trip');
ok(MATERIALS['Tin Ore'].supply === snap.MATS['Tin Ore'].supply, 'material supply survives a save round trip');

console.log('the invitations (#872)');
{ const {hostPace} = await import('../src/sim/player-host.js'), {INVITE, sellsBest} = await import('../src/sim/invite.js'), {memoryNote, talkText} = await import('./pacing.mjs'), {TRADE_AGE, wakeLevelUp} = await import('../src/sim/wakes.js');
  reseed(0x3a4e5 ^ 11); init({fellowship: false});
  const h = S.agents.find(x => x.fac === 0 && x.state !== 'dead'); markPlayer(h, true); h.profs = []; h.reflect = null;
  const town = CITY.find(c => c.fac === h.fac), inTown = () => {h.state = 'town'; h.x = town.ah.x; h.y = town.ah.y; h.pq = []; h.target = null};
  const field = n => {h.state = 'hunt'; h.x = n.x + 3; h.y = n.y; h.pq = []; h.target = null; h.dest = null};
  const turn = async () => {h.playFresh = true; h.reflect = null; return (await hostPace(h.id, {brief: true})).brief}; // what a runner reads after its wake
  const later = m => {S.gameMin += m};
  inTown(); let b = await turn();
  ok(b.invite && b.invite.kind === 'trainer' && /Trainers here teach herbalism, mining/.test(b.invite.text) && /learn_profession/.test(b.invite.text) && talkText(b).includes(b.invite.text), 'in a friendly town the header names the trainers: ' + (b.invite || {}).text);
  b = await turn(); ok(!b.invite, 'the next turn carries no line');
  later(2 * 1440); b = await turn(); ok(!b.invite || b.invite.kind !== 'trainer', 'nor two game days on, still on the same visit');
  let lk = call(h, 'look'); ok(!lk.trainer && /about \d+g, .+ about \d+g/.test(lk.gathered_sells_best), 'look keeps once a visit too, and names the two materials selling best: ' + lk.gathered_sells_best);
  ok(call(h, 'auction_browse').gathered_sells_best === sellsBest(), 'auction_browse says the same');
  const n0 = NODES.find(n => n.kind === 'herb'); field(n0);
  S.gameMin += INVITE.DAY; b = await turn();
  ok(b.invite && b.invite.kind === 'nodes_in_sight' && /an herb patch 3 tiles west \(herbalism\)/.test(b.invite.text) && /you hold no gathering trade/.test(b.invite.text) && b.invite.text.length < 130, 'a node in sight is named, with no trade to work it: ' + (b.invite || {}).text);
  lk = call(h, 'look'); ok(/herb patch/.test(lk.nodes_in_sight) && /no gathering trade/.test(lk.nodes_in_sight), 'look carries nodes_in_sight: ' + lk.nodes_in_sight);
  ok(!(h.profs || []).length && !h.gathering && !(h.pq || []).length, 'the words do nothing: no trade learned, no gathering begun');
  b = await turn(); ok(!b.invite, 'not again for days to a hero with no trade');
  const far = NODES.reduce((w, n) => {const d = Math.min(...NODES.filter(x => x !== n).map(x => dist(x, n))); return d > w.d ? {n, d} : w}, {n: null, d: 0}).n;
  ok(far, 'a spot stands apart'); h.x = far.x + 40; const empty = call(h, 'look'); ok(!empty.nodes_in_sight || !/herb patch 3 tiles/.test(empty.nodes_in_sight), 'out of sight, the spot is not named');
  later(INVITE.DAY); inTown(); await turn(); ok(!(await turn()).invite, 'back in town: told once');
  call(h, 'learn_profession', {id: 'herbalism'}); later(INVITE.DAY); field(n0); b = await turn();
  ok(b.invite && b.invite.node === n0.id && /you can work it \(gather\)/.test(b.invite.text), 'with the trade: you can work it: ' + (b.invite || {}).text);
  later(INVITE.NODE_GAP + 1); b = await turn(); ok(!b.invite || b.invite.node !== n0.id, 'the same spot is not told twice');
  later(INVITE.DAY); inTown(); h.profs = [{id: 'herbalism', skill: 1}, {id: 'alchemy', skill: 1}]; b = await turn(); ok((b.invite || {}).kind !== 'trainer' && !call(h, 'look').trainer, 'two trades held: no trainer line');
  h.state = 'fight'; h.profs = []; later(INVITE.DAY); b = await turn(); ok(!b.invite, 'never in a fight');
  h.state = 'town'; h.lvl = 3; h.profs = []; h.playEv = []; wakeLevelUp(h, 100); ok(h.playEv.some(e => e.text === TRADE_AGE && !e.w) && h.playEv.some(e => e.w === 2), 'level 3 with no trade: the line rides the level-up turn and wakes nothing itself');
  h.profs = [{id: 'mining', skill: 1}]; h.playEv = []; wakeLevelUp(h, 100); ok(!h.playEv.some(e => e.text === TRADE_AGE), 'not for a hero with a trade');
  const sc = S.agents.find(x => !x.player && x.state !== 'dead'), {inviteBrief} = await import('../src/sim/invite.js'); ok(inviteBrief(sc, null) === null, 'a scripted hero is never invited');
  S.gameMin += 0; ok(memoryNote({}) === memoryNote({invite: null}), 'nothing in the header without a line');
}

console.log(fail ? '\n' + fail + ' check(s) FAILED\n' : '\nall gathering checks passed\n');
process.exit(fail ? 1 : 0);
