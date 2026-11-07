// Session size check (issue #787): Claude sessions stay under Haiku's price line. No key and no network: the real Agent SDK and its
// real CLI binary talk to a mock Messages API on localhost, which reports whatever usage the test asks for.
//   1. The rules: roll points, the compaction window, when a roll is due and when it is held, what a roll keeps, the context size.
//   2. The real CLI: CLAUDE_CODE_AUTO_COMPACT_WINDOW through query()'s env moves getContextUsage().autoCompactThreshold, a
//      compact_boundary comes, the next request is smaller and the system prompt is the same.
//   3. `npm run agent` end to end on a headless world: `ctx` on the turn line, a roll at the roll point, the old file in old/, the new
//      session told to read its journal, standing orders and persona block and claim unchanged; held back while a scene is open.
//   4. `npm run fellowship`: every member rolls, the run record counts it. 5. `npm run dm`: the DM rolls at its own point and re-reads
//      its notes. 1b. The recap a fresh session carries (#808). 2d. `/compact` between turns on the real CLI, the option the recap was weighed against. 2b. A wait with turn_over ends the turn with no further model call, through the real /mcp route (#868). 2c. Lazy tools (#808): the schemas of
//      the cold tools leave the prompt, a deferred tool is found and called, and how much the prompt shrinks; the runners with the switch on and off. 6. A "fresh" line on stdin rolls at the next safe moment. 7. AGENT_HEAR_WAKE_MIN. 8. The report's context table.
// Sessions go to a temporary folder (AGENT_LOGS, CLAUDE_CONFIG_DIR), never to logs/agents/ or the owner's ~/.claude.
import {mkTmp} from './tmp.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {ROLL, rollPoint, compactWindow, compactThreshold, withCompactWindow, ctxOf, ctxText, rollDue, rollSession, askFresh} from './session-roll.mjs';
import {RECAP, noteTurn, recapNote, recapOn} from './session-recap.mjs';
import {paceSettings} from './pacing.mjs';
import {ctxSection, toolLoadSection, compareMinds} from './mind-compare.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0; const ok = (c, m) => {console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = mkTmp('eldmoor-session-');

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

// What a hero keeps across a roll (#808): the runner's own copy of what this session saw, no model call
console.log('the recap of a fresh session');
{
  const s = {sessionId: 's1', heroId: 7, turns: 9};
  ok(recapNote(s, {heard: []}) === '' && recapNote(null, null) === '', 'nothing seen, nothing carried');
  const at = t => '08:' + String(t).padStart(2, '0');
  for (let t = 0; t < 14; t++) noteTurn(s, {clock: 'Day 2 09:00', heard: [at(t) + ' Kerin [party]: line ' + t, at(t) + ' (you) [party]: my answer ' + t]}, t % 2 ? 'I held the east road, turn ' + t + '.' : '');
  const r = recapNote(s, {heard: ['08:13 Kerin [party]: line 13']});
  ok(s.recap.lines.length === RECAP.LINES && !s.recap.lines.includes('08:00 Kerin [party]: line 0'), `the ring keeps the last ${RECAP.LINES} lines heard, its own marked, once each`);
  ok(/08:13 \(you\) \[party\]: my answer 13/.test(r) && /08:05 Kerin \[party\]: line 5/.test(r), 'the recap carries who said what, in the words the header showed');
  ok(!r.includes('08:13 Kerin'), 'a line in the header of the same prompt is not said twice');
  ok(/You: .*I held the east road, turn 13\./.test(r) && s.recap.did.length === RECAP.DID, `and how its last ${RECAP.DID} turns closed`);
  ok(/it is past, not news/.test(r), 'and says it is memory, not something happening now');
  const big = {}; for (let t = 0; t < 40; t++) noteTurn(big, {clock: 'Day 3 12:00', heard: [t + ' ' + 'x'.repeat(130)]}, t + ' ' + 'y'.repeat(400));
  const b = recapNote(big, {heard: []});
  ok(b.length <= RECAP.MAX && b.includes('39 xxx') && !b.includes('\n16 xxx') && big.recap.did.every(d => d.text.length <= RECAP.NARR), `it stays under ${RECAP.MAX} characters (${b.length}), the newest talk kept`);
  const k = {sessionId: 'a', ctx: 90000, recap: {lines: ['x'], did: []}}; rollSession(k, () => null);
  ok(k.recap.lines[0] === 'x' && recapNote(k, {}).includes('x'), 'a roll keeps the ring on the session');
  ok(recapOn({}) && !recapOn({SESSION_RECAP: '0'}), 'SESSION_RECAP=0 turns it off');
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
      const tool = (j.tools || []).map(t => t.name).find(n => (m.toolRe || /__(status|dm_status)$/).test(n)) || null;
      const sys = typeof j.system === 'string' ? j.system : (j.system || []).map(x => x.text).join('\n');
      const text = JSON.stringify(j.messages), userText = j.messages.filter(x => x.role === 'user').flatMap(x => Array.isArray(x.content) ? x.content : [{type: 'text', text: x.content}]).filter(x => x.type === 'text').map(x => x.text).join('\n');
      // #808: what the model would really read: a deferred tool's schema is in the request but not in the prompt
      const toolsIn = j.tools || [], loaded = toolsIn.filter(t => !t.defer_loading);
      m.calls.push({n: m.calls.length + 1, sys, chars: text.length, msgs: j.messages.length, tool: !!tool, isResult, userText, model: j.model, sent: toolsIn.map(t => t.name), loaded: loaded.map(t => t.name), toolChars: JSON.stringify(loaded).length, text, result: j.messages.slice(-3).flatMap(x => Array.isArray(x.content) ? x.content : []).filter(x => x.type === 'tool_result')});
      if (m.refuse && toolsIn.some(t => t.defer_loading)) {m.refused = (m.refused || 0) + 1; res.writeHead(400, {'content-type': 'application/json'}); return res.end('{"type":"error","error":{"type":"invalid_request_error","message":"tools.1: defer_loading is not supported on this model"}}')}
      const planned = !summary && toolsIn.length && m.plan && m.plan.length ? m.plan.shift() : null; // a scripted call, in order, before the mock's usual ones
      const content = planned ? [{type: 'tool_use', id: 'toolu_' + m.calls.length, name: planned.name, input: planned.input || {}}] : tool && !isResult && !summary ? [{type: 'tool_use', id: 'toolu_' + m.calls.length, name: tool, input: {}}] : [{type: 'text', text: m.say ? m.say(sys) : 'The road goes on.'}];
      const usage = {input_tokens: 5, cache_read_input_tokens: m.ctx(m.calls[m.calls.length - 1]), cache_creation_input_tokens: 100, output_tokens: 7};
      const msg = {id: 'msg_' + m.calls.length, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage}, stop = content[0].type === 'tool_use' ? 'tool_use' : 'end_turn';
      if (!j.stream) {res.writeHead(200, {'content-type': 'application/json'}); return res.end(JSON.stringify({...msg, content, stop_reason: stop}))}
      res.writeHead(200, {'content-type': 'text/event-stream'});
      const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({type: t, ...d})}\n\n`), c = content[0];
      ev('message_start', {message: msg});
      if (c.type === 'text') {ev('content_block_start', {index: 0, content_block: {type: 'text', text: ''}}); ev('content_block_delta', {index: 0, delta: {type: 'text_delta', text: c.text}})}
      else {ev('content_block_start', {index: 0, content_block: {...c, input: {}}}); ev('content_block_delta', {index: 0, delta: {type: 'input_json_delta', partial_json: JSON.stringify(c.input)}})}
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
  // 2d. /compact between turns (#808), the option the recap was weighed against: it works, as one more model call on the whole session
  const asked = {}, n0 = api.calls.length; api.ctx = () => 80000;
  id = await cliTurn(env, '/compact Keep who said what and what was promised.', id, asked);
  ok(asked.boundary && asked.boundary.trigger === 'manual', `/compact through query() compacts between turns: ${asked.boundary && asked.boundary.pre_tokens} -> ${asked.boundary && asked.boundary.post_tokens} tokens`);
  ok(api.calls.length - n0 >= 1 && api.calls[n0].msgs >= 2, 'for at least one model call that reads the whole session, where a recap needs none');
  await cliTurn(env, 'after the compact', id, asked);
  ok(api.calls[api.calls.length - 1].sys.length === api.calls[0].sys.length && /The road goes on/.test(api.calls[api.calls.length - 1].text), 'the next turn resumes on the summary, standing orders unchanged');
}

// ---------------------------------------------------------------- 2b. the real CLI ends a turn at the table (#868)
// A wait that comes back with turn_over stops the query from the PostToolUse hook: through the relay's real /mcp route, no model call
// after it, a result with its cost, and the session resumes. An ordinary wait lets the model carry on.
console.log('the real CLI: a wait with turn_over ends the turn with no further model call');
{
  const {attachPlay, HELD_WAIT} = await import('./relay-mcp.mjs'), {tableHooks, WAIT_TOOL} = await import('./pacing.mjs');
  let answer = null; const asked = [];
  const be = {call: async (id, tool) => {asked.push(tool); return answer}, dmCall: async () => ({ok: true}), narrate() {}, info: () => ({connected: true, heroes: [{id: 1, name: 'Mock', alive: true}]})};
  const srv = http.createServer((q, s) => {s.writeHead(404); s.end('{}')}); attachPlay(srv, {backend: be, log: () => {}});
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const mcpUrl = `http://127.0.0.1:${srv.address().port}/mcp?hero=1`;
  api.toolRe = /__wait$/; api.ctx = () => 3000;
  const run = async (resume, over) => {const seen = [], before = api.calls.length; let id = resume, res = null;
    const q = query({prompt: 'turn', options: {model: 'claude-haiku-5-5', systemPrompt: 'You keep the road.', resume, mcpServers: {eldmoor: {type: 'http', url: mcpUrl, headers: {'X-Eldmoor-Hero': '1'}, timeout: 30000}}, tools: [], allowedTools: ['mcp__eldmoor'], permissionMode: 'dontAsk', settingSources: [], maxTurns: 3, cwd: tmp, env: base,
      hooks: tableHooks({idle: on => seen.push(on), onOver: () => {seen.push('over'); over && over()}})}});
    for await (const m of q) {if (m.type === 'system' && m.subtype === 'init') id = m.session_id; else if (m.type === 'result') res = m}
    return {id, res, seen, calls: api.calls.length - before}};
  ok(WAIT_TOOL === 'mcp__eldmoor__wait', 'the hook matches the wait tool as the runners name it');
  answer = {ok: true, waited_min: 30, why: 'time passed'};
  const plain = await run();
  ok(plain.calls === 2 && !plain.seen.includes('over'), `an ordinary wait: the model gets its next call, as it did (${plain.calls} model calls)`);
  answer = {ok: true, waited_min: 0, turn_over: true, why: 'Your answer is in; the table has not settled. Your turn is over: end it here.', table: {scene: 'Trouble on the road'}};
  const m0 = api.calls.length, end = await run(plain.id);
  ok(end.calls === 1 && end.seen.join() === 'true,false,over', `turn_over: one model call (the wait itself), none after it (${end.calls}); idle on and off: ${end.seen.join()}`);
  ok(end.res && end.res.subtype === 'success' && end.res.total_cost_usd > 0, `the turn ends as a success with its cost (${end.res && end.res.subtype}, $${end.res && end.res.total_cost_usd}), so the budget counts it`);
  answer = {...HELD_WAIT}; const held = await run(end.id);
  ok(held.calls === 1 && held.seen.includes('over'), 'the relay\'s held answer ends the turn the same way');
  answer = {ok: true, waited_min: 10, why: 'time passed'}; const again = await run(held.id);
  ok(again.id === held.id || again.calls >= 1, 'the session resumes on the next turn');
  ok(api.calls[m0 + 1].msgs > api.calls[m0].msgs, `and carries the turn that ended (${api.calls[m0].msgs} -> ${api.calls[m0 + 1].msgs} messages)`);
  api.toolRe = null; srv.close();
}

// ---------------------------------------------------------------- 2c. lazy tools on the real CLI (#808)
// Through the relay's real /mcp route with every hero tool. A deferred tool's schema is not in the prompt until the hero looks it up; the mock counts
// the schemas that are not deferred, which is what the model would read. Tokens are chars / 3.6, the estimate #808 used: a live run reads ctx instead.
console.log('the real CLI: lazy tools');
{
  const {attachPlay} = await import('./relay-mcp.mjs'), {tableHooks} = await import('./pacing.mjs'), {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
  const {ALWAYS_LOAD, LAZY_GROUPS, ALWAYS_LOAD_META, SEARCH_TOOL, lazyOn, toolOptions, withLazyEnv, lazyRec, markLazy} = await import('./lazy-tools.mjs');
  const names = PLAYER_TOOLS.map(t => t.name), wire = n => 'mcp__eldmoor__' + n, cold = names.filter(n => !ALWAYS_LOAD.includes(n));
  ok(ALWAYS_LOAD.every(n => names.includes(n)) && new Set(ALWAYS_LOAD).size === ALWAYS_LOAD.length, `the list names real tools, once each (${ALWAYS_LOAD.length} of ${names.length})`);
  ok(['self', 'become', 'swear_oath', 'keep_oath', 'renounce_oath', 'journal_read', 'journal_write', 'journal_search', 'remember', 'recall', 'update_memory', 'forget', 'pin', 'attempt', 'scene_act', 'wait', 'vote', 'say', 'party_say', 'use_ability', 'finish', 'spare', 'accept', 'decline'].every(n => ALWAYS_LOAD.includes(n)), 'self, become, the oaths, the journal, the memory tools, attempt, the moral choices and what a scene needs always load');
  ok(Object.keys(LAZY_GROUPS).length === 3 && !lazyOn({}) && !lazyOn({AGENT_LAZY_TOOLS: '0'}) && !lazyOn({AGENT_LAZY_TOOLS: ''}) && lazyOn({AGENT_LAZY_TOOLS: '1'}), 'AGENT_LAZY_TOOLS is off unless set to 1');
  const off = toolOptions(false, 'u?hero=1'); ok(off.url === 'u?hero=1' && off.tools.length === 0 && off.allowedTools.join() === 'mcp__eldmoor' && !withLazyEnv({}, false).ENABLE_TOOL_SEARCH && !Object.keys(lazyRec(false, [])).length, 'off, the query options, the environment and the turn line are as they were');
  {const s = {lazyTools: true}; markLazy(s, false); ok(!('lazyTools' in s), 'and a session file gains no field')}
  const seen = o => {const s = {}; rollSession(s, () => null); return Object.assign(s, {sessionId: 's', ctx: 1000}, o)}; // past the fresh ask of section 1
  ok(rollDue(seen({lazyTools: true}), 80000, {lazy: false}).why === 'tools' && rollDue(seen(), 80000, {lazy: true}).line === '[session rolled: lazy tools on]', 'a session started the other way rolls');
  ok(rollDue(seen(), 80000, {lazy: false}) === null && rollDue(seen(), 80000) === null && rollDue(seen({sessionId: null}), 80000, {lazy: true}) === null && rollDue(seen(), 80000, {lazy: true, busy: true}) === null, 'nothing else does, and never mid-scene');
  const asked = [], be = {call: async (id, tool, args) => {asked.push(tool); return tool === 'wait' && answer ? answer : {ok: true, tool, args}}, dmCall: async () => ({ok: true}), narrate() {}, info: () => ({connected: true, heroes: [{id: 1, name: 'Mock', alive: true}]})}; let answer = null;
  const srv = http.createServer((q, s) => {s.writeHead(404); s.end('{}')}); attachPlay(srv, {backend: be, log: () => {}});
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const mcpUrl = `http://127.0.0.1:${srv.address().port}/mcp?hero=1`;
  const list = u => fetch(u, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})}).then(r => r.json()).then(j => j.result.tools);
  const plainList = await list(mcpUrl), lazyList = await list(mcpUrl + '&lazy=1');
  ok(plainList.length === names.length && plainList.every(t => !t._meta), 'without ?lazy=1 the relay lists every tool with no _meta');
  ok(lazyList.map(t => t.name).join() === names.join(), 'with it, every tool too: none is removed');
  ok(lazyList.filter(t => t._meta && t._meta[ALWAYS_LOAD_META] === true).map(t => t.name).sort().join() === [...ALWAYS_LOAD].sort().join(), 'and exactly the list carries anthropic/alwaysLoad');
  ok(JSON.stringify(lazyList.map(({_meta, ...t}) => t)) === JSON.stringify(plainList), 'the schemas are the same either way');
  const play = async (lazy, plan, resume, extra = {}) => {const to = toolOptions(lazy, mcpUrl), before = api.calls.length; let id = resume, res = null; api.plan = plan.slice();
    const q = query({prompt: 'turn', options: {model: 'claude-haiku-5-5', systemPrompt: 'You keep the road.', resume, mcpServers: {eldmoor: {type: 'http', url: to.url, headers: {'X-Eldmoor-Hero': '1'}, timeout: 30000}}, tools: to.tools, allowedTools: to.allowedTools, permissionMode: 'dontAsk', settingSources: [], maxTurns: 8, cwd: tmp, env: withLazyEnv({...base}, lazy), ...extra}});
    for await (const m of q) {if (m.type === 'system' && m.subtype === 'init') id = m.session_id; else if (m.type === 'result') res = m}
    return {id, res, calls: api.calls.slice(before)}};
  api.toolRe = /^$/; api.ctx = () => 3000;
  const plain = await play(false, []), lazy = await play(true, []), p0 = plain.calls[0], l0 = lazy.calls[0];
  ok(p0.loaded.length === names.length && names.every(n => p0.sent.includes(wire(n))) && !p0.sent.includes(SEARCH_TOOL), `off: all ${names.length} schemas in the prompt, no ${SEARCH_TOOL}`);
  const hot = l0.loaded.filter(n => n.startsWith('mcp__')).map(n => n.slice(14));
  ok(hot.slice().sort().join() === [...ALWAYS_LOAD].sort().join() && l0.loaded.includes(SEARCH_TOOL), `on: the ${ALWAYS_LOAD.length} always-loaded schemas and ${SEARCH_TOOL}`);
  ok(cold.every(n => !l0.sent.includes(wire(n))), `the other ${cold.length} schemas are not in the request at all`);
  ok(cold.every(n => l0.text.includes(wire(n))), 'each of them is named in the prompt, so a hero knows it is there');
  const saved = p0.toolChars - l0.toolChars, listChars = l0.chars - p0.chars, tok = c => Math.round(c / 3.6), net = saved - listChars;
  console.log(`  size: schemas ${p0.toolChars} -> ${l0.toolChars} chars (about ${tok(p0.toolChars)} -> ${tok(l0.toolChars)} tokens), the names list +${listChars} chars, net -${net} chars, about ${tok(net)} tokens a call`);
  ok(net > .4 * p0.toolChars, `the prompt loses about ${tok(net)} tokens a call: ${Math.round(net / p0.toolChars * 100)}% of the tool schemas (#808 expected 9.6-13k with 24 to 44 tools kept)`);
  const cheap = await play(true, [{name: wire('scene_act'), input: {option: 'hold', line: 'I stand.'}}, {name: wire('wait'), input: {minutes: 10}}, {name: wire('become'), input: {field: 'voice', text: 'plain', why: 'the road'}}]);
  ok(asked.slice(-3).join() === 'scene_act,wait,become' && !cheap.calls.some(c => c.result.some(r => r.is_error)), 'scene_act, wait and become need no lookup');
  const looked = await play(true, [{name: SEARCH_TOOL, input: {query: 'select:' + wire('gambits'), max_results: 5}}, {name: wire('gambits'), input: {}}]);
  const ref = looked.calls[1].result.flatMap(r => Array.isArray(r.content) ? r.content : []).find(x => x.type === 'tool_reference');
  ok(ref && ref.tool_name === wire('gambits'), `${SEARCH_TOOL} finds a deferred tool by name: ${ref && ref.tool_name}`);
  ok(looked.calls[1].sent.includes(wire('gambits')) && !looked.calls[1].loaded.includes(wire('gambits')), 'its schema comes with the next call, marked deferred: the API opens it where the search result stands, the cached prefix stays');
  ok(asked[asked.length - 1] === 'gambits' && looked.res.subtype === 'success', 'and the call reaches the game');
  const asBare = await play(true, [{name: SEARCH_TOOL, input: {query: 'select:shop', max_results: 5}}]), bare = asBare.calls[1].result.flatMap(r => Array.isArray(r.content) ? r.content : []);
  ok(bare.some(x => x.type === 'tool_reference' && x.tool_name === wire('shop')), 'by the short name the tool map gives too (select:shop)');
  const words = await play(true, [{name: SEARCH_TOOL, input: {query: 'auction house', max_results: 5}}]), found = words.calls[1].result.flatMap(r => Array.isArray(r.content) ? r.content : []).filter(x => x.type === 'tool_reference').map(x => x.tool_name);
  ok(found.some(n => /auction/.test(n)), `and by words: ${found.map(n => n.slice(14)).join(', ')}`);
  const next = await play(true, [{name: wire('gambits'), input: {}}], looked.id);
  ok(next.calls[0].sent.includes(wire('gambits')) && asked[asked.length - 1] === 'gambits', 'a tool looked up stays there on the next turn of the session');
  ok(next.calls[0].chars > looked.calls[0].chars && (next.calls[0].text.match(/deferred tools are now available/g) || []).length === 1, 'and the names list is not repeated on a resume');
  const blind = await play(true, [{name: wire('recipes'), input: {}}]);
  ok(asked[asked.length - 1] === 'recipes', 'a hero who calls a deferred tool straight from the tool map still reaches the game');
  answer = {ok: true, waited_min: 0, turn_over: true, why: 'Your turn is over: end it here.'}; let over = 0;
  const rest = await play(true, [{name: wire('wait'), input: {}}], undefined, {hooks: tableHooks({idle: () => {}, onOver: () => over++})}); answer = null;
  ok(over === 1 && rest.calls.length === 1, 'turn_over ends the turn as before (#868)');
  api.refuse = true; asked.length = 0; const told = await play(true, [{name: wire('status'), input: {}}]); api.refuse = false;
  ok(api.refused >= 1 && told.res && told.res.subtype === 'success' && asked.includes('status'), `an endpoint that refuses deferral costs a retry, not the turn (${api.refused} refused, then ${told.calls[told.calls.length - 1].loaded.length} schemas sent)`);
  api.toolRe = null; api.plan = null; srv.close();
}

// ---------------------------------------------------------------- 3. the hero runner end to end
const envDir = join(tmp, 'envdir'); (await import('node:fs')).mkdirSync(envDir); writeFileSync(join(envDir, '.env'), ''); // --env: never the owner's .env
const childEnv = {...process.env, ...base, AGENT_LOGS: tmp, AGENT_MODEL: 'claude-haiku-5-5', DM_MODEL: 'claude-sonnet-5-5', AGENT_REFLECT: '0'};
delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT; delete childEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW; delete childEnv.AGENT_HEAR_WAKE_MIN; delete childEnv.SESSION_ROLL_TOKENS; delete childEnv.DM_ROLL_TOKENS; delete childEnv.ELDMOOR_SUPERVISED; delete childEnv.AGENT_LAZY_TOOLS; delete childEnv.ENABLE_TOOL_SEARCH;
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
// A runner that exited has let go of its hero, but under load the release can land late and the next runner for the hero is refused ("already has a live agent runner") until it has. Wait for it, as a page or a supervisor would, before starting the next one.
const freed = async () => (await until(async () => {const h = await health(WORLD).catch(() => null); return h && h.heroes.every(x => x.link === 'none')}, 60000)) || console.log('  (the hero still shows a runner 60 s after its exit)');
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
// --watch (Table off): a level-1 hero at 8x walks into real rescue and ambush scenes, and a roll is held for a scene by design, so a mock that cannot play scene_act kept the "fresh" and the table-closed rolls waiting for the table's 2 minutes (the flake). Scenes here are the proxy's.
const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '1', '--quiet', '--speed', '8', '--watch', '--world', join(tmp, 'world.json')], {wait: /^\[play\] headless world at /m});
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
  // the size stays 85k until a fresh session starts: a turn in flight as the table closes must not report the small size, or nothing is left to roll
  const since = api.calls.length; px.table = false; let small = false; api.ctx = c => {if (c.tool && !c.isResult && c.msgs <= 2) small = true; return small ? 26000 : 85000};
  const rolled85 = await until(() => /\[session rolled: 85k tokens\]/.test(run.out()));
  ok(rolled85, 'the table closed, the next turn rolls: [session rolled: 85k tokens]');
  if (!rolled85) console.log('--- runner output ---\n' + run.out().split('\n').slice(-40).join('\n') + '\n--- health ---\n' + JSON.stringify(await health(WORLD).catch(e => String(e))).slice(0, 600));
  const s2 = await until(() => {const s = readSess(hero.id); return s && s.sessionId && s.sessionId !== sid ? s : null});
  ok(s2 && s2.rolls === 1 && s2.system === orders && s2.runner && s2.runner.model === 'claude-haiku-5-5' && s2.turns >= 3, 'the session file has a new session, the same standing orders and mind, the turns counted on, one roll');
  ok(oldFiles().some(f => f.startsWith(hero.id + '-')), `the old file lies in old/: ${oldFiles().join(', ')}`);
  const fresh = await until(() => api.calls.slice(since).find(c => c.tool && !c.isResult && c.msgs <= 2)); // the line comes just before the call
  ok(fresh && /journal_read/.test(fresh.userText), 'the new session starts small and is told to read its journal');
  ok(fresh && fresh.sys.includes(orders.slice(0, 200)), 'with its standing orders');
  ok(fresh && /What you recall from just before/.test(fresh.userText) && /You: .*The road goes on\./.test(fresh.userText), 'and carries a recap of its last turns (#808)');
  ok(/\[session recap: \d+ chars\]/.test(run.out()) && api.calls.slice(since).filter(c => /What you recall from just before/.test(c.userText) && c.msgs <= 2).length >= 1, 'in the first prompt of the fresh session, no model call of its own');
  const h = await health(WORLD), me = h.heroes.find(x => x.id === hero.id); ok(me && me.link !== 'none', `the claim held through the roll (link ${me && me.link})`);
  ok(await until(() => {const s = readSess(hero.id); return s && s.ctx === 26105}), 'and the next turns report the small size');
  await run.done;
  if (!/\b1 rolls, 0 compactions/.test(run.out())) console.log(run.out().split('\n').slice(-25).map(l => '    | ' + l.slice(0, 200)).join('\n'));
  ok(/\b1 rolls, 0 compactions/.test(run.out()), 'the run ends counting its rolls');
  const jsonl = name => {try {return readdirSync(join(tmp, 'behavior')).flatMap(d => readFileSync(join(tmp, 'behavior', d, name), 'utf8').trim().split('\n').map(l => JSON.parse(l)))} catch {return []}};
  const lines = jsonl('turns.jsonl');
  ok(await until(() => jsonl('world.jsonl').some(w => w.ctx && Object.values(w.ctx).some(Number.isFinite)), 20000), 'the world digest carries each seat\'s size');
  ok(lines.some(t => t.ctx === 85105) && lines.some(t => (t.flags || []).includes('session-rolled')), `the behavior turn lines carry ctx and the roll (${lines.length} lines)`);
  ok(lines.some(t => (t.flags || []).includes('session-rolled') && (t.flags || []).includes('session-recap')), 'and the recap');
}
// A resume after an update: a long session with no size kept rolls before it is paid for.
{
  const s = readSess(hero.id); delete s.ctx; s.turns = 44; writeFileSync(join(tmp, 'agents', hero.id + '.json'), JSON.stringify(s)); api.ctx = () => 26000;
  // one turn only: a reflection due at dusk would rightly hold the roll back, and this case is about the old session
  const run = start(['scripts/agent-player.mjs', '--url', WORLD, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--max-turns', '1', '--min-gap', '0', '--heartbeat', '5', '--budget', '1', '--no-reflect']);
  await run.done;
  ok(/\[session rolled: size not kept, 44 turns\]/.test(run.out()), 'a long session from before this fix rolls on its first turn, before a call is paid for at the old size');
}
// The page's Fresh session: a "fresh" line on stdin, and --new keeps the mind.
{
  api.ctx = () => 26000;
  const run = start(['scripts/agent-player.mjs', '--url', WORLD, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--min-gap', '0', '--heartbeat', '5', '--budget', '1'], {stdin: 'pipe', env: {...childEnv, ELDMOOR_SUPERVISED: '1', AGENT_HEAR_WAKE_MIN: '45'}});
  ok(await until(() => /\| ctx 26k \| turn \$/.test(run.out())), 'a supervised runner plays');
  run.p.stdin.write('fresh\n');
  const got = await until(() => /\[session rolled: a fresh session was asked for\]/.test(run.out()));
  ok(got, 'a "fresh" line rolls it at the next turn');
  if (!got) console.log('--- runner output ---\n' + run.out().split('\n').slice(-40).join('\n'));
  run.p.stdin.write('stop\n'); await run.done;
  // the order of events that looked like a lost line: a fresh session asked while a scene is open is held, never dropped, and rolls once the scene closes
  {
    api.ctx = () => 26000; px.table = true;
    const r2 = start(['scripts/agent-player.mjs', '--url', px.url, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--min-gap', '0', '--heartbeat', '5', '--budget', '1'], {stdin: 'pipe', env: {...childEnv, ELDMOOR_SUPERVISED: '1'}});
    ok(await until(() => /\| ctx 26k \| turn \$/.test(r2.out())), 'a runner plays with the table open');
    r2.p.stdin.write('fresh\n');
    const n = (r2.out().match(/\| ctx 26k/g) || []).length;
    const went = await until(() => (r2.out().match(/\| ctx 26k/g) || []).length > n + 2);
    ok(went, 'turns go on with the table open');
    if (!went) console.log('--- runner output ---\n' + r2.out().split('\n').slice(-30).join('\n') + '\n--- health ---\n' + JSON.stringify(await health(WORLD).catch(e => String(e))).slice(0, 800));
    ok(!/session rolled/.test(r2.out()), 'a fresh session asked at a scene is held for it');
    px.table = false;
    ok(await until(() => /\[session rolled: a fresh session was asked for\]/.test(r2.out())), 'and is not lost: it rolls at the first turn after the scene');
    r2.p.stdin.write('stop\n'); await r2.done;
    await freed();
  }
  const again = start(['scripts/agent-player.mjs', '--url', WORLD, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--new', '--max-turns', '1', '--min-gap', '0', '--heartbeat', '5', '--budget', '1'], {env: {...childEnv, AGENT_MODEL: 'claude-sonnet-5-5'}});
  await again.done; await freed(); const s = readSess(hero.id);
  if (!(s && s.runner && s.runner.model === 'claude-haiku-5-5' && /earlier session kept/.test(again.out()))) console.log('--- --new output ---\n' + again.out().split('\n').slice(-20).join('\n'));
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
// Lazy tools in the hero runner (#808): the switch on rolls the old session, a deferred tool is looked up and called in the game, the turn line says so; off again rolls back.
const cold = 'mcp__eldmoor__gambits', turnLines = () => {try {return readdirSync(join(tmp, 'behavior')).flatMap(d => readFileSync(join(tmp, 'behavior', d, 'turns.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)))} catch {return []}};
{
  api.ctx = () => 26000; api.calls.length = 0; api.plan = [{name: 'ToolSearch', input: {query: 'select:' + cold, max_results: 5}}, {name: cold, input: {}}];
  const run = start(['scripts/agent-player.mjs', '--url', WORLD, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--max-turns', '2', '--min-gap', '0', '--heartbeat', '5', '--budget', '1', '--no-reflect'], {env: {...childEnv, AGENT_LAZY_TOOLS: '1'}});
  await run.done; api.plan = null;
  ok(/\[tools\] lazy loading on: \d+ in the prompt, \d+ found with ToolSearch/.test(run.out()) && /\[session rolled: lazy tools on\]/.test(run.out()), 'npm run agent with AGENT_LAZY_TOOLS=1: it says so, and the session of before rolls');
  ok(/\| ctx 26k \| tool search 1 \| turn \$/.test(run.out()), 'the turn line carries ctx and the lookups');
  const lazyCalls = api.calls.filter(c => c.tool); // the warm-up has no tools
  ok(lazyCalls.length && lazyCalls.every(c => c.loaded.includes('ToolSearch') && c.loaded.length < 60), `every call has the short list (${lazyCalls[0] && lazyCalls[0].loaded.length} schemas)`);
  const L = await until(() => {const t = turnLines().find(x => x.toolSearch === 1); return t || null}, 5000);
  ok(L && L.ctx === 26105 && (L.flags || []).includes('lazy-tools') && L.tools.some(t => t.name === 'ToolSearch') && L.tools.some(t => t.name === 'gambits' && t.ok), 'the behavior line has ctx, toolSearch, the flag and both calls');
  ok(readSess(hero.id).lazyTools === true, 'the session is marked');
  api.calls.length = 0;
  const back = start(['scripts/agent-player.mjs', '--url', WORLD, '--hero', String(hero.id), '--env', join(envDir, '.env'), '--max-turns', '1', '--min-gap', '0', '--heartbeat', '5', '--budget', '1', '--no-reflect']);
  await back.done;
  ok(/\[session rolled: lazy tools off\]/.test(back.out()) && !/lazy loading on|tool search \d/.test(back.out()) && !('lazyTools' in readSess(hero.id)), 'with the switch off again it rolls back, and no word of it stays');
  const fullCalls = api.calls.filter(c => c.tool); ok(fullCalls.length && fullCalls.every(c => !c.sent.includes('ToolSearch') && c.loaded.length > 100), `and every schema is sent again (${fullCalls[0] && fullCalls[0].loaded.length})`);
}
world.p.kill(); px.close(); await sleep(300);

// ---------------------------------------------------------------- 4. the Fellowship runner
console.log('npm run fellowship on a headless Fellowship');
{
  const fport = port + 601, FW = `http://127.0.0.1:${fport}`;
  const fw = start(['scripts/play-headless.mjs', '--fellowship', '--no-relay', '--port', String(fport), '--quiet', '--speed', '1', '--world', join(tmp, 'fworld.json')], {wait: /^\[play\] headless world at /m});
  await fw.until; api.ctx = () => 85000; api.calls.length = 0;
  const names = (await health(FW)).heroes.map(x => x.name), whose = sys => names.find(n => sys.includes('You are ' + n + ',')) || '?'; api.say = sys => `Word of ${whose(sys)}.`; // each member closes its turns in its own words
  const run = start(['scripts/fellowship.mjs', '--url', FW, '--env', join(envDir, '.env'), '--max-turns', '2', '--min-gap', '0', '--heartbeat', '5', '--budget', '1', '--provider', 'anthropic', '--model', 'claude-haiku-5-5']);
  await run.done;
  const rolled = (run.out().match(/\[session rolled: 85k tokens\]/g) || []).length, turns = (run.out().match(/\| ctx 85k \| turn \$/g) || []).length;
  ok(turns >= 5, `the members' turn lines carry ctx (${turns})`);
  ok(rolled >= 1, `members roll past the roll point (${rolled})`);
  let rec = null; try {rec = readFileSync(join(tmp, 'fellowship-runs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).pop()} catch {}
  ok(rec && rec.members.reduce((t, m) => t + (m.rolls || 0), 0) === rolled, `the run record counts the rolls (${rec && rec.members.map(m => m.rolls).join(', ')})`);
  ok(rec && rec.members.some(m => m.ctx != null), 'and the last size');
  ok(oldFiles().length >= 1 + rolled, 'each member\'s old file lies in old/');
  api.say = null;
  const firsts = api.calls.filter(c => c.tool && /What you recall from just before/.test(c.userText));
  ok(firsts.length >= 1 && firsts.length <= rolled * 2, `a rolled member's fresh prompt carries its recap (${firsts.length})`);
  ok(firsts.every(c => c.userText.includes(`Word of ${whose(c.sys)}.`) && names.every(n => n === whose(c.sys) || !c.userText.includes(`Word of ${n}.`))), 'its own words and no other member\'s');
  // Lazy tools for a company runner (#808)
  api.ctx = () => 26000; api.calls.length = 0;
  const lazyRun = start(['scripts/fellowship.mjs', '--url', FW, '--env', join(envDir, '.env'), '--max-turns', '1', '--min-gap', '0', '--heartbeat', '5', '--budget', '1', '--provider', 'anthropic', '--model', 'claude-haiku-5-5'], {env: {...childEnv, AGENT_LAZY_TOOLS: '1'}});
  await lazyRun.done;
  const lazyTurns = (lazyRun.out().match(/\| tool search 0 \| turn \$/g) || []).length;
  ok(/\[tools\] lazy loading on/.test(lazyRun.out()) && lazyTurns >= 5, `npm run fellowship with the switch on: every member's turn line says so (${lazyTurns})`);
  ok(api.calls.filter(c => c.tool).every(c => c.loaded.includes('ToolSearch') && c.loaded.length < 60), 'and every member plays with the short list');
  fw.p.kill(); await sleep(300);
}

// ---------------------------------------------------------------- 5. the DM runner
console.log('npm run dm on a headless world');
{
  const dport = port + 701, DW = `http://127.0.0.1:${dport}`;
  const dw = start(['scripts/play-headless.mjs', '--dm', '--agents', '0', '--port', String(dport), '--quiet', '--speed', '8', '--world', join(tmp, 'dworld.json')], {wait: /^\[play\] headless world at /m});
  await dw.until; api.ctx = () => 155000; api.calls.length = 0;
  const run = start(['scripts/dm-agent.mjs', '--url', DW, '--env', join(envDir, '.env'), '--max-turns', '2', '--cadence', '5', '--min-gap', '0', '--budget', '1', '--no-table-voice', '--no-talk-voice', '--no-companion-voice', '--no-ruling-voice'], {env: {...childEnv, AGENT_LAZY_TOOLS: '1'}});
  await run.done;
  {const dc = api.calls.filter(c => c.tool), mine = l => l.filter(n => n.startsWith('mcp__')); ok(dc.length && dc.every(c => !c.sent.includes('ToolSearch') && mine(c.sent).length > 50 && mine(c.sent).length === mine(c.loaded).length), `AGENT_LAZY_TOOLS leaves the DM as it is: heroes only (#808): ${dc[0] && mine(dc[0].loaded).length} schemas, sent ${dc[0] && dc[0].sent.length}`)}
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
  const tbl = (h, r) => [h.join('|'), ...r.map(x => x.join('|'))].join('\n');
  ok(!toolLoadSection(T, tbl).length, 'no lazy turn logged: the report has no tool loading section (#808)');
  const lz = (ctx, ts) => ({...t('hero:1', ctx, .004, '2026-11-04T02:00:00Z', ['lazy-tools']), toolSearch: ts, tools: [{name: 'wait'}, ...(ts ? [{name: 'ToolSearch'}, {name: 'gambits'}] : [])]});
  const tl = toolLoadSection([...T, lz(30000, 1), lz(50000, 0)], tbl).join('\n');
  ok(/all in the prompt\|claude-haiku-5-5\|3\|40k\|90k/.test(tl) && /lazy\|claude-haiku-5-5\|2\|30k\|30k\|2\|0\.5\|gambits 1/.test(tl), 'with one: both ways side by side, floor, median, calls and lookups a turn, the tools looked up');
}

for (const k of kids) try {k.kill()} catch {}
api.close(); await sleep(300);
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fail ? `\nsessioncheck: ${fail} FAILED` : '\nsessioncheck: all ok');
process.exit(fail ? 1 : 0);
