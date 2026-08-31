@echo off
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  echo Port 3001 is in use. Stopping PID %%a so out/ can be replaced ...
  taskkill /F /PID %%a >nul 2>&1
)
npm run build:static
pause
