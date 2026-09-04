@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

for %%P in (3001 13443) do (
  for /f "tokens=*" %%L in ('netstat -ano ^| findstr /C:":%%P " ^| findstr "LISTENING"') do (
    set "KILL_PID="
    for %%X in (%%L) do set "KILL_PID=%%X"
    echo Port %%P is in use. Stopping PID !KILL_PID! ...
    taskkill /F /PID !KILL_PID!
  )
)

echo Starting latest out\ on http://127.0.0.1:3001/ then waiting for commands.
echo Type list, a number, or out-backup\^<stamp^> to switch. quit to stop.
call node scripts/static-host/start.mjs --chrome
echo.
pause
endlocal
