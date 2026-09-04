@echo off
cd /d "%~dp0"
start "MangaSketcher" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1"
