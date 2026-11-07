// New World setup check (issue #133; setup v2 #453): init({setup}) builds the chosen heroes (classes, names,
// peoples, minds) deterministically per seed, validateSetup rejects illegal choices, and presets behave.
// #148: every hero is an agent (only its model is chosen); a scripted or AI mind is refused, an older setup's is
// turned into an agent, and no hero of the built world is ever scripted.
// #453: setup v2 ({mode, heroes[]}): together (the default) builds the same world as the v1 setup it migrates from;
// apart founds one company per group (a solo per hero with none) at its start town; the shape presets.
// #771: a together company stands in one hall whatever its peoples (the Stepping Lands have two towns a faction), the
// hall is the setup's choice, an apart group stands together, and a single-people setup is left exactly where it stood.
// Usage: npm run setupcheck      (internal: --child <seed> [v1|apart] prints a world signature)
import {DM_PROVIDERS} from './dm-agent.mjs';
import {checkStart} from './runners.mjs';
import {spawnSync} from 'node:child_process';
import {runWorld, OTHER_WORLDS} from './worlds.mjs';
import {fileURLToPath} from 'node:url';
import {init, S, validateSetup, defaultSetup, applyPreset, cleanSetup, snapshot} from '../src/sim/index.js';
import * as SLT from '../src/sim/company.js'; // the slotted company (#588)
import {seatCap, seatNote, asV2, slotsView, slotsOf, planRunners, resolveArchetype, PRESETS, SETUP_VERSION, SETUP_PROVIDERS, hallTowns} from '../src/sim/setup.js';
import {companies, members} from '../src/sim/company.js';
import {CITY, REGIONS} from '../src/world/map.js';

const T = 0, H = 1, D1 = 2, D2 = 3, D3 = 4; // hero indexes of the classic five (tank, healer, dps1-3)
const chosen = seed => {
  const s = applyPreset('claude', defaultSetup(seed, 'eldmoor', 1)), h = s.heroes;
  h[D1] = {cls: 'Rogue', name: 'Vexa', race: 'thornhide', fac: 1, mind: {mode: 'agent', provider: 'ollama', model: 'qwen2.5:14b'}};
  h[D2] = {cls: 'Rogue', fac: 1, mind: {mode: 'agent', provider: 'openai', model: 'gpt-5-mini'}};
  h[D3] = {cls: 'Rogue', name: 'Orrak', fac: 1, mind: {mode: 'agent', provider: 'anthropic', model: 'claude-sonnet-5-5'}};
  h[T] = {...h[T], race: 'ashfolk', archetype: 'zealot'};
  h[H] = {...h[H], archetype: 'random'};
  return s;
};
// The same choices as a v1 setup (the page before #453): slots, top-level faction.
const chosenV1 = seed => {const s = chosen(seed), slots = {};
  ['tank', 'healer', 'dps1', 'dps2', 'dps3'].forEach((k, i) => {const {fac, ...p} = s.heroes[i]; slots[k] = p});
  return {v: 1, world: s.world, seed: s.seed, fac: s.fac, slots, dm: s.dm}};
const apartOf = seed => {const s = applyPreset('pairs-and-solo', chosen(seed)); s.heroes[D3].start = {town: 'home', region: 'Mirefen'}; return s};
const sigOf = () => JSON.stringify([SLT.slotted() && SLT.slotted().name, SLT.slotMembers(SLT.slotted()).map(m => [m.slot, m.hero.name, m.hero.cls, m.hero.race, m.hero.lvl, m.hero.x.toFixed(2), !!m.hero.player, !!m.hero.brain, m.hero.persona && m.hero.persona.archetype || null]),
  companies().map(C => [C.name, C.hall, members(C).map(a => [a.name, a.cls, a.lvl, a.x.toFixed(2), a.state, !!a.player])]), S.agents.length, S.agents.map(a => a.lvl).join('')]);

if (process.argv[2] === '--child') {const seed = +process.argv[3], k = process.argv[4];
  init({setup: k === 'v1' ? chosenV1(seed) : k === 'apart' ? cleanSetup(apartOf(seed)) : cleanSetup(chosen(seed))}); console.log('SIG ' + sigOf()); process.exit(0)}

if (process.argv[2] === '--facts') {const k = process.argv[3], P = await import('../src/sim/professions.js');
  const st = k === 'apart' ? cleanSetup(apartOf(4242)) : k === 'five' ? cleanSetup(applyPreset('five-solos', defaultSetup(9, 'eldmoor', 0))) : (() => {const a = applyPreset('solo', defaultSetup(6)); a.heroes[0].profs = ['mining']; return cleanSetup(a)})();
  init({setup: st}); const Cs = companies(), hs = Cs.flatMap(C => members(C).map(a => ({a, C})));
  const pair = Cs[0] ? members(Cs[0]) : [];
  console.log('FACTS ' + JSON.stringify({valid: validateSetup(st).join(' | '), fellowship: !!SLT.slotted(), members: SLT.slotMembers(SLT.slotted()).length, sizes: Cs.map(C => C.ids.length).join(),
    heroes: hs.map(({a, C}) => ({name: a.name, cls: a.cls, fac: a.fac, lvl: a.lvl, zone: a.zone, state: a.state, town: a.town, hall: C.hall, x: a.x, y: a.y, player: !!a.player, brain: !!a.brain})),
    cos: Cs.map(C => ({fac: C.fac, hall: C.hall, cls: members(C).map(a => a.cls).join()})), follow: !!Cs[0] && S.followId === Cs[0].id, setup: S.setup, seat: !!(S.dmAgent && S.dmAgent.seat),
    arch: !!(pair[0] && pair[0].persona && pair[0].persona.archetype === 'zealot' && pair[1] && pair[0].persona.stances[pair[1].id]),
    logs: Cs.length > 1 && /sets out alone from/.test(JSON.stringify(Cs[Cs.length - 1].log)) && /set out together from/.test(JSON.stringify(Cs[0].log)),
    snapCos: (snapshot().companies || []).length, mining: hs[0] ? P.skillOf(hs[0].a, 'mining') : null})); process.exit(0)}

// #771, in the Stepping Lands (ELDMOOR_WORLD=stepping): prints where a setup's companies stand.
const PEOPLES = ['ashfolk', 'mirekin', 'mirekin', 'ashfolk', 'thornhide'];
const peopled = (races, hall) => {const t = defaultSetup(771, 'stepping', 1); races.forEach((r, i) => t.heroes[i].race = r); if (hall) t.hall = hall; return t};
if (process.argv[2] === '--stand') {const k = process.argv[3], {dist} = await import('../src/world/map.js');
  const st = k === 'any' ? defaultSetup(771, process.env.ELDMOOR_WORLD, 1) : k === 'mixed' ? peopled(PEOPLES) : k === 'hall' ? peopled(PEOPLES, 'Murkstead') : k === 'single' ? peopled(PEOPLES.map(() => 'ashfolk')) : k === 'foreign' ? {...defaultSetup(771, 'eldmoor', 1), hall: 'Murkstead'}
    : (() => {const t = applyPreset('pairs-and-solo', peopled(PEOPLES)); t.heroes[2].start = {town: 'home', region: REGIONS[REGIONS.findIndex(r => r.band && r.band[0] > 1)].name}; return t})();
  init({setup: cleanSetup(st)});
  console.log('STAND ' + JSON.stringify({valid: validateSetup(st).join(' | '), setup: S.setup, cos: companies().map(C => {const L = members(C), c = CITY.find(t => t.name === C.hall);
    return {name: C.name, hall: C.hall, n: L.length, far: Math.max(...L.flatMap(a => L.map(b => dist(a, b)))), inHall: L.every(a => a.x >= c.x0 && a.x <= c.x1 + 1 && a.y >= c.y0 && a.y <= c.y1 + 1),
      home: L.every(a => a.town === C.hall), town: L.every(a => a.state === 'town'), party: L[0].party ? L[0].party.mem.length : 0, born: L.map(a => a.born || null), story: L.map(a => a.backstory ? JSON.stringify(a.backstory) : ''), log: C.log.map(e => e.parts.map(p => typeof p === 'string' ? p : p && (p.name || p.t) || '').join('')).join(' | ')}})}));
  process.exit(0)}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const s = chosen(4242);
ok(validateSetup(s).length === 0, 'a legal setup validates: ' + validateSetup(s).join(' | '));
ok(s.v === SETUP_VERSION && SETUP_VERSION === 2 && s.mode === 'together' && s.heroes.length === 5, 'setup v2: mode together, five heroes');

// ---- validation ----
const bad = (f, what, re) => {const t = JSON.parse(JSON.stringify(s)); f(t); const v = validateSetup(t); ok(v.length > 0 && (!re || v.some(x => re.test(x))), what + (v.length ? ' -> ' + v[0] : ''))};
bad(t => t.heroes[T].cls = 'Mage', 'a Mage cannot tank');
bad(t => t.heroes[H].cls = 'Rogue', 'a Rogue cannot heal');
bad(t => t.heroes[D1].cls = 'Warrior', 'a Warrior is not a DPS');
bad(t => t.heroes[D1].mind = {mode: 'agent', provider: 'ollama'}, 'an agent with no model');
bad(t => t.heroes[D1].mind = {mode: 'agent', provider: 'nope', model: 'x'}, 'an unknown provider');
bad(t => t.heroes[D2].mind = {mode: 'scripted'}, 'a scripted member (#148)');
bad(t => t.heroes[D2].mind = {mode: 'ai', provider: 'anthropic', model: 'claude-haiku-5-5'}, 'an AI (single-call) member (#148)');
bad(t => t.heroes[D2].name = 'Vexa', 'a name used twice', /used twice/);
bad(t => t.heroes[D2].name = '12', 'a name that is not letters');
bad(t => t.heroes[D2].race = 'hallowan', 'a people of the other faction');
bad(t => t.dm = {mode: 'agent', provider: 'ollama'}, 'a DM agent with no model');
bad(t => t.dm = {mode: 'scripted'}, 'a scripted DM (#520: the DM is always an agent)', /DM is always an agent/);
bad(t => delete t.dm, 'no DM mind at all (#559: the DM mind is required)', /DM/);
bad(t => t.fac = 7, 'an unknown faction');
bad(t => t.heroes[D1].archetype = 'jester', 'an unknown archetype (#295)');
// v2 rules (#453)
bad(t => t.heroes[D2].fac = 0, 'together needs one faction', /one faction/);
bad(t => t.heroes.pop(), 'together rides as the five for now (four heroes refused)', /Together/);
bad(t => t.heroes = [], 'at least one hero', /at least one/);
bad(t => {t.mode = 'apart'; t.heroes.push({cls: 'Mage', fac: 1, mind: t.heroes[0].mind})}, 'a sixth paid-mind hero (seat cap, #455)', /Seats full: 6 heroes, but only 5/);
{const loc=(n,mixed)=>{const t=JSON.parse(JSON.stringify(s));t.mode='apart';t.heroes=Array.from({length:n},(_,i)=>({cls:'Mage',fac:1,name:'Loc'+String.fromCharCode(97+i),mind:{mode:'agent',provider:'ollama',model:'qwen2.5:14b'}}));if(mixed)t.heroes[0].mind={mode:'agent',provider:'openai',model:'gpt-6-luna'};return t};
 ok(validateSetup(loc(10)).length===0,'ten local-mind heroes are accepted: '+validateSetup(loc(10)).join(' | '));
 ok(seatCap(loc(10))===10&&seatNote(loc(10))!==''&&seatNote(loc(5))==='','the turn-time warning shows past five local minds only');
 ok(validateSetup(loc(11)).some(m=>/At most 10/.test(m)),'eleven heroes are refused');
 ok(validateSetup(loc(6,true)).some(m=>/Seats full/.test(m)),'ten-seat cap needs every mind local: six with one OpenAI is refused');
 ok(validateSetup(loc(5,true)).length===0,'five with one paid mind is fine')}
bad(t => t.mode = 'scattered', 'an unknown mode');
bad(t => {t.mode = 'apart'; t.heroes[D3].cls = 'Necromancer'}, 'an unknown class', /pick a class/);
bad(t => {t.mode = 'apart'; t.heroes[T].start = {town: 'Highgate'}}, 'a start town of the other faction', /not a town of/);
bad(t => {t.mode = 'apart'; t.heroes[T].start = {region: 'Atlantis'}}, 'a start region that does not exist', /no region/);
bad(t => {t.mode = 'apart'; t.heroes[T].group = 1; t.heroes[H].group = 1; t.heroes[H].fac = 0; delete t.heroes[H].race}, 'an apart group of two factions', /one faction/);
{const t = JSON.parse(JSON.stringify(s)); t.mode = 'apart'; t.heroes[D2].fac = 0; delete t.heroes[D2].race; t.heroes[D2].start = {town: 'Highgate'};
 ok(validateSetup(t).length === 0, 'apart: the world may hold both factions, each hero from a town of its own: ' + validateSetup(t).join(' | '))}
{const t = JSON.parse(JSON.stringify(s)); [t.heroes[0], t.heroes[2]] = [t.heroes[2], t.heroes[0]];
 ok(validateSetup(t).length === 0 && slotsOf(t).tank === 2 && slotsOf(t).dps1 === 0, 'together: the five places in any order (the Warrior takes the Tank place wherever it stands)')}

// ---- the hall (#771) ----
{const st = peopled(PEOPLES, 'Murkstead');
 ok(hallTowns('stepping', 1).join() === 'Grimhold,Murkstead,Thornteeth' && hallTowns('eldmoor', 1).join() === 'Grimhold', 'the hall picker lists the towns of the faction on the chosen map');
 ok(validateSetup(st).length === 0 && cleanSetup(st).hall === 'Murkstead', 'a town of the faction is a legal hall, and cleaning keeps it: ' + validateSetup(st).join(' | '));
 ok(validateSetup({...st, hall: 'Highgate'}).some(x => /hall.*not a town/i.test(x)), 'a town of the other faction is refused as a hall');
 ok(!('hall' in cleanSetup(s)) && !('hall' in slotsView(cleanSetup(s))), 'no hall chosen: the setup carries none (the old shape)');
 ok(slotsView(cleanSetup(st)).hall === 'Murkstead' && !('hall' in applyPreset('five-solos', st)) && !('hall' in cleanSetup({...st, mode: 'apart'})), 'the places view keeps the hall; apart has none');
 ok(applyPreset('last', defaultSetup(2, 'stepping', 1), {last: st}).hall === 'Murkstead' && !('hall' in applyPreset('last', st, {last: defaultSetup(3, 'stepping', 1)})), 'Last used restores the hall, or its absence')}

// ---- v1 -> v2 ----
{const v1 = chosenV1(4242), c = cleanSetup(v1);
 ok(c.v === 2 && c.mode === 'together' && c.heroes.length === 5 && c.heroes.map(h => h.cls).join() === 'Warrior,Priest,Rogue,Rogue,Rogue' && c.heroes.every(h => h.fac === 1), 'a v1 setup (slots) cleans to v2 together, heroes in place order, the faction on each');
 ok(c.heroes[D1].name === 'Vexa' && c.heroes[T].archetype === 'zealot' && c.heroes[D1].mind.model === 'qwen2.5:14b', 'names, archetypes and minds survive the migration');
 ok(validateSetup(v1).length === 0 && validateSetup(c).length === 0, 'a v1 setup validates as it is and once cleaned');
 const bv = JSON.parse(JSON.stringify(v1)); bv.slots.tank.cls = 'Mage'; ok(validateSetup(bv).length > 0, 'a bad v1 setup is still refused (the raw migration keeps bad values)');
 ok(JSON.stringify(slotsView(c).slots) === JSON.stringify(cleanSetup(v1) && slotsView(cleanSetup(v1)).slots) && slotsView(c).slots.dps1.name === 'Vexa' && !('fac' in slotsView(c).slots.tank), 'slotsView gives the page its v1 places back');
 ok(slotsView(applyPreset('five-solos', c)) === null, 'slotsView: an apart setup has no places');
 ok(asV2(c) === c, 'a v2 setup passes asV2 untouched')}

// ---- presets ----
ok(PRESETS.includes('classic') && PRESETS.includes('five-solos') && PRESETS.includes('pairs-and-solo') && PRESETS.includes('solo'), 'shape presets: classic, five solos, two pairs and a solo, solo');
ok(applyPreset('scripted', s) === null, 'there is no All scripted preset (#148)');
ok(defaultSetup(1).heroes.every(p => p.mind.mode === 'agent') && defaultSetup(1).mode === 'together' && validateSetup(defaultSetup(1)).length === 0, 'the default setup: together, every hero an agent (Haiku), valid');
const hk = applyPreset('haiku', s);
ok(hk.heroes.every(p => p.mind.mode === 'agent' && /haiku/.test(p.mind.model)) && hk.dm.mode === 'agent' && /haiku/.test(hk.dm.model), 'All on Haiku, the DM too (#520: no scripted DM)');
ok(defaultSetup(1).dm.mode === 'agent' && defaultSetup(1).dm.provider === 'anthropic' && /haiku/.test(defaultSetup(1).dm.model), 'the default setup seats a DM agent (Haiku)');
{const old = chosenV1(4242); old.dm = {mode: 'scripted'}; const c = cleanSetup(old);
 ok(c.dm.mode === 'agent' && /haiku/.test(c.dm.model) && validateSetup(c).length === 0 && validateSetup(old).some(x => /DM is always an agent/.test(x)), 'an older setup with a scripted DM cleans to the default DM agent (and is refused raw)');
 ok(applyPreset('last', s, {last: old}).dm.mode === 'agent', 'Last used turns a remembered scripted DM into an agent');
 ok(cleanSetup({...old, dm: {mode: 'agent', provider: 'ollama', model: 'qwen2.5:14b'}}).dm.model === 'qwen2.5:14b', 'a chosen DM model survives cleaning');
 // #824: the setup page offers every provider for the DM, and the DM runner takes every one (the runs are in openaicheck, hfcheck and googlecheck)
 for (const provider of SETUP_PROVIDERS) {const model = provider + '-model', c2 = cleanSetup({...old, dm: {mode: 'agent', provider, model}}), j = planRunners(c2).find(r => r.kind === 'dm');
  ok(validateSetup(c2).length === 0 && j.provider === provider && j.model === model && DM_PROVIDERS.includes(provider) && !checkStart({kind: 'dm', provider, model}, [], {}).error, 'a DM on ' + provider + ' validates, plans its runner and the runner takes it')}}
{const old = chosenV1(4242); old.slots.dps2.mind = {mode: 'scripted'}; old.slots.dps1.mind = {mode: 'ai', provider: 'ollama', model: 'qwen2.5:14b'};
 const c = cleanSetup(old); ok(c.heroes[D2].mind.mode === 'agent' && /haiku/.test(c.heroes[D2].mind.model) && c.heroes[D1].mind.mode === 'agent' && c.heroes[D1].mind.model === 'qwen2.5:14b' && validateSetup(c).length === 0, 'an older setup with scripted/AI members cleans to agents');
 ok(applyPreset('last', s, {last: old}).heroes[D2].mind.mode === 'agent', 'Last used turns a remembered scripted member into an agent')}
const cl = applyPreset('claude', s);
ok(cl.heroes.every(p => p.mind.mode === 'agent' && /haiku/.test(p.mind.model)) && /sonnet/.test(cl.dm.model), 'All agents on Haiku, DM on Sonnet');
ok(applyPreset('local', s, {}) === null, 'All local needs a loaded model');
const lo = applyPreset('local', s, {local: 'qwen2.5:14b'});
ok(new Set(lo.heroes.map(p => p.mind.model).concat(lo.dm.model)).size === 1, 'All local uses exactly one model');
ok(applyPreset('last', s, {last: s}).heroes[D3].name === 'Orrak', 'Last used restores the choices');
ok(applyPreset('last', s, {last: chosenV1(4242)}).heroes[D3].name === 'Orrak', 'Last used reads a v1 last setup too');
ok(validateSetup(cl).length === 0 && validateSetup(lo).length === 0 && validateSetup(hk).length === 0, 'mind presets validate');
const fs5 = applyPreset('five-solos', s), ps = applyPreset('pairs-and-solo', s), so = applyPreset('solo', s), cs = applyPreset('classic', fs5);
ok(fs5.mode === 'apart' && fs5.heroes.length === 5 && fs5.heroes.every(h => h.start && h.start.town === 'home' && h.group == null), 'five solos: the five, apart, each from home');
ok(ps.mode === 'apart' && ps.heroes.length === 5 && ps.heroes[0].group === ps.heroes[1].group && ps.heroes[2].group === ps.heroes[3].group && ps.heroes[0].group !== ps.heroes[2].group && ps.heroes[4].group == null, 'two pairs and a solo: Warrior+Priest, Mage+Hunter, the last alone');
ok(so.mode === 'apart' && so.heroes.length === 1, 'solo: one hero, apart');
ok(cs.mode === 'together' && cs.heroes.every(h => !h.start && h.group == null), 'classic: back to the five together');
ok(fs5.heroes[0].race === 'ashfolk' && fs5.heroes[0].archetype === 'zealot' && fs5.heroes[1].mind.model === s.heroes[1].mind.model, 'shape presets keep a hero\'s choices and mind when its class matches');
for (const [n, p] of [['five-solos', fs5], ['pairs-and-solo', ps], ['solo', so], ['classic', cs]]) ok(validateSetup(p).length === 0, 'preset ' + n + ' validates: ' + validateSetup(p).join(' | '));
ok(validateSetup(applyPreset('five-solos', defaultSetup(3))).length === 0 && validateSetup(applyPreset('pairs-and-solo', defaultSetup(3, 'eldmoor', 0))).length === 0, 'the apart presets validate from the default setup of either faction');

// ---- runners ----
{const same = applyPreset('haiku', s);
 ok(planRunners(same).map(r => r.kind).join() === 'fellowship,dm', 'together, one mind: one Fellowship runner, plus the DM runner (always, #559)');
 ok(planRunners({...same, dm: {mode: 'scripted'}}).some(r => r.kind === 'dm' && /haiku/.test(r.model)), 'a raw setup with a scripted DM still plans a DM runner (the default mind)');
 const pl = planRunners(cleanSetup(s)); ok(pl.filter(r => r.kind === 'hero').length === 5 && pl.filter(r => r.kind === 'hero').map(r => r.slot).join() === 'tank,healer,dps1,dps2,dps3' && pl.some(r => r.kind === 'dm'), 'together, mixed models: one runner per member (with its place), plus the DM');
 ok(planRunners(chosenV1(4242)).length === pl.length, 'planRunners reads a v1 setup');
 const a5 = planRunners(applyPreset('five-solos', same)).filter(r => r.kind !== 'dm'); ok(a5.length === 5 && a5.every(r => r.kind === 'hero' && r.index != null), 'five solos: one hero runner each');
 const ap = planRunners(applyPreset('pairs-and-solo', same)); ok(ap.map(r => r.kind).join() === 'company,company,hero,dm' && ap[0].heroes.join() === '0,1' && ap[1].heroes.join() === '2,3' && ap[2].index === 4, 'two pairs and a solo, one mind: a company runner per pair, a hero runner for the solo');
 const mx = applyPreset('pairs-and-solo', same); mx.heroes[1].mind = {mode: 'agent', provider: 'ollama', model: 'qwen2.5:14b'};
 ok(planRunners(mx).map(r => r.kind).join() === 'hero,hero,company,hero,dm', 'a pair of two minds: hero runners')}

// ---- building: together ----
init({setup: cleanSetup(s)});
const mem = SLT.slotMembers(SLT.slotted()), m = Object.fromEntries(mem.map(x => [x.slot, x.hero]));
ok(mem.length === 5 && mem.every(x => x.hero && x.hero.fac === 1 && x.hero.lvl === 1), 'five level-1 members of the chosen faction');
ok(m.tank.cls === 'Warrior' && m.healer.cls === 'Priest' && ['dps1', 'dps2', 'dps3'].every(k => m[k].cls === 'Rogue'), 'chosen classes (three Rogues)');
ok(m.dps1.name === 'Vexa' && m.dps3.name === 'Orrak', 'chosen names');
ok(m.dps1.race === 'thornhide' && m.tank.race === 'ashfolk', 'chosen peoples');
ok(mem.every(x => x.hero.player && x.hero.fellowAgent && !x.hero.brain), 'every member is agent-played from the first tick (never scripted, no relay brain)');
ok(SLT.slotted().minds === 'agent', 'Minds: agents');
ok(companies().length === 1 && companies()[0] === SLT.slotted(), 'together: one company, the Fellowship');
ok(S.dmAgent && S.dmAgent.seat === true, 'the DM seat is open from the first tick');
// Archetypes (#295 follow-up): the pick is applied at founding, Random comes from the seed (no RNG), stances name companions
{const {ARCHETYPES, ARCHETYPE_IDS} = await import('../src/data/archetypes.js');
 ok(m.tank.persona.archetype === 'zealot' && m.tank.persona.voice === ARCHETYPES.zealot.voice, 'a chosen archetype is applied at founding');
 ok(ARCHETYPE_IDS.includes(m.healer.persona.archetype) && m.healer.persona.archetype === resolveArchetype(cleanSetup(s), H) && resolveArchetype(cleanSetup(s), 'healer') === resolveArchetype(cleanSetup(s), H), 'Random resolves to one of the six, the same one resolveArchetype names (by index, or by place)');
 ok(!m.dps1.persona.archetype, 'None leaves the persona as it was');
 ok(m.tank.persona.edited === true && m.healer.persona.edited === true && !m.dps1.persona.edited, 'an archetype chosen at setup marks the persona as edited (relay writing never replaces it), like the panel picker');
 const others = mem.filter(x => x.hero !== m.tank).map(x => x.hero);
 ok(others.every(b => m.tank.persona.stances[b.id] === ARCHETYPES.zealot.stance.replace('{other}', b.name)), 'each companion gets the stance template with their name');
 ok(!JSON.stringify(m.tank.persona.stances).includes('{other}'), 'no {other} left in a stance');
 ok(cleanSetup({...s, heroes: s.heroes.map((h, i) => i === D1 ? {...h, archetype: 'jester'} : h)}).heroes[D1].archetype === undefined && cleanSetup(s).heroes[H].archetype === 'random', 'cleanSetup keeps a legal pick and drops an unknown one');
 const picks = seed => [0, 1, 2, 3, 4].map(i => resolveArchetype({seed, heroes: [0, 1, 2, 3, 4].map(j => j === i ? {archetype: 'random'} : {})}, i)).join();
 ok(picks(4242) === picks(4242), 'Random is the same for the same seed');
 ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(picks)).size > 1, 'Random differs across seeds');
 ok(applyPreset('last', s, {last: s}).heroes[T].archetype === 'zealot', 'Last used restores the archetype')}
ok(S.setup && S.setup.seed === 4242 && S.setup.world === 'eldmoor' && !('mode' in S.setup), 'S.setup records the seed (a together world\'s record as before)');
ok(JSON.stringify(snapshot()).length > 1000, 'the world snapshots');

// Same seed twice, in separate processes (the sim state is a singleton), and a different seed differs.
const run = (seed, k) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', String(seed), ...(k ? [k] : [])], {encoding: 'utf8'}).stdout.match(/SIG (.*)/)?.[1];
const a1 = run(1), a2 = run(1), b = run(2);
ok(!!a1 && a1 === a2, 'the same seed builds the same world twice');
ok(!!b && a1 !== b, 'another seed builds another world');
ok(run(1, 'v1') === a1 && run(4242, 'v1') === run(4242), 'together: a v1 setup builds exactly the world of its v2 migration');
{const p1 = run(1, 'apart'), p2 = run(1, 'apart');
 ok(!!p1 && p1 === p2 && p1 !== a1, 'apart: the same seed builds the same world twice (and not the together one)')}

// ---- building: apart (each world in its own process: init() builds on top of the last world) ----
{const facts = k => {const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--facts', k], {encoding: 'utf8'}); const m = out.stdout.match(/FACTS (.*)/); if (!m) console.error(out.stderr.slice(-800)); return m ? JSON.parse(m[1]) : {}};
 const f = facts('apart'), town = CITY.find(c => c.fac === 1), mire = REGIONS.findIndex(r => r.name === 'Mirefen');
 ok(f.valid === '', 'the apart test setup validates: ' + f.valid);
 ok(f.fellowship === false && f.members === 0, 'apart: no five-place Fellowship');
 ok(f.sizes === '2,2,1', 'two pairs and a solo: three companies of 2, 2 and 1 (' + f.sizes + ')');
 ok(f.heroes && f.heroes.length === 5 && f.heroes.every(h => h.player && !h.brain && h.fac === 1), 'apart: every hero agent-played from the first tick, of the chosen faction');
 ok(f.cos && f.cos.every(C => C.fac === 1 && C.hall === town.name), 'each company of one faction, its hall the start town');
 ok(f.cos && f.cos[0].cls === 'Warrior,Priest' && f.cos[1].cls === 'Mage,Hunter', 'the pairs ride as chosen');
 ok(f.heroes && f.heroes.slice(0, 4).every(h => h.lvl === 1 && h.town === town.name && h.state === 'town' && h.x >= town.x0 && h.x <= town.x1 + 1 && h.y >= town.y0 && h.y <= town.y1 + 1), 'level 1 in the start town');
 const solo = f.heroes && f.heroes[4];
 ok(solo && solo.name === 'Orrak' && solo.lvl === REGIONS[mire].band[0] && solo.zone === mire && solo.state === 'hunt', 'a start region seasons the hero to its band low and puts it out hunting there: ' + JSON.stringify(solo));
 ok(f.follow === true, 'the watcher follows the first company');
 ok(f.setup && f.setup.mode === 'apart' && f.setup.seed === 4242, 'S.setup records the apart start');
 ok(f.seat === true, 'apart: the DM seat is open from the first tick');
 ok(facts('five').seat === true, 'a setup made from the default (DM on Haiku) opens the seat too');
 ok(f.arch === true, 'apart: the archetype is applied with the company mates as companions');
 ok(f.logs === true, 'each company\'s log opens with its setting out');
 ok(f.snapCos === 3, 'the apart world snapshots its companies');
 const g = facts('five');
 ok(g.sizes === '1,1,1,1,1' && g.heroes.every(h => h.lvl === 1 && h.player && h.town === h.hall), 'five solos: five companies of one, level 1, each at its own start town');
 const p = facts('soloprof'); ok(p.sizes === '1' && p.mining === 1, 'apart: a hero\'s chosen profession is seeded too')}

// ---- standing together (#771): the Stepping Lands, each world in its own process ----
{const stand = k => {const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--stand', k], {encoding: 'utf8', env: {...process.env, ELDMOOR_WORLD: k === 'foreign' ? 'eldmoor' : 'stepping'}}); const m = out.stdout.match(/STAND (.*)/); if (!m) console.error(out.stderr.slice(-800)); return m ? JSON.parse(m[1]) : {cos: [{}]}};
 const a = stand('mixed'), A = a.cos[0];
 ok(a.valid === '' && a.cos.length === 1 && A.n === 5 && A.hall === 'Grimhold' && !('hall' in a.setup), 'mixed peoples, together: one company, the hall the Tank\'s home town as ever (' + A.hall + ')');
 ok(A.inHall && A.far <= 4 && A.home && A.town && A.party === 5, `every member stands in the hall town, within 4 tiles (${A.far && A.far.toFixed(1)}), home there, in state town, one party of five`);
 ok(A.born.join() === ',Murkstead,Murkstead,,Thornteeth' && /Murkstead, come from|come from Murkstead/.test(A.log), 'those from another town are marked, and the campaign log says where they came from: ' + A.born);
 ok(A.story[1].includes('Murkstead'), 'the people\'s home town stays in the origin text');
 const h = stand('hall'), B = h.cos[0];
 ok(B.hall === 'Murkstead' && B.inHall && B.far <= 4 && B.home && h.setup.hall === 'Murkstead', 'the setup\'s hall: all five start there, and S.setup records it');
 ok(B.born.join() === 'Grimhold,,,Grimhold,Thornteeth', 'the hall is the setup\'s choice, not the leader\'s people: ' + B.born);
 const g = stand('single'), G = g.cos[0];
 ok(G.hall === 'Grimhold' && G.inHall && G.born.every(x => !x) && !/come from/.test(G.log), 'a single-people company is left where it stood: nobody moved, no line');
 ok(stand('foreign').cos[0].hall === 'Grimhold', 'a remembered hall that is no town of this map falls back to the Tank\'s home town');
 const p = stand('apart'), [P1, P2] = p.cos;
 ok(p.valid === '' && P1.n === 2 && P1.far <= 4 && P1.inHall && P1.home, 'apart: a group of two peoples stands in one town (' + P1.hall + ', ' + P1.far.toFixed(1) + ' tiles)');
 ok(P2.n === 2 && P2.far <= 4 && !P2.town, 'apart: a group seasoned to a region stands together out there too (' + P2.far.toFixed(1) + ' tiles)')}

// the same standing, for every world of WORLDS but Eldmoor (#940 slice B): the default together company stands in a hall town of its faction on that map
for (const w of OTHER_WORLDS) {
 const out = runWorld(fileURLToPath(import.meta.url), w, {args: ['--stand', 'any'], capture: true}), m = String(out.stdout).match(/STAND (.*)/);
 if (!m) console.error(String(out.stderr).slice(-800));
 const a = m ? JSON.parse(m[1]) : {cos: [{}]}, A = a.cos[0];
 // far 8: a company already all in its hall is left where it stood (#771), so on a map where everyone's home falls to that town they stand a street apart
 ok(a.valid === '' && a.cos.length === 1 && A.n === 5 && A.inHall && A.far <= 8 && A.home && A.town && hallTowns(w, 1).includes(A.hall), w + ': the default company of five stands together in one hall town of its faction (' + A.hall + ')')}

// Professions per place (#259): validated, cleaned, seeded through learn(), kept for a replacement.
{const P = await import('../src/sim/professions.js'), {offerReplacement} = await import('../src/sim/company.js'), S2 = (await import('../src/sim/index.js')).S;
 const p = JSON.parse(JSON.stringify(defaultSetup(5)));
 ok(validateSetup(p).length === 0, 'no profession choice is valid (let them choose)');
 p.heroes[T].profs = ['mining', 'smithing']; p.heroes[H].profs = ['herbalism'];
 ok(validateSetup(p).length === 0 && cleanSetup(p).heroes[T].profs.join() === 'mining,smithing' && !cleanSetup(p).heroes[D1].profs, 'two for one place, one for another, none for the rest');
 const bad = JSON.parse(JSON.stringify(p)); bad.heroes[T].profs = ['mining', 'smithing', 'fishing'];
 ok(validateSetup(bad).some(x => /Tank/.test(x)), 'three professions are refused');
 bad.heroes[T].profs = ['mining', 'mining']; ok(validateSetup(bad).length > 0, 'a duplicate is refused');
 bad.heroes[T].profs = ['sorcery']; ok(validateSetup(bad).length > 0, 'an unknown profession is refused');
 {const {} = await import('../src/sim/index.js'); if (SLT.slotted()) SLT.disbandSlots(SLT.slotted())} init({setup: cleanSetup(p)});
 const ms = SLT.slotMembers(SLT.slotted()), by = k => ms.find(m => m.slot === k).hero;
 ok(P.professionsOf(by('tank')).map(x => x.id).join() === 'mining,smithing' && P.skillOf(by('tank'), 'mining') === 1, 'the chosen place seeds a.profs at skill 1');
 ok(P.professionsOf(by('healer')).length === 1 && P.professionsOf(by('dps1')).length === 0, 'an unchosen place has none');
 const old = by('tank'); old.hp = 0; old.state = 'dead'; SLT.slotted().slots.tank = null;
 const r = SLT.offerReplacement(SLT.slotted(), 'tank');
 ok(r && r.id !== old.id && P.professionsOf(r).map(x => x.id).join() === 'mining,smithing', 'a replacement keeps the choice of the place');
 const sn = JSON.stringify(snapshot()); ok(/"profs":\{"tank":\["mining","smithing"\]/.test(sn), 'the place choice is saved with the world');
}

// A world with no others (#780): the setup's heroes and nobody else; the setting saved; nothing queued; a death still refilled.
{const {step, setRunnerLinks, restore, setDmSeat} = await import('../src/sim/index.js'), {slay, maxHp} = await import('../src/sim/heroes.js'), {openingPending, arrivalsView} = await import('../src/sim/arrival.js');
 const {GOODS} = await import('../src/data/items.js'), {TABLE} = await import('../src/sim/table.js'), {OTHERS} = await import('../src/sim/setup.js');
 ok(OTHERS.join() === 'full,none' && !('others' in defaultSetup(1)), 'others: full or none, the default says nothing');
 const none = (seed, shape) => {const q = shape ? applyPreset(shape, defaultSetup(seed, 'eldmoor', 0)) : defaultSetup(seed, 'eldmoor', 0); q.others = 'none'; return q};
 {const t = none(11); t.others = 'some'; ok(validateSetup(t).some(x => /Other heroes/.test(x)), 'an unknown others is refused')}
 const c = cleanSetup(none(11)); ok(validateSetup(none(11)).length === 0 && c.others === 'none' && !('others' in cleanSetup(defaultSetup(11))), 'cleanSetup keeps none and leaves a full world\'s setup as it was');
 ok(slotsView(none(11)).others === 'none' && cleanSetup(slotsView(none(11))).others === 'none', 'a v1 view of it keeps the setting');
 ok(applyPreset('last', defaultSetup(12), {last: none(11)}).others === 'none' && !('others' in applyPreset('last', none(12), {last: defaultSetup(11)})), 'the last-setup preset carries the setting either way');

 init({setup: c});
 ok(S.agents.length === 5 && S.agents.every(a => a.player) && SLT.slotHeroes(SLT.slotted()).length === 5, 'together: exactly the five, all agent-played');
 ok(S.setup.others === 'none' && S.setup.seed === 11 && !!S.setup.dm, 'S.setup keeps the setting beside the record');
 {const t = S.chronicle.flatMap(e => e.parts.map(p => typeof p === 'string' ? p : p && (p.name || p.t) || '')).join(' '); ok(/empty of banners/.test(t) && !/Infinity/.test(t) && !/already worn/.test(t), 'the opening line says the roads are empty')}
 {const n = JSON.parse(JSON.stringify(snapshot())); init({}); ok(S.agents.length > 5 && !(S.setup && S.setup.others), 'a world made after it has its roster again'); restore(n); ok(S.setup.others === 'none' && S.agents.length === 5, 'a load keeps the setting')}
 TABLE.mode = 'off'; let rq = 0, low = 1e9; for (let i = 0; i < 480; i++) {step(1); rq = Math.max(rq, S.recruits.length); for (const n in GOODS) low = Math.min(low, GOODS[n].supply)} // 48 game hours
 ok(S.GUILDS.length === 0 && S.agents.every(a => !a.guild), 'no guild after 48 game hours');
 ok(rq === 0, 'no recruit queued');
 ok(low >= 14 && Object.keys(GOODS).every(n => GOODS[n].supply >= 14), 'the auction house holds its floor: goods never read as sold out, prices at the table\'s base');
 // a death with runners: the arrival; none queued for the world; the hero is made directly
 if (S.opening) S.opening.queue.length = 0; // session zero is not what this asks
 const F = SLT.slotted(), L = SLT.slotHeroes(F), link = x => x.player ? 'connected' : 'none'; setRunnerLinks(link); setDmSeat(true); TABLE.mode = 'auto'; TABLE.speed = 1;
 for (const a of L) {a.hp = maxHp(a); a.state = 'town'; a.town = F.hall; a.target = null; a.dest = null; a.quest = null}
 const dead = L[4], n0 = S.agents.length; slay(dead, S.mobs[0]);
 ok(dead.state === 'dead' && S.recruits.length === 0, 'a member\'s death queues no recruit');
 for (let i = 0; i < 200 && S.agents.length === n0; i++) step(.2);
 ok(arrivalsView(F).length === 0 && S.table && S.table.kind === 'arrival' && S.recruits.length === 0, 'it opens an arrival scene at the hall');
 const nw = S.agents[S.agents.length - 1];
 ok(S.agents.length === n0 + 1 && nw.player && nw.cls === dead.cls && nw.succeeds === dead.id, 'and the newcomer arrives, agent-played');
 // the last hero of an apart world: an heir, or the world would be empty; with a host or without
 setRunnerLinks(null); init({setup: cleanSetup(none(13, 'solo'))}); setDmSeat(true); ok(S.agents.length === 1 && companies().length === 1, 'apart solo: one hero, one company');
 const s0 = S.agents[0]; slay(s0, S.mobs[0]); step(1);
 ok(S.agents.filter(a => a.state !== 'dead').length === 1 && S.agents[1].player && S.agents[1].cls === s0.cls && S.agents[1].succeeds === s0.id && S.recruits.length === 0, 'a solo\'s heir comes though nobody runs it: a world with no others never empties');
 // the flags
 const flag = (env, args) => spawnSync(process.execPath, ['--input-type=module', '-e', "const {init,S}=await import(process.argv[1]);init(" + (args || '{}') + ");console.log('N='+S.agents.length+' '+(S.setup&&S.setup.others))", new URL('../src/sim/index.js', import.meta.url).href], {encoding: 'utf8', env: {...process.env, ...env}}).stdout.trim();
 ok(flag({ELDMOOR_OTHERS: 'none'}) === 'N=5 none', 'ELDMOOR_OTHERS=none: ' + flag({ELDMOOR_OTHERS: 'none'}));
 ok(flag({ELDMOOR_OTHERS: 'full'}) === 'N=28 undefined' && flag({}) === 'N=28 undefined', 'unset or full: the usual roster, no setting written');
 ok(flag({}, "{others:'none',fellowship:false}") === 'N=0 none', 'no company and no others: an empty world the DM can fill')}
console.log(fail ? fail + ' FAILED' : 'setupcheck passed'); process.exit(fail ? 1 : 0);
