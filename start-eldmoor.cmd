@echo off
rem Eldmoor launcher for Windows: double-click to start everything in this one window: the brain relay (with app
rem runners on, and the runners of the last run resumed) and the game's dev server, then open the game.
rem   u = update (git pull --ff-only, npm install if needed, restart the relay)   r = restart the relay
rem   s = status   h = help   q or Ctrl+C = quit (runners stop cleanly first)
rem Closing the window also stops everything. The work is in scripts\up.mjs (npm run up does the same).
rem Already running? It says which port is taken: close the old windows (or press q in the old launcher) first.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not on PATH: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing packages once...
  call npm.cmd install || (pause & exit /b 1)
)
node scripts\up.mjs %*
if errorlevel 1 pause
