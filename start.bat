@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Starting Claude Code Personal OS...
echo.
echo Dashboard akan otomatis kebuka di browser.
echo Tekan Ctrl+C untuk stop.
echo.

REM Buka browser ke admin dashboard setelah 8 detik (kasih waktu service start)
start /b cmd /c "timeout /t 8 /nobreak >nul && start http://localhost:3458"

REM Launch all services via launch.js
node launch.js
