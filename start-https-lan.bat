@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

for %%P in (3001 3002 3443 13443) do (
  for /f "tokens=*" %%L in ('netstat -ano ^| findstr /C:":%%P " ^| findstr "LISTENING"') do (
    set "KILL_PID="
    for %%X in (%%L) do set "KILL_PID=%%X"
    echo Port %%P is in use. Stopping PID !KILL_PID! ...
    taskkill /F /PID !KILL_PID!
  )
)

set /a WAITED=0
:wait_lan_free
set "BUSY="
for %%P in (3001 3002 3443 13443) do (
  netstat -ano | findstr /C:":%%P " | findstr "LISTENING" >nul
  if not errorlevel 1 set "BUSY=1"
)
if defined BUSY (
  if !WAITED! geq 30 (
    echo Timed out waiting for ports 3001/3002/3443/13443 to be free.
    pause
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  set /a WAITED+=1
  goto wait_lan_free
)

echo Starting latest out\ (PC :3001, iPad :3443). Then type commands to switch backups.
echo After a switch, reopen the iPad home-screen icon.
call node scripts/static-host/start.mjs --lan
echo.
pause
endlocal
