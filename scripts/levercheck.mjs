// Lever check (issue #77): the DM's world levers (src/sim/levers.js) are validated, limited and
// reversible, and cannot touch what they must not. Proves that:
//   - every lever applies with legal parameters, has its effect in the sim, and expires (undone);
//   - limits (max active, per game day, per region per day) and cooldowns reject;
//   - out-of-band levels, non-walkable tiles, spots by a town gate, unknown parameters, a missing
//     reason or an unknown caller reject, and every rejection is logged with its reason;
//   - the stubs (custom_foe, create_site, start_event, nudge_relation) say "not available yet"
//     until another system provides them;
//   - forbidden effects are impossible by construction: register() refuses a lever whose params
//     name HP, XP, stats, class, loot, life or death, and pulling every lever leaves every hero's
//     numbers exactly as they were;
//   - with no marks or conditions the world's hooks are identities that roll no dice, and a seeded
//     run is deterministic (two child runs print the same fingerprint);
//   - lever state is plain JSON on S and survives snapshot -> JSON -> restore unchanged.
// Usage: npm run levercheck
// Internal: node scripts/levercheck.mjs --fp   (prints a fingerprint of a short seeded run)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if (process.argv[2] === '--fp') {
  let s = 4242; Math.random = () => {s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296};
  const {init, step, S} = await import('../src/sim/index.js');
  init(); for (let i = 0; i < 12 * 3600; i++) step(1 / 60);
  console.log(JSON.stringify({t: S.gameMin, uid: S.uid, lv: S.levers.stats, places: S.places.length, w: S.wanderers.length, a: S.agents.map(a => [a.id, a.state, a.lvl, a.xp, Math.round(a.x * 100), Math.round(a.y * 100), Math.round(a.hp), a.gold])}));
  process.exit(0);
}

const {init, setDmSeat, step, S, snapshot, restore} = await import('../src/sim/index.js');
const L = await import('../src/sim/levers.js');
const {pull, register, provide, LEVERS, leverTick, leverMenu, encRate, encKind, encSpot, sightLever, presence, attitudeOf, attitudeDc, spotErr} = L;
const {tiles, I, CITY, ZONES, REGIONS, zoneAt, dist} = await import('../src/world/map.js');
const {W, H, ROAD, WALKABLE} = await import('../src/world/tiles.js');
const {GOODS, price} = await import('../src/data/items.js');
const {sightMul} = await import('../src/sim/weather.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const by = {by: 'agent', reason: 'levercheck'};
const leverLog = () => {let n = 0; for (const e of S.dmLog) if (e.kind === 'lever') n += e.id; return n}; // id-sum survives the 200-entry cap
const leverSeq = () => S.dmLogSeq || 0;

init(); setDmSeat(true); for (let i = 0; i < 4 * 3600; i++) step(1 / 60); // one game day, so towns, npcs and heroes exist
// Start from a clean lever slate (the scripted DM may have pulled some already).
S.levers = null; S.places = []; S.marks = []; S.conditions = []; S.wanderers = []; L.ensureLevers();
const advance = m => {S.gameMin += m};
const tick = () => leverTick(0);

// Legal spots per region: walkable, off the roads, clear of towns; and a road spot per region.
const spots = ZONES.map(() => []), roads = ZONES.map(() => []);
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {const p = {x: x + .5, y: y + .5};
  if (spotErr(p)) continue; const z = zoneAt(p.x, p.y); if (z < 0) continue; (tiles[I(x, y)] === ROAD ? roads : spots)[z].push(p)}
const far = (list, n) => {const out = []; for (const p of list) {if (out.every(q => dist(p, q) > 12)) out.push(p); if (out.length >= n) break} return out};
const S0 = far(spots[0], 6), S1 = far(spots[1], 6);
const bad = (() => {for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) if (!WALKABLE.includes(tiles[I(x, y)])) {const p = {x: x + .5, y: y + .5}; if (!CITY.some(c => dist(p, c.gate) < 10) && zoneAt(p.x, p.y) >= 0) return p} return null})();
ok(S0.length >= 4 && S1.length >= 4 && roads[0].length > 0 && bad, `found legal spots (${spots[0].length} in ${ZONES[0]}, ${spots[1].length} in ${ZONES[1]}), road tiles and a non-walkable tile`);

// ---- forbidden by construction ----
console.log('\nforbidden effects');
for (const k of ['hp', 'xp', 'stats', 'cls', 'loot', 'item', 'revive', 'kill']) {let threw = false; try {register({name: 'evil_' + k, params: {[k]: {type: 'int'}}, apply: () => ({ok: true})})} catch (e) {threw = true} ok(threw && !LEVERS['evil_' + k], `register() refuses a lever with a '${k}' parameter`)}
{let threw = false; try {register({name: 'xp', params: {}, apply: () => ({ok: true})})} catch (e) {threw = true} ok(threw, 'register() refuses a lever named xp')}
ok(Object.values(LEVERS).every(d => Object.keys(d.params).every(k => !/^(hp|maxhp|xp|stats?|cls|class|gold|loot|epic|gear|lvl)$/.test(k) || (k === 'item' && ['give_item', 'take_item'].includes(d.name)) || (k === 'lvl' && ['mark_dangerous', 'mark_cleared', 'named_foe', 'custom_foe'].includes(d.name)))), 'no lever parameter names a hero number (lvl only as a monster or area level)');
const heroNums = () => JSON.stringify(S.agents.map(a => [a.id, a.hp, a.xp, a.lvl, a.cls, a.state, a.gold, a.honor, a.gear, (a.epics || []).length, JSON.stringify(a.abil || null), JSON.stringify(a.eq || null)]));
const before = heroNums();

// ---- each lever applies, works and expires ----
console.log('\neach lever');
const hero = S.agents.find(a => a.state !== 'dead'), town = CITY[0], tz = zoneAt(town.gate.x, town.gate.y);
let n0 = leverSeq(), pulls = 0; const pull0 = pull; const countPull = (...a) => {pulls++; return pull0(...a)};
let r = pull('create_npc', {role: 'hermit', home: 'camp', at: S0[0], attitude: 'hostile', hours: 6}, by);
const w = r.ret; ok(r.ok && S.wanderers.includes(w) && w.attitude === 'hostile', `create_npc: ${w && w.title} ${w && w.name} camps in ${ZONES[0]} (${JSON.stringify(r.effect)})`);
ok(attitudeOf(w, [hero]) === 'hostile' && attitudeDc(null, w, [hero]).dc === 3, 'a hostile wanderer raises a nearby social DC by 3');
advance(61); r = pull('create_npc', {role: 'minstrel', home: 'town', town: town.name, spot: 'square', hours: 6}, by); const w2 = r.ret;
ok(r.ok && w2.town === town.name, `create_npc: a minstrel visits ${town.name} (after the hour's cooldown in the region)` + (r.ok ? '' : ' -- ' + r.reason));
for (let i = 0; i < 50; i++) leverTick(.2); ok(S.wanderers.every(x => Number.isFinite(x.x) && dist(x, x.home) < 2), 'wanderers stroll near home');
r = pull('retire_npc', {npc: w2.id}, by); ok(r.ok && !S.wanderers.includes(w2) && !L.activeOf('create_npc').some(x => x.id === w2.lever), 'retire_npc: the minstrel leaves and frees its slot');
r = pull('retire_npc', {npc: S.npcs[0].id}, by); ok(!r.ok && /townsfolk/.test(r.reason), 'retire_npc refuses townsfolk: ' + r.reason);
const npc = S.npcs.find(p => p.town === town.name);
r = pull('set_attitude', {npc: npc.id, to: 'hero', id: hero.id, attitude: 'friendly', hours: 2}, by);
ok(r.ok && attitudeOf(npc, [hero]) === 'friendly' && attitudeDc(npc.title + ' ' + npc.name, null, [hero]).dc === -2, 'set_attitude: friendly toward a hero lowers the giver’s DC by 2');
r = pull('set_attitude', {npc: npc.id, to: 'faction', id: hero.fac, attitude: 'hostile', hours: 2}, by);
ok(r.ok && attitudeOf(npc, [hero]) === 'hostile', 'set_attitude: hostile toward the faction wins over friendly toward the hero');
r = pull('mark_place', {kind: 'watchtower', at: S0[1], hours: 12}, by); const pl = r.ret;
ok(r.ok && S.places.includes(pl) && pl.z === 0, `mark_place: ${pl && pl.name}`);
r = pull('mark_dangerous', {at: S0[2], r: 5, lvl: 4, hours: 3}, by);
ok(r.ok && S.marks.some(m => m.kind === 'danger') && encRate() > 1, `mark_dangerous: encounter rate x${encRate()}`);
{let calls = 0; const rr = () => {calls++; return 0}; const inside = roads[0].find(p => dist(p, S0[2]) <= 5);
  if (inside) ok(encKind(inside, 'merchant', rr) === 'ambush', 'mark_dangerous: an encounter on its road turns to an ambush');
  ok(encSpot(roads[0], rr) !== undefined, 'mark_dangerous: encSpot answers while a danger area is marked')}
{const mob0 = S.mobs.length; S.levers.ecoT = 0; leverTick(0); ok(S.mobs.filter(m => m.lever === r.id && !m.gone).length > 0, `mark_dangerous: ${S.mobs.filter(m => m.lever === r.id && !m.gone).length} of the region's monsters gather (${S.mobs.length - mob0} spawned)`)}
const dangerId = r.id;
r = pull('mark_cleared', {at: S1[0], r: 4, hours: 3}, by);
{const inside = roads[1].find(p => dist(p, S1[0]) <= 4); ok(r.ok && (!inside || encKind(inside, 'ambush', () => {throw new Error('dice')}) === 'shrine'), 'mark_cleared: an ambush on its road turns to a shrine, no dice')}
const sm0 = sightMul(1);
r = pull('set_condition', {region: 1, kind: 'fogbound', strength: 2, hours: 4}, by);
ok(r.ok && sightMul(1) < sm0 && sightLever(1) === .7, `set_condition fogbound: ${ZONES[1]} sight x${sightLever(1)}`);
r = pull('set_condition', {region: tz, kind: 'festival', strength: 2, hours: 4}, by);
ok(r.ok && presence(town.name) === 2, `set_condition festival: ${town.name} townsfolk greet x${presence(town.name)}`);
r = pull('set_condition', {region: tz, kind: 'plague', hours: 4}, by); ok(!r.ok && /already/.test(r.reason), 'set_condition: one condition per region: ' + r.reason);
const good = Object.keys(GOODS).sort((a, b) => GOODS[a].supply - GOODS[b].supply)[0], p0 = price(good);
r = pull('price_shock', {good, direction: 'down', size: 3, hours: 2}, by); tick();
ok(r.ok && price(good) < p0, `price_shock down: ${good} ${p0} -> ${price(good)}`);
const open0 = S.adventures.filter(h => h.phase === 'open' && h.town === town.name).length;
r = pull('post_hook', {town: town.name, tpl: 'relic', giver: 'priest', target: pl.id, reward: 'generous'}, by); const hk = r.ret;
ok(r.ok && hk && hk.phase === 'open' && hk.data.place === pl.name && hk.data.payMul === 1.25 && S.adventures.filter(h => h.phase === 'open' && h.town === town.name).length === open0 + 1, `post_hook: '${hk && hk.tpl}' at ${town.name} pointing at ${pl.name}`);
r = pull('post_hook', {town: town.name, tpl: 'fallen'}, by); ok(!r.ok, 'post_hook: only the world posts a recovery for the fallen');
r = pull('withdraw_hook', {hook: hk.id}, by); ok(r.ok && !S.adventures.includes(hk), 'withdraw_hook: the job comes down');
r = pull('named_foe', {type: Object.keys((await import('../src/data/mobs.js')).MOBS)[0], region: 0, lvl: 3, name: 'Testfang'}, by); ok(!r.ok && /adventure/.test(r.reason), 'named_foe needs a running adventure: ' + r.reason);
{const k = S.dmLog.filter(x => x.kind === 'lever' && x.id > n0).length; ok(k === 17, `every pull (17) wrote a lever entry to the DM log (${k})`)}
const e = S.dmLog.find(x => x.kind === 'lever' && x.detail.lever === 'price_shock');
ok(e && e.detail.reason === 'levercheck' && e.detail.params.good === good && e.detail.result === 'applied' && e.detail.until > S.gameMin, 'a lever entry carries params, reason, result and until');
ok(heroNums() === before, 'every lever pulled: every hero’s HP, XP, level, class, gold, gear and scores unchanged');
ok(leverMenu().length === Object.keys(LEVERS).length && leverMenu().every(m => m.params && m.limits), `leverMenu lists ${leverMenu().length} levers with schemas and limits`);

// ---- save round-trip with lever state on S ----
console.log('\nsave');
{const A = JSON.parse(JSON.stringify(snapshot())); ok(A.levers && A.places.length && A.wanderers.length && A.marks.length && A.conditions.length, 'lever state is in the snapshot');
  restore(A); const B = JSON.parse(JSON.stringify(snapshot())); ok(JSON.stringify(A) === JSON.stringify(B), 'snapshot -> restore -> snapshot is unchanged');
  ok(L.activeOf('price_shock').length === 1 && S.wanderers.length === 1, 'active levers and wanderers come back')}
const plId = pl.id, npcId = npc.id, heroId = hero.id; const plNow = () => S.places.find(x => x.id === plId), npcNow = () => S.npcs.find(x => x.id === npcId), heroNow = () => S.agents.find(x => x.id === heroId);

// ---- expiry ----
console.log('\nexpiry');
advance(7 * 60); tick();
ok(!S.wanderers.length, 'create_npc expires: the hermit leaves');
ok(!S.marks.length && !S.mobs.some(m => m.lever === dangerId && !m.gone), 'mark_dangerous and mark_cleared expire; the gathered monsters go');
ok(!S.conditions.length && sightLever(1) === 1 && presence(town.name) === 1, 'conditions expire: sight and greetings back to normal');
ok(!(npcNow().att || []).length && attitudeOf(npcNow(), [heroNow()]) === 'neutral', 'attitudes expire');
ok(!L.activeOf('price_shock').length, 'price_shock expires (supply drifts back with the market)');
ok(!!plNow(), 'a place outlives a 7h step (12h marker)'); advance(6 * 60); tick(); ok(!plNow(), 'mark_place expires: the marker is gone');
ok(S.levers.active.length === 0, 'nothing left active');

// ---- validation ----
console.log('\nvalidation');
const rej = (name, p, re, label, o = by) => {const x = pull(name, p, o), e = S.dmLog[0]; ok(!x.ok && re.test(x.reason) && e.kind === 'lever' && /^rejected/.test(e.detail.result), `${label}: "${x.reason}" (logged)`)};
rej('mark_place', {kind: 'ruin', at: bad}, /walkable/, 'non-walkable tile');
rej('mark_place', {kind: 'ruin', at: {x: town.gate.x + 1, y: town.gate.y}}, /gate|inside/, 'next to a town gate');
rej('mark_place', {kind: 'ruin', at: {x: -3, y: 4}}, /off the map/, 'off the map');
rej('mark_dangerous', {at: S0[3], lvl: 20}, /outside Thornvale/, 'out-of-band level 20 in ' + ZONES[0]);
{const x = pull('mark_dangerous', {at: S0[3], lvl: 8, hours: 2}, by); ok(x.ok && x.effect.lvl === REGIONS[0].band[1] + 2 && x.effect.clamped, `a level just over the band is clamped (8 -> ${x.effect ? x.effect.lvl : x.reason})`)}
rej('mark_place', {kind: 'tavern', at: S0[4]}, /kind must be/, 'unknown enum value');
rej('mark_place', {kind: 'ruin', at: S0[4], colour: 'red'}, /unknown parameter/, 'unknown parameter');
rej('set_condition', {region: 'Atlantis', kind: 'plague'}, /region/, 'unknown region');
rej('set_condition', {region: 1, kind: 'plague', strength: 9}, /strength must be/, 'strength out of range');
rej('mark_place', {kind: 'ruin', at: S0[4]}, /reason/, 'missing reason', {by: 'agent', reason: ' '});
rej('mark_place', {kind: 'ruin', at: S0[4]}, /caller/, 'unknown caller', {by: 'god', reason: 'because'});
rej('teleport_hero', {}, /no such lever/, 'unknown lever');
for (const st of ['create_site', 'nudge_relation']) rej(st, {}, /not available yet/, st + ' stub');
provide('createSite', (p) => ({ok: true, effect: {stub: p.theme}}));
{const x = pull('create_site', {theme: 'test', region: 0, band: 3}, by); ok(x.ok && x.effect.stub === 'test', 'a stub works once its system provides an implementation')}
// start_event (#335): festival and plague as timed region conditions
{await import('../src/sim/events.js'); S.levers.cd = {}; S.levers.day = {}; S.conditions = [];
  rej('start_event', {kind: 'earthquake', region: 0}, /unknown event kind.*invasion/, 'start_event unknown kind');
  const n0 = S.chronicle.length, g0 = S.gameMin, x = pull('start_event', {kind: 'festival', region: 0}, by);
  ok(x.ok && x.until === Math.round(g0 + 3 * 1440) && S.conditions.some(c => c.kind === 'festival' && c.z === 0 && c.str === 1), 'festival runs 3 game days as a region condition');
  ok(S.chronicle[0].parts.join('').includes('festival') && S.chronicle.length >= n0, 'a chronicle line at the start: ' + S.chronicle[0].parts.join(''));
  rej('start_event', {kind: 'plague', region: 0}, /limit|already|cooldown/, 'start_event limit holds');
  S.gameMin = x.until + 1; leverTick(1);
  ok(!S.conditions.some(c => c.kind === 'festival'), 'the festival ends');
  S.levers.cd = {}; S.levers.day = {}; const y = pull('start_event', {kind: 'plague', region: 1, scale: 3}, by);
  ok(y.ok && y.until === Math.round(S.gameMin + 9 * 1440) && S.conditions.some(c => c.kind === 'plague' && c.str === 3), 'plague at scale 3 runs 9 days, strength 3');
  rej('start_event', {kind: 'plague', region: 2, scale: 4}, /scale must be/, 'scale capped at 3');
  S.gameMin = y.until + 1; leverTick(1); S.conditions = []; S.levers.cd = {}; S.levers.day = {};
  for (const [k, cond, word] of [['migration', 'migration', 'herds'], ['invasion', 'bandits', 'Raiders']]) {
    S.levers.cd = {}; S.levers.day = {}; S.conditions = []; const t0 = S.gameMin, r = pull('start_event', {kind: k, region: 2}, by);
    ok(r.ok && r.until === Math.round(t0 + 3 * 1440) && S.conditions.some(c => c.kind === cond && c.z === 2), k + ' runs 3 game days as the ' + cond + ' condition' + (r.ok ? '' : ' -- ' + r.reason));
    ok(S.chronicle[0].parts.join('').includes(word), k + ' chronicle line');
    S.gameMin = r.until + 1; leverTick(1); ok(!S.conditions.some(c => c.kind === cond), k + ' ends and clears its condition')}
  S.levers.cd = {}; S.levers.day = {}; S.conditions = [];}
// custom_foe: the bestiary's customFoe, inside its tweak budget and per-region cap
{const {MOBS} = await import('../src/data/mobs.js'); const base = Object.keys(MOBS).find(k => MOBS[k].z === 0 && !k.includes('@'));
  S.levers.cd = {}; const x = pull('custom_foe', {base, region: 0, at: S0[5], name: 'Old Testfang', levels: 1}, by), m = x.ok && x.ret;
  ok(x.ok && m.name === 'Old Testfang' && dist(m, S0[5]) < .01 && m.lever === x.id, `custom_foe: ${m && m.name} (L${m && m.lvl}, ${x.effect && x.effect.points} tweak points) stands at the spot` + (x.ok ? '' : ' -- ' + x.reason));
  rej('custom_foe', {base, region: 0, at: S0[4], levels: 3}, /levels must be/, 'custom_foe over the level tweak');
  rej('custom_foe', {base, region: 1, at: S0[4]}, /outside Mirefen/, 'custom_foe placed outside its region');
  advance(31); const y = pull('custom_foe', {base, region: 0, at: S0[4], levels: 2, swap: {pair: ['nope', 'nope']}}, by); ok(!y.ok, 'custom_foe: the bestiary refuses a bad swap: ' + y.reason);
  advance(31); ok(pull('custom_foe', {base, region: 0, at: S0[4]}, by).ok, 'custom_foe: a second in the region');
  advance(31); rej('custom_foe', {base, region: 0, at: S0[3]}, /per region per game day|special foes today/, 'custom_foe: the region cap');}

// ---- give_item / take_item (issue #524) ----
console.log('\ngive_item and take_item');
{const inv = await import('../src/sim/inv.js'), {QUEST_ITEMS, USES, EPICS} = await import('../src/data/items.js');
  const h = S.agents.find(a => a.kind === 'hero' && a.state !== 'dead' && a.slots); h.state = 'town'; h.lvl = Math.max(h.lvl, 6);
  const pn = S.npcs[0]; const home = {x: pn.x, y: pn.y}; h.x = pn.x + 1; h.y = pn.y; S.levers.day = {}; S.levers.cd = {};
  const q = Object.keys(QUEST_ITEMS)[0], u = Object.keys(USES).find(k => USES[k].kind === 'potion');
  rej('give_item', {hero: h.id, item: 'Nonesuch'}, /unknown item/, 'give_item: an unknown id');
  rej('give_item', {hero: h.id, item: EPICS[0][0]}, /epic/, 'give_item: never an epic');
  rej('give_item', {hero: 999999, item: q}, /no such living hero/, 'give_item: no such hero');
  rej('give_item', {hero: h.id, item: 'chest', ilvl: h.lvl + 1}, /above/, 'give_item: gear above the hero’s level');
  h.state = 'fight'; rej('give_item', {hero: h.id, item: q}, /in a fight/, 'give_item: not in a fight'); h.state = 'town';
  h.x = home.x + 30; h.y = home.y; rej('give_item', {hero: h.id, item: q, by: pn.id}, /earshot/, 'give_item: the giver is out of earshot'); h.x = home.x + 1; h.y = home.y;
  rej('give_item', {hero: h.id, item: q, by: 999999}, /no such person/, 'give_item: no such giver');
  let x = pull('give_item', {hero: h.id, item: q, by: pn.id}, by);
  ok(x.ok && inv.has(h, q) && x.effect.by === ((pn.title ? pn.title + ' ' : '') + pn.name), 'give_item: a person hands over a quest item: ' + JSON.stringify(x.effect));
  rej('give_item', {hero: h.id, item: q}, /already carries/, 'give_item: a quest item is not given twice');
  x = pull('give_token', {hero: h.id, token: 'Not A Token'}, by); ok(!x.ok, 'give_token is folded in: an unknown token is still refused');
  x = pull('take_item', {hero: h.id, item: q, by: pn.id}, by); ok(x.ok && !inv.has(h, q), 'take_item: a person takes the quest item back');
  x = pull('give_token', {hero: h.id, token: q}, by); ok(x.ok && inv.has(h, q), 'give_token still works, as give_item (found where the hero stands: ' + x.effect.by + ')');
  x = pull('take_token', {hero: h.id, token: q}, by); ok(x.ok && !inv.has(h, q), 'take_token still works, as take_item');
  x = pull('give_item', {hero: h.id, item: u}, by); ok(x.ok && inv.count(h, u) >= 1, 'give_item: a consumable (' + u + ')');
  rej('take_item', {hero: h.id, item: u}, /only a quest item/, 'take_item: not a consumable');
  rej('take_item', {hero: h.id, item: 'head'}, /gear/, 'take_item: not gear');
  S.levers.day = {}; const gold0 = h.gold, g0 = inv.spares(h).length;
  x = pull('give_item', {hero: h.id, item: 'head', ilvl: h.lvl}, by); const sp = inv.spares(h);
  ok(x.ok && sp.length === g0 + 1 && sp[sp.length - 1].ilvl === h.lvl && !sp[sp.length - 1].epic && h.gold === gold0, 'give_item: one plain gear piece at the hero’s level, not an epic');
  rej('give_item', {hero: h.id, item: 'feet'}, /gear piece per game day/, 'give_item: one gear piece a day');
  S.levers.day = {}; ok(pull('give_item', {hero: h.id, item: 'feet'}, by).ok, 'give_item: gear again the next day');
  S.levers.day = {}; for (let i = 0; i < 4; i++) pull('give_item', {hero: h.id, item: u}, by);
  rej('give_item', {hero: h.id, item: u}, /per game day|full/, 'give_item: 4 a game day');
  ok(pull('give_item', {hero: h.id, item: u}, by).ok === false && S.dmLog[0].detail.lever === 'give_item', 'the refusal is in the DM log');
  inv.take(h, 'use', u, inv.count(h, u));}

// ---- limits and cooldowns ----
console.log('\nlimits and cooldowns');
S.levers = null; S.places = []; S.marks = []; S.conditions = []; S.wanderers = []; L.ensureLevers(); L.ensureLevers();
ok(pull('mark_place', {kind: 'shrine', at: S1[1]}, by).ok, 'mark_place in ' + ZONES[1]);
rej('mark_place', {kind: 'shrine', at: S1[2]}, /cooldown/, 'cooldown in the same region');
ok(pull('mark_place', {kind: 'shrine', at: S0[0]}, by).ok, 'the cooldown is per region: ' + ZONES[0] + ' is free');
advance(61); ok(pull('mark_place', {kind: 'ruin', at: S1[2]}, by).ok, 'after the cooldown, a second place in ' + ZONES[1]);
advance(61); rej('mark_place', {kind: 'ruin', at: S1[3]}, /per region per game day/, 'third place in one region in one day');
ok(pull('mark_place', {kind: 'camp', at: S0[1]}, by).ok, 'fourth place of the day elsewhere');
advance(61); rej('mark_place', {kind: 'camp', at: S0[2]}, /per game day/, 'fifth place in one day');
// max active: price shocks last past the day; the cooldown is waited out between them
S.levers.cd = {}; ok(pull('price_shock', {good: Object.keys(GOODS)[1], direction: 'down', hours: 24}, by).ok, 'price_shock 1');
advance(241); ok(pull('price_shock', {good: Object.keys(GOODS)[2], direction: 'down', hours: 24}, by).ok, 'price_shock 2');
advance(241); rej('price_shock', {good: Object.keys(GOODS)[3], direction: 'up'}, /already active/, 'a third price shock while two are active');
rej('price_shock', {good: Object.keys(GOODS)[1], direction: 'up'}, /already|cooldown/, 'the same good twice');
ok(L.ready('mark_place', 1) === false && L.ready('mark_cleared', 1) === true, 'ready() answers quietly for the scripted DM');

// ---- the world's hooks without levers: identities, no dice ----
console.log('\nno levers, no change');
S.levers = null; S.places = []; S.marks = []; S.conditions = []; S.wanderers = []; L.ensureLevers();
{const dice = () => {throw new Error('rolled')}; let threw = false;
  try {ok(encRate() === 1 && encSpot(roads[0], dice) === null && encKind(roads[0][0], 'ambush', dice) === 'ambush' && encKind(roads[0][0], 'chest', dice) === 'chest', 'encounter hooks are identities')} catch (e) {threw = true}
  ok(!threw, 'encounter hooks roll no dice with no marks or conditions');
  ok(ZONES.every((_, z) => sightLever(z) === 1) && CITY.every(c => presence(c.name) === 1), 'sight and townsfolk hooks are identities');
  ok(S.npcs.every(p => attitudeOf(p, [hero]) === 'neutral') && attitudeDc('nobody', null, [hero]).dc === 0, 'no attitudes: social DCs unchanged')}
const fp = () => {const c = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fp'], {encoding: 'utf8'}); return c.status === 0 ? c.stdout.trim() : 'ERR ' + c.stderr.slice(0, 300)};
{const a = fp(), b = fp(); ok(a === b && !a.startsWith('ERR'), 'two seeded 12-minute runs (scripted DM pulling levers) are identical'); try {const j = JSON.parse(a); console.log('       seeded run: pulled ' + JSON.stringify(j.lv.pulled) + ', rejected ' + JSON.stringify(j.lv.rejected))} catch (e) {console.log('       ' + a)}}

// the world keeps running with lever state in it
for (let i = 0; i < 3600; i++) step(1 / 60); ok(S.agents.some(a => a.state !== 'dead'), 'the world runs on');

console.log(fail ? `\n${fail} check(s) failed` : '\nlevercheck: all checks passed');
process.exit(fail ? 1 : 0);
