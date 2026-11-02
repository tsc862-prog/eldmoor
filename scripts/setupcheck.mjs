// New World setup check (issue #133): init({setup}) builds the chosen Fellowship (classes, names, peoples,
// minds) deterministically per seed, validateSetup rejects illegal choices, and presets behave.
// #148: every member is an agent (only its model is chosen); a scripted or AI member mind is refused, an older
// setup's is turned into an agent, and no member of the built world is ever scripted.
// Usage: npm run setupcheck      (internal: --child <seed> prints a world signature)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {init, S, validateSetup, defaultSetup, applyPreset, cleanSetup, fellowshipMembers, snapshot} from '../src/sim/index.js';

const chosen = seed => {
  const s = applyPreset('claude', defaultSetup(seed, 'eldmoor', 1));
  s.slots.dps1 = {cls: 'Rogue', name: 'Vexa', race: 'thornhide', mind: {mode: 'agent', provider: 'ollama', model: 'qwen2.5:14b'}};
  s.slots.dps2 = {cls: 'Rogue', mind: {mode: 'agent', provider: 'openai', model: 'gpt-5-mini'}};
  s.slots.dps3 = {cls: 'Rogue', name: 'Orrak', mind: {mode: 'agent', provider: 'anthropic', model: 'claude-sonnet-5-5'}};
  s.slots.tank = {...s.slots.tank, race: 'ashfolk', archetype: 'zealot'};
  s.slots.healer = {...s.slots.healer, archetype: 'random'};
  return s;
};
const sigOf = () => JSON.stringify([S.fellowship.name, fellowshipMembers().map(m => [m.slot, m.hero.name, m.hero.cls, m.hero.race, m.hero.lvl, m.hero.x.toFixed(2), !!m.hero.player, !!m.hero.brain, m.hero.persona && m.hero.persona.archetype || null]), S.agents.length, S.agents.map(a => a.lvl).join('')]);

if (process.argv[2] === '--child') {init({setup: cleanSetup(chosen(+process.argv[3]))}); console.log('SIG ' + sigOf()); process.exit(0)}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const s = chosen(4242);
ok(validateSetup(s).length === 0, 'a legal setup validates: ' + validateSetup(s).join(' | '));

// ---- validation ----
const bad = (f, what) => {const t = JSON.parse(JSON.stringify(s)); f(t); const v = validateSetup(t); ok(v.length > 0, what + (v.length ? ' -> ' + v[0] : ''))};
bad(t => t.slots.tank.cls = 'Mage', 'a Mage cannot tank');
bad(t => t.slots.healer.cls = 'Rogue', 'a Rogue cannot heal');
bad(t => t.slots.dps1.cls = 'Warrior', 'a Warrior is not a DPS');
bad(t => t.slots.dps1.mind = {mode: 'agent', provider: 'ollama'}, 'an agent with no model');
bad(t => t.slots.dps1.mind = {mode: 'agent', provider: 'nope', model: 'x'}, 'an unknown provider');
bad(t => t.slots.dps2.mind = {mode: 'scripted'}, 'a scripted member (#148)');
bad(t => t.slots.dps2.mind = {mode: 'ai', provider: 'anthropic', model: 'claude-haiku-5-5'}, 'an AI (single-call) member (#148)');
bad(t => t.slots.dps2.name = 'Vexa', 'a name used twice');
bad(t => t.slots.dps2.name = '12', 'a name that is not letters');
bad(t => t.slots.dps2.race = 'hallowan', 'a people of the other faction');
bad(t => t.dm = {mode: 'agent', provider: 'ollama'}, 'a DM agent with no model');
bad(t => t.fac = 7, 'an unknown faction');
bad(t => t.slots.dps1.archetype = 'jester', 'an unknown archetype (#295)');

// ---- presets ----
ok(applyPreset('scripted', s) === null, 'there is no All scripted preset (#148)');
ok(Object.values(defaultSetup(1).slots).every(p => p.mind.mode === 'agent') && validateSetup(defaultSetup(1)).length === 0, 'the default setup: every member an agent (Haiku), valid');
const hk = applyPreset('haiku', s);
ok(Object.values(hk.slots).every(p => p.mind.mode === 'agent' && /haiku/.test(p.mind.model)) && hk.dm.mode === 'scripted', 'All agents on Haiku, DM scripted');
{const old = JSON.parse(JSON.stringify(s)); old.slots.dps2.mind = {mode: 'scripted'}; old.slots.dps1.mind = {mode: 'ai', provider: 'ollama', model: 'qwen2.5:14b'};
 const c = cleanSetup(old); ok(c.slots.dps2.mind.mode === 'agent' && /haiku/.test(c.slots.dps2.mind.model) && c.slots.dps1.mind.mode === 'agent' && c.slots.dps1.mind.model === 'qwen2.5:14b' && validateSetup(c).length === 0, 'an older setup with scripted/AI members cleans to agents');
 ok(applyPreset('last', s, {last: old}).slots.dps2.mind.mode === 'agent', 'Last used turns a remembered scripted member into an agent')}
const cl = applyPreset('claude', s);
ok(Object.values(cl.slots).every(p => p.mind.mode === 'agent' && /haiku/.test(p.mind.model)) && /sonnet/.test(cl.dm.model), 'All agents on Haiku, DM on Sonnet');
ok(applyPreset('local', s, {}) === null, 'All local needs a loaded model');
const lo = applyPreset('local', s, {local: 'qwen2.5:14b'});
ok(new Set(Object.values(lo.slots).map(p => p.mind.model).concat(lo.dm.model)).size === 1, 'All local uses exactly one model');
ok(applyPreset('last', s, {last: s}).slots.dps3.name === 'Orrak', 'Last used restores the choices');
ok(validateSetup(cl).length === 0 && validateSetup(lo).length === 0 && validateSetup(hk).length === 0, 'presets validate');

// ---- building ----
init({setup: cleanSetup(s)});
const mem = fellowshipMembers(), m = Object.fromEntries(mem.map(x => [x.slot, x.hero]));
ok(mem.length === 5 && mem.every(x => x.hero && x.hero.fac === 1 && x.hero.lvl === 1), 'five level-1 members of the chosen faction');
ok(m.tank.cls === 'Warrior' && m.healer.cls === 'Priest' && ['dps1', 'dps2', 'dps3'].every(k => m[k].cls === 'Rogue'), 'chosen classes (three Rogues)');
ok(m.dps1.name === 'Vexa' && m.dps3.name === 'Orrak', 'chosen names');
ok(m.dps1.race === 'thornhide' && m.tank.race === 'ashfolk', 'chosen peoples');
ok(mem.every(x => x.hero.player && x.hero.fellowAgent && !x.hero.brain), 'every member is agent-played from the first tick (never scripted, no relay brain)');
ok(S.fellowship.minds === 'agent', 'Minds: agents');
{const {planRunners} = await import('../src/sim/setup.js'); const pl = planRunners(cleanSetup(s)); ok(pl.filter(r => r.kind === 'hero').length === 5 && pl.some(r => r.kind === 'dm'), 'mixed models: one runner per member, plus the DM')}
ok(S.dmAgent && S.dmAgent.seat === true, 'an agent DM opens the DM seat');
// Archetypes (#295 follow-up): the pick is applied at founding, Random comes from the seed (no RNG), stances name companions
{const {ARCHETYPES, ARCHETYPE_IDS} = await import('../src/data/archetypes.js'), {resolveArchetype} = await import('../src/sim/setup.js');
 ok(m.tank.persona.archetype === 'zealot' && m.tank.persona.voice === ARCHETYPES.zealot.voice, 'a chosen archetype is applied at founding');
 ok(ARCHETYPE_IDS.includes(m.healer.persona.archetype) && m.healer.persona.archetype === resolveArchetype(cleanSetup(s), 'healer'), 'Random resolves to one of the six, the same one resolveArchetype names');
 ok(!m.dps1.persona.archetype, 'None leaves the persona as it was');
 ok(m.tank.persona.edited === true && m.healer.persona.edited === true && !m.dps1.persona.edited, 'an archetype chosen at setup marks the persona as edited (relay writing never replaces it), like the panel picker');
 const others = mem.filter(x => x.hero !== m.tank).map(x => x.hero);
 ok(others.every(b => m.tank.persona.stances[b.id] === ARCHETYPES.zealot.stance.replace('{other}', b.name)), 'each companion gets the stance template with their name');
 ok(!JSON.stringify(m.tank.persona.stances).includes('{other}'), 'no {other} left in a stance');
 ok(cleanSetup({...s, slots: {...s.slots, dps1: {...s.slots.dps1, archetype: 'jester'}}}).slots.dps1.archetype === undefined && cleanSetup(s).slots.healer.archetype === 'random', 'cleanSetup keeps a legal pick and drops an unknown one');
 const picks = seed => ['tank', 'healer', 'dps1', 'dps2', 'dps3'].map(k => resolveArchetype({seed, slots: {[k]: {archetype: 'random'}}}, k)).join();
 ok(picks(4242) === picks(4242), 'Random is the same for the same seed');
 ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(picks)).size > 1, 'Random differs across seeds');
 ok(applyPreset('last', s, {last: s}).slots.tank.archetype === 'zealot', 'Last used restores the archetype')}
ok(S.setup && S.setup.seed === 4242 && S.setup.world === 'eldmoor', 'S.setup records the seed');
ok(JSON.stringify(snapshot()).length > 1000, 'the world snapshots');

// Same seed twice, in separate processes (the sim state is a singleton), and a different seed differs.
const run = seed => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', String(seed)], {encoding: 'utf8'}).stdout.match(/SIG (.*)/)?.[1];
const a1 = run(1), a2 = run(1), b = run(2);
ok(!!a1 && a1 === a2, 'the same seed builds the same world twice');
ok(!!b && a1 !== b, 'another seed builds another world');

// Professions per place (#259): validated, cleaned, seeded through learn(), kept for a replacement.
{const P = await import('../src/sim/professions.js'), {offerReplacement} = await import('../src/sim/fellowship.js'), S2 = (await import('../src/sim/index.js')).S;
 const p = JSON.parse(JSON.stringify(defaultSetup(5)));
 ok(validateSetup(p).length === 0, 'no profession choice is valid (let them choose)');
 p.slots.tank.profs = ['mining', 'smithing']; p.slots.healer.profs = ['herbalism'];
 ok(validateSetup(p).length === 0 && cleanSetup(p).slots.tank.profs.join() === 'mining,smithing' && !cleanSetup(p).slots.dps1.profs, 'two for one place, one for another, none for the rest');
 const bad = JSON.parse(JSON.stringify(p)); bad.slots.tank.profs = ['mining', 'smithing', 'fishing'];
 ok(validateSetup(bad).some(x => /Tank/.test(x)), 'three professions are refused');
 bad.slots.tank.profs = ['mining', 'mining']; ok(validateSetup(bad).length > 0, 'a duplicate is refused');
 bad.slots.tank.profs = ['sorcery']; ok(validateSetup(bad).length > 0, 'an unknown profession is refused');
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
