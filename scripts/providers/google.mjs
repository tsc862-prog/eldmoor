// Google (Gemini) adapter stub (Mixed minds, issue #97). Not built yet: Ollama came first.
// TODO(#97): POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent with
//   generationConfig {responseMimeType:'application/json', a response schema}, systemInstruction for the
//   system prompt, the key in a header (GOOGLE_API_KEY), usage from usageMetadata, prices checked against
//   Google's current list (never from memory), a token-limit finish -> 'reply cut off', a safety finish ->
//   'model refused'. Check the request shape against Google's current docs before building it.
// Interface: see anthropic.mjs.
export function googleAdapter({apiKey = null} = {}) {
  return {
    name: 'google', local: false, defaultModel: null,
    configured: () => !!apiKey,
    status: async () => ({ok: false, models: [], error: apiKey ? 'adapter not built yet (#97)' : 'not configured (no GOOGLE_API_KEY)'}),
    async call() {throw new Error(apiKey ? 'google adapter not built yet (#97)' : 'google is not configured (no GOOGLE_API_KEY)')},
  };
}
