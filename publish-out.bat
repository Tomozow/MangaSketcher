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

set "STAGING=.publish-staging"
set "DEST=publish"
echo Stopping LAN host if it is using publish\ ...
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

if exist "%STAGING%" (
  rd /s /q "%STAGING%"
  if exist "%STAGING%" (
    echo Could not remove %STAGING%. Close Explorer and retry.
    if not defined NO_PAUSE pause
    exit /b 1
  )
)

echo Staging a clean payload in %STAGING%\ ...
mkdir "%STAGING%\out" 2>nul
mkdir "%STAGING%\scripts\static-host" 2>nul

robocopy "out" "%STAGING%\out" /E /NFL /NDL /NJH /NJS /nc /ns /np
if errorlevel 8 (
  echo Copy of out\ failed. Close Chrome if MangaSketcher is open.
  if not defined NO_PAUSE pause
  exit /b 1
)

copy /Y "scripts\lanHttpsShared.mjs" "%STAGING%\scripts\lanHttpsShared.mjs" >nul
copy /Y "scripts\static-host\start.mjs" "%STAGING%\scripts\static-host\start.mjs" >nul
copy /Y "scripts\static-host\lan.mjs" "%STAGING%\scripts\static-host\lan.mjs" >nul
copy /Y "scripts\static-host\lanPackHub.mjs" "%STAGING%\scripts\static-host\lanPackHub.mjs" >nul
copy /Y "scripts\static-host\roots.mjs" "%STAGING%\scripts\static-host\roots.mjs" >nul
copy /Y "scripts\publish\start-all.bat" "%STAGING%\start-all.bat" >nul
copy /Y "scripts\publish\MangaSketcher.vbs" "%STAGING%\MangaSketcher.vbs" >nul
if errorlevel 1 (
  echo Copy of MangaSketcher launcher failed.
  if not defined NO_PAUSE pause
  exit /b 1
)
node scripts/publish/write-shortcut.mjs "%CD%\%STAGING%"
if errorlevel 1 (
  echo Could not write MangaSketcher.lnk / .ico
  if not defined NO_PAUSE pause
  exit /b 1
)

mkdir "%DEST%" 2>nul
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyMMdd"') do set "STAMP=%%I"
set "ZIP=%DEST%\MangaSketcher-!STAMP!.zip"
if exist "!ZIP!" del /q "!ZIP!"

echo Writing !ZIP! ...
tar.exe -C "%STAGING%" -a -c -f "!ZIP!" out scripts start-all.bat MangaSketcher.vbs MangaSketcher.ico MangaSketcher.lnk
if errorlevel 1 (
  echo Zip failed.
  if not defined NO_PAUSE pause
  exit /b 1
)

rd /s /q "%STAGING%"
if exist "%DEST%\app" rd /s /q "%DEST%\app"
if exist "%DEST%\MangaSketcher.lnk" del /q "%DEST%\MangaSketcher.lnk"

echo Done: %CD%\!ZIP!
echo Recipients: unzip, install Node.js, then double-click MangaSketcher.lnk
if not defined NO_PAUSE pause
endlocal
exit /b 0
