@echo off
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  echo Port 3001 is in use. Stopping PID %%a so out/ can be replaced ...
  taskkill /F /PID %%a >nul 2>&1
)
echo Previous out\ will be copied to out-backup\^<timestamp^>\ before it is replaced.
npm run build:static
if errorlevel 1 (
  echo Static build failed. Previous out\ is unchanged unless a backup folder was already created.
  pause
  exit /b 1
)
echo Static build finished. Serve with start-static.bat or npm run start:https-lan
pause
