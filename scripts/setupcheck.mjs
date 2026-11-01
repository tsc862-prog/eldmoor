// New World setup check (issue #133): init({setup}) builds the chosen Fellowship (classes, names, peoples,
// minds) deterministically per seed, validateSetup rejects illegal choices, and presets behave.
// Usage: npm run setupcheck      (internal: --child <seed> prints a world signature)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {init, S, validateSetup, defaultSetup, applyPreset, cleanSetup, fellowshipMembers, snapshot} from '../src/sim/index.js';

const chosen = seed => {
  const s = applyPreset('claude', defaultSetup(seed, 'eldmoor', 1));
  s.slots.dps1 = {cls: 'Rogue', name: 'Vexa', race: 'thornhide', mind: {mode: 'ai', provider: 'ollama', model: 'qwen2.5:14b'}};
  s.slots.dps2 = {cls: 'Rogue', mind: {mode: 'scripted'}};
  s.slots.dps3 = {cls: 'Rogue', name: 'Orrak', mind: {mode: 'agent', provider: 'anthropic', model: 'claude-sonnet-5-5'}};
  s.slots.tank = {...s.slots.tank, race: 'ashfolk'};
  return s;
};
const sigOf = () => JSON.stringify([S.fellowship.name, fellowshipMembers().map(m => [m.slot, m.hero.name, m.hero.cls, m.hero.race, m.hero.lvl, m.hero.x.toFixed(2), !!m.hero.player, !!m.hero.brain]), S.agents.length, S.agents.map(a => a.lvl).join('')]);

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
bad(t => t.slots.dps1.mind = {mode: 'ai', provider: 'nope', model: 'x'}, 'an unknown provider');
bad(t => t.slots.dps2.name = 'Vexa', 'a name used twice');
bad(t => t.slots.dps2.name = '12', 'a name that is not letters');
bad(t => t.slots.dps2.race = 'hallowan', 'a people of the other faction');
bad(t => t.dm = {mode: 'agent', provider: 'ollama'}, 'a DM agent with no model');
bad(t => t.fac = 7, 'an unknown faction');

// ---- presets ----
const all = applyPreset('scripted', s);
ok(Object.values(all.slots).every(p => p.mind.mode === 'scripted') && all.dm.mode === 'scripted', 'All scripted');
const cl = applyPreset('claude', s);
ok(Object.values(cl.slots).every(p => p.mind.mode === 'agent' && /haiku/.test(p.mind.model)) && /sonnet/.test(cl.dm.model), 'All agents on Haiku, DM on Sonnet');
ok(applyPreset('local', s, {}) === null, 'All local needs a loaded model');
const lo = applyPreset('local', s, {local: 'qwen2.5:14b'});
ok(new Set(Object.values(lo.slots).map(p => p.mind.model).concat(lo.dm.model)).size === 1, 'All local uses exactly one model');
ok(applyPreset('last', s, {last: s}).slots.dps3.name === 'Orrak', 'Last used restores the choices');
ok(validateSetup(cl).length === 0 && validateSetup(lo).length === 0, 'presets validate');

// ---- building ----
init({setup: cleanSetup(s)});
const mem = fellowshipMembers(), m = Object.fromEntries(mem.map(x => [x.slot, x.hero]));
ok(mem.length === 5 && mem.every(x => x.hero && x.hero.fac === 1 && x.hero.lvl === 1), 'five level-1 members of the chosen faction');
ok(m.tank.cls === 'Warrior' && m.healer.cls === 'Priest' && ['dps1', 'dps2', 'dps3'].every(k => m[k].cls === 'Rogue'), 'chosen classes (three Rogues)');
ok(m.dps1.name === 'Vexa' && m.dps3.name === 'Orrak', 'chosen names');
ok(m.dps1.race === 'thornhide' && m.tank.race === 'ashfolk', 'chosen peoples');
ok(m.tank.player && m.healer.player && m.dps3.player && m.tank.fellowAgent, 'agent members are agent-played from the first tick (never scripted)');
ok(m.dps1.brain && m.dps1.brainCfg && m.dps1.brainCfg.provider === 'ollama' && !m.dps1.player, 'AI member has a brain and its model');
ok(!m.dps2.player && !m.dps2.brain, 'scripted member stays scripted');
ok(S.fellowship.minds === 'relay', 'mixed minds -> relay mode');
ok(S.dmAgent && S.dmAgent.seat === true, 'an agent DM opens the DM seat');
ok(S.setup && S.setup.seed === 4242 && S.setup.world === 'eldmoor', 'S.setup records the seed');
ok(JSON.stringify(snapshot()).length > 1000, 'the world snapshots');

// Same seed twice, in separate processes (the sim state is a singleton), and a different seed differs.
const run = seed => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', String(seed)], {encoding: 'utf8'}).stdout.match(/SIG (.*)/)?.[1];
const a1 = run(1), a2 = run(1), b = run(2);
ok(!!a1 && a1 === a2, 'the same seed builds the same world twice');
ok(!!b && a1 !== b, 'another seed builds another world');
console.log(fail ? fail + ' FAILED' : 'setupcheck passed'); process.exit(fail ? 1 : 0);
