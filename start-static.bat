@echo off
setlocal EnableExtensions
cd /d "%~dp0"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  echo Port 3001 is in use. Stopping PID %%a ...
  taskkill /F /PID %%a >nul 2>&1
)

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

set "PROFILE=%~dp0.chrome-static-profile"
set "APP_URL=http://localhost:3001/"

echo Starting static server on %APP_URL%
start "MangaSketcher static" /min cmd /c "npm run start:static"

set /a WAITED=0
:wait_port
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if not errorlevel 1 goto open_chrome
set /a WAITED+=1
if %WAITED% lss 30 goto wait_port
echo Timed out waiting for port 3001.
goto after_chrome

:open_chrome
if not defined CHROME (
  echo Chrome was not found. Open %APP_URL% in a browser.
  goto after_chrome
)
if exist "%PROFILE%\Default\Service Worker" rmdir /s /q "%PROFILE%\Default\Service Worker"
if exist "%PROFILE%\Default\Cache" rmdir /s /q "%PROFILE%\Default\Cache"
if exist "%PROFILE%\Default\Code Cache" rmdir /s /q "%PROFILE%\Default\Code Cache"
echo Opening dedicated Chrome (no personal bookmarks / extensions^)
start "" "%CHROME%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-sync --disable-extensions --disable-default-apps --disable-http-cache --disable-features=ServiceWorker --app="%APP_URL%"

:after_chrome
echo.
echo Server: %APP_URL%
echo Close this window or press a key to stop the server.
pause
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
endlocal
