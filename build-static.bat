@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "RESTART_DEV="

call :kill_listen 3001 " so out/ can be replaced" ""
call :kill_listen 3000 " so the static build can finish" RESTART_DEV
call :kill_listen 3002 " so out/ can be replaced" ""
call :kill_listen 3443 " so out/ can be replaced" ""
call :kill_listen 13443 " so out/ can be replaced" ""

echo Previous out\ will be copied to out-backup\^<timestamp^>\ before it is replaced.
call npm run build:static
if errorlevel 1 (
  echo Static build failed. Previous out\ is unchanged unless a backup folder was already created.
  echo Dev server on :3000 and iPad LAN HTTPS were not started.
  pause
  exit /b 1
)
echo Static build finished. Port 3001 was not restarted.
echo Starting iPad LAN HTTPS on :3443 (CA page :3002) ...
echo iPad uses https://^<LAN IP^>:3443/ . Port 3000 is PC hot reload only.
echo If an old start-https-lan.bat window is waiting at pause, close that window.
start "MangaSketcher LAN" cmd /c ""%~dp0start-https-lan.bat""

set /a WAITED=0
:wait_lan_up
netstat -ano | findstr /C:":3443 " | findstr "LISTENING" >nul
if errorlevel 1 (
  if !WAITED! geq 60 (
    echo Timed out waiting for port 3443 to listen. Continuing anyway.
    goto after_lan
  )
  timeout /t 1 /nobreak >nul
  set /a WAITED+=1
  goto wait_lan_up
)
:after_lan

if defined RESTART_DEV (
  echo Restarting the dev server on :3000 ...
  echo If the old start-dev.bat window is waiting at pause, close that window. This new window is the server.
  start "MangaSketcher dev" cmd /c ""%~dp0start-dev.bat""
)
pause
endlocal
exit /b 0

:kill_listen
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /C:":%~1 " ^| findstr "LISTENING"') do (
  set "KILL_PID="
  for %%P in (%%L) do set "KILL_PID=%%P"
  echo Port %~1 is in use. Stopping PID !KILL_PID!%~2 ...
  taskkill /F /PID !KILL_PID!
  if not errorlevel 1 if not "%~3"=="" set "%~3=1"
)
goto :eof
