// OpenAI adapter stub (Mixed minds, issue #97). Not built yet: Ollama came first.
// TODO(#97): POST https://api.openai.com/v1/chat/completions with response_format
//   {type:'json_schema', json_schema:{name:kind, schema, strict:true}} (our schemas already set
//   additionalProperties:false and list every property as required), Authorization: Bearer OPENAI_API_KEY,
//   usage from usage.prompt_tokens / completion_tokens, a PRICES table checked against OpenAI's current
//   price list (never from memory), finish_reason 'length' -> 'reply cut off', a refusal field -> 'model refused'.
// Interface: see anthropic.mjs.
export function openaiAdapter({apiKey = null} = {}) {
  return {
    name: 'openai', local: false, defaultModel: null,
    configured: () => !!apiKey,
    status: async () => ({ok: false, models: [], error: apiKey ? 'adapter not built yet (#97)' : 'not configured (no OPENAI_API_KEY)'}),
    async call() {throw new Error(apiKey ? 'openai adapter not built yet (#97)' : 'openai is not configured (no OPENAI_API_KEY)')},
  };
}
