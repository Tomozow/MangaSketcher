@echo off
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo Port 3000 is in use. Stopping PID %%a ...
  taskkill /F /PID %%a >nul 2>&1
)
npm run dev
pause
