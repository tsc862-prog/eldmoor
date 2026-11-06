---
name: lazy-tools
description: #808 AGENT_LAZY_TOOLS: how CLI tool search is switched on, what the mock must do, prompt-size figures, what a live test still has to show
metadata:
  type: project
---

`scripts/lazy-tools.mjs`, off unless `AGENT_LAZY_TOOLS=1`; hero and company Claude runners only. PR #924. Not yet tried on the real API.

**Verified on SDK 0.3.316 / CLI 2.1.316 (mock API, sessioncheck section 2c):**
- `tools: []` is why all schemas ride: it keeps ToolSearch out, even with ENABLE_TOOL_SEARCH=true. `tools: ['ToolSearch']` alone defers all MCP tools, also against a custom base URL and on Haiku and Sonnet ids.
- `_meta {'anthropic/alwaysLoad': true}` on an http MCP server's tools/list is honoured per tool. Registered through `registerTool` config `_meta` (MCP SDK 1.32.2).
- A deferred tool is NOT in the request at all until looked up; then it is sent with `defer_loading: true`. So measure the non-deferred schemas, not the body. `DeferredToolPlaceholder` (deferred) always rides; the DM's list shows it too (sent = loaded + 1), harmless.
- Names go in a system-role message in `messages`, once a session, not repeated on resume. `select:shop` works with the short name; keywords work.
- A direct call of an unloaded tool still runs (the prompt tells the model it will fail, so expect a lookup instead).
- A 400 naming defer_loading: the CLI retries without deferred tools and stays so for the process (mock: 3 refused, then all 107 sent). The turn survives; `ctx` would show no drop.
- CLI text: "this conversation has run without ToolSearch, and stays so until compacted or cleared. ENABLE_TOOL_SEARCH=true overrides this", hence the pin. We also roll on a switch change (`sess.lazyTools`, `rollDue {lazy}`), since an API with history of both shapes is unverified.

**Figures:** schemas 75,689 -> 37,819 chars, names list +1,638, net about 10.1k tokens by chars/3.6 (an estimate; the same ratio reads the full list as 21k, #808 said 17k). 51 kept of 107: finish, spare, accept and decline are kept on purpose (coordinator on #924: a hero who does not see a moral choice will not make it, and zero logged uses may be why), so never defer a choice on low use alone. Replay of 808 logged hero turns: 1.9% of calls cold, about 0.10 lookups a turn with 8-turn sessions.

**Why:** cache reads are 70% of hero spend, and the fixed prefix rides every call. **How to apply:** a live test reads the report's Tool loading table (prompt floor drop near 10k, lookups under 0.3 a turn, no used tool going unused), one Haiku turn first, then 3+ hours. Dollars need hours to rise above noise; the floor does not.

**Pitfalls:** the warm-up call has no tools, so mock plans must skip it and checks filter on `c.tool`. `askFresh` in section 1 makes every new session object roll: use a seen object in later rollDue tests. Bash heredocs eat backslashes; write edit scripts with Write. Never sed with `\|` in a BRE pattern (it is alternation: it ate the whole check file).

See [[session-size]], [[agent-player]].
