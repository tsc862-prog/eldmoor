// Tool fuzz (infra): every hero tool (src/data/player-tools.js) and every DM tool (src/data/dm-tools.js) called with
// valid, empty and hostile arguments in many states of the world, on each world in WORLDS. It exists for the bug class
// "a tool run in a state nobody tried" (post_hook crashing on day 1, #910; Kragmaw lost on reload, #937).
//
// Pass = a clean answer or a refusal. Fail =
//   threw      the tool threw (playerAct/dmAct catch it and answer "The world did not understand that (...)" /
//              "The DM tool failed: ..."; both are reported as a throw, with the message)
//   nonobject  no answer, or an answer that is not an object
//   bad-number a NaN or Infinity anywhere in the result, in the caller's hero state, or in the clock
//   bad-text   "undefined", "NaN", "Infinity" or "[object Object]" inside a result's text (an array holding undefined too)
//   no-way-on  a refusal (ok:false) with no text, or one that is only a word or two
//   unlisted   a tool in the table that the game side does not answer ("Unknown tool")
//   step-threw stepping the world after the call threw
//
// States (each world is a child process, because the world is chosen once per process): fresh (a new world before the first
// tick, built directly), fresh-saved (the same after a JSON save and restore), prep (held by the DM's prep), town, field,
// path (mid-path), scene (a Table scene open), crawl (a Crypt crawl room), downed, dead, solo (a hero riding alone), and,
// on `others: none`, fresh, town and field. Every state but fresh is restored from a JSON save before each tool, so every
// one also proves the save round trip. The DM seat is open except in `fresh-noseat`.
// Situations (scripts/toolfuzz-cases.mjs): a live fight, an invitation, an auction listing, a hire (before and after), an honour-duel challenge, a downed
// companion, a downed enemy, a meeting plan, an open vote, a camp, a raid muster, gathering and crafting, a hurt company, a courier's distance, a lone hero at
// the board, the chapel, an oath, a staged scene at the table, a ruling waiting, a companion waiting for its voice, the DM's people. A situation runs the
// acting tools (or the list it names) with its own live recipes first, so each tool's success path runs from the untouched state; it costs about 1.5 s a world.
// Coverage: the last lines of a world say how many tools went through with valid arguments at least once and which never did; more than --max-never N
// (default 8, TOOLFUZZ_MAX_NEVER) is a failure. Known never: choose (needs a pick mid-adventure), dm:nudge_relation (a registered stub, "not available yet").
// After each call that went through, every hero's numbers are checked, not only the caller's.
// Seeded: the world, the arguments and the tool order come from one seed; a failure prints the command that replays it.
//
// Usage: npm run toolfuzz                       all worlds in WORLDS, all states (about 80 s; the worlds run side by side)
//        node scripts/toolfuzz.mjs --world stepping --state downed --tool post_hook --seed 7
//        flags: --seed N (TOOLFUZZ_SEED), --world ID, --state NAME, --tool NAME, --only hero|dm, --sets N (argument sets a tool, default 9), --max-never N, --show [chars], --list
import './seed-first.mjs';
import {spawnSync, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpEnv} from './tmp.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1])};
const SEED = Number(flag('seed', process.env.TOOLFUZZ_SEED)) || 20261105;
const SETS = Math.max(4, Number(flag('sets', 9)) || 9);
const here = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------- parent: one child a world
if (!flag('world')) {
  const {WORLDS} = await import('../src/world/spec.js');
  const ids = Object.keys(WORLDS);
  const outs = await Promise.all(ids.map(id => new Promise(res => {
    const args = [here, '--world', id, ...argv.filter((x, i) => !(x === '--world' || argv[i - 1] === '--world'))];
    const c = spawn(process.execPath, args, {env: {...process.env, ...tmpEnv(), ELDMOOR_WORLD: id}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', code => res({id, code, out}));
  })));
  let bad = 0;
  for (const o of outs) {process.stdout.write(o.out); if (o.code) bad++}
  console.log(bad ? '\nFAIL toolfuzz: ' + bad + ' world(s) with failures (seed ' + SEED + ')' : '\nok   toolfuzz: ' + ids.join(', ') + ' clean (seed ' + SEED + ')');
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- child: one world
const WORLD = flag('world');
process.env.ELDMOOR_WORLD = WORLD;
const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, markPlayer, playerAct, dmAct, setDmSeat, beginPrep, maxHp} = SIM;
const SLT = await import('../src/sim/company.js');
const T = await import('../src/sim/table.js');
const D = await import('../src/sim/dungeon.js');
const INV = await import('../src/sim/inv.js');
const PROF = await import('../src/sim/professions.js');
const {MATERIALS} = await import('../src/data/items.js');
const {goDown} = await import('../src/sim/downed.js');
const {slay} = await import('../src/sim/heroes.js');
const {resetPrep} = await import('../src/sim/prep.js');
const RL = await import('../src/sim/runlink.js');
const SP = await import('../src/sim/spatial.js'); // the sight index is rebuilt by the first tick after a load; a tool called at once needs it
const DR = await import('../src/sim/dmreflex.js');
const MAP = await import('../src/world/map.js');
const {seedRng} = await import('../src/core/rng.js');
const {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
const {DM_TOOLS} = await import('../src/data/dm-tools.js');
const P = await import('../src/sim/player.js');
const LEV = await import('../src/sim/levers.js');
const RESETS = [(await import('../src/sim/chat.js')).resetChatSeed, (await import('../src/sim/npcs.js')).resetNpcSeed, (await import('../src/sim/talk.js')).resetTalkSeed,
  LEV.resetLeverSeed, (await import('../src/sim/staged.js')).resetStagedSeed, T.resetTableSeed].filter(f => typeof f === 'function');

const lcg = n => {let s = (n ^ 0x9e3779b9) >>> 0; return () => {s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296}};
const hash = str => {let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0};
// goDown needs a killer: with none it returns false and nobody is downed
const fell = x => {x.hp = 0; const k = S.mobs.find(m => m.alive && !m.gone) || {kind: 'mob', id: 0, name: 'a wolf', type: 'wolf', lvl: 1}; const ok = goDown(x, k); if (!ok || x.state !== 'downed') throw new Error('fuzz setup: ' + x.name + ' was not downed (' + x.state + ')'); return x};
const safe = v => {try {return JSON.stringify(v)} catch {return String(v && v.name || v)}}; // a log line may hold a live hero (circular): the text of it is what is read
const run = frames => {for (let i = 0; i < frames; i++) step(1 / 60)};
const secs = s => run(Math.round(s * 60));

// ---- states
function reseedAll(n) {seedRng(n); for (const f of RESETS) f()}
function mark(h) {markPlayer(h, true)}
function build(o = {}) { // a fresh world, its Fellowship agent-played, the DM seat open
  resetPrep(); T.TABLE.speed = 1; T.TABLE.mode = 'auto'; RL.setRunnerLinks(null); DR.setDmAlive(null); // no host, no DM runner, unless a situation asks
  init(o.init || {}); if (o.seat !== false) setDmSeat(true);
  const co = SLT.slotted(), M = co ? SLT.slotHeroes(co) : [];
  for (const a of M) mark(a);
  return M[0] || S.agents.find(a => a.kind === 'hero' && a.state !== 'dead');
}
const NONE = {init: {others: 'none'}};
const placeInField = h => {
  const hm = MAP.CITY[h.fac] || MAP.CITY[0], z = MAP.zoneFor(Math.max(2, h.lvl), hm.gate || hm), p = MAP.zonePoint(z, null, hm.gate || hm);
  const co = SLT.slotted(), M = co ? SLT.slotHeroes(co) : [h];
  M.forEach((x, i) => {x.x = p.x + i * .5; x.y = p.y; x.state = 'hunt'; x.hidden = false; x.dest = null; x.pq = []}); return p;
};
const STATES = [
  {name: 'fresh', direct: true, make: () => build()},
  {name: 'fresh-noseat', direct: true, noTrip: true, // a save with the DM seat closed converts on load (a notice in the DM log): not drift
    make: () => build({seat: false})},
  {name: 'fresh-saved', make: () => build()},
  {name: 'fresh-none', direct: true, make: () => build(NONE)},
  {name: 'prep', direct: true, make: () => build(), after: () => {beginPrep('opening')}},
  {name: 'town', make: () => {const h = build(); secs(30); return h}},
  {name: 'rich', make: () => { // a seasoned hero in town with gold, a full pack, a trade and a quest item
    const h = build(); secs(20); h.lvl = 12; h.gold = 5000; h.hp = maxHp(h);
    const hall = MAP.CITY.find(c => c.fac === h.fac) || MAP.CITY[0], M = SLT.slotHeroes(SLT.slotted()); M.forEach((x, i) => {x.x = hall.gate.x + i * .4; x.y = hall.gate.y; x.state = 'town'; x.dest = null; x.pq = []; x.hidden = false});
    for (const id of ['Redroot Draught', 'Linen Bandage', 'Trail Ration', 'Pitch Torch', 'Bogroot Antidote', 'Scroll of Hearthward']) INV.addUse(h, id, 2);
    for (const id of Object.keys(MATERIALS || {}).slice(0, 4)) INV.addGood(h, id, 3);
    INV.addQuest(h, 'Fuzz token', null); try {PROF.learn(h, 'alchemy'); PROF.learn(h, 'herbalism')} catch {}
    return h}},
  {name: 'town-none', make: () => {const h = build(NONE); secs(30); return h}},
  {name: 'field', make: () => {const h = build(); secs(10); placeInField(h); secs(10); return h}},
  {name: 'field-none', make: () => {const h = build(NONE); secs(10); placeInField(h); secs(10); return h}},
  {name: 'path', make: () => {const h = build(); secs(10); const far = MAP.CITY.find(c => c.fac !== h.fac) || MAP.CITY[MAP.CITY.length - 1]; playerAct(h.id, 'move_to', {target: far.name}); secs(3); return h}},
  {name: 'scene', make: () => {const h = build(); secs(10); const p = placeInField(h); for (const m of S.mobs) if (m.alive && !m.gone && !m.elite) {m.x = p.x + 1; m.y = p.y; m.target = h; T.openScene('elite', 'Fuzz scene', ['A brute.'], {mob: m.id}); break} return h}},
  {name: 'crawl', make: () => {const h = build(); secs(10); const M = SLT.slotHeroes(SLT.slotted()); S.mobs.length = 0;
    for (const a of M) {a.lvl = 9; a.hp = maxHp(a); a.state = 'hunt'; a.hidden = false; a.target = null; a.dest = null; a.x = MAP.CRYPT.x + (Math.random() - .5); a.y = MAP.CRYPT.y + 1}
    D.musterCrypt(M, M[0].fac, null, SLT.slotted().name); for (let i = 0; i < 400 && !(S.table && S.table.kind === 'crawl'); i++) step(1 / 60); return h}},
  {name: 'downed', make: () => {const h = build(); secs(10); fell(h); return h}},
  {name: 'dead', make: () => {const h = build(); secs(10); slay(h, S.mobs.find(m => m.alive) || {kind: 'mob', name: 'a wolf', lvl: 1}, {}); return h}},
  {name: 'solo', make: () => {const h = build(); secs(20); const o = S.agents.find(a => a.kind === 'hero' && !a.player && a.state !== 'dead'); mark(o); return o}},
];
// Situations (scripts/toolfuzz-cases.mjs): a fight, an offer, a listing, a hire, a duel challenge, a downed companion, a meeting plan, a vote, a raid muster, ...
const CASES = await (await import('./toolfuzz-cases.mjs')).makeCases({RL, DR, fell, SIM, SLT, INV, PROF, MAP, T, mark, build, secs, run, placeInField, NONE, goDown, MATERIALS});
STATES.push(...CASES.states.map(x => ({...x, lite: true}))); // situations: the acting tools only (the reads are fuzzed in every plain state), fewer hostile sets

// ---- arguments
const REGIONS = () => (MAP.ZONES || []).map(z => typeof z === 'string' ? z : z && z.name).filter(Boolean).slice(0, 4); // ZONES is a list of names
// What the world shows in this state: values read from the read-only tools' answers become the "valid" arguments of the others
// (pack indexes, listing ids, quest ids, node ids, names), so a valid call reaches the code behind the argument check.
function harvest(res, pool, key = '', depth = 0) {
  if (depth > 5 || res == null) return;
  const add = (k, v) => {const L = pool[k] || (pool[k] = []); if (L.length < 30 && !L.includes(v)) L.push(v)};
  if (Array.isArray(res)) {res.slice(0, 12).forEach((x, i) => {if (x && typeof x === 'object') add('index', i); harvest(x, pool, key, depth + 1)}); return}
  if (typeof res !== 'object') return;
  for (const k of Object.keys(res)) {const v = res[k]; if ((typeof v === 'string' && v.length < 60 && v) || (typeof v === 'number' && Number.isFinite(v))) add(k, v); else harvest(v, pool, k, depth + 1)}
}
const ALIAS = {who: ['name', 'who', 'npc', 'id'], hero: ['name', 'hero'], npc: ['npc', 'name'], target: ['name', 'id', 'place', 'spot'], with: ['name'], to: ['name', 'town'], by: ['npc', 'name'], as: ['npc', 'name'], foe: ['name'], name: ['name', 'npc'],
  id: ['id', 'listing', 'proposal', 'offer_id'], target_id: ['id'], hero_id: ['id'], node: ['id', 'node'], item: ['item', 'name', 'what'], recipe: ['recipe', 'id', 'name'], index: ['index'], before: ['id'], after: ['id'], offer_id: ['offer_id', 'id'],
  proposal_id: ['proposal_id', 'id'], job_id: ['id'], hook: ['id'], call: ['id', 'call'], conv: ['conv', 'id'], scene: ['id', 'scene'], site: ['id', 'name'], profession: ['id', 'name'], ability: ['id', 'name'], option: ['k', 'key', 'option']};
function ctxOf(h) {
  const heroes = S.agents.filter(a => a.kind === 'hero').map(a => a.name).slice(0, 8);
  const ids = S.agents.filter(a => a.kind === 'hero').map(a => a.id).slice(0, 8);
  const mobs = S.mobs.filter(m => m.alive && !m.gone).slice(0, 6);
  const levers = Object.keys(LEV.LEVERS || {});
  return {h, heroes, ids, mobIds: mobs.map(m => m.id), mobNames: mobs.map(m => m.name || m.type).filter(Boolean),
    pool: {}, towns: MAP.CITY.map(c => c.name), regions: REGIONS(), levers, pos: {x: Math.round(h.x), y: Math.round(h.y)}};
}
const HOSTILE_STR = ['', ' ', 'x'.repeat(5000), '../../etc/passwd', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '\u0000‮😀', '%s%n{{}}', '<script>1</script>', '-1', '1e999', '0,0', '9999,-9999', 'home\nhome', '"\'`'];
const HOSTILE_NUM = ['abc', '-', '1e999', -1, 0, 0.5, -0.5, 1e9, 2 ** 53, -(2 ** 31), 1e-9, 1e308, '7', '', null, [], {}, true];
const WRONG = [null, 0, -1, true, [], {}, ['x'], {a: 1}, 12345678901234567890, 1.5];
function validValue(name, spec, tool, c, r, dm) {
  if (spec.enum && spec.enum.length) return spec.enum[Math.floor(r() * spec.enum.length)];
  const pick = L => L.length ? L[Math.floor(r() * L.length)] : undefined, n = name.toLowerCase();
  if (c.pool && !(spec.enum && spec.enum.length) && r() < .8) {
    const keys = ALIAS[n] || [n], cand = keys.flatMap(k => c.pool[k] || []).filter(v => spec.type === 'integer' || spec.type === 'number' ? typeof v === 'number' : spec.type === 'string' || !spec.type);
    if (cand.length) {const v = pick(cand); return spec.type === 'string' ? String(v) : v}
  }
  switch (spec.type) {
    case 'boolean': return r() < .5;
    case 'integer': case 'number':
      if (/^(hero_id|target_id)$/.test(n)) return pick(c.ids.concat(c.mobIds));
      if (/^(index|before|call|conv|hook|job_id|offer_id|proposal_id|id|band)$/.test(n)) return Math.floor(r() * 4);
      if (/hours|days|minutes|radius|rounds|rooms|levels?$|lvl|scale|size|strength|delta|warmth|price|gold|since|wait_ms|budget_s|count|^n$|ilvl|flee_below|^r$/.test(n)) return 1 + Math.floor(r() * 5);
      return 1;
    case 'array': return r() < .5 ? [] : ['a', 'b'];
    case 'object': return r() < .5 ? {} : {text: 'hello', where: pick(c.towns)};
    default: {
      if (/^(name|who|hero|npc|target|with|to|a|b|by|giver|as|foe)$/.test(n)) return pick(c.heroes.concat(c.towns, ['home', 'captain', 'innkeeper']));
      if (/town|where|near|place|region|at|site|spot|meet_at/.test(n)) return pick(c.towns.concat(c.regions, ['home', 'inn', 'gate', c.pos.x + ',' + c.pos.y, 'explore north', 'fellowship']));
      if (/^lever$/.test(n)) return pick(c.levers);
      if (/^(item|recipe|good|slot)$/.test(n)) return pick(['potion', 'Linen Bandage', 'sword', 'ration', 'head', 'chest']);
      if (/^(id|node|scene|quest)$/.test(n)) return pick(['q1', 'node1', '0', '1', 'oath', 'a']);
      if (/^(tool)$/.test(n)) return pick(PLAYER_TOOLS.map(t => t.name));
      if (/^(trigger)$/.test(n)) return pick(['night_falls', 'enter_town', 'at_time']);
      if (/^(action)$/.test(n)) return pick(['narrate', 'npc_say', 'dream']);
      if (/^(kind)$/.test(n)) return pick(['elite', 'ambush', 'meeting', 'social', 'trap', 'mystery', 'all']);
      if (/^(cls|class)$/.test(n)) return pick(['Warrior', 'Priest', 'Mage', 'Rogue']);
      if (/^(fac|faction)$/.test(n)) return pick(['concord', 'warband', '0', '1']);
      if (/^(query|tag|prey|profession|vocabulary|path|score|ability|field|op|section)$/.test(n)) return pick(['wolf', 'strength', 'brawn', 'herbalism', 'all', 'voice', 'add']);
      return pick(['A short line, said plainly.', 'test', 'hello there', 'yes', 'no']);
    }
  }
}
function hostileValue(spec, r) {
  const k = r();
  if (k < .35) return WRONG[Math.floor(r() * WRONG.length)];
  if (spec.type === 'integer' || spec.type === 'number') return HOSTILE_NUM[Math.floor(r() * HOSTILE_NUM.length)];
  if (spec.type === 'array') return k < .6 ? HOSTILE_STR : [HOSTILE_STR[Math.floor(r() * HOSTILE_STR.length)], null, 0, {}];
  if (spec.type === 'object') return k < .6 ? 'x' : {[HOSTILE_STR[Math.floor(r() * HOSTILE_STR.length)]]: HOSTILE_STR[Math.floor(r() * HOSTILE_STR.length)], __proto__: null};
  return HOSTILE_STR[Math.floor(r() * HOSTILE_STR.length)];
}
// Realistic calls for the DM's writing tools (what a DM at a table would send), so a valid call reaches the code behind the argument check.
const RECIPES = c => {
  const hero = c.h.name, town = c.towns[0], town2 = c.towns[c.towns.length - 1], region = c.regions[0] || 'Thornvale', why = 'Fuzz: a reason in one sentence.', lever = c.levers[0];
  return {
    notes_write: [{section: 'threads', op: 'add', text: 'A thread to follow.', about: hero}],
    remember: [{title: 'A note', text: 'Something worth keeping.', tags: ['a'], section: 'plans'}],
    pull_lever: [{lever: 'price_shock', params: {good: 'Wolf Pelt', direction: 'up'}, reason: why}, {lever: 'set_condition', params: {region, kind: 'fogbound'}, reason: why}, {lever: lever || 'post_hook', params: {}, reason: why}],
    post_hook: [{town, tpl: 'clear', reason: why}, {town: town2, tpl: 'rescue', giver: 'captain', reward: 'fair', reason: why}, {town, tpl: 'hunt', region, reason: why}],
    place_person: [{role: 'peddler', near: town, reason: why}, {role: 'hermit', near: 'fellowship', name: 'Old Fuzz', want: 'a quiet word', attitude: 'wary', hours: 6, reason: why}, {role: 'sellsword', near: hero, spot: 'inn', reason: why}],
    give_item: [{hero, item: 'Redroot Draught', reason: why}, {hero, item: 'chest', ilvl: 1, reason: why}],
    take_item: [{hero, item: 'Fuzz token', reason: why}],
    mark_place: [{kind: 'ruin', near: 'fellowship', name: 'The Fuzz Ruin', hours: 6, reveal: 'a carved door', reason: why}, {kind: 'camp', near: hero, reason: why}],
    retire_person: [{npc: 'Old Fuzz', reason: why}],
    withdraw_hook: [{hook: 1, reason: why}],
    set_attitude: [{npc: 'Old Fuzz', to: hero, attitude: 'friendly', reason: why}],
    set_condition: [{region, kind: 'festival', strength: 1, hours: 6, reason: why}],
    price_shock: [{good: 'Wolf Pelt', direction: 'down', size: 1, hours: 4, reason: why}],
    mark_danger: [{near: 'fellowship', r: 6, lvl: 3, hours: 4, reason: why}],
    start_event: [{kind: 'festival', region, reason: why}],
    nudge_relation: [{a: hero, b: c.heroes[1] || hero, delta: 1, reason: why}],
    custom_foe: [{base: c.mobNames[0] || 'Wolf', near: 'fellowship', name: 'Fuzzjaw', reason: why}],
    undo: [{reason: why}], dismiss: [{place: 'The Fuzz Ruin', reason: why}], unstage: [{reason: why}],
    create_site: [{theme: 'barrow', near: 'fellowship', name: 'The Fuzz Barrow', rooms: 2, reason: why}, {theme: 'den', region, reason: why}],
    narrate: [{text: 'The wind turns.', near: hero}, {text: 'A bell tolls.', near: town, radius: 8}],
    whisper: [{hero, text: 'You hear a faint voice.'}], dream: [{hero, text: 'A door in the dark.'}],
    seed_rumour: [{town, text: 'They say the ford is haunted.', days: 2, reason: why}],
    bestow: [{hero, title: 'the Steady', why: 'held the line'}],
    summon_hero: [{fac: 'concord', cls: 'Warrior', near: town, level: 2, why}],
    npc_say: [{npc: 'Old Fuzz', text: 'Mind the road.'}],
    npc_offer: [{npc: 'Old Fuzz', kind: 'rumour', text: 'A rumour.'}],
    stage_scene: [{kind: 'meeting', near: 'fellowship', frame: 'A stranger waits at the road.', reason: why}, {kind: 'trap', near: 'fellowship', frame: 'The path ahead looks too quiet.', reason: why}, {kind: 'mystery', near: 'fellowship', frame: 'A cairn stands by the road.', reason: why}, {kind: 'elite', near: 'fellowship', frame: 'A boar, large and angry, comes out of the brush.', reason: why, preview: 'yes'}],
    when: [{trigger: 'night_falls', action: 'narrate', args: {text: 'Dark comes.', near: hero}, reason: why}, {trigger: 'enter_town', on: {town}, action: 'npc_say', args: {npc: 'Old Fuzz', text: 'Welcome.'}, reason: why}],
    watch: [{trigger: 'enter_region', on: {region}, note: 'fuzz'}, {trigger: 'night_falls'}],
    unwhen: [{id: 1}], unwatch: [{id: 1}], log_intent: [{text: 'Fuzz: watching the road.'}], prep_done: [{summary: 'ready'}]};
};
function argSets(tool, c, r, dm, nSets = SETS) {
  const A = Object.entries(tool.args || {}), sets = [{label: A.every(([, s]) => s.optional) ? 'valid-empty' : 'empty', args: {}}, {label: 'null', args: null}];
  const valid = all => Object.fromEntries(A.filter(([, s]) => all || !s.optional).map(([k, s]) => [k, validValue(k, s, tool, c, r, dm)]));
  sets.push({label: 'valid', args: valid(false)}, {label: 'valid-all', args: valid(true)}, {label: 'valid2', args: valid(true)}, {label: 'valid3', args: valid(true)});
  while (sets.length < nSets) {
    const v = valid(true), ks = Object.keys(v); // hostile: some arguments replaced, or every one
    if (!ks.length) {sets.push({label: 'junk', args: {junk: hostileValue({type: 'string'}, r), n: hostileValue({type: 'integer'}, r)}}); continue}
    const all = r() < .4; for (const k of ks) if (all || r() < .5) v[k] = hostileValue(tool.args[k], r);
    sets.push({label: all ? 'hostile-all' : 'hostile', args: v});
  }
  if (dm) for (const a of (RECIPES(c)[tool.name] || [])) sets.push({label: 'valid-recipe', args: a});
  return sets.slice(0, Math.max(nSets, 6)).concat(sets.slice(Math.max(nSets, 6)).filter(x => x.label === 'valid-recipe'));
}

// ---- checks
const BADTXT = /\bundefined\b|\bNaN\b|\bInfinity\b|\[object Object\]/;
const JS_ERR = /Cannot read propert|Cannot set propert|is not a function|is not defined|is not iterable|Cannot destructure|TypeError|RangeError|ReferenceError/; // a swallowed exception, wherever it surfaces
const THREW = [/^The world did not understand that \(/, /^The DM tool failed: /];
function walk(v, path, out, depth = 0) {
  if (out.length > 5 || depth > 8) return;
  if (typeof v === 'number') {if (!Number.isFinite(v)) out.push({kind: 'bad-number', at: path, v: String(v)}); return}
  if (typeof v === 'string') {if (BADTXT.test(v)) out.push({kind: 'bad-text', at: path, v: v.slice(Math.max(0, v.search(BADTXT) - 40), v.search(BADTXT) + 40)}); return}
  if (Array.isArray(v)) {v.forEach((x, i) => {if (x === undefined) out.push({kind: 'bad-text', at: path + '[' + i + ']', v: 'undefined element'}); else walk(x, path + '[' + i + ']', out, depth + 1)}); return}
  if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], path + '.' + k, out, depth + 1);
}
function stateNumbers(h, out) {
  const bad = (o, p, d = 0) => {if (d > 3 || out.length > 5 || !o || typeof o !== 'object') return; for (const k of Object.keys(o)) {const v = o[k]; if (typeof v === 'number' && !Number.isFinite(v)) out.push({kind: 'bad-number', at: p + '.' + k, v: String(v)}); else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'chat' && k !== 'history') bad(v, p + '.' + k, d + 1)}};
  bad(h, 'hero'); if (!Number.isFinite(S.gameMin)) out.push({kind: 'bad-number', at: 'S.gameMin', v: String(S.gameMin)});
  for (const m of S.mobs) if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.hp)) {out.push({kind: 'bad-number', at: 'mob#' + m.id, v: m.x + ',' + m.y + ',' + m.hp}); break}
}
// Every hero, not only the caller: a tool that reaches another hero (a hire, a give, a heal, an invitation, a duel) can leave a NaN on theirs
function allHeroNumbers(out) {
  for (const a of S.agents) {if (a.kind !== 'hero') continue; const n = out.length; stateNumbers(a, out); for (let i = n; i < out.length; i++) out[i].at = '#' + a.id + ' ' + a.name + ' ' + out[i].at; if (out.length > 5) break}
}
const finding = (kind, o) => Object.assign({kind}, o);
function check(res, h, isDm, tool) {
  const f = [];
  if (res === undefined || res === null || typeof res !== 'object' || Array.isArray(res)) {f.push(finding('nonobject', {v: String(res)})); return f}
  const w = []; walk(res, 'result', w); f.push(...w);
  try {if (JS_ERR.test(JSON.stringify(res))) f.push(finding('threw', {v: 'an exception text in the result: ' + (JSON.stringify(res).match(new RegExp('.{0,60}(' + JS_ERR.source + ').{0,60}')) || [''])[0]}))} catch {}
  if (res.ok === false) {
    const e = typeof res.error === 'string' ? res.error.trim() : '';
    if (THREW.some(re => re.test(e))) f.push(finding('threw', {v: e}));
    else if (/^Unknown (tool|DM tool)/.test(e) && (isDm ? DM_TOOLS : PLAYER_TOOLS).some(t => t.name === tool)) f.push(finding('unlisted', {v: e.slice(0, 100)}));
    else if (!e || e.split(/\s+/).length < 3 || e === 'no answer') f.push(finding('no-way-on', {v: JSON.stringify(res.error)}));
  }
  const s = []; stateNumbers(h, s); f.push(...s);
  return f;
}

// ---- save round trip: what a tool leaves behind must survive snapshot -> JSON -> restore -> snapshot unchanged
function diff(a, b, path = '$') {
  if (a === b) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && a.ref && a.ref === b.ref && String(a.id) === String(b.id)) return null; // a reference to a hero: its name and side are only a stub's extras
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return path + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b);
  if (Array.isArray(a) !== Array.isArray(b)) return path + ': array vs object';
  if (Array.isArray(a)) {if (a.length !== b.length) return path + ': length ' + a.length + ' != ' + b.length; for (let i = 0; i < a.length; i++) {const d = diff(a[i], b[i], path + '[' + i + ']'); if (d) return d} return null}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {const d = diff(a[k], b[k], path + '.' + k); if (d) return d}
  return null;
}
function roundTrip() { // -> a message, or null when the save is whole
  const A = snapshot(), bad = []; walk(A, 'save', bad); if (bad.length) return 'non-finite or undefined in the save: ' + bad[0].at + ' ' + bad[0].v;
  const J = JSON.stringify(A); restore(JSON.parse(J)); const B = snapshot(), d = diff(JSON.parse(J), JSON.parse(JSON.stringify(B)));
  return d ? 'snapshot after restore differs: ' + d.slice(0, 200) : null;
}

// ---- the run
const states = STATES.filter(s => (flag('state') === null || flag('state') === true) ? true : flag('state').split(',').includes(s.name));
if (flag('list')) {console.log(STATES.map(s => s.name).join(' ')); process.exit(0)}
const only = flag('only');
let tools = [];
if (only !== 'dm') tools.push(...PLAYER_TOOLS.map(t => ({...t, dm: false})));
if (only !== 'hero') tools.push(...DM_TOOLS.map(t => ({...t, dm: true})));
if (typeof flag('tool') === 'string') tools = tools.filter(t => flag('tool').split(',').includes(t.name));

const okBy = new Map(), trip = new Set(); const t0 = Date.now(); let calls = 0; const fails = []; const seen = new Set();
const replay = (st, tool, label) => 'node scripts/toolfuzz.mjs --world ' + WORLD + ' --state ' + st + ' --tool ' + tool + ' --seed ' + SEED;
console.log('toolfuzz ' + WORLD + ': ' + tools.length + ' tools x ' + states.length + ' states, seed ' + SEED);
for (const st of states) {
  const base = hash(WORLD + st.name);
  reseedAll(SEED ^ base);
  let snap = null, h = null;
  const restoreState = () => {if (st.direct) {h = st.make()} else {resetPrep(); restore(JSON.parse(snap)); SP.rebuild(); h = S.agents.find(a => a.id === h.id) || h} if (st.after) st.after()};
  try {h = st.make(); snap = st.direct ? null : JSON.stringify(snapshot())} catch (e) {
    console.error('  FAIL ' + WORLD + '/' + st.name + ' setup threw: ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join(' | ')); fails.push({st: st.name, tool: '(setup)', kind: 'threw'}); continue}
  let poolOf = {}; // read the state once with the read-only tools
  try {restoreState(); const hh = S.agents.find(a => a.id === h.id) || h; for (const t of tools) if (!t.act) harvest(t.dm ? dmAct(t.name, {}) : playerAct(hh.id, t.name, {}), poolOf); for (const l of ctxOf(hh).levers) (poolOf.lever = poolOf.lever || []).push(l)} catch (e) {console.error('  note: harvest threw in ' + st.name + ': ' + (e && e.message))}
  const LITE_SETS = Math.min(SETS, 6), toolsHere = !st.lite ? tools : st.only ? tools.filter(t => st.only.includes(t.name)) : tools.filter(t => t.act || (st.also || []).includes(t.name));
  for (const tool of toolsHere) {
    const r = lcg(SEED ^ base ^ hash(tool.name));
    reseedAll(SEED ^ hash(tool.name));
    try { // each tool starts from the same state: restored from the JSON save, or built again (fresh)
      restoreState();
    } catch (e) {fails.push({st: st.name, tool: tool.name, kind: 'threw', v: 'state restore: ' + String(e && e.message || e).slice(0, 160)}); console.error('  FAIL ' + WORLD + '/' + st.name + '/' + tool.name + ' restore threw: ' + (e && e.message)); continue}
    if (!tool.dm && !tool.name) continue;
    trip.delete(tool.name);
    const c = ctxOf(h); c.pool = poolOf;
    const sets = [];
    try { // live recipes from the situation (scripts/toolfuzz-cases.mjs): arguments read from the state at this moment
      const R = (tool.dm ? CASES.dm(c) : CASES.hero(c))[tool.name];
      for (const it of (R ? R() : [])) sets.push(it && (it.pre || typeof it.args === 'function' || it.args) ? {label: 'valid-recipe', pre: it.pre, args: it.args} : {label: 'valid-recipe', args: it});
    } catch (e) {fails.push({st: st.name, tool: tool.name, set: 'recipe', kind: 'threw', v: 'recipe: ' + String(e && e.message || e).slice(0, 160)}); console.error('  FAIL ' + WORLD + '/' + st.name + '/' + tool.name + ' recipe threw: ' + (e && e.stack || e).toString().split(String.fromCharCode(10)).slice(0, 3).join(' | '))}
    sets.push(...argSets(tool, c, r, tool.dm, st.lite ? LITE_SETS : SETS)); // the situation's own calls first, so the success path runs from the untouched state
    for (const set of sets) {
      let res, threwDirect = null; calls++; const logAt = S.dmLogSeq || 0;
      try {
        if (set.pre) { // calls that make the situation for this one (a note to forget, a person to retire): the DM's are "dm:name"
          const pr = set.pre.map(([t, a]) => t === 'step' ? (secs(a), null) : t.startsWith('dm:') ? dmAct(t.slice(3), a) : playerAct(h.id, t, a)); // ['step', seconds] lets the world run
          set.args = typeof set.args === 'function' ? set.args(pr) : set.args; set.pre = null;
        }
        h.playRate = []; // the 12-actions-an-hour gate sits in front of the tools: it must not hide them from the fuzzer
        res = tool.dm ? dmAct(tool.name, set.args) : playerAct(h.id, tool.name, set.args);
      } catch (e) {threwDirect = e}
      const fs0 = [];
      if (!threwDirect) for (const e of S.dmLog || []) { // a lever that threw is logged by the DM log, not answered
        if (e.id <= logAt) break; const t = safe(e.summary || '');
        if (JS_ERR.test(t)) { fs0.push(finding('threw', {v: 'DM log: ' + t.slice(0, 200)})); break }
      }
      if (flag('show')) console.log('  ' + st.name + '/' + tool.name + ' [' + set.label + '] ' + safe(set.args) + ' -> ' + String(safe(res)).slice(0, Number(flag('show')) || 220));
      if (!threwDirect && res && res.ok !== false && tool.act && !st.noTrip && /valid/.test(set.label) && !trip.has(tool.name)) { // the first tool of its kind that went through: is the save still whole?
        trip.add(tool.name); let m = null; const keep = JSON.stringify(snapshot());
        try {m = roundTrip()} catch (e) {m = 'save or restore threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')}
        if (m) { const key = tool.name + '|save|' + m.slice(0, 50); if (!seen.has(key)) {seen.add(key); fails.push({st: st.name, tool: tool.name, kind: 'save-drift', v: m});
          console.error('  FAIL ' + WORLD + '/' + st.name + '/' + (tool.dm ? 'dm:' : '') + tool.name + ' [' + set.label + '] save-drift: ' + m + '\n       args ' + JSON.stringify(set.args).slice(0, 200) + '\n       replay ' + replay(st.name, tool.name))} }
        restore(JSON.parse(keep)); h = S.agents.find(a => a.id === h.id) || h;
      }
      if (res && res.ok !== false && /valid/.test(set.label)) okBy.set(tool.name, (okBy.get(tool.name) || 0) + 1);
      const fs = fs0.concat(threwDirect ? [finding('threw', {v: 'escaped: ' + String(threwDirect && threwDirect.stack || threwDirect).split('\n').slice(0, 3).join(' | ')})] : check(res, h, tool.dm, tool.name));
      if (!threwDirect && fs.length === 0 && res && res.ok !== false && /valid/.test(set.label)) { // the world keeps running after a tool that went through
        const s1 = []; allHeroNumbers(s1); fs.push(...s1);
        try {run(6)} catch (e) {fs.push(finding('step-threw', {v: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')}))}
        const s2 = []; stateNumbers(h, s2); allHeroNumbers(s2); fs.push(...s2);
      } else if (fs.some(x => x.kind === 'threw') || fs.length === 0) {/* a throw leaves the state as it is */}
      for (const x of fs) {
        const key = tool.name + '|' + x.kind + '|' + String(x.v).slice(0, 60);
        if (seen.has(key)) continue; seen.add(key);
        fails.push({st: st.name, tool: tool.name, set: set.label, ...x});
        console.error('  FAIL ' + WORLD + '/' + st.name + '/' + (tool.dm ? 'dm:' : '') + tool.name + ' [' + set.label + '] ' + x.kind + (x.at ? ' at ' + x.at : '') + ': ' + String(x.v).slice(0, 200) +
          '\n       args ' + JSON.stringify(set.args, (k, v) => typeof v === 'string' && v.length > 60 ? v.slice(0, 40) + '...(' + v.length + ')' : v === undefined ? '__undefined' : v) + '\n       replay ' + replay(st.name, tool.name));
      }
      if (set.label === 'valid-recipe' && res && res.ok !== false && !threwDirect) { // a call that went through used up the situation: the next recipe starts from it again
        try {restoreState()} catch (e) {fails.push({st: st.name, tool: tool.name, kind: 'threw', v: 'state restore: ' + String(e && e.message || e).slice(0, 160)})}
      }
    }
  }
  console.log('  ' + WORLD + '/' + st.name + ' done, ' + calls + ' calls so far, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
let tooFew = false;
if (only !== 'x') {const none = tools.filter(t => !okBy.get(t.name)).map(t => (t.dm ? 'dm:' : '') + t.name); const MAXN = Number(flag('max-never', process.env.TOOLFUZZ_MAX_NEVER)) || 8; tooFew = tools.length > 100 && flag('state') === null && none.length > MAXN; if (tooFew) console.error('  FAIL ' + WORLD + ' coverage: ' + none.length + ' tools never went through, more than ' + MAXN + ' (a state that made a success path possible has stopped making it): ' + none.join(' ')); console.log('  coverage: ' + (tools.length - none.length) + '/' + tools.length + ' tools went through with valid arguments at least once' + (none.length ? '; never: ' + none.join(' ') : ''))}
console.log((fails.length || tooFew ? 'FAIL ' : 'ok   ') + WORLD + ': ' + calls + ' calls, ' + fails.length + ' findings, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exit(fails.length || tooFew ? 1 : 0);
