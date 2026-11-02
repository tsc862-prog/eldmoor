---
name: own-persona
description: #409 agent-built personality - self/become tools, persona fields and limits, authorship markers, header line and standing-order block protocol, reflection become object, pitfalls
metadata:
  type: project
---

Built 2026-11-02 on branch brain/self-persona (closes #409). Owner direction: agents get as many tools as possible to choose their own adventure; `become` is permissive with helpful refusals.

- **Tools** (`src/sim/persona.js` selfView/become; wrappers in player.js; act:false like remember, so they never eat the per-hour action rate or reset autopilot):
  - `self`: who_you_are line, the 5 persona fields, beliefs, traits, stances (companions: effective memory line), people (views), backstory, fixed pins, changes_today, can_change_now, recent_changes, how.
  - `become {field, text, why, about?, op?}`: no enum on field/op in the tool table (aliases pass MCP zod), why required, text over its cap is cut with a note, traits add/drop/set (cap 6, the oldest fades), beliefs op add keeps the newest within 300.
- **Limits:** SELF.PER_DAY 3 a game day, one per field, a stance per person (key `stance:<id>` or `stance:p:<name>`); HIST 40.
- **Markers:**
  - `by[field]='self'` and `stanceBy[id]='self'`: authoredStance counts 'self'; applyPersona skips those fields; fellowship `written()` counts selfN; `sheets()` uses keepSelf.
  - `pins[field]` is the owner's lock (sheet checkbox data-fpin; 'stance' covers all).
  - Persons who are not heroes go to `views[lowercase] = {name, line}`.
- **Protocol:**
  - The brief carries `persona` (one line, max 260 chars) and `personaV` (djb2 signature).
  - `/play/pace {brief:true, self:true}` adds `brief.self`; the relay passes `self` through.
  - pacing.mjs: `personaNote` sits inside memoryNote, so it appears in every header and in Claude reflection prompts.
  - `withPersona` replaces the block from `\nYOUR PERSONA` to `(end of your persona)`.
  - `refreshPersona(pacer, sess, b0)` runs before each Claude turn in agent-player and fellowship. Local runners get only the header line.
- **Reflection:**
  - The schema has a `become` object `{field (enum incl. none), text, why, about}`: required in strict (OpenAI), optional for Ollama.
  - reflectBecome parses it, and reflectTurn calls become after the remembers (stat.became).
  - The Claude reflectPrompt adds BECOME_ASK.
- **Pitfall:** in the Bash tool, `\\n` inside a heredoc becomes a real newline in the file, which broke a regex and template strings. Use the Edit tool for any text that contains backslashes.
- **Proving "unchanged":** origin/main moved during the work. Compare `professioncheck --hash` against the merge-base archive, not origin/main. The base hashes were 4011902237 / 2225542050.

Related: [[reflection-moments]], [[agent-memories]], [[tool-quickwins-c]].
