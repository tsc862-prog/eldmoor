---
name: Looking at the world view
description: How to get real screenshots of the map from a worktree (vite watcher gotcha, headless Chrome over CDP)
type: project
---
- The repo's vite.config ignores `**/.claude/**`, and agent worktrees live under `.claude/worktrees/`, so a plain
  `npx vite --port 5183` in a worktree serves STALE modules after edits. Use a scratch config with
  `root: <worktree>` and `server.watch.ignored: ['**/node_modules/**','**/dist/**']`, port 5183 strictPort.
- The server listens on `localhost` (::1); use `http://localhost:5183/`, not 127.0.0.1.
- Headless Chrome must be started from PowerShell (`Start-Process chrome.exe --headless=new
  --remote-debugging-port=9333 --user-data-dir=<fresh dir>`); spawning it from the Bash tool fails silently.
- Drive it with Node 22's global WebSocket over CDP: navigate, then `Runtime.evaluate` with
  `await import('/src/render/draw.js')` (same module instance as the page) to `setZoom(z)` and set
  `cam.camX/camY` (world px = tiles*16); `import('/src/sim/index.js')` to `step()` a warm-up and set
  `S.gameMin` for the hour; `import('/src/ui/controls.js')` for `ctl.speed=0`, `select`, `setView('follow')`.
  Hide `#setup` (fresh profiles open the New World page) and `.ralert` (world-held banner).
  Clip `Page.captureScreenshot` to `#screen`'s rect. A fresh `--user-data-dir` per run avoids restoring a save.
- Never touch the owner's 5173 / 8787. Only kill a process after checking its command line is yours.
- After editing a module while the dev server runs, the page re-imports it as `?t=...`, so a CDP
  `import('/src/render/draw.js')` gets a different instance and setZoom/cam do nothing. Restart your own vite
  before capturing; find it by pid from a separate step (a kill filter matching a word in the same command
  line also kills the shell running it).
- Chrome can be spawned from a Node script too (`spawn(chrome.exe, ['--headless=new', '--remote-debugging-port=...'])`);
  never pipe that script into `head` (EPIPE leaves Chrome running).
- `?continue=1` on a fresh profile boots a new world in Follow Fellowship; call `ui/controls.js` `setView('map')`
  before `setZoom`, or the follow camera overrides it.
