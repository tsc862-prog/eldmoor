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
