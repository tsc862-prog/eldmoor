---
name: agent-tab-polish
description: #136 UI rules - one mind label (ui/mindlabel.js), day stamps, log action sources, runner-stop alert, Table chime
metadata:
  type: project
---

- One mind label comes from `mindLabel(a)` in `src/ui/mindlabel.js` (Scripted / AI (model) / Agent (model · live|waiting|no runner|Ollama busy)). Every view (header, Minds, frames, mind row, agent tab) must call it; never write a new label string. Chat lines carry `e.model='Agent (<model>)'` set in sim/chat.js `agentLine`.
- Ollama busy = runner provider ollama and its pace/last log line matches "busy or loading" (`ollamaBusy` in runners.js).
- History entries carry `d` (day) and `src` via `record()`; `asSrc('reflex', fn)` forces a source. Agent tool calls run under `asSrc('agent')`, flee/fightAid reflexes under `'reflex'`. No RNG, sim unchanged.
- Runner-stop alert (`ui/runalert.js`): only Fellowship members' hero runners, the Fellowship runner and the DM pause the world; a Stop pressed in the page (`userStop` in runners.js, cleared by startRunner) only leaves a note.
- Why: owner wants agent-played heroes never shown as scripted and no silent runner death during a Fellowship session.
