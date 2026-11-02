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
// A model that writes its call as text (<tool_call>{...}</tool_call>, bare {"name","arguments"}, or
// name("a", "b") / name({...}) inside its narration, issue #163) is understood too, and the narration it
// shows is cleaned of written calls and made-up labels ("CallCheck ...").
// Table scenes (issue #163): a member's own open scene is not played through this loop but through
// sceneTurn(): one structured answer (an enum of that member's legal options + a line), then scene_act
// sent by the runner. scripts/fellowship.mjs and agent-player.mjs pick it from the pace brief's `scene`.
//
// History: the hero's conversation lives compactly in its session file (sess.local.history, no
// system prompt, tool results cut to keptChars); when it grows past historyChars the oldest whole
// turns are dropped (the journal is the long-term memory). Local calls cost nothing: the loop
// counts tokens (prompt_eval_count / eval_count) and seconds instead.
// Plain Node, no SDK import; scripts/localcheck.mjs tests it against a mock Ollama.
import {PLAYER_TOOLS} from '../src/data/player-tools.js';

// temperature/repeatPenalty (issue #126): a local model looping on one plan, or drifting into another language, is
// nudged out of it; freshAfter: that many empty turns in a row and the next turn starts with a fresh context.
export const LOCAL_DEFAULTS = {historyChars: 24000, resultChars: 1800, keptChars: 400, maxTokens: 700, numCtx: 16384, callsPerReply: 3, endOnWait: true, temperature: 0.6, repeatPenalty: 1.15, freshAfter: 2};
// A turn whose first answer is words without a tool call gets this once (issue #126: a small model narrated
// a long-over fight for 100 turns without acting).
export const REPROMPT = 'Act through a tool (look, status, move_to, hunt, rest, wait, ...). Words alone change nothing in the world; give one command now.';
// Two narrations this alike (shared words) count as a repeat; a repeat with no world-changing call is an empty turn.
export const REPEAT_SIM = 0.8;
export function similar(a, b) {
  const w = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(x => x.length > 2));
  const A = w(a), B = w(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.max(A.size, B.size);
}
export const REPROMPT_EN = 'Answer in English only, and act through a tool (look, status, move_to, hunt, rest, wait, ...).';
export {notEnglish} from '../src/sim/lang.js';
import {notEnglish} from '../src/sim/lang.js';
export const LOCAL_RULES = '\n\nHow your turns work here: call one tool at a time and read its result before the next. When you have given your command and waited, end the turn by replying with one short sentence of narration in plain text (no tool call). Write and speak only in English.';

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

// Calls written into the narration (issue #163: a 14B model wrote `(scene_act("strike", "I'll take care of this boar."))`
// as text, then called wait): <tool_call>{...}</tool_call>, a bare {"name","arguments"} reply, and name(...) for a
// known tool, where (...) is a JSON object, key=value pairs or positional literals mapped onto the tool's argument
// order. Only literals count: `scene_act(option, line)` (bare words, the model quoting the rules) is not a call.
// -> [{function: {name, arguments}, start, end}] in text order (start/end: the span to cut from the narration).
export function parseTextCalls(content, list = PLAYER_TOOLS) {
  const M = byName(list), s = String(content || ''), out = [];
  if (!/<tool_call>/.test(s)) {const one = parseTextCall(s, list); if (one) return [{...one, start: 0, end: s.length}]} // the whole reply is one call object
  for (const m of s.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {const c = parseTextCall(m[0], list); if (c) out.push({...c, start: m.index, end: m.index + m[0].length})}
  const names = [...M.keys()].filter(n => /^\w+$/.test(n)).sort((a, b) => b.length - a.length);
  const re = new RegExp('(?<![\\w.])(' + names.join('|') + ')\\s*\\(', 'g');
  for (const m of s.matchAll(re)) {
    const open = m.index + m[0].length - 1, close = matchParen(s, open); if (close < 0) continue;
    if (out.some(c => m.index >= c.start && m.index < c.end)) continue;
    const args = literalArgs(s.slice(open + 1, close), M.get(m[1])); if (!args) continue;
    let start = m.index, end = close + 1; // a call wrapped in its own parentheses or backticks goes with them
    while (start > 0 && end < s.length && ((s[start - 1] === '(' && s[end] === ')') || (s[start - 1] === '`' && s[end] === '`'))) {start--; end++}
    out.push({function: {name: m[1], arguments: args}, start, end});
  }
  return out.sort((a, b) => a.start - b.start);
}
function matchParen(s, i) {
  let depth = 0, q = null;
  for (let k = i; k < s.length; k++) {const c = s[k];
    if (q) {if (c === '\\') k++; else if (c === q) q = null; continue}
    if (c === '"') q = c; else if ('([{'.includes(c)) depth++; else if (')]}'.includes(c) && --depth === 0) return c === ')' ? k : -1}
  return -1;
}
// The inside of name(...) as arguments, or null when it is not made of literals.
function literalArgs(inner, tool) {
  const t = inner.trim(), keys = Object.keys(tool && tool.args || {});
  if (!t) return {};
  if (t.startsWith('{')) {try {const j = JSON.parse(t); return j && typeof j === 'object' && !Array.isArray(j) ? j : null} catch {return null}}
  const lit = /^\s*(?:([A-Za-z_]\w*)\s*[=:]\s*)?("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)\s*(?:,|$)/;
  const out = {}; let rest = t, pos = 0;
  while (rest.trim()) {
    // an unquoted id as the first value (live: `scene_act(deadeye, "I'll take this one down")`, an ability id) counts, unless
    // it is the argument's own name (`scene_act(option, line)` quotes the rules)
    const bare = pos === 0 ? rest.match(/^\s*([A-Za-z_][\w-]*)\s*(?:,|$)/) : null;
    if (bare && !['true', 'false', 'null'].includes(bare[1])) {if (bare[1] === keys[0] || !keys[0]) return null; out[keys[0]] = bare[1]; pos++; rest = rest.slice(bare[0].length); continue}
    const m = rest.match(lit); if (!m) return null;
    let v; try {v = m[2][0] === "'" ? m[2].slice(1, -1).replace(/\\'/g, "'") : JSON.parse(m[2])} catch {return null}
    const k = m[1] || keys[pos]; if (!k) return null; // more positional values than the tool has arguments
    out[k] = v; pos++; rest = rest.slice(m[0].length);
  }
  return out;
}
// Narration as the Agent tab shows it (issue #163): calls written as text, <think> blocks, separator lines and a
// leading made-up label ("CallCheck ...", "scene_act: ...", "Narration:") are cut; what remains is the hero's words.
const LABEL_PART = /(Call|Check|Tool|Action|Step|Plan|Narrat|Thought|Scene|Turn|Result|Output|Response|Answer|Note|Command)/;
const LABEL_COLON = /^(narration|narrate|action|thought|answer|response|output|note|result|call|check|plan|step|command|tool)$/i;
export function cleanNarration(text, list = PLAYER_TOOLS, calls = null) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const cs = calls || parseTextCalls(s, list);
  for (const c of [...cs].sort((a, b) => b.start - a.start)) s = s.slice(0, c.start) + s.slice(c.end);
  const tools = byName(list);
  s = s.split(/\r?\n/).map(l => {
    let x = l;
    const m = x.match(/^\s*\**\s*([A-Za-z_]+)\s*\**\s*(:|-|–)?\s*/);
    if (m) {const w = m[1];
      if (tools.has(w) || (/^(?:[A-Z][a-z]+){2,}$/.test(w) && LABEL_PART.test(w)) || (m[2] === ':' && LABEL_COLON.test(w))) x = x.slice(m[0].length)}
    return x.replace(/\(\s*\)/g, '').replace(/[ \t]+([.,!?])/g, '$1').trimEnd();
  }).filter(l => !/^\s*([-*_=]{3,}|[()`]+)\s*$/.test(l)).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// ---- forced scene turns (issue #163) ----
// When a member's own Table turn is open, the runner does not hand it the free tool loop: it asks the model for
// ONE structured answer (Ollama `format` = this schema, OpenAI strict json_schema, Claude output_config.format),
// checks it against that member's legal options and calls scene_act itself. A local model cannot fumble the
// call, write it as text or wait instead. A reply that is not the JSON still counts when it holds a scene_act
// written as text; after one more miss the turn ends and the table's reflex acts later, as before.
export const SCENE_LINE_MAX = 200;
// strict: OpenAI's strict json_schema (no maxLength there; the line is cut to SCENE_LINE_MAX here, the game keeps 120).
export function sceneSchema(keys, {strict = false} = {}) {
  return {type: 'object', additionalProperties: false, required: ['option', 'line'], properties: {
    option: {type: 'string', enum: keys.slice(), description: 'The key of the option you choose'},
    line: {type: 'string', description: 'What you say aloud as you act, in your own voice (one short sentence)', ...(strict ? {} : {maxLength: SCENE_LINE_MAX})}}};
}
// The open scene as the brief (/play/pace {brief:true}, field scene) or a status/look reply (field table) gives it
// -> {title, kind, frame, keys, options, your_turn, so_far}, or null when there is nothing to answer.
export function sceneFrom(t) {
  if (!t || t.acted || t.phase === 'outcome' || t.phase === 'done') return null;
  const options = Array.isArray(t.options) ? t.options : [], keys = Array.isArray(t.keys) && t.keys.length ? t.keys : options.map(o => String(o).split(' = ')[0].trim()).filter(Boolean);
  if (!keys.length) return null;
  return {title: t.title || t.scene || 'a scene', kind: t.kind || null, frame: t.frame || '', keys, options: options.length ? options : keys, your_turn: !!t.your_turn, so_far: t.so_far || []};
}
// The scene a turn has to answer: from the brief, or (a page or relay from before #163 sends no brief.scene) from
// status when the brief or the wake says a scene is open. call(tool, args) -> the game's reply.
export async function sceneToAnswer(brief, call, hinted = false) {
  if (brief && 'scene' in brief) return sceneFrom(brief.scene); // null: nothing open for this hero (or already answered)
  if (!(hinted || (brief && brief.table))) return null;
  try {const st = await call('status', {}); return st && st.ok !== false ? sceneFrom(st.table) : null} catch {return null}
}
export function scenePrompt(sc) {
  return [`A scene at the table: ${sc.title}${sc.kind ? ' (' + sc.kind + ')' : ''}. The world is paused and the party waits for you${sc.your_turn ? ': it is your turn now' : ''}.`,
    sc.frame ? 'The DM: ' + sc.frame : '', sc.so_far && sc.so_far.length ? 'So far: ' + sc.so_far.join(' / ') : '',
    'Your options:', ...sc.options.map(o => '- ' + o),
    `Choose ONE option by its key (${sc.keys.join(', ')}) and say one short line in your own voice, in English. Answer only with the JSON object {"option": key, "line": what you say}.`].filter(Boolean).join('\n');
}
// ask(system, user, schema) over the loop's chat(): Ollama `format`, OpenAI strict json_schema (chat({strict:true})).
// timeoutMs: past the table's wait (TABLE.liveMs 120 s) the reflex has acted, so a busy Ollama is not waited on longer.
export const chatAsk = (chat, model, {numCtx = null, strict = false, timeoutMs = 110000} = {}) => async (system, user, schema) => {
  const r = await chat({model, messages: [{role: 'system', content: system}, {role: 'user', content: user}], format: schema, strict, maxTokens: 300, ...(numCtx ? {numCtx} : {}), temperature: 0.4, signal: AbortSignal.timeout(timeoutMs)});
  return {text: String(r.message && r.message.content || ''), usage: r.usage || {}, ms: r.ms || 0};
};
// ask() over a provider adapter's one-shot call() (Claude: scripts/providers/anthropic.mjs, output_config.format).
export const adapterAsk = (adapter, model, effort = 'low') => async (system, user, schema) => {
  try {const r = await adapter.call({system, user, schema, maxTokens: 400, model, effort, timeoutMs: 20000}); return {text: r.text || '', usage: r.usage || {}, ms: r.ms || 0}}
  catch (e) {if (e.result) return {text: e.raw || '', usage: e.result.usage || {}, ms: e.result.ms || 0}; throw e}
};
// One forced scene turn: at most two asks, then scene_act by the runner. -> a turn record shaped like localTurn's
// (mode 'scene', forced: true, misses: answers that were not a legal option). keep: write it into sess.local.history.
export async function sceneTurn({ask, call, sess, scene: sc, on = () => {}, keep = true, strict = false}) {
  const t0 = Date.now(), stat = {tools: 0, acts: 0, repeat: false, reprompted: false, foreign: false, fresh: false, modelCalls: 0, in: 0, out: 0, cost: 0, costKnown: true, modelMs: 0, narration: '', dead: false, capped: false, rejected: 0, mode: 'scene', forced: true, calls: [], misses: 0};
  const schema = sceneSchema(sc.keys, {strict}), user = scenePrompt(sc);
  let pick = null, note = '';
  for (let k = 0; k < 2 && !pick; k++) {
    const r = await ask(sess.system || '', user + note, schema), u = r.usage || {};
    stat.modelCalls++; stat.in += u.in || 0; stat.out += u.out || 0; stat.modelMs += r.ms || 0; stat.cost += u.cost || 0; if (u.costKnown === false) stat.costKnown = false;
    let j = null; try {j = JSON.parse(r.text)} catch {}
    if (!j || typeof j !== 'object') {const c = parseTextCalls(r.text).find(x => x.function.name === 'scene_act'); if (c) j = c.function.arguments} // the call written as text still counts
    const opt = j && String(j.option || '').trim().toLowerCase();
    if (opt && sc.keys.includes(opt)) pick = {option: opt, line: cleanNarration(String(j.line || ''), PLAYER_TOOLS, []).replace(/\s+/g, ' ').slice(0, SCENE_LINE_MAX)};
    else {stat.misses++; note = `\n\nThat was not one of the options. Answer with {"option": one of ${sc.keys.join(', ')}, "line": "..."}.`}
  }
  if (!pick) {stat.ms = Date.now() - t0; return stat}
  const args = pick.line ? pick : {option: pick.option};
  on('tool', 'scene_act', args); stat.tools++;
  let r; try {r = await call('scene_act', args)} catch (e) {r = {ok: false, error: String(e.message || e)}}
  const text = typeof r === 'string' ? r : JSON.stringify(r); on('result', text);
  if (r && r.ok !== false) {stat.acts++; stat.calls.push({name: 'scene_act', ok: true}); stat.narration = pick.line ? `${pick.line} (${pick.option})` : `Chose ${pick.option} at the table.`}
  else {stat.rejected++; stat.calls.push({name: 'scene_act', ok: false, error: String(r && r.error || 'error').slice(0, 140)})}
  if (/"dead":true/.test(text)) stat.dead = true;
  if (keep) { // the hero's own conversation remembers the choice, compactly
    const L = sess.local = sess.local || {mode: 'tools', history: [], tokensIn: 0, tokensOut: 0, seconds: 0, dropped: 0};
    L.history.push({role: 'user', content: `Table scene: ${sc.title}. Options: ${sc.keys.join(', ')}.`, turn: 1}, {role: 'assistant', content: '', tool_calls: [{function: {name: 'scene_act', arguments: args}}]}, {role: 'tool', tool_name: 'scene_act', content: cut(text, LOCAL_DEFAULTS.keptChars)});
    L.tokensIn += stat.in; L.tokensOut += stat.out; L.emptyRun = 0; L.dropped += trimHistory(L.history, LOCAL_DEFAULTS.historyChars); L.seconds += (Date.now() - t0) / 1000;
  }
  if (stat.narration) on('text', stat.narration);
  stat.ms = Date.now() - t0;
  return stat;
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
// 'mode' (new mode). Returns {tools, modelCalls, in, out, modelMs, ms, narration, dead, capped, rejected, mode, calls:[{name, ok, error?}]}.
// tools: the tool table (default the hero's; the DM runner passes DM_TOOLS); rules: the line appended to the system prompt.
export async function localTurn({chat, call, sess, prompt, model, toolTurns = 12, on = () => {}, opts = {}, tools: list = PLAYER_TOOLS, rules = LOCAL_RULES}) {
  const o = {...LOCAL_DEFAULTS, ...opts};
  const L = sess.local = sess.local || {mode: 'tools', history: [], tokensIn: 0, tokensOut: 0, seconds: 0, dropped: 0};
  const t0 = Date.now(); let reprompted = false; const stat = {tools: 0, acts: 0, repeat: false, reprompted: false, foreign: false, fresh: false, modelCalls: 0, in: 0, out: 0, cost: 0, costKnown: true, modelMs: 0, narration: '', dead: false, capped: false, rejected: 0, mode: L.mode, calls: []};
  const addCost = u => {stat.cost += u.cost || 0; if (u.costKnown === false) stat.costKnown = false}; // paid providers (OpenAI) report a cost; Ollama's is 0
  // a run of empty turns (no call, a repeat, another language): start this one from a fresh context
  if ((L.emptyRun || 0) >= o.freshAfter) {L.history = []; L.lastNarr = null; L.emptyRun = 0; stat.fresh = true}
  const sample = {temperature: o.temperature, repeatPenalty: o.repeatPenalty};
  const turnMsgs = [{role: 'user', content: prompt, turn: 1}];
  const sys = () => sess.system + (L.mode === 'json' ? '\n\n' + JSON_RULES + actionCatalogue(list) : rules);
  const tools = ollamaTools(list);
  const exec = async (name, rawArgs) => {
    const c = cleanArgs(name, rawArgs, list); stat.tools++;
    on('tool', name, c.args || rawArgs);
    let r; if (c.error) {stat.rejected++; r = {ok: false, error: 'Not done: ' + c.error}} else {try {r = await call(name, c.args)} catch (e) {r = {ok: false, error: String(e.message || e)}}
      const meta = byName(list).get(name); if (meta && meta.act && r && r.ok !== false) stat.acts++}
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    on('result', text);
    stat.calls.push(r && typeof r === 'object' && r.ok === false ? {name, ok: false, error: String(r.error || 'error').slice(0, 140), ...(r.refused ? {refused: true} : {})} : {name, ok: true}); // the behavior log's turn line (issue #129)
    if (/"dead":true/.test(text)) stat.dead = true;
    return text;
  };
  for (let i = 0; i < toolTurns && !stat.dead; i++) {
    const messages = [{role: 'system', content: sys()}, ...L.history.map(strip), ...turnMsgs.map(strip)];
    let res;
    try {res = await chat({model, messages, ...(L.mode === 'json' ? {format: actionSchema(list)} : {tools}), maxTokens: o.maxTokens, numCtx: o.numCtx, ...sample})}
    catch (e) {if (e.noTools && L.mode !== 'json') {L.mode = stat.mode = 'json'; on('mode', 'json'); i--; continue} throw e}
    stat.modelCalls++; stat.in += res.usage.in; stat.out += res.usage.out; stat.modelMs += res.ms; addCost(res.usage);
    const msg = res.message || {}, content = String(msg.content || '');
    if (L.mode === 'json') {
      let j = null; try {j = JSON.parse(content)} catch {}
      turnMsgs.push({role: 'assistant', content});
      if (!j || typeof j.tool !== 'string') {stat.rejected++; turnMsgs.push({role: 'user', content: 'That was not one JSON object with "tool", "args" and "narration". Try again.'}); continue}
      const jn = cleanNarration(j.narration, list);
      if (jn && j.tool !== 'end' && !notEnglish(jn)) on('text', jn);
      if ((j.tool === 'end' || !j.tool) && (!stat.tools || notEnglish(j.narration)) && !reprompted && i < toolTurns - 1) {reprompted = stat.reprompted = true; turnMsgs.push({role: 'user', content: notEnglish(j.narration) ? REPROMPT_EN : REPROMPT}); continue}
      if (j.tool === 'end' || !j.tool) {stat.narration = jn; break}
      const text = await exec(j.tool, j.args);
      turnMsgs.push({role: 'user', content: `Result of ${j.tool}: ${cut(text, o.resultChars)}`});
      continue;
    }
    // calls written into the text count too, before the real ones (issue #163: scene_act written out, then a real wait)
    const native = Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls : [];
    const sig = c => (c.function && c.function.name) + JSON.stringify(c.function && c.function.arguments || {});
    const written = parseTextCalls(content, list), said = cleanNarration(content, list, written);
    let calls = [...written.filter(w => !native.some(n => sig(n) === sig(w))).map(w => ({function: w.function})), ...native];
    if (!calls.length) calls = null;
    if (!calls && (!stat.tools || notEnglish(content)) && !reprompted && i < toolTurns - 1) {reprompted = stat.reprompted = true; turnMsgs.push({role: 'assistant', content: notEnglish(content) ? '(not in English)' : cut(said || content, 300), narr: 1}, {role: 'user', content: notEnglish(content) ? REPROMPT_EN : REPROMPT}); continue}
    if (!calls) {stat.narration = said; turnMsgs.push({role: 'assistant', content: stat.narration, narr: 1}); break}
    calls = calls.slice(0, o.callsPerReply);
    turnMsgs.push({role: 'assistant', content: said, tool_calls: calls.map(c => ({function: {name: c.function && c.function.name, arguments: c.function && c.function.arguments || {}}}))});
    if (said && !notEnglish(said)) on('text', said);
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
      const fin = await chat({model, messages: [{role: 'system', content: sys()}, ...L.history.map(strip), ...turnMsgs.map(strip)], maxTokens: o.maxTokens, numCtx: o.numCtx, ...sample});
      stat.modelCalls++; stat.in += fin.usage.in; stat.out += fin.usage.out; stat.modelMs += fin.ms; addCost(fin.usage);
      stat.narration = cleanNarration(fin.message && fin.message.content, list);
      turnMsgs.push({role: 'assistant', content: stat.narration, narr: 1}); break;
    }
    if (i === toolTurns - 1) stat.capped = true;
  }
  // a narration not in English is not shown, kept or counted: the turn is empty (issue #126)
  if (stat.narration && notEnglish(stat.narration)) {stat.foreign = true; for (const m of turnMsgs) if (m.narr && m.content === stat.narration) m.content = '(not in English)'; stat.narration = ''}
  if (stat.narration) on('text', stat.narration);
  // keep the turn compactly: long tool results and musings shortened, then the oldest turns dropped to fit
  for (const m of turnMsgs) if ((m.role === 'tool' || (L.mode === 'json' && m.role === 'user' && !m.turn)) && m.content.length > o.keptChars) m.content = cut(m.content, o.keptChars);
    else if (m.role === 'assistant' && L.mode !== 'json' && m.content.length > o.keptChars * 2) m.content = cut(m.content, o.keptChars * 2);
  // the model's own past narrations are not fed back (a small model copies them instead of looking): only this turn's stays
  const lastNarr = turnMsgs.filter(m => m.narr).pop();
  L.history = L.history.filter(m => !m.narr);
  L.history.push(...turnMsgs.filter(m => !m.narr || m === lastNarr));
  // a narration close to the last one is a repeat; with no world-changing call it makes an empty turn (scripts/pacing.mjs localWorked)
  if (stat.narration && L.lastNarr && similar(stat.narration, L.lastNarr) >= REPEAT_SIM) stat.repeat = true;
  if (stat.narration) L.lastNarr = stat.narration.slice(0, 400);
  L.emptyRun = !stat.tools || stat.rejected >= stat.tools || (stat.repeat && !stat.acts) || stat.foreign ? (L.emptyRun || 0) + 1 : 0;
  L.dropped += trimHistory(L.history, o.historyChars);
  L.tokensIn += stat.in; L.tokensOut += stat.out; L.seconds += (Date.now() - t0) / 1000;
  stat.ms = Date.now() - t0;
  return stat;
}

// Marks on a turn line (issue #126): the model was told to act, or only repeated itself.
const turnFlags = st => (st.mode === 'scene' ? ' | forced scene turn' + (st.misses ? ' (' + st.misses + ' missed)' : '') : '') + (st.fresh ? ' | fresh context' : '') + (st.reprompted ? ' | re-prompted to act' : '') + (st.foreign ? ' | empty turn (not in English)' : !st.tools ? ' | empty turn (no tool call)' : st.repeat && !st.acts ? ' | empty turn (repeated narration)' : '');
// The cost line for a local turn: tokens and seconds, cost 0.
export const localLine = (st, model) => `${model} (local) | ${st.tools} tool calls${st.rejected ? ' (' + st.rejected + ' rejected)' : ''}, ${(st.ms / 1000).toFixed(1)} s (${(st.modelMs / 1000).toFixed(1)} s in the model), ${st.modelCalls} model calls${st.mode === 'json' ? ', JSON-action mode' : ''} | tokens in ${st.in} / out ${st.out} | $0 (local)${st.capped ? ' | hit the model-call cap' : ''}${turnFlags(st)}`;

// The cost line for a turn played through a paid provider (OpenAI): like localLine, with the real cost.
// Ends with "| turn $x | run $y" when run is given (the app runner supervisor reads "| run $"); an
// unknown price (a model not in the provider's price table) says so instead of a dollar figure.
export const paidLine = (st, model, provider, {run = null, session = null} = {}) => {
  const money = v => '$' + v.toFixed(4);
  return `${model} (${provider}) | ${st.tools} tool calls${st.rejected ? ' (' + st.rejected + ' rejected)' : ''}, ${(st.ms / 1000).toFixed(1)} s (${(st.modelMs / 1000).toFixed(1)} s in the model), ${st.modelCalls} model calls${st.mode === 'json' ? ', JSON-action mode' : ''} | tokens in ${st.in} / out ${st.out} | ${st.costKnown ? 'turn ' + money(st.cost) : 'cost unknown (model not in the price table)'}${run != null ? ' | run ' + money(run) : ''}${session != null ? ' | session ' + money(session) : ''}${st.capped ? ' | hit the model-call cap' : ''}${turnFlags(st)}`;
};
