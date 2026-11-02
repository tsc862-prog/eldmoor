// Local agent runner check (Mixed minds, issue #97 part 2). No Ollama and no API key needed: a mock
// Ollama server stands in for the model, so this runs in CI.
//   1. The loop itself (scripts/local-agent.mjs) with a fake chat: tool calls validated against the
//      tool table (bad names and arguments go back to the model, never to the game), numbers coerced,
//      plain-text narration ends the turn, the model-call cap, a call written as text, the
//      JSON-action fallback for a model without tool support, history trimmed to its budget.
//   2. End to end, as the owner runs it: a headless world (scripts/play-headless.mjs, its own port and
//      world file), the mock Ollama, and `npm run agent -- --provider ollama` as a real child process:
//      the runner claims its hero and the claim carries {provider, model} (in /play/health and the
//      page's links message), turns play through /play/call, the session file keeps the runner
//      settings and a compact conversation, the next run resumes it, a model without tool support
//      plays in JSON-action mode, and a model that is not pulled is refused cleanly.
//   3. `npm run fellowship -- --provider ollama` plays all five members of a headless Fellowship
//      locally with no API key, every member claimed with its local model, cost 0.
//   1b. Issue #163: calls written into the narration (positional, tool({...}), key=value), labels cut from
//      the narration, forced scene turns (schema = the member's options; JSON, written call, misses).
//   4. Runner pacing on an in-process world (A-E; the autopilot part steps a held, seeded world, #159),
//      and F: a Table scene played by mock-fumble (writes scene_act as text, then waits) resolves by the
//      agents' choice with no table timeout.
// Sessions go to a temporary folder (AGENT_LOGS), never to logs/agents/.
// Usage: npm run localcheck
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localTurn, cleanArgs, parseTextCall, parseTextCalls, cleanNarration, sceneFrom, sceneSchema, sceneTurn, localLine, trimHistory, ollamaTools, LOCAL_DEFAULTS} from './local-agent.mjs';
import {ollamaAdapter} from './providers/ollama.mjs';
import {attachPlay} from './relay-mcp.mjs';
import {startMockOllama} from './mock-ollama.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- 1. the loop
console.log('local agent loop (fake chat)');
{
  ok(ollamaTools().length > 20 && ollamaTools().every(t => t.type === 'function' && t.function.parameters.type === 'object'), 'every game tool becomes an Ollama function tool');
  ok(JSON.stringify(cleanArgs('fight', {target_id: '12', junk: 1})) === '{"args":{"target_id":12}}', 'numbers given as strings are coerced, unknown keys dropped');
  ok(cleanArgs('fight', {}).error && cleanArgs('choose', {option: 'c'}).error && cleanArgs('teleport', {}).error, 'a missing argument, a bad enum and an unknown tool are rejected');
  ok(parseTextCall('<tool_call>{"name":"look","arguments":{}}</tool_call>').function.name === 'look' && parseTextCall('I look around.') === null, 'a call written as text is understood; prose is not a call');

  const calls = [], game = async (tool, args) => {calls.push([tool, args]); return {ok: true, tool, ...(tool === 'status' ? {hp: '100%', note: 'x'.repeat(3000)} : {})}};
  const script = replies => {let i = 0; const seen = []; return {seen, chat: async req => {seen.push(req); const r = replies[Math.min(i++, replies.length - 1)]; if (r instanceof Error) throw r;
    return {message: r, usage: {in: 100, out: 10, cost: 0}, ms: 5}}}};
  const tc = (name, args = {}) => ({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]});
  let s = script([tc('status'), tc('teleport'), tc('rest', {minutes: '30'}), tc('wait', {minutes: 30}), {role: 'assistant', content: 'Ann rested and waited.'}]);
  const sess = {system: 'You are Ann.'};
  let r = await localTurn({chat: s.chat, call: game, sess, prompt: 'Begin.', model: 'm', toolTurns: 12});
  ok(r.modelCalls === 5 && r.tools === 4 && r.rejected === 1 && r.narration === 'Ann rested and waited.', `a turn: 4 tool calls (1 rejected), narration ends it (${r.modelCalls} model calls)`);
  ok(calls.map(c => c[0]).join(',') === 'status,rest,wait' && calls[1][1].minutes === 30, 'only valid calls reach the game, with coerced arguments');
  ok(s.seen[0].tools && s.seen[0].messages[0].role === 'system' && s.seen[0].messages[0].content.startsWith('You are Ann.'), 'the system prompt and the tools go with every call');
  const toolMsg = s.seen[2].messages.find(m => m.role === 'tool' && m.tool_name === 'teleport');
  ok(toolMsg && /unknown tool/.test(toolMsg.content), 'the rejection goes back to the model as the tool result');
  ok(!s.seen[4].tools && /wait is over/.test(s.seen[4].messages[s.seen[4].messages.length - 1].content), 'after a wait the turn closes with one call without tools (narration only)');
  ok(r.in === 500 && r.out === 50 && sess.local.tokensIn === 500, 'tokens are counted per turn and per session');
  const kept = sess.local.history.find(m => m.role === 'tool' && m.tool_name === 'status');
  ok(kept && kept.content.length <= LOCAL_DEFAULTS.keptChars + 1 && sess.local.history[0].turn === 1, 'the stored history keeps tool results short and marks turn starts');

  s = script([tc('look')]);
  r = await localTurn({chat: s.chat, call: game, sess, prompt: 'Turn 2.', model: 'm', toolTurns: 3});
  ok(r.capped && r.modelCalls === 3 && !r.narration, 'a model that never stops is cut off at the model-call cap');

  s = script([{role: 'assistant', content: '<tool_call>{"name":"journal_read","arguments":{"n":"3"}}</tool_call>'}, {role: 'assistant', content: 'Done.'}]);
  calls.length = 0; r = await localTurn({chat: s.chat, call: game, sess, prompt: 'Turn 3.', model: 'm'});
  ok(calls.length === 1 && calls[0][0] === 'journal_read' && calls[0][1].n === 3 && r.narration === 'Done.', 'a tool call written as text is run');

  const noTools = Object.assign(new Error('ollama: model does not support tools'), {noTools: true});
  s = script([noTools, {role: 'assistant', content: '{"tool":"status","args":{},"narration":""}'}, {role: 'assistant', content: 'not json'}, {role: 'assistant', content: '{"tool":"wait","args":{"minutes":20},"narration":"Waiting."}'}, {role: 'assistant', content: '{"tool":"end","args":{},"narration":"Ann waited out the rain."}'}]);
  const sj = {system: 'You are Ann.'}; calls.length = 0;
  r = await localTurn({chat: s.chat, call: game, sess: sj, prompt: 'Begin.', model: 'm'});
  ok(sj.local.mode === 'json' && r.mode === 'json' && s.seen[1].format && !s.seen[1].tools && /JSON object/.test(s.seen[1].messages[0].content), 'a model without tool support switches to JSON actions (schema-forced, tools listed in the prompt)');
  ok(calls.map(c => c[0]).join(',') === 'status,wait' && r.rejected === 1 && r.narration === 'Ann waited out the rain.', 'JSON actions run, a non-JSON reply is rejected, "end" closes the turn');
  s = script([{role: 'assistant', content: '{"tool":"end","args":{},"narration":"Again."}'}]);
  await localTurn({chat: s.chat, call: game, sess: sj, prompt: 'Turn 2.', model: 'm'});
  ok(!s.seen[0].tools && s.seen[0].format, 'the JSON mode is remembered for the hero');

  const h = []; for (let t = 0; t < 10; t++) h.push({role: 'user', content: 'Turn ' + t, turn: 1}, {role: 'assistant', content: 'y'.repeat(500)});
  const dropped = trimHistory(h, 2000);
  ok(dropped > 0 && JSON.stringify(h).length <= 2000 && h[0].turn === 1 && h[h.length - 2].content === 'Turn 9', `the history is trimmed by whole turns, oldest first (${dropped} dropped)`);
}

// ---------------------------------------------------------------- 1b. calls written as text, forced scene turns (issue #163)
console.log('text-written calls and forced scene turns (issue #163)');
{
  const live = 'CallCheck identifies that Pikeora is engaged with the Bristleback Boar and needs immediate assistance.\n(scene_act("strike", "I\'ll take care of this boar."))\n---\nI strike at the Bristleback Boar to aid my companion Pikeora.';
  const pc = parseTextCalls(live);
  ok(pc.length === 1 && pc[0].function.name === 'scene_act' && pc[0].function.arguments.option === 'strike' && pc[0].function.arguments.line === "I'll take care of this boar.", 'the owner\'s live text, (scene_act("strike", "...")), is a call: positional values mapped onto option, line');
  const nar = cleanNarration(live);
  ok(!/CallCheck|scene_act|---/.test(nar) && /^Identifies that Pikeora/.test(nar) && /I strike at the Bristleback Boar/.test(nar), 'the narration loses the label, the written call and the separator: ' + JSON.stringify(nar));
  ok(parseTextCalls('Waiting now: wait({"minutes": 30}) and then hunt(n=2).').map(c => c.function.name + JSON.stringify(c.function.arguments)).join(' ') === 'wait{"minutes":30} hunt{"n":2}', 'tool({...}) and key=value forms count too, in text order');
  const garr = parseTextCalls('Garrwen draws.\n(scene_act(deadeye, "I\'ll take this one down with my best shot."))');
  ok(garr.length === 1 && garr[0].function.arguments.option === 'deadeye' && /best shot/.test(garr[0].function.arguments.line) && cleanNarration('Garrwen draws.\n(scene_act(deadeye, "x"))') === 'Garrwen draws.', 'the live D2 11:34 form, an unquoted ability id as the first value, is a call too: ' + JSON.stringify(garr[0] && garr[0].function.arguments));
  ok(parseTextCalls("I must answer with scene_act(option, line) on my turn.").length === 0 && parseTextCalls('I take a look around.').length === 0, 'bare words (the model quoting the rules) and prose are not calls');
  ok(parseTextCalls("scene_act('guard', 'On me!')")[0].function.arguments.option === 'guard' && parseTextCalls('<tool_call>{"name":"look","arguments":{}}</tool_call>')[0].function.name === 'look', 'single quotes and <tool_call> blocks too');
  ok(cleanNarration('scene_act: Sylanne guards the healer.') === 'Sylanne guards the healer.' && cleanNarration('Narration: The boar falls.') === 'The boar falls.' && cleanNarration('McAllister holds the line.') === 'McAllister holds the line.', 'a leading tool name or label is cut; a name is not');

  // the loop: a model that writes scene_act as text and really calls wait; both run, in that order, and the shown narration is clean
  const calls = [], texts = [], game = async (tool, args) => {calls.push([tool, args]); return {ok: true}};
  let k = 0; const chat = async () => ({message: k++ === 0 ? {role: 'assistant', content: live, tool_calls: [{function: {name: 'wait', arguments: {minutes: 30}}}]} : {role: 'assistant', content: 'CallCheck: Sylanne struck.'}, usage: {in: 10, out: 5, cost: 0}, ms: 1});
  const r = await localTurn({chat, call: game, sess: {system: 'You are Sylanne.'}, prompt: 'Scene.', model: 'm', on: (kind, a) => {if (kind === 'text') texts.push(a)}});
  ok(calls.map(c => c[0]).join(',') === 'scene_act,wait' && calls[0][1].option === 'strike', 'in a turn, the call written in the text runs before the real wait: ' + calls.map(c => c[0]).join(','));
  ok(texts.length && texts.every(t => !/CallCheck|scene_act\(/.test(t)) && r.narration === 'Sylanne struck.', 'no label or written call reaches the Agent tab: ' + JSON.stringify(texts));

  // forced scene turn: the schema is the member's legal options; a JSON answer, a written call, and a miss
  const scene = sceneFrom({scene: 'Pikeora is going down', kind: 'rescue', frame: 'Pikeora is down to 17%.', options: ['strike = Strike Bristleback Boar', 'guard = Draw it onto yourself', 'retreat = Fall back toward home'], your_turn: true});
  ok(scene && scene.keys.join() === 'strike,guard,retreat', 'the scene keys come from the member\'s options');
  const sch = sceneSchema(scene.keys), schS = sceneSchema(scene.keys, {strict: true});
  ok(sch.properties.option.enum.join() === 'strike,guard,retreat' && sch.properties.line.maxLength === 200 && sch.required.join() === 'option,line' && !schS.properties.line.maxLength && schS.additionalProperties === false, 'the schema: an enum of that member\'s options and a line of at most 200 (strict OpenAI: no maxLength, cut in code)');
  const askOf = replies => {let i = 0; const seen = []; return {seen, ask: async (system, user, schema) => {seen.push({system, user, schema}); return {text: replies[Math.min(i++, replies.length - 1)], usage: {in: 50, out: 8, cost: 0}, ms: 2}}}};
  const acts = [], g2 = async (tool, args) => {acts.push([tool, args]); return {ok: true, chose: args.option}};
  let A = askOf(['{"option":"guard","line":"On me, boar!"}']), sess = {system: 'You are Ivoagh.'};
  let st = await sceneTurn({ask: A.ask, call: g2, sess, scene});
  ok(st.forced && st.tools === 1 && st.acts === 1 && acts[0][0] === 'scene_act' && acts[0][1].option === 'guard' && acts[0][1].line === 'On me, boar!' && A.seen.length === 1, 'a JSON answer: the runner sends scene_act itself (one model call)');
  ok(/strike = Strike Bristleback Boar/.test(A.seen[0].user) && A.seen[0].schema.properties.option.enum.length === 3 && A.seen[0].system === 'You are Ivoagh.', 'the prompt lists the options; the hero\'s own system prompt goes with it');
  ok(sess.local.history.some(m => m.tool_calls && m.tool_calls[0].function.name === 'scene_act'), 'the choice is kept in the hero\'s own conversation');
  A = askOf([live.replace('"strike"', '"retreat"')]); acts.length = 0;
  st = await sceneTurn({ask: A.ask, call: g2, sess: {system: 's'}, scene});
  ok(st.tools === 1 && acts[0][1].option === 'retreat' && st.misses === 0, 'an answer written as a call in text still counts');
  A = askOf(['{"option":"fly","line":"x"}', '{"option":"STRIKE","line":"Now!"}']); acts.length = 0;
  st = await sceneTurn({ask: A.ask, call: g2, sess: {system: 's'}, scene});
  ok(st.misses === 1 && acts[0][1].option === 'strike' && /not one of the options/.test(A.seen[1].user), 'an illegal option is asked once more, then sent');
  A = askOf(['no idea', 'still no idea']); acts.length = 0;
  st = await sceneTurn({ask: A.ask, call: g2, sess: {system: 's'}, scene});
  ok(st.misses === 2 && st.tools === 0 && !acts.length, 'two misses: nothing is sent (the free turn, or the table\'s reflex later)');
  ok(/forced scene turn/.test(localLine({...st, tools: 1, misses: 0, ms: 5, modelMs: 2}, 'm')), 'the turn line says it was a forced scene turn');
}

// ---------------------------------------------------------------- the mock Ollama (scripts/mock-ollama.mjs)
const {url: OLLAMA, seen, close: closeOllama} = await startMockOllama();

console.log('ollama adapter chat (mock server)');
{
  const ol = ollamaAdapter({url: OLLAMA});
  const r = await ol.chat({model: 'mock-tools:1b', messages: [{role: 'user', content: 'Begin.'}], tools: ollamaTools(), numCtx: 8192});
  ok(r.message.tool_calls && r.usage.in === 900 && r.usage.cost === 0, 'chat returns the tool calls and token counts, cost 0');
  const last = seen[seen.length - 1];
  ok(last.think === false && last.options.num_ctx === 8192 && last.stream === false && last.tools.length === ollamaTools().length, 'thinking off, the context size and the tools are sent');
  let e = null; try {await ol.chat({model: 'mock-json:1b', messages: [{role: 'user', content: 'x'}], tools: ollamaTools()})} catch (x) {e = x}
  ok(e && e.noTools, 'a model without tool support is reported as noTools');
  // issue #126: one queue per adapter (a Fellowship runner's members share it), and a clear timeout message
  let live = 0, most = 0;
  const slow = ollamaAdapter({url: OLLAMA, parallel: 1, chatPost: async () => {live++; most = Math.max(most, live); await sleep(60); live--; return {ok: true, status: 200, json: async () => ({message: {role: 'assistant', content: 'ok'}, prompt_eval_count: 1, eval_count: 1})}}});
  await Promise.all([1, 2, 3].map(() => slow.chat({model: 'm', messages: []})));
  ok(most === 1, 'with OLLAMA_PARALLEL 1 the members\' chats queue: one request at a time');
  const stuck = ollamaAdapter({url: OLLAMA, chatTimeoutMs: 1000, chatPost: async () => {throw Object.assign(new Error('timeout'), {code: 'ETIMEDOUT'})}});
  e = null; try {await stuck.chat({model: 'qwen2.5:14b', messages: []})} catch (x) {e = x}
  ok(e && /busy or loading the model/.test(e.message), 'a chat that times out says Ollama is busy or loading: ' + (e && e.message.slice(0, 80)));
  const real = ollamaAdapter({url: OLLAMA, chatTimeoutMs: 50});
  e = null; try {await real.chat({model: 'mock-tools:1b', messages: [{role: 'user', content: 'Begin.'}], tools: ollamaTools()})} catch (x) {e = x}
  ok(!e, 'the node:http path talks to Ollama (mock)');
  const {preferLoaded, localModelNote} = await import('./pacing.mjs'), gpu = {loaded: async () => ['qwen2.5:14b']};
  const pl = await preferLoaded(gpu, 'qwen3.5:4b', ['qwen2.5:14b', 'qwen3.5:4b']);
  ok(pl.model === 'qwen2.5:14b' && /already holds qwen2.5:14b/.test(pl.note), 'with no model picked, a local runner takes the model Ollama already holds (the relay\'s minds)');
  ok((await preferLoaded(gpu, 'qwen3.5:4b', ['qwen3.5:4b'])).model === 'qwen3.5:4b' && /evict each other/.test(await localModelNote(gpu, 'qwen3.5:4b')) && !(await localModelNote(gpu, 'qwen2.5:14b')), 'otherwise it keeps its model and warns that another one holds the GPU');
}

// ---------------------------------------------------------------- 2. the runner, end to end
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-localcheck-'));
const childEnv = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OLLAMA_URL: OLLAMA, AGENT_MIN_GAP: '0', AGENT_HEARTBEAT: '30'}; // pacing (issue #126) kept short for the old sections
const kids = [];
function start(args, {wait: ready = null, env = childEnv} = {}) {
  const p = spawn(process.execPath, args, {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  kids.push(p); let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const done = new Promise(r => p.on('exit', code => r(code)));
  const until = ready ? new Promise((res, rej) => {const t = setInterval(() => {if (ready.test(out)) {clearInterval(t); res()}}, 100); setTimeout(() => {clearInterval(t); rej(new Error('timeout waiting for ' + ready + '\n' + out))}, 120000)}) : null;
  return {p, done, until, out: () => out};
}
const port = 18700 + Math.floor(Math.random() * 600), BASE = `http://127.0.0.1:${port}`;
const health = base => fetch(base + '/play/health').then(r => r.json());

console.log('npm run agent -- --provider ollama (mock Ollama, headless world on port ' + port + ')');
const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '2', '--quiet', '--speed', '8', '--world', join(tmp, 'world.json')], {wait: /headless world/});
await world.until;
const h0 = await health(BASE), [hA, hB] = h0.heroes;
ok(h0.heroes.length === 2, `two agent heroes: ${hA.name} #${hA.id}, ${hB.name} #${hB.id}`);
{
  const run = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hA.id), '--provider', 'ollama', '--model', 'mock-tools:1b', '--max-turns', '2', '--ollama-url', OLLAMA]);
  let tagged = null; for (let i = 0; i < 100 && !tagged; i++) {await sleep(100); const h = await health(BASE).catch(() => null); const x = h && h.heroes.find(y => y.id === hA.id); if (x && x.runner) tagged = x}
  ok(tagged && tagged.runner.provider === 'ollama' && tagged.runner.model === 'mock-tools:1b' && tagged.link !== 'none', `while it runs, /play/health tags ${hA.name}'s runner: ${tagged && JSON.stringify(tagged.runner)}, link ${tagged && tagged.link}`);
  const code = await run.done, out = run.out();
  ok(code === 0, 'the local runner exits cleanly' + (code ? '\n' + out : ''));
  ok(/local model mock-tools:1b via Ollama/.test(out) && /> status\(\)/.test(out) && /> rest\(\{"minutes":20\}\)/.test(out) && /> wait\(/.test(out), 'it plays through the game tools (status, rest, wait)');
  ok(/Not done: unknown tool \\?"fly\\?"/.test(out), 'a bad tool call is answered with an error, not sent to the game');
  ok((out.match(/\[turn \d\] mock-tools:1b \(local\) \| 4 tool calls \(1 rejected\).*tokens in 4500 \/ out 100 \| \$0 \(local\)/g) || []).length === 2, 'two turns, each with a cost line: tool calls, seconds, tokens, $0');
  ok(/The hero looked, rested and waited\./.test(out), 'the narration is printed');
  const f = join(tmp, 'agents', hA.id + '.json'), s = existsSync(f) && JSON.parse(readFileSync(f, 'utf8'));
  ok(s && s.runner.provider === 'ollama' && s.runner.model === 'mock-tools:1b' && s.turns === 2, 'the session file keeps the runner settings and turns');
  ok(s && s.local && s.local.history.filter(m => m.turn).length === 2 && s.local.tokensIn === 9000 && !s.sessionId, 'and the compact local conversation (2 turns), no Agent SDK session');
  const h1 = await health(BASE), x = h1.heroes.find(y => y.id === hA.id);
  ok(x.link !== 'waiting' && !x.runner, 'on exit the runner lets go of the hero (no runner tag)');
  // resume: no flags needed, the saved settings play locally again
  const again = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hA.id), '--max-turns', '1']);
  const c2 = await again.done, o2 = again.out(), s2 = JSON.parse(readFileSync(f, 'utf8'));
  ok(c2 === 0 && /resuming \(\d+ messages kept\)/.test(o2) && /mock-tools:1b/.test(o2) && s2.turns === 3, 'the next run resumes from the saved settings and conversation (no flags)' + (c2 === 0 && s2.turns === 3 ? '' : '\n' + o2.slice(-1500)));
}
{
  const run = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'ollama', '--model', 'mock-json:1b', '--max-turns', '1', '--ollama-url', OLLAMA]);
  const code = await run.done, out = run.out();
  ok(code === 0 && /switching to JSON actions/.test(out) && /> status\(\)/.test(out) && /> wait\(\{"minutes":20\}\)/.test(out) && /local and free/.test(out) && /JSON-action mode/.test(out), 'a model without tool support plays in JSON-action mode' + (code === 0 && /local and free/.test(out) && /JSON-action mode/.test(out) ? '' : '\n' + out.slice(-2500)));
  const s = JSON.parse(readFileSync(join(tmp, 'agents', hB.id + '.json'), 'utf8'));
  ok(s.local.mode === 'json', 'and the JSON mode is saved for the hero');
  const bad = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'ollama', '--model', 'not-pulled:7b', '--max-turns', '1', '--ollama-url', OLLAMA]);
  const c3 = await bad.done;
  ok(c3 === 1 && /not pulled in Ollama/.test(bad.out()), 'a model that is not pulled is refused with a hint');
  const hb = await health(BASE);
  ok(!hb.heroes.find(y => y.id === hB.id).runner, 'and the refused runner released its claim');
  const txt = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'ollama', '--model', 'mock-text:1b', '--max-turns', '1', '--new', '--ollama-url', OLLAMA]);
  const c4 = await txt.done;
  ok(c4 === 0 && /> status\(\)/.test(txt.out()) && /4 tool calls \(1 rejected\)/.test(txt.out()), 'a model that writes its calls as text plays too');
}
world.p.kill();

console.log('npm run fellowship -- --provider ollama (headless Fellowship, no API key)');
{
  const fport = port + 1, FB = `http://127.0.0.1:${fport}`;
  const fw = start(['scripts/play-headless.mjs', '--fellowship', '--no-relay', '--port', String(fport), '--quiet', '--speed', '8', '--world', join(tmp, 'fworld.json')], {wait: /headless world/});
  await fw.until;
  const hf = await health(FB), fellows = hf.heroes.filter(x => x.fellow);
  ok(fellows.length === 5, 'five agent-played Fellowship members');
  const run = start(['scripts/fellowship.mjs', '--url', FB, '--provider', 'ollama', '--model', 'mock-tools:1b', '--max-turns', '1', '--cadence', '0', '--ollama-url', OLLAMA]);
  const seen = new Set(); let tags = 0; // members claim, play one turn and release at their own pace: count every member seen tagged
  for (let i = 0; i < 300 && seen.size < 5; i++) {await sleep(100); const h = await health(FB).catch(() => null); if (h) for (const x of h.heroes) if (x.runner && x.runner.provider === 'ollama') seen.add(x.id)}
  tags = seen.size;
  ok(tags === 5, `every member's claim carries its local model (${tags}/5)`);
  const code = await run.done, out = run.out();
  ok(code === 0, 'the Fellowship runner finishes' + (code ? '\n' + out.slice(-3000) : ''));
  ok(/only members with a local runner/.test(out) || existsSync(join(ROOT, '.env')), 'without an API key it says only local members will play');
  ok((out.match(/\[turn 1(, scene)?\] mock-tools:1b \(local\)/g) || []).length === 5, 'each of the five plays a local turn');
  ok((out.match(/\$0 \(local\), tokens \d+ in \/ \d+ out \| session \$0\.0000 \| mock-tools:1b \(local\)/g) || []).length === 5, 'the summary shows $0 and tokens per member');
  const runs = readFileSync(join(ROOT, 'logs', 'fellowship-runs.jsonl'), 'utf8').trim().split('\n').pop(), j = JSON.parse(runs);
  ok(j.url === FB && j.spent === 0 && j.members.every(m => m.provider === 'ollama' && m.tokensIn > 0), 'the run record lists the local members with tokens and cost 0');
  fw.p.kill();
}

// ---------------------------------------------------------------- 4. pacing (issue #126)
// An in-process world (so the check can read the game clock and raise events) served over HTTP like
// play-headless, and real runner processes against it: turns follow game time and events, a notification
// that cannot wait starts a turn at once, others wait for the minimum gap, a lazy model is re-prompted and
// stopped after its empty turns, the scripted rules take over an idle hero, and leaving agent play ends the run.
console.log('runner pacing (in-process world at 8x, mock Ollama)');
{
  const sim = await import('../src/sim/index.js'), {localBackend, chooseHero} = await import('./play-headless.mjs');
  const {notify} = await import('../src/sim/notify.js'), {homeOf} = await import('../src/data/races.js');
  const {S} = sim, {maxHp: maxHpOf} = await import('../src/sim/heroes.js'); sim.init({fellowship: false}); for (let i = 0; i < 60 * 30; i++) sim.step(1 / 60);
  let speed = 8, last = Date.now(), hold = false; // hold: a section steps the world itself (deterministic, issue #159)
  const tick = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; if (hold) return; const dt = real * speed, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) sim.step(dt / n)}, 50);
  const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
  attachPlay(server, {backend: localBackend(), log: () => {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PB = `http://127.0.0.1:${server.address().port}`;
  const park = a => {const c = homeOf(a); a.state = 'town'; a.x = c.gate.x; a.y = c.gate.y - 1; a.target = null; a.pq = []; a.dest = null}; // in town: nothing attacks
  const pick = () => {const a = chooseHero({fac: 0}); park(a); sim.markPlayer(a, true); return a};
  // a runner process with its output lines timed against the real and the game clock
  function runner(a, model, extra) {
    const p = spawn(process.execPath, ['scripts/agent-player.mjs', '--url', PB, '--hero', String(a.id), '--provider', 'ollama', '--model', model, '--ollama-url', OLLAMA, ...extra], {cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']});
    kids.push(p); const R = {p, out: '', turns: [], wakes: [], done: new Promise(r => p.on('exit', c => r(c)))}; let part = '';
    const take = d => {R.out += d; part += d; const ls = part.split(/\r?\n/); part = ls.pop();
      for (const l of ls) {const t = {real: Date.now(), gm: S.gameMin, line: l};
        if (/^\[turn \d+\]/.test(l)) R.turns.push(t); const w = l.match(/\[pace\] woke \((\w+)/); if (w) R.wakes.push({...t, kind: w[1]})}};
    p.stdout.on('data', take); p.stderr.on('data', take); return R;
  }
  const until = async (f, ms) => {const t0 = Date.now(); while (Date.now() - t0 < ms) {if (f()) return true; await sleep(50)} return false};

  // A. a quiet hero: turns come from the heartbeat (60 game minutes here), never back to back
  {const a = pick(), hb = 60, gap = 1;
    const R = runner(a, 'mock-tools:1b', ['--max-turns', '5', '--heartbeat', String(hb), '--min-gap', String(gap)]);
    const code = await R.done, g0 = R.turns[0], gN = R.turns[R.turns.length - 1];
    const hours = (gN.gm - g0.gm) / 60, perHour = (R.turns.length - 1) / Math.max(hours, 1e-9);
    // each later turn starts at least one heartbeat (or the gap, in game time) after the previous one ended
    const minGm = Math.min(hb, gap * 6 * speed), gaps = R.wakes.map((w, i) => w.gm - R.turns[i].gm);
    ok(code === 0 && R.turns.length === 5, `a quiet hero plays its 5 turns (${R.turns.length})` + (code === 0 ? '' : '\n' + R.out.slice(-1500)));
    ok(gaps.length === 4 && gaps.every(x => x >= minGm - 6), `turns wait for the game: ${gaps.map(x => Math.round(x)).join(', ')} game minutes between turns (at least ${minGm})`);
    ok(perHour <= 60 / minGm + .05, `at most one turn per ${minGm} game minutes on a quiet world: ${perHour.toFixed(2)} turns per game hour`);
    ok(R.wakes.every(w => w.kind === 'heartbeat' || w.kind === 'soft') && /up to 5 turns/.test(R.out) && /every 60 game min, at least 1 s apart/.test(R.out), `woken by the heartbeat or the hero's own news (${R.wakes.map(w => w.kind).join(', ')})`);
    ok(/Right now \(from the game/.test(JSON.stringify(seen.slice(-6))) && !/still battling/.test(R.out), 'every local turn prompt carries the hero\'s state from the game');
    sim.markPlayer(a, false)}

  // B. a notification that cannot wait starts a turn at once, inside the gap; the hero's other news waits for the gap
  {const a = pick();
    const R = runner(a, 'mock-tools:1b', ['--heartbeat', '1440', '--min-gap', '4']);
    ok(await until(() => R.turns.length >= 1, 30000), 'a local runner without --max-turns plays (until stopped)');
    ok(/until stopped/.test(R.out), 'and says it runs until stopped');
    await sleep(400); park(a); const tN = Date.now();
    notify(a, 'Attacked by a level 3 test wolf!', 2);
    ok(await until(() => R.wakes.length >= 1, 4000), `an attack starts the next turn at once: ${R.wakes[0] ? R.wakes[0].kind + ' after ' + (R.wakes[0].real - tN) + ' ms' : 'no turn'}`);
    ok(R.wakes[0] && R.wakes[0].kind === 'now' && R.wakes[0].real - R.turns[0].real < 4000, 'inside the 4 s minimum gap');
    // (the world may wake the hero first, say an attack on the way: then try again after that turn)
    let w2 = null, dt = null;
    for (let k = 2; k <= 4 && !w2; k++) {
      await until(() => R.turns.length >= k, 30000); park(a); a.hp = a.maxhp || a.hp;
      notify(a, 'A test traveller hails you from the road (' + k + ').', true); const tk = R.turns[k - 1].real, nw = R.wakes.length;
      await until(() => R.wakes.length > nw, 15000);
      const w = R.wakes[nw]; if (w && /test traveller/.test(w.line)) {w2 = w; dt = w.real - tk}
    }
    ok(w2 && w2.kind === 'soft' && dt >= 3500 && dt < 9000, `other news starts a turn once the gap has passed, not at the heartbeat: ${w2 && w2.kind} after ${dt} ms`);
    await until(() => R.turns.length >= R.wakes.length + 1, 30000);
    sim.markPlayer(a, false);
    const code = await Promise.race([R.done, sleep(20000).then(() => 'timeout')]);
    ok(code === 0 && /the hero left agent play/.test(R.out), 'a hero taken out of agent play ends its runner' + (code === 0 ? '' : '\n' + R.out.slice(-1200)))}

  // C. a lazy model (the owner's live bug): re-prompted once per turn, empty turns stop the runner, the scripted rules take over
  {const a = pick(), n0 = seen.length;
    // --max-fails 3, but a fresh context after two empty turns breaks the loop first (the mock forgets it went lazy)
    const R = runner(a, 'mock-lazy:1b', ['--heartbeat', '10', '--min-gap', '0', '--max-fails', '3', '--max-turns', '8', '--new']);
    const code = await Promise.race([R.done, sleep(60000).then(() => 'timeout')]);
    const mine = seen.slice(n0), re = mine.filter(b => {const u = b.messages.filter(m => m.role === 'user').pop(); return u && /^Act through a tool/.test(u.content)});
    const flags = R.turns.map(t => /empty turn/.test(t.line) ? 'E' : 'A').join('');
    ok(code === 0 && R.turns.length === 8 && flags === 'AAAEEAAA', `three good turns, two empty ones, then a fresh context and it acts again (${flags})` + (code === 0 ? '' : '\n' + R.out.slice(-1500)));
    ok(re.length === 2 && (R.out.match(/re-prompted to act/g) || []).length === 2 && (R.out.match(/empty turn \(no tool call\)/g) || []).length === 2 && /\[turn 6\].*fresh context/.test(R.out), `each empty turn was re-prompted once to act through a tool (${re.length}); turn 6 starts fresh`);
    const most = Math.max(...mine.map(b => b.messages.filter(m => m.role === 'assistant' && /still battling/.test(m.content || '')).length));
    ok(most <= 2, `the model's own old narrations are not fed back (at most ${most} in a request: the last turn's and this one's)`);
    // autopilot (owner: an agent-played hero is never scripted): out in the field, hurt, with a hunt as its last order.
    // Deterministic (issue #159, it failed now and then on CI): the background clock is held and the world is stepped
    // here from a seed; the hero stands alone (no monster may pick it, no duel); the checks read the autopilot state
    // (a.playIdle, a.playAuto, a.playDoing) at the step it changes, not pq[0] after the world had its say.
    const {seedRng} = await import('../src/core/rng.js'), {dist} = await import('../src/world/map.js');
    hold = true; seedRng(159);
    try {
      const calm = () => {S.pvpT = 1; a.spotCd = 99; for (const m of S.mobs) {if (m.target === a) m.target = null; if (dist(m, a) < 30) m.scan = 1}
        if (a.state === 'fight' || a.state === 'duel') {a.state = 'hunt'; a.target = null}};
      const stepUntil = (f, gameMin) => {const end = S.gameMin + gameMin; while (S.gameMin < end) {calm(); sim.step(1 / 20); if (f()) return true} return false};
      const out = S.agents.find(x => x !== a && x.state === 'hunt' && !x.player && x.kind === 'hero');
      a.x = out.x; a.y = out.y; a.state = 'hunt'; a.pq = []; a.target = null; a.dest = null; a.playOrder = {kind: 'hunt', n: 2, flee: .15}; a.hp = Math.max(1, Math.round(maxHpOf(a) * .4));
      // its last order nearly two game hours ago (a hurt hero heals while it stands, so the long wait is not stepped through)
      a.playActAt = S.gameMin - 115; a.playIdle = false; a.playAuto = null;
      const t0 = S.gameMin, idle = stepUntil(() => a.playIdle && a.playAuto === 'rest', 60);
      ok(idle && S.gameMin - a.playActAt >= 120 && S.gameMin - t0 >= 4, `with no order for 2 game hours autopilot carries on (${a.playAuto}, after ${Math.round(S.gameMin - t0)} game min)`);
      ok(a.player && !a.brain && /^autopilot: resting/.test(a.playDoing || ''), `the agent stays the mind (agent-played, no brain): "${a.playDoing}"`);
      a.hp = maxHpOf(a); a.pq = [];
      ok(stepUntil(() => a.playAuto === 'hunt' && a.pq[0] && a.pq[0].kind === 'hunt' && a.pq[0].auto, 60), `mended, it carries on its last order (${a.playAuto}: ${a.playDoing})`);
      ok((a.playEv || []).some(e => /autopilot carries on/.test(e.text)) && !(a.playEv || []).some(e => /scripted|instinct/i.test(e.text)), 'the hero is told so, and nothing calls it scripted');
      const r = sim.playerAct(a.id, 'say', {text: 'Enough wandering. I choose my own road again.'});
      calm(); sim.step(1 / 60);
      ok(r.ok && !a.playIdle, 'an action from the agent takes the reins back' + (r.ok ? '' : ': ' + r.error));
    } finally {seedRng(null); hold = false}}
  // E. English only: a model answering in Chinese is re-prompted in English, its lines never reach the chat,
  // its empty turns get a fresh context and stop the runner; the game refuses a foreign-script line
  {const a = pick(), n0 = seen.length;
    const R = runner(a, 'mock-zh:1b', ['--heartbeat', '10', '--min-gap', '0', '--max-fails', '3', '--new']);
    const code = await Promise.race([R.done, sleep(60000).then(() => 'timeout')]);
    const mine = seen.slice(n0), en = mine.filter(b => {const u = b.messages.filter(m => m.role === 'user').pop(); return u && /^Answer in English only/.test(u.content)});
    ok(code === 0 && /3 failed or empty turns in a row/.test(R.out) && (R.out.match(/empty turn \(not in English\)/g) || []).length === 3, 'a model answering in Chinese: three empty turns, then the runner stops' + (code === 0 ? '' : '\n' + R.out.slice(-1200)));
    ok(en.length === 3, `each turn it is re-prompted once to answer in English (${en.length})`);
    ok(!/[一-鿿]/.test(R.out) && !(a.playNarr || []).some(n => /[一-鿿]/.test(n.text)) && !(a.chat || []).some(e => /[一-鿿]/.test(e.text)), 'no Chinese line reaches the runner output, the Agent tab or the chat');
    ok(mine.every(b => b.options.temperature === 0.6 && b.options.repeat_penalty === 1.15), 'local turns sample at temperature 0.6 with a repeat penalty');
    ok(/fresh context/.test(R.out) && mine.some(b => b.messages.filter(m => m.role === 'assistant').length === 0 && /^Turn 3/.test((b.messages[1] || {}).content || '')), 'after two empty turns the next one starts from a fresh context');
    const sz = sim.playerAct(a.id, 'say', {text: '我将带领团队去见萨满'});
    ok(!sz.ok && /speak in English/.test(sz.error), 'the game refuses a foreign-script line: ' + sz.error);
    sim.markPlayer(a, false)}

  // D. hearing: an agent's line wakes the agent heroes who hear it, at most once per few game minutes each
  {clearInterval(tick);
    const A = pick(), B = chooseHero({fac: 0}); park(B); sim.markPlayer(B, true); B.x = A.x + 1; B.y = A.y;
    sim.step(1 / 60); const nB = B.playEvN || 0;
    const r1 = sim.playerAct(A.id, 'say', {text: 'Ready when you are.'}); sim.step(1 / 60);
    const heard = (B.playEv || []).filter(e => e.n > nB && /Ready when you are/.test(e.text));
    ok(r1.ok && heard.length === 1 && heard[0].w === 2, `${B.name} hears ${A.name}'s line and it starts a turn promptly (wake ${heard[0] && heard[0].w})`);
    const n2 = B.playEvN; sim.playerAct(A.id, 'say', {text: 'Did you hear me?'}); sim.step(1 / 60);
    const again = (B.playEv || []).filter(e => e.n > n2 && /Did you hear me/.test(e.text));
    ok(again.length === 1 && !again[0].w, 'a second line within the debounce is heard but does not start another turn (no ping-pong)');
    const mine = (A.chat || []).filter(e => e.from === A && e.trigger === 'agent');
    ok(mine.length && mine.every(e => e.agent && /^Agent \(/.test(e.model) && !e.ai), 'the agent\'s lines are tagged Agent for the Chat tab, not AI');
    const chat = await import('../src/sim/chat.js'), c0 = (A.chat || []).length; A.chatCd = 0;
    chat.say(A, 'banter', {zone: 'x'}); chat.say(A, 'levelup', {}); const c1 = (A.chat || []).length; A.chatCd = 0;
    chat.say(A, 'spot', {mob: 'a test wolf', level: 9}); const c2 = (A.chat || []).length;
    ok(c1 === c0 && c2 === c1, 'an agent hero voices no scripted line at all (banter, level-up, combat call)');
    sim.markPlayer(A, false); sim.markPlayer(B, false)}

  // F. a Table scene played by a local model that writes scene_act as text under a made-up label and then calls wait
  // (issue #163, the owner's live Fellowship at 01:25): the game refuses a wait on your own turn, the runner plays the
  // member's scene turn as one structured answer and sends scene_act itself, and the scene resolves by the agents'
  // choice (not reflex) without the table timing out; no label or written call reaches the Agent tab.
  {const {found, autoPick, setMinds, TABLE} = sim, {openScene} = await import('../src/sim/table.js');
    const fo = found(autoPick(0), {fac: 0, ai: false}); setMinds('agent'); S.brainOn = false;
    ok(fo.ok && S.fellowship && S.fellowship.ids.length === 5, 'a Fellowship of five, Minds: agents' + (fo.ok ? '' : ': ' + fo.error));
    const mem = S.fellowship.ids.map(id => S.agents.find(x => x.id === id));
    // the game side first: no waiting out your own turn
    {const sc0 = openScene('check', 'A test of patience', ['The DM calls for a roll.'], {}); sc0.phase = 'turn'; sc0.i = 0;
      const first = S.agents.find(x => x.id === sc0.ids[0]), second = S.agents.find(x => x.id === sc0.ids[1]);
      const w1 = sim.playerAct(first.id, 'wait', {minutes: 10}), w2 = sim.playerAct(second.id, 'wait', {minutes: 10});
      ok(!w1.ok && /^It is your turn at the table: call scene_act with one of: (aid, )?steady, press\.$/.test(w1.error), 'wait on your own scene turn is refused: ' + (w1.error || 'allowed'));
      ok(w2.ok && w2.pending, 'a member whose turn is still to come may wait for it');
      S.table = null;
      // a combat scene: the brief's scene keys (the forced turn's enum) carry the member's ready class abilities by id
      const {paceBrief} = await import('../src/sim/pace.js'), {movesOf} = await import('../src/sim/moves.js');
      const foe = S.mobs.find(m => m.alive && !m.gone && !m.elite), hunter = mem.find(a => movesOf(a).length) || mem[0];
      hunter.mcr = {}; // every ability ready this round (a world-dependent cooldown made this flaky)
      const sc1 = openScene('rescue', 'A test fight', ['A beast lunges.'], {hero: hunter.id, mob: foe.id});
      const bk = paceBrief(hunter.id).brief.scene;
      ok(bk && bk.keys.includes('strike') && movesOf(hunter).some(id => bk.keys.includes(id)), `the forced turn's enum includes ready abilities by id (${hunter.cls}: ${bk && bk.keys.join(', ')})`);
      S.table = null; void sc1}
    TABLE.speed = 1; speed = 1; last = Date.now();
    const tick1 = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; const n = Math.ceil(real / (1 / 60)); for (let i = 0; i < n; i++) sim.step(real / n)}, 50);
    const p = spawn(process.execPath, ['scripts/fellowship.mjs', '--url', PB, '--provider', 'ollama', '--model', 'mock-fumble:1b', '--min-gap', '0', '--heartbeat', '1440', '--ollama-url', OLLAMA], {cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']});
    kids.push(p); let fout = ''; p.stdout.on('data', d => fout += d); p.stderr.on('data', d => fout += d);
    const claimed = await (async () => {for (let i = 0; i < 200; i++) {const h = await health(PB).catch(() => null); if (h && h.heroes.filter(x => x.fellow && x.claimed).length === 5) return true; await sleep(100)} return false})();
    ok(claimed, 'the Fellowship runner claims all five (mock-fumble:1b)' + (claimed ? '' : '\n' + fout.slice(-1500)));
    await until(() => !S.table, 30000);
    const f0 = seen.fumble || 0, t0 = Date.now(), sc = openScene('check', 'A test of nerve', ['The DM calls for a roll at the ford.'], {});
    ok(sc && sc.pause, 'a scene opens and the world pauses for it');
    const doneIn = await until(() => S.table !== sc, 90000) ? Date.now() - t0 : null;
    ok(doneIn != null && doneIn < TABLE.liveMs && !sc.late, `the scene resolves without the table timing out (${doneIn == null ? 'still open' : (doneIn / 1000).toFixed(1) + ' s'}, limit ${TABLE.liveMs / 1000} s)` + (doneIn != null ? '' : '\n' + fout.slice(-2500)));
    ok(sc.beats.length === 5 && sc.beats.every(b => b.by === 'agent' && b.k === 'press'), 'every member acted by its agent\'s choice (press), none by reflex: ' + sc.beats.map(b => b.name + ' ' + b.k + '/' + b.by).join(', '));
    ok((seen.fumble || 0) > f0 && seen.some(b => b.model === 'mock-fumble:1b' && b.format && b.format.properties && b.format.properties.option && b.format.properties.option.enum.includes('press')), 'the scene turn asked for one structured answer with the member\'s options as the enum');
    ok(/forced scene turn/.test(fout) && /> scene_act\(\{"option":"press"/.test(fout), 'the runner played forced scene turns and sent scene_act itself');
    const narr = mem.flatMap(a => (a.playNarr || []).map(n => n.text));
    ok(narr.length && !narr.some(t => /CallCheck|scene_act\s*\(|^---/m.test(t)), `no label or written call reaches the Agent tab (${narr.length} lines)`);
    p.kill(); clearInterval(tick1);
    {const {hostname} = await import('node:os'); for (const a of mem) await fetch(PB + '/play/release', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: a.id, runner: `${hostname()}:${p.pid}:fellowship`})}).catch(() => {})} // a killed runner cannot let go itself

    // G. the owner's screenshot: members re-introduce themselves every turn. The game refuses a line an agent already said
    // (or a second introduction once they have met), and every turn's header carries what was said lately and who it met.
    {const n0 = seen.length; await sleep(300); last = Date.now();
      const tick8 = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; const dt = real * 8, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) sim.step(dt / n)}, 50);
      const q = spawn(process.execPath, ['scripts/fellowship.mjs', '--url', PB, '--provider', 'ollama', '--model', 'mock-intro:1b', '--max-turns', '2', '--min-gap', '0', '--heartbeat', '30', '--ollama-url', OLLAMA], {cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']});
      kids.push(q); let qo = ''; q.stdout.on('data', d => qo += d); q.stderr.on('data', d => qo += d);
      const code = await Promise.race([new Promise(r => q.on('exit', r)), sleep(120000).then(() => 'timeout')]);
      clearInterval(tick8);
      const live = mem.filter(a => a.state !== 'dead'), refused = (qo.match(/< \{"ok":false,"error":"You (have already met your companions|already said that)/g) || []).length;
      ok(code === 0, 'mock-intro: every member plays two turns' + (code === 0 ? '' : ' (' + code + ')\n' + qo.slice(-2000)));
      ok(refused === live.length, `the first introduction goes through, the repeat is refused with an error the model sees (${refused} refused of ${live.length} members)` + (refused === live.length ? '' : '\n' + qo.slice(-2500)));
      // counted from the runner's own log (the chat buffer keeps only 20 lines per hero)
      const intros = live.map(a => (qo.match(new RegExp('\\[' + a.name + '\\] < \\{"ok":true,"said":"Hello friends! I am ', 'g')) || []).length);
      ok(intros.every(n => n === 1), 'each member introduced itself once in the party chat: ' + intros.join(', '));
      const later = seen.slice(n0).filter(b => b.model === 'mock-intro:1b' && b.tools).map(b => (b.messages.filter(m => m.role === 'user' && /^Turn \d/.test(m.content)).pop() || {}).content || '').filter(Boolean);
      ok(later.some(t => /Said lately \(party and aloud, oldest first\): .*\[party\]: Hello friends! I am /.test(t) && /Companions you have met: \w+/.test(t) && /do not introduce yourself again/.test(t)), 'a later turn\'s header shows the party lines heard and the companions met');
      const mt = (await import('../src/sim/talk.js')).metNames(live[0]);
      ok(live.slice(1).every(b => mt.includes(b.name)), `meeting is recorded in game once both have spoken in each other's hearing (${live[0].name} met ${mt.join(', ')})`);
    }
  }
  server.close();
}

// ---------------------------------------------------------------- the page's links message
console.log('relay links message');
{
  const msgs = [];
  const be = {call: async () => ({ok: true}), narrate() {}, info: () => ({connected: true, heroes: [{id: 7, name: 'Ann', alive: true}]}), links: (l, r) => msgs.push({l, r})};
  const server = http.createServer((q, s) => {s.writeHead(404); s.end()});
  attachPlay(server, {backend: be, log: () => {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const u = `http://127.0.0.1:${server.address().port}`;
  const c = await fetch(u + '/play/claim', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: 7, runner: 'r1', provider: 'ollama', model: 'qwen2.5:14b'})}).then(r => r.json());
  ok(c.runner && c.runner.model === 'qwen2.5:14b', 'the claim answer echoes the runner model');
  const m = msgs[msgs.length - 1];
  ok(m && m.r[7] && m.r[7].provider === 'ollama' && m.l[7] === 'waiting', 'the page hears the runner model with the link state');
  await fetch(u + '/play/claim', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: 7, runner: 'r1'})});
  ok((await health(u)).heroes[0].runner.model === 'qwen2.5:14b', 'a refresh without the model keeps it');
  const bad = await fetch(u + '/play/claim', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: 7, runner: 'r2', provider: 'ollama', model: 'x'})});
  ok(bad.status === 409, 'a second runner is still refused');
  const w = await fetch(u + '/play/claim', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: 7, runner: 'r1', provider: '<script>', model: 'a b'})}).then(r => r.json());
  ok(w.runner.model === 'qwen2.5:14b', 'unsafe provider or model names are ignored');
  server.close();
}

for (const k of kids) try {k.kill()} catch {}
closeOllama();
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fail ? `\nlocalcheck: ${fail} FAILED` : '\nlocalcheck: all ok');
process.exit(fail ? 1 : 0);
