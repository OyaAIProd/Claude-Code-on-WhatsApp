@echo off
echo Stopping all Node processes for Claude Code OS...
taskkill /F /IM node.exe >nul 2>&1
echo Done.
timeout /t 2 /nobreak >nul
