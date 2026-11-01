// Anthropic adapter (Mixed minds, issue #97): the relay's original model call, moved here unchanged in
// behaviour. Structured output through output_config.format (json_schema), thinking off ('disabled' on
// Haiku 5.5; Sonnet 5.5 rejects that, so it gets 'between_tools' plus the server-side refusal fallback
// through the beta namespace), effort low, no retries, hard abort.
// Model ids and prices come from the claude-api skill (cached 2026-10-06).
//
// Adapter interface shared by every provider in scripts/providers/:
//   {name, local, configured(), status() -> Promise<{ok, models, default?, error?}>,
//    call({system, user, schema, maxTokens, model, effort, signal, timeoutMs}) -> Promise<{json, text, usage:{in,out,cost}, model, ms}>}
// call() throws an Error on any failure; err.raw carries the model's text when there was some.

export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const PRICES = {'claude-haiku-5-5': {in: 0.10, out: 0.50}, 'claude-sonnet-5-5': {in: 2, out: 10}, 'claude-opus-5-5': {in: 4, out: 20}}; // $ per 1M tokens
export const costOf = (model, inTok, outTok) => {const p = PRICES[model]; return p ? (inTok * p.in + outTok * p.out) / 1e6 : 0};

const fail = (msg, raw) => Object.assign(new Error(msg), raw != null ? {raw} : {});

// client: the @anthropic-ai/sdk client (or a fake with messages.create in tests); null when no key.
export function anthropicAdapter({client = null, defaultModel = DEFAULT_MODEL} = {}) {
  return {
    name: 'anthropic', local: false, defaultModel,
    configured: () => !!client,
    status: async () => client ? {ok: true, models: Object.keys(PRICES), default: defaultModel} : {ok: false, models: [], error: 'no ANTHROPIC_API_KEY'},
    async call({system, user, schema, maxTokens, model, effort = 'low', signal, timeoutMs}) {
      if (!client) throw fail('anthropic is not configured (no ANTHROPIC_API_KEY)');
      const mdl = model || defaultModel, t0 = Date.now();
      const req = {
        model: mdl, max_tokens: maxTokens,
        system,
        thinking: {type: 'disabled'},
        output_config: {effort, format: {type: 'json_schema', schema}},
        messages: [{role: 'user', content: user}],
      };
      let call = client.messages;
      if (mdl.startsWith('claude-sonnet-5-5')) {
        // Sonnet 5.5 rejects thinking 'disabled'; 'between_tools' is its no-extended-thinking setting (effort high or
        // below). Server-side refusal fallback ("default" form, Claude API only) through the beta namespace when present.
        req.thinking = {type: 'between_tools'};
        if (client.beta && client.beta.messages) {call = client.beta.messages; req.betas = ['server-side-fallback-2026-07-01']; req.fallbacks = 'default'}
      }
      const res = await call.create(req, {signal, timeout: timeoutMs, maxRetries: 0});
      const billed = res.model && PRICES[res.model] ? res.model : mdl;
      const u = res.usage || {}, usage = {in: u.input_tokens || 0, out: u.output_tokens || 0, cost: costOf(billed, u.input_tokens || 0, u.output_tokens || 0)};
      const block = (res.content || []).find(b => b.type === 'text'), text = block ? block.text : null;
      const out = {text, usage, model: billed, ms: Date.now() - t0};
      if (res.stop_reason === 'refusal') throw Object.assign(fail('model refused', text), {result: out});
      if (res.stop_reason === 'max_tokens') throw Object.assign(fail('reply cut off', text), {result: out});
      if (!block) throw Object.assign(fail('no text in reply'), {result: out});
      return out;
    },
  };
}
