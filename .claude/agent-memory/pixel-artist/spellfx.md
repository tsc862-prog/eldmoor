---
name: spell-effects
description: How move effects (#374) flow sim -> render, why render keeps its own real-time pool, and how to stage them for screenshots
metadata:
  type: project
---
- useMove pushes one `S.fx` `{type:'spell', id, kind, x,y, ex,ey, r, pts}`; render/spellfx.js copies it into its own pool
  and plays it in real time, because sim `life` drains with game dt (8x would make effects a single frame).
- **Why:** owner asked each ability to look distinct (2026-11-02); seeded hashes must not move, so the sim side never rolls dice.
- **How to apply:** a new move needs an `FX[id]` entry (else its kind fallback shows). To stage a shot, push the S.fx entry
  by hand and set `spellDebug.freeze=t` (import '/src/render/spellfx.js'); unfreeze and wait ~1.7 s before the next one.
  Eldmoor has few open meadow spots; 5,18 is a clear 7x5 grass patch near Highgate for staging. See [[previews]].
- A `// comment` dropped mid-line in minified-style code silently ate the rest of the line once; run
  `node --input-type=module --check < file` after python edits.
