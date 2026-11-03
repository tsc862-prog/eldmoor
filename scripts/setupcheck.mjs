// New World setup check (issue #133; setup v2 #453): init({setup}) builds the chosen heroes (classes, names,
// peoples, minds) deterministically per seed, validateSetup rejects illegal choices, and presets behave.
// #148: every hero is an agent (only its model is chosen); a scripted or AI mind is refused, an older setup's is
// turned into an agent, and no hero of the built world is ever scripted.
// #453: setup v2 ({mode, heroes[]}): together (the default) builds the same world as the v1 setup it migrates from;
// apart founds one company per group (a solo per hero with none) at its start town; the shape presets.
// Usage: npm run setupcheck      (internal: --child <seed> [v1|apart] prints a world signature)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {init, S, validateSetup, defaultSetup, applyPreset, cleanSetup, fellowshipMembers, snapshot} from '../src/sim/index.js';
import {seatCap, seatNote, asV2, slotsView, slotsOf, planRunners, resolveArchetype, PRESETS, SETUP_VERSION} from '../src/sim/setup.js';
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
const sigOf = () => JSON.stringify([S.fellowship && S.fellowship.name, fellowshipMembers().map(m => [m.slot, m.hero.name, m.hero.cls, m.hero.race, m.hero.lvl, m.hero.x.toFixed(2), !!m.hero.player, !!m.hero.brain, m.hero.persona && m.hero.persona.archetype || null]),
  companies().map(C => [C.name, C.hall, members(C).map(a => [a.name, a.cls, a.lvl, a.x.toFixed(2), a.state, !!a.player])]), S.agents.length, S.agents.map(a => a.lvl).join('')]);

if (process.argv[2] === '--child') {const seed = +process.argv[3], k = process.argv[4];
  init({setup: k === 'v1' ? chosenV1(seed) : k === 'apart' ? cleanSetup(apartOf(seed)) : cleanSetup(chosen(seed))}); console.log('SIG ' + sigOf()); process.exit(0)}

if (process.argv[2] === '--facts') {const k = process.argv[3], P = await import('../src/sim/professions.js');
  const st = k === 'apart' ? cleanSetup(apartOf(4242)) : k === 'five' ? cleanSetup(applyPreset('five-solos', defaultSetup(9, 'eldmoor', 0))) : (() => {const a = applyPreset('solo', defaultSetup(6)); a.heroes[0].profs = ['mining']; return cleanSetup(a)})();
  init({setup: st}); const Cs = companies(), hs = Cs.flatMap(C => members(C).map(a => ({a, C})));
  const pair = Cs[0] ? members(Cs[0]) : [];
  console.log('FACTS ' + JSON.stringify({valid: validateSetup(st).join(' | '), fellowship: !!S.fellowship, members: fellowshipMembers().length, sizes: Cs.map(C => C.ids.length).join(),
    heroes: hs.map(({a, C}) => ({name: a.name, cls: a.cls, fac: a.fac, lvl: a.lvl, zone: a.zone, state: a.state, town: a.town, hall: C.hall, x: a.x, y: a.y, player: !!a.player, brain: !!a.brain})),
    cos: Cs.map(C => ({fac: C.fac, hall: C.hall, cls: members(C).map(a => a.cls).join()})), follow: !!Cs[0] && S.followId === Cs[0].id, setup: S.setup, seat: !!(S.dmAgent && S.dmAgent.seat),
    arch: !!(pair[0] && pair[0].persona && pair[0].persona.archetype === 'zealot' && pair[1] && pair[0].persona.stances[pair[1].id]),
    logs: Cs.length > 1 && /sets out alone from/.test(JSON.stringify(Cs[Cs.length - 1].log)) && /set out together from/.test(JSON.stringify(Cs[0].log)),
    snapCos: (snapshot().companies || []).length, mining: hs[0] ? P.skillOf(hs[0].a, 'mining') : null})); process.exit(0)}

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
ok(hk.heroes.every(p => p.mind.mode === 'agent' && /haiku/.test(p.mind.model)) && hk.dm.mode === 'scripted', 'All agents on Haiku, DM scripted');
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
 ok(planRunners(same).map(r => r.kind).join() === 'fellowship', 'together, one mind: one Fellowship runner');
 const pl = planRunners(cleanSetup(s)); ok(pl.filter(r => r.kind === 'hero').length === 5 && pl.filter(r => r.kind === 'hero').map(r => r.slot).join() === 'tank,healer,dps1,dps2,dps3' && pl.some(r => r.kind === 'dm'), 'together, mixed models: one runner per member (with its place), plus the DM');
 ok(planRunners(chosenV1(4242)).length === pl.length, 'planRunners reads a v1 setup');
 const a5 = planRunners(applyPreset('five-solos', same)); ok(a5.length === 5 && a5.every(r => r.kind === 'hero' && r.index != null), 'five solos: one hero runner each');
 const ap = planRunners(applyPreset('pairs-and-solo', same)); ok(ap.map(r => r.kind).join() === 'company,company,hero' && ap[0].heroes.join() === '0,1' && ap[1].heroes.join() === '2,3' && ap[2].index === 4, 'two pairs and a solo, one mind: a company runner per pair, a hero runner for the solo');
 const mx = applyPreset('pairs-and-solo', same); mx.heroes[1].mind = {mode: 'agent', provider: 'ollama', model: 'qwen2.5:14b'};
 ok(planRunners(mx).map(r => r.kind).join() === 'hero,hero,company,hero', 'a pair of two minds: hero runners')}

// ---- building: together ----
init({setup: cleanSetup(s)});
const mem = fellowshipMembers(), m = Object.fromEntries(mem.map(x => [x.slot, x.hero]));
ok(mem.length === 5 && mem.every(x => x.hero && x.hero.fac === 1 && x.hero.lvl === 1), 'five level-1 members of the chosen faction');
ok(m.tank.cls === 'Warrior' && m.healer.cls === 'Priest' && ['dps1', 'dps2', 'dps3'].every(k => m[k].cls === 'Rogue'), 'chosen classes (three Rogues)');
ok(m.dps1.name === 'Vexa' && m.dps3.name === 'Orrak', 'chosen names');
ok(m.dps1.race === 'thornhide' && m.tank.race === 'ashfolk', 'chosen peoples');
ok(mem.every(x => x.hero.player && x.hero.fellowAgent && !x.hero.brain), 'every member is agent-played from the first tick (never scripted, no relay brain)');
ok(S.fellowship.minds === 'agent', 'Minds: agents');
ok(companies().length === 1 && companies()[0] === S.fellowship, 'together: one company, the Fellowship');
ok(S.dmAgent && S.dmAgent.seat === true, 'an agent DM opens the DM seat');
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
 ok(f.seat === true, 'apart: an agent DM opens the seat');
 ok(f.arch === true, 'apart: the archetype is applied with the company mates as companions');
 ok(f.logs === true, 'each company\'s log opens with its setting out');
 ok(f.snapCos === 3, 'the apart world snapshots its companies');
 const g = facts('five');
 ok(g.sizes === '1,1,1,1,1' && g.heroes.every(h => h.lvl === 1 && h.player && h.town === h.hall), 'five solos: five companies of one, level 1, each at its own start town');
 const p = facts('soloprof'); ok(p.sizes === '1' && p.mining === 1, 'apart: a hero\'s chosen profession is seeded too')}

// Professions per place (#259): validated, cleaned, seeded through learn(), kept for a replacement.
{const P = await import('../src/sim/professions.js'), {offerReplacement} = await import('../src/sim/fellowship.js'), S2 = (await import('../src/sim/index.js')).S;
 const p = JSON.parse(JSON.stringify(defaultSetup(5)));
 ok(validateSetup(p).length === 0, 'no profession choice is valid (let them choose)');
 p.heroes[T].profs = ['mining', 'smithing']; p.heroes[H].profs = ['herbalism'];
 ok(validateSetup(p).length === 0 && cleanSetup(p).heroes[T].profs.join() === 'mining,smithing' && !cleanSetup(p).heroes[D1].profs, 'two for one place, one for another, none for the rest');
 const bad = JSON.parse(JSON.stringify(p)); bad.heroes[T].profs = ['mining', 'smithing', 'fishing'];
 ok(validateSetup(bad).some(x => /Tank/.test(x)), 'three professions are refused');
 bad.heroes[T].profs = ['mining', 'mining']; ok(validateSetup(bad).length > 0, 'a duplicate is refused');
 bad.heroes[T].profs = ['sorcery']; ok(validateSetup(bad).length > 0, 'an unknown profession is refused');
 {const {disbandFellowship} = await import('../src/sim/index.js'); if (S.fellowship) disbandFellowship()} init({setup: cleanSetup(p)});
 const ms = fellowshipMembers(), by = k => ms.find(m => m.slot === k).hero;
 ok(P.professionsOf(by('tank')).map(x => x.id).join() === 'mining,smithing' && P.skillOf(by('tank'), 'mining') === 1, 'the chosen place seeds a.profs at skill 1');
 ok(P.professionsOf(by('healer')).length === 1 && P.professionsOf(by('dps1')).length === 0, 'an unchosen place has none');
 const old = by('tank'); old.hp = 0; old.state = 'dead'; S2.fellowship.slots.tank = null;
 const r = offerReplacement('tank');
 ok(r && r.id !== old.id && P.professionsOf(r).map(x => x.id).join() === 'mining,smithing', 'a replacement keeps the choice of the place');
 const sn = JSON.stringify(snapshot()); ok(/"profs":\{"tank":\["mining","smithing"\]/.test(sn), 'the place choice is saved with the world');
}
console.log(fail ? fail + ' FAILED' : 'setupcheck passed'); process.exit(fail ? 1 : 0);
