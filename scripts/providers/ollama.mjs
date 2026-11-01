// Ollama adapter (Mixed minds, issue #97): local open models, no key, no cost.
// Uses the native POST /api/chat with `format` set to the JSON schema (Ollama's structured outputs: the
// reply is constrained to the schema by the sampler, which the OpenAI-compatible /v1 endpoint does not
// guarantee for every version) and stream:false. Token counts come from prompt_eval_count / eval_count.
// The model is kept loaded for keepAlive between calls so a decision does not pay the load time.
// think:false: thinking models (qwen3.x, deepseek-r1 ...) would otherwise spend the whole token budget
// thinking before the JSON (measured live: every reply cut off). A model that says it does not support
// thinking is asked again without the field, and remembered.
// Interface: see anthropic.mjs.

export const OLLAMA_URL = 'http://localhost:11434';
export const OLLAMA_MODEL = 'qwen2.5:14b';

const fail = (msg, raw) => Object.assign(new Error(msg), raw != null ? {raw} : {});

export function ollamaAdapter({url = OLLAMA_URL, defaultModel = OLLAMA_MODEL, keepAlive = '30m', fetchImpl = globalThis.fetch, statusTtl = 10000} = {}) {
  const base = String(url).replace(/\/+$/, '');
  let cached = null, cachedAt = 0;
  const noThink = new Set(); // models that rejected the think field
  return {
    name: 'ollama', local: true, url: base, defaultModel,
    configured: () => true,
    // Reachable or not, and which models are pulled (GET /api/tags). Cached for statusTtl ms.
    async status() {
      if (cached && Date.now() - cachedAt < statusTtl) return cached;
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 1500);
      try {
        const r = await fetchImpl(base + '/api/tags', {signal: ac.signal});
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const models = (Array.isArray(j && j.models) ? j.models : []).map(m => m && (m.name || m.model)).filter(n => typeof n === 'string').sort();
        cached = {ok: true, url: base, models, default: defaultModel};
      } catch (e) {
        cached = {ok: false, url: base, models: [], default: defaultModel, error: e.name === 'AbortError' ? 'not reachable (timeout)' : 'not reachable (' + String(e.cause && e.cause.code || e.message).slice(0, 60) + ')'};
      } finally {clearTimeout(t)}
      cachedAt = Date.now();
      return cached;
    },
    async call({system, user, schema, maxTokens, model, signal}) {
      const mdl = model || defaultModel, t0 = Date.now();
      const body = {
        model: mdl, stream: false, keep_alive: keepAlive, ...(noThink.has(mdl) ? {} : {think: false}),
        format: schema,
        // Local tokenizers differ from Claude's and cost nothing: give the reply some headroom over the
        // per-kind cap so a slightly wordier model is not cut off.
        options: {num_predict: Math.round(maxTokens * 2)},
        messages: [{role: 'system', content: system}, {role: 'user', content: user}],
      };
      const post = () => fetchImpl(base + '/api/chat', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal});
      let r = await post(), j = null; try {j = await r.json()} catch {}
      if (!r.ok && 'think' in body && /think/i.test(String(j && j.error))) {noThink.add(mdl); delete body.think; r = await post(); j = null; try {j = await r.json()} catch {}}
      if (!r.ok) throw fail('ollama: ' + String(j && j.error || 'HTTP ' + r.status).slice(0, 160));
      const text = j && j.message && typeof j.message.content === 'string' ? j.message.content : null;
      const usage = {in: +(j && j.prompt_eval_count) || 0, out: +(j && j.eval_count) || 0, cost: 0};
      const out = {text, usage, model: (j && j.model) || mdl, ms: Date.now() - t0};
      if (j && j.done_reason === 'length') throw Object.assign(fail('reply cut off', text), {result: out});
      if (!text) throw Object.assign(fail('no text in reply'), {result: out});
      return out;
    },
    // A multi-turn chat for the local agent runner (issue #97 part 2, scripts/local-agent.mjs).
    // messages: Ollama chat messages (system/user/assistant with tool_calls/tool); tools: Ollama
    // function tools, or format: a JSON schema for the JSON-action fallback. Returns {message,
    // usage:{in,out,cost:0}, model, ms, done}. A model without tool support fails with e.noTools.
    async chat({model, messages, tools, format, maxTokens = 600, numCtx = null, signal}) {
      const mdl = model || defaultModel, t0 = Date.now();
      const body = {model: mdl, stream: false, keep_alive: keepAlive, ...(noThink.has(mdl) ? {} : {think: false}), messages,
        ...(tools ? {tools} : {}), ...(format ? {format} : {}),
        options: {num_predict: maxTokens, ...(numCtx ? {num_ctx: numCtx} : {})}};
      const post = () => fetchImpl(base + '/api/chat', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal});
      let r = await post(), j = null; try {j = await r.json()} catch {}
      if (!r.ok && 'think' in body && /think/i.test(String(j && j.error))) {noThink.add(mdl); delete body.think; r = await post(); j = null; try {j = await r.json()} catch {}}
      if (!r.ok) {const msg = String(j && j.error || 'HTTP ' + r.status);
        throw Object.assign(fail('ollama: ' + msg.slice(0, 160)), {noTools: !!tools && /does not support tools|tools? (are|is) not supported/i.test(msg), status: r.status})}
      const message = j && j.message && typeof j.message === 'object' ? j.message : {role: 'assistant', content: ''};
      return {message, usage: {in: +(j && j.prompt_eval_count) || 0, out: +(j && j.eval_count) || 0, cost: 0}, model: (j && j.model) || mdl, ms: Date.now() - t0, done: j && j.done_reason || null};
    },
  };
}
