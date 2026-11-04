// Session size check (issue #787): Claude sessions stay under Haiku's price line. No key and no network: the real Agent SDK and its
// real CLI binary talk to a mock Messages API on localhost, which reports whatever usage the test asks for.
//   1. The rules: roll points, the compaction window, when a roll is due and when it is held, what a roll keeps, the context size.
//   2. The real CLI: CLAUDE_CODE_AUTO_COMPACT_WINDOW through query()'s env moves getContextUsage().autoCompactThreshold, a
//      compact_boundary comes, the next request is smaller and the system prompt is the same.
//   3. `npm run agent` end to end on a headless world: `ctx` on the turn line, a roll at the roll point, the old file in old/, the new
//      session told to read its journal, standing orders and persona block and claim unchanged; held back while a scene is open.
//   4. `npm run fellowship`: every member rolls, the run record counts it. 5. `npm run dm`: the DM rolls at its own point and re-reads
//      its notes. 6. A "fresh" line on stdin rolls at the next safe moment. 7. AGENT_HEAR_WAKE_MIN. 8. The report's context table.
// Sessions go to a temporary folder (AGENT_LOGS, CLAUDE_CONFIG_DIR), never to logs/agents/ or the owner's ~/.claude.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {ROLL, rollPoint, compactWindow, compactThreshold, withCompactWindow, ctxOf, ctxText, rollDue, rollSession, askFresh} from './session-roll.mjs';
import {paceSettings} from './pacing.mjs';
import {ctxSection, compareMinds} from './mind-compare.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0; const ok = (c, m) => {console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-session-'));

// ---------------------------------------------------------------- 1. the rules
console.log('the rules');
ok(rollPoint('hero', 'claude-haiku-5-5') === 80000 && rollPoint('hero', 'claude-sonnet-5-5') === 80000, 'heroes roll at 80k whatever the model');
ok(rollPoint('dm', 'claude-sonnet-5-5') === 150000, 'a Sonnet DM (no price line) rolls at 150k');
ok(rollPoint('dm', 'claude-haiku-5-5') === 80000, 'a Haiku DM stays under the line: the line is the model\'s, not the seat\'s');
ok(rollPoint('hero', 'x', {SESSION_ROLL_TOKENS: '60000'}) === 60000 && rollPoint('dm', 'claude-haiku-5-5', {DM_ROLL_TOKENS: '90000'}) === 90000 && rollPoint('hero', 'x', {SESSION_ROLL_TOKENS: '0'}) === 0, 'SESSION_ROLL_TOKENS and DM_ROLL_TOKENS set them, 0 turns the roll off');
ok(compactWindow(80000) === 120000 && compactThreshold(120000) === 87000, 'the net sits above the roll point and under the line: window 120k compacts at 87k');
ok(compactThreshold(compactWindow(80000)) > 80000 && compactThreshold(compactWindow(80000)) < ROLL.LINE, 'so the roll, which never touches a scene, goes first');
ok(compactWindow(150000) === 190000 && compactWindow(0) === 100000 && compactWindow(2e6) === 1000000, 'the window stays in the range the CLI takes, and a roll turned off keeps the net');
ok(withCompactWindow({}, 80000).CLAUDE_CODE_AUTO_COMPACT_WINDOW === '120000' && withCompactWindow({CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000'}, 80000).CLAUDE_CODE_AUTO_COMPACT_WINDOW === '300000' && withCompactWindow({}, 80000, {CLAUDE_CODE_AUTO_COMPACT_WINDOW: '250000'}).CLAUDE_CODE_AUTO_COMPACT_WINDOW === '250000', 'the owner\'s own window wins');
ok(ctxOf({input_tokens: 5, cache_read_input_tokens: 83000, cache_creation_input_tokens: 400, output_tokens: 900}) === 83405, 'ctx is the whole prompt: uncached, cache reads and cache writes, never output');
ok(ctxOf(null) === null && ctxOf({output_tokens: 3}) === null, 'no usage, no size');
ok(ctxText(212345) === 'ctx 212k' && ctxText(null) === 'ctx ?', 'the turn line says ctx 212k');
{
  const S = o => ({sessionId: 's1', turns: 20, ctx: 83000, ...o});
  ok(rollDue(S(), 80000).why === 'size' && rollDue(S(), 80000).line === '[session rolled: 83k tokens]', 'past the roll point a roll is due, with the line the logs carry');
  ok(rollDue(S({ctx: 79999}), 80000) === null, 'under it, none');
  ok(rollDue(S(), 80000, {busy: true}) === null, 'never while busy (a scene open or due, a reflection, a turn carrying on)');
  ok(rollDue(S(), 0) === null, 'never with the roll off');
  ok(rollDue(S({sessionId: null}), 80000) === null, 'nothing to roll without a session');
  ok(rollDue(S({ctx: null, turns: 44}), 80000).why === 'legacy', 'a long session saved before ctx was kept rolls at once: it is not paid for again');
  ok(rollDue(S({ctx: null, turns: 3}), 80000) === null, 'a short one plays on until its size is known');
  ok(rollDue(S({ctx: null, turns: 44}), 150000, {legacy: false}) === null, 'a Sonnet DM, far under its point, is not rolled unseen');
  const s = {sessionId: 's1', heroId: 7, system: 'orders\nYOUR PERSONA\nbold\n(end of your persona)', runner: {provider: 'anthropic', model: 'claude-haiku-5-5'}, turns: 44, costUsd: 1.5, lastTotal: 1.2, lastUsage: {tokensIn: 9}, ctx: 212000, lastScene: 'x'}; let aside = 0;
  rollSession(s, () => {aside++; return 'path'});
  ok(aside === 1 && s.sessionId === null && s.ctx === null && s.lastTotal === 0 && s.lastUsage === null, 'a roll sets the file aside and restarts the session and its cost baselines');
  ok(s.system.includes('YOUR PERSONA') && s.runner.model === 'claude-haiku-5-5' && s.turns === 44 && s.costUsd === 1.5 && s.lastScene === 'x' && s.rolled && s.rolls === 1, 'and keeps the standing orders, the persona, the mind, the turn count, the spend and the scene marks');
  const L = {sessionId: null, local: {mode: 'tools', history: [{role: 'user'}]}, turns: 3}; askFresh();
  const f = rollDue(L, 0); ok(f && f.why === 'asked', 'a fresh session asked from the page rolls a local mind too');
  rollSession(L, () => null); ok(L.local.history.length === 0 && L.local.mode === 'tools' && rollDue(L, 0) === null, 'its history is emptied, once');
}

// A save while someone has the file open (Windows refuses the rename): retried, never fatal. The poll in section 3 found this as a crash.
{
  const {saveSession, sessionPath} = await import('./agent-sessions.mjs'), logs = join(tmp, 'lockcheck');
  saveSession({heroId: 9, turns: 1}, {}, logs);
  const fs = await import('node:fs'), fd = fs.openSync(sessionPath(9, logs), 'r'); let threw = null;
  try {saveSession({heroId: 9, turns: 2}, {}, logs)} catch (e) {threw = e}
  fs.closeSync(fd); saveSession({heroId: 9, turns: 3}, {}, logs);
  ok(!threw, 'a save over an open session file does not throw');
  ok(JSON.parse(fs.readFileSync(sessionPath(9, logs), 'utf8')).turns === 3, 'and the next save lands');
}

// ---------------------------------------------------------------- the mock Messages API
function mockApi() {
  const m = {calls: [], ctx: () => 30000, port: 0, close: () => srv.close()};
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      if (!/\/v1\/messages/.test(req.url)) {res.writeHead(404, {'content-type': 'application/json'}); return res.end('{"type":"error","error":{"type":"not_found_error","message":"mock"}}')}
      if (req.url.includes('count_tokens')) {res.writeHead(200, {'content-type': 'application/json'}); return res.end('{"input_tokens":1000}')}
      const j = JSON.parse(b), tail = j.messages.slice(-2).flatMap(x => Array.isArray(x.content) ? x.content : [{type: 'text', text: x.content}]), isResult = tail.some(x => x.type === 'tool_result'); // the CLI adds its budget line after the result
      const summary = tail.some(x => x.type === 'text' && /summary of the conversation|detailed summary|summarize/i.test(x.text)); // a compaction: it carries the tools too, and wants words
      const tool = (j.tools || []).map(t => t.name).find(n => /__(status|dm_status)$/.test(n)) || null;
      const sys = typeof j.system === 'string' ? j.system : (j.system || []).map(x => x.text).join('\n');
      const text = JSON.stringify(j.messages), userText = j.messages.filter(x => x.role === 'user').flatMap(x => Array.isArray(x.content) ? x.content : [{type: 'text', text: x.content}]).filter(x => x.type === 'text').map(x => x.text).join('\n');
      m.calls.push({n: m.calls.length + 1, sys, chars: text.length, msgs: j.messages.length, tool: !!tool, isResult, userText, model: j.model});
      const content = tool && !isResult && !summary ? [{type: 'tool_use', id: 'toolu_' + m.calls.length, name: tool, input: {}}] : [{type: 'text', text: 'The road goes on.'}];
      const usage = {input_tokens: 5, cache_read_input_tokens: m.ctx(m.calls[m.calls.length - 1]), cache_creation_input_tokens: 100, output_tokens: 7};
      const msg = {id: 'msg_' + m.calls.length, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage}, stop = content[0].type === 'tool_use' ? 'tool_use' : 'end_turn';
      if (!j.stream) {res.writeHead(200, {'content-type': 'application/json'}); return res.end(JSON.stringify({...msg, content, stop_reason: stop}))}
      res.writeHead(200, {'content-type': 'text/event-stream'});
      const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({type: t, ...d})}\n\n`), c = content[0];
      ev('message_start', {message: msg});
      if (c.type === 'text') {ev('content_block_start', {index: 0, content_block: {type: 'text', text: ''}}); ev('content_block_delta', {index: 0, delta: {type: 'text_delta', text: c.text}})}
      else {ev('content_block_start', {index: 0, content_block: {...c, input: {}}}); ev('content_block_delta', {index: 0, delta: {type: 'input_json_delta', partial_json: '{}'}})}
      ev('content_block_stop', {index: 0}); ev('message_delta', {delta: {stop_reason: stop, stop_sequence: null}, usage: {output_tokens: 7}}); ev('message_stop', {}); res.end();
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => {m.port = srv.address().port; m.url = `http://127.0.0.1:${m.port}`; r(m)}));
}
const api = await mockApi();
const cfg = join(tmp, 'claude'), base = {PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR, HOME: tmp, USERPROFILE: tmp,
  ANTHROPIC_API_KEY: 'sk-ant-mock-not-a-key', ANTHROPIC_BASE_URL: api.url, CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1'};
for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];

// ---------------------------------------------------------------- 2. the real CLI
console.log('the real CLI against the mock API');
async function cliTurn(env, prompt, resume, seen) {
  const q = query({prompt, options: {model: 'claude-haiku-5-5', systemPrompt: 'You keep the road.', resume, tools: [], permissionMode: 'dontAsk', settingSources: [], settings: {autoCompactEnabled: true}, maxTurns: 3, cwd: tmp, env}});
  let id = resume, asked = false;
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') {id = m.session_id; if (!asked) {asked = true; seen.usage = await q.getContextUsage({detail: 'summary'})}}
    else if (m.type === 'system' && m.subtype === 'compact_boundary') seen.boundary = m.compact_metadata;
  }
  return id;
}
{
  api.ctx = () => 90000;
  const plain = {}; await cliTurn({...base}, 'first', undefined, plain);
  ok(plain.usage && plain.usage.autoCompactThreshold > 900000, `left alone the SDK compacts near the 1M window: ${plain.usage && plain.usage.autoCompactThreshold} (the issue's 967k)`);
  const env = withCompactWindow({...base}, ROLL.HERO), seen = {}; api.calls.length = 0;
  let id = await cliTurn(env, 'first', undefined, seen);
  ok(seen.usage && seen.usage.autoCompactThreshold === 87000 && seen.usage.isAutoCompactEnabled, `through query()'s env the threshold is ${seen.usage && seen.usage.autoCompactThreshold} (window ${env.CLAUDE_CODE_AUTO_COMPACT_WINDOW})`);
  for (let t = 2; t <= 4 && !seen.boundary; t++) id = await cliTurn(env, 'turn ' + t, id, seen);
  ok(seen.boundary && seen.boundary.trigger === 'auto' && seen.boundary.pre_tokens > 87000, `a session past it compacts: ${seen.boundary && seen.boundary.pre_tokens} -> ${seen.boundary && seen.boundary.post_tokens} tokens`);
  const before = api.calls.length; api.ctx = () => 3000; await cliTurn(env, 'after', id, seen);
  const after = api.calls[api.calls.length - 1];
  ok(api.calls.length > before && api.calls[0].sys.includes('You keep the road.') && after.sys.includes('You keep the road.') && after.sys.length === api.calls[0].sys.length, 'the standing orders survive a compaction unchanged');
  ok(seen.boundary && seen.boundary.post_tokens < 20000, 'and the conversation shrinks to a summary');
}

// ---------------------------------------------------------------- 3. the hero runner end to end
const envDir = join(tmp, 'envdir'); (await import('node:fs')).mkdirSync(envDir); writeFileSync(join(envDir, '.env'), ''); // --env: never the owner's .env
const childEnv = {...process.env, ...base, AGENT_LOGS: tmp, AGENT_MODEL: 'claude-haiku-5-5', DM_MODEL: 'claude-sonnet-5-5', AGENT_REFLECT: '0'};
delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT; delete childEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW; delete childEnv.AGENT_HEAR_WAKE_MIN; delete childEnv.SESSION_ROLL_TOKENS; delete childEnv.DM_ROLL_TOKENS; delete childEnv.ELDMOOR_SUPERVISED;
const kids = [];
function start(args, {wait = null, env = childEnv, stdin = 'ignore'} = {}) {
  const p = spawn(process.execPath, args, {cwd: ROOT, env, stdio: [stdin, 'pipe', 'pipe']}); kids.push(p); let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const done = new Promise(r => p.on('close', r));
  const until = wait ? new Promise((res, rej) => {const t = setInterval(() => {if (wait.test(out)) {clearInterval(t); res()}}, 100); setTimeout(() => {clearInterval(t); rej(new Error('timeout waiting for ' + wait + '\n' + out))}, 120000)}) : null;
  return {p, done, until, out: () => out};
}
const until = async (f, ms = 90000) => {const t0 = Date.now(); for (;;) {const v = await f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100)}};
const readSess = id => {try {return JSON.parse(readFileSync(join(tmp, 'agents', id + '.json'), 'utf8'))} catch {return null}};
const oldFiles = () => {try {return readdirSync(join(tmp, 'agents', 'old'))} catch {return []}};
const port = 18100 + Math.floor(Math.random() * 500), WORLD = `http://127.0.0.1:${port}`;
const health = u => fetch(u + '/play/health').then(r => r.json());
// A pass-through in front of the world that can say the hero's table is open in the state header.
function proxy(target) {
  const p = {table: false, port: 0, close: () => srv.close()};
  const srv = http.createServer((req, res) => {let b = []; req.on('data', d => b.push(d)); req.on('end', () => {b = Buffer.concat(b);
    const fwd = http.request(target + req.url, {method: req.method, headers: req.headers}, r => {
      const isBrief = req.url.startsWith('/play/pace') && /"brief":true/.test(b.toString());
      if (!isBrief || !p.table) {res.writeHead(r.statusCode, r.headers); return r.pipe(res)}
      let t = ''; r.on('data', d => t += d); r.on('end', () => {let j = {}; try {j = JSON.parse(t)} catch {} if (j.brief) j.brief.table = true; const s = JSON.stringify(j); const h = {...r.headers}; delete h['content-length']; delete h['transfer-encoding']; res.writeHead(r.statusCode, h); res.end(s)})});
    fwd.on('error', () => {res.writeHead(502); res.end()}); fwd.end(b)})});
  return new Promise(r => srv.listen(0, '127.0.0.1', () => {p.port = srv.address().port; p.url = `http://127.0.0.1:${p.port}`; r(p)}));
}
console.log('npm run agent on a headless world');
const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '1', '--quiet', '--speed', '8', '--world', join(tmp, 'world.json')], {wait: /^\[play\] headless world at /m});
await world.until;
const hero = (await health(WORLD)).heroes[0], px = await proxy(WORLD);
{
  api.calls.length = 0; api.ctx = () => 30000;
  const run = start(['scripts/agent-player.mjs', '--url', px.url, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--max-turns', '12', '--min-gap', '0', '--heartbeat', '5', '--budget', '1'], {stdin: 'pipe'});
  ok(await until(() => /\| ctx 30k \| turn \$/.test(run.out())), 'the turn line carries ctx beside the cost');
  ok(/\[session\] compaction net at 87k tokens/.test(run.out()), 'the runner reads the threshold back from getContextUsage and says it');
  const s1 = await until(() => {const s = readSess(hero.id); return s && s.ctx === 30105 ? s : null});
  ok(s1 && s1.sessionId && s1.system.includes('YOUR PERSONA'), `the session file keeps the size (${s1 && s1.ctx}) with the session ${s1 && s1.sessionId}`);
  const sid = s1.sessionId, orders = s1.system;
  // a scene: no roll however large the session
  px.table = true; api.ctx = () => 85000;
  ok(await until(() => /\| ctx 85k \| turn \$/.test(run.out())), 'a large session reports ctx 85k');
  const n0 = (run.out().match(/\| ctx 85k/g) || []).length;
  ok(await until(() => (run.out().match(/\| ctx 85k/g) || []).length > n0), 'with the table open the next turn plays on');
  ok(!/session rolled/.test(run.out()) && readSess(hero.id).sessionId === sid && !oldFiles().length, 'and nothing rolls mid-scene, past the roll point or not');
  const since = api.calls.length; px.table = false; api.ctx = () => 26000;
  ok(await until(() => /\[session rolled: 85k tokens\]/.test(run.out())), 'the table closed, the next turn rolls: [session rolled: 85k tokens]');
  const s2 = await until(() => {const s = readSess(hero.id); return s && s.sessionId && s.sessionId !== sid ? s : null});
  ok(s2 && s2.rolls === 1 && s2.system === orders && s2.runner && s2.runner.model === 'claude-haiku-5-5' && s2.turns >= 3, 'the session file has a new session, the same standing orders and mind, the turns counted on, one roll');
  ok(oldFiles().some(f => f.startsWith(hero.id + '-')), `the old file lies in old/: ${oldFiles().join(', ')}`);
  const fresh = await until(() => api.calls.slice(since).find(c => c.tool && !c.isResult && c.msgs <= 2)); // the line comes just before the call
  ok(fresh && /journal_read/.test(fresh.userText), 'the new session starts small and is told to read its journal');
  ok(fresh && fresh.sys.includes(orders.slice(0, 200)), 'with its standing orders');
  const h = await health(WORLD), me = h.heroes.find(x => x.id === hero.id); ok(me && me.link !== 'none', `the claim held through the roll (link ${me && me.link})`);
  ok(await until(() => {const s = readSess(hero.id); return s && s.ctx === 26105}), 'and the next turns report the small size');
  await run.done;
  if (!/\b1 rolls, 0 compactions/.test(run.out())) console.log(run.out().split('\n').slice(-25).map(l => '    | ' + l.slice(0, 200)).join('\n'));
  ok(/\b1 rolls, 0 compactions/.test(run.out()), 'the run ends counting its rolls');
  const jsonl = name => {try {return readdirSync(join(tmp, 'behavior')).flatMap(d => readFileSync(join(tmp, 'behavior', d, name), 'utf8').trim().split('\n').map(l => JSON.parse(l)))} catch {return []}};
  const lines = jsonl('turns.jsonl');
  ok(await until(() => jsonl('world.jsonl').some(w => w.ctx && Object.values(w.ctx).some(Number.isFinite)), 20000), 'the world digest carries each seat\'s size');
  ok(lines.some(t => t.ctx === 85105) && lines.some(t => (t.flags || []).includes('session-rolled')), `the behavior turn lines carry ctx and the roll (${lines.length} lines)`);
}
// A resume after an update: a long session with no size kept rolls before it is paid for.
{
  const s = readSess(hero.id); delete s.ctx; s.turns = 44; writeFileSync(join(tmp, 'agents', hero.id + '.json'), JSON.stringify(s)); api.ctx = () => 26000;
  const run = start(['scripts/agent-player.mjs', '--url', WORLD, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--max-turns', '1', '--min-gap', '0', '--heartbeat', '5', '--budget', '1']);
  await run.done;
  ok(/\[session rolled: size not kept, 44 turns\]/.test(run.out()), 'a long session from before this fix rolls on its first turn, before a call is paid for at the old size');
}
// The page's Fresh session: a "fresh" line on stdin, and --new keeps the mind.
{
  api.ctx = () => 26000;
  const run = start(['scripts/agent-player.mjs', '--url', WORLD, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--min-gap', '0', '--heartbeat', '5', '--budget', '1'], {stdin: 'pipe', env: {...childEnv, ELDMOOR_SUPERVISED: '1', AGENT_HEAR_WAKE_MIN: '45'}});
  ok(await until(() => /\| ctx 26k \| turn \$/.test(run.out())), 'a supervised runner plays');
  run.p.stdin.write('fresh\n');
  ok(await until(() => /\[session rolled: a fresh session was asked for\]/.test(run.out())), 'a "fresh" line rolls it at the next turn');
  run.p.stdin.write('stop\n'); await run.done;
  const again = start(['scripts/agent-player.mjs', '--url', WORLD, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--new', '--max-turns', '1', '--min-gap', '0', '--heartbeat', '5', '--budget', '1'], {env: {...childEnv, AGENT_MODEL: 'claude-sonnet-5-5'}});
  await again.done; const s = readSess(hero.id);
  ok(s && s.runner && s.runner.model === 'claude-haiku-5-5' && /earlier session kept/.test(again.out()), '--new sets the conversation aside and keeps the hero\'s mind');
}
// The net inside a turn: a roll held back by a scene and a session past it, compacted between two calls of one turn.
{
  px.table = true; api.ctx = () => 95000;
  const run = start(['scripts/agent-player.mjs', '--url', px.url, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--max-turns', '4', '--min-gap', '0', '--heartbeat', '5', '--budget', '1']);
  await run.done; const s = readSess(hero.id), m = run.out().match(/\[compacted: (\d+) -> (\d+) tokens\]/);
  ok(m && Number(m[2]) < Number(m[1]) && s.compacts >= 1, `past the net, in a runner, with the roll held back: ${m ? m[0] : 'no compaction'}`);
  ok(!/session rolled/.test(run.out()), 'and still no roll with the table open');
  px.table = false;
}
world.p.kill(); px.close(); await sleep(300);

// ---------------------------------------------------------------- 4. the Fellowship runner
console.log('npm run fellowship on a headless Fellowship');
{
  const fport = port + 601, FW = `http://127.0.0.1:${fport}`;
  const fw = start(['scripts/play-headless.mjs', '--fellowship', '--no-relay', '--port', String(fport), '--quiet', '--speed', '1', '--world', join(tmp, 'fworld.json')], {wait: /^\[play\] headless world at /m});
  await fw.until; api.ctx = () => 85000; api.calls.length = 0;
  const run = start(['scripts/fellowship.mjs', '--url', FW, '--env', join(envDir, '.env'), '--max-turns', '2', '--min-gap', '0', '--heartbeat', '5', '--budget', '1', '--provider', 'anthropic', '--model', 'claude-haiku-5-5']);
  await run.done;
  const rolled = (run.out().match(/\[session rolled: 85k tokens\]/g) || []).length, turns = (run.out().match(/\| ctx 85k \| turn \$/g) || []).length;
  ok(turns >= 5, `the members' turn lines carry ctx (${turns})`);
  ok(rolled >= 1, `members roll past the roll point (${rolled})`);
  let rec = null; try {rec = readFileSync(join(tmp, 'fellowship-runs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).pop()} catch {}
  ok(rec && rec.members.reduce((t, m) => t + (m.rolls || 0), 0) === rolled, `the run record counts the rolls (${rec && rec.members.map(m => m.rolls).join(', ')})`);
  ok(rec && rec.members.some(m => m.ctx != null), 'and the last size');
  ok(oldFiles().length >= 1 + rolled, 'each member\'s old file lies in old/');
  fw.p.kill(); await sleep(300);
}

// ---------------------------------------------------------------- 5. the DM runner
console.log('npm run dm on a headless world');
{
  const dport = port + 701, DW = `http://127.0.0.1:${dport}`;
  const dw = start(['scripts/play-headless.mjs', '--dm', '--agents', '0', '--port', String(dport), '--quiet', '--speed', '8', '--world', join(tmp, 'dworld.json')], {wait: /^\[play\] headless world at /m});
  await dw.until; api.ctx = () => 155000; api.calls.length = 0;
  const run = start(['scripts/dm-agent.mjs', '--url', DW, '--env', join(envDir, '.env'), '--max-turns', '2', '--cadence', '5', '--min-gap', '0', '--budget', '1', '--no-table-voice', '--no-talk-voice', '--no-companion-voice', '--no-ruling-voice']);
  await run.done;
  ok(/\| ctx 155k \| turn \$/.test(run.out()), 'the DM\'s turn line carries ctx');
  ok(/\[session rolled: 155k tokens\]/.test(run.out()), 'a Sonnet DM rolls at its own point');
  ok(/compaction net at 157k tokens/.test(run.out()), 'with its net above it');
  ok(api.calls.some(c => c.tool && !c.isResult && c.msgs <= 2 && /notes_read/.test(c.userText) && /no memory of this conversation/.test(c.userText)), 'the rolled DM is told to read its notes');
  ok(oldFiles().some(f => f.startsWith('dm-')), 'its old file lies in old/');
  dw.p.kill(); await sleep(300);
}

// ---------------------------------------------------------------- 7. AGENT_HEAR_WAKE_MIN
console.log('the hear-wake knob');
{
  const opt = (k, d) => d;
  ok(paceSettings(opt, {}).hearWake === null, 'unset: the game keeps its 15');
  ok(paceSettings(opt, {AGENT_HEAR_WAKE_MIN: '45'}).hearWake === 45 && paceSettings(opt, {AGENT_HEAR_WAKE_MIN: '0'}).hearWake === null && paceSettings(opt, {AGENT_HEAR_WAKE_MIN: '9999'}).hearWake === 1440, 'AGENT_HEAR_WAKE_MIN reads as game minutes, in bounds');
  process.env.ELDMOOR_FELLOWSHIP = '0';
  const {init} = await import('../src/sim/index.js'), {S} = await import('../src/sim/state.js'), {hearWake} = await import('../src/sim/player.js'), {hostPace} = await import('../src/sim/player-host.js');
  init(); const a = S.agents.find(x => x.kind === 'hero'), f = S.agents.find(x => x.kind === 'hero' && x !== a); a.player = true; f.player = true;
  const line = {from: f, text: 'hail'};
  await hostPace(a.id, {realMs: 0, hearWake: 45});
  ok(a.playHearGap === 45, 'the pace call carries it to the listener');
  ok(hearWake(a, line) === 2 && hearWake(a, line) === 0, 'a line wakes once');
  S.gameMin += 20; ok(hearWake(a, line) === 0, 'not again after 20 game minutes, which the default 15 would');
  S.gameMin += 30; ok(hearWake(a, line) === 2, 'again after 45');
  await hostPace(a.id, {realMs: 0}); ok(a.playHearGap === undefined, 'a runner without the knob goes back to the default');
  S.gameMin += 20; ok(hearWake(a, line) === 2, 'at 15');
}

// ---------------------------------------------------------------- 8. the report
console.log('the behavior report');
{
  const t = (seat, ctx, cost, ts, flags = []) => ({seat, ts, provider: 'anthropic', model: 'claude-haiku-5-5', ctx, cost, tokensIn: 1, tokensOut: 1, cacheRead: 1, cacheWrite: 0, flags, tools: []});
  const T = [t('hero:1', 40000, .004, '2026-11-04T01:00:00Z'), t('hero:1', 90000, .005, '2026-11-04T01:01:00Z'), t('hero:1', 212000, .06, '2026-11-04T01:02:00Z', ['session-rolled'])];
  const md = ctxSection(T, (h, r) => [h.join('|'), ...r.map(x => x.join('|'))].join('\n')).join('\n');
  ok(/under 50k\|1\|1\|\$0\.0040/.test(md) && /200k\+\|1\|1\|\$0\.0600/.test(md), 'cost per turn by prompt size');
  const row = compareMinds(T, [], []).rows[0];
  ok(row.rolls === 1 && row.ctx.length === 3 && row.t1 - row.t0 === 120000, 'the Mind comparison has what turns per minute and context need');
}

for (const k of kids) try {k.kill()} catch {}
api.close(); await sleep(300);
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fail ? `\nsessioncheck: ${fail} FAILED` : '\nsessioncheck: all ok');
process.exit(fail ? 1 : 0);
