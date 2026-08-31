@echo off
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3002" ^| findstr "LISTENING"') do (
  echo Port 3002 is in use. Stopping PID %%a ...
  taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3443" ^| findstr "LISTENING"') do (
  echo Port 3443 is in use. Stopping PID %%a ...
  taskkill /F /PID %%a >nul 2>&1
)
npm run start:https-lan
pause
