// Ollama adapter (Mixed minds, issue #97): local open models, no key, no cost.
// Uses the native POST /api/chat with `format` set to the JSON schema (Ollama's structured outputs: the
// reply is constrained to the schema by the sampler, which the OpenAI-compatible /v1 endpoint does not
// guarantee for every version) and stream:false. Token counts come from prompt_eval_count / eval_count.
// The model is kept loaded for keepAlive between calls so a decision does not pay the load time.
// think:false: thinking models (qwen3.x, deepseek-r1 ...) would otherwise spend the whole token budget
// thinking before the JSON (measured live: every reply cut off). A model that says it does not support
// thinking is asked again without the field, and remembered.
// Interface: see anthropic.mjs.

// Agent runner chats (chat()): issue #126, the owner's local Fellowship got "fetch failed" after exactly
// 5 minutes (undici's default headers timeout) while Ollama swapped two models under five 16k-context
// requests. So chat() posts with node:http and its own timeout (OLLAMA_CHAT_TIMEOUT seconds, default 600),
// runs at most `parallel` requests at once per adapter (OLLAMA_PARALLEL, default 1: a runner's members
// share one queue), and says plainly when Ollama is busy or loading. loaded() lists the models Ollama
// holds in memory (GET /api/ps) so a runner can warn when the relay's minds use another local model.
import http from 'node:http';
import https from 'node:https';

export const OLLAMA_URL = 'http://localhost:11434';
export const OLLAMA_MODEL = 'qwen2.5:14b';
const envNum = (k, d) => {const v = typeof process !== 'undefined' && process.env ? Number(process.env[k]) : NaN; return Number.isFinite(v) && v > 0 ? v : d};
export const CHAT_TIMEOUT_S = envNum('OLLAMA_CHAT_TIMEOUT', 600), OLLAMA_PARALLEL = envNum('OLLAMA_PARALLEL', 1);

const fail = (msg, raw) => Object.assign(new Error(msg), raw != null ? {raw} : {});

// POST JSON with one overall timeout and no headers timeout of its own (a local model may think for minutes).
function postJson(url, body, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), lib = u.protocol === 'https:' ? https : http, data = Buffer.from(JSON.stringify(body));
    const req = lib.request(u, {method: 'POST', headers: {'content-type': 'application/json', 'content-length': data.length}}, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {const text = Buffer.concat(chunks).toString('utf8'); resolve({ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(text)})});
      res.on('error', reject);
    });
    const t = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), {code: 'ETIMEDOUT'})), timeoutMs);
    req.on('close', () => clearTimeout(t)); req.on('error', reject);
    if (signal) {if (signal.aborted) req.destroy(new Error('aborted')); else signal.addEventListener('abort', () => req.destroy(new Error('aborted')), {once: true})}
    req.end(data);
  });
}

export function ollamaAdapter({url = OLLAMA_URL, defaultModel = OLLAMA_MODEL, keepAlive = '30m', fetchImpl = globalThis.fetch, statusTtl = 10000, chatTimeoutMs = CHAT_TIMEOUT_S * 1000, parallel = OLLAMA_PARALLEL, chatPost = null} = {}) {
  const base = String(url).replace(/\/+$/, '');
  let cached = null, cachedAt = 0;
  const noThink = new Set(); // models that rejected the think field
  // the chat queue: at most `parallel` requests in flight, the rest wait in order
  let live = 0; const queue = [];
  const take = () => live < parallel ? (live++, Promise.resolve()) : new Promise(r => queue.push(r)).then(() => {live++});
  const give = () => {live--; const n = queue.shift(); if (n) n()};
  const posting = chatPost || ((u, b, signal) => postJson(u, b, chatTimeoutMs, signal));
  return {
    name: 'ollama', local: true, url: base, defaultModel,
    configured: () => true,
    queued: () => queue.length,
    // The models Ollama holds in memory now (GET /api/ps), or null when it does not answer.
    async loaded() {
      try {const r = await fetchImpl(base + '/api/ps', {signal: AbortSignal.timeout(2000)}); if (!r.ok) return null; const j = await r.json();
        return (Array.isArray(j && j.models) ? j.models : []).map(m => m && (m.name || m.model)).filter(n => typeof n === 'string')} catch {return null}
    },
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
    async chat({model, messages, tools, format, maxTokens = 600, numCtx = null, temperature = null, repeatPenalty = null, signal}) {
      const mdl = model || defaultModel, t0 = Date.now();
      const body = {model: mdl, stream: false, keep_alive: keepAlive, ...(noThink.has(mdl) ? {} : {think: false}), messages,
        ...(tools ? {tools} : {}), ...(format ? {format} : {}),
        options: {num_predict: maxTokens, ...(numCtx ? {num_ctx: numCtx} : {}), ...(temperature != null ? {temperature} : {}), ...(repeatPenalty != null ? {repeat_penalty: repeatPenalty} : {})}};
      const post = async () => {
        try {return await posting(base + '/api/chat', body, signal)}
        catch (e) {const code = e && (e.code || e.cause && e.cause.code);
          if (code === 'ETIMEDOUT') throw fail(`ollama: no answer from ${mdl} in ${Math.round(chatTimeoutMs / 1000)} s (Ollama is busy or loading the model; another local model, such as the relay's minds, may be evicting it: use one model for both, or raise OLLAMA_CHAT_TIMEOUT)`);
          if (code === 'ECONNREFUSED') throw fail(`ollama: not reachable at ${base} (is Ollama running?)`);
          throw fail('ollama: ' + String(e && e.message || e).slice(0, 160))}};
      let r, j = null;
      await take();
      try {
        r = await post(); try {j = await r.json()} catch {}
        if (!r.ok && 'think' in body && /think/i.test(String(j && j.error))) {noThink.add(mdl); delete body.think; r = await post(); j = null; try {j = await r.json()} catch {}}
      } finally {give()}
      if (!r.ok) {const msg = String(j && j.error || 'HTTP ' + r.status);
        throw Object.assign(fail('ollama: ' + msg.slice(0, 160)), {noTools: !!tools && /does not support tools|tools? (are|is) not supported/i.test(msg), status: r.status})}
      const message = j && j.message && typeof j.message === 'object' ? j.message : {role: 'assistant', content: ''};
      return {message, usage: {in: +(j && j.prompt_eval_count) || 0, out: +(j && j.eval_count) || 0, cost: 0}, model: (j && j.model) || mdl, ms: Date.now() - t0, done: j && j.done_reason || null};
    },
  };
}
