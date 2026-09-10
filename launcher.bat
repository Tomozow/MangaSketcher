@echo off
cd /d "%~dp0"
if not exist "%~dp0scripts\launcher.ps1" (
  echo Missing scripts\launcher.ps1
  pause
  exit /b 1
)
start "MangaSketcherLauncher" powershell.exe -NoProfile -NoLogo -STA -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1"
if errorlevel 1 (
  echo Failed to start powershell.exe
  pause
  exit /b 1
)
