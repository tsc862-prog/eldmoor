// OpenAI adapter (Mixed minds, issue #97). Chat Completions at OPENAI_BASE_URL (default
// https://api.openai.com/v1) with strict JSON-schema structured output for the relay's decisions and
// writing, and a multi-turn chat() with function tools for the agent loop (scripts/local-agent.mjs).
//
// Why Chat Completions and not the Responses API: both are supported by the current models, but the
// agent loop is the same tool-calling loop the Ollama runner already has (messages in, tool_calls
// out), Chat Completions is also what OpenAI-compatible servers speak (OPENAI_BASE_URL), and the loop
// keeps its own history, so Responses' server-side state buys nothing here. Per OpenAI's model page,
// Chat Completions function calling on the current reasoning models only works with
// reasoning_effort "none", so every request sends it; a model that rejects the field (400 naming
// it) is asked again without it and remembered, as the Ollama adapter does with `think`.
//
// The key is read by the process that makes the call (the relay, or an agent runner started from the
// same .env) and goes only into the Authorization header: never logged, never in an error message
// (anything key-shaped in an API error is scrubbed).
//
// There is no default model in code: OPENAI_MODEL sets one, otherwise the caller picks (the mind row's
// model list is filled from GET /models). Model ids and prices below were read from OpenAI's pages
// (see PRICES); a model that is not in the table reports tokens with cost 'unknown'.
// Interface: see anthropic.mjs.

export const OPENAI_URL = 'https://api.openai.com/v1';

// $ per 1M tokens, standard tier, short context (<272K input) where the page splits by context.
// Source: https://developers.openai.com/api/docs/pricing (platform.openai.com/docs/pricing redirects
// there), read 2026-11-01. Cached-input discounts are ignored, so a cost here is an upper bound.
// The page notes GPT-5.6 Sol's price is promotional through at least 2026-11-21.
export const PRICES_SOURCE = 'https://developers.openai.com/api/docs/pricing (read 2026-11-01)';
export const PRICES = {
  'gpt-6-astra': {in: 10, out: 50}, 'gpt-6.1-sol': {in: 2, out: 10}, 'gpt-6.1-terra': {in: 1, out: 5}, 'gpt-6-luna': {in: 0.10, out: 0.50}, 'gpt-6-sol': {in: 2, out: 10},
  'gpt-5.6-sol': {in: 4, out: 20}, 'gpt-5.6-terra': {in: 2, out: 12}, 'gpt-5.6-luna': {in: 0.20, out: 1.20},
  'gpt-5.5': {in: 5, out: 30}, 'gpt-5.5-pro': {in: 30, out: 180}, 'gpt-5.4': {in: 2.5, out: 15}, 'gpt-5.4-pro': {in: 30, out: 180}, 'gpt-5.4-mini': {in: 0.75, out: 4.5}, 'gpt-5.4-nano': {in: 0.20, out: 1.25},
  'gpt-5.2': {in: 1.75, out: 14}, 'gpt-5.2-pro': {in: 21, out: 168}, 'gpt-5.1': {in: 1.25, out: 10}, 'gpt-5': {in: 1.25, out: 10}, 'gpt-5-mini': {in: 0.25, out: 2}, 'gpt-5-nano': {in: 0.05, out: 0.40}, 'gpt-5-pro': {in: 15, out: 120},
  'gpt-4.1': {in: 2, out: 8}, 'gpt-4.1-mini': {in: 0.40, out: 1.60}, 'gpt-4.1-nano': {in: 0.10, out: 0.40},
  'gpt-4o': {in: 2.5, out: 10}, 'gpt-4o-mini': {in: 0.15, out: 0.60},
  'o1': {in: 15, out: 60}, 'o3': {in: 2, out: 8}, 'o3-pro': {in: 20, out: 80}, 'o3-mini': {in: 1.10, out: 4.40}, 'o4-mini': {in: 1.10, out: 4.40},
  'gpt-4-turbo': {in: 10, out: 30}, 'gpt-3.5-turbo': {in: 0.50, out: 1.50},
};
// A dated snapshot (gpt-4o-2024-08-06) is priced as its family when the table has no row for the snapshot itself.
export const priceFor = model => {const m = String(model || ''); return PRICES[m] || PRICES[m.replace(/-\d{4}-\d{2}-\d{2}$/, '')] || null};
// -> number, or null when the model is not in the table (the caller reports 'unknown').
export const costOf = (model, inTok, outTok) => {const p = priceFor(model); return p ? (inTok * p.in + outTok * p.out) / 1e6 : null};

// Chat-capable models out of GET /models (which also lists embeddings, speech, images, moderation ...).
export const isChatModel = id => /^(gpt-|o\d|chatgpt-|chat-latest)/.test(id)
  && !/(embedding|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|codex|instruct|davinci|babbage|computer-use|sora|deep-research|diarize)/.test(id);

const scrub = s => String(s == null ? '' : s).replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-…').replace(/hf_[A-Za-z0-9]{6,}/g, 'hf_…').replace(/Bearer\s+\S+/gi, 'Bearer …');
const fail = (msg, extra) => Object.assign(new Error(msg), extra || {});
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => {clearTimeout(t); rej(Object.assign(new Error('aborted'), {name: 'AbortError'}))}, {once: true});
});

// Hugging Face Inference Providers router (issue #552): OpenAI-compatible, the same adapter with another name,
// base URL and key. Only the free allowance is used (the owner keeps no payment method): a request is a plain
// chat completion with the model id as given and no billing options; the cost is 0 (free tier), an exhausted
// allowance (402, or 429 naming credits/quota) is a 'quota' error, never charged. HF_TOKEN is read from the
// environment by the process that calls and goes only into the Authorization header.
export const HF_URL = 'https://router.huggingface.co/v1';
export const HF_PRICES_SOURCE = 'free allowance of the Hugging Face router (no paid options are ever sent); cost 0';
export const HF_OPTS = {name: 'hf', label: 'Hugging Face', keyName: 'HF_TOKEN', baseUrl: HF_URL, free: true, sendEffort: false, tokensField: 'max_tokens', modelFilter: () => true, pricesSource: HF_PRICES_SOURCE};
export const hfAdapter = (o = {}) => openaiAdapter({...HF_OPTS, ...o});

export function openaiAdapter({apiKey = null, baseUrl = OPENAI_URL, defaultModel = null, fetchImpl = globalThis.fetch, statusTtl = 60000,
  name = 'openai', label = 'OpenAI', keyName = 'OPENAI_API_KEY', free = false, sendEffort = true, tokensField = 'max_completion_tokens', modelFilter = isChatModel, pricesSource = PRICES_SOURCE} = {}) {
  const base = String(baseUrl || OPENAI_URL).replace(/\/+$/, '');
  const noEffort = new Set(); // models that rejected reasoning_effort
  let cached = null, cachedAt = 0;

  // The API's own error, mapped to a short message the relay and the UI can show. Never contains the key.
  function apiError(status, j, headers) {
    const e = j && j.error || {}, msg = scrub(e.message || '').slice(0, 160), code = e.code || e.type || '';
    const ra = Number(headers && headers.get && headers.get('retry-after'));
    const retryAfter = Number.isFinite(ra) && ra >= 0 ? ra : null;
    if (status === 401) return fail(name + ': bad or missing key', {status, kind: 'auth'});
    if (free && (status === 402 || (status === 429 && /credit|quota|allowance|exceeded your monthly/i.test(msg)))) return fail(name + ': free allowance used up', {status, kind: 'quota'});
    if (status === 429 && /insufficient_quota/.test(code)) return fail(name + ': out of credit (insufficient quota; check billing)', {status, kind: 'quota'});
    if (status === 429) return fail(name + ': rate limit' + (retryAfter != null ? ` (retry after ${retryAfter} s)` : ''), {status, kind: 'rate', retryAfter, ...(retryAfter != null ? {headers: {'retry-after': String(retryAfter)}} : {})}); // headers: what the relay's limiter (providers/limiter.mjs rateLimitOf) reads
    if (status === 404) return fail(name + ': model not found or not available to this key' + (msg ? ' (' + msg + ')' : ''), {status, kind: 'model'});
    return fail(name + ': ' + (msg || 'HTTP ' + status), {status, kind: 'http', apiMessage: msg});
  }

  // One POST with the reasoning_effort fallback and a bounded wait on 429. waitMs: the most we sleep for
  // a rate limit in total (0 = never; decisions have seconds, an agent turn can afford more).
  async function post(path, body, {signal, waitMs = 0, retries = 1} = {}) {
    if (!apiKey) throw fail(name + ' is not configured (no ' + keyName + '): bad or missing key', {status: 401, kind: 'auth'});
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const r = await fetchImpl(base + path, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + apiKey}, body: JSON.stringify(body), signal});
      let j = null; try {j = await r.json()} catch {}
      if (r.ok) return j;
      if (r.status === 400 && 'reasoning_effort' in body && /reasoning_effort/i.test(String(j && j.error && j.error.message))) {noEffort.add(body.model); delete body.reasoning_effort; continue}
      const err = apiError(r.status, j, r.headers);
      if (err.kind === 'rate' && attempt < retries) {
        const wait = Math.max(500, (err.retryAfter != null ? err.retryAfter : 1) * 1000);
        if (waited + wait <= waitMs) {waited += wait; await sleep(wait, signal); continue}
      }
      throw err;
    }
  }

  const effortField = mdl => !sendEffort || noEffort.has(mdl) ? {} : {reasoning_effort: 'none'};

  return {
    name, label, local: false, free, defaultModel: defaultModel || null, pricesSource,
    configured: () => !!apiKey,
    // Reachable and the key accepted, and the chat models this key can use (GET /models). Cached.
    async status() {
      if (!apiKey) return {ok: false, models: [], default: defaultModel || null, error: 'no ' + keyName};
      if (cached && Date.now() - cachedAt < statusTtl) return cached;
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 4000);
      try {
        const r = await fetchImpl(base + '/models', {headers: {authorization: 'Bearer ' + apiKey}, signal: ac.signal});
        let j = null; try {j = await r.json()} catch {}
        if (!r.ok) throw apiError(r.status, j, r.headers);
        const models = (Array.isArray(j && j.data) ? j.data : []).map(m => m && m.id).filter(id => typeof id === 'string' && modelFilter(id)).sort();
        cached = {ok: true, models, default: defaultModel || null, ...(defaultModel ? {} : {note: 'pick a model (' + keyName.replace(/_(API_KEY|TOKEN)$/, '') + '_MODEL sets a default)'})};
      } catch (e) {
        cached = {ok: false, models: [], default: defaultModel || null, error: e.name === 'AbortError' ? 'not reachable (timeout)' : e.kind ? e.message.replace(name + ': ', '') : 'not reachable (' + scrub(e.cause && e.cause.code || e.message).slice(0, 60) + ')'};
      } finally {clearTimeout(t)}
      cachedAt = Date.now();
      return cached;
    },
    // One structured decision or writing request.
    async call({system, user, schema, maxTokens, model, signal}) {
      const mdl = model || defaultModel;
      if (!mdl) throw fail(name + ': no model chosen (pick one in the mind row, or set the default model in .env)');
      const t0 = Date.now();
      const body = {model: mdl, ...effortField(mdl), [tokensField]: maxTokens,
        response_format: {type: 'json_schema', json_schema: {name: 'reply', strict: true, schema}},
        messages: [{role: 'system', content: system}, {role: 'user', content: user}]};
      const j = await post('/chat/completions', body, {signal, retries: 0}); // a 429 goes to the relay's limiter (queue pause, writing kinds retried)
      return finish(j, mdl, t0, true);
    },
    // A multi-turn chat for the agent loop. messages are the loop's own (Ollama-shaped) messages:
    // assistant tool_calls with object arguments, tool results with tool_name. They are translated to
    // OpenAI's shape here (call ids made up in order). tools: function tools; format: a JSON schema, asked
    // for as JSON mode (OpenAI models all have tools, so this is only a fallback), or with strict: true as strict
    // json_schema (the forced Table turn, issue #163). Returns the loop's
    // shape {message:{role,content,tool_calls?}, usage:{in,out,cost,costKnown}, model, ms, done}.
    async chat({model, messages, tools, format, strict = false, maxTokens = 600, signal}) {
      const mdl = model || defaultModel;
      if (!mdl) throw fail(name + ': no model chosen (use --model, or set the default model in .env)');
      const t0 = Date.now(), body = {model: mdl, ...effortField(mdl), [tokensField]: maxTokens, messages: toOpenAI(messages),
        ...(tools ? {tools} : {}), ...(format ? {response_format: strict ? {type: 'json_schema', json_schema: {name: 'reply', strict: true, schema: format}} : {type: 'json_object'}} : {})};
      const j = await post('/chat/completions', body, {signal, waitMs: 30000, retries: 4});
      const out = finish(j, mdl, t0, false);
      const m = out.raw, calls = Array.isArray(m.tool_calls) ? m.tool_calls.filter(c => c && c.function).map(c => {
        let args = c.function.arguments; try {args = JSON.parse(args || '{}')} catch {} // a string that is not JSON stays a string; cleanArgs rejects it
        return {function: {name: c.function.name, arguments: args}}}) : [];
      return {message: {role: 'assistant', content: m.content || '', ...(calls.length ? {tool_calls: calls} : {})}, usage: out.usage, model: out.model, ms: out.ms, done: out.finish};
    },
  };

  function finish(j, mdl, t0, structured) {
    const ch = j && Array.isArray(j.choices) ? j.choices[0] : null, m = ch && ch.message || {};
    const billed = j && j.model || mdl, u = j && j.usage || {};
    const inTok = +u.prompt_tokens || 0, outTok = +u.completion_tokens || 0, c = free ? 0 : costOf(billed, inTok, outTok) ?? costOf(mdl, inTok, outTok);
    const usage = {in: inTok, out: outTok, cost: c ?? 0, costKnown: c != null, ...(c == null ? {costNote: 'unknown'} : {})};
    const text = typeof m.content === 'string' ? m.content : null;
    const out = {text, usage, model: billed, ms: Date.now() - t0, raw: m, finish: ch && ch.finish_reason || null};
    if (structured) {
      if (m.refusal) throw Object.assign(fail('model refused', {raw: m.refusal}), {result: out});
      if (out.finish === 'length') throw Object.assign(fail('reply cut off', {raw: text}), {result: out});
      if (out.finish === 'content_filter') throw Object.assign(fail('model refused (content filter)'), {result: out});
      if (!text) throw Object.assign(fail('no text in reply'), {result: out});
    } else if (m.refusal) throw Object.assign(fail('model refused', {raw: m.refusal}), {result: out});
    return out;
  }
}

// The agent loop's messages as OpenAI chat messages: tool_calls get ids and JSON-string arguments, and
// each following tool message answers the next unanswered id (a tool message with no call to answer
// becomes plain user text, so a trimmed history never sends an orphan).
export function toOpenAI(messages) {
  const out = [], pending = []; let n = 0;
  const flush = () => {while (pending.length) out.push({role: 'tool', tool_call_id: pending.shift(), content: '(not run)'})}; // calls cut short (the hero died mid-reply)
  for (const m of messages) {
    if (m.role !== 'tool') flush();
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls.map(c => {const id = 'call_' + (++n); pending.push(id);
        const a = c.function && c.function.arguments;
        return {id, type: 'function', function: {name: String(c.function && c.function.name || ''), arguments: typeof a === 'string' ? a : JSON.stringify(a || {})}}});
      out.push({role: 'assistant', content: m.content || null, tool_calls: calls});
    } else if (m.role === 'tool') {
      const id = pending.shift();
      out.push(id ? {role: 'tool', tool_call_id: id, content: String(m.content || '')} : {role: 'user', content: 'Result of ' + (m.tool_name || 'a tool') + ': ' + String(m.content || '')});
    } else out.push({role: m.role, content: m.content || ''});
  }
  return out;
}
