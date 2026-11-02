// Turn lines for the behavior logs (issue #129), runner side: scripts/agent-player.mjs, scripts/fellowship.mjs
// and scripts/dm-agent.mjs build one record per turn and send it to POST /play/behavior/turn, where the relay
// (or the headless host) checks that this runner holds the seat, adds the hero's state after the turn and
// writes logs/behavior/<world>/turns.jsonl (scripts/behavior-log.mjs). Fire and forget: an older host (404),
// a host without behavior logs or a slow one never holds up a turn. The record carries this seat's own
// narration, tool names with ok/error and its numbers; never tool results, prompts or another seat's text.
// Nothing here is read back by any agent.

const cut = (s, n) => {s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s};
// A tool result (an object, or the JSON text the MCP tool returned) -> {ok, error?, refused?}
export function resultOf(r) {
  let j = r; if (typeof r === 'string') {try {j = JSON.parse(r)} catch {j = /"ok":\s*false/.test(r) ? {ok: false, error: (r.match(/"error":\s*"([^"]{0,160})/) || [])[1] || 'error'} : {ok: true}}}
  if (!j || typeof j !== 'object') return {ok: true};
  if (j.ok === false) return {ok: false, error: cut(j.error || j.reason || 'error', 140), ...(j.refused ? {refused: true} : {})};
  return {ok: true};
}
const brief = b => b ? {state: b.state, doing: b.doing || null, hp: b.hp, level: b.level, place: b.place || null, foe: b.foe || null, autopilot: !!b.autopilot, table: !!b.table, news: Array.isArray(b.news) ? b.news.length : 0, clock: b.clock || null} : null;

// The Agent SDK side: feed it the stream's tool_use / tool_result / text blocks, then build().
export function turnCollector() {
  const tools = [], ids = new Map(); let narr = [];
  return {
    tool(name, id) {const t = {name: String(name || '').replace(/^mcp__eldmoor__/, ''), ok: true}; tools.push(t); if (id) ids.set(id, t)},
    result(id, content, isError) {const t = ids.get(id) || tools[tools.length - 1]; if (!t) return; const r = resultOf(content); if (isError && r.ok) {r.ok = false; r.error = cut(content, 140)} Object.assign(t, r)},
    text(s) {if (s && String(s).trim()) narr.push(String(s).trim())},
    get tools() {return tools},
    // the turn's narration: the last thing the agent said (the closing sentence)
    get narration() {return narr.length ? narr[narr.length - 1] : ''},
  };
}
// A local-loop turn (scripts/local-agent.mjs result) -> the record's numbers and flags.
export function localRec(r) {
  if (!r) return {tools: [], narration: '', flags: ['failed']};
  const flags = []; if (r.fresh) flags.push('fresh'); if (r.reprompted) flags.push('reprompted'); if (r.foreign) flags.push('foreign'); if (r.repeat) flags.push('repeat'); if (r.capped) flags.push('capped'); if (r.mode === 'json') flags.push('json-mode'); if (r.mode === 'reflect') flags.push('reflection');
  return {tools: (r.calls || []).map(c => ({name: c.name, ok: c.ok, ...(c.ok ? {} : {error: c.error}), ...(c.refused ? {refused: true} : {})})), narration: r.narration || '', seconds: +(r.ms / 1000).toFixed(1), tokensIn: r.in, tokensOut: r.out, cost: r.cost || 0, flags};
}

// Send one turn line. seat: {hero: id} or {role: 'dm'}. Returns a promise that never rejects.
export function reportTurn(base, {hero = null, role = null, runner, provider, model, turn, wake = null, brief: b = null, ...rest}, {fetchImpl = fetch} = {}) {
  if (!base) return Promise.resolve(false);
  const body = {...(hero != null ? {hero} : {}), ...(role ? {role} : {}), runner, rec: {provider, model, turn, wake: wake && wake.wake ? {wake: wake.wake, why: cut(wake.why, 160)} : null, brief: brief(b), ...rest, narration: cut(rest.narration, 600)}};
  try {
    return fetchImpl(base + '/play/behavior/turn', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(8000)})
      .then(r => r.status === 200).catch(() => false);
  } catch {return Promise.resolve(false)}
}
export {brief as briefRec};
