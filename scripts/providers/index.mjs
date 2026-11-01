// Provider registry for the relay (Mixed minds, issue #97). One adapter per provider, one interface
// (see anthropic.mjs). makeProviders() builds the set from the environment; tests pass their own.
//   PROVIDERS        the provider names the relay accepts in a request, in display order
//   isLocal(name)    a local provider: no cost, longer timeouts
import {anthropicAdapter} from './anthropic.mjs';
import {ollamaAdapter, OLLAMA_URL, OLLAMA_MODEL} from './ollama.mjs';
import {openaiAdapter} from './openai.mjs';
import {googleAdapter} from './google.mjs';
export {anthropicAdapter, ollamaAdapter, openaiAdapter, googleAdapter, OLLAMA_URL, OLLAMA_MODEL};
export {DEFAULT_MODEL, PRICES, costOf} from './anthropic.mjs';

export const PROVIDERS = ['anthropic', 'ollama', 'openai', 'google'];
export const LOCAL = new Set(['ollama']);
export const isLocal = name => LOCAL.has(name);
// A model name the relay passes on: Claude ids, Ollama tags (qwen2.5:14b, library/x:latest, hf.co/u/m:Q4_K_M).
export const MODEL_RE = /^[A-Za-z0-9][\w.:\/+-]{0,99}$/;

// Parse a reply's text as JSON, or null.
export const tryJson = t => {if (typeof t !== 'string') return null; try {return JSON.parse(t)} catch {return null}};

export function makeProviders({anthropicClient = null, model, env = process.env, fetchImpl = globalThis.fetch} = {}) {
  return {
    anthropic: anthropicAdapter({client: anthropicClient, ...(model ? {defaultModel: model} : {})}),
    ollama: ollamaAdapter({url: env.OLLAMA_URL || OLLAMA_URL, defaultModel: env.OLLAMA_MODEL || OLLAMA_MODEL, fetchImpl}),
    openai: openaiAdapter({apiKey: env.OPENAI_API_KEY || null}),
    google: googleAdapter({apiKey: env.GOOGLE_API_KEY || null}),
  };
}
