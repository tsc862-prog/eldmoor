---
name: standing-orders
description: #531 hero standing orders by situation - scripts/orders.mjs blocks, full vs short local variant, migration, orderscheck
metadata:
  type: project
---

Hero orders by situation live in `scripts/orders.mjs` (`ORDERS_FULL`, `ORDERS_SHORT` 905 chars, budget `SHORT_BUDGET` 1200), between `ORDERS_HEAD` and `ORDERS_TAIL`. `systemPrompt` appends the full block; `withSituationOrders(sys, local)` swaps or adds it (before a `YOUR PERSONA` block if present), called after the runner's provider is known in agent-player.mjs and fellowship.mjs (ollama gets the short one). Header rule "Trust the fresh header" is now the first How to play line. Intent tool does not exist: orders say "your stated aim".

**Why:** qwen2.5:14b had 482 refused calls in 472 turns; orders explained tools, not situations.
**How to apply:** change situation prose in orders.mjs only; `npm run orderscheck` asserts headings, priority, 3 examples, anti-patterns, short budget, tool names exist, persona markers survive. The 30-minute live qwen refusal comparison from the issue was not run.
