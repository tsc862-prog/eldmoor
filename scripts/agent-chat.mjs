// Start-up checks for an OpenAI agent runner (issue #97): scripts/agent-player.mjs and
// scripts/fellowship.mjs call openaiRunner() once per runner/member and get the adapter (its chat() is
// the tool-calling loop's model call, scripts/local-agent.mjs) or a message to show the owner.
// The key comes from the runner's environment/.env, as ANTHROPIC_API_KEY does for the Claude runner, and
// is passed to the adapter only: never printed, never in an argument.
import {openaiAdapter, hfAdapter, OPENAI_URL, HF_URL} from './providers/openai.mjs';

// rs: the hero's runner settings ({provider:'openai', model}); explicit: true when --model was given.
// Returns {adapter, model, note?} or {error}. Mutates rs.model (a saved Claude model is dropped).
export async function openaiRunner(rs, env, {explicit = false, fetchImpl = globalThis.fetch} = {}) {
  if (rs.provider === 'hf') return hfRunner(rs, env, {explicit, fetchImpl});
  if (!env.OPENAI_API_KEY) return {error: 'No OPENAI_API_KEY in the environment or .env (use --env FILE). Create a key at platform.openai.com/api-keys; API billing is separate from ChatGPT Plus.'};
  if (!explicit && rs.model && /^claude-/.test(rs.model)) rs.model = null; // a Claude model left over from the default provider
  rs.model = rs.model || env.OPENAI_MODEL || null; rs.effort = null;
  const adapter = openaiAdapter({apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL || OPENAI_URL, defaultModel: rs.model, fetchImpl});
  const s = await adapter.status();
  if (!s.ok && /bad or missing key/.test(s.error || '')) return {error: 'OpenAI refused the key (bad or missing key). Check OPENAI_API_KEY in .env.'};
  const list = s.ok ? s.models : [];
  if (!rs.model) return {error: 'No OpenAI model chosen. Pass --model <id> (or set OPENAI_MODEL in .env).' + (list.length ? ' Available to this key: ' + list.slice(0, 12).join(', ') + (list.length > 12 ? ', ...' : '') : '')};
  if (s.ok && list.length && !list.includes(rs.model)) return {error: `Model ${rs.model} is not in this key's model list. Available: ${list.slice(0, 12).join(', ')}${list.length > 12 ? ', ...' : ''}.`};
  return {adapter, model: rs.model, note: s.ok ? null : 'could not list models (' + s.error + '); trying anyway'};
}

// The Hugging Face router (issue #552): the same adapter and loop, HF_TOKEN from the environment/.env, the free
// allowance only (cost 0; an exhausted allowance is a refusal, never a charge). Same return as openaiRunner.
async function hfRunner(rs, env, {explicit, fetchImpl}) {
  if (!env.HF_TOKEN) return {error: 'No HF_TOKEN in the environment or .env (use --env FILE). Create a token at huggingface.co/settings/tokens (inference permission); only the free allowance is used.'};
  if (!explicit && rs.model && /^claude-/.test(rs.model)) rs.model = null;
  rs.model = rs.model || env.HF_MODEL || null; rs.effort = null;
  const adapter = hfAdapter({apiKey: env.HF_TOKEN, baseUrl: env.HF_BASE_URL || HF_URL, defaultModel: rs.model, fetchImpl});
  const s = await adapter.status();
  if (!s.ok && /bad or missing key/.test(s.error || '')) return {error: 'Hugging Face refused the token (bad or missing key). Check HF_TOKEN in .env.'};
  const list = s.ok ? s.models : [];
  if (!rs.model) return {error: 'No Hugging Face model chosen. Pass --model <id> (or set HF_MODEL in .env).' + (list.length ? ' Some available: ' + list.slice(0, 8).join(', ') + ', ...' : '')};
  return {adapter, model: rs.model, note: s.ok ? null : 'could not list models (' + s.error + '); trying anyway'};
}
