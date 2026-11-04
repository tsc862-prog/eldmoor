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
import {mkdtempSync, readFileSync, existsSync, rmSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localTurn, cleanArgs, parseTextCall, parseTextCalls, cleanNarration, sceneFrom, sceneDue, sceneToAnswer, sceneSchema, sceneTurn, scenePrompt, localLine, trimHistory, ollamaTools, LOCAL_DEFAULTS} from './local-agent.mjs';
import {ollamaAdapter, numCtxFrom} from './providers/ollama.mjs';
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
  ok(cleanArgs('move_to', {}).error && cleanArgs('choose', {option: 'c'}).error && cleanArgs('teleport', {}).error, 'a missing argument, a bad enum and an unknown tool are rejected');
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
  {const sf = sceneFrom({scene: 'SESSION ZERO', kind: 'opening', frame: 'On the board: the Fang of the Old Wood.', options: ['introduce = Introduce yourself'], your_turn: true, you: {name: 'Oskwy', cls: 'Mage', persona: 'dry, careful, counts everything', oath: 'Stand at the mouth of the Sunken Crypt'}}), sp = scenePrompt(sf);
    ok(/You are Oskwy, a mage\./.test(sp) && /Who you are: dry, careful/.test(sp) && /Your own oath: Stand at the mouth/.test(sp) && /about yourself/.test(sp) && /never the DM's words or a companion's line as your own/.test(sp), 'a forced scene prompt carries the hero itself: name, persona line, own oath, "about yourself" (#571: two members parroted the frame job)')}
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
  { // #681: a scene already acted in, one not open to this member, and one just answered are never forced again
    const base = {scene: 'Back again', kind: 'talk', frame: 'A word at the gate.', options: ['accept = Agree', 'decline = Refuse']};
    ok(sceneFrom({...base, acted: true, your_turn: false, everyone_answers: true}) === null, 'acted: no scene');
    ok(sceneFrom({...base, your_turn: false, everyone_answers: true}) === null, 'an everyone-answers scene not open to this member: no scene');
    ok(sceneFrom({...base, kind: 'elite', phase: 'turn', your_turn: false}) === null, 'a turn scene on another member turn: no scene');
    ok(sceneFrom({...base, your_turn: true, everyone_answers: true}) !== null, 'an open everyone-answers scene is answered');
    const mine = {...base, your_turn: true}, sess681 = {system: 's'}, g681 = async () => ({ok: true});
    ok(sceneDue(mine, sess681) !== null, 'not answered yet: due');
    const A681 = {ask: async () => ({text: '{"option":"accept","line":"Aye."}', usage: {in: 1, out: 1, cost: 0}, ms: 1})};
    await sceneTurn({ask: A681.ask, call: g681, sess: sess681, scene: sceneFrom(mine), keep: false});
    ok(sceneDue(mine, sess681) === null, 'the scene the session just answered is not due again (brief shows it stale)');
    ok(await sceneToAnswer({scene: mine}, g681, false, sess681) === null && await sceneToAnswer({table: true}, async () => ({ok: true, table: mine}), true, sess681) === null, 'neither the brief path nor the status fallback forces it');
    ok(sceneDue({...mine, frame: 'Another word, later.'}, sess681) !== null, 'a different scene is due');
    ok(await sceneToAnswer({table: true}, async () => ({ok: true, table: {...base, acted: true, your_turn: false, everyone_answers: true}}), true, {}) === null, 'the status fallback honours acted');
  }
  const sch = sceneSchema(scene.keys), schS = sceneSchema(scene.keys, {strict: true});
  ok(sch.properties.option.enum.join() === 'strike,guard,retreat' && sch.properties.line.maxLength === 600 && sch.required.join() === 'option,line' && !schS.properties.line.maxLength && schS.additionalProperties === false, 'the schema: an enum of that member\'s options and a line of at most 600 (the game TABLE.LINE_MAX, #571) (strict OpenAI: no maxLength, cut in code)');
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

// ---------------------------------------------------------------- 1c. fenced JSON calls and DM argument shapes (issue #401)
console.log('fenced JSON calls inside prose, DM argument shapes (issue #401)');
{
  const {DM_TOOLS} = await import('../src/data/dm-tools.js');
  // the live DM form: prose, then the call as a fenced json block (44 DM calls were lost this way)
  const dmReply = 'The Fellowship rides past the old mill. A wary hermit should cross their road.\n\n```json\n{"name": "stage_scene", "arguments": {"kind": "meeting", "near": "fellowship", "frame": "A ragged hermit steps out of the reeds, leaning on a staff.", "cast": {"role": "hermit", "want": "a lost charm"}, "reason": "a lead for their oath"}}\n```\n\nThat should give them something to chew on.';
  const fc = parseTextCalls(dmReply, DM_TOOLS);
  ok(fc.length === 1 && fc[0].function.name === 'stage_scene' && fc[0].function.arguments.cast.role === 'hermit' && fc[0].function.arguments.reason === 'a lead for their oath', 'a ```json {"name","arguments"} block inside prose is a call');
  const fn = cleanNarration(dmReply, DM_TOOLS, fc);
  ok(!/```|stage_scene|"kind"/.test(fn) && /old mill/.test(fn) && /chew on/.test(fn), 'the fenced call is cut from the narration, the prose stays: ' + JSON.stringify(fn));
  const two = parseTextCalls('First the board, then a word:\n```\n[{"tool": "pull_lever", "args": {"lever": "post_hook", "params": {"town": "Highgate", "tpl": "rescue"}, "reason": "their road"}}, {"function": {"name": "log_intent", "arguments": "{\\"text\\": \\"a rescue for them\\"}"}}]\n```', DM_TOOLS);
  ok(two.length === 2 && two[0].function.name === 'pull_lever' && two[0].function.arguments.params.tpl === 'rescue' && two[1].function.name === 'log_intent' && two[1].function.arguments.text === 'a rescue for them', 'a fenced list, {tool,args} and {function:{name,arguments as text}} forms count too');
  ok(parseTextCalls('Here is the plan:\n```json\n{"region": "Mirefen", "kind": "fogbound"}\n```', DM_TOOLS).length === 0 && parseTextCalls('```\nnot json at all\n```').length === 0, 'a fenced block that is not a call stays narration');
  ok(parseTextCalls('```json\n{"name": "hunt", "arguments": {"n": 2}}\n```')[0].function.name === 'hunt', 'a hero\'s fenced call (the whole reply) runs too');
  // issue #468: the shapes of the 2026-11-03 qwen2.5:14b turns (echoed prompt, junk-prefixed calls, a Chinese tail)
  const junk = parseTextCalls('Fragistics {"name": "fight", "arguments": {"target_id": 1}} </tool_call>');
  ok(junk.length === 1 && junk[0].function.name === 'fight' && junk[0].function.arguments.target_id === 1 && cleanNarration('Fragistics {"name": "fight", "arguments": {"target_id": 1}} </tool_call>') === '', 'a call behind a junk word with a stray </tool_call> is parsed, and nothing of it is narration');
  ok(parseTextCalls('INdEx {"name": "inventory", "arguments": {}} </tool_call>')[0].function.name === 'inventory' && parseTextCalls('Mirora braces.\nINdEx {"name": "fight", "arguments": {"target_id": 4}}')[0].function.arguments.target_id === 4, 'the same on a line after prose');
  ok(parseTextCalls('I check {"name": "Bob"} and leave.').length === 0 && cleanNarration('INdEx="Dovas is taking care of me."') === 'Dovas is taking care of me.', 'an object with only a name stays prose; a junk assignment loses its label');
  const echo = cleanNarration('Halis reviewed his status. End your turn now: one short sentence of narration in the third person about what you did and why. Halis waited patiently as the world paused.');
  ok(echo === 'Halis reviewed his status. Halis waited patiently as the world paused.', 'the echoed end-of-turn instruction is cut: ' + JSON.stringify(echo));
  ok(cleanNarration('I am at full health now. End of turn: Mirora confirms her status and remains ready.') === 'Mirora confirms her status and remains ready.' && cleanNarration('Maelwen led the party through the gate. **End of turn.**') === 'Maelwen led the party through the gate.', '"End of turn:" keeps the summary after it, or the words before a closing label');
  ok(!/turn with one short/.test(cleanNarration('... nd your turn with one short sentence of narration in the third person about what you did and why. Sylis nodded.')), 'a clipped echo ("nd your turn with ...") is cut too');
  const cjk = cleanNarration('For now, let me wait and see what happens next. 等候进一步指示。'), mid = cleanNarration('It seems there was an issue. 等候片刻后，我将继续尝试向北前进。 I will now try moving north again.');
  ok(cjk === 'For now, let me wait and see what happens next.' && mid === 'It seems there was an issue. I will now try moving north again.', 'a Chinese tail or middle sentence is cut from English narration: ' + JSON.stringify(cjk));
  ok(cleanNarration('等候进一步指示，我们继续前进吧。') === '等候进一步指示，我们继续前进吧。', 'a wholly foreign reply is left whole for the caller to flag and re-prompt');
  {const ran = [], seq = [{role: 'assistant', content: 'The wolf lunges.\nFragistics {"name": "fight", "arguments": {"target_id": 7}} </tool_call>'}, {role: 'assistant', content: '', tool_calls: [{function: {name: 'wait', arguments: {minutes: 10}}}]}, {role: 'assistant', content: 'Mirora fought the wolf. End your turn now: one short sentence of narration in the third person about what you did and why. 等候进一步指示。'}];
    let k = 0; const r = await localTurn({chat: async () => ({message: seq[Math.min(k++, seq.length - 1)], usage: {in: 1, out: 1}, ms: 1}), call: async (tool, args) => {ran.push(tool + JSON.stringify(args)); return {ok: true}}, sess: {system: 'You are Mirora.'}, prompt: 'A Timber Wolf attacks.', model: 'm'});
    ok(ran[0] === 'fight{"target_id":7}' && ran[1] === 'wait{"minutes":10}', 'in a turn the junk-prefixed fight call runs: ' + ran.join(' '));
    ok(r.narration === 'Mirora fought the wolf.' && !r.foreign, 'and the closing narration loses the echo and the Chinese tail: ' + JSON.stringify(r.narration))}
  // issue #467: the circuit breaker and the per-minute call cap
  {const refuse = async () => ({ok: false, error: 'Refused: unknown place "{"x":-5,"y":0}"'}), same = {role: 'assistant', content: '', tool_calls: [{function: {name: 'mark_place', arguments: {kind: 'ruin', near: '{"x":-5,"y":0}', reason: 'r'}}}]};
    let n = 0; const s1 = {system: 'You are the DM.'}, r = await localTurn({chat: async () => {n++; return {message: same, usage: {in: 1, out: 1}, ms: 1}}, call: refuse, sess: s1, prompt: 'Your turn.', model: 'm', tools: DM_TOOLS, toolTurns: 16, opts: {endOnWait: false}});
    ok(r.broke && r.broke.tool === 'mark_place' && r.broke.n === 3 && r.tools === 3 && n === 3, `the same refusal 3 times ends the turn (${r.tools} calls, ${n} model calls of 16 allowed)`);
    ok(/ended early: 3 refusals of mark_place/.test(localLine(r, 'm')) && s1.local.history.some(m => m.role === 'user' && /ended early/.test(m.content)), 'the turn line says so and the next turn is told why');
    let k = 0; const mixed = ['mark_place', 'post_hook', 'npc_say', 'pull_lever', 'place_person', 'narrate'].map(t => ({role: 'assistant', content: '', tool_calls: [{function: {name: t, arguments: {}}}]}));
    const r2 = await localTurn({chat: async () => ({message: mixed[Math.min(k++, mixed.length - 1)], usage: {in: 1, out: 1}, ms: 1}), call: refuse, sess: {system: 'x'}, prompt: 'Your turn.', model: 'm', tools: DM_TOOLS, toolTurns: 16, opts: {endOnWait: false}});
    ok(r2.broke && r2.tools === 5 && r2.broke.inRow === 5, `5 refusals in a row of different tools end it too (${r2.tools} calls)`);
    const s3 = {system: 'x'}, three = {role: 'assistant', content: '', tool_calls: ['dm_status', 'hooks', 'npcs'].map(t => ({function: {name: t, arguments: {}}}))};
    let total = 0; const okCall = async () => {total++; return {ok: true}};
    for (let t = 0; t < 6; t++) await localTurn({chat: async () => ({message: three, usage: {in: 1, out: 1}, ms: 1}), call: okCall, sess: s3, prompt: 'Turn.', model: 'm', tools: DM_TOOLS, toolTurns: 16, opts: {endOnWait: false, callsPerMin: 30}});
    ok(total === 30, `the minute cap holds a looping DM to 30 calls over 6 quick turns (${total}; the flood line is 90)`)}
  // a lever called as a tool, and lever params at the top level
  const lv = cleanArgs('mark_cleared', {region: 'Mirefen'}, DM_TOOLS);
  ok(lv.error && /pull_lever/.test(lv.error) && /"lever":"mark_cleared"/.test(lv.error), 'a lever name called as a DM tool is pointed at pull_lever: ' + (lv.error || '').slice(-120));
  ok(!/pull_lever/.test(cleanArgs('teleport', {}).error), 'a hero\'s unknown tool gets no lever hint');
  const flat = cleanArgs('pull_lever', {lever: 'set_condition', region: 'Mirefen', kind: 'fogbound', reason: 'fog'}, DM_TOOLS);
  ok(flat.args && flat.args.params.region === 'Mirefen' && flat.args.params.kind === 'fogbound' && flat.args.lever === 'set_condition', 'a lever\'s params given beside lever and reason are folded into params, not dropped');
  ok(/reason/.test(cleanArgs('stage_scene', {kind: 'meeting', near: 'fellowship'}, DM_TOOLS).error || ''), 'stage_scene needs a reason in the schema');
  // end to end: a local DM turn whose reply carries the fenced call runs it
  const ran = []; let i = 0;
  const replies = [{role: 'assistant', content: dmReply}, {role: 'assistant', content: 'The hermit waits on their road.'}];
  const r = await localTurn({chat: async () => ({message: replies[Math.min(i++, replies.length - 1)], usage: {in: 10, out: 5, cost: 0}, ms: 1}), call: async (tool, args) => {ran.push([tool, args]); return {ok: true}}, sess: {system: 'You are the DM.'}, prompt: 'Your turn.', model: 'm', tools: DM_TOOLS, toolTurns: 4});
  ok(ran.length === 1 && ran[0][0] === 'stage_scene' && ran[0][1].frame.startsWith('A ragged hermit') && r.tools === 1 && r.rejected === 0, `a local DM turn runs the fenced stage_scene call (${ran.map(x => x[0]).join(',') || 'none'})`);
}

// ---------------------------------------------------------------- 1d. the stated aim (issue #535) for local and OpenAI minds
// The local turn prompt asks "What are you trying to do now?" when the aim is missing or stale (and the intent tool is in the
// tool table); the forced reflection answer carries an optional intent the runner sends with the intent tool.
{
  const LA = await import('./local-agent.mjs'), PC = await import('./pacing.mjs');
  {const sw = LA.reflectSchema({swear: true}), ss = LA.reflectSchema({swear: true, strict: true}); // a first dusk asks about the thread (#800)
   ok(sw.properties.swear && !sw.required.includes('swear') && ss.required.includes('swear') && !LA.reflectSchema().properties.swear, 'the reflection carries swear only when a thread is asked about');
   ok(LA.reflectSwear('{"notes":[],"swear":""}') === null && LA.reflectSwear('{"notes":[],"swear":"No."}').thread === 'no' && LA.reflectSwear('{"notes":[],"swear":"yes"}').thread === 'yes' && LA.reflectSwear('{"notes":[],"swear":"I will find her."}').text === 'I will find her.', 'its answer becomes swear_oath arguments');
   const sent = []; const t = await LA.reflectTurn({ask: async () => ({text: '{"notes":[],"swear":"I will find her."}', usage: {}, ms: 0}), call: async (tool, args) => {sent.push([tool, args]); return {ok: true}}, sess: {system: 's'}, moment: {id: 'd1', kind: 'dusk', why: 'dusk', thread: 'Ann left home with something to prove.'}, prompt: 'p', keep: false});
   ok(sent.length === 1 && sent[0][0] === 'swear_oath' && sent[0][1].text === 'I will find her.' && t.swore, 'a forced reflection swears through the tool');
   const none = []; await LA.reflectTurn({ask: async () => ({text: '{"notes":[],"swear":"I will find her."}', usage: {}, ms: 0}), call: async (tool, args) => {none.push(tool); return {ok: true}}, sess: {system: 's'}, moment: {id: 'd2', kind: 'dusk', why: 'dusk'}, prompt: 'p', keep: false});
   ok(!none.length, 'with no thread asked about, nothing is sworn')}
  const lo = LA.reflectSchema(), st = LA.reflectSchema({strict: true});
  ok(lo.properties.intent && !lo.required.includes('intent') && st.required.includes('intent') && st.properties.intent.required.join() === 'goal,why,until', 'the reflection schema carries an intent object (optional; required by strict OpenAI)');
  ok(/"intent": \{"goal"/.test(PC.reflectPrompt({why: 'camp'}, {tools: false})) && /What are you trying to do next\?/.test(PC.reflectPrompt({why: 'camp'})), 'the reflection prompt asks what next (forced answer: an intent object; tool use: the intent tool)');
  ok(LA.reflectIntent('{"notes":[],"intent":{"goal":"","why":"","until":""}}') === null && LA.reflectIntent('{"notes":[]}') === null, 'an empty goal keeps the aim');
  const got = LA.reflectIntent('{"notes":[],"intent":{"goal":"Hunt boars in Dunmere","why":"to reach level 4","until":"3"}}');
  ok(got && got.goal === 'Hunt boars in Dunmere' && got.why === 'to reach level 4' && got.until === '3', 'a goal reads as {goal, why, until}');
  const sent = [];
  const t = await LA.reflectTurn({ask: async () => ({text: JSON.stringify({notes: [], become: {field: 'none', text: '', why: '', about: ''}, intent: {goal: 'Hunt boars in Dunmere', why: 'to reach level 4', until: '3'}}), usage: {in: 5, out: 5}}),
    call: async (tool, args) => {sent.push([tool, args]); return {ok: true, aim: args.goal}}, sess: {system: 's'}, moment: {id: 'm1', kind: 'dusk', why: 'dusk'}, prompt: 'p'});
  ok(sent.length === 1 && sent[0][0] === 'intent' && sent[0][1].goal === 'Hunt boars in Dunmere' && t.aimed === 'Hunt boars in Dunmere' && /Next: Hunt boars/.test(t.narration), 'a reflection answer with an intent sets the aim: ' + t.narration);
  const ask = {clock: 'Day 1 08:00', state: 'town', hp: '100%', level: 2, place: 'Highgate', aim: {state: 'stale', ask: true, line: 'hunt in Lowmark (set 3 h ago)', why: 'no progress toward it for 2 h'}};
  const bt = PC.briefText(ask);
  ok(bt.includes(PC.AIM_ASK) && /Your aim was: hunt in Lowmark/.test(bt) && /intent \{goal, why, until\}/.test(bt), 'a local turn prompt with a stale aim asks first: ' + bt.split('\n').find(l => l.includes(PC.AIM_ASK)));
  ok(!PC.briefText({...ask, aim: {state: 'set', ask: false, line: 'hunt in Lowmark (set 1 h ago)'}}).includes(PC.AIM_ASK) && /\nYour aim: hunt in Lowmark \(set 1 h ago\)/.test(PC.briefText({...ask, aim: {state: 'set', ask: false, line: 'hunt in Lowmark (set 1 h ago)'}})), 'a fresh aim is named, not asked');
  ok(LA.ollamaTools().some(x => x.function.name === 'intent' && x.function.parameters.properties.goal), 'the intent tool is in the local tool table');
}

// ---------------------------------------------------------------- the mock Ollama (scripts/mock-ollama.mjs)
const {url: OLLAMA, seen, close: closeOllama} = await startMockOllama();
let ctxFrom = 0; // where the runners' requests start in `seen` (after the adapter's own tests)

console.log('ollama adapter chat (mock server)');
{
  const ol = ollamaAdapter({url: OLLAMA, numCtx: 8192});
  const r = await ol.chat({model: 'mock-tools:1b', messages: [{role: 'user', content: 'Begin.'}], tools: ollamaTools(), numCtx: 4096}); // a per-call size is ignored (#221)
  ok(r.message.tool_calls && r.usage.in === 900 && r.usage.cost === 0, 'chat returns the tool calls and token counts, cost 0');
  const last = seen[seen.length - 1];
  ok(last.think === false && last.options.num_ctx === 8192 && last.stream === false && last.tools.length === ollamaTools().length, 'thinking off, the adapter context size (never a per-call one) and the tools are sent');
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
  // issue #221: one num_ctx for every local call, read from OLLAMA_NUM_CTX (default 16384), also on call() (the relay's minds, the DM's voices)
  ok(numCtxFrom({}) === 16384 && numCtxFrom({OLLAMA_NUM_CTX: '8192'}) === 8192 && numCtxFrom({OLLAMA_NUM_CTX: 'x'}) === 16384 && ollamaAdapter({url: OLLAMA}).numCtx === numCtxFrom(), 'OLLAMA_NUM_CTX, default 16384, is the one context size');
  await ollamaAdapter({url: OLLAMA, numCtx: 8192}).call({system: 's', user: 'u', schema: {type: 'object', properties: {option: {type: 'string', enum: ['a']}, line: {type: 'string'}}}, maxTokens: 50, model: 'mock-intro:1b'});
  ok(seen[seen.length - 1].options.num_ctx === 8192, 'call() (decisions, writing, the DM table and talk voices) sends it too');
  const ctxGpu = {numCtx: 16384, held: async () => [{name: 'qwen2.5:14b', ctx: 32768}]};
  const cn = await localModelNote(ctxGpu, 'qwen2.5:14b');
  ok(/Ollama holds qwen2.5:14b at 32768; runners ask 16384, so it reloads each time/.test(cn || '') && !(await localModelNote({numCtx: 16384, held: async () => [{name: 'qwen2.5:14b', ctx: 16384}]}, 'qwen2.5:14b')), 'a runner warns when Ollama holds its model at another context size: ' + (cn || '').slice(0, 90));
  // the owner's second live error (#221): "prediction aborted, token repeat limit reached". Retry once from a trimmed context at 0.4; twice: an empty turn, not a failure
  {
    const {localWorked, failTracker} = await import('./pacing.mjs'), olp = ollamaAdapter({url: OLLAMA}), lines = [];
    const sess = {system: 'You are Ann.', local: {mode: 'tools', history: Array.from({length: 6}, (_, k) => [{role: 'user', content: 'Turn ' + k + ' ' + 'x'.repeat(400), turn: 1}, {role: 'assistant', content: 'ok'}]).flat(), tokensIn: 0, tokensOut: 0, seconds: 0, dropped: 0}};
    const n0 = seen.length, h0 = sess.local.history.length;
    const r1 = await localTurn({chat: olp.chat, call: async () => ({ok: true}), sess, prompt: 'Turn 7.', model: 'mock-loop1:1b', toolTurns: 6, on: (k, a) => {if (k === 'loop') lines.push(a)}});
    const retry = seen.slice(n0).find(b => b.options.temperature === 0.4);
    ok(r1.loopRetried && !r1.looped && r1.tools > 0 && lines.length === 1 && retry && retry.options.num_ctx === olp.numCtx && retry.messages.length < h0 + 2, `a repeat-limit abort is retried once, trimmed and cooler (0.4, num_ctx ${retry && retry.options.num_ctx}), and the turn plays on`);
    const f = failTracker(2); f.ok(false);
    const r2 = await localTurn({chat: olp.chat, call: async () => ({ok: true}), sess: {system: 'x', local: {mode: 'tools', history: [], tokensIn: 0, tokensOut: 0, seconds: 0, dropped: 0}}, prompt: 'Turn 1.', model: 'mock-loop:1b', toolTurns: 6});
    ok(r2.looped && r2.tools === 0 && localWorked(r2) === null && !f.ok(localWorked(r2)) && f.count === 1 && /repeating itself twice/.test(localLine(r2, 'mock-loop:1b')), 'twice: the turn ends empty with a clear line, and it does not count toward --max-fails');
  }
  ok((await preferLoaded(gpu, 'qwen3.5:4b', ['qwen3.5:4b'])).model === 'qwen3.5:4b' && /evict each other/.test(await localModelNote(gpu, 'qwen3.5:4b')) && !(await localModelNote(gpu, 'qwen2.5:14b')), 'otherwise it keeps its model and warns that another one holds the GPU');
}

// ---------------------------------------------------------------- 2. the runner, end to end
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-localcheck-'));
ctxFrom = seen.length;
const childEnv = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OLLAMA_URL: OLLAMA, AGENT_MIN_GAP: '0', AGENT_HEARTBEAT: '30', AGENT_REFLECT: '0'}; // AGENT_REFLECT=0: no reflection turns where turn counts are exact; H passes --reflect (#179) // pacing (issue #126) kept short for the old sections
const kids = [];
function start(args, {wait: ready = null, env = childEnv} = {}) {
  const p = spawn(process.execPath, args, {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  kids.push(p); let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const done = new Promise(r => p.on('close', code => r(code)));
  const until = ready ? new Promise((res, rej) => {const t = setInterval(() => {if (ready.test(out)) {clearInterval(t); res()}}, 100); setTimeout(() => {clearInterval(t); rej(new Error('timeout waiting for ' + ready + '\n' + out))}, 120000)}) : null;
  return {p, done, until, out: () => out};
}
const port = 18700 + Math.floor(Math.random() * 600), BASE = `http://127.0.0.1:${port}`;
const health = base => fetch(base + '/play/health').then(r => r.json());

console.log('npm run agent -- --provider ollama (mock Ollama, headless world on port ' + port + ')');
const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '2', '--quiet', '--speed', '8', '--world', join(tmp, 'world.json')], {wait: /^\[play\] headless world at /m});
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
  const fw = start(['scripts/play-headless.mjs', '--fellowship', '--no-relay', '--port', String(fport), '--quiet', '--speed', '8', '--world', join(tmp, 'fworld.json')], {wait: /^\[play\] headless world at /m});
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
  const runs = readFileSync(join(tmp, 'fellowship-runs.jsonl'), 'utf8').trim().split('\n').pop(), j = JSON.parse(runs);
  ok(j.url === FB && j.spent === 0 && j.members.every(m => m.provider === 'ollama' && m.tokensIn > 0), 'the run record lists the local members with tokens and cost 0');
  // the company runner (#460): the same five, named as a company by one of its members
  const h2 = await health(FB), first = h2.heroes.find(x => x.fellow && x.alive), cid = first && first.company;
  ok(Number.isInteger(cid) && h2.heroes.filter(x => x.company === cid).length === 5 && h2.heroes.filter(x => x.company === cid && x.lead).length === 1, '/play/health names each member\'s company, its size and one leader');
  const crun = start(['scripts/fellowship.mjs', '--url', FB, '--company', first ? first.name : '?', '--provider', 'ollama', '--model', 'mock-tools:1b', '--max-turns', '1', '--cadence', '0', '--ollama-url', OLLAMA]);
  const ccode = await crun.done, cout = crun.out();
  ok(ccode === 0 && new RegExp('Company runner \\(.*company #' + cid + '\\)').test(cout), 'npm run fellowship -- --company <member> plays that company' + (ccode ? '\n' + cout.slice(-3000) : ''));
  ok((cout.match(/\[turn \d+(, scene)?\] mock-tools:1b \(local\)/g) || []).length === 5, 'each of its five plays a local turn');
  const cj = JSON.parse(readFileSync(join(tmp, 'fellowship-runs.jsonl'), 'utf8').trim().split('\n').pop());
  ok(cj.company === cid && cj.members.length === 5, 'the run record names the company');
  const bad = start(['scripts/fellowship.mjs', '--url', FB, '--company', 'nobody-at-all', '--provider', 'ollama', '--model', 'mock-tools:1b', '--ollama-url', OLLAMA]);
  ok(await bad.done === 1 && /No company "nobody-at-all"/.test(bad.out()), 'an unknown company is refused with the companies there are');
  fw.p.kill();
}
{const {companyPrompt, fellowshipPrompt} = await import('./fellowship.mjs');
  const three = companyPrompt({}, {name: 'The Dun Watch', size: 3}), solo = companyPrompt({}, {size: 1});
  ok(/^COMPANY: you ride with The Dun Watch\. 2 companions share your road/m.test(three) && !/Fellowship|Four companions/.test(three) && three.includes('party_say') && three.includes('do not introduce yourself again'), 'a company of three gets the company orders, sized, without the Fellowship\'s words');
  ok(/ride alone for now/.test(solo) && !/party_say/.test(solo) && fellowshipPrompt({fellowship: {fellowship: 'X', role: 'Tank'}}).includes('Four companions'), 'a solo gets its own short orders; the Fellowship keeps its own');}

// ---------------------------------------------------------------- 4. pacing (issue #126)
// An in-process world (so the check can read the game clock and raise events) served over HTTP like
// play-headless, and real runner processes against it: turns follow game time and events, a notification
// that cannot wait starts a turn at once, others wait for the minimum gap, a lazy model is re-prompted and
// stopped after its empty turns, the scripted rules take over an idle hero, and leaving agent play ends the run.
console.log('runner pacing (in-process world at 8x, mock Ollama)');
{
  const sim = await import('../src/sim/index.js'), {localBackend, chooseHero} = await import('./play-headless.mjs');
  const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
  const {notify} = await import('../src/sim/notify.js'), {homeOf} = await import('../src/data/races.js');
  const {S} = sim, {maxHp: maxHpOf} = await import('../src/sim/heroes.js'); sim.init({fellowship: false});
  const {REFLECT} = await import('../src/sim/reflect.js'), PER_DAY = REFLECT.PER_DAY; REFLECT.PER_DAY = 0; // no reflection moments in A-G (their turn counts are exact); H turns them on (#179)
  for (let i = 0; i < 60 * 30; i++) sim.step(1 / 60);
  let speed = 8, last = Date.now(), hold = false; // hold: a section steps the world itself (deterministic, issue #159)
  const tick = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; if (hold) return; const dt = real * speed, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) sim.step(dt / n)}, 50);
  const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
  // idle: the runner sits in its pace poll (no turn in flight). Section B drops its news there, as a hero's news arrives between turns; a notice that lands inside a turn is read by that turn's next tool result, which is the game doing its job (takeEvents).
  const be = localBackend(), callOrig = be.call.bind(be), flight = {pace: 0, tool: 0}; be.call = (id, tool, args, ...r) => {const k = tool === 'pace' && !(args && args.brief) ? 'pace' : 'tool'; flight[k]++; const done = () => {flight[k]--}; const p = callOrig(id, tool, args, ...r); Promise.resolve(p).then(done, done); return p};
  attachPlay(server, {backend: be, log: () => {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PB = `http://127.0.0.1:${server.address().port}`;
  const park = a => {const c = homeOf(a); a.state = 'town'; a.x = c.gate.x; a.y = c.gate.y - 1; a.target = null; a.pq = []; a.dest = null}; // in town: nothing attacks
  const pick = () => {const a = chooseHero({fac: 0}); park(a); sim.markPlayer(a, true); return a};
  // a runner process with its output lines timed against the real and the game clock
  function runner(a, model, extra) {
    const p = spawn(process.execPath, ['scripts/agent-player.mjs', '--url', PB, '--hero', String(a.id), '--provider', 'ollama', '--model', model, '--ollama-url', OLLAMA, ...extra], {cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']});
    kids.push(p); const R = {p, out: '', turns: [], wakes: [], done: new Promise(r => p.on('close', c => r(c)))}; let part = '';
    const take = d => {R.out += d; part += d; const ls = part.split(/\r?\n/); part = ls.pop();
      for (const l of ls) {const t = {real: Date.now(), gm: S.gameMin, line: l};
        if (/^\[turn \d+\]/.test(l)) R.turns.push(t); const w = l.match(/\[pace\] woke \((\w+)/); if (w) R.wakes.push({...t, kind: w[1], line: l})}};
    p.stdout.on('data', take); p.stderr.on('data', take); return R;
  }
  const until = async (f, ms) => {const t0 = Date.now(); while (Date.now() - t0 < ms) {if (f()) return true; await sleep(50)} return false};

  // A. a quiet hero: turns come from the heartbeat (60 game minutes here), never back to back
  // The world around the hero is not scripted: a hero going down within 12 tiles of the town gate tells it (an urgent 'down and dying' event,
  // #658) and starts a 'now' turn early (#762). This section is about the heartbeat, so the downed hearing is switched off while it runs.
  {const {DOWN} = await import('../src/sim/downed.js'), keep = {REACH: DOWN.REACH, SEE: DOWN.SEE}; DOWN.REACH = 0; DOWN.SEE = 0;
   const a = pick(), hb = 60, gap = 1;
    const R = runner(a, 'mock-tools:1b', ['--max-turns', '5', '--heartbeat', String(hb), '--min-gap', String(gap)]);
    const code = await R.done, g0 = R.turns[0], gN = R.turns[R.turns.length - 1];
    const hours = (gN.gm - g0.gm) / 60, perHour = (R.turns.length - 1) / Math.max(hours, 1e-9);
    // each later turn starts at least one heartbeat (or the gap, in game time) after the previous one ended
    const minGm = Math.min(hb, gap * 6 * speed), gaps = R.wakes.map((w, i) => w.gm - R.turns[i].gm);
    ok(code === 0 && R.turns.length === 5, `a quiet hero plays its 5 turns (${R.turns.length})` + (code === 0 ? '' : '\n' + R.out.slice(-1500)));
    ok(gaps.length === 4 && gaps.every(x => x >= minGm - 6), `turns wait for the game: ${gaps.map(x => Math.round(x)).join(', ')} game minutes between turns (at least ${minGm})`);
    ok(perHour <= 60 / minGm + .05, `at most one turn per ${minGm} game minutes on a quiet world: ${perHour.toFixed(2)} turns per game hour`);
    ok(R.wakes.every(w => w.kind === 'heartbeat' || w.kind === 'soft') && /up to 5 turns/.test(R.out) && /every 60 game min, at least 1 s apart/.test(R.out), `woken by the heartbeat or the hero's own news (${R.wakes.map(w => w.kind).join(', ')})${R.wakes.map(w => ' | ' + w.line).join('')}`);
    ok(/Right now \(from the game/.test(JSON.stringify(seen.slice(-6))) && !/still battling/.test(R.out), 'every local turn prompt carries the hero\'s state from the game');
    Object.assign(DOWN, keep); sim.markPlayer(a, false)}

  // B. a notification that cannot wait starts a turn at once, inside the gap; the hero's other news waits for the gap
  {const a = pick(), pinB = setInterval(() => {if (a.state !== 'dead') {if (a.state === 'downed') delete a.down; park(a); a.hp = maxHpOf(a)}}, 50); // kept alive, as in C: a hero lost to the unseeded world would end its runner early, and both checks below would read null
    const R = runner(a, 'mock-tools:1b', ['--heartbeat', '1440', '--min-gap', '4']);
    ok(await until(() => R.turns.length >= 1, 30000), 'a local runner without --max-turns plays (until stopped)');
    ok(/until stopped/.test(R.out), 'and says it runs until stopped');
    await sleep(400); park(a); const tN = Date.now();
    notify(a, 'Attacked by a level 3 test wolf!', 2);
    ok(await until(() => R.wakes.length >= 1, 4000), `an attack starts the next turn at once: ${R.wakes[0] ? R.wakes[0].kind + ' after ' + (R.wakes[0].real - tN) + ' ms' : 'no turn'}`);
    ok(R.wakes[0] && R.wakes[0].kind === 'now' && R.wakes[0].real - R.turns[0].real < 4000, 'inside the 4 s minimum gap');
    // (the world may wake the hero first, say an attack on the way: then try again after that turn)
    let w2 = null, dt = null;
    for (let k = 2; k <= 6 && !w2; k++) {
      await until(() => R.turns.length >= k, 30000); const idle = await until(() => flight.pace > 0 && flight.tool === 0, 15000); park(a); a.hp = a.maxhp || a.hp; if (!idle) console.log('  note: the runner was not waiting in its pace poll when news ' + k + ' was dropped');
      notify(a, 'A test traveller hails you from the road (' + k + ').', true); const nw = R.wakes.length;
      // the hero's own world news (XP, loot) may name itself in the wake line: any soft wake after the notice counts. An
      // urgent wake ('now') may come first on a slow machine (#603): skip it and measure from the turn before the soft one.
      const news = x => /test traveller/.test(x.line) || x.kind === 'soft';
      await until(() => R.wakes.slice(nw).some(news), 15000);
      const w = R.wakes.slice(nw).find(news);
      if (w) {w2 = w; dt = w.real - Math.max(...R.turns.filter(t => t.real < w.real).map(t => t.real))}
    }
    ok(w2 && w2.kind === 'soft' && dt >= 3500 && dt < 14000, `other news starts a turn once the gap has passed, not at the heartbeat: ${w2 && w2.kind} after ${dt} ms`+(w2?'':` | hero ${a.name} state ${a.state} hp ${Math.round(a.hp)} runner exited ${R.exited ?? '?'} turns ${R.turns.length} wakes ${R.wakes.map(w=>w.kind).join(',')}
${R.out.slice(-800)}`));
    await until(() => R.turns.length >= R.wakes.length + 1, 30000);
    clearInterval(pinB); sim.markPlayer(a, false);
    const code = await Promise.race([R.done, sleep(20000).then(() => 'timeout')]);
    ok(code === 0 && /the hero left agent play/.test(R.out), 'a hero taken out of agent play ends its runner' + (code === 0 && /the hero left agent play/.test(R.out) ? '' : ' (hero ' + a.state + ') ' + '\n' + R.out.slice(-1200)))}

  // C. a lazy model (the owner's live bug): re-prompted once per turn, empty turns stop the runner, the scripted rules take over
  {const a = pick(), n0 = seen.length;
    // --max-fails 3, but a fresh context after two empty turns breaks the loop first (the mock forgets it went lazy)
    // pinned in town at full health while it runs: autopilot or a wandering mob must not make rest/wait fail (a refused turn reads as empty)
    const pinC = setInterval(() => {park(a); a.hp = a.maxhp || a.hp;}, 50);
    const R = runner(a, 'mock-lazy:1b', ['--heartbeat', '10', '--min-gap', '0', '--max-fails', '3', '--max-turns', '8', '--new']);
    const code = await Promise.race([R.done, sleep(60000).then(() => 'timeout')]); clearInterval(pinC);
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
    const {seedRng} = await import('../src/core/rng.js'), {dist, CITY} = await import('../src/world/map.js'), {invOf} = await import('../src/sim/inv.js');
    hold = true; seedRng(159);
    try {
      let pin = null; // until autopilot first acts the hero is held at its spot and hurt (no regen, no walk into a town)
      const calm = () => {if (pin && !a.playIdle) {a.x = pin.x; a.y = pin.y; a.hp = pin.hp; a.dest = null} S.pvpT = 1; a.spotCd = 99; for (const m of S.mobs) {if (m.target === a) m.target = null; if (dist(m, a) < 30) m.scan = 1}
        if (a.state === 'fight' || a.state === 'duel') {a.state = 'hunt'; a.target = null}};
      const stepUntil = (f, gameMin) => {const end = S.gameMin + gameMin; while (S.gameMin < end) {calm(); sim.step(1 / 20); if (f()) return true} return false};
      // The spot must not depend on how far the background world got in real time before the section (the runners and the
      // 8x ticker above run on the clock): a field spot well outside every town (autopilot only acts in the field), an empty
      // pack (a full one walks home), no party, adventure or open turn. The Table, DM and crypt states are cleared too.
      const inTownish = p => CITY.some(c => p.x >= c.x0 - 6 && p.x <= c.x1 + 7 && p.y >= c.y0 - 6 && p.y <= c.y1 + 7);
      // The region must fit the hero (#690): autopilot "moves on" from one whose lowest level is more than TP.FIT_UP (1) above the
      // hero's (player.js `fits`), so the spot is a hunter's in a fitting region, else a field point of the first fitting region.
      const {REGIONS, ZPTS, zoneAt: zoneOf} = await import('../src/world/map.js');
      const fitsHero = p => {const b = REGIONS[zoneOf(p.x, p.y)]; return !!(b && b.band && b.band[0] <= a.lvl + 1)};
      let out = S.agents.find(x => x !== a && x.state === 'hunt' && !x.player && x.kind === 'hero' && !inTownish(x) && fitsHero(x));
      if (!out) {const z = REGIONS.findIndex((R, i) => R.band && R.band[0] <= a.lvl + 1 && ZPTS[i].some(p => !inTownish(p))); if (z >= 0) out = ZPTS[z].filter(p => !inTownish(p))[0]}
      if (!out) throw new Error('autopilot fixture: no field spot in a region that fits the hero');
      a.adv = null; a.playTurn = null; a.cryptOk = false; a.raidOk = false; invOf(a).list.length = 0;
      const seenNow = () => `state=${a.state} at ${a.x.toFixed(1)},${a.y.toFixed(1)} town=${inTownish(a)} hp=${Math.round(a.hp)}/${maxHpOf(a)} idle=${a.playIdle} auto=${a.playAuto} doing="${a.playDoing}" pq=${JSON.stringify((a.pq || []).map(c => c.kind + (c.auto ? '/' + c.auto : '')))} sinceAct=${Math.round(S.gameMin - a.playActAt)} turn=${a.playTurn} party=${!!a.party} adv=${a.adv} pack=${invOf(a).list.length}`;
      a.x = out.x; a.y = out.y; a.state = 'hunt'; a.pq = []; a.target = null; a.dest = null; a.playOrder = {kind: 'hunt', n: 2, flee: .15};
      // hurt, but not so badly that autopilot walks home (#487: below the retreat line it does, and with a creature close by
      // too): between the hero's retreat line and 60%, with the creatures near this spot out of sight for the section
      const {tm} = await import('../src/data/traits.js'), {PK} = await import('../src/sim/player.js');
      a.hp = Math.max(1, Math.round(maxHpOf(a) * (Math.max(PK.RETREAT * tm(a, 'retreat'), .3) + .6) / 2));
      const veiled = S.mobs.filter(m => !m.hidden && dist(m, a) < PK.REST_CLEAR + 3); for (const m of veiled) m.hidden = true;
      // its last order nearly two game hours ago (a hurt hero heals while it stands, so the long wait is not stepped through)
      a.playActAt = S.gameMin - 115; a.playIdle = false; a.playAuto = null;
      pin = {x: a.x, y: a.y, hp: a.hp};
      const t0 = S.gameMin, idle = stepUntil(() => a.playIdle && a.playAuto === 'rest', 60);
      ok(idle && S.gameMin - a.playActAt >= 120 && S.gameMin - t0 >= 4, `with no order for 2 game hours autopilot carries on (${a.playAuto}, after ${Math.round(S.gameMin - t0)} game min; ${seenNow()})`);
      ok(a.player && !a.brain && /^autopilot: resting/.test(a.playDoing || ''), `the agent stays the mind (agent-played, no brain): "${a.playDoing}" ${seenNow()}`);
      pin = null; a.hp = maxHpOf(a); a.pq = [];
      ok(stepUntil(() => a.playAuto === 'hunt' && a.pq[0] && a.pq[0].kind === 'hunt' && a.pq[0].auto, 60), `mended, it carries on its last order (${a.playAuto}: ${a.playDoing}; ${seenNow()})`);
      for (const m of veiled) m.hidden = false;
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
    ok(mine.filter(b => !(b.format && b.format.properties && b.format.properties.ready)).every(b => b.options.temperature === 0.6 && b.options.repeat_penalty === 1.15), 'local turns sample at temperature 0.6 with a repeat penalty');
    ok(/fresh context/.test(R.out) && mine.some(b => b.messages.filter(m => m.role === 'assistant').length === 0 && /^Turn 3/.test((b.messages[1] || {}).content || '')), 'after two empty turns the next one starts from a fresh context');
    const sz = sim.playerAct(a.id, 'say', {text: '我将带领团队去见萨满'});
    ok(!sz.ok && /speak in English/.test(sz.error), 'the game refuses a foreign-script line: ' + sz.error);
    sim.markPlayer(a, false)}

  // I. a New World reuses the hero's id for another hero (issue #219): the runner notices, releases its claim and
  // exits with code 75 (the supervisor starts it again); the next run sets the old session aside and takes a turn
  {const a = pick(), oldName = a.name;
    const R = runner(a, 'mock-tools:1b', ['--heartbeat', '1440', '--min-gap', '0', '--new']);
    ok(await until(() => R.turns.length >= 1 && existsSync(join(tmp, 'agents', a.id + '.json')), 30000), 'a runner plays and keeps its session for the hero'); // the turn line prints before the session file is written: wait for both
    a.name = 'Newcomer'; // the same id, another hero
    const code = await Promise.race([R.done, sleep(15000).then(() => 'timeout')]);
    ok(code === 75 && /\[world\] a new world: #\d+ was .*, now Newcomer/.test(R.out), `a runner whose hero was renamed under its id exits for the supervisor (code ${code})`);
    ok(!(await health(PB)).heroes.find(h => h.id === a.id).claimed, 'and has released its claim');
    const R2 = runner(a, 'mock-tools:1b', ['--heartbeat', '1440', '--min-gap', '0', '--max-turns', '1']);
    ok(await until(() => R2.turns.length >= 1, 30000) && await Promise.race([R2.done, sleep(15000).then(() => 'timeout')]) === 0, 'the restarted runner takes a turn for the new hero');
    const oldDir = join(tmp, 'agents', 'old'), moved = existsSync(oldDir) ? readdirSync(oldDir).filter(f => f.startsWith(a.id + '-' + oldName.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) + '-')) : [];
    ok(moved.length >= 1 && JSON.parse(readFileSync(join(tmp, 'agents', a.id + '.json'), 'utf8')).heroName === 'Newcomer', 'the old session is in logs/agents/old/ and the new one is for the new name');
    a.name = oldName; sim.markPlayer(a, false)}

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
    const fo = SLT.foundSlots(SLT.autoPick(0), {fac: 0, ai: false}); SLT.setSlotMinds(SLT.slotted(), 'agent'); S.brainOn = false;
    ok(fo.ok && SLT.slotted() && SLT.slotted().ids.length === 5, 'a Fellowship of five, Minds: agents' + (fo.ok ? '' : ': ' + fo.error));
    const mem = SLT.slotted().ids.map(id => S.agents.find(x => x.id === id));
    // This world is unseeded and has been running: a member can be downed here, and a downed hero has no options and sits out an everyone-at-once scene (#654).
    const standUp = () => {for (const a of mem) if (a.state === 'downed') {delete a.down; a.state = 'town'; a.hp = sim.maxHp(a)}};
    standUp();
    // the game side first: no waiting out your own turn
    {{const L = mem.find(a => a.state !== 'dead'); for (const a of mem) if (a.state !== 'dead' && a !== L) {a.x = L.x + .5; a.y = L.y}} // together: an everyone-at-once scene takes those within shouting range (#182)
      const sc0 = openScene('check', 'A test of patience', ['The DM calls for a roll.'], {anchor: mem.find(a => a.state !== 'dead').id}); sc0.phase = 'turn'; sc0.i = 0; delete sc0.wk; // the scene set and its members woken (#682)
      const first = S.agents.find(x => x.id === sc0.ids[0]), second = S.agents.find(x => x.id === sc0.ids[1]);
      const w1 = sim.playerAct(first.id, 'wait', {minutes: 10}), w2 = sim.playerAct(second.id, 'wait', {minutes: 10});
      ok(!w1.ok && /^It is your turn at the table: call scene_act with one of: (aid, )?steady, press(, attempt)?.( Since your last look|$)/.test(w1.error), 'wait on your own scene turn is refused: ' + (w1.error || 'allowed'));
      ok(!w2.ok && /^It is your turn at the table/.test(w2.error), 'a check is answered by everyone at once: every member who has not answered is on turn');
      ok(sim.playerAct(second.id, 'scene_act', {option: 'press'}).ok && sim.playerAct(second.id, 'wait', {minutes: 10}).ok, 'once a member has answered, it may wait for the others');
      S.table = null;
      // a combat scene: the brief's scene keys (the forced turn's enum) carry the member's ready class abilities by id
      const {paceBrief} = await import('../src/sim/pace.js'), {movesOf} = await import('../src/sim/moves.js');
      const foe = S.mobs.find(m => m.alive && !m.gone && !m.elite), hunter = mem.find(a => movesOf(a).length) || mem[0];
      hunter.mcr = {}; // every ability ready this round (a world-dependent cooldown made this flaky)
      const sc1 = openScene('rescue', 'A test fight', ['A beast lunges.'], {hero: hunter.id, mob: foe.id});
      sc1.phase = 'turn'; delete sc1.wk; // the scene set and its members woken (#682)
      const bk = paceBrief(hunter.id).brief.scene;
      ok(bk && bk.keys.includes('strike') && movesOf(hunter).some(id => bk.keys.includes(id)), `the forced turn's enum includes ready abilities by id (${hunter.cls}: ${bk && bk.keys.join(', ')})`);
      sc1.phase = 'turn'; sc1.i = 0; {const later = S.agents.find(x => x.id === sc1.ids[1]), w3 = sim.playerAct(later.id, 'wait', {minutes: 10});
        ok(w3.ok && w3.pending, 'in a fight (turns in order) a member whose turn is still to come may wait for it')}
      S.table = null
      // the hall board in the brief (issue #326): a member in town sees the hall's jobs for the Fellowship, never who posted them
      {const {memoryNote} = await import('./pacing.mjs'), {homeOf} = await import('../src/data/races.js'), ADV = await import('../src/data/adventures.js');
        const m = mem.find(a => a.state !== 'dead' && homeOf(a).name === SLT.slotted().hall), keep = S.adventures, st = m.state, other = S.agents.find(x => !SLT.inSlots(x) && x.state !== 'dead');
        const tpl = Object.keys(ADV.ADVENTURES)[0], mk = (id, o) => ({id, tpl, phase: 'open', town: SLT.slotted().hall, until: S.gameMin + 600, born: S.gameMin, ...o});
        S.adventures = [mk(99901, {ff: 1, by: 'dm-agent', title: 'Hall test job', giver: {name: 'Test Warden'}}), mk(99902, {for: other.id, title: 'Not theirs'})]; m.state = 'town';
        const hb = paceBrief(m.id).brief, line = memoryNote(hb);
        ok(hb.hall && hb.hall.length === 1 && hb.hall[0].id === 'job:99901' && hb.hall[0].giver === 'Test Warden' && /Posted at your hall for the Fellowship: job:99901 "Hall test job" from Test Warden/.test(line) && !/DM|scripted/.test(JSON.stringify(hb.hall) + line),
          'a member in town sees the hall job for the Fellowship (id, title, giver, reward), not who posted it nor another hero\'s job: ' + line.trim());
        S.adventures = [mk(99902, {for: other.id, title: 'Not theirs'})]; const nb = paceBrief(m.id).brief;
        ok(!('hall' in nb) && !/Posted at your hall/.test(memoryNote(nb)), 'with no Fellowship job posted the brief carries no hall block');
        S.adventures = keep; m.state = st}}
    TABLE.speed = 1; speed = 1; last = Date.now();
    const tick1 = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; const n = Math.ceil(real / (1 / 60)); for (let i = 0; i < n; i++) sim.step(real / n)}, 50);
    const p = spawn(process.execPath, ['scripts/fellowship.mjs', '--url', PB, '--provider', 'ollama', '--model', 'mock-fumble:1b', '--min-gap', '0', '--heartbeat', '1440', '--ollama-url', OLLAMA], {cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']});
    kids.push(p); let fout = ''; p.stdout.on('data', d => fout += d); p.stderr.on('data', d => fout += d);
    const claimed = await (async () => {for (let i = 0; i < 200; i++) {const h = await health(PB).catch(() => null); if (h && h.heroes.filter(x => x.fellow && x.claimed).length === 5) return true; await sleep(100)} return false})();
    ok(claimed, 'the Fellowship runner claims all five (mock-fumble:1b)' + (claimed ? '' : '\n' + fout.slice(-1500)));
    await until(() => !S.table, 30000);
    standUp();
    {const L = mem.find(a => a.state !== 'dead'); for (const a of mem) if (a.state !== 'dead' && a !== L) {a.x = L.x + .5; a.y = L.y}} // together: an everyone-at-once scene takes those within shouting range (#182)
    const f0 = seen.fumble || 0, t0 = Date.now(), sc = openScene('check', 'A test of nerve', ['The DM calls for a roll at the ford.'], {anchor: mem.find(a => a.state !== 'dead').id});
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
      var {TABLE: TBL} = await import('../src/sim/table.js'), tableMode = TBL.mode; TBL.mode = 'off'; // no scene may open mid-section: it would hold the runners' turns
      var gather = () => {const L = mem.find(a => a.state !== 'dead'); let i = 0; for (const a of mem) if (a.state !== 'dead') {a.state = 'town'; a.hidden = false; a.target = null; a.pq = []; a.dest = null; a.hp = Math.max(a.hp, a.maxhp || 0); a.x = L.x + (i++ % 3 ? 1 : 0); a.y = L.y}}; // together and in town (nothing attacks, nobody wanders off): party talk only carries a shout's range (#182)
      gather();
      for (const a of mem) {delete a.talkSaid; delete a.talkHeard} // strangers again: the earlier sections let some members meet, which refused their first introduction (flaky)
      const tick8 = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; const dt = real * 8, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) {sim.step(dt / n); gather()}}, 50);
      const q = spawn(process.execPath, ['scripts/fellowship.mjs', '--url', PB, '--provider', 'ollama', '--model', 'mock-intro:1b', '--max-turns', '2', '--min-gap', '0', '--heartbeat', '30', '--ollama-url', OLLAMA], {cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']});
      kids.push(q); let qo = ''; q.stdout.on('data', d => qo += d); q.stderr.on('data', d => qo += d);
      const code = await Promise.race([new Promise(r => q.on('close', r)), sleep(120000).then(() => 'timeout')]);
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
      ok(live.slice(1).every(b => mt.includes(b.name)), `meeting is recorded in game once both have spoken in each other's hearing (${live[0].name} met ${mt.join(', ')}; live ${live.map(b => b.name).join(', ')})`);
    }

    // H. reflection moments (issue #179): live, 130 agent turns wrote 0 memories. A lazy model (mock-lazy, which never
    // calls remember on its own) is given a camp reflection: one forced structured answer, its notes land in the notebook
    // (stamped as a reflection), the moment is closed at the game, and the Markdown mirror folder appears.
    {const RF = await import('../src/sim/reflect.js'), NBm = await import('../src/sim/notebook.js'), {memoryMirror} = await import('./memory-mirror.mjs'), {readdirSync} = await import('node:fs');
      const a = mem.find(x => x.state !== 'dead' && x.player); park(a); a.hp = a.maxhp || a.hp; gather(); S.table = null; // G's Table switch stays off until the end of H
      RF.REFLECT.PER_DAY = PER_DAY; delete a.reflect; // a fresh state: no moment left over from the scenes of F
      // reflectView counts reflections of the current game day: a run that crosses midnight reads 'today 0'. The earlier sections advance the clock by real time, so start well clear of it (the world runs about 30 game minutes here).
      if (S.gameMin % 1440 > 1440 - 240) S.gameMin = Math.ceil(S.gameMin / 1440) * 1440 + 360;
      const n0 = a.memories ? a.memories.notes.length : 0, r0 = seen.reflect || 0;
      RF.moment(a, 'camp', 'Test Hollow');
      const due = RF.reflectDue(a);
      ok(due && due.kind === 'camp' && /making camp: Test Hollow/.test(due.why), 'making camp raises a reflection moment for the member: ' + (due && due.why));
      last = Date.now(); const tickR = setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now; const dt = real * 8, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) {sim.step(dt / n); gather()}}, 50);
      const R = runner(a, 'mock-lazy:1b', ['--max-turns', '2', '--min-gap', '0', '--heartbeat', '30', '--reflect']);
      const code = await Promise.race([R.done, sleep(60000).then(() => 'timeout')]); clearInterval(tickR);
      const fresh = (a.memories ? a.memories.notes : []).slice(n0), rf = fresh.filter(x => x.rf === 'camp');
      ok(code === 0 && (seen.reflect || 0) > r0, 'the runner asked the lazy model for one structured reflection' + (code === 0 ? '' : ' (' + code + ')\n' + R.out.slice(-2000)));
      ok(rf.length === 2 && rf.some(x => /Reflection: making camp: Test Hollow/.test(x.title)) && rf.some(x => x.tags.includes('lesson')), `its notes landed in the notebook, marked as written at the camp reflection (${fresh.map(x => x.title + (x.rf ? ' [' + x.rf + ']' : '')).join('; ')})`);
      ok(/\[reflection: making camp: Test Hollow\]/.test(R.out) && /reflection \(2 memories\)/.test(R.out) && /> remember\(/.test(R.out), 'the turn line says reflection (2 memories) and the remember calls show');
      const v = RF.reflectView(a);
      ok(v && v.today === 1 && v.last && v.last.wrote === 2 && !(v.due && v.due.kind === 'camp'), `the moment is closed at the game (today ${v && v.today}, last wrote ${v && v.last && v.last.wrote})`);
      ok((a.playNarr || []).some(n => /Reflects \(camp\) and keeps 2 memories/.test(n.text)), 'the Agent tab shows the reflection');
      const mroot = join(tmp, 'mirror'), mir = memoryMirror({root: mroot, world: 'localcheck', log: () => {}}); mir.write(NBm.mirrorDirty(new Map()));
      const find = d => existsSync(d) ? readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? find(join(d, e.name)) : [join(d, e.name)]) : [];
      const files = find(mroot).filter(f => /[\\/]memory[\\/]/.test(f) && f.includes(String(a.id) + '-'));
      ok(files.some(f => /reflection-making-camp/.test(f)), `the mirror folder appears with the notes (${files.length} files)`);
      TBL.mode = tableMode;
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

// ---------------------------------------------------------------- the start gate (issue #222): play-headless --wait-ready
console.log('start gate: --wait-ready holds the world until every mind answered a warm-up');
{
  ok(!/world held/.test(world.out()), 'without --wait-ready play-headless never holds the world (unchanged)');
  const P2 = port + 650, B2 = `http://127.0.0.1:${P2}`, poll = async (f, ms = 30000) => {const t0 = Date.now(); while (Date.now() - t0 < ms) {const h = await health(B2).catch(() => null); if (h && f(h)) return h; await sleep(100)} return null};
  // --wait-ready opens the DM seat and counts it (the DM is always an agent, #559)
  {const P3 = port + 651, w3 = start(['scripts/play-headless.mjs', '--port', String(P3), '--agents', '1', '--quiet', '--wait-ready', '--world', join(tmp, 'world-ready-dm.json')], {wait: /^\[play\] headless world at /m});
   await w3.until; const h3 = await health(`http://127.0.0.1:${P3}`).catch(() => null), t3 = Date.now(); while (!/world held, waiting for minds: .*DM: no runner/.test(w3.out()) && Date.now() - t3 < 5000) await sleep(100);
   ok(h3 && h3.dm && h3.dm.seat === true && /DM: no runner/.test(w3.out()), '--wait-ready opens the DM seat and holds the world for its runner too (#559)'); try {w3.p.kill()} catch {}}
  // the rest tests hero runners alone: --no-dm keeps the hold to the heroes
  const w2 = start(['scripts/play-headless.mjs', '--port', String(P2), '--agents', '2', '--quiet', '--speed', '8', '--wait-ready', '--no-dm', '--world', join(tmp, 'world-ready.json')], {wait: /^\[play\] headless world at /m});
  await w2.until;
  const [ga, gb] = (await health(B2)).heroes, by = (h, id) => h.heroes.find(x => x.id === id) || {};
  ok(await poll(() => /world held, waiting for minds: .*no runner/.test(w2.out()), 5000), 'with --wait-ready a world with no runners is held');
  const ra = start(['scripts/agent-player.mjs', '--url', B2, '--hero', String(ga.id), '--provider', 'ollama', '--model', 'mock-slow:1b', '--ollama-url', OLLAMA]);
  const warming = await poll(h => by(h, ga.id).ready === 'warming', 20000);
  ok(warming && by(warming, ga.id).warm.model === 'mock-slow:1b', '/play/health shows the slow seat warming up with its model');
  const t0 = Date.now(), readyA = await poll(h => by(h, ga.id).ready === 'ready', 20000);
  ok(readyA && Date.now() - t0 > 1000 && by(readyA, ga.id).warm.ms >= 2000, `it turns ready only when the slow warm-up answers (${readyA && by(readyA, ga.id).warm.ms} ms)`);
  ok(!/every mind is ready/.test(w2.out()) && /no runner/.test(w2.out().split('waiting for minds:').pop()), 'the world stays held: the other seat has no runner');
  const rb = start(['scripts/agent-player.mjs', '--url', B2, '--hero', String(gb.id), '--provider', 'ollama', '--model', 'mock-down:1b', '--ollama-url', OLLAMA]);
  const failed = await poll(h => by(h, gb.id).ready === 'failed' || !!(by(h, gb.id).warm && by(h, gb.id).warm.warmFailed), 20000); // a turn played after the failure turns it ready (#559), keeping warmFailed
  // the gate prints its held line on a 50 ms tick and the child's pipe may lag on a slow runner: wait for the line, bounded
  const heldLine = true; // #559: a failed warm-up with its runner there no longer holds the world, so no held line names it
  if (!(failed && heldLine)) console.log('  (debug) warm state:', JSON.stringify(failed && by(failed, gb.id).warm), 'out tail:', w2.out().slice(-400));
  ok(failed && /unexpectedly stopped/.test((by(failed, gb.id).warm.error || by(failed, gb.id).warm.warmFailed || '')) && heldLine, 'a crashed warm-up is reported (failed, with the error) on /play/health');
  // owner decision on #559: a seat whose warm-up failed but whose runner plays on counts as active, so the world runs
  const runs = () => (w2.out().match(/every mind is ready: the world runs/g) || []).length;
  ok(await poll(() => runs() >= 1, 15000), 'a failed warm-up whose runner is still there counts as active: the world runs');
  // continuous (#559): the runner goes away -> held at once; a new runner -> runs again
  rb.p.kill(); await poll(h => !by(h, gb.id).claimed, 60000);
  ok(await poll(() => /world held, waiting for minds: .*no runner/.test(w2.out().split('every mind is ready').pop()), 15000), 'its runner gone: the world is held again (the gate is continuous)');
  const rb2 = start(['scripts/agent-player.mjs', '--url', B2, '--hero', String(gb.id), '--provider', 'ollama', '--model', 'mock-tools:1b', '--ollama-url', OLLAMA]);
  const lastGate = () => w2.out().split(String.fromCharCode(10)).filter(l => /world held|every mind is ready/.test(l)).pop() || '', again = await poll(() => runs() >= 2 || (/world held/.test(lastGate()) && !lastGate().includes(gb.name + ':')), 60000); // the slow mock seat may stop by itself once the world runs (5 empty turns): only this seat is asked if (!again) console.log('  (debug) world tail:', w2.out().slice(-700), ' | ra tail:', ra.out().slice(-500));
  ok(again, 'a new runner answered its warm-up: its seat no longer holds the world');
  for (const k of [ra, rb2, w2]) try {k.p.kill()} catch {}
}
// issue #221: every request the runners sent (agent loop, closing calls, forced scene, reflection) asked one num_ctx
{
  const runs = seen.slice(ctxFrom), sizes = [...new Set(runs.map(b => b.options && b.options.num_ctx))];
  const kinds = {loop: runs.filter(b => b.tools).length, words: runs.filter(b => !b.tools && !b.format).length, scene: runs.filter(b => b.format && b.format.properties && b.format.properties.option).length, reflect: runs.filter(b => b.format && b.format.properties && b.format.properties.notes).length};
  ok(runs.length > 20 && sizes.length === 1 && sizes[0] === numCtxFrom(), `every mock Ollama request of the runners carries the same num_ctx (${sizes.join(', ')}) over ${runs.length} requests: ${JSON.stringify(kinds)}`);
  ok(kinds.loop && kinds.words && kinds.scene && kinds.reflect, 'the agent loop, the closing call, a forced scene answer and a reflection were all among them');
}
for (const k of kids) try {k.kill()} catch {}
closeOllama();
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fail ? `\nlocalcheck: ${fail} FAILED` : '\nlocalcheck: all ok');
process.exit(fail ? 1 : 0);
