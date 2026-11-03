@echo off
rem Eldmoor daily art run (#177): registers a Windows Task Scheduler task that runs "npm run art:daily" once a day
rem from this checkout, as the current user, only while logged on. Output goes to logs\art-task.log; the run's
rem own one-line summary goes to logs\art.log (the launcher's "s" shows the last line).
rem   scripts\art\schedule.cmd            daily at 09:00
rem   scripts\art\schedule.cmd 07:30      daily at 07:30
rem   scripts\art\schedule.cmd /delete    remove the task
rem   scripts\art\schedule.cmd /run       run the task now (same as npm run art:daily -- --now, but through the task)
setlocal
for %%I in ("%~dp0..\..") do set "REPO=%%~fI"
set "TASK=Eldmoor art daily"
set "AT=%~1"
if /I "%AT%"=="/delete" (schtasks /Delete /F /TN "%TASK%" & exit /b %ERRORLEVEL%)
if /I "%AT%"=="/run" (schtasks /Run /TN "%TASK%" & exit /b %ERRORLEVEL%)
if "%AT%"=="" set "AT=09:00"
schtasks /Create /F /SC DAILY /ST %AT% /TN "%TASK%" /TR "cmd /c cd /d \"%REPO%\" && (if not exist logs mkdir logs) && npm run art:daily >> logs\art-task.log 2>&1"
if errorlevel 1 exit /b 1
echo Registered "%TASK%": daily at %AT% in %REPO%. Remove with: scripts\art\schedule.cmd /delete
