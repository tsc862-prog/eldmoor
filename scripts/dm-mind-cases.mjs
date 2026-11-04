// The DM on a provider a hero plays (#824), end to end against a provider's mock server. openaicheck, hfcheck and googlecheck each
// call dmMindCases with their mock: the provider tables agree; a setup choice reaches a running DM seat, its prep and its opening
// frame through the runner supervisor; turns and the ruling voice through the game; the table, talk, ruling and companion voices on
// the provider's adapter; a fresh session and a switch of provider that keep the notes; and (with `pricey`) a voice spending the last
// of the budget, which ends as a budget stop.
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DM_PROVIDERS, tableVoice, talkVoice, companionVoice, rulingVoice} from './dm-agent.mjs';
import {RUNNER_PROVIDERS} from './agent-sessions.mjs';
import {checkStart} from './runners.mjs';
import {openaiRunner} from './agent-chat.mjs';
import {rollDue, rollPoint} from './session-roll.mjs';
import {strictProblem} from './mock-dm.mjs';
import {PROVIDERS} from '../src/data/providers.js';
import {MIND_PROVIDERS} from '../src/sim/brain.js';
import {SETUP_PROVIDERS, defaultSetup, cleanSetup, validateSetup, planRunners} from '../src/sim/setup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), PAGE = 'http://localhost:5173';
const KEY_NAME = {openai: 'OPENAI_API_KEY', huggingface: 'HF_TOKEN', google: 'GOOGLE_API_KEY'};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 60000, step = 150) => {const t0 = Date.now(); for (;;) {const v = await Promise.resolve().then(f).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step)}};
const reEsc = s => s.replace(/[.+/*?()[\]]/g, '\\$&');
const RESUME = /no memory of this conversation/;

// provider, model: the seat's mind; env: the provider's key and mock URL; ok: the check's ok(); port: this and the next two ports are used;
// seen: the mock's list of chat bodies; pricey: {model, budget}, a model and a budget that one DM turn stays under and one more voice call passes.
export async function dmMindCases({provider, model, env: env0, ok, port, pricey = null, seen = null}) {
  const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-dmmind-')), kids = [];
  const env = {...env0, AGENT_LOGS: tmp, AGENT_MIN_GAP: '0', AGENT_REFLECT: '0'};
  const run = (args, {pipe = false, e = env} = {}) => {
    const p = spawn(process.execPath, args, {cwd: ROOT, env: e, stdio: [pipe ? 'pipe' : 'ignore', 'pipe', 'pipe']}); kids.push(p); let out = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    return {p, done: new Promise(r => p.on('exit', c => r(c))), out: () => out}};
  const world = async (args, name, at) => {const w = run(['scripts/play-headless.mjs', '--port', String(at), '--quiet', '--no-behavior', '--no-mirror', '--world', join(tmp, name + '.json'), ...args]);
    if (!await until(() => /^\[play\] headless world at /m.test(w.out()), 120000)) throw new Error('no world: ' + w.out().slice(-800)); return w};
  const asPage = path => path.startsWith('/play/runner') ? {origin: PAGE} : {}; // only the runner routes take the page; the rest refuse a browser origin
  const get = (b, path) => fetch(b + path, {headers: asPage(path)}).then(r => r.json());
  const post = (b, path, body) => fetch(b + path, {method: 'POST', headers: {'content-type': 'application/json', ...asPage(path)}, body: JSON.stringify(body)}).then(async r => ({status: r.status, ...(await r.json().catch(() => ({})))}));
  const dmLog = () => {try {return readFileSync(join(tmp, 'runners', 'dm.log'), 'utf8')} catch {return ''}};
  const tag = provider + ' DM: ';
  try {
    console.log(`the DM on ${provider} (#824)`);
    // ---- one list ----
    ok([DM_PROVIDERS, RUNNER_PROVIDERS, SETUP_PROVIDERS, MIND_PROVIDERS].every(l => l === PROVIDERS) && PROVIDERS.includes(provider), tag + 'the DM, the runners, the setup page and the mind row read one provider list');
    const sd = checkStart({kind: 'dm', provider, model}, [], {});
    ok(!sd.error && sd.req.provider === provider && sd.req.budget === 1, tag + 'a DM runner may start with it and keeps its budget' + (sd.error ? ': ' + sd.error : ''));
    const r0 = rollDue({sessionId: null, ctx: 999999, turns: 99, local: {history: [{role: 'user', content: 'x'}]}}, 0);
    ok(r0 === null && rollPoint('dm', 'claude-haiku-5-5', {}) === 80000 && rollPoint('dm', model, {}) === 150000, tag + 'no roll by size: the price line is Haiku\'s, and the loop trims its own history');

    // ---- a setup choice reaches a running seat ----
    {
      const B = `http://127.0.0.1:${port}`, s = defaultSetup(4242, 'eldmoor', 0), mind = {mode: 'agent', provider, model};
      s.heroes.forEach(h => {h.mind = {...mind}}); s.dm = {...mind};
      const setup = cleanSetup(s), plan = planRunners(setup), dm = plan.find(j => j.kind === 'dm');
      ok(validateSetup(setup).length === 0 && dm && dm.provider === provider && dm.model === model, tag + 'the setup page\'s choice validates and plans a DM runner on it');
      const w = await world(['--fellowship', '--no-relay', '--runners', '--wait-ready', '--session-zero', '--speed', '4'], 'setup', port);
      for (const j of plan) {const r = await post(B, '/play/runner/start', {kind: j.kind, provider: j.provider, model: j.model, by: 'setup'}); ok(r.status === 200, tag + `the ${j.kind} runner starts from the setup plan` + (r.status === 200 ? '' : ': ' + r.error))}
      const seat = await until(async () => {const h = await get(B, '/play/health'); return h.dm && h.dm.claimed && h.dm.runner && h.dm.runner.provider === provider && h.dm.ready ? h.dm : null});
      ok(seat && seat.runner.model === model, tag + 'the seat is claimed, tagged and warmed up: ' + JSON.stringify(seat && seat.runner) + (seat ? '' : '\n' + dmLog().slice(-1200)));
      const prep = await until(() => /prep over/.test(dmLog()), 90000);
      ok(prep && /preparing the table \(opening\)/.test(dmLog()), tag + 'it reaches the DM\'s prep before session zero' + (prep ? '' : '\n' + dmLog().slice(-1200)));
      const framed = await until(() => /\[table\] call \d+ [^:]*: "/.test(dmLog()), 60000);
      ok(framed, tag + 'its table voice frames the opening scene through the game' + (framed ? '' : '\n' + dmLog().slice(-1200)));
      ok(!/has no DM runner/.test(dmLog()), tag + 'no refusal');
      const rr = (await get(B, '/play/runner')).runners.find(r => r.key === 'dm');
      ok(rr && rr.provider === provider && rr.model === model && !rr.claudeSlots && rr.budget === 1, tag + 'the supervisor shows its mind, its budget and no Claude slot');
      const act = JSON.parse(readFileSync(join(tmp, 'runners', 'active.json'), 'utf8')).runners.find(r => r.kind === 'dm');
      ok(act && act.provider === provider && act.model === model, tag + '--resume-runners has the provider and model to start it with');
      await post(B, '/play/runner/stop-all', {why: 'test'}); w.p.kill(); await w.done;
    }

    // ---- turns and the ruling voice in a world, a switch of provider, a fresh session ----
    {
      const B = `http://127.0.0.1:${port + 1}`, w = await world(['--fellowship', '--no-relay', '--dm', '--speed', '1'], 'play', port + 1);
      const hero = (await get(B, '/play/health')).heroes[0];
      // a Claude conversation left in the seat by the run before, and what that DM wrote in the game
      mkdirSync(join(tmp, 'agents'), {recursive: true});
      const st = await post(B, '/play/dm', {tool: 'dm_status', args: {}, role: 'dm'});
      const nw = await post(B, '/play/dm', {tool: 'notes_write', args: {op: 'add', section: 'plans', title: 'The bell at Hollow Ford', text: 'Ring it when they cross.'}, role: 'dm'});
      const wn = await post(B, '/play/dm', {tool: 'when', args: {trigger: 'after_hours', on: {h: 40}, action: 'narrate', args: {text: 'A bell tolls.', near: 'table'}, hours: 60, reason: 'a test'}, role: 'dm'});
      ok(nw.ok !== false && wn.ok !== false, tag + 'the old DM left a note and a when' + (wn.ok === false ? ': ' + wn.error : nw.ok === false ? ': ' + nw.error : ''));
      writeFileSync(join(tmp, 'agents', 'dm.json'), JSON.stringify({sessionId: 'claude-session-1', world: st.world, system: 'old orders', turns: 7, costUsd: .5, lastTotal: .5, lastGm: 0, runner: {provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'medium'}}));
      const n0 = seen ? seen.length : 0, dm = run(['scripts/dm-agent.mjs', '--url', B, '--provider', provider, '--model', model, '--cadence', '5', '--budget', '1'], {pipe: true, e: {...env, ELDMOOR_SUPERVISED: '1'}});
      const turn1 = await until(() => /\[turn 1\] /.test(dm.out()));
      ok(turn1 && new RegExp(`\\[turn 1\\] ${reEsc(model)} \\(${provider}\\) \\| 2 tool calls.*\\| run \\$\\d+\\.\\d+`).test(dm.out()), tag + 'it plays a turn through the DM tools, with the line the supervisor reads' + (turn1 ? '' : '\n' + dm.out().slice(-1500)));
      ok(/> dm_status\(\)/.test(dm.out()) && /> notes_read\(\)/.test(dm.out()), tag + 'it reads the seat and its notes');
      ok(new RegExp(`the seat changes mind \\(anthropic -> ${provider}\\)`).test(dm.out()), tag + 'another provider sets the old conversation aside');
      const old = readdirSync(join(tmp, 'agents', 'old')).filter(f => f.startsWith('dm-')), kept = old.length && JSON.parse(readFileSync(join(tmp, 'agents', 'old', old[0]), 'utf8')), now = JSON.parse(readFileSync(join(tmp, 'agents', 'dm.json'), 'utf8'));
      ok(kept && kept.sessionId === 'claude-session-1' && !now.sessionId && now.runner.provider === provider && now.turns >= 1, tag + 'the Claude session waits in logs/agents/old/, dm.json starts over on the new mind');
      if (seen) {const q = seen.slice(n0).find(b => (b.tools || []).length && b.messages.some(m => m.role === 'user' && RESUME.test(m.content)));
        ok(q, tag + 'the first turn is told to read its notes and the DM log');
        ok(q && q.tools.length >= 60 && q.tools.every(t => t.function.description.length <= 1024) && /More on your tools:[\s\S]*stage_scene: /.test(q.messages[0].content), tag + 'every DM tool goes out inside the description limit; the rest rides in the system message')}
      await until(() => /ruling voice: /.test(dm.out())); await sleep(800);
      const at = await post(B, '/play/call', {tool: 'attempt', args: {what: 'I study the old carvings on the gate stones.'}, hero: hero.id});
      const ruled = await until(() => /\[ruling\] .* -> (?!x )/.test(dm.out()), 30000);
      ok(at.ok !== false && ruled, tag + 'its ruling voice rules on a hero\'s attempt through the game' + (ruled ? '' : ': ' + JSON.stringify(at).slice(0, 200) + '\n' + dm.out().slice(-800)));
      const n1 = seen ? seen.length : 0; dm.p.stdin.write('fresh\n');
      const rolled = await until(() => /\[session rolled: a fresh session was asked for\]/.test(dm.out()), 30000);
      ok(rolled, tag + 'a fresh session asked from the page rolls it' + (rolled ? '' : '\n' + dm.out().slice(-800)));
      if (seen) ok(await until(() => seen.slice(n1).some(b => (b.tools || []).length && b.messages.some(m => m.role === 'user' && RESUME.test(m.content))), 20000), tag + 'and the turn after it is told to read its notes');
      dm.p.stdin.write('stop\n'); const code = await dm.done;
      ok(code === 0 && !dm.out().includes(env[KEY_NAME[provider]]), tag + 'it leaves the seat on a stop, and the key is not in its output');
      const notes = await post(B, '/play/dm', {tool: 'notes_read', args: {}, role: 'dm'}), whens = await post(B, '/play/dm', {tool: 'whens', args: {}, role: 'dm'});
      ok(/Ring it when they cross/.test(JSON.stringify(notes)) && /after_hours/.test(JSON.stringify(whens)), tag + 'the notes and whens stay with the world' + (/after_hours/.test(JSON.stringify(whens)) ? '' : ': ' + JSON.stringify(whens).slice(0, 200)));
      w.p.kill(); await w.done;
    }

    // ---- every voice on the provider's adapter ----
    {
      const o = await openaiRunner({provider, model}, env, {explicit: true}), asked = [], costs = [];
      const adapter = {...o.adapter, call: a => {asked.push(a.schema); return o.adapter.call(a)}};
      const voice = async (start, poll, call, answer) => {const got = []; let sent = false;
        const tool = async (b, t, a) => {if (t === poll) {if (sent) return {ok: true}; sent = true; return call} if (t === answer) {got.push(a); return {ok: true, said: a.text}} return {ok: true}};
        const v = start({base: 'x', adapter, model, tool, onCost: u => costs.push(u), pollIdle: 10, pollHot: 10, waitMs: 0, log: () => {}});
        const r = await until(() => got[0], 15000, 20); await v.stop(); return r};
      const table = await voice(tableVoice, 'table_call', {ok: true, scene: {title: 'At the ford', kind: 'meeting', cast: ['a ferryman']}, call: {id: 1, kind: 'complication', about: 'Pick one', legal: ['none', 'omen'], seconds_left: 8}}, 'table_answer');
      ok(table && table.pick === 'none' && table.text, tag + 'table voice: one structured answer, a legal pick');
      const talk = await voice(talkVoice, 'npc_call', {ok: true, call: {call: 1, conv: 1, seconds_left: 8, exchange: 1, line: 'Any word?', offers: ['rumour', 'leave'], npc: {id: 1, name: 'Mara', role: 'innkeeper', faction: 'Concord', where: 'the town', want: 'news', mood: 'wary'}, member: {name: 'Ann', lvl: 1, cls: 'Warrior'}}}, 'npc_say');
      ok(talk && talk.text, tag + 'talk voice: the person answers');
      const comp = await voice(companionVoice, 'companion_call', {ok: true, call: {call: 1, seconds_left: 8, trigger: 'camp', where: 'the fen', time: '20:00', topic: 'home', companion: {name: 'Bram', level: 3, cls: 'Warrior', rides: 'hired for 3 days'}, listeners: [{name: 'Ann', cls: 'Mage', level: 2}]}}, 'companion_say');
      ok(comp && comp.text, tag + 'companion voice: the companion speaks');
      const rule = await voice(rulingVoice, 'ruling_call', {ok: true, call: {call: 1, seconds_left: 8, hero: {name: 'Ann', cls: 'Mage', level: 'level 2', health: 'unhurt', best_skills: ['Lore']}, attempt: {what: 'I read the stones.'}, where: {region: 'the fen', x: 1, y: 2}, legal: {skills: ['Lore', 'Perception'], dc: {easy: 8, fair: 12}, effects: ['none', 'reveal'], effect_forms: ['none']}}}, 'ruling_answer');
      ok(rule && rule.skill === 'Lore' && rule.dc === 'easy' && rule.text, tag + 'ruling voice: skill and DC from the enums');
      const bad = asked.map(s => strictProblem(s)).filter(Boolean);
      ok(asked.length === 4 && !bad.length, tag + 'all four voice schemas pass strict mode' + (bad.length ? ': ' + bad.join('; ') : ''));
      ok(costs.length === 4, tag + 'each voice call reports its cost to the budget');
    }

    // ---- the budget: a voice spends the last of it between turns ----
    if (pricey) {
      const B = `http://127.0.0.1:${port + 2}`, w = await world(['--fellowship', '--no-relay', '--dm', '--runners', '--speed', '1'], 'budget', port + 2);
      const hero = (await get(B, '/play/health')).heroes[0];
      const r = await post(B, '/play/runner/start', {kind: 'dm', provider, model: pricey.model, budget: pricey.budget, by: 'owner'});
      ok(r.status === 200, tag + 'a paid DM starts with a budget' + (r.status === 200 ? '' : ': ' + r.error));
      const log = () => dmLog().split('=== ').slice(-2).join('');
      await until(() => /\[turn 1\] /.test(log()) && /ruling voice: /.test(log())); await sleep(800);
      await post(B, '/play/call', {tool: 'attempt', args: {what: 'I read the weather in the gate crows.'}, hero: hero.id});
      const stopped = await until(async () => {const x = (await get(B, '/play/runner')).runners.find(q => q.key === 'dm'); return x && (x.state === 'stopped' || x.state === 'crashed') ? x : null}, 40000);
      ok(stopped && stopped.budgetSpent && stopped.spentWhy === 'budget reached' && stopped.state === 'stopped', tag + 'the voice\'s spend ends the run as a budget stop (#807)' + (stopped ? '' : '\n' + log().slice(-1000)));
      ok(stopped && stopped.cost >= pricey.budget && !/\[turn 2\] /.test(log()), tag + `no further turn is paid for, and the page sees the spend ($${stopped && stopped.cost} of $${pricey.budget})`);
      const ev = readFileSync(join(tmp, 'runners', 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
      ok(ev.some(l => /"budget"/.test(l) && /budget reached/.test(l)), tag + 'logs/runners/events.jsonl records the budget stop');
      const auto = JSON.parse(readFileSync(join(tmp, 'runners', 'active.json'), 'utf8'));
      ok((auto.spent || []).some(x => x.key === 'dm') && !(auto.runners || []).some(x => x.kind === 'dm'), tag + 'nothing automatic brings it back: it is on the spent list, not the resume list');
      await post(B, '/play/runner/stop-all', {why: 'test'}); w.p.kill(); await w.done;
    }
  } finally {
    for (const k of kids) try {k.kill()} catch {}
    await sleep(300); try {rmSync(tmp, {recursive: true, force: true})} catch {}
  }
}
