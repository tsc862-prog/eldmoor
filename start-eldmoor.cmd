@echo off
rem Eldmoor launcher for Windows: double-click to start the brain relay (with app runners on, so the game
rem page can start and stop agent runners) and the game's dev server, each in its own window, then open the
rem game. Uses npm.cmd, so PowerShell's execution policy never matters. Close a window to stop that part;
rem closing the relay window also stops every runner it started.
rem Already running? A second relay or dev server cannot take the same port and says so in its window.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not on PATH: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing packages once...
  call npm.cmd install || (pause & exit /b 1)
)
start "Eldmoor relay (runners on)" cmd /k npm.cmd run relay -- --runners
start "Eldmoor game" cmd /k npm.cmd run dev
timeout /t 5 /nobreak >nul
start "" http://localhost:5173
