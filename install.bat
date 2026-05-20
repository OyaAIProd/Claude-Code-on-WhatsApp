@echo off
chcp 65001 >nul 2>&1
title Claude Code on WhatsApp - Installer
cd /d "%~dp0"
set "ROOT=%cd%"

echo.
echo ============================================
echo   Claude Code on WhatsApp - Installer
echo ============================================
echo.

REM ── Check Node.js ───────────────────────────────
echo [1/5] Cek Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [X] Node.js belum terinstall.
    echo   Buka: https://nodejs.org/en/download
    echo   Download LTS, install, lalu jalankan install.bat lagi.
    echo.
    start "" https://nodejs.org/en/download
    echo Tekan tombol apa saja untuk keluar...
    pause >nul
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo   [OK] Node.js %NODE_VER%
echo.

REM ── Check Claude Code CLI ───────────────────────
echo [2/5] Cek Claude Code CLI...
where claude >nul 2>nul
if errorlevel 1 (
    echo   Claude Code belum ada. Installing via npm...
    call npm install -g @anthropic-ai/claude-code
    if errorlevel 1 (
        echo   [X] Install gagal. Coba buka PowerShell as Administrator lalu:
        echo       npm install -g @anthropic-ai/claude-code
        echo.
        pause
        exit /b 1
    )
)
echo   [OK] Claude Code CLI
echo.

REM ── Install dependencies ────────────────────────
echo [3/5] Install dependencies (mungkin agak lama)...
for %%D in (whatsapp-bot telegram-bot futsal-mcp) do (
    if exist "%%D\package.json" (
        echo   - Installing %%D ...
        pushd "%%D"
        call npm install --no-audit --no-fund --loglevel=error
        popd
    )
)
if exist "package.json" (
    echo   - Installing root ...
    call npm install --no-audit --no-fund --loglevel=error
)
echo   [OK] Dependencies
echo.

REM ── Buat Desktop Shortcut ───────────────────────
echo [4/5] Buat shortcut di Desktop...
set "PSCMD=$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'Claude Code on WhatsApp.lnk')); $s.TargetPath='%ROOT%\start.bat'; $s.WorkingDirectory='%ROOT%'; $s.IconLocation='%SystemRoot%\System32\shell32.dll,13'; $s.Description='Start Claude Code on WhatsApp'; $s.Save()"
powershell -NoProfile -ExecutionPolicy Bypass -Command "%PSCMD%" >nul 2>&1
if exist "%USERPROFILE%\Desktop\Claude Code on WhatsApp.lnk" (
    echo   [OK] Shortcut dibuat di Desktop
) else (
    echo   [!] Shortcut gagal. Manual: double-click start.bat
)
echo.

REM ── Login Claude Code ───────────────────────────
echo [5/5] Login Claude Code...
echo   Bot pakai akun Claude.ai lo (subscription).
echo   Browser akan kebuka untuk login.
echo.
set /p "DOLOGIN=Login Claude sekarang? (Y/N): "
if /i "%DOLOGIN%"=="Y" (
    start "Claude Login" cmd /k "claude login"
    echo   Setelah login selesai di window baru, balik kesini.
    echo.
    pause
)

echo.
echo ============================================
echo   INSTALL SELESAI
echo ============================================
echo.
echo Langkah selanjutnya:
echo   1. Double-click "Claude Code on WhatsApp" di Desktop
echo      (atau jalankan start.bat)
echo   2. Browser kebuka -^> isi setup wizard 5 langkah
echo   3. Scan QR WhatsApp yang muncul di terminal (CUKUP SEKALI)
echo.
echo   Dashboard:
echo     - Admin    : http://localhost:3458
echo     - Futsal   : http://localhost:3457
echo.
set /p "DOSTART=Jalankan sekarang? (Y/N): "
if /i "%DOSTART%"=="Y" (
    call "%ROOT%\start.bat"
) else (
    echo OK. Jalankan kapan saja via shortcut di Desktop.
    echo.
    pause
)
