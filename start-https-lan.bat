@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

for /f "tokens=*" %%L in ('netstat -ano ^| findstr /C:":3002 " ^| findstr "LISTENING"') do (
  set "KILL_PID="
  for %%P in (%%L) do set "KILL_PID=%%P"
  echo Port 3002 is in use. Stopping PID !KILL_PID! ...
  taskkill /F /PID !KILL_PID!
)
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /C:":3443 " ^| findstr "LISTENING"') do (
  set "KILL_PID="
  for %%P in (%%L) do set "KILL_PID=%%P"
  echo Port 3443 is in use. Stopping PID !KILL_PID! ...
  taskkill /F /PID !KILL_PID!
)
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /C:":13443 " ^| findstr "LISTENING"') do (
  set "KILL_PID="
  for %%P in (%%L) do set "KILL_PID=%%P"
  echo Port 13443 is in use. Stopping PID !KILL_PID! ...
  taskkill /F /PID !KILL_PID!
)

set /a WAITED=0
:wait_lan_free
set "BUSY="
netstat -ano | findstr /C:":3002 " | findstr "LISTENING" >nul
if not errorlevel 1 set "BUSY=1"
netstat -ano | findstr /C:":3443 " | findstr "LISTENING" >nul
if not errorlevel 1 set "BUSY=1"
netstat -ano | findstr /C:":13443 " | findstr "LISTENING" >nul
if not errorlevel 1 set "BUSY=1"
if defined BUSY (
  if !WAITED! geq 30 (
    echo Timed out waiting for LAN ports 3002/3443/13443 to be free.
    pause
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  set /a WAITED+=1
  goto wait_lan_free
)

call npm run start:https-lan
echo.
pause
endlocal
