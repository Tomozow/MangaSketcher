@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

for /f "tokens=*" %%L in ('netstat -ano ^| findstr /C:":3000 " ^| findstr "LISTENING"') do (
  set "KILL_PID="
  for %%P in (%%L) do set "KILL_PID=%%P"
  echo Port 3000 is in use. Stopping PID !KILL_PID! ...
  taskkill /F /PID !KILL_PID!
)

set /a WAITED=0
:wait3000
netstat -ano | findstr /C:":3000 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  if !WAITED! geq 30 (
    echo Timed out waiting for port 3000 to be free.
    pause
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  set /a WAITED+=1
  goto wait3000
)

node scripts\start-dev.mjs
echo.
pause
endlocal
