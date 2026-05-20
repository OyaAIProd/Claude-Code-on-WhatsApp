@echo off
chcp 65001 >nul 2>&1
title Claude Code on WhatsApp - Running
cd /d "%~dp0"

echo.
echo ============================================
echo   Claude Code on WhatsApp - Starting
echo ============================================
echo.
echo Dashboard (kebuka otomatis sebentar lagi):
echo   - Admin  : http://localhost:3458
echo   - Futsal : http://localhost:3457
echo.
echo SCAN QR WhatsApp yang muncul di bawah (cukup sekali).
echo Tekan Ctrl+C untuk stop semua.
echo.

REM Buka 2 dashboard di browser setelah service start (delay 10s)
start "" /b cmd /c "timeout /t 10 /nobreak >nul 2>&1 && start """" http://localhost:3458 && start """" http://localhost:3457"

REM Jalanin semua service
node launch.js

REM Kalau launch.js exit (error/stop), JANGAN auto-close window
echo.
echo ============================================
echo   Service berhenti.
echo ============================================
echo Cek pesan error di atas kalau ada masalah.
echo.
pause
