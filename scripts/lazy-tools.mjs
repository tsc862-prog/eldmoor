// Lazy tools (issue #808, cost lever): every hero tool schema rides in every Claude call, about 17k tokens of a prompt that is resent
// each call. AGENT_LAZY_TOOLS=1 keeps the tools below in the prompt and defers the rest behind the CLI's ToolSearch: a deferred
// tool stays a tool (no tool is removed, the owner's rule); its name is listed, its schema comes when the hero looks it up. Off by
// default, and off is the old request as it was. Hero and company Claude runners only: the DM, local and OpenAI-style minds never
// come here, and the forced scene answers (scripts/pacing.mjs) do not use the session's tools at all.
//
// How it works, read on SDK 0.3.316 / CLI 2.1.316 and proved by `npm run sessioncheck`:
//   tools: []             is what keeps ToolSearch out: with no ToolSearch the CLI sends every schema, whatever else is set.
//   tools: ['ToolSearch'] turns deferral on. MCP tools are deferred, except those the server lists with _meta anthropic/alwaysLoad.
//   ?lazy=1 on /mcp       asks the relay for that _meta; without it tools/list is what it always was.
//   ENABLE_TOOL_SEARCH    pinned 'true': the CLI otherwise keeps a conversation that ran without ToolSearch without it.
// The roll (scripts/session-roll.mjs) starts a fresh session when the switch changed, so no session carries both tool shapes.
//
// Plain Node, no SDK import.
export const SEARCH_TOOL = 'ToolSearch', ALWAYS_LOAD_META = 'anthropic/alwaysLoad';

// The hero tools that stay in the prompt. A new tool not listed here is deferred and still found (the tool map names it). The groups
// say why; `npm run sessioncheck` fails on a name that is not a tool or on a missing must-have.
export const LAZY_GROUPS = {
  // most used: 97% of the 8846 hero tool calls in logs/behavior/eldmoor/turns.jsonl up to 2026-11-05
  used: ['wait', 'scene_act', 'party_say', 'move_to', 'intent', 'journal_write', 'look', 'status', 'remember', 'talk', 'party_read', 'hunt', 'rest', 'propose', 'say', 'vote', 'fight', 'journal_read', 'lead_to', 'list_jobs', 'flee', 'companions', 'take_adventure', 'follow', 'lore'],
  // who the hero is, what it swore and what it remembers: rarely called, never to be a hurdle (the owner's rule on personality and story)
  story: ['self', 'become', 'swear_oath', 'keep_oath', 'renounce_oath', 'journal_search', 'recall', 'update_memory', 'forget', 'pin', 'attempt', 'emote', 'whisper', 'chat_read'],
  // a scene, a fight or a clock that cannot wait for a lookup
  scene: ['use_ability', 'use_item', 'choose', 'answer_challenge', 'break_camp', 'stabilize', 'tend', 'carry'],
};
export const ALWAYS_LOAD = Object.values(LAZY_GROUPS).flat();
const always = new Set(ALWAYS_LOAD);

export const lazyOn = (env = {}) => /^(1|true|yes|on)$/i.test(String(env.AGENT_LAZY_TOOLS ?? '').trim());
// The _meta of one tool for /mcp?lazy=1, undefined for a deferred one.
export const lazyMeta = name => always.has(name) ? {[ALWAYS_LOAD_META]: true} : undefined;
// What query() is given for a hero's tools. Off: the options as they always were.
export const toolOptions = (lazy, url) => lazy ? {url: url + '&lazy=1', tools: [SEARCH_TOOL], allowedTools: ['mcp__eldmoor', SEARCH_TOOL]} : {url, tools: [], allowedTools: ['mcp__eldmoor']};
export function withLazyEnv(childEnv, lazy) {if (lazy) childEnv.ENABLE_TOOL_SEARCH = 'true'; return childEnv}
// Noted on a session as it starts (only when on, so a session file with the switch off is as it was).
export function markLazy(sess, lazy) {if (lazy) sess.lazyTools = true; else delete sess.lazyTools}
export const lazyLine = total => `[tools] lazy loading on: ${ALWAYS_LOAD.length} in the prompt, ${total - ALWAYS_LOAD.length} found with ${SEARCH_TOOL}`;
// A turn's use of ToolSearch, from the tool names on the turn line.
export const searchCount = tools => (tools || []).filter(t => t && t.name === SEARCH_TOOL).length;
// The turn record's part: only with the switch on, so a line with it off is as it was.
export const lazyRec = (lazy, tools) => lazy ? {toolSearch: searchCount(tools)} : {};
