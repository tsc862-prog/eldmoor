// The local agent loop (Mixed minds, issue #97 part 2): plays one hero's turn with a local model
// (Ollama) through the same game tools the Claude Agent SDK runner uses (src/data/player-tools.js,
// called via POST /play/call). scripts/agent-player.mjs and scripts/fellowship.mjs use it for heroes
// whose runner provider is 'ollama'; the Anthropic path does not touch this file.
//
// One turn = a small tool-calling loop: send the conversation with the tools to /api/chat, run the
// tool calls the model makes (validated against the tool table first; a bad call goes back to the
// model as an error, never to the game), feed the results back, and stop when the model answers in
// plain text (its narration) or after toolTurns model calls.
// Models without tool support (Ollama answers "does not support tools") switch to a JSON-action
// mode: the tool list goes into the prompt and every reply is forced (Ollama `format` = a JSON
// schema) into {tool, args, narration}; tool "end" closes the turn. The mode is kept per hero.
// A model that writes its call as text (<tool_call>{...}</tool_call> or bare {"name","arguments"})
// is understood too.
//
// History: the hero's conversation lives compactly in its session file (sess.local.history, no
// system prompt, tool results cut to keptChars); when it grows past historyChars the oldest whole
// turns are dropped (the journal is the long-term memory). Local calls cost nothing: the loop
// counts tokens (prompt_eval_count / eval_count) and seconds instead.
// Plain Node, no SDK import; scripts/localcheck.mjs tests it against a mock Ollama.
import {PLAYER_TOOLS} from '../src/data/player-tools.js';

export const LOCAL_DEFAULTS = {historyChars: 24000, resultChars: 1800, keptChars: 400, maxTokens: 700, numCtx: 16384, callsPerReply: 3, endOnWait: true};
export const LOCAL_RULES = '\n\nHow your turns work here: call one tool at a time and read its result before the next. When you have given your command and waited, end the turn by replying with one short sentence of narration in plain text (no tool call).';

const BY_NAME = new Map(PLAYER_TOOLS.map(t => [t.name, t]));
// Another tool table (the DM's, src/data/dm-tools.js, issue #66) can be passed as `list` / `tools`.
const MAPS = new WeakMap(); const byName = list => {if (!list || list === PLAYER_TOOLS) return BY_NAME; let m = MAPS.get(list); if (!m) {m = new Map(list.map(t => [t.name, t])); MAPS.set(list, m)} return m};
const jsonType = a => a.type === 'integer' ? 'integer' : a.type === 'number' ? 'number' : a.type === 'object' ? 'object' : 'string';

// The tool table as Ollama function tools.
export function ollamaTools(list = PLAYER_TOOLS) {
  return list.map(t => ({type: 'function', function: {name: t.name, description: t.desc, parameters: {type: 'object',
    properties: Object.fromEntries(Object.entries(t.args || {}).map(([k, a]) => [k, {type: jsonType(a), description: a.desc || k, ...(a.enum ? {enum: a.enum} : {})}])),
    required: Object.entries(t.args || {}).filter(([, a]) => !a.optional).map(([k]) => k)}}}));
}

// A model's arguments checked against the tool table: {args} or {error}. Numbers given as strings are
// coerced, unknown keys dropped, enums and required arguments enforced. The game validates again.
export function cleanArgs(name, raw, list = PLAYER_TOOLS) {
  const M = byName(list), t = M.get(name); if (!t) return {error: `unknown tool "${name}". Tools: ${[...M.keys()].join(', ')}`};
  let a = raw; if (typeof a === 'string') {try {a = a.trim() ? JSON.parse(a) : {}} catch {return {error: 'arguments are not valid JSON'}}}
  if (a == null) a = {}; if (typeof a !== 'object' || Array.isArray(a)) return {error: 'arguments must be an object'};
  const out = {};
  for (const [k, spec] of Object.entries(t.args || {})) {
    let v = a[k];
    if (v == null || v === '') {if (!spec.optional) return {error: `${name} needs "${k}" (${spec.desc || k})`}; continue}
    if (spec.type === 'object') {if (typeof v === 'string') {try {v = JSON.parse(v)} catch {return {error: `"${k}" must be a JSON object`}} } if (!v || typeof v !== 'object' || Array.isArray(v)) return {error: `"${k}" must be an object`}}
    else if (spec.type === 'integer' || spec.type === 'number') {const n = Number(v); if (!Number.isFinite(n)) return {error: `"${k}" must be a number`}; v = spec.type === 'integer' ? Math.round(n) : n}
    else v = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (spec.enum && !spec.enum.includes(v)) return {error: `"${k}" must be one of ${spec.enum.join(', ')}`};
    out[k] = v;
  }
  return {args: out};
}

// The JSON-action fallback: the tool list as text, and the schema each reply must follow.
export function actionCatalogue(list = PLAYER_TOOLS) {
  return list.map(t => `- ${t.name}(${Object.entries(t.args || {}).map(([k, a]) => k + (a.optional ? '?' : '') + ': ' + (a.enum ? a.enum.join('|') : a.type)).join(', ')}): ${t.desc}`).join('\n');
}
export const actionSchema = (list = PLAYER_TOOLS) => ({type: 'object', properties: {
  tool: {type: 'string', enum: [...list.map(t => t.name), 'end']}, args: {type: 'object'}, narration: {type: 'string'}}, required: ['tool', 'args', 'narration']});
export const JSON_RULES = 'You cannot call tools directly. Answer every message with ONE JSON object: {"tool": a tool name, "args": {its arguments}, "narration": ""}. The result comes back in the next message. To end your turn answer {"tool": "end", "args": {}, "narration": "one sentence of what you did and why"}.\n\nTools:\n';

// A tool call written as text: <tool_call>{"name":..,"arguments":..}</tool_call>, or the bare object.
export function parseTextCall(content, list = PLAYER_TOOLS) {
  const BY_NAME = byName(list);
  const s = String(content || '').trim(); if (!s) return null;
  const m = s.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/) || (s.startsWith('{') ? [null, s] : null);
  if (!m) return null;
  try {const j = JSON.parse(m[1]); const name = j.name || (j.function && j.function.name); if (typeof name !== 'string' || !(BY_NAME.has(name) || 'arguments' in j || 'parameters' in j)) return null; // an unknown name with arguments is still a call (it is rejected with the tool list)
    return {function: {name, arguments: j.arguments ?? j.parameters ?? (j.function && j.function.arguments) ?? {}}}} catch {return null}
}

const strip = m => {const o = {role: m.role, content: m.content || ''}; if (m.tool_calls) o.tool_calls = m.tool_calls; if (m.tool_name) o.tool_name = m.tool_name; return o};
const cut = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
// Drop the oldest whole turns (a turn starts at a message marked turn:1) until the history fits.
export function trimHistory(h, budget) {
  let dropped = 0;
  while (h.length && JSON.stringify(h).length > budget) {
    const next = h.findIndex((m, i) => i > 0 && m.turn);
    if (next < 0) break; // keep at least the latest turn
    h.splice(0, next); dropped++;
  }
  return dropped;
}

// One turn. chat: the adapter's chat(); call(tool, args) -> game result; sess: the hero's session
// (sess.system, sess.local); on(kind, ...): 'text' narration, 'tool' (name, args), 'result' (text),
// 'mode' (new mode). Returns {tools, modelCalls, in, out, modelMs, ms, narration, dead, capped, rejected, mode}.
// tools: the tool table (default the hero's; the DM runner passes DM_TOOLS); rules: the line appended to the system prompt.
export async function localTurn({chat, call, sess, prompt, model, toolTurns = 12, on = () => {}, opts = {}, tools: list = PLAYER_TOOLS, rules = LOCAL_RULES}) {
  const o = {...LOCAL_DEFAULTS, ...opts};
  const L = sess.local = sess.local || {mode: 'tools', history: [], tokensIn: 0, tokensOut: 0, seconds: 0, dropped: 0};
  const t0 = Date.now(), stat = {tools: 0, modelCalls: 0, in: 0, out: 0, modelMs: 0, narration: '', dead: false, capped: false, rejected: 0, mode: L.mode};
  const turnMsgs = [{role: 'user', content: prompt, turn: 1}];
  const sys = () => sess.system + (L.mode === 'json' ? '\n\n' + JSON_RULES + actionCatalogue(list) : rules);
  const tools = ollamaTools(list);
  const exec = async (name, rawArgs) => {
    const c = cleanArgs(name, rawArgs, list); stat.tools++;
    on('tool', name, c.args || rawArgs);
    let r; if (c.error) {stat.rejected++; r = {ok: false, error: 'Not done: ' + c.error}} else {try {r = await call(name, c.args)} catch (e) {r = {ok: false, error: String(e.message || e)}}}
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    on('result', text);
    if (/"dead":true/.test(text)) stat.dead = true;
    return text;
  };
  for (let i = 0; i < toolTurns && !stat.dead; i++) {
    const messages = [{role: 'system', content: sys()}, ...L.history.map(strip), ...turnMsgs.map(strip)];
    let res;
    try {res = await chat({model, messages, ...(L.mode === 'json' ? {format: actionSchema(list)} : {tools}), maxTokens: o.maxTokens, numCtx: o.numCtx})}
    catch (e) {if (e.noTools && L.mode !== 'json') {L.mode = stat.mode = 'json'; on('mode', 'json'); i--; continue} throw e}
    stat.modelCalls++; stat.in += res.usage.in; stat.out += res.usage.out; stat.modelMs += res.ms;
    const msg = res.message || {}, content = String(msg.content || '');
    if (L.mode === 'json') {
      let j = null; try {j = JSON.parse(content)} catch {}
      turnMsgs.push({role: 'assistant', content});
      if (!j || typeof j.tool !== 'string') {stat.rejected++; turnMsgs.push({role: 'user', content: 'That was not one JSON object with "tool", "args" and "narration". Try again.'}); continue}
      if (j.narration && String(j.narration).trim() && j.tool !== 'end') on('text', String(j.narration).trim());
      if (j.tool === 'end' || !j.tool) {stat.narration = String(j.narration || '').trim(); break}
      const text = await exec(j.tool, j.args);
      turnMsgs.push({role: 'user', content: `Result of ${j.tool}: ${cut(text, o.resultChars)}`});
      continue;
    }
    let calls = Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls : null;
    if (!calls) {const tc = parseTextCall(content, list); if (tc) calls = [tc]}
    if (!calls) {stat.narration = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); turnMsgs.push({role: 'assistant', content: stat.narration}); break}
    calls = calls.slice(0, o.callsPerReply);
    turnMsgs.push({role: 'assistant', content: msg.tool_calls ? content : '', tool_calls: calls.map(c => ({function: {name: c.function && c.function.name, arguments: c.function && c.function.arguments || {}}}))});
    if (content.trim() && msg.tool_calls) on('text', content.trim());
    for (const c of calls) {
      const name = String(c.function && c.function.name || '');
      const text = await exec(name, c.function && c.function.arguments);
      turnMsgs.push({role: 'tool', tool_name: name, content: cut(text, o.resultChars)});
      if (stat.dead) break;
    }
    // Small models rarely stop on their own: once the command has played out (a wait returned), the
    // turn ends with one call without tools, which can only answer in words (the narration).
    if (o.endOnWait && !stat.dead && calls.some(c => c.function && c.function.name === 'wait') && /"ok":true/.test(turnMsgs[turnMsgs.length - 1].content)) {
      turnMsgs.push({role: 'user', content: 'The wait is over. End your turn now: one short sentence of narration in the third person about what you did and why.'});
      const fin = await chat({model, messages: [{role: 'system', content: sys()}, ...L.history.map(strip), ...turnMsgs.map(strip)], maxTokens: o.maxTokens, numCtx: o.numCtx});
      stat.modelCalls++; stat.in += fin.usage.in; stat.out += fin.usage.out; stat.modelMs += fin.ms;
      stat.narration = String(fin.message && fin.message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      turnMsgs.push({role: 'assistant', content: stat.narration}); break;
    }
    if (i === toolTurns - 1) stat.capped = true;
  }
  if (stat.narration) on('text', stat.narration);
  // keep the turn compactly: long tool results and musings shortened, then the oldest turns dropped to fit
  for (const m of turnMsgs) if ((m.role === 'tool' || (L.mode === 'json' && m.role === 'user' && !m.turn)) && m.content.length > o.keptChars) m.content = cut(m.content, o.keptChars);
    else if (m.role === 'assistant' && L.mode !== 'json' && m.content.length > o.keptChars * 2) m.content = cut(m.content, o.keptChars * 2);
  L.history.push(...turnMsgs);
  L.dropped += trimHistory(L.history, o.historyChars);
  L.tokensIn += stat.in; L.tokensOut += stat.out; L.seconds += (Date.now() - t0) / 1000;
  stat.ms = Date.now() - t0;
  return stat;
}

// The cost line for a local turn: tokens and seconds, cost 0.
export const localLine = (st, model) => `${model} (local) | ${st.tools} tool calls${st.rejected ? ' (' + st.rejected + ' rejected)' : ''}, ${(st.ms / 1000).toFixed(1)} s (${(st.modelMs / 1000).toFixed(1)} s in the model), ${st.modelCalls} model calls${st.mode === 'json' ? ', JSON-action mode' : ''} | tokens in ${st.in} / out ${st.out} | $0 (local)${st.capped ? ' | hit the model-call cap' : ''}`;
