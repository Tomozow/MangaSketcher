@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if /I "%~1"=="nopause" (
  set "NO_PAUSE=1"
)

if not exist "out\index.html" (
  echo out\ is missing. Run a static build first.
  if not defined NO_PAUSE pause
  exit /b 1
)

set "DEST=publish"
set "PAYLOAD=%DEST%\app"
echo Stopping LAN host if it is using %DEST%\ ...
for %%P in (3001 3002 3443 13443) do (
  for /f "tokens=*" %%L in ('netstat -ano ^| findstr /C:":%%P " ^| findstr "LISTENING"') do (
    set "KILL_PID="
    for %%X in (%%L) do set "KILL_PID=%%X"
    echo Port %%P is in use. Stopping PID !KILL_PID! ...
    taskkill /F /PID !KILL_PID! >nul 2>&1
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
    echo Timed out waiting for ports 3001/3002/3443/13443. Close MangaSketcher and retry.
    if not defined NO_PAUSE pause
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  set /a WAITED+=1
  goto wait_lan_free
)

echo Writing %PAYLOAD%\ from out\ plus launcher files ...
mkdir "%PAYLOAD%\out" 2>nul
mkdir "%PAYLOAD%\scripts\static-host" 2>nul

robocopy "out" "%PAYLOAD%\out" /E /NFL /NDL /NJH /NJS /nc /ns /np
if errorlevel 8 (
  echo Copy of out\ failed. Close Chrome if MangaSketcher is open.
  if not defined NO_PAUSE pause
  exit /b 1
)

copy /Y "scripts\lanHttpsShared.mjs" "%PAYLOAD%\scripts\lanHttpsShared.mjs" >nul
copy /Y "scripts\static-host\start.mjs" "%PAYLOAD%\scripts\static-host\start.mjs" >nul
copy /Y "scripts\static-host\lan.mjs" "%PAYLOAD%\scripts\static-host\lan.mjs" >nul
copy /Y "scripts\static-host\lanPackHub.mjs" "%PAYLOAD%\scripts\static-host\lanPackHub.mjs" >nul
copy /Y "scripts\static-host\roots.mjs" "%PAYLOAD%\scripts\static-host\roots.mjs" >nul
copy /Y "scripts\publish\start-all.bat" "%PAYLOAD%\start-all.bat" >nul
copy /Y "scripts\publish\MangaSketcher.vbs" "%PAYLOAD%\MangaSketcher.vbs" >nul
if errorlevel 1 (
  echo Copy of MangaSketcher launcher failed.
  if not defined NO_PAUSE pause
  exit /b 1
)
node scripts/publish/write-shortcut.mjs "%CD%\%DEST%" "%CD%\%PAYLOAD%"
if errorlevel 1 (
  echo Could not write MangaSketcher.lnk / .ico
  if not defined NO_PAUSE pause
  exit /b 1
)

if exist "%DEST%" (
  for /d %%D in ("%DEST%\*") do (
    if /I not "%%~nxD"=="app" rd /s /q "%%D"
  )
  for %%F in ("%DEST%\*") do (
    if /I not "%%~nxF"=="MangaSketcher.lnk" del /q "%%F"
  )
)

echo Done: %CD%\%DEST%\MangaSketcher.lnk
echo Recipients: install Node.js, then double-click MangaSketcher.lnk
if not defined NO_PAUSE pause
endlocal
exit /b 0
