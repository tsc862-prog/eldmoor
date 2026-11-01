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
// Sessions go to a temporary folder (AGENT_LOGS), never to logs/agents/.
// Usage: npm run localcheck
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localTurn, cleanArgs, parseTextCall, trimHistory, ollamaTools, LOCAL_DEFAULTS} from './local-agent.mjs';
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
  const {S} = sim; sim.init({fellowship: false}); for (let i = 0; i < 60 * 30; i++) sim.step(1 / 60);
  const speed = 8; let last = Date.now();
  const tick = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; const dt = real * speed, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) sim.step(dt / n)}, 50);
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
    await until(() => R.turns.length >= 2, 30000); park(a);
    notify(a, 'A test traveller hails you from the road.', true); const t2 = R.turns[1].real;
    await until(() => R.wakes.length >= 2, 15000);
    const w2 = R.wakes[1], dt = w2 ? w2.real - t2 : null;
    ok(w2 && w2.kind === 'soft' && dt >= 3500 && dt < 9000, `other news starts a turn once the gap has passed, not at the heartbeat: ${w2 && w2.kind} after ${dt} ms`);
    await until(() => R.turns.length >= 3, 30000);
    sim.markPlayer(a, false);
    const code = await Promise.race([R.done, sleep(20000).then(() => 'timeout')]);
    ok(code === 0 && /the hero left agent play/.test(R.out), 'a hero taken out of agent play ends its runner' + (code === 0 ? '' : '\n' + R.out.slice(-1200)))}

  // C. a lazy model (the owner's live bug): re-prompted once per turn, empty turns stop the runner, the scripted rules take over
  {const a = pick(), n0 = seen.length;
    const R = runner(a, 'mock-lazy:1b', ['--heartbeat', '10', '--min-gap', '0', '--max-fails', '3', '--new']);
    const code = await Promise.race([R.done, sleep(60000).then(() => 'timeout')]);
    const mine = seen.slice(n0), re = mine.filter(b => {const u = b.messages.filter(m => m.role === 'user').pop(); return u && /^Act through a tool/.test(u.content)});
    ok(code === 0 && R.turns.length === 6 && /3 failed or empty turns in a row/.test(R.out), `three good turns, then three empty ones stop the runner (${R.turns.length} turns)` + (code === 0 ? '' : '\n' + R.out.slice(-1500)));
    ok(re.length === 3 && (R.out.match(/re-prompted to act/g) || []).length === 3 && (R.out.match(/empty turn \(no tool call\)/g) || []).length === 3, `each empty turn was re-prompted once to act through a tool (${re.length})`);
    const lastReq = mine[mine.length - 1], narrs = lastReq.messages.filter(m => m.role === 'assistant' && /still battling/.test(m.content || ''));
    ok(narrs.length <= 2, `the model's own old narrations are not fed back (${narrs.length} in the last request, this turn's only)`);
    const x0 = a.x, y0 = a.y, s0 = a.state;
    ok(await until(() => a.playIdle, 15000), 'with no command for 2 game hours the scripted rules take over the idle hero');
    ok(await until(() => a.state !== s0 || Math.abs(a.x - x0) + Math.abs(a.y - y0) > 1, 20000), `and play it (${s0} -> ${a.state})`);
    ok((a.playEv || []).some(e => /instincts carry you/.test(e.text)), 'the hero is told so (an event the agent reads when it comes back)');
    const r = sim.playerAct(a.id, 'say', {text: 'Enough wandering. I choose my own road again.'});
    sim.step(1 / 60);
    ok(r.ok && !a.playIdle, 'an action from the agent takes the reins back' + (r.ok ? '' : ': ' + r.error))}
  clearInterval(tick); server.close();
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
