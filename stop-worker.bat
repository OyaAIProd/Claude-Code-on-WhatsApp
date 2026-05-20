@echo off
cd /d "%~dp0"
if not exist data\worker.pid (
  echo Worker tidak running.
  exit /b 0
)
set /p WPID=<data\worker.pid
echo Stopping worker PID %WPID%...
taskkill /PID %WPID% /F >nul 2>&1
del /q data\worker.pid >nul 2>&1
echo Worker stopped.
