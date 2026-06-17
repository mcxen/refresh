@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-start.ps1"
if errorlevel 1 (
  echo.
  echo Refresh failed to start. See the messages above.
  pause
  exit /b 1
)
